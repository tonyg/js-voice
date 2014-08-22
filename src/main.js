'use strict';

var C = require("./c_code.js");

//---------------------------------------------------------------------------
// Polyfill access to AudioContext and getUserMedia

var AudioContext = (window.AudioContext || window.webkitAudioContext);
var getUserMedia =
    (navigator.getUserMedia ||
     navigator.webkitGetUserMedia ||
     navigator.mozGetUserMedia ||
     navigator.msGetUserMedia).bind(navigator);

//---------------------------------------------------------------------------
// Allocation

function MALLOC(nbytes) {
  var result = C._malloc(nbytes);
  if (result === 0) {
    throw new Error("malloc("+nbytes+") failed");
  }
  return result;
}

function FREE(pointer) {
  C._free(pointer);
}

//---------------------------------------------------------------------------

function injectBytes(bs) {
  var address = MALLOC(bs.length);
  C.HEAPU8.set(bs, address);
  return address;
}

function extractBytes(address, length) {
  var result = new Uint8Array(length);
  result.set(C.HEAPU8.subarray(address, address + length));
  return result;
}

function extractCString(address) {
  var result = [];
  while (1) {
    var c = C.HEAPU8[address++];
    if (c === 0) break;
    result.push(String.fromCharCode(c)); // TODO: UTF-8?
  }
  return result.join('');
}

function injectFloats(fs) {
  var address = MALLOC(fs.length << 2);
  C.HEAPF32.set(fs, address >>> 2);
  return address;
}

function float_to_short(f) {
  var s = Math.round(f * 32768);
  if (s >= 32768) {
    s = 32767;
  } else if (s < -32768) {
    s = -32768;
  }
  return s;
}

function injectFloatsToShorts(fs) {
  var address = MALLOC(fs.length << 1);
  var offset = address >>> 1;
  for (var i = 0; i < fs.length; i++) {
    C.HEAP16[offset + i] = float_to_short(fs[i]);
  }
  return address;
}

function extractFloats(address, count) {
  var result = new Float32Array(count);
  result.set(C.HEAPF32.subarray(address >>> 2, (address >>> 2) + count));
  return result;
}

function extractFloatsFromShorts(address, count) {
  var offset = address >>> 1;
  var result = new Float32Array(count);
  for (var i = 0; i < count; i++) {
    result[i] = C.HEAP16[offset + i] / 32768;
  }
  return result;
}

//---------------------------------------------------------------------------

function Target(length) {
  this.length = length;
  this.address = MALLOC(length);
}

Target.prototype.freeAndReturn = function (v) {
  FREE(this.address);
  this.address = null;
  return v;
};

Target.prototype.extractBytes = function (offset, limit) {
  return this.freeAndReturn(extractBytes(this.address + (offset || 0),
					 limit || (this.length - (offset || 0))));
};

Target.prototype.extractFloats = function (offset, limit) {
  return this.freeAndReturn(extractFloats(this.address + (offset || 0),
					  limit || ((this.length - (offset || 0)) >>> 2)));
};

Target.prototype.extractFloatsFromShorts = function (offset, limit) {
  return this.freeAndReturn(extractFloatsFromShorts(this.address + (offset || 0),
						    limit || ((this.length - (offset || 0)) >>> 1)));
};

//---------------------------------------------------------------------------

function checkLength(a, expectedLength, what) {
  if (a.length !== expectedLength) {
    throw new Error("Expected "+what+" to have length "+expectedLength+"; got length "+a.length);
  }
}

// function float_to_int16(dest, dest_offset, src, src_offset, count) {
//   for (var i = 0; i < count; i++) {
//     var v = Math.round(src[src_offset + i] * 32768);
//     if (v >= 32768) {
//       v = 32767;
//     } else if (v < -32768) {
//       v = -32768;
//     }
//     dest[dest_offset + i] = v;
//   }
// }

// function int16_to_float(dest, dest_offset, src, src_offset, count) {
//   for (var i = 0; i < count; i++) {
//     dest[dest_offset + 1] = src[src_offset + i] / 32768;
//   }
// }

//---------------------------------------------------------------------------

function SpeexEchoState(frameSize, filterLength) {
  this.frameSize = frameSize;
  this.filterLength = filterLength;
  this.pointer = C._speex_echo_state_init(frameSize, filterLength);
}

SpeexEchoState.prototype.destroy = function () {
  if (this.pointer) {
    C._speex_echo_state_destroy(this.pointer);
    this.pointer = 0;
  }
};

SpeexEchoState.prototype.echo_cancellation = function (inputSamples, outputSamples) {
  checkLength(inputSamples, this.frameSize, "SpeexEchoState inputSamples");
  checkLength(outputSamples, this.frameSize, "SpeexEchoState outputSamples");
  var in16 = injectFloatsToShorts(inputSamples);
  var out16 = injectFloatsToShorts(outputSamples);
  var clean16 = new Target(this.frameSize * 2);
  C._speex_echo_cancellation(this.pointer, in16, out16, clean16.address);
  FREE(in16);
  FREE(out16);
  return clean16.extractFloatsFromShorts(0);
};

SpeexEchoState.prototype.reset = function () {
  C._speex_echo_state_reset(this.pointer);
};

//---------------------------------------------------------------------------

function opus_errorcheck(result) {
  if (result < 0) {
    var msg = extractCString(C._opus_strerror(result));
    throw new Error("Opus error (code "+result+"): "+msg);
  }
  return result;
}

function OpusEncoder(sampleRate, nChannels, codingMode) {
  this.sampleRate = sampleRate;
  this.nChannels = nChannels;
  this.codingMode = codingMode;
  switch (codingMode) {
    case "voip": this.codingModeCode = 2048; break;
    case "audio": this.codingModeCode = 2049; break;
    case "restricted_lowdelay": this.codingModeCode = 2050; break;
    default: throw new Error("Illegal OpusEncoder codingMode "+codingMode);
  }
  this.pointer = MALLOC(C._opus_encoder_get_size(nChannels));
  opus_errorcheck(C._opus_encoder_init(this.pointer, sampleRate, nChannels, this.codingModeCode));
}

OpusEncoder.prototype.destroy = function () {
  if (this.pointer) {
    FREE(this.pointer);
    this.pointer = null;
  }
};

OpusEncoder.validFrameDurations = [2.5, 5, 10, 20, 40, 60]; // milliseconds

OpusEncoder.prototype.millisecondsToSampleCount = function (ms) {
  return this.nChannels * this.sampleRate * (ms / 1000.0);
};

OpusEncoder.prototype.validFrameSizes = function () {
  var result = [];
  for (var i = 0; i < OpusEncoder.validFrameDurations.length; i++) {
    result.push(this.millisecondsToSampleCount(OpusEncoder.validFrameDurations[i]));
  }
  return result;
};

OpusEncoder.prototype.checkValidFrameSize = function (sampleCount) {
  var self = this;
  for (var i = 0; i < OpusEncoder.validFrameDurations.length; i++) {
    if (sampleCount === this.millisecondsToSampleCount(OpusEncoder.validFrameDurations[i])) {
      return;
    }
  }
  throw new Error("Invalid Opus frame size "+sampleCount+"; valid sizes for "+
		  this.nChannels+" channels at "+this.sampleRate+"Hz are "+
		  JSON.stringify(OpusEncoder.validFrameSizes()));
};

OpusEncoder.prototype.encode = function (inputSamples, outputBufferSizeLimit) {
  outputBufferSizeLimit = outputBufferSizeLimit || 4096;
  this.checkValidFrameSize(inputSamples.length);
  var inBuffer = injectFloats(inputSamples);
  var result = new Target(outputBufferSizeLimit);
  var actualPacketSize = opus_errorcheck(C._opus_encode_float(this.pointer,
							      inBuffer,
							      inputSamples.length / this.nChannels,
							      result.address,
							      result.length));
  FREE(inBuffer);
  return result.extractBytes(0, actualPacketSize);
};

OpusEncoder.prototype.getBitrate = function () {
  var resultLocation = MALLOC(4);
  var resultLocationLocation = MALLOC(4);
  C.HEAP32[resultLocationLocation >>> 2] = resultLocation;
  opus_errorcheck(C._opus_encoder_ctl(this.pointer,
				      4003, // OPUS_GET_BITRATE_REQUEST
				      resultLocationLocation));
  var result = C.HEAPU32[resultLocation >>> 2];
  FREE(resultLocationLocation);
  FREE(resultLocation);
  return result;
};

OpusEncoder.prototype.setBitrate = function (bitrate) {
  var bitrateLocation = MALLOC(4);
  C.HEAP32[bitrateLocation >>> 2] = bitrate;
  opus_errorcheck(C._opus_encoder_ctl(this.pointer,
				      4002, // OPUS_SET_BITRATE_REQUEST
				      bitrateLocation));
  FREE(bitrateLocation);
};

function OpusDecoder(sampleRate, nChannels) {
  this.sampleRate = sampleRate;
  this.nChannels = nChannels;
  this.pointer = MALLOC(C._opus_decoder_get_size(nChannels));
  opus_errorcheck(C._opus_decoder_init(this.pointer, sampleRate, nChannels));
}

OpusDecoder.prototype.destroy = function () {
  if (this.pointer) {
    FREE(this.pointer);
    this.pointer = null;
  }
};

OpusDecoder.prototype.maximumUsefulFrameSize = function () {
  // Number of frames in 120ms of audio
  return Math.round(0.120 * this.sampleRate);
};

OpusDecoder.prototype.decode = function (inputData, decodeFec, frameSizeLimit) {
  frameSizeLimit = frameSizeLimit || this.maximumUsefulFrameSize();
  decodeFec = decodeFec || false;
  var inData = injectBytes(inputData);
  var frames = new Target(this.nChannels * frameSizeLimit * 4);
  var actualFrameCount = opus_errorcheck(C._opus_decode_float(this.pointer,
							      inData,
							      inputData.length,
							      frames.address,
							      frameSizeLimit,
							      decodeFec ? 1 : 0));
  FREE(inData);
  return frames.extractFloats(0, actualFrameCount);
};

//---------------------------------------------------------------------------

function CircularBuffer(length) {
  this.length = length | 0;
  this.buffer = new Float32Array(this.length);
  this.readPos = 0;
  this.writePos = 0;
};

CircularBuffer.prototype.usedSpace = function () {
  if (this.writePos < this.readPos) {
    return this.length - (this.readPos - this.writePos);
  } else {
    return this.writePos - this.readPos;
  }
};

CircularBuffer.prototype.freeSpace = function () {
  return this.length - this.usedSpace() - 1; // 1 for avoiding overlap between readPos and writePos
};

CircularBuffer.prototype.write = function (samples) {
  if (this.freeSpace() < samples.length) return false;
  var tailSpace = this.length - this.writePos;
  if (samples.length > tailSpace) {
    this.buffer.set(samples.subarray(0, tailSpace), this.writePos);
    this.buffer.set(samples.subarray(tailSpace), 0);
  } else {
    this.buffer.set(samples, this.writePos);
  }
  this.writePos = (this.writePos + samples.length) % this.length;
  return true;
};

if (AudioBuffer.prototype.copyFromChannel) {
  CircularBuffer.prototype.writeFromChannel = function (audioBuffer, channelNumber) {
    if (this.freeSpace() < audioBuffer.length) return false;
    var tailSpace = this.length - this.writePos;
    if (audioBuffer.length > tailSpace) {
      audioBuffer.copyFromChannel(this.buffer.subarray(this.writePos, this.length), channelNumber, 0);
      audioBuffer.copyFromChannel(this.buffer.subarray(0, audioBuffer.length - tailSpace), channelNumber, tailSpace);
    } else {
      audioBuffer.copyFromChannel(this.buffer.subarray(this.writePos, this.writePos + audioBuffer.length), channelNumber, 0);
    }
    this.writePos = (this.writePos + audioBuffer.length) % this.length;
    return true;
  };
} else {
  CircularBuffer.prototype.writeFromChannel = function (audioBuffer, channelNumber) {
    return this.write(audioBuffer.getChannelData(channelNumber));
  };
}

CircularBuffer.prototype.readInto = function (target) {
  var count = Math.min(this.usedSpace(), target.length);
  var tailSpace = this.length - this.readPos;
  if (count > tailSpace) {
    target.set(this.buffer.subarray(this.readPos, this.length), 0);
    target.set(this.buffer.subarray(0, count - tailSpace), tailSpace);
  } else {
    target.set(this.buffer.subarray(this.readPos, this.readPos + count), 0);
  }
  this.readPos = (this.readPos + count) % this.length;
  return count;
};

if (AudioBuffer.prototype.copyToChannel) {
  CircularBuffer.prototype.readIntoChannel = function (audioBuffer, channelNumber, startInChannel) {
    startInChannel = startInChannel || 0;
    var count = Math.min(this.usedSpace(), audioBuffer.length - startInChannel);
    var tailSpace = this.length - this.readPos;
    if (count > tailSpace) {
      audioBuffer.copyToChannel(this.buffer.subarray(this.readPos, this.length), channelNumber, startInChannel);
      audioBuffer.copyToChannel(this.buffer.subarray(0, count - tailSpace), channelNumber, startInChannel + tailSpace);
    } else {
      audioBuffer.copyToChannel(this.buffer.subarray(this.readPos, this.readPos + count), startInChannel);
    }
    this.readPos = (this.readPos + count) % this.length;
    return count;
  };
} else {
  CircularBuffer.prototype.readIntoChannel = function (audioBuffer, channelNumber, startInChannel) {
    return this.readInto(audioBuffer.getChannelData(channelNumber).subarray(startInChannel || 0));
  };
}

CircularBuffer.prototype.read = function (maxCount) {
  var space = new Float32Array(maxCount);
  return space.subarray(0, this.readInto(space));
};

//---------------------------------------------------------------------------

function MuxBuffer(length) {
  this.length = length;
  this.readPos = 0;
  this.buffer = new Float32Array(length);
}

MuxBuffer.mux = function (dest, destStart, src, srcStart, srcEnd, scale) {
  var diff = srcStart - destStart;
  for (var i = srcStart; i < srcEnd; i++) {
    dest[i - diff] += src[i] * scale;
  }
};

MuxBuffer.zero = function (dest, destStart, destEnd) {
  for (var i = destStart; i < destEnd; i++) {
    dest[i] = 0;
  }
};

MuxBuffer.prototype.clipBounds = function (offset, length) {
  var Rlo = this.readPos;
  var Rhi = Rlo + this.length;
  var Wlo = offset;
  var Whi = offset + length;
  var target_lo = Math.max(Rlo, Wlo);
  var target_hi = Math.min(Rhi, Whi);
  var sourceOffset = target_lo - Wlo;
  var transferLength = target_hi - target_lo;
  return {
    sourceOffset: sourceOffset,
    targetOffset: target_lo % this.length,
    transferLength: transferLength
  };
};

MuxBuffer.prototype.write = function (samples, offset, scale) {
  scale = scale || 1.0;
  var coordinates = this.clipBounds(offset, samples.length);
  // var advance = offset - this.readPos
  if (coordinates.transferLength > 0) {
    var tailSpace = this.length - coordinates.targetOffset;
    if (coordinates.transferLength > tailSpace) {
      MuxBuffer.mux(this.buffer,
		    coordinates.targetOffset,
		    samples,
		    coordinates.sourceOffset,
		    coordinates.sourceOffset + tailSpace,
		    scale);
      MuxBuffer.mux(this.buffer,
		    0,
		    samples,
		    coordinates.sourceOffset + tailSpace,
		    coordinates.sourceOffset + coordinates.transferLength,
		    scale);
    } else {
      MuxBuffer.mux(this.buffer,
		    coordinates.targetOffset,
		    samples,
		    coordinates.sourceOffset,
		    coordinates.sourceOffset + coordinates.transferLength,
		    scale);
    }
  }
  return Math.max(0, coordinates.transferLength);
};

MuxBuffer.prototype.readInto = function (target) {
  var r = this.readPos % this.length;
  var transferLength = Math.min(target.length, this.length);
  var tailSpace = this.length - r;
  if (transferLength > tailSpace) {
    target.set(this.buffer.subarray(r, this.length), 0);
    target.set(this.buffer.subarray(0, transferLength - tailSpace), tailSpace);
    MuxBuffer.zero(this.buffer, r, this.length);
    MuxBuffer.zero(this.buffer, 0, transferLength - tailSpace);
  } else {
    target.set(this.buffer.subarray(r, r + transferLength), 0);
    MuxBuffer.zero(this.buffer, r, r + transferLength);
  }
  this.readPos += transferLength;
  return transferLength;
};

//---------------------------------------------------------------------------

function resample(dest, destSampleRate, src, srcSampleRate) {
  var ratio = srcSampleRate / destSampleRate;
  for (var i = 0; i < dest.length; i++) {
    dest[i] = src[Math.min(src.length - 1, Math.floor(i * ratio))];
  }
}

//---------------------------------------------------------------------------
// SimpleMonoDriver

function SimpleMonoDriver(options) {
  var self = this;

  options = options || {};
  self.frameDuration = options.frameDuration || (1/100); // seconds
  self.processorBufferSize = options.processorBufferSize || 1024;
  self.inputBufferSeconds = options.inputBufferSeconds || 0.5;
  self.outputBufferSeconds = options.outputBufferSeconds || 0.5;
  self.onerror = options.onerror || null;
  self.oninput = null;
  self.onoutput = null;

  self.context = new AudioContext();
  self.sampleRate = self.context.sampleRate;
  self.frameSize = Math.ceil(self.sampleRate * self.frameDuration);

  self.inputBuffer = new CircularBuffer(self.sampleRate * self.inputBufferSeconds);
  self.muxBuffer = new MuxBuffer(self.sampleRate * self.outputBufferSeconds);

  getUserMedia(
    {audio: true, video: false},
    function (stream) {
      self.stream = stream; // prevent GC of stream, which causes audio drops
      self.sourceNode = self.context.createMediaStreamSource(stream);
      self.processorNode = self.context.createScriptProcessor(self.processorBufferSize, 1, 1);

      self.processorNode.onaudioprocess = function (e) {
  	self.inputBuffer.writeFromChannel(e.inputBuffer, 0);
	if (self.oninput) {
	  self.oninput();
	}

	var channelDataBuffer = e.outputBuffer.getChannelData(0);
	self.muxBuffer.readInto(channelDataBuffer);
	if (self.onoutput) {
	  self.onoutput(channelDataBuffer);
	}
      };

      self.sourceNode.connect(self.processorNode);
      self.processorNode.connect(self.context.destination);
    },
    function (err) {
      if (self.onerror) {
	self.onerror(err);
      }
    }
  );
}

//---------------------------------------------------------------------------

module.exports.C = C;
module.exports.AudioContext = AudioContext;
module.exports.getUserMedia = getUserMedia;
module.exports.SpeexEchoState = SpeexEchoState;
module.exports.OpusEncoder = OpusEncoder;
module.exports.OpusDecoder = OpusDecoder;
module.exports.CircularBuffer = CircularBuffer;
module.exports.MuxBuffer = MuxBuffer;
module.exports.resample = resample;
module.exports.SimpleMonoDriver = SimpleMonoDriver;

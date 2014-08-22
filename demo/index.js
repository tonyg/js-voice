var AudioContext = (window.AudioContext || window.webkitAudioContext);
var getUserMedia =
    (navigator.getUserMedia ||
     navigator.webkitGetUserMedia ||
     navigator.mozGetUserMedia ||
     navigator.msGetUserMedia).bind(navigator);

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

  self.inputBuffer = new Voice.CircularBuffer(self.sampleRate * self.inputBufferSeconds);
  self.muxBuffer = new Voice.MuxBuffer(self.sampleRate * self.outputBufferSeconds);

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

///////////////////////////////////////////////////////////////////////////

var D;

function main () {
  var graphCanvas = document.getElementById('graphCanvas');
  var ctx = graphCanvas.getContext("2d");

  function chartData(a) {
    ctx.fillStyle = "#eeeeff";
    ctx.fillRect(0, 0, graphCanvas.width, graphCanvas.height);
    var hscale = graphCanvas.width / a.length;
    var vofs = graphCanvas.height / 2;
    var vscale = graphCanvas.height / 2;
    ctx.beginPath();
    ctx.moveTo(0, vofs);
    for (var i = 0; i < a.length; i++) {
      ctx.lineTo(i * hscale, vofs + (vscale * a[i]));
    }
    ctx.strokeStyle = "black";
    ctx.stroke();
  }

  D = new SimpleMonoDriver({
    onerror: function (e) {
      console.error(e);
    }
  });

  var opusSampleRate = 48000;
  var encoder = new Voice.OpusEncoder(opusSampleRate, 1, "voip");
  encoder.setBitrate(16000);
  var decoder = new Voice.OpusDecoder(opusSampleRate, 1);

  var rawBuf = new Float32Array(D.frameSize);

  var opusFrameSize = Math.ceil(opusSampleRate * D.frameDuration);
  var frameBuf = new Float32Array(opusFrameSize);

  var targetPos = D.muxBuffer.readPos + 2 * D.frameSize;
  D.oninput = function () {
    var inBuf = D.inputBuffer;
    var muxBuf = D.muxBuffer;
    while (inBuf.usedSpace() >= D.frameSize) {
      inBuf.readInto(rawBuf);
      Voice.resample(frameBuf, opusSampleRate, rawBuf, D.sampleRate);
      var encoded = encoder.encode(frameBuf);
      var decoded = decoder.decode(encoded);
      Voice.resample(rawBuf, D.sampleRate, decoded, opusSampleRate);
      muxBuf.write(rawBuf, targetPos);
      targetPos += rawBuf.length;
    }
  };
}

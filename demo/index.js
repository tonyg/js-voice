function main () {
  var AudioContext = (window.AudioContext || window.webkitAudioContext);
  var getUserMedia =
      (navigator.getUserMedia ||
       navigator.webkitGetUserMedia ||
       navigator.mozGetUserMedia ||
       navigator.msGetUserMedia).bind(navigator);

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

  getUserMedia(
    {audio: true, video: false},
    function (stream) {
      var context = new AudioContext();

      var frameDuration = 1 / 100;

      var rawFrameSize = Math.ceil(context.sampleRate * frameDuration);

      var opusSampleRate = 48000;
      var opusFrameSize = Math.ceil(opusSampleRate * frameDuration);
      var encoder = new Voice.OpusEncoder(opusSampleRate, 1, "voip");
      encoder.setBitrate(16000);
      var decoder = new Voice.OpusDecoder(opusSampleRate, 1);

      var source = context.createMediaStreamSource(stream);
      var processor = context.createScriptProcessor(1024, 1, 1);
      var inBuf = new Voice.CircularBuffer(context.sampleRate * 0.5);
      var outBuf = new Voice.CircularBuffer(context.sampleRate * 0.5);

      var rawBuf = new Float32Array(rawFrameSize);
      var frameBuf = new Float32Array(opusFrameSize);

      preventGC = stream; // omg

      var index = 0;
      processor.onaudioprocess = function (e) {
  	inBuf.writeFromChannel(e.inputBuffer, 0);

  	while (inBuf.usedSpace() >= rawFrameSize) {
  	  inBuf.readInto(rawBuf);
  	  Voice.resample(frameBuf, opusSampleRate, rawBuf, context.sampleRate);
  	  var encoded = encoder.encode(frameBuf);
  	  var decoded = decoder.decode(encoded);
  	  Voice.resample(rawBuf, context.sampleRate, decoded, opusSampleRate);
  	  outBuf.write(rawBuf);
  	}

  	if (outBuf.usedSpace() >= e.outputBuffer.length) {
  	  outBuf.readIntoChannel(e.outputBuffer, 0);
	  chartData(e.outputBuffer.getChannelData(0));
  	}
      };

      source.connect(processor);
      processor.connect(context.destination);
    },
    function (err) {
      console.error(err);
    }
  );
}

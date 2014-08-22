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

  D = new Voice.SimpleMonoDriver({
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

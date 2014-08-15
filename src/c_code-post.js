// we're in browserify context, so we do this explicitly here since
// emscripten's baked-in environment check doesn't pick up this
// particular situation:
module.exports = Module;

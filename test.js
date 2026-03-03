const sound = require("sound-play");
const path = require("node:path")
const pathy = path.join(__dirname, 'sound_clips', 'mics.wav')
console.log(pathy)
sound.play(pathy);

let audioCtx;
let masterGainNode;
let masterLimiterNode;
let musicGainNode;
let ambianceGainNode;
let sfxGainNode;
let sfx_waitGainNode;
let voiceGainNode;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Ensure Tone.js uses this single, shared AudioContext.
        Tone.setContext(audioCtx);

        // Explicitly set listener orientation to default (facing forward)
        const listener = audioCtx.listener;
        if (listener.forwardX) { // Modern API
            listener.forwardX.value = 0;
            listener.forwardY.value = 0;
            listener.forwardZ.value = -1;
            listener.upX.value = 0;
            listener.upY.value = 1;
            listener.upZ.value = 0;
        } else { // Deprecated fallback
            listener.setOrientation(0, 0, -1, 0, 1, 0);
        }

        masterGainNode = audioCtx.createGain();
        musicGainNode = audioCtx.createGain();
        ambianceGainNode = audioCtx.createGain();
        sfxGainNode = audioCtx.createGain();
        sfx_waitGainNode = audioCtx.createGain();
        voiceGainNode = audioCtx.createGain();

        musicGainNode.connect(masterGainNode);
        ambianceGainNode.connect(masterGainNode);
        sfxGainNode.connect(masterGainNode);
        sfx_waitGainNode.connect(masterGainNode);
        voiceGainNode.connect(masterGainNode);

        // 砖墙限幅器：防止 IR/HRTF/多轨叠加导致的削顶（破音）
        // threshold=-1 dBFS, ratio=20:1, knee=0 -> 等效 brickwall limiter
        masterLimiterNode = audioCtx.createDynamicsCompressor();
        masterLimiterNode.threshold.value = -1;
        masterLimiterNode.knee.value = 0;
        masterLimiterNode.ratio.value = 20;
        masterLimiterNode.attack.value = 0.001;
        masterLimiterNode.release.value = 0.05;

        masterGainNode.connect(masterLimiterNode);
        masterLimiterNode.connect(audioCtx.destination);

        console.log("AudioContext initialized on demand.");
    }
}

function getAudioContext() {
    initAudio();
    return audioCtx;
}

export {
    initAudio,
    getAudioContext,
    audioCtx,
    masterGainNode,
    masterLimiterNode,
    musicGainNode,
    ambianceGainNode,
    sfxGainNode,
    sfx_waitGainNode,
    voiceGainNode,
};

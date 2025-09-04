let audioCtx;
let pannerNode_Music;
let pannerNode_Ambiance;
let pannerNode_SFX;
let pannerNode_SFX_WAIT;

let masterGainNode;
let musicGainNode;
let ambianceGainNode;
let sfxGainNode;
let sfx_waitGainNode;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        pannerNode_Music = audioCtx.createPanner();
        pannerNode_Music.panningModel = 'HRTF'; // 使用头部相关传输函数
        pannerNode_Music.distanceModel = 'inverse';
        pannerNode_Music.refDistance = 0.6;
        pannerNode_Music.maxDistance = 20;
        pannerNode_Music.rolloffFactor = 0.3;

        pannerNode_Ambiance = audioCtx.createPanner();
        pannerNode_Ambiance.panningModel = 'HRTF'; // 使用头部相关传输函数
        pannerNode_Ambiance.distanceModel = 'inverse';
        pannerNode_Ambiance.refDistance = 0.6;
        pannerNode_Ambiance.maxDistance = 20;
        pannerNode_Ambiance.rolloffFactor = 0.3;

        pannerNode_SFX = audioCtx.createPanner();
        pannerNode_SFX.panningModel = 'HRTF'; // 使用头部相关传输函数
        pannerNode_SFX.distanceModel = 'inverse';
        pannerNode_SFX.refDistance = 0.6;
        pannerNode_SFX.maxDistance = 20;
        pannerNode_SFX.rolloffFactor = 0.3;

        pannerNode_SFX_WAIT = audioCtx.createPanner();
        pannerNode_SFX_WAIT.panningModel = 'HRTF'; // 使用头部相关传输函数
        pannerNode_SFX_WAIT.distanceModel = 'inverse';
        pannerNode_SFX_WAIT.refDistance = 0.6;
        pannerNode_SFX_WAIT.maxDistance = 20;
        pannerNode_SFX_WAIT.rolloffFactor = 0.3;

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

        // musicGainNode.connect(masterGainNode);
        // ambianceGainNode.connect(masterGainNode);
        // sfxGainNode.connect(masterGainNode);
        // sfx_waitGainNode.connect(masterGainNode);
        // masterGainNode.connect(audioCtx.destination);

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
    pannerNode_Music,
    pannerNode_Ambiance,
    pannerNode_SFX,
    pannerNode_SFX_WAIT,
    masterGainNode,
    musicGainNode,
    ambianceGainNode,
    sfxGainNode,
    sfx_waitGainNode,
};

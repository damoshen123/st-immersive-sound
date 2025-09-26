import { extension_settings } from "../../../../extensions.js";
import { getAudioContext, pannerNode_Music, pannerNode_Ambiance, pannerNode_SFX, pannerNode_SFX_WAIT, pannerNode_VOICE, musicGainNode, ambianceGainNode, sfxGainNode, sfx_waitGainNode, voiceGainNode, masterGainNode} from './audio-context.js';
import { loadAudio } from './audio-cache.js';
import { extensionName } from './config.js';
import { t } from "../../../../i18n.js";

function parseVibrationValue(valueString, defaultValue) {
    if (valueString === undefined || valueString === null) {
        return defaultValue;
    }
    valueString = String(valueString).trim();
    if (valueString.startsWith('[') && valueString.endsWith(']')) {
        try {
            const arr = JSON.parse(valueString);
            if (Array.isArray(arr) && arr.every(item => typeof item === 'number')) {
                return arr;
            }
        } catch (e) {
            console.warn(`Could not parse vibration value as array: ${valueString}`, e);
        }
    }
    const num = parseInt(valueString, 10);
    if (!isNaN(num)) {
        return num;
    }
    return defaultValue;
}

let playingList = {};
let sourceisPlaying = {};
let sfxWaitCount = 0;
let vibrationTimeouts = {};
let vibrationAnalysis = {}; // Stores animation frame IDs for volume analysis

function playWithFadeIn(gainNode, sourceNode, fadeInDuration = 1, value) {
    const now = getAudioContext().currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(value, now + fadeInDuration);
    sourceNode.start();
}

/**
 * Performs a complete cleanup of all nodes and resources associated with a single audio source.
 * @param {AudioBufferSourceNode} source The source node.
 * @param {GainNode} gainNode The gain node connected to the source.
 * @param {PannerNode} pannerNode The panner node (can be null).
 * @param {AnalyserNode} analyserNode The analyser node (can be null).
 */
function _cleanupAudioNodes(source, gainNode, pannerNode, analyserNode) {
    if (!source) return;

    // 1. Remove event listeners to prevent memory leaks
    source.onended = null;

    // 2. Disconnect all audio nodes in the chain to allow for garbage collection
    source.disconnect();
    gainNode.disconnect();
    if (analyserNode) {
        analyserNode.disconnect();
    }
    // Panner nodes are reused, so we don't disconnect them from the destination.
    // We only disconnect the gain nodes that feed into them.

    console.log("Cleaned up audio nodes and resources.");
}


function pauseWithFadeOutAndCleanup(item, fadeOutDuration = 1, key) {
    if (!item || !item[0]) {
        console.warn("pauseWithFadeOutAndCleanup called with invalid item for key:", key);
        return;
    }
    const [source, gainNode, pannerNode, volume, regex_end, regex, audioType, analyserNode, animationFrameId] = item;
    const now = getAudioContext().currentTime;

    // An 'onended' event will fire when the source stops, so we set it to null
    // to prevent our onended handler from running unexpectedly.
    source.onended = null;

    // Stop volume analysis loop
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    if (vibrationAnalysis[key]) {
        delete vibrationAnalysis[key];
    }

    // Schedule the fade-out
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + fadeOutDuration);

    console.log("Fading out and scheduling cleanup for", key);

    // Stop looping vibration if any
    if (key && vibrationTimeouts[key]) {
        clearTimeout(vibrationTimeouts[key]);
        delete vibrationTimeouts[key];
        if (navigator.vibrate) {
            navigator.vibrate(0); // Stop vibration immediately
        }
        console.log(`Stopped looping vibration for ${key}`);
    }

    // Schedule the source to stop playing after the fade-out.
    try {
        source.stop(now + fadeOutDuration);
    } catch(e) {
        // The source might have already been stopped.
    }

    // Disconnect nodes after a delay to allow fade-out to complete.
    // This is a fire-and-forget cleanup.
    setTimeout(() => {
        _cleanupAudioNodes(source, gainNode, pannerNode, analyserNode);
    }, (fadeOutDuration + 0.5) * 1000);
}

async function playList(currentGlobalCharIndex, musicList, marker) {
    let index = 0;
    let triggeredAudio = null;


    for (let key in playingList) {
        if (playingList.hasOwnProperty(key)) {
            let item = playingList[key];
            let fadeOut;

            if (sourceisPlaying[key] || (item[4] && item[4] < currentGlobalCharIndex)) {
                console.log(key + " playback ended, starting cleanup.");
                
                let fadeOut;
                switch (item[6]) { // item[6] is the type
                    case "Music":
                        fadeOut = extension_settings[extensionName].musicFadeOut ?? 2;
                        break;
                    case "Ambiance":
                        fadeOut = extension_settings[extensionName].ambianceFadeOut ?? 2;
                        break;
                    case "SFX":
                        fadeOut = extension_settings[extensionName].sfxFadeOut ?? 0.1;
                        break;
                    case "SFX_WAIT":
                        fadeOut = extension_settings[extensionName].sfx_waitFadeOut ?? 0.1;
                        break;
                    case "VOICE":
                        fadeOut = extension_settings[extensionName].voiceFadeOut ?? 0.1;
                        break;
                    default:
                        fadeOut = 1; // Default fade-out
                }
                
                // Use the new cleanup function
                pauseWithFadeOutAndCleanup(item, fadeOut, key);
                
                // Remove from the list immediately
                delete playingList[key];
            }
        }
    }

    for (let i = index; i < musicList.length; i++) {
        let music = musicList[i];

        if (!playingList.hasOwnProperty(music.src) && ((music.regex_start <= currentGlobalCharIndex && music.regex_end >= currentGlobalCharIndex) || music.regex == currentGlobalCharIndex)) {
            triggeredAudio = music;
            playingList[music.src] = [];

            // loadAudio now returns an AudioBuffer
            let audioBuffer = await loadAudio(music.url, music.src);

            if (!audioBuffer) {
                console.error("Failed to load audio buffer for " + music.src);
                continue; // Skip to the next music item
            }

            // Create an AudioBufferSourceNode
            const source = getAudioContext().createBufferSource();
            source.buffer = audioBuffer;
            source.loop = music.loop;

            const gainNode = getAudioContext().createGain();
            let analyserNode = null;
            let animationFrameId = null;

            let nowMUsic= music.src;

            let nowMusicSeconds=audioBuffer.duration

            let typeGainNode;
            let pannerNode;
            let fadeIn;
            let is3dAudioEnabledForType = false;

            switch (music.type) {
                case "Music":
                    typeGainNode = musicGainNode;
                    pannerNode = pannerNode_Music;
                    fadeIn = extension_settings[extensionName].musicFadeIn ?? 3;
                    is3dAudioEnabledForType = extension_settings[extensionName].enable3dAudio_music;
                    break;
                case "Ambiance":
                    typeGainNode = ambianceGainNode;
                    pannerNode = pannerNode_Ambiance;
                    fadeIn = extension_settings[extensionName].ambianceFadeIn  ?? 3;
                    is3dAudioEnabledForType = extension_settings[extensionName].enable3dAudio_ambiance;
                    break;
                case "SFX":
                    typeGainNode = sfxGainNode;
                    pannerNode = pannerNode_SFX;
                    fadeIn = extension_settings[extensionName].sfxFadeIn  ?? 0.1;
                    is3dAudioEnabledForType = extension_settings[extensionName].enable3dAudio_sfx;
                    break;
                case "SFX_WAIT":
                    typeGainNode = sfx_waitGainNode;
                    pannerNode = pannerNode_SFX_WAIT;
                    fadeIn = extension_settings[extensionName].sfx_waitFadeIn  ?? 0.1;
                    is3dAudioEnabledForType = extension_settings[extensionName].enable3dAudio_sfx_wait;
                    if (marker && marker.isPlaying) {
                        marker.setSpeedByDuration(nowMUsic.length-"VOICE_".length,nowMusicSeconds);
                    }
                    sfxWaitCount++;
                    break;
                case "VOICE":
                    typeGainNode = voiceGainNode;
                    pannerNode = pannerNode_VOICE;
                    fadeIn = extension_settings[extensionName].voiceFadeIn ?? 0.1;
                    is3dAudioEnabledForType = extension_settings[extensionName].enable3dAudio_voice;
                    if (marker && marker.isPlaying) {
                        
                        marker.setSpeedByDuration(nowMUsic.length-"VOICE_".length,nowMusicSeconds);
                    }
                    sfxWaitCount++;
                    break;
            }
            
            gainNode.gain.value = Number(music.volume) / 100 * masterGainNode.gain.value * typeGainNode.gain.value;
            

            let lastNode = source;

            // Auto Vibration Logic based on volume
            if (extension_settings[extensionName].enable_vibration && typeof music.vibration === 'string' && music.vibration.startsWith('auto')) {
                analyserNode = getAudioContext().createAnalyser();
                analyserNode.fftSize = 256; // Smallest size for performance
                lastNode.connect(analyserNode);
                lastNode = analyserNode;

                const parts = music.vibration.split('-');
                const lowThreshold = parts.length > 1 && !isNaN(parseInt(parts[1])) ? parseInt(parts[1]) : 20;
                const lowDuration = parseVibrationValue(parts[2], 50);
                const highThreshold = parts.length > 3 && !isNaN(parseInt(parts[3])) ? parseInt(parts[3]) : 80;
                const highDuration = parseVibrationValue(parts[4], 100);

                animationFrameId = startVolumeAnalysis(analyserNode, lowThreshold, lowDuration, highThreshold, highDuration, music.src);
            }

            if (is3dAudioEnabledForType) {
                lastNode.connect(gainNode);
                gainNode.connect(pannerNode);
                pannerNode.connect(getAudioContext().destination);
            } else {
                lastNode.connect(gainNode);
                gainNode.connect(getAudioContext().destination);
            }

            const cursrc = music.src;
            sourceisPlaying[cursrc] = false;
            source.onended = () => {
                sourceisPlaying[cursrc] = false;
                if (music.type === "SFX_WAIT"|| music.type === "VOICE") {
                    sfxWaitCount--;
                    if (sfxWaitCount === 0 && marker) {
                        
                        marker.setSpeed(extension_settings[extensionName].readingSpeed);
                    }
                }

                const item = playingList[cursrc];
                // This handler is for sounds that end naturally (i.e., non-looping sounds).
                // If the sound is still tracked in playingList, we clean it up.
                if (item && !item[0].loop) {
                    console.log(`Naturally ended sound cleanup: ${cursrc}`);
                    _cleanupAudioNodes(item[0], item[1], item[2], item[7]); // Pass all nodes

                    if (vibrationTimeouts[cursrc]) {
                        clearTimeout(vibrationTimeouts[cursrc]);
                        delete vibrationTimeouts[cursrc];
                    }
                    if (vibrationAnalysis[cursrc]) {
                        cancelAnimationFrame(vibrationAnalysis[cursrc].animationFrameId);
                        delete vibrationAnalysis[cursrc];
                    }

                    delete playingList[cursrc];
                }
            };

            // Vibration Logic (Pattern-based)
            if (extension_settings[extensionName].enable_vibration && music.vibration && music.vibration !== 'N/A' && !String(music.vibration).startsWith('auto')) {
                const vibrationProfiles = extension_settings[extensionName].vibration_profiles || {};
                let pattern;

                // If it's a raw array string, parse it
                if (typeof music.vibration === 'string' && music.vibration.trim().startsWith('[')) {
                    try {
                        pattern = JSON.parse(music.vibration);
                    } catch (e) {
                        console.warn("Could not parse vibration string as array:", music.vibration);
                        pattern = null;
                    }
                } else {
                    // Otherwise, treat it as a profile name
                    pattern = vibrationProfiles[music.vibration];
                }

                if (Array.isArray(pattern) && pattern.length > 0 && navigator.vibrate) {
                    const vibrationType = pattern[0];
                    const actualPattern = pattern.slice(1);

                    if (vibrationType === 0) { // Single vibration
                        navigator.vibrate(actualPattern);
                        } else if (vibrationType === 1) { // Looping vibration
                            if (actualPattern.length > 0) {
                                const duration = actualPattern.reduce((a, b) => a + b, 0);
                                if (duration > 0) {
                                    if (vibrationTimeouts[music.src]) {
                                        clearTimeout(vibrationTimeouts[music.src]);
                                    }
                                    const vibrateLoop = () => {
                                        navigator.vibrate(actualPattern);
                                        vibrationTimeouts[music.src] = setTimeout(vibrateLoop, duration);
                                    };
                                    vibrateLoop();
                                }
                            }
                        }
                    
                }
            }

            playWithFadeIn(gainNode, source, fadeIn, gainNode.gain.value);
            
            playingList[music.src] = [source, gainNode, pannerNode, music.volume, music.regex_end, music.regex, music.type, analyserNode, animationFrameId];
            console.log("playingList", playingList);
        }
    }


    return triggeredAudio;
}

function stopAudioByKey(key, fadeOutDuration = 0.1) {
    if (playingList.hasOwnProperty(key)) {
        console.log(`Stopping audio source via key: ${key}`);
        const item = playingList[key];
        pauseWithFadeOutAndCleanup(item, fadeOutDuration, key);
        delete playingList[key]; // Remove from the list
        return true;
    }
    return false;
}

function stopAllAudio(marker) {
    // Stop the reading marker if it exists
    if (marker) {
        marker.stop();
    }

    // Stop and completely clean up all playing audio sources
    console.log("Stopping all audio...");
    for (const key in playingList) {
        if (playingList.hasOwnProperty(key)) {
            console.log(`Stopping audio source: ${key}`);
            // Use a short fade-out for a smoother stop.
            // This function now handles all cleanup internally.
            pauseWithFadeOutAndCleanup(playingList[key], 0.5, key);
        }
    }

    // Stop all looping vibrations
    for (const key in vibrationTimeouts) {
        if (vibrationTimeouts.hasOwnProperty(key)) {
            clearTimeout(vibrationTimeouts[key]);
        }
    }
    if (navigator.vibrate) {
        navigator.vibrate(0); // Stop any active vibration
    }

    // Reset all tracking objects to a clean state
    playingList = {};
    sourceisPlaying = {};
    sfxWaitCount = 0;
    vibrationTimeouts = {};
    console.log("All audio stopped and resources cleared.");
}

function isSfxWaitPlaying() {
    return sfxWaitCount > 0;
}

function startVolumeAnalysis(analyserNode, lowThreshold, lowDuration, highThreshold, highDuration, key) {
    if (!analyserNode || !navigator.vibrate) return null;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let wasAboveLowThreshold = false;
    let wasAboveHighThreshold = false;

    // Define frequency ranges (these are approximate and can be tuned)
    const lowEnd = Math.floor(bufferLength * 0.25); // Lower 25% of frequencies
    const highStart = Math.floor(bufferLength * 0.75); // Upper 25% of frequencies

    const analysisLoop = () => {
        // Stop the loop if the key is no longer in the playing list
        if (!playingList[key]) {
            return;
        }

        analyserNode.getByteFrequencyData(dataArray);

        // Calculate max volume for low and high frequencies
        let maxLowVolume = 0;
        for (let i = 0; i < lowEnd; i++) {
            if (dataArray[i] > maxLowVolume) {
                maxLowVolume = dataArray[i];
            }
        }

        let maxHighVolume = 0;
        for (let i = highStart; i < bufferLength; i++) {
            if (dataArray[i] > maxHighVolume) {
                maxHighVolume = dataArray[i];
            }
        }

        const isAboveLowThreshold = maxLowVolume > lowThreshold;
        const isAboveHighThreshold = maxHighVolume > highThreshold;


        if (isAboveHighThreshold && !wasAboveHighThreshold) {
            navigator.vibrate(highDuration);
        }else if (isAboveLowThreshold && !wasAboveLowThreshold) {
            navigator.vibrate(lowDuration);
        }

        wasAboveLowThreshold = isAboveLowThreshold;
        wasAboveHighThreshold = isAboveHighThreshold;

        // Request the next frame
        const animationId = requestAnimationFrame(analysisLoop);

        // Update the animation frame ID in the playingList
        if (playingList[key]) {
            playingList[key][8] = animationId;
        } else {
            // If the key was removed between the check and now, cancel the new frame
            cancelAnimationFrame(animationId);
        }
    };

    // Start the loop and return the initial animation frame ID
    return requestAnimationFrame(analysisLoop);
}

export {
    playList,
    stopAllAudio,
    stopAudioByKey,
    playingList,
    sourceisPlaying,
    isSfxWaitPlaying,
    startVolumeAnalysis,
};

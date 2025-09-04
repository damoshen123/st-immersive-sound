import { extension_settings } from "../../../../extensions.js";
import { getAudioContext, pannerNode_Music, pannerNode_Ambiance, pannerNode_SFX, pannerNode_SFX_WAIT, musicGainNode, ambianceGainNode, sfxGainNode, sfx_waitGainNode ,masterGainNode} from './audio-context.js';
import { loadAudio } from './audio-cache.js';
import { extensionName } from './config.js';

let playingList = {};
let sourceisPlaying = {};
let sfxWaitCount = 0;

function playWithFadeIn(gainNode, audioElement, fadeInDuration = 1,value) {
    const now = getAudioContext().currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(value, now + fadeInDuration);
    audioElement.play();
}

/**
 * Performs a complete cleanup of all nodes and resources associated with a single audio source.
 * @param {MediaElementAudioSourceNode} source The source node.
 * @param {GainNode} gainNode The gain node connected to the source.
 * @param {PannerNode} pannerNode The panner node (can be null).
 */
function _cleanupAudioNodes(source, gainNode, pannerNode) {
    if (!source || !source.mediaElement) return;

    const mediaElement = source.mediaElement;

    // 1. Stop playback and remove event listeners
    mediaElement.pause();
    mediaElement.onended = null; // Important to prevent memory leaks from closures
    mediaElement.src = ''; // Detach the source URL
    mediaElement.load(); // Some browsers need this to release the file handle

    // 2. Revoke Blob URL if it exists
    if (mediaElement.blobUrl) {
        URL.revokeObjectURL(mediaElement.blobUrl);
        mediaElement.blobUrl = null;
        console.log("Revoked Blob URL.");
    }

    // 3. Disconnect all audio nodes in the chain
    if (source) {
        source.disconnect();
    }
    if (gainNode) {
        gainNode.disconnect();
    }
    // PannerNode might not always be present, but if it is, it must be disconnected.
    // if (pannerNode && pannerNode.numberOfOutputs > 0) {
    //     pannerNode.disconnect();
    // }

    console.log("Cleaned up audio nodes and resources.");
}


function pauseWithFadeOutAndCleanup(item, fadeOutDuration = 1) {
    const [source, gainNode] = item;
    const now = getAudioContext().currentTime;

    // Schedule the fade-out
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + fadeOutDuration);

    console.log("Fading out and scheduling cleanup for", source.mediaElement.src);

    // After the fade-out, perform a full cleanup
    setTimeout(() => {
        _cleanupAudioNodes(...item); // Pass all elements of the item array
    }, fadeOutDuration * 1000);
}

async function playList(currentGlobalCharIndex, musicList, marker) {
    let index = 0;

    for (let i = index; i < musicList.length; i++) {
        let music = musicList[i];

        if (!playingList.hasOwnProperty(music.src) && ((music.regex_start <= currentGlobalCharIndex && music.regex_end >= currentGlobalCharIndex) || music.regex == currentGlobalCharIndex)) {
            playingList[music.src] = [];

            let source = await loadAudio(music.url, music.src);

            if (!source) {
                console.error("Failed to load audio source for " + music.src);
                continue; // Skip to the next music item
            }

            source.mediaElement.loop = music.loop;

            const gainNode = getAudioContext().createGain();

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
                    source.connect(masterGainNode);
                    masterGainNode.connect(typeGainNode);
                    break;
                case "SFX_WAIT":
                    typeGainNode = sfx_waitGainNode;
                    pannerNode = pannerNode_SFX_WAIT;
                    fadeIn = extension_settings[extensionName].sfx_waitFadeIn  ?? 0.1;
                    is3dAudioEnabledForType = extension_settings[extensionName].enable3dAudio_sfx_wait;
                    if (marker && marker.isPlaying) {
                        marker.pause();
                    }
                    sfxWaitCount++;
                    break;
            }

            if (is3dAudioEnabledForType) {
               // typeGainNode.connect(gainNode);
               gainNode.gain.value =Number( music.volume)/100*masterGainNode.gain.value*typeGainNode.gain.value;
                source.connect(gainNode)
                gainNode.connect(pannerNode);
               pannerNode.connect(getAudioContext().destination);
               
            } else {
              //  typeGainNode.gain.value=typeGainNode.gain.value*music.volume/100;
              gainNode.gain.value =Number( music.volume)/100*masterGainNode.gain.value*typeGainNode.gain.value;
              source.connect(gainNode);
              gainNode.connect(getAudioContext().destination);
            }

            const cursrc = music.src;
            sourceisPlaying[cursrc] = false;
            source.mediaElement.onended = () => {
                sourceisPlaying[cursrc] = false;
                if (music.type === "SFX_WAIT") {
                    sfxWaitCount--;
                    if (sfxWaitCount === 0 && marker) {
                        marker.resume();
                    }
                }
            };

            getAudioContext().resume();
            playWithFadeIn(gainNode, source.mediaElement, fadeIn,gainNode.gain.value);
            
            playingList[music.src] = [source, gainNode, pannerNode, music.volume, music.regex_end, music.regex, music.type];
            console.log("playingList", playingList);
        }
    }

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
                    default:
                        fadeOut = 1; // Default fade-out
                }
                
                // Use the new cleanup function
                pauseWithFadeOutAndCleanup(item, fadeOut);
                
                // Remove from the list immediately
                delete playingList[key];
            }
        }
    }
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
            console.log(`Cleaning up audio source: ${key}`);
            _cleanupAudioNodes(...playingList[key]);
        }
    }

    // Reset tracking objects
    playingList = {};
    sourceisPlaying = {};
    sfxWaitCount = 0;
    console.log("All audio stopped and resources cleared.");
}

function isSfxWaitPlaying() {
    return sfxWaitCount > 0;
}

export {
    playList,
    stopAllAudio,
    playingList,
    sourceisPlaying,
    isSfxWaitPlaying,
};

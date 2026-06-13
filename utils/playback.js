import { extension_settings } from "../../../../extensions.js";
import { extensionName } from './config.js';
import { getAudioContext, musicGainNode, ambianceGainNode, sfxGainNode, sfx_waitGainNode, voiceGainNode, masterGainNode } from './audio-context.js';
import { loadAudio } from './audio-cache.js';
import { createPlaybackChain } from './playback-node-manager.js';
import { shouldUseHtml5Fallback, createHtml5Chain } from './html5-fallback.js';
import { floatBallStateManager } from "./ui-float-ball.js";
import { stopOfflineAudio } from './offline-renderer.js';
import {
    parseAutoVibrationString,
    setupAutoVibrationTap,
    startAutoVibration,
} from './auto-vibration.js';


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
let voiceCount = 0;
let vibrationTimeouts = {};
let vibrationAnalysis = {}; // Stores animation frame IDs for volume analysis
let activeAnimations = {}; // To store animation state for each sound

function isSessionActive(playbackSessionId) {
    if (!Number.isFinite(playbackSessionId)) {
        return true;
    }
    const checker = window.isImmersiveSoundSessionActive;
    if (typeof checker !== 'function') {
        return true;
    }
    return checker(playbackSessionId);
}

function abortPendingPlayback(music, chainWrapper) {
    try {
        if (chainWrapper && typeof chainWrapper.dispose === 'function') {
            chainWrapper.dispose();
        }
    } catch (error) {
        console.warn(`[st-immersive-sound] 清理未启动播放链失败: ${music?.src || 'unknown'}`, error);
    }

    if (music?.src && playingList[music.src]) {
        delete playingList[music.src];
    }
}

/**
 * 计算用于推算「朗读速度」的有效文本长度。
 *
 * 光标 collectCharacterPositions 扫描的是 **DOM 字符**，所以分母必须用
 * DOM 上这段音频覆盖的字符数，即 `regex_end - regex + 1`；
 * 只有在没有 DOM 锚点时才退回到 `text.length`。
 *
 * 为什么不再直接用 `music.text.length`？
 *   - 人物 TTS / BGM VOICE：`text` 与 DOM 原文高度一致，两者差别可忽略。
 *   - 旁白（Nimo / Edge）：`text` 来自 cleanedMesText（正则清洗后的 LLM 文本），
 *     与 DOM 的换行/空白规整程度不一样，`text.length` 经常 > DOM 区间长度，
 *     导致 CPM 偏高、光标比音频跑得快，下一条音频的 `regex` 还没念完就被撞进去。
 */
function getSpeedTextLen(music) {
    if (music && typeof music === 'object'
        && typeof music.regex === 'number'
        && typeof music.regex_end === 'number'
        && music.regex_end >= music.regex) {
        return music.regex_end - music.regex + 1;
    }
    if (music && typeof music === 'object' && Number.isFinite(music.speedTextLen) && music.speedTextLen > 0) {
        return music.speedTextLen;
    }
    const text = (music && typeof music === 'object') ? music.text : music;
    return text ? String(text).length : 0;
}

function logVoiceAlignmentDebug(phase, music, marker, extra = {}) {
    if (!music || music.type !== 'VOICE') return;

    const rangeStart = Number.isFinite(music.regex_start) ? music.regex_start : music.regex;
    const rangeEnd = Number.isFinite(music.regex_end) ? music.regex_end : music.regex;
    const markerSnapshot = marker && typeof marker.getDebugCursorSnapshot === 'function'
        ? marker.getDebugCursorSnapshot(12)
        : null;
    const markerChar = markerSnapshot
        ? {
            index: markerSnapshot.index,
            globalIndex: markerSnapshot.globalIndex,
            char: markerSnapshot.char,
            context: markerSnapshot.context,
            contextStartGlobalIndex: markerSnapshot.contextStartGlobalIndex,
            contextEndGlobalIndex: markerSnapshot.contextEndGlobalIndex,
        }
        : null;
    const ttsStartChar = marker && typeof marker.getCharDataByGlobalIndex === 'function'
        ? marker.getCharDataByGlobalIndex(rangeStart)
        : null;
    const ttsEndChar = marker && typeof marker.getCharDataByGlobalIndex === 'function'
        ? marker.getCharDataByGlobalIndex(rangeEnd)
        : null;
    const ttsSlice = marker && typeof marker.getTextSliceByGlobalRange === 'function'
        ? marker.getTextSliceByGlobalRange(rangeStart, rangeEnd)
        : null;
    const markerGlobalIndex = markerChar?.globalIndex;
    const markerIndex = markerChar?.index;
    const markerTextChar = markerChar?.char;
    const markerContext = markerChar?.context;
    const startChar = ttsStartChar?.char;
    const endChar = ttsEndChar?.char;
    const rangeText = ttsSlice?.text;
    const deltaToStart = Number.isFinite(markerGlobalIndex) && Number.isFinite(rangeStart)
        ? markerGlobalIndex - rangeStart
        : null;
    const deltaToEnd = Number.isFinite(markerGlobalIndex) && Number.isFinite(rangeEnd)
        ? markerGlobalIndex - rangeEnd
        : null;

    console.log(`[ST-IS TTS-ALIGN] ${phase}`, {
        src: music.src,
        speaker: music.speaker,
        markerIndex,
        markerGlobalIndex,
        markerChar: markerTextChar,
        markerContext,
        ttsRegex: music.regex,
        ttsRangeStart: rangeStart,
        ttsRangeEnd: rangeEnd,
        ttsStartArrIndex: ttsStartChar?.index,
        ttsEndArrIndex: ttsEndChar?.index,
        ttsStartChar: startChar,
        ttsEndChar: endChar,
        deltaToStart,
        deltaToEnd,
        ttsRangeText: rangeText,
        musicText: music.text,
        ...extra,
    });

    console.log(
        `[ST-IS TTS-ALIGN] ${phase} summary | src=${music.src} | marker[idx=${markerIndex}, global=${markerGlobalIndex}, char=${JSON.stringify(markerTextChar)}, deltaStart=${deltaToStart}, deltaEnd=${deltaToEnd}] | tts[start=${rangeStart}, end=${rangeEnd}, startChar=${JSON.stringify(startChar)}, endChar=${JSON.stringify(endChar)}] | markerContext=${JSON.stringify(markerContext)} | ttsText=${JSON.stringify(rangeText)} | musicText=${JSON.stringify(music.text)}`
    );
}

function pauseWithFadeOutAndCleanup(item, fadeOutDuration = 1, key, marker = null) {
    if (!item || !item.source) {
        console.warn("pauseWithFadeOutAndCleanup called with invalid item for key:", key);
        return;
    }
    const { source, gainNode, analyserNode, animationFrameId, chainWrapper, autoVibHandle, autoVibTap } = item;
    const now = getAudioContext().currentTime;

    // 🩹 在覆盖 onstop 之前，先同步执行 VOICE/SFX_WAIT 的计数器递减与 CPM 恢复逻辑。
    // pauseWithFadeOutAndCleanup 路径（光标越过 regex_end / stopAudioByKey）不走原 onstop，
    // 如果不在这里补偿，sfxWaitCount/voiceCount 会永远不递减，CPM 永远回不到 readingSpeed。
    if (item.type === 'SFX_WAIT' || item.type === 'VOICE') {
        sfxWaitCount--;
        console.log(`[st-immersive-sound] pauseWithFadeOutAndCleanup: ${item.type} "${key}" sfxWaitCount-- → ${sfxWaitCount}`);
        if (sfxWaitCount <= 0) {
            sfxWaitCount = 0; // 防止负数
            if (marker && typeof marker.setSpeed === 'function') {
                marker.setSpeed(extension_settings[extensionName].readingSpeed);
                console.log(`[st-immersive-sound] pauseWithFadeOutAndCleanup: CPM 恢复为 ${extension_settings[extensionName].readingSpeed}`);
            }
        }
    }
    if (item.type === 'VOICE') {
        voiceCount--;
        console.log(`[st-immersive-sound] pauseWithFadeOutAndCleanup: VOICE "${key}" voiceCount-- → ${voiceCount}`);
        if (voiceCount <= 0) {
            voiceCount = 0;
            duckExistingMusic(false);
        }
    }

    // Stop the Tone.Player's onstop callback from firing.
    source.onstop = () => {};

    // Stop spatial animation loop
    if (activeAnimations[key]) {
        activeAnimations[key].isAnimating = false;
        cancelAnimationFrame(activeAnimations[key].animationFrameId);
        delete activeAnimations[key];
    }

    // Stop auto vibration (new path)
    if (autoVibHandle) {
        try { autoVibHandle.stop(); } catch (e) {}
    }
    if (autoVibTap) {
        try { autoVibTap.disconnect(); } catch (e) {}
    }

    // Stop volume analysis loop (legacy fields, kept for safety)
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    if (vibrationAnalysis[key]) {
        delete vibrationAnalysis[key];
    }

    // Schedule the fade-out on the native GainNode
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + fadeOutDuration);

  //  console.log("[st-immersive-sound] Fading out and scheduling cleanup for", key);

    // Stop looping vibration if any
    if (key && vibrationTimeouts[key]) {
        clearTimeout(vibrationTimeouts[key]);
        delete vibrationTimeouts[key];
        if (navigator.vibrate) {
            navigator.vibrate(0); // Stop vibration immediately
        }
      //  console.log(`[st-immersive-sound] Stopped looping vibration for ${key}`);
    }

    // Schedule the source to stop playing after the fade-out.
    source.stop(now + fadeOutDuration);

    // After fade-out, dispose the entire chain and disconnect the native nodes.
    setTimeout(() => {
        console.log(`[st-immersive-sound] Cleaning up resources for ${key}`);
        if (Object.keys(playingList).length === 0) {
            floatBallStateManager.setPlaying(false);
        }
        if (chainWrapper && typeof chainWrapper.dispose === 'function') {
            chainWrapper.dispose();
        }
        // Disconnect the remaining native nodes
        try {
            gainNode.disconnect();
            if (analyserNode) {
                analyserNode.disconnect();
            }
        } catch (e) {
            console.warn(`[st-immersive-sound] Error disconnecting native nodes for ${key}:`, e);
        }
}, (fadeOutDuration + 0.5) * 1000);
}

function duckExistingMusic(shouldDuck) {
    const settings = extension_settings[extensionName];
    if (!settings.voiceDuckingEnabled) return;

    const fadeTime = settings.voiceDuckingFadeTime;
    const duckingMultiplier = 1 - (settings.voiceDuckingPercentage / 100);
    const now = getAudioContext().currentTime;

    for (const key in playingList) {
        const item = playingList[key];
        if (item && item.type === 'Music') {
            const targetVolume = shouldDuck ? item.baseVolume * duckingMultiplier : item.baseVolume;
            
            if (Math.abs(item.gainNode.gain.value - targetVolume) > 0.01) {
                item.gainNode.gain.cancelScheduledValues(now);
                // By setting the value at the current time, we anchor the start of the ramp
                // to the current gain value, preventing a "click" from a sudden jump.
                item.gainNode.gain.setValueAtTime(item.gainNode.gain.value, now);
                item.gainNode.gain.linearRampToValueAtTime(targetVolume, now + fadeTime);
                console.log(`[st-immersive-sound] ${shouldDuck ? 'Ducking' : 'Unducking'} existing music ${key} to ${targetVolume.toFixed(2)}`);
            }
        }
    }
}

function buildStaticSpatialSettings(typeKey) {
    return {
        points: [{
            x: extension_settings[extensionName][`${typeKey}_posX`],
            y: extension_settings[extensionName][`${typeKey}_posY`],
            z: extension_settings[extensionName][`${typeKey}_posZ`],
            speedToNext: 1,
            dwellTime: 0
        }],
        params: {
            distanceModel: 'inverse',
            refDistance: extension_settings[extensionName][`${typeKey}_refDistance`],
            maxDistance: extension_settings[extensionName][`${typeKey}_maxDistance`],
            rolloffFactor: extension_settings[extensionName][`${typeKey}_rolloffFactor`],
            coneInnerAngle: 360,
            coneOuterAngle: 360,
            coneOuterGain: 0
        }
    };
}

function resolveSpatialProfile(allProcessorSettings, music, fallbackSpatialSettings = null) {
    let spatialProfile = null;
    if (typeof music.spatial === 'string' && music.spatial) {
        spatialProfile = allProcessorSettings?.spatialProfiles[music.spatial];
    } else if (typeof music.spatial === 'object' && music.spatial !== null) {
        spatialProfile = music.spatial;
    }

    return spatialProfile || fallbackSpatialSettings || allProcessorSettings?.spatialProfiles['正前方站立'];
}

function getRelativeVolumeBase(musicList) {
    if (!Array.isArray(musicList) || musicList.length === 0) {
        return 100;
    }

    const maxVolume = musicList.reduce((max, item) => {
        const volume = Number(item?.volume ?? 100);
        if (!Number.isFinite(volume)) {
            return max;
        }
        return Math.max(max, volume);
    }, 0);

    return maxVolume > 0 ? maxVolume : 100;
}

async function playList(currentGlobalCharIndex, musicList, marker, playbackSessionId) {
    let index = 0;
    let triggeredAudio = null;
    const relativeVolumeBase = getRelativeVolumeBase(musicList);

    // 🔒 入口预暂停：只要本次调用里存在「尚未在 playingList 中、且命中当前光标位置」
    // 的 VOICE / SFX_WAIT，就立刻 pause marker，避免后续 Music/Ambiance 分支的
    // await（shouldUseHtml5Fallback / loadAudio / createPlaybackChain）让出事件循环
    // 期间，rAF 继续推进光标 → 等到 for 循环迭代到 VOICE 时光标已抢跑数个字。
    if (marker && marker.isPlaying) {
        const __hasPendingVoice = musicList.some(m =>
            m && (m.type === 'VOICE' || m.type === 'SFX_WAIT') &&
            !playingList.hasOwnProperty(m.src) &&
            (
                (Number.isFinite(m.regex_start) && Number.isFinite(m.regex_end) &&
                 m.regex_start <= currentGlobalCharIndex && m.regex_end >= currentGlobalCharIndex)
                || m.regex == currentGlobalCharIndex
            )
        );
        if (__hasPendingVoice) {
            marker.pause();
            marker.__pausedForVoiceEntry = true;
            console.log(
                `[IS-TIMING] playList 入口预暂停 marker | currentIndex=${marker.currentIndex} globalIndex=${currentGlobalCharIndex}`
            );
        }
    }


    for (let key in playingList) {
        if (playingList.hasOwnProperty(key)) {
            let item = playingList[key];
            
            // Condition to stop: regex has an end point, and the cursor is past it.
            if (Number.isFinite(item.regex_end) && item.regex_end < currentGlobalCharIndex) {
                console.log(`[st-immersive-sound] ${key} playback scope ended, starting cleanup.`);
                
                let fadeOut;
                switch (item.type) { // Accessing 'type' property from the object
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
                
                pauseWithFadeOutAndCleanup(item, fadeOut, key, marker);
                delete playingList[key];
            }
        }
    }


    for (let i = index; i < musicList.length; i++) {
        let music = musicList[i];

        if(0==music.regex){
            music.regex=1;
        }

        const isSFXNonLoop = music.type === 'SFX' && !music.loop;
        const isMatch = isSFXNonLoop
            ? ((music.regex_start ?? music.regex) == currentGlobalCharIndex)
            : ((music.regex_start <= currentGlobalCharIndex && music.regex_end > currentGlobalCharIndex) || music.regex == currentGlobalCharIndex);

        if (!playingList.hasOwnProperty(music.src) && isMatch) {
            triggeredAudio = music;
            playingList[music.src] = {}; // Placeholder

            // 🔧 防止「首句光标跑在音频前面」：
            // 对 VOICE/SFX_WAIT 类型，光标已在 playList 入口被预暂停（见函数顶部的
            // __pausedForVoiceEntry 逻辑）；这里只负责接管 resume 时机：等播放链建好、
            // ctx 恢复 running 后再 marker.resume()。
            const __isVoiceLike = (music.type === 'VOICE' || music.type === 'SFX_WAIT');
            const __needPauseMarker = !!(
                marker && __isVoiceLike &&
                (marker.__pausedForVoiceEntry || marker.isPlaying)
            );

            // 🩺 首播诊断：用 performance.now() 打一串时间戳，定位"光标已放行但还没出声"的瓶颈。
            // 只对 VOICE / SFX_WAIT（会牵动光标）记录，避免 Music/Ambiance 刷屏。
            const __dbgEnabled = __isVoiceLike;
            const __dbgT0 = __dbgEnabled ? performance.now() : 0;
            const __dbgMark = (label, extra) => {
                if (!__dbgEnabled) return;
                const dt = (performance.now() - __dbgT0).toFixed(1);
                const ctx = getAudioContext();
                const ctxInfo = ctx
                    ? `ctx.state=${ctx.state} ctx.t=${ctx.currentTime.toFixed(3)}`
                    : 'ctx=null';
                console.log(
                    `[IS-TIMING] ${music.type} "${music.src}" +${dt}ms | ${label} | ${ctxInfo}`,
                    extra !== undefined ? extra : ''
                );
            };

            if (__needPauseMarker) {
                if (marker.isPlaying) {
                    // 兜底：如果不是从入口预暂停进来的（例如中途插入的 VOICE），现在补一次 pause。
                    marker.pause();
                    __dbgMark('marker.pause()（分支内补暂停）', {
                        currentIndex: marker.currentIndex,
                        regex: music.regex,
                    });
                } else {
                    __dbgMark('marker 已在 playList 入口被预暂停', {
                        currentIndex: marker.currentIndex,
                        regex: music.regex,
                        pausedForVoiceEntry: !!marker.__pausedForVoiceEntry,
                    });
                }
            } else {
                __dbgMark('进入播放分支（无需暂停光标）', {
                    markerIsPlaying: !!(marker && marker.isPlaying),
                });
            }

            // Size gate: 大体积音频走 HTML5 回退，不挂效果器。
            const { useHtml5: __useHtml5 } = await shouldUseHtml5Fallback(music.url);
            __dbgMark('shouldUseHtml5Fallback 完成', { useHtml5: __useHtml5 });

            // loadAudio now returns an AudioBuffer. music.url will either be a real URL
            // for static files or a cacheKey (e.g., "tts-...") for voice audio.
            // The loadAudio function handles both cases.
            const audioBuffer = __useHtml5 ? null : await loadAudio(music.url, music.src);
            __dbgMark('loadAudio 完成', {
                hasBuffer: !!audioBuffer,
                duration: audioBuffer ? audioBuffer.duration.toFixed(3) + 's' : 'n/a',
            });

            if (!__useHtml5 && !audioBuffer) {
                console.error("[st-immersive-sound] Failed to load audio buffer for " + music.src);
                delete playingList[music.src];
                if (__needPauseMarker) {
                    if (marker) marker.__pausedForVoiceEntry = false;
                    marker.resume();
                }
                continue;
            }

            // Build chain first so we can read duration for html5 fallback as well.
            const allProcessorSettings = extension_settings[extensionName].effectsProcessor;
            let chainWrapper;
            if (__useHtml5) {
                try {
                    chainWrapper = await createHtml5Chain({
                        url: music.url,
                        loop: !!music.loop,
                        audioContext: getAudioContext(),
                    });
                } catch (e) {
                    console.error(`[st-immersive-sound] html5 fallback failed for ${music.src}:`, e);
                    delete playingList[music.src];
                    if (__needPauseMarker) {
                        if (marker) marker.__pausedForVoiceEntry = false;
                        marker.resume();
                    }
                    continue;
                }
            } else {
                let chainSettings;
                const typeKey = music.type.toLowerCase();

                if (music.type === 'Music' || music.type === 'Ambiance') {
                    const staticSpatialSettings = buildStaticSpatialSettings(typeKey);
                    const hasCustomProcessing = !!(music.special_effects || music.ir_description || music.spatial);

                    if (!hasCustomProcessing) {
                        chainSettings = {
                            type: music.type,
                            audioBuffer: audioBuffer,
                            loop: music.loop,
                            compressor: null,
                            effects: null,
                            ir: null,
                            spatial: staticSpatialSettings
                        };
                    } else {
                        chainSettings = {
                            type: music.type,
                            audioBuffer: audioBuffer,
                            loop: music.loop,
                            compressor: null,
                            effects: allProcessorSettings?.effectsProfiles[music.special_effects] || allProcessorSettings?.effectsProfiles['默认'],
                            ir: allProcessorSettings?.irProfiles[music.ir_description] || allProcessorSettings?.irProfiles['默认 (无)'],
                            spatial: resolveSpatialProfile(allProcessorSettings, music, staticSpatialSettings)
                        };
                    }
                } else { // For SFX, VOICE, SFX_WAIT
                    chainSettings = {
                        type: music.type,
                        audioBuffer: audioBuffer,
                        loop: music.loop,
                        compressor: allProcessorSettings?.compressorProfiles[allProcessorSettings.currentCompressorProfile],
                        effects: allProcessorSettings?.effectsProfiles[music.special_effects] || allProcessorSettings?.effectsProfiles['默认'],
                        ir: allProcessorSettings?.irProfiles[music.ir_description] || allProcessorSettings?.irProfiles['默认 (无)'],
                        spatial: resolveSpatialProfile(allProcessorSettings, music)
                    };
                }

                chainWrapper = await createPlaybackChain(chainSettings);
            }
            __dbgMark('播放链构建完成', {
                useHtml5: __useHtml5,
                hasPlayer: !!(chainWrapper && chainWrapper.player),
                hasOutput: !!(chainWrapper && chainWrapper.output),
            });

            if (!chainWrapper) {
                console.error(`[st-immersive-sound] Failed to create playback chain for ${music.src}`);
                delete playingList[music.src];
                if (__needPauseMarker) {
                    if (marker) marker.__pausedForVoiceEntry = false;
                    marker.resume();
                }
                continue;
            }

            const nowMusicSeconds = audioBuffer
                ? audioBuffer.duration
                : (chainWrapper.player?.buffer?.duration || 0);

            // 🔧 首次播放专属问题：AudioContext 可能处于 'suspended'（autoplay 策略 / 刚创建）。
            // 此时 audioContext.currentTime 不前进，player.start(now) 实际不会立刻发声；
            // 但 marker.resume() 用的是 performance.now()（墙钟，从不暂停），光标会"偷跑"。
            // 在恢复光标前先 await context.resume()，对已经 running 的上下文是 ~0ms no-op，
            // 对 suspended 的则等到真正 running 才放行。
            try {
                const __ctx = getAudioContext();
                const __stateBefore = __ctx ? __ctx.state : 'null';
                if (__ctx && __ctx.state !== 'running') {
                    __dbgMark('ctx.resume() 前', { stateBefore: __stateBefore });
                    await __ctx.resume();
                    __dbgMark('ctx.resume() 后', { stateAfter: __ctx.state });
                } else {
                    __dbgMark('ctx 已 running，跳过 resume', { state: __stateBefore });
                }
            } catch (e) {
                __dbgMark('ctx.resume() 异常', { err: e && e.message });
            }

            if (!isSessionActive(playbackSessionId)) {
                abortPendingPlayback(music, chainWrapper);
                return triggeredAudio;
            }

            // ⚠️ 关键顺序：在 setSpeedByDuration 之前恢复 marker。
            // 原因：CharacterReadingMarker.setSpeed() 只在 isPlaying=true 时重写 startTime，
            //       否则只改 delay，会导致 (elapsed / newDelay) 计算出远小于 currentIndex 的
            //       expectedIndex，光标卡在 music.regex 处直到 elapsed 赶上（整段音频都不动）。
            //       先 resume → setSpeedByDuration 走 isPlaying 分支 → startTime 被正确锚定到
            //       当前 currentIndex 与新 delay，之后光标才会与音频同步前进。
            if (__needPauseMarker) {
                marker.__pausedForVoiceEntry = false;
                marker.resume();
                __dbgMark('marker.resume()（光标已放行）', {
                    currentIndex: marker.currentIndex,
                });
                // 🩹 首播静音兜底：player.start() 即将延后一个小的启动提前量，
                //    让 Tone.Player 真正接上输出后再发声；这里把光标也按同样的提前量
                //    重新锚定，避免首句文字比声音快半拍。
                try {
                    const __ctxLead = getAudioContext();
                    const __baseLatency = Number(__ctxLead?.baseLatency) || 0;
                    const __outputLatency = Number(__ctxLead?.outputLatency) || 0;
                    const __startLeadTime = Math.min(
                        Math.max(__baseLatency + (__outputLatency || __baseLatency), 0.03),
                        0.08
                    );
                    if (__startLeadTime > 0 && typeof marker.reanchorRealtime === 'function') {
                        marker.reanchorRealtime(
                            marker.currentIndex,
                            performance.now() + __startLeadTime * 1000
                        );
                        __dbgMark('marker 按音频启动提前量重新锚定', {
                            currentIndex: marker.currentIndex,
                            startLeadMs: (__startLeadTime * 1000).toFixed(1),
                        });
                    }
                } catch (e) {
                    __dbgMark('marker 启动提前锚定失败（已忽略）', { err: e && e.message });
                }
            }

            let typeGainNode;
            let fadeIn;

            switch (music.type) {
                case "Music":
                    typeGainNode = musicGainNode;
                    fadeIn = extension_settings[extensionName].musicFadeIn ?? 3;
                    break;
                case "Ambiance":
                    typeGainNode = ambianceGainNode;
                    fadeIn = extension_settings[extensionName].ambianceFadeIn ?? 3;
                    break;
                case "SFX":
                    typeGainNode = sfxGainNode;
                    fadeIn = extension_settings[extensionName].sfxFadeIn ?? 0.1;
                    break;
                case "SFX_WAIT":
                    typeGainNode = sfx_waitGainNode;
                    fadeIn = extension_settings[extensionName].sfx_waitFadeIn ?? 0.1;
                    if (marker && (marker.isPlaying || __needPauseMarker)) {
                        marker.setSpeedByDuration(getSpeedTextLen(music), nowMusicSeconds);
                    }
                    sfxWaitCount++;
                    break;
                case "VOICE":
                    typeGainNode = voiceGainNode;
                    fadeIn = extension_settings[extensionName].voiceFadeIn ?? 0.1;

                    if (voiceCount === 0) {
                        duckExistingMusic(true);
                    }
                    voiceCount++;

                    if (marker && (marker.isPlaying || __needPauseMarker)) {
                        console.log("marker is playing",music.text);
                        marker.setSpeedByDuration(getSpeedTextLen(music), nowMusicSeconds);
                    }
                    logVoiceAlignmentDebug('START', music, marker, {
                        audioDuration: nowMusicSeconds,
                        speedTextLen: getSpeedTextLen(music),
                        markerIsPlaying: !!marker?.isPlaying,
                    });
                    sfxWaitCount++;
                    break;
            }

            const { player, output, panner, pathPoints } = chainWrapper;

            // Create a dedicated gain node for this sound
            const gainNode = getAudioContext().createGain();
            const baseVolume = (Number(music.volume ?? 100) / relativeVolumeBase);

            let targetVolume = baseVolume;
            const settings = extension_settings[extensionName];
            if (music.type === 'Music' && settings.voiceDuckingEnabled && voiceCount > 0) {
                const duckingMultiplier = 1 - (settings.voiceDuckingPercentage / 100);
                targetVolume = baseVolume * duckingMultiplier;
                console.log(`[st-immersive-sound] Starting music ${music.src} in ducked state.`);
            }

            gainNode.gain.value = 0; // Start at 0 for fade-in

            // Connect the end of the Tone.js chain to our native gain node
            output.connect(gainNode);

            // 对于 HTML5 回退链：把 (track * type * master) 同步到 audioEl.volume，
            // 修复 iOS/WebKit 下 MediaElementSource 无法真正路由音频导致 UI 音量失效的问题。
            if (chainWrapper.isHtml5Fallback && typeof chainWrapper.attachVolumeChain === 'function') {
                chainWrapper.attachVolumeChain({
                    trackGainNode: gainNode,
                    typeGainNode,
                    masterGainNode,
                });
            }
            
            // Auto Vibration Logic
            // 主信号链始终是 gainNode → typeGainNode；analyser 只以旁路方式读取，不影响音频。
            gainNode.connect(typeGainNode);

            let autoVibHandle = null;
            let autoVibTap = null;
            if (extension_settings[extensionName].enable_vibration && typeof music.vibration === 'string' && music.vibration.startsWith('auto')) {
                autoVibTap = setupAutoVibrationTap(getAudioContext(), gainNode);
                const autoParams = parseAutoVibrationString(music.vibration);
                autoVibHandle = startAutoVibration(
                    autoVibTap.analyserNode,
                    autoParams,
                    () => !!playingList[music.src],
                );
            }

            // 保留 analyserNode 字段以兼容原有清理路径中的 destructure；此处不再使用独立的 animationFrameId。
            const analyserNode = autoVibTap ? autoVibTap.analyserNode : null;
            const animationFrameId = null;

            const cursrc = music.src;
            player.onstop = () => {
                sourceisPlaying[cursrc] = false;
                if (music.type === "SFX_WAIT" || music.type === "VOICE") {
                    sfxWaitCount--;
                    if (sfxWaitCount === 0 && marker) {
                        marker.setSpeed(extension_settings[extensionName].readingSpeed);
                    }
                }

                if (music.type === "VOICE") {
                    voiceCount--;
                    if (voiceCount === 0) {
                        duckExistingMusic(false);
                    }
                }

                const item = playingList[cursrc];
                if (item && !item.source.loop) {
                  //  console.log(`[st-immersive-sound] Naturally ended sound cleanup: ${cursrc}`);
                    const endIndex = item.regex_end ?? item.regex;
                    logVoiceAlignmentDebug('END', music, marker, {
                        endIndex,
                        markerCurrentIndex: marker?.currentIndex,
                        remainingPlayingCount: Object.keys(playingList).length,
                    });
                    if (item.chainWrapper) item.chainWrapper.dispose();
                    try {
                        if (item.autoVibHandle) item.autoVibHandle.stop();
                        if (item.autoVibTap) item.autoVibTap.disconnect();
                    } catch(e) {}
                    try {
                        if (item.gainNode) item.gainNode.disconnect();
                        if (item.analyserNode) item.analyserNode.disconnect();
                    } catch(e) {}

                    if (vibrationTimeouts[cursrc]) clearTimeout(vibrationTimeouts[cursrc]);
                    if (vibrationAnalysis[cursrc]) cancelAnimationFrame(vibrationAnalysis[cursrc].animationFrameId);
                    
                    delete vibrationTimeouts[cursrc];
                    delete vibrationAnalysis[cursrc];
                    delete playingList[cursrc];

                    if (
                        marker &&
                        (music.type === "SFX_WAIT" || music.type === "VOICE") &&
                        Number.isFinite(endIndex) &&
                        !isSfxWaitPlaying() &&
                        !marker.hasFutureAudioAfter(endIndex)
                    ) {
                        marker.syncToGlobalIndex(endIndex);
                        if (marker.finishIfDone(endIndex)) {
                            return;
                        }
                    }

                    if (Object.keys(playingList).length === 0) {
                        floatBallStateManager.setPlaying(false);
                    }
                }
            };

            // Vibration Logic (Pattern-based)
            if (extension_settings[extensionName].enable_vibration && music.vibration && music.vibration !== 'N/A' && !String(music.vibration).startsWith('auto')) {
                // This logic remains the same as before
                const vibrationProfiles = extension_settings[extensionName].vibration_profiles || {};
                let pattern;
                if (typeof music.vibration === 'string' && music.vibration.trim().startsWith('[')) {
                    try { pattern = JSON.parse(music.vibration); } catch (e) { pattern = null; }
                } else {
                    pattern = vibrationProfiles[music.vibration];
                }
                if (Array.isArray(pattern) && pattern.length > 0 && navigator.vibrate) {
                    const vibrationType = pattern[0];
                    const actualPattern = pattern.slice(1);
                    if (vibrationType === 0) {
                        navigator.vibrate(actualPattern);
                    } else if (vibrationType === 1 && actualPattern.length > 0) {
                        const duration = actualPattern.reduce((a, b) => a + b, 0);
                        if (duration > 0) {
                            if (vibrationTimeouts[music.src]) clearTimeout(vibrationTimeouts[music.src]);
                            const vibrateLoop = () => {
                                navigator.vibrate(actualPattern);
                                vibrationTimeouts[music.src] = setTimeout(vibrateLoop, duration);
                            };
                            vibrateLoop();
                        }
                    }
                }
            }

            // Use the adapted playWithFadeIn logic directly
            // 🩹 首播静音兜底：给 Tone.Player 一个小的启动提前量（30~80ms），
            //    避免首次 resume() 后立即贴 currentTime 启动导致整段“按时结束但没真正出声”。
            const __ctx3 = getAudioContext();
            const now = __ctx3.currentTime;
            const baseLatency = Number(__ctx3.baseLatency) || 0;
            const outputLatency = Number(__ctx3.outputLatency) || 0;
            const startLeadTime = Math.min(
                Math.max(baseLatency + (outputLatency || baseLatency), 0.03),
                0.08
            );
            const scheduleAt = now + startLeadTime;
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.setValueAtTime(0, scheduleAt);
            gainNode.gain.linearRampToValueAtTime(targetVolume, scheduleAt + fadeIn);

            // 🩺 在 player.start 前挂一个诊断 AnalyserNode，探测 "声卡真正开始出声" 的时间点。
            // 取样点在 output（Tone 链末端）之后、但在 fade-in gainNode 之前，避免 fade-in 的渐入把
            // 判据拉高；这里只做 ~2s 的轻量轮询，命中或超时即自动解除。
            let __dbgFirstAudibleAnalyser = null;
            let __dbgFirstAudibleRaf = 0;
            if (__dbgEnabled) {
                try {
                    const __ctx2 = getAudioContext();
                    __dbgFirstAudibleAnalyser = __ctx2.createAnalyser();
                    __dbgFirstAudibleAnalyser.fftSize = 256;
                    output.connect(__dbgFirstAudibleAnalyser);
                    const __probe = new Float32Array(__dbgFirstAudibleAnalyser.fftSize);
                    const __probeStart = performance.now();
                    const __tick = () => {
                        if (!__dbgFirstAudibleAnalyser) return;
                        __dbgFirstAudibleAnalyser.getFloatTimeDomainData(__probe);
                        let peak = 0;
                        for (let k = 0; k < __probe.length; k++) {
                            const v = Math.abs(__probe[k]);
                            if (v > peak) peak = v;
                        }
                        if (peak > 0.001) {
                            __dbgMark('声卡首个非静音样本', {
                                peak: peak.toFixed(4),
                                sinceStart: (performance.now() - __probeStart).toFixed(1) + 'ms',
                            });
                            try { output.disconnect(__dbgFirstAudibleAnalyser); } catch (_) {}
                            __dbgFirstAudibleAnalyser = null;
                            return;
                        }
                        if (performance.now() - __probeStart > 2000) {
                            __dbgMark('声卡出声探测超时（2s 内仍静音）', { lastPeak: peak.toFixed(4) });
                            try { output.disconnect(__dbgFirstAudibleAnalyser); } catch (_) {}
                            __dbgFirstAudibleAnalyser = null;
                            return;
                        }
                        __dbgFirstAudibleRaf = requestAnimationFrame(__tick);
                    };
                    __dbgFirstAudibleRaf = requestAnimationFrame(__tick);
                } catch (e) {
                    __dbgMark('挂接首声探测 Analyser 失败', { err: e && e.message });
                }
            }

            __dbgMark('player.start() 前', {
                scheduledAt: scheduleAt.toFixed(3),
                fadeIn,
                targetVolume,
                startLeadMs: (startLeadTime * 1000).toFixed(1),
                bufferDuration: (chainWrapper.player?.buffer?.duration ?? audioBuffer?.duration ?? 0),
                baseLatency,
                outputLatency,
            });
            player.start(scheduleAt);
            __dbgMark('player.start() 已调用', {
                ctxNow: getAudioContext().currentTime.toFixed(3),
                scheduleDelta: (scheduleAt - getAudioContext().currentTime).toFixed(3) + 's',
            });
            sourceisPlaying[cursrc] = true;
            floatBallStateManager.setPlaying(true);

            // Start spatial animation if applicable
            if (panner && pathPoints && pathPoints.length > 1) {
                startSpatialAnimation(panner, pathPoints, cursrc);
            }

            playingList[music.src] = {
                source: player,
                gainNode,
                analyserNode,
                animationFrameId,
                autoVibHandle,
                autoVibTap,
                chainWrapper,
                regex_end: music.regex_end,
                regex: music.regex,
                type: music.type,
                baseVolume: baseVolume,
                text: music.text,
                startedAtMs: performance.now() + startLeadTime * 1000,
                durationMs: (chainWrapper.player?.buffer?.duration ?? audioBuffer?.duration ?? 0) * 1000,
            };
         //   console.log("playingList updated", playingList[music.src]);
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

    // Stop any offline rendered audio that might be playing
    stopOfflineAudio();

    floatBallStateManager.setPlaying(false);

    // Stop and completely clean up all playing audio sources
    console.log("Stopping all audio...");
    // Create a copy of the keys to iterate over, as stopAudioByKey modifies the playingList
    const keysToStop = Object.keys(playingList);
    for (const key of keysToStop) {
        // stopAudioByKey handles the call to pauseWithFadeOutAndCleanup and removal from playingList
        stopAudioByKey(key, 0.5);
    }

    // Stop all looping vibrations that might not have been associated with an item in playingList
    for (const key in vibrationTimeouts) {
        if (vibrationTimeouts.hasOwnProperty(key)) {
            clearTimeout(vibrationTimeouts[key]);
        }
    }
    if (navigator.vibrate) {
        navigator.vibrate(0); // Stop any active vibration
    }

    // Reset all tracking objects to a clean state as a final safeguard
    playingList = {};
    sourceisPlaying = {};
    sfxWaitCount = 0;
    voiceCount = 0;
    vibrationTimeouts = {};
    vibrationAnalysis = {}; // Ensure this is cleared as well
    
    // Stop all animations
    for (const key in activeAnimations) {
        if (activeAnimations.hasOwnProperty(key)) {
            activeAnimations[key].isAnimating = false;
            cancelAnimationFrame(activeAnimations[key].animationFrameId);
        }
    }
    activeAnimations = {};

    console.log("All audio stopped and resources cleared.");
}

function isSfxWaitPlaying() {
    return sfxWaitCount > 0;
}

function startSpatialAnimation(panner, pathPoints, key) {
    // Handle paths with 0 or 1 points
    if (pathPoints.length === 0) {
        return; // Nothing to do
    }
    if (pathPoints.length === 1) {
        const point = pathPoints[0];
        panner.positionX.value = point.x;
        panner.positionY.value = point.y;
        panner.positionZ.value = point.z;
        return;
    }

    const animationState = {
        isAnimating: true,
        animationFrameId: null,
        currentPointIndex: 0,
        segmentProgress: 0,
        lastTime: performance.now(),
        state: 'DWELLING', // 'DWELLING' or 'MOVING'
        dwellTimer: pathPoints[0].dwellTime || 0,
        currentSourcePosition: { ...pathPoints[0] }
    };
    activeAnimations[key] = animationState;

    // Set initial position
    panner.positionX.value = animationState.currentSourcePosition.x;
    panner.positionY.value = animationState.currentSourcePosition.y;
    panner.positionZ.value = animationState.currentSourcePosition.z;

    const animate = (currentTime) => {
        // Stop if the animation flag is false or the sound is no longer playing
        if (!animationState.isAnimating || !playingList[key]) {
            delete activeAnimations[key];
            return;
        }

        const deltaTime = (currentTime - animationState.lastTime) / 1000;
        animationState.lastTime = currentTime;

        if (animationState.state === 'DWELLING') {
            animationState.dwellTimer -= deltaTime;
            if (animationState.dwellTimer <= 0) {
                // Finished dwelling. Check if we are at the last point.
                if (animationState.currentPointIndex >= pathPoints.length - 1) {
                    animationState.isAnimating = false; // Animation ends after dwelling at the last point.
                    return;
                }
                // Not at the end, so start moving to the next point.
                animationState.state = 'MOVING';
                animationState.segmentProgress = 0;
            }
        } 
        
        if (animationState.state === 'MOVING') {
            const from = pathPoints[animationState.currentPointIndex];
            const to = pathPoints[animationState.currentPointIndex + 1];
            const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
            const segmentLength = Math.sqrt(dx*dx + dy*dy + dz*dz);
            const speed = from.speedToNext || 1;
            
            if (segmentLength > 0 && speed > 0) {
                animationState.segmentProgress += deltaTime / (segmentLength / speed);
            } else {
                animationState.segmentProgress = 1; // Instantly complete zero-length or zero-speed segments
            }

            if (animationState.segmentProgress >= 1) {
                // Arrived at the next point ('to')
                animationState.currentSourcePosition = { ...to };
                animationState.currentPointIndex++; // We are now at the point indexed by `currentPointIndex`
                
                // Start dwelling at the new point
                animationState.state = 'DWELLING';
                animationState.dwellTimer = pathPoints[animationState.currentPointIndex].dwellTime || 0;

            } else {
                // In transit
                const t = Math.min(animationState.segmentProgress, 1);
                animationState.currentSourcePosition.x = from.x + (to.x - from.x) * t;
                animationState.currentSourcePosition.y = from.y + (to.y - from.y) * t;
                animationState.currentSourcePosition.z = from.z + (to.z - from.z) * t;
            }
        }

        // Update panner position regardless of state
        // Use rampTo for smoother and more reliable updates in the audio thread
        const rampTime = 0.05; // A short ramp time to avoid clicks but still be responsive
        panner.positionX.rampTo(animationState.currentSourcePosition.x, rampTime);
        panner.positionY.rampTo(animationState.currentSourcePosition.y, rampTime);
        panner.positionZ.rampTo(animationState.currentSourcePosition.z, rampTime);

        if (animationState.isAnimating) {
            animationState.animationFrameId = requestAnimationFrame(animate);
            // Store the frame ID so we can cancel it
            if (activeAnimations[key]) {
                activeAnimations[key].animationFrameId = animationState.animationFrameId;
            }
        }
    };

    animationState.animationFrameId = requestAnimationFrame(animate);
    if (activeAnimations[key]) {
        activeAnimations[key].animationFrameId = animationState.animationFrameId;
    }
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
            playingList[key].animationFrameId = animationId;
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
    startVolumeAnalysis
};

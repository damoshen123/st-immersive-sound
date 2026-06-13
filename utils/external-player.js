// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { eventSource } from "../../../../../script.js";
import { extensionName, eventNames } from './config.js';
import { getAudioContext, musicGainNode, ambianceGainNode, sfxGainNode, voiceGainNode, masterGainNode } from './audio-context.js';
import { loadAudio } from './audio-cache.js';
import { createPlaybackChain } from './playback-node-manager.js';
import { shouldUseHtml5Fallback, createHtml5Chain } from './html5-fallback.js';
import { get_yin_xiao_world_info, search_yin_xiao_zi_yuan } from "./world-info.js";
import { initiateTtsRequest, getTtsItem, generateTtsCacheKey, getSpeakers } from "./tts-cache.js";
import { listAllSpeakers as listMinimaxSpeakers } from "./minimax-voices.js";
import { listEdgeSpeakers } from "./edge-tts.js";
import { listAllSpeakers as listNimoSpeakers } from "./nimo-voices.js";
import { parseVibrationValue } from './ui-vibration.js';
import {
    parseAutoVibrationString,
    setupAutoVibrationTap,
    startAutoVibration,
} from './auto-vibration.js';

// New event names for external player control
const EVT_EXTERNAL_AUDIO_PLAYING = eventNames.EXTERNAL_SOUND_PLAYING;
const EVT_EXTERNAL_AUDIO_PROGRESS = 'st-immersive-sound:external-audio-progress';
const EVT_EXTERNAL_AUDIO_CONTROL = 'st-immersive-sound:external-audio-control';

// 用于管理外部播放请求的独立列表
const externalPlayingList = {};
const vibrationTimeouts = {}; // To store vibration timeouts
let isPreviewLoading = false;
let activePreviewLoad = null;
let previewLoadSequence = 0;
const activeAnimations = {}; // To store animation state for each sound

const PREVIEW_LOAD_TIMEOUT_MS = 15000;

function withTimeout(promise, timeoutMs, message) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    });
}

function beginPreviewLoad(data) {
    const nextLoad = {
        token: ++previewLoadSequence,
        id: data.id,
        url: data.url || null,
    };

    if (activePreviewLoad && activePreviewLoad.id !== data.id) {
        eventSource.emit(eventNames.EXTERNAL_SOUND_STOPPED, {
            id: activePreviewLoad.id,
            url: activePreviewLoad.url,
        });
    }

    activePreviewLoad = nextLoad;
    isPreviewLoading = true;
    return nextLoad;
}

function isPreviewLoadActive(loadState) {
    return !!loadState && !!activePreviewLoad && activePreviewLoad.token === loadState.token;
}

function ensurePreviewLoadActive(loadState) {
    if (!isPreviewLoadActive(loadState)) {
        const error = new Error('预览加载已取消');
        error.name = 'PreviewLoadCancelledError';
        throw error;
    }
}

function finishPreviewLoad(loadState) {
    if (!isPreviewLoadActive(loadState)) {
        return;
    }

    activePreviewLoad = null;
    isPreviewLoading = false;
}

// Progress emitter has been removed based on user feedback to reduce console logs.
// Events are now only sent on start, stop, and seek.


/**
 * Handles control commands sent from external UIs.
 * @param {object} data The control command data.
 * @param {string} data.id The ID of the audio to control.
 * @param {string} data.command The command to execute (e.g., 'set_volume', 'seek').
 * @param {*} data.value The value for the command.
 */
async function handleExternalAudioControl({ id, command, value }) {
    const item = externalPlayingList[id];
    if (!item) {
        console.warn(`[External Player] Control command for non-existent ID: ${id}`);
        return;
    }

    console.log(`[External Player] Received control command for ID ${id}:`, { command, value });

    const gainNode = item.gainNode;

    switch (command) {
        case 'set_volume': {
            if (typeof value === 'number' && value >= 0 && value <= 100) {
                const newVolume = value / 100;
                if (item.is_preview) {
                    // For preview, volume is master * volume
                    gainNode.gain.value = masterGainNode.gain.value * newVolume;
                } else {
                    // For regular playback, volume is relative to its type gain
                    gainNode.gain.value = newVolume;
                }
                // Store the new base volume
                item.volume = value;
            }
            break;
        }

        case 'seek': {
            const wasPlaying = item.status === 'playing';

            // Handle preview mode (native AudioBufferSourceNode)
            if (item.is_preview && item.source) {
                const source = item.source;
                const buffer = source.buffer;
                const duration = buffer ? buffer.duration : 0;

                if (duration > 0 && typeof value === 'number' && value >= 0 && value < duration) {
                    source.onended = null;
                    try { source.stop(); } catch (e) { /* ignore */ }

                    const audioContext = getAudioContext();
                    const newSource = audioContext.createBufferSource();
                    newSource.buffer = buffer;
                    newSource.loop = source.loop;
                    newSource.connect(item.gainNode);
                    
                    item.source = newSource;
                    item.source.onended = () => cleanupAndNotify(id);
                    item.startOffset = value;
                    item.playbackStartTime = audioContext.currentTime;
                    
                    if (wasPlaying) {
                        newSource.start(0, value);
                        item.status = 'playing';
                    }
                    // Manually emit a progress event after seeking
                    eventSource.emit(EVT_EXTERNAL_AUDIO_PROGRESS, {
                        id: id,
                        currentTime: value,
                        duration: duration,
                    });
                } else {
                    console.warn(`[External Player] Invalid preview seek value: ${value}, duration: ${duration}`);
                }
            }
            // Handle html5 fallback (both preview and non-preview)
            else if (item.isHtml5Fallback && item.player && item.player._el) {
                const audioEl = item.player._el;
                const duration = audioEl.duration || 0;
                if (duration > 0 && typeof value === 'number' && value >= 0 && value < duration) {
                    try { audioEl.currentTime = value; } catch (e) {
                        console.warn('[External Player] html5 seek failed:', e);
                    }
                    eventSource.emit(EVT_EXTERNAL_AUDIO_PROGRESS, {
                        id: id,
                        currentTime: value,
                        duration: duration,
                    });
                } else {
                    console.warn(`[External Player] Invalid html5 seek value: ${value}, duration: ${duration}`);
                }
            }
            // Handle non-preview mode (Tone.Player)
            else if (!item.is_preview && item.player && item.chainWrapper) {
                const oldPlayer = item.player;
                const buffer = oldPlayer.buffer;
                const duration = buffer ? buffer.duration : 0;

                if (duration > 0 && typeof value === 'number' && value >= 0 && value < duration) {
                    item.isSeeking = true;

                    // Get the raw AudioBuffer before disposing the player
                    const audioBuffer = oldPlayer.buffer.get();
                    oldPlayer.onstop = () => {};
                    item.chainWrapper.dispose();

                    const allProcessorSettings = extension_settings[extensionName].effectsProcessor;
                    let chainSettings;
                    const typeKey = item.type.toLowerCase();

                    if (item.type === 'Music' || item.type === 'Ambiance') {
                        chainSettings = {
                            type: item.type,
                            audioBuffer: audioBuffer,
                            loop: !!item.time,
                            compressor: null,
                            effects: null,
                            ir: null,
                            spatial: {
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
                            }
                        };
                    } else { // SFX, VOICE
                        let spatialProfile;
                        if (typeof item.spatial === 'string') {
                            spatialProfile = allProcessorSettings?.spatialProfiles[item.spatial];
                        } else if (typeof item.spatial === 'object' && item.spatial !== null) {
                            spatialProfile = item.spatial;
                        }
                        if (!spatialProfile) {
                            spatialProfile = allProcessorSettings?.spatialProfiles['正前方站立'];
                        }

                        chainSettings = {
                            type: item.type,
                            audioBuffer: audioBuffer,
                            loop: !!item.time,
                            compressor: allProcessorSettings?.compressorProfiles[allProcessorSettings.currentCompressorProfile],
                            effects: allProcessorSettings?.effectsProfiles[item.special_effects] || allProcessorSettings?.effectsProfiles['默认'],
                            ir: allProcessorSettings?.irProfiles[item.ir_description] || allProcessorSettings?.irProfiles['默认 (无)'],
                            spatial: spatialProfile
                        };
                    }

                    const newChainWrapper = await createPlaybackChain(chainSettings);
                    if (!newChainWrapper) {
                        console.error(`[External Player] Seek failed: could not recreate chain for ${id}`);
                        delete externalPlayingList[id];
                        eventSource.emit(eventNames.EXTERNAL_SOUND_STOPPED, { id: id, url: item.url });
                        item.isSeeking = false;
                        return;
                    }

                    const { player: newPlayer, output: newOutput } = newChainWrapper;
                    newOutput.connect(item.gainNode);

                    item.player = newPlayer;
                    item.chainWrapper = newChainWrapper;
                    item.startOffset = value;
                    item.playbackStartTime = getAudioContext().currentTime;

                    newPlayer.onstop = () => {
                        if (!externalPlayingList[id]?.isSeeking) {
                            cleanupAndNotify(id);
                        }
                    };

                    if (wasPlaying) {
                        newPlayer.start(undefined, value);
                        item.status = 'playing';
                    } else {
                        item.status = 'paused';
                    }

                    item.isSeeking = false;

                    // Manually emit a progress event after seeking
                    eventSource.emit(EVT_EXTERNAL_AUDIO_PROGRESS, {
                        id: id,
                        currentTime: value,
                        duration: duration,
                    });

                } else {
                    console.warn(`[External Player] Invalid seek value: ${value}, duration: ${duration}`);
                }
            } else {
                console.warn(`[External Player] Cannot seek: invalid item state`, {
                    is_preview: item.is_preview,
                    hasPlayer: !!item.player,
                    hasSource: !!item.source
                });
            }
            break;
        }

        default:
            console.warn(`[External Player] Unknown control command: ${command}`);
    }
}


function startVolumeAnalysis(analyserNode, lowThreshold, lowDuration, highThreshold, highDuration, key) {
    if (!analyserNode || !navigator.vibrate) return null;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let wasAboveLowThreshold = false;
    let wasAboveHighThreshold = false;

    const lowEnd = Math.floor(bufferLength * 0.25);
    const highStart = Math.floor(bufferLength * 0.75);

    const analysisLoop = () => {
        const item = externalPlayingList[key];
        if (!item || item.status !== 'playing') {
            return;
        }

        analyserNode.getByteFrequencyData(dataArray);

        let maxLowVolume = 0;
        for (let i = 0; i < lowEnd; i++) {
            if (dataArray[i] > maxLowVolume) maxLowVolume = dataArray[i];
        }

        let maxHighVolume = 0;
        for (let i = highStart; i < bufferLength; i++) {
            if (dataArray[i] > maxHighVolume) maxHighVolume = dataArray[i];
        }

        const isAboveLowThreshold = maxLowVolume > lowThreshold;
        const isAboveHighThreshold = maxHighVolume > highThreshold;

        if (isAboveHighThreshold && !wasAboveHighThreshold) {
            navigator.vibrate(highDuration);
        } else if (isAboveLowThreshold && !wasAboveLowThreshold) {
            navigator.vibrate(lowDuration);
        }

        wasAboveLowThreshold = isAboveLowThreshold;
        wasAboveHighThreshold = isAboveHighThreshold;

        const animationId = requestAnimationFrame(analysisLoop);
        
        if (externalPlayingList[key] && externalPlayingList[key].status === 'playing') {
            externalPlayingList[key].animationFrameId = animationId;
        } else {
            cancelAnimationFrame(animationId);
        }
    };

    return requestAnimationFrame(analysisLoop);
}

/**
 * 初始化外部播放器，设置事件监听器。
 */
export function initExternalPlayer() {
    eventSource.on('st-immersive-sound:get-config-data', handleGetConfigDataRequest);
    eventSource.on(eventNames.PLAY_EXTERNAL_SOUND, (data) => handleExternalPlayRequest(data));
    eventSource.on(eventNames.STOP_EXTERNAL_SOUND, (data) => {
        if (data && data.id) {
            stopExternalAudio(data.id);
        }
    });
    eventSource.on(EVT_EXTERNAL_AUDIO_CONTROL, handleExternalAudioControl);
    console.log('External audio player initialized.');
}

/**
 * 清理指定ID的音频资源并发送停止通知。
 * @param {string} id - 要清理的音频的唯一ID。
 */
function cleanupAndNotify(id) {
    const item = externalPlayingList[id];
    if (!item) return;

    // 如果正在 seeking，不要清理
    if (item.isSeeking) {
        console.log(`[External Player] Cleanup skipped for ID: ${id} (seeking in progress)`);
        return;
    }

    console.log(`[External Player] Cleaning up and notifying for ID: ${id}`);

    // Stop spatial animation loop
    if (activeAnimations[id]) {
        activeAnimations[id].isAnimating = false;
        cancelAnimationFrame(activeAnimations[id].animationFrameId);
        delete activeAnimations[id];
    }

    // Stop auto vibration (new path)
    if (item.autoVibHandle) {
        try { item.autoVibHandle.stop(); } catch (e) {}
    }
    if (item.autoVibTap) {
        try { item.autoVibTap.disconnect(); } catch (e) {}
    }

    // Stop any vibration analysis (legacy field, kept for safety)
    if (item.animationFrameId) {
        cancelAnimationFrame(item.animationFrameId);
    }

    // Stop progress emitter (removed)
    if (item.progressEmitterId) {
        cancelAnimationFrame(item.progressEmitterId);
    }

    // Stop any looping vibration pattern
    if (vibrationTimeouts[id]) {
        clearTimeout(vibrationTimeouts[id]);
        delete vibrationTimeouts[id];
    }

    // Stop device vibration immediately
    if (navigator.vibrate) {
        navigator.vibrate(0);
    }

    // Dispose of the audio chain for non-previews (and html5-fallback previews)
    if (item.chainWrapper && typeof item.chainWrapper.dispose === 'function'
        && (!item.is_preview || item.isHtml5Fallback)) {
        item.chainWrapper.dispose();
    }

    // 从列表中删除
    delete externalPlayingList[id];

    // 发送停止通知
    eventSource.emit(eventNames.EXTERNAL_SOUND_STOPPED, { id: id, url: item.url });
}


/**
 * 手动停止一个正在播放的外部音频。
 * @param {string} id - 要停止的音频的唯一ID。
 */
export function stopExternalAudio(id, fadeOutDuration = 0.5) {
    if (activePreviewLoad && activePreviewLoad.id === id) {
        const cancelledLoad = activePreviewLoad;
        activePreviewLoad = null;
        isPreviewLoading = false;
        eventSource.emit(eventNames.EXTERNAL_SOUND_STOPPED, { id, url: cancelledLoad.url });
    }

    const item = externalPlayingList[id];
    if (!item) {
        console.warn(`[External Player] Stop request for non-existent ID: ${id}`);
        return;
    }

    console.log(`[External Player] Stopping audio for ID: ${id}`);

    // Stop spatial animation loop
    if (activeAnimations[id]) {
        activeAnimations[id].isAnimating = false;
        cancelAnimationFrame(activeAnimations[id].animationFrameId);
        delete activeAnimations[id];
    }

    // 清除定时停止器
    if (item.stopTimer) {
        clearTimeout(item.stopTimer);
    }

    if (!item.gainNode) {
        cleanupAndNotify(id);
        return;
    }

    const { gainNode } = item;
    const now = getAudioContext().currentTime;

    // 停止onstop/onended回调，因为我们正在手动处理
    if (item.is_preview && item.source) {
        item.source.onended = null;
    } else if (item.player) {
        item.player.onstop = () => {};
    }

    // 执行淡出
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + fadeOutDuration);

    // 在淡出后停止
    const stopTime = now + fadeOutDuration;
    if (item.is_preview && item.source) {
        try { item.source.stop(stopTime); } catch (e) { console.warn('Could not stop preview source:', e.message); }
    } else if (item.player) {
        item.player.stop(stopTime);
    }

    // 在淡出后清理
    setTimeout(() => {
        cleanupAndNotify(id);
    }, (fadeOutDuration + 0.1) * 1000);
}


/**
 * 处理预览播放请求。
 * @param {object} data - 播放请求数据。
 */
async function handlePreviewPlayRequest(data) {
    const { id, name, volume, vibration, uploader } = data;
    const previewLoad = beginPreviewLoad(data);

    try {
        // 优先使用请求中直接携带的 URL（缓存管理等页面按钮上已包含完整 URL），
        // 仅在没有直接 URL 时才通过世界书按名称查找。
        let url = data.url || null;
        if (!url) {
            toastr.info("正在缓存音频...");
            await withTimeout(get_yin_xiao_world_info(), PREVIEW_LOAD_TIMEOUT_MS, '预览加载超时，请重试。');
            ensurePreviewLoadActive(previewLoad);
            const audio_info = search_yin_xiao_zi_yuan(name);
            if (!audio_info || !audio_info.url) {
                throw new Error(`预览时未找到音乐文件：${name}`);
            }
            url = audio_info.url;
        }
        if (isPreviewLoadActive(previewLoad)) {
            activePreviewLoad.url = url;
        }

        Object.keys(externalPlayingList).forEach(key => {
            const item = externalPlayingList[key];
            if (item && item.is_preview && key !== id) {
                stopExternalAudio(key, 0.1);
            }
        });

        ensurePreviewLoadActive(previewLoad);
        const { useHtml5: __pUseHtml5 } = await withTimeout(shouldUseHtml5Fallback(url), PREVIEW_LOAD_TIMEOUT_MS, '预览加载超时，请重试。');
        ensurePreviewLoadActive(previewLoad);
        const audioBuffer = __pUseHtml5
            ? null
            : await withTimeout(loadAudio(url, name, uploader), PREVIEW_LOAD_TIMEOUT_MS, '预览加载超时，请重试。');
        ensurePreviewLoadActive(previewLoad);
        if (!__pUseHtml5 && !audioBuffer) {
            throw new Error("无法加载音频进行预览。");
        }
        const audioContext = getAudioContext();
        await withTimeout(audioContext.resume(), PREVIEW_LOAD_TIMEOUT_MS, '预览加载超时，请重试。');
        ensurePreviewLoadActive(previewLoad);

        let source = null;
        let previewChain = null;
        if (__pUseHtml5) {
            previewChain = await withTimeout(createHtml5Chain({ url, loop: false, audioContext }), PREVIEW_LOAD_TIMEOUT_MS, '预览加载超时，请重试。');
        } else {
            source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.loop = false;
        }
        ensurePreviewLoadActive(previewLoad);

        const gainNode = audioContext.createGain();
        gainNode.gain.value = masterGainNode.gain.value * (volume || 1.0);

        let analyserNode = null;

        // Connect source to the main gain node first
        if (__pUseHtml5) {
            previewChain.output.connect(gainNode);
        } else {
            source.connect(gainNode);
        }

        // 先存入 externalPlayingList，确保震动分析可以正常工作
        externalPlayingList[id] = {
            ...data,
            source,
            player: previewChain ? previewChain.player : null,
            chainWrapper: previewChain,
            isHtml5Fallback: !!previewChain,
            gainNode,
            analyserNode: null,
            animationFrameId: null,
            status: 'playing',
            startOffset: 0,
        };

        // 主信号链始终是 gainNode → destination；analyser 只以旁路方式读取。
        gainNode.connect(audioContext.destination);

        if (extension_settings[extensionName].enable_vibration && vibration && vibration !== 'N/A' && navigator.vibrate) {
            if (typeof vibration === 'string' && vibration.startsWith('auto')) {
                const tap = setupAutoVibrationTap(audioContext, gainNode);
                const autoParams = parseAutoVibrationString(vibration);
                const handle = startAutoVibration(
                    tap.analyserNode,
                    autoParams,
                    () => !!externalPlayingList[id] && externalPlayingList[id].status === 'playing',
                );
                analyserNode = tap.analyserNode;
                externalPlayingList[id].analyserNode = tap.analyserNode;
                externalPlayingList[id].autoVibTap = tap;
                externalPlayingList[id].autoVibHandle = handle;
            } else {

                const profiles = extension_settings[extensionName].vibration_profiles || {};
                let pattern;
                if (vibration.trim().startsWith('[')) {
                    try {
                        pattern = JSON.parse(vibration);
                    } catch (e) {
                        console.warn("Could not parse vibration string as array, falling back to profile lookup:", vibration);
                        pattern = profiles[vibration];
                    }
                } else {
                    pattern = profiles[vibration];
                }

                if (pattern && Array.isArray(pattern) && pattern.length > 0) {
                    const vibrationType = pattern[0];
                    const actualPattern = pattern.slice(1);

                    if (vibrationType === 0) {
                        navigator.vibrate(actualPattern);
                    } else if (vibrationType === 1 && actualPattern.length > 0) {
                        const duration = actualPattern.reduce((a, b) => a + b, 0);
                        if (duration > 0) {
                            const vibrateLoop = () => {
                                navigator.vibrate(actualPattern);
                                vibrationTimeouts[id] = setTimeout(vibrateLoop, duration);
                            };
                            vibrateLoop();
                        }
                    }
                }
            }
        }

        if (__pUseHtml5) {
            previewChain.player.onstop = () => cleanupAndNotify(id);
            previewChain.player.start();
        } else {
            source.start();
            source.onended = () => {
                cleanupAndNotify(id);
            };
        }

        // Emit playing event
        eventSource.emit(EVT_EXTERNAL_AUDIO_PLAYING, {
            id: id,
            url: url,
            duration: audioBuffer ? audioBuffer.duration : (previewChain?.player?.buffer?.duration || 0),
            volume: volume || 1.0,
            is_preview: true,
        });

    } catch (error) {
        const isCancelled = error?.name === 'PreviewLoadCancelledError';
        if (isCancelled) {
            return;
        }
        const errorMessage = error.message || String(error);
        console.error(`[External Player] 预览播放失败 (ID: ${id}, Name: ${name}):`, error);
        toastr.error(`预览播放失败: ${errorMessage}`);
        
        eventSource.emit(eventNames.EXTERNAL_SOUND_FAILED, { id: id, url: activePreviewLoad?.url || data.url, error: errorMessage });

        delete externalPlayingList[id];
    } finally {
        if (isPreviewLoadActive(previewLoad)) {
            setTimeout(() => {
                finishPreviewLoad(previewLoad);
            }, 200);
        }
    }
}


/**
 * 处理外部音频播放请求的核心函数。
 * @param {object} data - 从 eventSource 接收到的播放请求数据。
 */
async function handleExternalPlayRequest(data) {
    if (data.is_preview) {
        return handlePreviewPlayRequest(data);
    }

    // 1. 验证参数
    if (!data || !data.type || !data.id) {
        console.error('[External Player] Invalid request data. "type" and "id" are required.', data);
        return;
    }

    const { id } = data;

    if (externalPlayingList[id]) {
        const errorMsg = `[External Player] Audio with ID "${id}" is already playing. Please stop it first.`;
        console.warn(errorMsg);
        // 对于重复请求，也通知客户端失败
        eventSource.emit(eventNames.EXTERNAL_SOUND_FAILED, { id: id, error: errorMsg });
        return;
    }

    console.log('[External Player] Handling play request:', data);
    externalPlayingList[id] = { status: 'loading' }; // 占位

    try {
        let audioUrl, audio_info;

        // 2. 获取音频源
        if (data.type === 'VOICE') {
            if (!data.context || !data.speaker) {
                throw new Error('For VOICE type, "context" and "speaker" are required.');
            }

            const requestData = {
                cacheKey: generateTtsCacheKey(data.context, data.context_texts, data.speaker),
                text: data.context,
                context_texts: data.context_texts,
                speaker: data.speaker,
                volume: data.volume ?? 100,
                ir_description: data.ir_description,
                special_effects: data.special_effects,
                spatial: data.spatial,
                metadata: { ...data },
            };
            
            const ttsResult = await initiateTtsRequest(requestData);
            // 使用 tts-* cache key 而非 blob URL，让 loadAudio 走 TTS 内存缓存分支，
            // 避免 blob URL 被误存到 IndexedDB 产生"未知名称"的幽灵缓存条目。
            audioUrl = requestData.cacheKey;

        } else {
            if (!data.src) {
                throw new Error(`For ${data.type} type, "src" is required.`);
            }
            await get_yin_xiao_world_info();
            audio_info = search_yin_xiao_zi_yuan(data.src);
            if (!audio_info || !audio_info.url) {
                throw new Error(`未找到音乐文件：${data.src}`);
            }
            audioUrl = audio_info.url;
        }

        // 3. 体积闸门 + 加载 AudioBuffer
        const { useHtml5: __useHtml5 } = await shouldUseHtml5Fallback(audioUrl);
        const audioBuffer = __useHtml5 ? null : await loadAudio(audioUrl, data.src || data.context);
        if (!__useHtml5 && !audioBuffer) {
            throw new Error("Failed to load audio buffer for " + (data.src || data.context));
        }

        // 4. 创建 Playback Chain（大文件走 HTML5 回退，不挂效果器）
        const allProcessorSettings = extension_settings[extensionName].effectsProcessor;
        let chainWrapper;
        if (__useHtml5) {
            chainWrapper = await createHtml5Chain({
                url: audioUrl,
                loop: !!data.time,
                audioContext: getAudioContext(),
            });
        } else {
        let chainSettings;
        const typeKey = data.type.toLowerCase();

        if (data.type === 'Music' || data.type === 'Ambiance') {
            chainSettings = {
                type: data.type,
                audioBuffer: audioBuffer,
                loop: !!data.time,
                compressor: null,
                effects: null,
                ir: null,
                spatial: {
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
                }
            };
        } else { // SFX, VOICE
            let spatialProfile;
            if (typeof data.spatial === 'string') {
                spatialProfile = allProcessorSettings?.spatialProfiles[data.spatial];
            } else if (typeof data.spatial === 'object' && data.spatial !== null) {
                spatialProfile = data.spatial;
            }
            if (!spatialProfile) {
                spatialProfile = allProcessorSettings?.spatialProfiles['正前方站立'];
            }

            chainSettings = {
                type: data.type,
                audioBuffer: audioBuffer,
                loop: !!data.time,
                compressor: allProcessorSettings?.compressorProfiles[allProcessorSettings.currentCompressorProfile],
                effects: allProcessorSettings?.effectsProfiles[data.special_effects] || allProcessorSettings?.effectsProfiles['默认'],
                ir: allProcessorSettings?.irProfiles[data.ir_description] || allProcessorSettings?.irProfiles['默认 (无)'],
                spatial: spatialProfile
            };
        }

        chainWrapper = await createPlaybackChain(chainSettings);
        } // end else (non-html5 chain)

        if (!chainWrapper) {
            throw new Error(`Failed to create playback chain for ${id}`);
        }

        const { player, output, panner, pathPoints } = chainWrapper;
        
        // 5. 设置音量和连接
        const gainNode = getAudioContext().createGain();
        const baseVolume = (Number(data.volume ?? (audio_info?.volume ?? 100)) / 100);
        gainNode.gain.value = baseVolume;
        output.connect(gainNode);

        let typeGainNode;
        switch (data.type) {
            case "Music": typeGainNode = musicGainNode; break;
            case "Ambiance": typeGainNode = ambianceGainNode; break;
            case "SFX": typeGainNode = sfxGainNode; break;
            case "VOICE": typeGainNode = voiceGainNode; break;
            default: typeGainNode = masterGainNode;
        }

        // 对于 HTML5 回退链：把 (track * type * master) 同步到 audioEl.volume，
        // 修复 iOS/WebKit 下 MediaElementSource 无法真正路由音频导致 UI 音量失效的问题。
        if (chainWrapper.isHtml5Fallback && typeof chainWrapper.attachVolumeChain === 'function') {
            chainWrapper.attachVolumeChain({
                trackGainNode: gainNode,
                typeGainNode,
                masterGainNode,
            });
        }

        // 6. 建立连接和震动
        // 主信号链始终是 gainNode → typeGainNode；analyser 只以旁路方式读取。
        gainNode.connect(typeGainNode);

        let analyserNode = null;
        let autoVibTap = null;
        let autoVibParams = null;
        const vibration = data.vibration ?? audio_info?.vibration;

        if (extension_settings[extensionName].enable_vibration && vibration && vibration !== 'N/A' && navigator.vibrate) {
            if (typeof vibration === 'string' && vibration.startsWith('auto')) {
                autoVibTap = setupAutoVibrationTap(getAudioContext(), gainNode);
                analyserNode = autoVibTap.analyserNode;
                autoVibParams = parseAutoVibrationString(vibration);
            } else {
                const profiles = extension_settings[extensionName].vibration_profiles || {};
                let pattern;
                if (vibration.trim().startsWith('[')) {
                    try { pattern = JSON.parse(vibration); } catch (e) { pattern = profiles[vibration]; }
                } else {
                    pattern = profiles[vibration];
                }
                if (pattern && Array.isArray(pattern) && pattern.length > 0) {
                    const [vibrationType, ...actualPattern] = pattern;
                    if (vibrationType === 0) {
                        navigator.vibrate(actualPattern);
                    } else if (vibrationType === 1 && actualPattern.length > 0) {
                        const duration = actualPattern.reduce((a, b) => a + b, 0);
                        if (duration > 0) {
                            const vibrateLoop = () => {
                                navigator.vibrate(actualPattern);
                                vibrationTimeouts[id] = setTimeout(vibrateLoop, duration);
                            };
                            vibrateLoop();
                        }
                    }
                }
            }
        }

        // 7. 设置循环和停止计时器
        let stopTimer = null;
        if (data.time && data.time > 0) {
            player.loop = true;
            const defaultFadeOut = 0.5;
            const timerDuration = Math.max(1, (data.time - defaultFadeOut) * 1000);
            stopTimer = setTimeout(() => {
                const actualFadeOut = Math.min(data.time, defaultFadeOut);
                stopExternalAudio(id, actualFadeOut);
            }, timerDuration);
        } else {
            player.loop = false;
        }

        // 8. 设置 onstop 回调
        player.onstop = () => {
            const currentItem = externalPlayingList[id];
            if (currentItem && currentItem.isSeeking) {
                console.log(`[External Player] onstop triggered during seek for ID: ${id}. Skipping cleanup.`);
                return;
            }
            cleanupAndNotify(id);
        };

        // 9. 开始播放
        player.start();

        if (panner && pathPoints && pathPoints.length > 1) {
            startSpatialAnimation(panner, pathPoints, id);
        }

        // 10. 存入 externalPlayingList
        externalPlayingList[id] = {
            ...data,
            player,
            gainNode,
            chainWrapper,
            stopTimer,
            analyserNode,
            autoVibTap,
            animationFrameId: null,
            isSeeking: false,
            status: 'playing',
            startOffset: 0,
            isHtml5Fallback: !!chainWrapper.isHtml5Fallback,
        };

        // 11. 启动 auto 震动分析
        if (autoVibParams && autoVibTap) {
            const handle = startAutoVibration(
                autoVibTap.analyserNode,
                autoVibParams,
                () => !!externalPlayingList[id] && externalPlayingList[id].status === 'playing',
            );
            externalPlayingList[id].autoVibHandle = handle;
        }

        // 12. Emit playing event
        eventSource.emit(EVT_EXTERNAL_AUDIO_PLAYING, {
            id: id,
            url: audioUrl,
            duration: audioBuffer ? audioBuffer.duration : (chainWrapper.player?.buffer?.duration || 0),
            volume: data.volume ?? (audio_info?.volume ?? 100),
            is_preview: false,
            type: data.type,
            context: data.context,
        });

        console.log(`[External Player] Started playing ID: ${id}`, externalPlayingList[id]);

    } catch (error) {
        const errorMessage = error?.error || error?.message || String(error);
        console.error(`[External Player] Error processing request for ID ${id}:`, error);
        toastr.error(`外部音频播放失败 (ID: ${id}): ${errorMessage}`);
        
        // 通知客户端播放失败
        eventSource.emit(eventNames.EXTERNAL_SOUND_FAILED, { id: id, error: errorMessage });

        delete externalPlayingList[id];
    }
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
        if (!animationState.isAnimating || !externalPlayingList[key]) {
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

/**
 * 处理获取配置数据的请求，并发送包含数据的事件。
 */
function handleGetConfigDataRequest() {
    const settings = extension_settings[extensionName];
    if (!settings) {
        console.warn('[External Player] 请求配置数据时，设置尚未加载。');
        return;
    }

    // 1. 获取声音特效、环境混响、空间音频的名称列表
    const effectsProfileNames = Object.keys(settings.effectsProcessor?.effectsProfiles || {});
    const irProfileNames = Object.keys(settings.effectsProcessor?.irProfiles || {});
    const spatialProfileNames = Object.keys(settings.effectsProcessor?.spatialProfiles || {});

    // 2. 解析并获取音效资源的名称和其他元数据（不含URL）
    const assetProfiles = settings.audio_asset_profiles || {};
    const parsedAudioAssets = [];
    for (const profileName in assetProfiles) {
        const profile = assetProfiles[profileName];
        if (profile && profile.enabled && profile.content) {
            const lines = profile.content.split('\n');
            lines.forEach(line => {
                if (line.trim() === '') return;
                const [key, url, uploader, volume, vibration] = line.split('=').map(s => s.trim());
                if (key && url) { // 仍然检查url是否存在以确保是有效行，但不发送它
                    parsedAudioAssets.push({ key, uploader: uploader || 'N/A', volume: parseFloat(volume) || 100, vibration: vibration || 'N/A', source_profile: profileName });
                }
            });
        }
    }

    // 3. 获取当前TTS音色配置的名称列表（按 voice_tts_provider 切换来源）
    const provider = settings.voice_tts_provider || 'doubao';
    const ttsSpeakerNames = (
        provider === 'minimax' ? listMinimaxSpeakers() :
        provider === 'edge' ? listEdgeSpeakers() :
        provider === 'nimo' ? listNimoSpeakers() :
        getSpeakers()
    ).map(speaker => speaker.name);

    // 4. 构建并发送数据包
    const dataPayload = {
        effectsProfiles: effectsProfileNames,
        irProfiles: irProfileNames,
        spatialProfiles: spatialProfileNames,
        parsedAudioAssets,
        ttsSpeakers: ttsSpeakerNames,
    };

    eventSource.emit('st-immersive-sound:config-data', dataPayload);
    console.log('[External Player] 已响应配置数据请求并发送简化后的数据。');
}

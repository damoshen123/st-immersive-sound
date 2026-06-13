// @ts-nocheck
import { loadAudio } from './audio-cache.js';
import { createPlaybackChain } from './playback-node-manager.js';
import { extension_settings } from "../../../../extensions.js";
import { extensionName, extensionFolderPath } from './config.js';
import { musicGainNode, ambianceGainNode, sfxGainNode, sfx_waitGainNode, voiceGainNode, masterGainNode } from './audio-context.js';
import { floatBallStateManager } from './ui-float-ball.js';
import { ensureLamejsLoaded } from './lamejs-loader.js';

// 缓存容器和大小限制
const CACHE_MAX_SIZE = 10;
const offlineRenderCache = new Map();

/**
 * 生成离线渲染的缓存键
 * @param {Array} musicList - 音频列表
 * @param {string} fullText - 完整文本
 * @param {number} cpm - 每分钟字符数
 * @returns {string} - 缓存键
 */
function generateRenderCacheKey(musicList, fullText, cpm) {
    const settings = extension_settings[extensionName];
    const effectsProcessor = settings.effectsProcessor || {};

    // 关键参数对象
    const keyObject = {
        musicList: musicList.map(m => ({
            src: m.src,
            url: m.url,
            context: m.context,
            regex: m.regex,
            regex_start: m.regex_start,
            regex_end: m.regex_end,
            volume: m.volume,
            ir_description: m.ir_description,
            special_effects: m.special_effects,
            spatial: m.spatial,
            speaker: m.speaker,
        })),
        fullText,
        cpm,
        gains: {
            music: musicGainNode.gain.value,
            ambiance: ambianceGainNode.gain.value,
            sfx: sfxGainNode.gain.value,
            sfx_wait: sfx_waitGainNode.gain.value,
            voice: voiceGainNode.gain.value,
        },
        effectsEnabled: effectsProcessor.effectsEnabled || {},
        voiceDucking: {
            enabled: settings.voiceDuckingEnabled,
            percentage: settings.voiceDuckingPercentage,
            fadeTime: settings.voiceDuckingFadeTime,
        },
        // 新增：包含所有效果器配置，确保配置更改时缓存失效
        effectsProcessor: {
            effectsProfiles: effectsProcessor.effectsProfiles,
            irProfiles: effectsProcessor.irProfiles,
            spatialProfiles: effectsProcessor.spatialProfiles,
            compressorProfiles: effectsProcessor.compressorProfiles,
            currentCompressorProfile: effectsProcessor.currentCompressorProfile,
            irApplyToVoiceOnly: effectsProcessor.irApplyToVoiceOnly,
        },
        enable3dAudio: {
            music: settings.enable3dAudio_music,
            ambiance: settings.enable3dAudio_ambiance,
        }
    };

    // 使用 JSON.stringify 生成唯一的字符串键
    return JSON.stringify(keyObject);
}

function resolveRenderProgressReporter(options) {
    if (typeof options === 'function') return options;
    if (typeof options?.onProgress === 'function') return options.onProgress;
    return null;
}

function emitRenderProgress(onProgress, payload) {
    if (typeof onProgress !== 'function') return;
    try {
        onProgress(payload);
    } catch (_) { /* noop */ }
}

/**
 * 优化1: 并行预加载所有音频
 * @returns {Promise<Map<string, AudioBuffer>>}
 */
async function preloadAllAudio(musicList, onProgress) {
    const uniqueUrls = new Map(); // url -> {url, src}
    
    for (const music of musicList) {
        const key = music.url || music.src;
        if (!uniqueUrls.has(key)) {
            uniqueUrls.set(key, { url: music.url, src: music.src });
        }
    }
    
    console.log(`[Offline Renderer] 并行加载 ${uniqueUrls.size} 个唯一音频文件...`);
    
    const entries = Array.from(uniqueUrls.entries());
    let completed = 0;
    emitRenderProgress(onProgress, {
        stage: 'preload',
        progress: 0.08,
        completed: 0,
        total: entries.length,
        message: `预加载音频 0/${entries.length}`,
    });
    const buffers = await Promise.all(
        entries.map(async ([key, { url, src }]) => {
            try {
                const buffer = await loadAudio(url, src);
                return [key, buffer];
            } finally {
                completed += 1;
                const ratio = entries.length > 0 ? completed / entries.length : 1;
                emitRenderProgress(onProgress, {
                    stage: 'preload',
                    progress: 0.08 + (ratio * 0.32),
                    completed,
                    total: entries.length,
                    message: `预加载音频 ${completed}/${entries.length}`,
                });
            }
        })
    );
    
    return new Map(buffers.filter(([, buffer]) => buffer !== null));
}

/**
 * 优化2: 使用预加载的缓冲区计算时间线
 */
async function calculateDynamicTimeline(musicList, fullText, cpm, removedRanges, audioBufferMap) {
    const secondsPerChar = 60 / cpm;
    const timingMap = [];
    const scheduledEvents = [];
    const textLength = fullText.length;

    // 优化3: 预分配并使用 TypedArray (对于大文本更高效)
    const charDurations = new Float32Array(textLength).fill(secondsPerChar);

    // 应用 removedRanges
    if (removedRanges?.length > 0) {
        for (const range of removedRanges) {
            const start = Math.max(0, range.start);
            const end = Math.min(textLength, range.end);
            for (let i = start; i < end; i++) {
                charDurations[i] = 0;
            }
        }
    }

    // 优化4: 单次遍历收集语音片段信息
    const voiceSegments = [];
    for (const music of musicList) {
        if (music.type === 'VOICE' || music.type === 'SFX_WAIT') {
            const key = music.url || music.src;
            const audioBuffer = audioBufferMap.get(key);
            
            if (audioBuffer && music.text?.length > 0) {
                const segment = {
                    start: music.regex,
                    end: music.regex + music.text.length,
                    duration: audioBuffer.duration,
                    music,
                    audioBuffer
                };
                voiceSegments.push(segment);
                timingMap.push({ 
                    start: segment.start, 
                    end: segment.end, 
                    duration: segment.duration 
                });
            }
        }
    }

    // 应用语音速度
    for (const segment of voiceSegments) {
        const voiceCharCount = segment.end - segment.start;
        if (voiceCharCount > 0 && segment.duration > 0) {
            const secondsPerVoiceChar = segment.duration / voiceCharCount;
            const start = Math.max(0, segment.start);
            const end = Math.min(textLength, segment.end);
            for (let i = start; i < end; i++) {
                if (charDurations[i] !== 0) {
                    charDurations[i] = secondsPerVoiceChar;
                }
            }
        }
    }

    // 优化5: 单次遍历计算累积时间戳
    const cumulativeTimestamps = new Float32Array(textLength + 1);
    for (let i = 0; i < textLength; i++) {
        cumulativeTimestamps[i + 1] = cumulativeTimestamps[i] + charDurations[i];
    }
    const totalDuration = cumulativeTimestamps[textLength];

    // 优化6: 内联时间获取函数，避免函数调用开销
    // 构建事件调度表
    for (const music of musicList) {
        const startIdx = Math.min(Math.max(0, music.regex_start ?? music.regex), textLength);
        const startTime = cumulativeTimestamps[startIdx];
        
        let endTime = null;
        if (music.loop && music.regex_end) {
            const endIdx = Math.min(Math.max(0, music.regex_end), textLength);
            endTime = cumulativeTimestamps[endIdx];
        }
        
        const key = music.url || music.src;
        const preloadedBuffer = voiceSegments.find(s => s.music === music)?.audioBuffer 
                               || audioBufferMap.get(key);

        scheduledEvents.push({
            ...music,
            startTime,
            endTime,
            audioBuffer: preloadedBuffer
        });
    }

    return { totalDuration, scheduledEvents, timingMap };
}

/**
 * 为离线渲染调度空间音频动画
 * @param {Tone.Panner3D} panner - 3D声像节点
 * @param {Array} pathPoints - 包含位置、速度和停留时间的路径点数组
 * @param {number} startTime - 音频在总时间线上的开始播放时间
 */
function scheduleOfflineSpatialAnimation(panner, pathPoints, startTime) {
    if (!panner || !pathPoints || pathPoints.length <= 1) {
        return;
    }

    let currentTime = startTime;

    // 设置初始位置
    const startPoint = pathPoints[0];
    panner.positionX.setValueAtTime(startPoint.x, currentTime);
    panner.positionY.setValueAtTime(startPoint.y, currentTime);
    panner.positionZ.setValueAtTime(startPoint.z, currentTime);

    // 遍历路径点以调度动画
    for (let i = 0; i < pathPoints.length - 1; i++) {
        const from = pathPoints[i];
        const to = pathPoints[i + 1];

        // 1. 处理停留时间
        const dwellTime = from.dwellTime || 0;
        if (dwellTime > 0) {
            currentTime += dwellTime;
            // 在停留期间保持位置不变
            panner.positionX.setValueAtTime(from.x, currentTime);
            panner.positionY.setValueAtTime(from.y, currentTime);
            panner.positionZ.setValueAtTime(from.z, currentTime);
        }

        // 2. 计算并调度移动
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const speed = from.speedToNext || 1;
        const segmentDuration = distance > 0 && speed > 0 ? distance / speed : 0;

        if (segmentDuration > 0) {
            // 使用线性插值实现平滑移动
            panner.positionX.linearRampToValueAtTime(to.x, currentTime + segmentDuration);
            panner.positionY.linearRampToValueAtTime(to.y, currentTime + segmentDuration);
            panner.positionZ.linearRampToValueAtTime(to.z, currentTime + segmentDuration);
            currentTime += segmentDuration;
        } else {
            // 如果没有移动时间，则立即跳转到下一点
            panner.positionX.setValueAtTime(to.x, currentTime);
            panner.positionY.setValueAtTime(to.y, currentTime);
            panner.positionZ.setValueAtTime(to.z, currentTime);
        }
    }
}

/**
 * 优化后的主渲染函数
 */
export async function renderOfflineAudio(musicList, fullText, cpm, removedRanges, options) {
    console.log('[Offline Renderer] 开始离线渲染 (优化版)...');
    const onProgress = resolveRenderProgressReporter(options);
    emitRenderProgress(onProgress, {
        stage: 'init',
        progress: 0.02,
        message: '准备离线渲染...',
    });

    // --- 缓存逻辑开始 ---
    const cacheKey = generateRenderCacheKey(musicList, fullText, cpm);
    if (offlineRenderCache.has(cacheKey)) {
        console.log('[Offline Renderer] 缓存命中！直接返回已渲染的音频。');
        // 更新访问顺序，用于LRU
        const cachedResult = offlineRenderCache.get(cacheKey);
        offlineRenderCache.delete(cacheKey);
        offlineRenderCache.set(cacheKey, cachedResult);
        emitRenderProgress(onProgress, {
            stage: 'cache',
            progress: 1,
            message: '命中缓存，已读取渲染结果',
        });
        return cachedResult;
    }
    console.log('[Offline Renderer] 缓存未命中，执行完整渲染流程。');
    emitRenderProgress(onProgress, {
        stage: 'cache',
        progress: 0.05,
        message: '缓存未命中，开始完整渲染',
    });
    // --- 缓存逻辑结束 ---
    
    // 优化7: 提前缓存设置对象，避免重复访问
    const settings = extension_settings[extensionName];
    const effectsProcessor = settings.effectsProcessor;
    const irApplyToVoiceOnly = effectsProcessor?.irApplyToVoiceOnly || false;
    
    // 步骤1: 并行预加载所有音频
    const audioBufferMap = await preloadAllAudio(musicList, onProgress);
    console.log(`[Offline Renderer] 预加载完成，共 ${audioBufferMap.size} 个文件`);
    emitRenderProgress(onProgress, {
        stage: 'preload',
        progress: 0.42,
        completed: audioBufferMap.size,
        total: new Set(musicList.map(m => m.url || m.src)).size,
        message: `预加载完成，共 ${audioBufferMap.size} 个文件`,
    });
    
    // 步骤2: 计算时间线（使用预加载的缓冲区）
    emitRenderProgress(onProgress, {
        stage: 'timeline',
        progress: 0.48,
        message: '计算时间线中...',
    });
    const timeline = await calculateDynamicTimeline(
        musicList, fullText, cpm, removedRanges, audioBufferMap
    );

    if (!timeline || timeline.totalDuration <= 0) {
        console.warn('[Offline Renderer] 时间线计算失败或总时长为0');
        return null;
    }
    
    const { totalDuration, scheduledEvents, timingMap } = timeline;
    console.log(`[Offline Renderer] 总时长: ${totalDuration.toFixed(2)}s`);
    emitRenderProgress(onProgress, {
        stage: 'timeline',
        progress: 0.58,
        totalDuration,
        total: scheduledEvents.length,
        message: `时间线计算完成，总时长 ${totalDuration.toFixed(1)} 秒`,
    });
    
    // 音量归一化基准
    const maxVolume = scheduledEvents.reduce((max, e) => Math.max(max, e.volume ?? 0), 0);
    const normalizationBase = maxVolume > 0 ? maxVolume : 100;

    // 优化8: 预计算效果配置，避免在循环中重复查找
    const defaultEffects = effectsProcessor?.effectsProfiles['默认'];
    const defaultIr = effectsProcessor?.irProfiles['默认 (无)'];
    const currentCompressor = effectsProcessor?.compressorProfiles[
        effectsProcessor.currentCompressorProfile
    ];

    try {
        const renderedBuffer = await Tone.Offline(async (offlineCtx) => {
            emitRenderProgress(onProgress, {
                stage: 'schedule',
                progress: 0.62,
                completed: 0,
                total: scheduledEvents.length,
                message: `准备调度事件 0/${scheduledEvents.length}`,
            });
            // 砖墙限幅器：防止 IR/HRTF/多轨叠加导致的削顶（破音）
            // 注意：渲染结果不包含 master 衰减（保持原行为），仅做 -1 dBFS 限幅
            // attack 与主链 masterLimiter 对齐（1 ms），尽量截住 HRTF 卷积的单样本尖峰
            const offlineLimiter = new Tone.Compressor({
                threshold: -1,
                ratio: 20,
                knee: 0,
                attack: 0.001,
                release: 0.05,
            }).toDestination();

            // 创建增益节点（统一通过限幅器输出）
            const offlineGains = {
                music: new Tone.Gain(musicGainNode.gain.value).connect(offlineLimiter),
                ambiance: new Tone.Gain(ambianceGainNode.gain.value).connect(offlineLimiter),
                sfx: new Tone.Gain(sfxGainNode.gain.value).connect(offlineLimiter),
                sfx_wait: new Tone.Gain(sfx_waitGainNode.gain.value).connect(offlineLimiter),
                voice: new Tone.Gain(voiceGainNode.gain.value).connect(offlineLimiter),
            };
            
            // Voice Ducking 处理
            if (settings.voiceDuckingEnabled) {
                const voiceEvents = scheduledEvents.filter(
                    e => e.type === 'VOICE' && e.audioBuffer
                );
                if (voiceEvents.length > 0) {
                    applyVoiceDucking(offlineGains.music, voiceEvents, settings);
                }
            }

            // 优化9: 批量调度，减少 Promise 开销
            const schedulePromises = [];
            let scheduledCount = 0;
            
            for (const event of scheduledEvents) {
                if (!event.audioBuffer) {
                    console.warn(`[Offline Renderer] 跳过未加载的音频: ${event.src}`);
                    scheduledCount += 1;
                    emitRenderProgress(onProgress, {
                        stage: 'schedule',
                        progress: 0.62 + ((scheduledEvents.length > 0 ? scheduledCount / scheduledEvents.length : 1) * 0.18),
                        completed: scheduledCount,
                        total: scheduledEvents.length,
                        message: `准备调度事件 ${scheduledCount}/${scheduledEvents.length}`,
                    });
                    continue;
                }

                // 优化10: 检查是否需要效果链 (已更新逻辑)
                const hasIr = event.ir_description && (!irApplyToVoiceOnly || event.type === 'VOICE');
                const needsEffects = event.special_effects || hasIr || event.spatial;

                const schedulePromise = (async () => {
                    let outputNode;
                    
                    if (needsEffects) {
                        const chainWrapper = await createPlaybackChain({
                            audioBuffer: event.audioBuffer,
                            loop: event.loop,
                            type: event.type,
                            compressor: currentCompressor,
                            effects: effectsProcessor?.effectsProfiles[event.special_effects] || defaultEffects,
                            ir: effectsProcessor?.irProfiles[event.ir_description] || defaultIr,
                            spatial: typeof event.spatial === 'string' 
                                ? effectsProcessor?.spatialProfiles[event.spatial] 
                                : event.spatial,
                        });
                        if (!chainWrapper) return;
                        
                        // 如果存在 panner 和动态路径，则调度空间动画
                        if (chainWrapper.panner && chainWrapper.pathPoints && chainWrapper.pathPoints.length > 1) {
                            scheduleOfflineSpatialAnimation(
                                chainWrapper.panner,
                                chainWrapper.pathPoints,
                                event.startTime
                            );
                        }
                        
                        outputNode = chainWrapper;
                    } else {
                        // 优化11: 简单音频直接创建 Player，跳过效果链
                        const player = new Tone.Player(event.audioBuffer);
                        player.loop = event.loop || false;
                        outputNode = { player, output: player };
                    }

                    // 创建音量节点
                    const normalizedVolume = (event.volume ?? 100) / normalizationBase;
                    const individualGain = new Tone.Gain(normalizedVolume);
                    
                    outputNode.output.connect(individualGain);
                    
                    const gainType = event.type.toLowerCase();
                    individualGain.connect(offlineGains[gainType] || offlineCtx.destination);

                    // 调度播放
                    if (event.loop && event.endTime && event.endTime > event.startTime) {
                        outputNode.player.start(event.startTime).stop(event.endTime);
                    } else {
                        outputNode.player.start(event.startTime);
                    }

                    scheduledCount += 1;
                    emitRenderProgress(onProgress, {
                        stage: 'schedule',
                        progress: 0.62 + ((scheduledEvents.length > 0 ? scheduledCount / scheduledEvents.length : 1) * 0.18),
                        completed: scheduledCount,
                        total: scheduledEvents.length,
                        message: `准备调度事件 ${scheduledCount}/${scheduledEvents.length}`,
                    });
                })();
                
                schedulePromises.push(schedulePromise);
            }

            await Promise.all(schedulePromises);
            console.log('[Offline Renderer] 所有音频调度完成');
            emitRenderProgress(onProgress, {
                stage: 'render',
                progress: 0.84,
                totalDuration,
                message: `离线混音渲染中（约 ${totalDuration.toFixed(1)} 秒音频）...`,
            });

        }, totalDuration);

        console.log('[Offline Renderer] 渲染成功！');

        // 兜底：扫描真实 AudioBuffer 峰值，若仍超 -0.5 dBFS（≈0.945）再做整体缩放，避免 16-bit 导出时硬削顶
        try {
            const rawBuffer = renderedBuffer.get ? renderedBuffer.get() : renderedBuffer;
            if (rawBuffer && typeof rawBuffer.getChannelData === 'function') {
                let peak = 0;
                for (let c = 0; c < rawBuffer.numberOfChannels; c++) {
                    const data = rawBuffer.getChannelData(c);
                    for (let i = 0; i < data.length; i++) {
                        const a = data[i] < 0 ? -data[i] : data[i];
                        if (a > peak) peak = a;
                    }
                }
                const ceiling = 0.945; // ≈ -0.5 dBFS
                if (peak > ceiling) {
                    const scale = ceiling / peak;
                    for (let c = 0; c < rawBuffer.numberOfChannels; c++) {
                        const data = rawBuffer.getChannelData(c);
                        for (let i = 0; i < data.length; i++) data[i] *= scale;
                    }
                    console.log(`[Offline Renderer] 检测到峰值 ${peak.toFixed(3)}，已规范化至 ${ceiling}（缩放 ${scale.toFixed(3)}）`);
                }
            }
        } catch (e) {
            console.warn('[Offline Renderer] 峰值规范化失败（忽略）:', e);
        }

        const result = { renderedBuffer, timingMap };
        emitRenderProgress(onProgress, {
            stage: 'finalize',
            progress: 0.96,
            message: '整理渲染结果中...',
        });

        // --- 缓存逻辑：存储结果 ---
        if (offlineRenderCache.size >= CACHE_MAX_SIZE) {
            // LRU 策略：删除最不常用的项（Map中的第一项）
            const oldestKey = offlineRenderCache.keys().next().value;
            offlineRenderCache.delete(oldestKey);
            console.log(`[Offline Renderer] 缓存已满，移除最旧的缓存项: ${oldestKey.substring(0, 50)}...`);
        }
        offlineRenderCache.set(cacheKey, result);
        console.log(`[Offline Renderer] 渲染结果已缓存。当前缓存大小: ${offlineRenderCache.size}`);
        // --- 缓存逻辑结束 ---
        emitRenderProgress(onProgress, {
            stage: 'done',
            progress: 1,
            message: '离线渲染完成',
        });

        return result;

    } catch (error) {
        console.error('[Offline Renderer] 渲染错误:', error);
        emitRenderProgress(onProgress, {
            stage: 'error',
            progress: 1,
            message: `离线渲染失败：${error?.message || error}`,
        });
        toastr.error('离线渲染失败');
        return null;
    }
}

/**
 * Voice Ducking 应用函数（提取出来减少主函数复杂度）
 */
function applyVoiceDucking(musicGain, voiceEvents, settings) {
    const duckingIntervals = calculateDuckingIntervals(
        voiceEvents, 
        settings.voiceDuckingFadeTime || 0.5
    );
    const duckingMultiplier = 1 - (settings.voiceDuckingPercentage / 100);
    const musicBaseVolume = musicGainNode.gain.value;
    const duckedVolume = musicBaseVolume * duckingMultiplier;
    const fadeTime = settings.voiceDuckingFadeTime || 0.5;

    for (const interval of duckingIntervals) {
        musicGain.gain.setValueAtTime(musicBaseVolume, interval.start);
        musicGain.gain.linearRampToValueAtTime(duckedVolume, interval.start + fadeTime);
        musicGain.gain.setValueAtTime(duckedVolume, interval.end);
        musicGain.gain.linearRampToValueAtTime(musicBaseVolume, interval.end + fadeTime);
    }
}

/**
 * 优化12: 使用更高效的区间合并算法
 */
function calculateDuckingIntervals(voiceEvents, fadeTime) {
    if (voiceEvents.length === 0) return [];

    // 预排序并构建区间
    const intervals = voiceEvents
        .map(event => ({
            start: event.startTime,
            end: event.startTime + event.audioBuffer.duration
        }))
        .sort((a, b) => a.start - b.start);

    // 原地合并，避免额外数组分配
    const merged = [intervals[0]];
    
    for (let i = 1; i < intervals.length; i++) {
        const last = merged[merged.length - 1];
        const curr = intervals[i];
        
        if (curr.start <= last.end + fadeTime) {
            last.end = Math.max(last.end, curr.end);
        } else {
            merged.push(curr);
        }
    }

    return merged;
}

/**
 * 将 AudioBuffer 转换为 WAV Blob
 * @param {AudioBuffer} buffer - 音频缓冲区
 * @returns {Blob} - WAV 格式的 Blob 对象
 */
export function audioBufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferWav = new ArrayBuffer(length);
    const view = new DataView(bufferWav);
    const channels = [];
    let i, sample;
    let offset = 0;
    let pos = 0;

    // 写入 WAV 文件头
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // 文件总长度 - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // fmt chunk 的长度
    setUint16(1); // 音频格式 (1 = PCM)
    setUint16(numOfChan); // 声道数
    setUint32(buffer.sampleRate); // 采样率
    setUint32(buffer.sampleRate * 2 * numOfChan); // 每秒数据字节数
    setUint16(numOfChan * 2); // 块对齐
    setUint16(16); // 每个采样点的位数

    setUint32(0x61746164); // "data" chunk
    setUint32(length - pos - 4); // data chunk 的长度

    // 获取声道数据
    for (i = 0; i < numOfChan; i++) {
        channels.push(buffer.getChannelData(i));
    }

    // 写入交错的 PCM 数据
    while (pos < length) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset])); // 限制在 -1 到 1
            sample = (sample < 0 ? sample * 32768 : sample * 32767) | 0; // 转换为 16-bit signed int
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }

    return new Blob([view], { type: 'audio/wav' });

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}

/**
 * 触发浏览器下载给定的 AudioBuffer
 * @param {AudioBuffer} buffer - 要下载的音频缓冲区
 * @param {string} filename - 下载的文件名
 */
let offlinePlayer = null;

export async function stopOfflineAudio() {
    if (offlinePlayer) {
        offlinePlayer.stop();
        offlinePlayer.dispose();
        offlinePlayer = null;
        floatBallStateManager.setPlaying(false);
        console.log('[Offline Player] Offline audio stopped and disposed.');
    }
}

export async function playOfflineAudio(musicList, fullText, cpm, removedRanges) {
    await stopOfflineAudio(); // 确保之前的播放已停止

    floatBallStateManager.startLoading();

    try {
        const result = await renderOfflineAudio(musicList, fullText, cpm, removedRanges);

        if (result && result.renderedBuffer) {
            offlinePlayer = new Tone.Player(result.renderedBuffer).connect(masterGainNode);
            
            offlinePlayer.onstop = () => {
                floatBallStateManager.setPlaying(false);
                if (offlinePlayer) {
                    offlinePlayer.dispose();
                    offlinePlayer = null;
                }
                console.log('[Offline Player] Playback finished.');
            };

            floatBallStateManager.stopLoading();
            floatBallStateManager.setPlaying(true);
            offlinePlayer.start();
            
            return { player: offlinePlayer, timingMap: result.timingMap };
        } else {
            toastr.warning('离线渲染未能生成音频，无法播放。');
            return null;
        }
    } catch (error) {
        console.error('[Offline Player] Error during offline playback:', error);
        toastr.error('离线播放时发生错误。');
        return null;
    } finally {
        floatBallStateManager.stopLoading();
    }
}


export async function downloadAudioBuffer(buffer, filename) {
    const wavBlob = audioBufferToWav(buffer);
    const url = URL.createObjectURL(wavBlob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    // 清理
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// ─────────────────────────── MP3 编码（lamejs） ───────────────────────────

/**
 * 懒加载本地 lame.min.js。
 * 使用“隔离加载”：在屏蔽 define/module/exports/require 的环境中执行 UMD 源码，
 * 避免页面被其它插件（如 @monaco-editor/loader）带入 AMD 环境后，
 * UMD 库走 AMD 分支导致 window.lamejs === undefined。
 */
function loadLamejs() {
    return ensureLamejsLoaded();
}

/**
 * 将 Float32 [-1, 1] 通道数据转为 Int16Array PCM。
 */
function floatTo16BitPCM(input) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
}

/**
 * 将 AudioBuffer 编码为 MP3 Blob。
 *
 * @param {AudioBuffer} buffer - 待编码的音频缓冲区
 * @param {object} [opts]
 * @param {number} [opts.bitrate=128] - MP3 码率（kbps），常用 96/128/160/192
 * @param {boolean} [opts.mono=false] - 是否强制混合为单声道（可显著缩小体积）
 * @param {(progress: number) => void} [opts.onProgress] - 进度回调（0~1）
 * @returns {Promise<Blob>} - audio/mpeg 格式的 Blob
 */
export async function audioBufferToMp3(buffer, opts = {}) {
    const { bitrate = 128, mono = false, onProgress } = opts;
    const lamejs = await loadLamejs();

    const sampleRate = buffer.sampleRate;
    const numChannels = mono ? 1 : Math.min(2, buffer.numberOfChannels);

    // 准备 PCM
    let leftPcm, rightPcm;
    if (numChannels === 1) {
        // 多声道下混到单声道
        if (buffer.numberOfChannels >= 2) {
            const l = buffer.getChannelData(0);
            const r = buffer.getChannelData(1);
            const mix = new Float32Array(l.length);
            for (let i = 0; i < l.length; i++) mix[i] = (l[i] + r[i]) * 0.5;
            leftPcm = floatTo16BitPCM(mix);
        } else {
            leftPcm = floatTo16BitPCM(buffer.getChannelData(0));
        }
    } else {
        leftPcm = floatTo16BitPCM(buffer.getChannelData(0));
        rightPcm = floatTo16BitPCM(buffer.getChannelData(1));
    }

    const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitrate);
    const blockSize = 1152; // MP3 帧大小
    const mp3Chunks = [];
    const total = leftPcm.length;

    // 分块编码，避免长时间阻塞主线程并能上报进度
    for (let i = 0; i < total; i += blockSize) {
        const lChunk = leftPcm.subarray(i, i + blockSize);
        const rChunk = numChannels === 2 ? rightPcm.subarray(i, i + blockSize) : undefined;
        const mp3buf = numChannels === 2
            ? encoder.encodeBuffer(lChunk, rChunk)
            : encoder.encodeBuffer(lChunk);
        if (mp3buf.length > 0) mp3Chunks.push(mp3buf);

        if (onProgress && (i & 0x3FFFF) === 0) {
            onProgress(i / total);
            // 让出主线程，UI 不会卡住
            // eslint-disable-next-line no-await-in-loop
            await new Promise(r => setTimeout(r, 0));
        }
    }

    const flushBuf = encoder.flush();
    if (flushBuf.length > 0) mp3Chunks.push(flushBuf);
    if (onProgress) onProgress(1);

    return new Blob(mp3Chunks, { type: 'audio/mpeg' });
}

/**
 * 将 AudioBuffer 编码为 MP3 后下载。
 * @param {AudioBuffer} buffer
 * @param {string} filename - 文件名（建议以 .mp3 结尾）
 * @param {object} [opts] - 同 audioBufferToMp3
 */
export async function downloadAudioBufferAsMp3(buffer, filename, opts) {
    const blob = await audioBufferToMp3(buffer, opts);
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

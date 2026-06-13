// utils/tts-cache.js
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced, eventSource } from "../../../../../script.js";
import { extensionName, eventNames } from "./config.js";
import { floatBallStateManager } from "./ui-float-ball.js";
import { ttsNotifyStart, ttsNotifyEnd } from "./tts-notification.js";

// This cache is now memory-only. No persistence.
const ttsCache = new Map();
let ttsApi = null; // Will be set by initTtsCache

// Batch notification state（仅用于统计并发数；实际弹窗由 tts-notification 聚合）
let activeTtsRequests = 0;

// Custom event emitter for UI updates
export const TtsCacheEmitter = new EventTarget();

export function updateTtsItemData(cacheKey, data) {
    const existing = ttsCache.get(cacheKey);
    if (existing) {
        const updatedItem = { ...existing, ...data };
        ttsCache.set(cacheKey, updatedItem);
        return updatedItem;
    }
    return null;
}

export function getTtsCache() {
    return ttsCache;
}

export function getTtsItem(cacheKey) {
    return ttsCache.get(cacheKey);
}

/**
 * 清空整个内存 TTS 预览缓存，并通知 UI 重新渲染。
 * 用于发起新的「音效生成」类 LLM 请求前，避免内存累积。
 */
export function clearTtsCache() {
    if (ttsCache.size === 0) return;
    ttsCache.clear();
    TtsCacheEmitter.dispatchEvent(new CustomEvent('update', { detail: { cleared: true } }));
}

export function addOrUpdateTtsItem(cacheKey, data) {
    const existing = ttsCache.get(cacheKey) || {};
    const updatedItem = { ...existing, ...data, timestamp: Date.now() };
    ttsCache.set(cacheKey, updatedItem);

    TtsCacheEmitter.dispatchEvent(new CustomEvent('update', { detail: { cacheKey, item: updatedItem } }));
    return updatedItem;
}

export async function initiateTtsRequest(requestData, force_regenerate = false) {
    if (!ttsApi) {
        throw new Error("TTS API not initialized. Call initTtsCache first.");
    }

    // The signature no longer relies on low-level details like appId, accessKey
    const { cacheKey, text, context_texts, speaker, ir_description, special_effects, spatial, metadata } = requestData;

    // Prevent requests with empty text
    if (!text || text.trim().length === 0) {
        const errorMessage = "TTS request cannot be initiated with empty text.";
        return Promise.reject(new Error(errorMessage));
    }
    // 跳过纯标点 / 纯符号 / 纯 emoji 等无可朗读内容（如 "！！"、"……"）
    if (!/[\p{L}\p{N}]/u.test(text)) {
        const errorMessage = `TTS: 跳过无可朗读字符的文本 "${text.slice(0, 20)}"`;
        console.warn('[TTS Cache]', errorMessage);
        return Promise.reject(new Error(errorMessage));
    }

    // 1. Check memory cache
    const item = getTtsItem(cacheKey);
    if (item && item.status === 'success' && !force_regenerate) {
        console.log(`[TTS Cache] Hit (memory) for key: ${cacheKey}`);
        const mergedItem = { ...item, metadata: { ...item.metadata, ...metadata } };
        return Promise.resolve(mergedItem);
    }

    // 2. If not found, failed, or forced, update status to pending
    if (force_regenerate) {
        console.log(`[TTS Cache] Force regenerating for key: ${cacheKey}.`);
    } else {
        console.log(`[TTS Cache] Miss for key: ${cacheKey}. Initiating new request.`);
    }
    
    addOrUpdateTtsItem(cacheKey, {
        cacheKey, text, context_texts, speaker, speaker_name: speaker, ir_description,
        special_effects, spatial, status: 'pending', metadata
    });

    // ---- BATCH NOTIFICATION & LOADING (START) ----
    activeTtsRequests++;
    ttsNotifyStart('doubao', '豆包');
    floatBallStateManager.startLoading();
    // ---- BATCH NOTIFICATION & LOADING (END) ----

    try {
        const result = await new Promise(async (resolve, reject) => {
            let selectedApiConfig;
            let selectedApiConfigName;
            let ttsProfileName;
            let speakerInfo;
            
            let quotaDeducted = false;
            let textLengthForDeduction = 0;
            let isSynthesisForDeduction = false;

            try {
                // 3. API selection and quota check logic
                const settings = extension_settings[extensionName];
                ttsProfileName = settings.current_tts_profile;
                const ttsProfile = settings.tts_profiles[ttsProfileName];

                if (!ttsProfile) throw new Error(`当前TTS配置 "${ttsProfileName}" 未找到。`);
                const allApiConfigs = ttsProfile.api_configs || {};
                if (Object.keys(allApiConfigs).length === 0) throw new Error("没有可用的 TTS API 配置。");

                const candidateApiConfigs = Object.entries(allApiConfigs)
                    .filter(([_, apiConfig]) => apiConfig.speakers && apiConfig.speakers[speaker])
                    .reduce((acc, [name, config]) => ({ ...acc, [name]: config }), {});

                const candidateApiNames = Object.keys(candidateApiConfigs);
                if (candidateApiNames.length === 0) throw new Error(`在当前TTS配置 "${ttsProfileName}" 的所有API中，均未找到音色 "${speaker}"。`);

                if (settings.tts_request_balancing) {
                    settings.tts_balancing_speaker_next_config = settings.tts_balancing_speaker_next_config || {};
                    const nextConfigName = settings.tts_balancing_speaker_next_config[speaker];
                    let startIndex = candidateApiNames.indexOf(nextConfigName);
                    if (startIndex === -1) startIndex = 0;

                    for (let i = 0; i < candidateApiNames.length; i++) {
                        const currentIndex = (startIndex + i) % candidateApiNames.length;
                        const configName = candidateApiNames[currentIndex];
                        const apiConfig = candidateApiConfigs[configName];
                        const textLength = text.length;
                        const isSynthesis = (apiConfig.speakers[speaker].resource_id === 'seed-tts-2.0');
                        const quotaType = isSynthesis ? 'synthesis_quota' : 'clone_quota';
                        const quota = apiConfig[quotaType];

                        if (apiConfig.app_id && apiConfig.access_key && (quota === -1 || quota >= textLength)) {
                            selectedApiConfig = apiConfig;
                            selectedApiConfigName = configName;
                            settings.tts_balancing_speaker_next_config[speaker] = candidateApiNames[(currentIndex + 1) % candidateApiNames.length];
                            saveSettingsDebounced();
                            break;
                        }
                    }
                } else {
                    const currentApiConfigName = ttsProfile.current_api_config;
                    const currentApiConfig = allApiConfigs[currentApiConfigName];
                    if (!currentApiConfig || !currentApiConfig.app_id || !currentApiConfig.access_key) throw new Error(`当前选定的TTS API配置 "${currentApiConfigName}" 无效或不完整。`);
                    if (!currentApiConfig.speakers || !currentApiConfig.speakers[speaker]) throw new Error(`当前选定的TTS API配置 "${currentApiConfigName}" 中不包含音色 "${speaker}"。`);
                    
                    const textLength = text.length;
                    const isSynthesis = currentApiConfig.speakers[speaker].resource_id === 'seed-tts-2.0';
                    const quotaType = isSynthesis ? 'synthesis_quota' : 'clone_quota';
                    const quota = currentApiConfig[quotaType];

                    if (quota === -1 || quota >= textLength) {
                        selectedApiConfig = currentApiConfig;
                        selectedApiConfigName = currentApiConfigName;
                    } else {
                        toastr.warning(`当前TTS API配置 "${currentApiConfigName}" 的${isSynthesis ? '合成' : '复刻'}额度不足。`);
                    }
                }

                if (!selectedApiConfig) {
                    const errorMessage = `所有包含音色 "${speaker}" 的可用TTS API配置额度均不足。`;
                    toastr.warning(errorMessage);
                    addOrUpdateTtsItem(cacheKey, { status: 'error', error: errorMessage });
                    return reject(new Error(errorMessage));
                }

                speakerInfo = selectedApiConfig.speakers[speaker];
                const textLength = text.length;
                const isSynthesis = speakerInfo.resource_id === 'seed-tts-2.0';
                const quotaType = isSynthesis ? 'synthesis_quota' : 'clone_quota';
                const quota = selectedApiConfig[quotaType];

                if (quota !== -1 && quota < textLength) {
                    const errorMessage = `选中的TTS API配置 "${selectedApiConfigName}" ${isSynthesis ? '合成' : '复刻'}额度不足 (需要: ${textLength})。`;
                    toastr.warning(errorMessage);
                    addOrUpdateTtsItem(cacheKey, { status: 'error', error: errorMessage });
                    return reject(new Error(errorMessage));
                }

                // ---- QUOTA PRE-DEDUCTION ----
                const apiConfigToUpdate = selectedApiConfig;
                textLengthForDeduction = textLength;
                isSynthesisForDeduction = isSynthesis;
                if (isSynthesis && apiConfigToUpdate.synthesis_quota !== -1) {
                    apiConfigToUpdate.synthesis_quota = Math.max(0, apiConfigToUpdate.synthesis_quota - textLength);
                    quotaDeducted = true;
                } else if (!isSynthesis && apiConfigToUpdate.clone_quota !== -1) {
                    apiConfigToUpdate.clone_quota = Math.max(0, apiConfigToUpdate.clone_quota - textLength);
                    quotaDeducted = true;
                }
                if (quotaDeducted) {
                    saveSettingsDebounced();
                    eventSource.emit(eventNames.TTS_QUOTA_UPDATED);
                }

                // 4. Initiate the TTS request
                const apiRequestData = {
                    ...requestData,
                    appId: selectedApiConfig.app_id,
                    accessKey: selectedApiConfig.access_key,
                    speaker: speakerInfo.speaker_id,
                    resourceId: speakerInfo.resource_id,
                };
                const { audioBuffer } = await ttsApi(apiRequestData);

                // 5. Process successful result
                const audioBlob = new Blob([audioBuffer], { type: "audio/mp3" });
                const audioUrl = URL.createObjectURL(audioBlob);
                const successItem = addOrUpdateTtsItem(cacheKey, {
                    status: 'success', audioBuffer, audioBlob, audioUrl, text: requestData.text,
                    context_texts: requestData.context_texts, speaker: speakerInfo.speaker_id,
                    speaker_name: requestData.speaker, ir_description: requestData.ir_description,
                    special_effects: requestData.special_effects, spatial: requestData.spatial,
                });
                resolve(successItem);

            } catch (error) {
                // 6. Handle any failure
                console.error(`[TTS Cache] API request failed for ${cacheKey}:`, error);

                // ---- QUOTA REFUND ----
                if (quotaDeducted && selectedApiConfig) {
                    console.log(`[TTS Cache] Refunding quota for failed request: ${cacheKey}`);
                    if (isSynthesisForDeduction && selectedApiConfig.synthesis_quota !== -1) {
                        selectedApiConfig.synthesis_quota += textLengthForDeduction;
                    } else if (!isSynthesisForDeduction && selectedApiConfig.clone_quota !== -1) {
                        selectedApiConfig.clone_quota += textLengthForDeduction;
                    }
                    saveSettingsDebounced();
                    eventSource.emit(eventNames.TTS_QUOTA_UPDATED);
                }

                addOrUpdateTtsItem(cacheKey, {
                    status: 'error',
                    error: error.message || String(error)
                });
                reject(error);
            }
        });
        return result;
    } finally {
        // ---- BATCH NOTIFICATION & LOADING CLEANUP ----
        activeTtsRequests--;
        floatBallStateManager.stopLoading();
        ttsNotifyEnd('doubao');
    }
}

/**
 * Gets a deduplicated list of all available speakers from the current TTS profile.
 * @returns {Array<object>} An array of speaker objects.
 */
export function getSpeakers() {
    const settings = extension_settings[extensionName];
    const ttsProfileName = settings.current_tts_profile;
    const ttsProfile = settings.tts_profiles[ttsProfileName];

    if (!ttsProfile || !ttsProfile.api_configs) {
        return [];
    }

    const allSpeakers = new Map();
    const apiConfigs = ttsProfile.api_configs;

    for (const configName in apiConfigs) {
        const apiConfig = apiConfigs[configName];
        if (apiConfig.speakers) {
            for (const speakerName in apiConfig.speakers) {
                if (!allSpeakers.has(speakerName)) {
                    // Store the speaker details along with its name
                    allSpeakers.set(speakerName, {
                        name: speakerName,
                        ...apiConfig.speakers[speakerName]
                    });
                }
            }
        }
    }

    return Array.from(allSpeakers.values());
}

/**
 * Initializes the TTS Cache system.
 * @param {Function} api - The function that performs the actual TTS API call.
 *                         It should take requestData and return a Promise resolving with { audioBuffer }.
 */
export function initTtsCache(api) {
    ttsApi = api;
    // No longer loading from DB
    console.log("In-memory TTS Cache system initialized.");
}

/**
 * Simple and fast string hashing function (cyrb53).
 * @param {string} str The string to hash.
 * @param {number} [seed=0] An optional seed.
 * @returns {number} A 53-bit hash number.
 */
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
    h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1>>>0);
};

/**
 * Generates a safe cache key for a TTS request based on its content.
 * @param {string} text The text content to be synthesized.
 * @param {string} context_texts The context text for emotion.
 * @param {string} speaker The speaker ID.
 * @returns {string} A unique and safe cache key.
 */
export function generateTtsCacheKey(text, context_texts, speaker) {
    if (typeof text !== 'string' || text.length === 0) {
        // Handle empty or invalid input to avoid errors
        return `tts-id-empty-${Date.now()}`;
    }
    // Combine all relevant data into a single, stable string for hashing.
    const keyString = `${text}|${context_texts || ''}|${speaker || ''}`;
    return `tts-id-${cyrb53(keyString)}`;
}

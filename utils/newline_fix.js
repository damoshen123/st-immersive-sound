// @ts-nocheck
import { eventSource, event_types, chat } from "../../../../../script.js";
import { updateCombinedPrompt } from "./ui-llm.js";
import { eventNames,extensionName } from "./config.js";
import { extension_settings } from "../../../../extensions.js";
import { getContext } from "../../../../st-context.js";
import { get_yin_xiao_world_setting} from "./world-info.js"
import { logManager } from "./log.js";
import { getSpeakers } from "./tts-cache.js";
import { listAllSpeakers as listMinimaxSpeakers } from "./minimax-voices.js";
import { listEdgeSpeakers } from "./edge-tts.js";
import { listAllSpeakers as listNimoSpeakers } from "./nimo-voices.js";

/**
 * Generates a unique ID, falling back to a custom implementation if crypto.randomUUID is not available.
 * @returns {string}
 */
function generateRequestId() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older browsers/environments that don't support crypto.randomUUID
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function normalizeQuotes(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/[“”„‟«»「」『』]/g, '"')
        .replace(/[‘’‚‛‹›'`]/g, "'");
}

/**
 * Initializes the newline fixer functionality.
 * It listens for new messages and sends them to the regex test UI.
 */


function replacePlaceholder(obj, placeholder, value, replacedSet) {
    // 1. 如果是字符串，直接替换
    if (typeof obj === 'string') {
        if (value && obj.includes(placeholder)) {
            if (replacedSet) {
                replacedSet.add(placeholder);
            }
        }
        return obj.replaceAll(placeholder, value);
    }

    // 2. 如果是数组，遍历每个元素递归处理
    if (Array.isArray(obj)) {
        return obj.map(item => replacePlaceholder(item, placeholder, value, replacedSet));
    }

    // 3. 如果是对象，遍历每个属性递归处理
    if (obj && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = replacePlaceholder(obj[key], placeholder, value, replacedSet);
        }
        return newObj;
    }

    // 4. 其他类型（数字、布尔等）原样返回
    return obj;
}

export function GENERATION_audio(originalMessage) {
    return new Promise((resolve, reject) => {
        const requestId = generateRequestId(); // 生成唯一ID
        console.log(`声临其境：原始消息 (ID: ${requestId}) 已通过 eventSource 发送到正则测试工具:`, originalMessage);

        // 定义一个具名的事件处理函数
        const resultHandler = async (data) => {
            // 检查UUID是否匹配
            if (data.id !== requestId) {
                return;
            }

            // 处理完后立即移除监听器
            eventSource.removeListener(eventNames.REGEX_RESULT_MESSAGE, resultHandler);

            try {
                const processedMessage = normalizeQuotes(data.message);
                const removedRanges = data.removedRanges || []; // Get the ranges
                console.log(`声临其境：从正则测试工具接收到匹配的处理后消息 (ID: ${data.id}):`, processedMessage);
                logManager.add("正则后文本:\n"+processedMessage)
                let world_setting = await get_yin_xiao_world_setting();
                let promt = await LLM_GET_PROMPT();

                const allPlaceholders = [
                    "{{原始文本}}",
                    "{{所有音效列表}}",
                    "{{人声和角色匹配设定}}",
                    "{{人声列表}}",
                    "{{空间音频介绍}}",
                    "{{环境混响介绍}}",
                    "{{声音特效介绍}}"
                ];
                const replacedVariables = new Set();

                console.log("声临其境：promt:", promt);
                console.log("world_setting:", world_setting);

                promt = replacePlaceholder(promt, "{{原始文本}}", processedMessage, replacedVariables);
                promt = replacePlaceholder(promt, "{{所有音效列表}}", world_setting, replacedVariables);
                logManager.add("所有音效列表:\n"+world_setting)

                const settings = extension_settings[extensionName];
                if (settings) {
                    // c. 处理并替换 {{人声和角色匹配设定}}
                    //    根据 voice_tts_provider 选择对应的规则集与音色清单
                    const provider = settings.voice_tts_provider || 'doubao';
                    const isMinimax = (provider === 'minimax');
                    const isEdge = (provider === 'edge');
                    const isNimo = (provider === 'nimo');

                    let characterMatchingProfile;
                    if (isMinimax) {
                        const profileName = settings.current_minimax_character_matching_profile;
                        characterMatchingProfile = settings.minimax_character_matching_profiles?.[profileName];
                    } else if (isEdge) {
                        const profileName = settings.current_edge_character_matching_profile;
                        characterMatchingProfile = settings.edge_character_matching_profiles?.[profileName];
                    } else if (isNimo) {
                        const profileName = settings.current_nimo_character_matching_profile;
                        characterMatchingProfile = settings.nimo_character_matching_profiles?.[profileName];
                    } else {
                        const profileName = settings.current_tts_character_matching_profile;
                        characterMatchingProfile = settings.tts_character_matching_profiles?.[profileName];
                    }
                    if (characterMatchingProfile) {
                        promt = replacePlaceholder(promt, "{{人声和角色匹配设定}}", characterMatchingProfile, replacedVariables);
                        logManager.add("人声和角色匹配设定:\n"+characterMatchingProfile)
                    }

                    // b. 处理并替换 {{人声列表}}
                    let speakers;
                    if (isMinimax) {
                        // MiniMax 的"人声"= 自定义音色 + 我的音色 + 云端 system_voice
                        // 用 nickname / voice_name 作为可读名（落到 LLM 的 BGM speaker 字段后再被
                        // findVoiceByName 反向解析回 voice_id）
                        speakers = listMinimaxSpeakers();
                    } else if (isEdge) {
                        // Edge 的"人声"= EDGE_VOICES 全集（id 作为 name，附带语言/性别/中文名/风格描述）
                        speakers = listEdgeSpeakers();
                    } else if (isNimo) {
                        // Nimo 的"人声"= 我的音色（预置/克隆/描述/自定义） + 预置音色
                        speakers = listNimoSpeakers();
                    } else {
                        speakers = getSpeakers(); // 从 tts-cache.js 获取所有豆包人声
                    }
                    if (speakers && speakers.length > 0) {
                        let speakersDescription = "可用人声列表如下：\n";
                        for (const speaker of speakers) {
                            // 豆包 / MiniMax：按「角色匹配设定」文本白名单过滤，只发送被提到名称的人声
                            // Edge：音色清单为引擎全集，不需要过滤
                            if (isEdge || isNimo || (characterMatchingProfile && characterMatchingProfile.includes(speaker.name))) {
                                speakersDescription += `- 配音名称: ${speaker.name}，配音简介: ${speaker.description}\n`;
                            }
                        }
                        promt = replacePlaceholder(promt, "{{人声列表}}", speakersDescription, replacedVariables);
                        logManager.add("人声列表:\n" + speakersDescription);
                    }

                    if (settings.effectsProcessor) {
                        const processorSettings = settings.effectsProcessor;

                        // 替换 {{空间音频介绍}}
                        const spatialDescProfileName = processorSettings.currentSpatialDescriptionProfile;
                        const spatialDesc = processorSettings.spatialDescriptionProfiles[spatialDescProfileName];
                        if (spatialDesc) {
                            promt = replacePlaceholder(promt, "{{空间音频介绍}}", spatialDesc, replacedVariables);
                            logManager.add("空间音频介绍:\n"+spatialDesc)
                        }

                        // 替换 {{环境混响介绍}}
                        const irDescProfileName = processorSettings.currentIrDescriptionProfile;
                        const irDesc = processorSettings.irDescriptionProfiles[irDescProfileName];
                        if (irDesc) {
                            promt = replacePlaceholder(promt, "{{环境混响介绍}}", irDesc, replacedVariables);
                            logManager.add("环境混响介绍:\n"+irDesc)
                        }

                        // 替换 {{声音特效介绍}}
                        const effectsDescProfileName = processorSettings.currentEffectsDescriptionProfile;
                        const effectsDesc = processorSettings.effectsDescriptionProfiles[effectsDescProfileName];
                        if (effectsDesc) {
                            promt = replacePlaceholder(promt, "{{声音特效介绍}}", effectsDesc, replacedVariables);
                            logManager.add("声音特效介绍:\n"+effectsDesc)
                        }
                    }
                }

                console.log("声临其境：替换后 promt:", promt);

                logManager.add("声临其境：替换后 promt:\n"+JSON.stringify(promt))


                let diagnosticText = "";
                if (replacedVariables.size > 0) {
                    diagnosticText = `诊断：检测到以下变量被使用：${[...replacedVariables].join('、')}\n`;
                } else {
                    diagnosticText = "诊断：没有检测到变量被使用。\n";
                }

                const unusedVariables = allPlaceholders.filter(p => !replacedVariables.has(p));
                if (unusedVariables.length > 0) {
                    diagnosticText += `未使用的变量：${unusedVariables.join('、')}\n\n`;
                } else {
                    diagnosticText += `所有变量都已使用。\n\n`;
                }
                
                const final_content = diagnosticText + JSON.stringify(promt) ;
                console.log("声临其境：最终的 prompt:", final_content);
                updateCombinedPrompt(final_content);
                // Resolve with an object containing the prompt, ranges, and the regex-cleaned source text
                resolve({ promt: promt, removedRanges: removedRanges, cleanedMessage: processedMessage });
            } catch (error) {
                console.error("声临其境：在 GENERATION_audio 中处理消息时出错:", error);
                reject(error);
            }
        };

        // 监听结果事件
        eventSource.on(eventNames.REGEX_RESULT_MESSAGE, resultHandler);

        // 发送带有UUID的测试事件
        eventSource.emit(eventNames.REGEX_TEST_MESSAGE, { message: originalMessage, id: requestId });
        toastr.success('消息已发送到正则测试工具');
    });
}



export function initializeNewlineFixer() {

    console.log("声临其境：初始化");
    eventSource.on(event_types.MESSAGE_RECEIVED, async function (id) {
        // Ensure the message and its content exist.
        if (!chat[id] || typeof chat[id].mes !== 'string') {
            return;
        }
        return
        const originalMessage = chat[id].mes;

       
        if(originalMessage.length>0 ){

            toastr.info('声临其境:正在处理消息...');
            try {
                const next_promt = await GENERATION_audio(originalMessage);
                console.log("声临其境：从 GENERATION_audio 获取的 next_promt:", next_promt);
                // 在这里可以继续处理 next_promt
            } catch (error) {
                console.error("声临其境：处理消息时发生错误:", error);
                toastr.error('声临其境: 处理消息时出错');
            }

        }
       
       

    });
}

export function LLM_EXECUTE(prompt, { timeoutMs = 180000, requestType = 'main_sfx' } = {}) {
    return new Promise((resolve, reject) => {
      const executeRequestId = generateRequestId();
      console.log(`声临其境：请求执行 LLM (ID: ${executeRequestId}, 类型: ${requestType})`);
  
      let timeoutTimer = null;
  
      const cleanup = () => {
        eventSource.removeListener(eventNames.LLM_EXECUTE_RESPONSE, executeResponseHandler);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      };
  
      const executeResponseHandler = (executeData) => {
        if (executeData.id !== executeRequestId) return;
  
        cleanup();
  
        console.log(`声临其境：已收到 LLM 执行结果 (ID: ${executeRequestId}):`, executeData);
  
        if (executeData.success) {
            resolve(executeData.result);
        } else {
            if (executeData.error && executeData.error.name === 'AbortError') {
                const err = new Error(executeData.error.message);
                err.name = 'AbortError';
                reject(err);
            } else {
                reject(new Error(executeData.result));
            }
        }
      };
  
      eventSource.on(eventNames.LLM_EXECUTE_RESPONSE, executeResponseHandler);
      eventSource.emit(eventNames.LLM_EXECUTE_REQUEST, { prompt, id: executeRequestId, requestType });
  
      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`LLM 执行超时（${timeoutMs}ms）`));
      }, timeoutMs);
    });
  }

export function LLM_GET_PROMPT({ requestType = 'main_sfx', triggerText = '' } = {}) {
    return new Promise((resolve, reject) => {
      const promptRequestId = generateRequestId();
      console.log(`声临其境：请求获取 LLM 提示词 (ID: ${promptRequestId}, 类型: ${requestType})`);
  
      const handler = (promptData) => {
        if (promptData.id !== promptRequestId) return;
  
        eventSource.removeListener(eventNames.LLM_GET_PROMPT_RESPONSE, handler);
  
        const { prompt } = promptData;
        console.log(`声临其境：已获取 LLM 提示词 (ID: ${promptRequestId}):`, prompt);
  
        resolve(prompt);
      };
  
      eventSource.on(eventNames.LLM_GET_PROMPT_RESPONSE, handler);
      eventSource.emit(eventNames.LLM_GET_PROMPT_REQUEST, { id: promptRequestId, requestType, triggerText });

      setTimeout(() => {
        eventSource.removeListener(eventNames.LLM_GET_PROMPT_RESPONSE, handler);
        reject(new Error("获取 prompt 超时"));
      }, 10000);
    });
  }

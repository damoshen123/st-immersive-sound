/* global toastr */
// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced, eventSource } from "../../../../../script.js";
import { extensionName, eventNames, LLMRequestTypes, DEFAULT_REQUEST_TYPE, REQUEST_TYPE_LABELS, sleepAidDefaultContextProfileName, sleepAidDefaultContextProfile, sleepAidAudioDefaultContextProfileName, sleepAidAudioDefaultContextProfile } from "./config.js";
import { floatBallStateManager } from "./ui-float-ball.js";
import { initTestContextSettings, getCurrentTestContextMessages } from "./ui-test-context.js";
import {
    migrateRequestTypeConfigs,
    getEffectiveConfigForRequestType,
    buildPromptForRequestType,
    executeTypedLLMRequest,
    normalizeRequestType,
    __llmErrorUtils,
} from "./llm-service.js";
const { tryParseJsonText, extractApiErrorMessage, buildHttpErrorMessage } = __llmErrorUtils;

// DOM Elements
let profileSelect, apiUrlInput, apiKeyInput, modelSelect, fetchModelsButton;
let temperatureSlider, temperatureValue, topPSlider, topPValue, maxTokensSlider, maxTokensValue;
let testButton, resultTextarea, llmTestModeToggle, combinedPromptTextarea;
// 高级请求开关（与 AI 助手设置一致，存到当前 LLM 预设里）
let streamToggle, bypassProxyToggle, mergeSystemUserToggle, sendImagesToggle;
// 自定义模型名（手动输入会覆盖 modelSelect）
let modelCustomInput;
let currentLLMRequestController;

/**
 * 更新组合提示词输入框的内容。
 * @param {string} text - 要显示的文本。
 */
export function updateCombinedPrompt(text) {
    if (combinedPromptTextarea) {
        combinedPromptTextarea.val(unescapeDisplayText(text));
    }
}

/**
 * 将字面量转义序列（\n、\r、\t）还原为真实控制字符，便于在 textarea 中阅读。
 * @param {string} text
 * @returns {string}
 */
function unescapeDisplayText(text) {
    if (typeof text !== 'string' || text.length === 0) return text;
    const PLACEHOLDER = '\u0000BS\u0000';
    return text
        .replace(/\\\\/g, PLACEHOLDER)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(new RegExp(PLACEHOLDER, 'g'), '\\');
}

/**
 * 检查当前是否有正在进行的 LLM 请求。
 * @returns {boolean}
 */
export function isLLMRequestActive() {
    return !!currentLLMRequestController;
}

/**
 * 中止当前正在进行的 LLM 请求。
 */
export function abortLLMRequest() {
    if (currentLLMRequestController) {
        currentLLMRequestController.abort();
        toastr.info('LLM 请求已中止。');
    }
}

/**
 * Loads LLM profiles from settings and populates the dropdown.
 */
export function loadLLMProfiles() {
    const profiles = extension_settings[extensionName].llm_profiles || {};
    const currentProfileName = extension_settings[extensionName].current_llm_profile;

    profileSelect.empty();
    Object.keys(profiles).forEach(name => {
        const option = new Option(name, name, name === currentProfileName, name === currentProfileName);
        profileSelect.append(option);
    });

    if (profileSelect.val()) {
        profileSelect.trigger('change');
    }
    // 通知请求类型卡片刷新 API 配置下拉
    try { eventSource.emit(eventNames.LLM_PROFILES_CHANGED); } catch (e) { /* ignore */ }
}

// ==================== 请求类型卡片 ====================

/**
 * 根据当前 `llm_profiles` / `test_context_profiles` 填充所有请求类型卡片下拉。
 * 保留各卡片在设置里保存的选中值；选中值不在可选项中时回落到第一项并落盘。
 */
function populateRequestTypeSelects() {
    const settings = extension_settings[extensionName] || {};
    const llmNames = Object.keys(settings.llm_profiles || {});
    const ctxNames = Object.keys(settings.test_context_profiles || {});
    if (!settings.llm_request_type_configs) settings.llm_request_type_configs = {};
    const cfgs = settings.llm_request_type_configs;

    let dirty = false;
    for (const type of Object.values(LLMRequestTypes)) {
        if (!cfgs[type]) cfgs[type] = { api_profile: llmNames[0] || '默认', context_profile: ctxNames[0] || '默认' };
        const binding = cfgs[type];

        const $api = $(`#llm_${type}_api_select`);
        const $ctx = $(`#llm_${type}_context_select`);
        if (!$api.length || !$ctx.length) continue;

        // API 下拉
        $api.empty();
        llmNames.forEach(name => $api.append(new Option(name, name)));
        if (binding.api_profile && llmNames.includes(binding.api_profile)) {
            $api.val(binding.api_profile);
        } else if (llmNames.length) {
            binding.api_profile = llmNames[0];
            $api.val(llmNames[0]);
            dirty = true;
        }

        // 上下文下拉
        $ctx.empty();
        ctxNames.forEach(name => $ctx.append(new Option(name, name)));
        if (binding.context_profile && ctxNames.includes(binding.context_profile)) {
            $ctx.val(binding.context_profile);
        } else if (ctxNames.length) {
            binding.context_profile = ctxNames[0];
            $ctx.val(ctxNames[0]);
            dirty = true;
        }
    }
    if (dirty) saveSettingsDebounced();
}

function ensureSleepAidContextDefaultExists() {
    const settings = extension_settings[extensionName];
    if (!settings) return false;

    let dirty = false;
    if (!settings.test_context_profiles || typeof settings.test_context_profiles !== 'object') {
        settings.test_context_profiles = {};
        dirty = true;
    }
    if (!settings.test_context_profiles[sleepAidDefaultContextProfileName]) {
        settings.test_context_profiles[sleepAidDefaultContextProfileName] = JSON.parse(JSON.stringify(sleepAidDefaultContextProfile));
        dirty = true;
    }
    if (!settings.llm_request_type_configs || typeof settings.llm_request_type_configs !== 'object') {
        settings.llm_request_type_configs = {};
        dirty = true;
    }
    if (!settings.llm_request_type_configs[LLMRequestTypes.SLEEP_AID_SCRIPT]) {
        settings.llm_request_type_configs[LLMRequestTypes.SLEEP_AID_SCRIPT] = {
            api_profile: settings.current_llm_profile || '默认',
            context_profile: sleepAidDefaultContextProfileName,
        };
        dirty = true;
    } else if (settings.llm_request_type_configs[LLMRequestTypes.SLEEP_AID_SCRIPT].context_profile === '默认') {
        settings.llm_request_type_configs[LLMRequestTypes.SLEEP_AID_SCRIPT].context_profile = sleepAidDefaultContextProfileName;
        dirty = true;
    }
    return dirty;
}

function ensureSleepAidAudioContextDefaultExists() {
    const settings = extension_settings[extensionName];
    if (!settings) return false;

    let dirty = false;
    if (!settings.test_context_profiles || typeof settings.test_context_profiles !== 'object') {
        settings.test_context_profiles = {};
        dirty = true;
    }
    if (!settings.test_context_profiles[sleepAidAudioDefaultContextProfileName]) {
        settings.test_context_profiles[sleepAidAudioDefaultContextProfileName] = JSON.parse(JSON.stringify(sleepAidAudioDefaultContextProfile));
        dirty = true;
    }
    if (!settings.llm_request_type_configs || typeof settings.llm_request_type_configs !== 'object') {
        settings.llm_request_type_configs = {};
        dirty = true;
    }
    if (!settings.llm_request_type_configs[LLMRequestTypes.SLEEP_AID_SFX]) {
        settings.llm_request_type_configs[LLMRequestTypes.SLEEP_AID_SFX] = {
            api_profile: settings.current_llm_profile || '默认',
            context_profile: sleepAidAudioDefaultContextProfileName,
        };
        dirty = true;
    } else if (settings.llm_request_type_configs[LLMRequestTypes.SLEEP_AID_SFX].context_profile === '默认') {
        settings.llm_request_type_configs[LLMRequestTypes.SLEEP_AID_SFX].context_profile = sleepAidAudioDefaultContextProfileName;
        dirty = true;
    }
    return dirty;
}

/**
 * 绑定每个卡片下拉的 change 事件，写回 `llm_request_type_configs[type]`。
 */
function bindRequestTypeCards() {
    for (const type of Object.values(LLMRequestTypes)) {
        const $api = $(`#llm_${type}_api_select`);
        const $ctx = $(`#llm_${type}_context_select`);
        if ($api.length) {
            $api.on('change', function () {
                const s = extension_settings[extensionName];
                if (!s.llm_request_type_configs) s.llm_request_type_configs = {};
                if (!s.llm_request_type_configs[type]) s.llm_request_type_configs[type] = { api_profile: '默认', context_profile: '默认' };
                s.llm_request_type_configs[type].api_profile = $(this).val();
                saveSettingsDebounced();
                console.log(`[st-immersive-sound] ${REQUEST_TYPE_LABELS[type] || type} 的 API 配置 → "${$(this).val()}"`);
            });
        }
        if ($ctx.length) {
            $ctx.on('change', function () {
                const s = extension_settings[extensionName];
                if (!s.llm_request_type_configs) s.llm_request_type_configs = {};
                if (!s.llm_request_type_configs[type]) s.llm_request_type_configs[type] = { api_profile: '默认', context_profile: '默认' };
                s.llm_request_type_configs[type].context_profile = $(this).val();
                saveSettingsDebounced();
                console.log(`[st-immersive-sound] ${REQUEST_TYPE_LABELS[type] || type} 的上下文预设 → "${$(this).val()}"`);
            });
        }
    }
}

/**
 * Handles the change event of the profile selection dropdown.
 */
function onProfileSelectChange() {
    const profileName = $(this).val();
    if (!profileName) return;

    const profiles = extension_settings[extensionName].llm_profiles;
    const profile = profiles[profileName];

    if (profile) {
        apiUrlInput.val(profile.api_url || '');
        apiKeyInput.val(profile.api_key || '');

        // Ensure the saved model is in the list, if not, add it.
        modelSelect.empty();
        const savedModel = profile.model || 'gpt-3.5-turbo';
        modelSelect.append(new Option(savedModel, savedModel, true, true));
        // 自定义模型名：优先使用 model_custom；若无则回退到 profile.model，确保输入框始终展示当前模型名
        if (modelCustomInput) modelCustomInput.val(profile.model_custom || profile.model || '');

        const temp = profile.temperature ?? 0.7;
        temperatureSlider.val(temp);
        temperatureValue.val(temp);

        const topP = profile.top_p ?? 1.0;
        topPSlider.val(topP);
        topPValue.val(topP);

        const maxTokens = profile.max_tokens ?? 512;
        maxTokensSlider.val(maxTokens);
        maxTokensValue.val(maxTokens);

        // 高级请求开关
        streamToggle.prop('checked', !!profile.stream);
        bypassProxyToggle.prop('checked', !!profile.bypass_proxy);
        mergeSystemUserToggle.prop('checked', profile.merge_system_user !== false); // 默认 true
        sendImagesToggle.prop('checked', !!profile.send_images);

        extension_settings[extensionName].current_llm_profile = profileName;
        saveSettingsDebounced();
    }

    // Also update the test mode toggle based on global setting
    llmTestModeToggle.prop('checked', extension_settings[extensionName].llmTestMode);
}

/**
 * Collects all data from the UI into a profile object.
 * @returns {object} The profile data object.
 */
function collectProfileDataFromUI() {
    // 自定义模型名优先（有输入则覆盖 select）
    const customModelName = (modelCustomInput?.val() || '').trim();
    const finalModel = customModelName || modelSelect.val();

    // 保留旧 history 字段以兼容（仅读取自现有预设，不再从 UI 收集）
    const profileName = profileSelect?.val();
    const existing = profileName ? (extension_settings[extensionName].llm_profiles?.[profileName] || {}) : {};

    return {
        api_url: apiUrlInput.val(),
        api_key: apiKeyInput.val(),
        model: finalModel,
        model_custom: customModelName,
        temperature: parseFloat(temperatureSlider.val()),
        top_p: parseFloat(topPSlider.val()),
        max_tokens: parseInt(maxTokensSlider.val(), 10),
        stream: !!streamToggle?.prop('checked'),
        bypass_proxy: !!bypassProxyToggle?.prop('checked'),
        merge_system_user: !!mergeSystemUserToggle?.prop('checked'),
        send_images: !!sendImagesToggle?.prop('checked'),
        // 保留向后兼容字段（不会被新 UI 修改）
        history: existing.history
    };
}

/**
 * Saves the current UI content to the selected profile.
 */
function onSaveProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置。");
        return;
    }

    extension_settings[extensionName].llm_profiles[profileName] = collectProfileDataFromUI();
    saveSettingsDebounced();
    toastr.success(`配置 "${profileName}" 已保存。`);
}

/**
 * Saves the current UI content as a new profile.
 */
function onSaveAsProfileClick() {
    const newName = prompt("请输入新的配置名称：");
    if (!newName || newName.trim() === '') {
        toastr.warning("配置名称不能为空。");
        return;
    }

    const profiles = extension_settings[extensionName].llm_profiles;
    if (profiles[newName]) {
        toastr.error(`配置 "${newName}" 已存在。`);
        return;
    }

    profiles[newName] = collectProfileDataFromUI();
    extension_settings[extensionName].current_llm_profile = newName;
    saveSettingsDebounced();
    loadLLMProfiles();
    toastr.success(`配置 "${newName}" 已创建并选中。`);
}

/**
 * Deletes the currently selected profile.
 */
function onDeleteProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置。");
        return;
    }

    if (Object.keys(extension_settings[extensionName].llm_profiles).length <= 1) {
        toastr.error("不能删除最后一个配置。");
        return;
    }

    if (confirm(`你确定要删除配置 "${profileName}" 吗？`)) {
        delete extension_settings[extensionName].llm_profiles[profileName];
        extension_settings[extensionName].current_llm_profile = Object.keys(extension_settings[extensionName].llm_profiles)[0];
        saveSettingsDebounced();
        loadLLMProfiles();
        toastr.success(`配置 "${profileName}" 已删除。`);
    }
}

/**
 * Exports the selected profile to a JSON file.
 */
function onExportProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的配置可导出。");
        return;
    }
    const profile = extension_settings[extensionName].llm_profiles[profileName];

    // 创建一个配置副本并清除敏感数据
    const profileToExport = { ...profile };
    delete profileToExport.api_url;
    delete profileToExport.api_key;
    delete profileToExport.model;

    const exportData = { [profileName]: profileToExport };
    const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_is_llm_profile_${profileName}.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Imports profiles from a JSON file.
 */
function onImportProfileClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedProfiles = JSON.parse(e.target.result);
                    let importedCount = 0;
                    for (const name in importedProfiles) {
                        if (Object.prototype.hasOwnProperty.call(importedProfiles, name)) {
                            // 如果配置已存在，保留原有的敏感信息（API Key等）
                            if (extension_settings[extensionName].llm_profiles[name]) {
                                extension_settings[extensionName].llm_profiles[name] = {
                                    ...extension_settings[extensionName].llm_profiles[name],
                                    ...importedProfiles[name]
                                };
                            } else {
                                extension_settings[extensionName].llm_profiles[name] = importedProfiles[name];
                            }
                            importedCount++;
                        }
                    }
                    saveSettingsDebounced();
                    loadLLMProfiles();
                    toastr.success(`成功导入 ${importedCount} 个配置。`);
                } catch (error) {
                    toastr.error("导入失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

/**
 * Fetches the list of available models from the API.
 */
async function onFetchModelsClick() {
    const baseUrl = apiUrlInput.val();
    const apiKey = apiKeyInput.val();

    if (!baseUrl || !apiKey) {
        toastr.warning("请输入 API Base URL 和 API Key。");
        return;
    }

    const fetchUrl = baseUrl.replace(/\/$/, '') + '/models';
    const originalButtonText = fetchModelsButton.html();
    fetchModelsButton.html('<i class="fa-solid fa-spinner fa-spin"></i> 正在获取...');
    fetchModelsButton.prop('disabled', true);
    floatBallStateManager.startLoading();

    try {
        const response = await fetch(fetchUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        const rawText = await response.text();
        const data = tryParseJsonText(rawText);

        if (!response.ok) {
            throw new Error(`获取模型列表失败: ${buildHttpErrorMessage(response, rawText, data)}`);
        }
        if (!data) {
            throw new Error(`获取模型列表失败: 响应不是有效 JSON: ${String(rawText || '').slice(0, 300)}`);
        }
        const apiErr = extractApiErrorMessage(data?.error);
        if (apiErr) throw new Error(apiErr);

        const models = data.data || [];
        const currentlySelected = modelSelect.val();
        modelSelect.empty();

        models.forEach(model => {
            modelSelect.append(new Option(model.id, model.id));
        });

        // Try to re-select the previously selected model
        if (currentlySelected && models.some(m => m.id === currentlySelected)) {
            modelSelect.val(currentlySelected);
        }

        toastr.success(`成功获取 ${models.length} 个模型。`);

    } catch (error) {
        toastr.error(error.message);
    } finally {
        fetchModelsButton.html(originalButtonText);
        fetchModelsButton.prop('disabled', false);
        floatBallStateManager.stopLoading();
    }
}

/**
 * Handles the LLM test button click.
 */
async function onTestLLMClick() {
    if (currentLLMRequestController) {
        currentLLMRequestController.abort();
        toastr.info('LLM请求已中断，开始新请求。');
    }
    currentLLMRequestController = new AbortController();
    const signal = currentLLMRequestController.signal;

    const currentData = collectProfileDataFromUI();
    const { api_url, api_key, model, temperature, top_p, max_tokens } = currentData;

    if (!api_url || !api_key) {
        toastr.warning("请输入 API Base URL 和 API Key。");
        return;
    }
    if (!model) {
        toastr.warning("请选择一个模型，或先获取模型列表。");
        return;
    }

    const requestUrl = api_url.replace(/\/$/, '') + '/chat/completions';
    resultTextarea.val("正在请求，请稍候...");
    testButton.prop('disabled', true);
    floatBallStateManager.startLoading();

    try {
        const messages = getCurrentTestContextMessages('');

        if (messages.length === 0) {
            toastr.warning("当前测试上下文为空，请添加至少一个启用的条目。");
            resultTextarea.val("测试已取消。");
            return;
        }

        const body = {
            model: model,
            messages: messages,
            temperature: temperature,
            top_p: top_p,
            max_tokens: max_tokens,
            stream: false,
        };

        const response = await fetch(requestUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${api_key}`
            },
            body: JSON.stringify(body),
            signal,
        });

        const rawText = await response.text();
        const data = tryParseJsonText(rawText);

        if (!response.ok) {
            throw new Error(buildHttpErrorMessage(response, rawText, data));
        }
        if (!data) {
            throw new Error(`LLM 响应不是有效 JSON: ${String(rawText || '').slice(0, 300)}`);
        }
        const apiErr = extractApiErrorMessage(data?.error);
        if (apiErr) throw new Error(apiErr);

        const reply = data.choices?.[0]?.message?.content || "未收到有效回复。";
        resultTextarea.val(reply);
        // updateCombinedPrompt(JSON.stringify(messages, null, 2));
        eventSource.emit(eventNames.LLM_TEST_RESULT, { success: true, data: data });

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('LLM test request aborted.');
            return;
        }
        console.error("LLM Test Error:", error);
        const errorMessage = `请求错误: ${error.message}`;
        resultTextarea.val(errorMessage);
        toastr.error(error.message);
        eventSource.emit(eventNames.LLM_TEST_RESULT, { success: false, data: errorMessage });
    } finally {
        testButton.prop('disabled', false);
        currentLLMRequestController = null;
        floatBallStateManager.stopLoading();
    }
}

/**
 * Builds a prompt array from the current test context entries.
 * @returns {Array} The messages array for the LLM request.
 */
function buildPrompt() {
    return getCurrentTestContextMessages('');
}

/**
 * Handles the request to get a constructed prompt.
 * @param {object} data - The event data, containing { message, id, requestType? }.
 */
function onGetPromptRequest(data) {
    const { id, requestType, triggerText } = data || {};
    if (!id) return;

    const type = normalizeRequestType(requestType);
    console.log(`声临其境：收到提示词获取请求 (ID: ${id}, type: ${type})`);
    // 有明确请求类型时，按该类型绑定的上下文预设构造；否则走默认。
    const prompt = requestType
        ? buildPromptForRequestType(type, triggerText || '')
        : buildPrompt();
    eventSource.emit(eventNames.LLM_GET_PROMPT_RESPONSE, { prompt: prompt, id: id });
}

/**
 * Handles the request to execute an LLM call with a given prompt.
 *
 * 请求路由：根据 `data.requestType` （不传时默认 `main_sfx`）去 `llm-service`
 * 取出该类型绑定的 API 配置与上下文预设，不再读 UI 当前编辑的预设。
 *
 * @param {object} data - { prompt, id, requestType? }
 */
async function onExecuteRequest(data) {
    const { prompt, id } = data || {};
    if (!id || !prompt) return;
    const requestType = normalizeRequestType(data?.requestType);

    if (currentLLMRequestController) {
        currentLLMRequestController.abort();
        toastr.info('LLM请求已中断，开始新请求。');
    }
    currentLLMRequestController = new AbortController();
    const signal = currentLLMRequestController.signal;

    const typeLabel = REQUEST_TYPE_LABELS[requestType] || requestType;
    console.log(`声临其境：收到 LLM 执行请求 (ID: ${id}, 类型: ${typeLabel})`, prompt);

    const effectiveCfg = getEffectiveConfigForRequestType(requestType);
    if (!effectiveCfg.api_url || !effectiveCfg.api_key || !effectiveCfg.model) {
        const errorMsg = `[${typeLabel}] API URL、API Key 或 Model 未配置（当前绑定预设：${effectiveCfg._api_profile_name}）。`;
        toastr.error(errorMsg);
        currentLLMRequestController = null;
        eventSource.emit(eventNames.LLM_EXECUTE_RESPONSE, { success: false, result: errorMsg, id: id });
        return;
    }

    resultTextarea.val(`正在处理 ${typeLabel} 请求，请稍候...`);
    floatBallStateManager.startLoading();

    try {
        const reply = await executeTypedLLMRequest(prompt, requestType, signal);
        const finalReply = reply || '未收到有效回复。';
        resultTextarea.val(finalReply);
        eventSource.emit(eventNames.LLM_EXECUTE_RESPONSE, { success: true, result: finalReply, id: id });
    } catch (error) {
        if (error && error.name === 'AbortError') {
            console.log('LLM execute request aborted.');
            eventSource.emit(eventNames.LLM_EXECUTE_RESPONSE, {
                success: false, result: null, id: id,
                error: { name: 'AbortError', message: 'Request aborted' }
            });
            return;
        }
        console.error('LLM Execute Error:', error);
        const errorMessage = `请求错误: ${error?.message || error}`;
        resultTextarea.val(errorMessage);
        toastr.error(error?.message || String(error));
        eventSource.emit(eventNames.LLM_EXECUTE_RESPONSE, { success: false, result: errorMessage, id: id });
    } finally {
        currentLLMRequestController = null;
        floatBallStateManager.stopLoading();
    }
}


/**
 * Initializes the LLM settings tab.
 */
/**
 * Handles the change event for the LLM test mode toggle.
 */
function onTestModeToggle() {
    extension_settings[extensionName].llmTestMode = $(this).is(':checked');
    saveSettingsDebounced();
    toastr.info(`大模型测试模式已${$(this).is(':checked') ? '开启' : '关闭'}。`);
}


/**
 * Initializes the LLM settings tab.
 */
export function initLLMSettings() {
    // Cache DOM elements
    profileSelect = $('#llm_profile_select');
    apiUrlInput = $('#llm_api_url');
    apiKeyInput = $('#llm_api_key');
    modelSelect = $('#llm_model_select');
    fetchModelsButton = $('#llm_fetch_models_button');
    temperatureSlider = $('#llm_temperature');
    temperatureValue = $('#llm_temperature_value');
    topPSlider = $('#llm_top_p');
    topPValue = $('#llm_top_p_value');
    maxTokensSlider = $('#llm_max_tokens');
    maxTokensValue = $('#llm_max_tokens_value');
    testButton = $('#llm_test_button');
    resultTextarea = $('#llm_test_result');
    llmTestModeToggle = $('#llmTestMode');
    combinedPromptTextarea = $('#llm_combined_prompt');
    streamToggle = $('#llm_stream');
    bypassProxyToggle = $('#llm_bypass_proxy');
    mergeSystemUserToggle = $('#llm_merge_system_user');
    sendImagesToggle = $('#llm_send_images');
    modelCustomInput = $('#llm_model_custom');

    // 模型下拉变更时，自动把选中的模型名同步到自定义模型输入框
    modelSelect.on('change', () => {
        const v = modelSelect.val();
        if (v) modelCustomInput.val(v);
    });

    // Bind profile management listeners
    $('#new_llm_profile_button').on('click', onSaveAsProfileClick);
    $('#save_llm_profile_button').on('click', onSaveProfileClick);
    $('#delete_llm_profile_button').on('click', onDeleteProfileClick);
    $('#import_llm_profile_button').on('click', onImportProfileClick);
    $('#export_llm_profile_button').on('click', onExportProfileClick);
    profileSelect.on('change', onProfileSelectChange);

    // Bind other listeners
    fetchModelsButton.on('click', onFetchModelsClick);
    testButton.on('click', onTestLLMClick);
    llmTestModeToggle.on('change', onTestModeToggle);

    // 高级开关变更后立即把变化写回当前预设并保存
    const onAdvancedToggleChange = () => {
        const profileName = profileSelect.val();
        if (!profileName) return;
        const profiles = extension_settings[extensionName].llm_profiles || {};
        if (!profiles[profileName]) return;
        profiles[profileName].stream = !!streamToggle.prop('checked');
        profiles[profileName].bypass_proxy = !!bypassProxyToggle.prop('checked');
        profiles[profileName].merge_system_user = !!mergeSystemUserToggle.prop('checked');
        profiles[profileName].send_images = !!sendImagesToggle.prop('checked');
        saveSettingsDebounced();
    };
    streamToggle.on('change', onAdvancedToggleChange);
    bypassProxyToggle.on('change', onAdvancedToggleChange);
    mergeSystemUserToggle.on('change', onAdvancedToggleChange);
    sendImagesToggle.on('change', onAdvancedToggleChange);

    // Listen for external requests
    eventSource.on(eventNames.LLM_GET_PROMPT_REQUEST, onGetPromptRequest);
    eventSource.on(eventNames.LLM_EXECUTE_REQUEST, onExecuteRequest);

    // Range slider bindings (no need to save on input, save button handles it)
    temperatureSlider.on('input', () => temperatureValue.val(temperatureSlider.val()));
    temperatureValue.on('input', () => temperatureSlider.val(temperatureValue.val()));
    topPSlider.on('input', () => topPValue.val(topPSlider.val()));
    topPValue.on('input', () => topPSlider.val(topPValue.val()));
    maxTokensSlider.on('input', () => maxTokensValue.val(maxTokensSlider.val()));
    maxTokensValue.on('input', () => maxTokensSlider.val(maxTokensValue.val()));

    // 一次性迁移：保证 llm_request_type_configs 存在且引用有效
    try {
        const dirty = migrateRequestTypeConfigs();
        if (dirty) saveSettingsDebounced();
    } catch (e) {
        console.warn('[st-immersive-sound] migrateRequestTypeConfigs failed:', e);
    }

    try {
        const dirty = ensureSleepAidContextDefaultExists();
        if (dirty) saveSettingsDebounced();
    } catch (e) {
        console.warn('[st-immersive-sound] ensureSleepAidContextDefaultExists failed:', e);
    }

    try {
        const dirty = ensureSleepAidAudioContextDefaultExists();
        if (dirty) saveSettingsDebounced();
    } catch (e) {
        console.warn('[st-immersive-sound] ensureSleepAidAudioContextDefaultExists failed:', e);
    }

    // 请求类型卡片：填充下拉 + 绑定 change 事件 + 订阅刷新事件
    populateRequestTypeSelects();
    bindRequestTypeCards();
    eventSource.on(eventNames.LLM_PROFILES_CHANGED, populateRequestTypeSelects);
    eventSource.on(eventNames.LLM_CONTEXT_PROFILES_CHANGED, populateRequestTypeSelects);

    // Initial load
    loadLLMProfiles();

    // 初始化「测试上下文」预设管理（参考 st-chatu8 上下文预设格式）
    initTestContextSettings();
}

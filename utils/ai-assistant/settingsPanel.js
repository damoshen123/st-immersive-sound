// @ts-nocheck
/**
 * 设置面板：API / 参数 Tab 的读写绑定 + 自动保存 + 获取模型列表
 */

import { extension_settings } from '../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../script.js';
import { extensionName } from '../config.js';
import { dom, setRefreshSettingsFn } from './context.js';
import { debounce } from './utils.js';
import { __llmErrorUtils } from '../llm-service.js';
const { tryParseJsonText, extractApiErrorMessage, buildHttpErrorMessage } = __llmErrorUtils;

const DEFAULTS = {
    api_url: '',
    api_key: '',
    model: '',
    use_current_llm_profile: true,
    max_tokens: 8000,
    temperature: 0.8,
    top_p: 1.0,
    stream: false,
    // 默认通过酒馆代理 → bypass_proxy = false
    bypass_proxy: false,
    // 合并相邻消息时把 system 视同 user 一并合并
    merge_system_user: true,
    // 是否在请求中保留图片（多模态）
    send_images: false,
};

/** 浮点参数统一保留两位小数 */
function round2(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

function getCfg() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].ai_assistant = extension_settings[extensionName].ai_assistant || {};
    const cfg = extension_settings[extensionName].ai_assistant;
    for (const k in DEFAULTS) {
        if (cfg[k] === undefined) cfg[k] = DEFAULTS[k];
    }
    return cfg;
}

/**
 * 取得当前生效的 LLM 参数：
 *   优先：勾选「复用 LLM 预设」 → extension_settings[extensionName].llm_profiles[current_llm_profile]
 *   否则：使用面板独立配置
 */
export function getEffectiveLLMConfig() {
    const cfg = getCfg();
    if (cfg.use_current_llm_profile) {
        const profileName = extension_settings[extensionName]?.current_llm_profile;
        const profile = extension_settings[extensionName]?.llm_profiles?.[profileName];
        if (profile) {
            // 高级开关：优先从 LLM 预设里读（与「模型设置」页面同步）；预设里没有时回退到 AI 助手本地配置
            return {
                api_url: profile.api_url || '',
                api_key: profile.api_key || '',
                model: profile.model || '',
                temperature: typeof profile.temperature === 'number' ? profile.temperature : cfg.temperature,
                top_p: typeof profile.top_p === 'number' ? profile.top_p : cfg.top_p,
                max_tokens: typeof profile.max_tokens === 'number' ? profile.max_tokens : cfg.max_tokens,
                stream: typeof profile.stream === 'boolean' ? profile.stream : cfg.stream,
                bypass_proxy: typeof profile.bypass_proxy === 'boolean' ? profile.bypass_proxy : cfg.bypass_proxy,
                merge_system_user: typeof profile.merge_system_user === 'boolean' ? profile.merge_system_user : cfg.merge_system_user,
                send_images: typeof profile.send_images === 'boolean' ? profile.send_images : cfg.send_images,
            };
        }
    }
    return {
        api_url: cfg.api_url,
        api_key: cfg.api_key,
        model: cfg.model,
        temperature: cfg.temperature,
        top_p: cfg.top_p,
        max_tokens: cfg.max_tokens,
        stream: cfg.stream,
        bypass_proxy: cfg.bypass_proxy,
        merge_system_user: cfg.merge_system_user,
        send_images: cfg.send_images,
    };
}

/**
 * 把当前 cfg 回填到 UI
 */
export function refreshSettingsPanel() {
    const cfg = getCfg();
    const $p = dom.dialog;
    if (!$p || !$p.length) return;

    $p.find('#st-is-ai-use-current-profile').prop('checked', !!cfg.use_current_llm_profile);
    $p.find('#st-is-ai-api-url').val(cfg.api_url);
    $p.find('#st-is-ai-api-key').val(cfg.api_key);
    $p.find('#st-is-ai-model').val(cfg.model);
    $p.find('#st-is-ai-max-tokens').val(cfg.max_tokens);
    $p.find('#st-is-ai-temperature').val(round2(cfg.temperature).toFixed(2));
    $p.find('#st-is-ai-top-p').val(round2(cfg.top_p).toFixed(2));
    $p.find('#st-is-ai-stream').prop('checked', cfg.stream !== false);
    $p.find('#st-is-ai-bypass-proxy').prop('checked', !!cfg.bypass_proxy);
    $p.find('#st-is-ai-merge-system-user').prop('checked', cfg.merge_system_user !== false);
    $p.find('#st-is-ai-send-images').prop('checked', !!cfg.send_images);

    // 复用预设时禁用独立字段
    const useProfile = !!cfg.use_current_llm_profile;
    $p.find('#st-is-ai-api-fields input, #st-is-ai-api-fields select, #st-is-ai-api-fields button')
        .prop('disabled', useProfile);
    $p.find('#st-is-ai-api-fields').css('opacity', useProfile ? 0.5 : 1);
}

const saveDebounced = debounce(() => saveSettingsDebounced(), 200);

function bind() {
    const $p = dom.dialog;
    const cfg = getCfg();

    $p.find('#st-is-ai-use-current-profile').on('change', function () {
        cfg.use_current_llm_profile = $(this).prop('checked');
        refreshSettingsPanel();
        saveDebounced();
    });
    $p.find('#st-is-ai-api-url').on('input', function () { cfg.api_url = $(this).val(); saveDebounced(); });
    $p.find('#st-is-ai-api-key').on('input', function () { cfg.api_key = $(this).val(); saveDebounced(); });
    $p.find('#st-is-ai-model').on('input', function () { cfg.model = $(this).val(); saveDebounced(); });
    $p.find('#st-is-ai-model-select').on('change', function () {
        const v = $(this).val();
        if (v) {
            cfg.model = v;
            $p.find('#st-is-ai-model').val(v);
            saveDebounced();
        }
    });
    $p.find('#st-is-ai-max-tokens').on('input', function () {
        const v = parseInt($(this).val(), 10);
        if (!isNaN(v) && v > 0) { cfg.max_tokens = v; saveDebounced(); }
    });
    $p.find('#st-is-ai-temperature').on('input', function () {
        const v = parseFloat($(this).val());
        if (!isNaN(v)) { cfg.temperature = round2(v); saveDebounced(); }
    });
    $p.find('#st-is-ai-top-p').on('input', function () {
        const v = parseFloat($(this).val());
        if (!isNaN(v)) { cfg.top_p = round2(v); saveDebounced(); }
    });
    // 失焦时把显示也规范成两位小数
    $p.find('#st-is-ai-temperature, #st-is-ai-top-p').on('blur', function () {
        const v = parseFloat($(this).val());
        if (!isNaN(v)) $(this).val(round2(v).toFixed(2));
    });
    $p.find('#st-is-ai-stream').on('change', function () {
        cfg.stream = $(this).prop('checked');
        saveDebounced();
    });
    $p.find('#st-is-ai-bypass-proxy').on('change', function () {
        cfg.bypass_proxy = $(this).prop('checked');
        if (cfg.bypass_proxy && typeof toastr !== 'undefined') {
            toastr.warning(
                '已关闭酒馆代理：将由浏览器直接请求 API，可能存在跨域(CORS)问题。<br>' +
                '请确保 API 服务端已配置 CORS 或与酒馆同域。',
                '跨域提醒',
                { timeOut: 6000, closeButton: true, escapeHtml: false }
            );
        }
        saveDebounced();
    });
    $p.find('#st-is-ai-merge-system-user').on('change', function () {
        cfg.merge_system_user = $(this).prop('checked');
        saveDebounced();
    });
    $p.find('#st-is-ai-send-images').on('change', function () {
        cfg.send_images = $(this).prop('checked');
        saveDebounced();
    });

    $p.find('#st-is-ai-fetch-models').on('click', onFetchModelsClick);
}

async function onFetchModelsClick() {
    const cfg = getCfg();
    const url = (cfg.api_url || '').trim();
    const key = cfg.api_key || '';
    if (!url) {
        if (typeof toastr !== 'undefined') toastr.warning('请先填写 API 地址');
        return;
    }
    const fetchUrl = url.replace(/\/$/, '') + '/models';
    const $btn = dom.dialog.find('#st-is-ai-fetch-models');
    const orig = $btn.html();
    $btn.html('<i class="fa-solid fa-spinner fa-spin"></i>').prop('disabled', true);
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (key) headers.Authorization = `Bearer ${key}`;
        const resp = await fetch(fetchUrl, { method: 'GET', headers });
        const rawText = await resp.text();
        const data = tryParseJsonText(rawText);
        if (!resp.ok) throw new Error(buildHttpErrorMessage(resp, rawText, data));
        if (!data) throw new Error(`响应不是有效 JSON: ${String(rawText || '').slice(0, 300)}`);
        const apiErr = extractApiErrorMessage(data?.error);
        if (apiErr) throw new Error(apiErr);
        const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
        const $sel = dom.dialog.find('#st-is-ai-model-select');
        $sel.empty().append('<option value="">(请选择)</option>');
        list.forEach((m) => {
            const id = m.id || m.name || m;
            $sel.append(`<option value="${id}">${id}</option>`);
        });
        if (typeof toastr !== 'undefined') toastr.success(`获取到 ${list.length} 个模型`);
    } catch (e) {
        console.error('[ST-IS-AI] fetch models failed:', e);
        if (typeof toastr !== 'undefined') toastr.error(`获取失败: ${e.message}`);
    } finally {
        $btn.html(orig).prop('disabled', false);
    }
}

export function initSettingsPanel() {
    bind();
    refreshSettingsPanel();
    setRefreshSettingsFn(refreshSettingsPanel);
}

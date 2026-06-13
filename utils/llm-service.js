/* global toastr */
// @ts-nocheck
/**
 * LLM 请求类型服务
 * ===============================================================
 * 按 `requestType` 路由「API 配置 + 上下文预设」，给所有 LLM 调用方提供统一入口。
 *
 * 数据来源：
 *   extension_settings[extensionName].llm_request_type_configs[type] = {
 *       api_profile:     "<llm_profiles 里的某个名字>",
 *       context_profile: "<test_context_profiles 里的某个名字>",
 *   };
 *
 * 当 `type` 缺省/非法时，统一回落到 `DEFAULT_REQUEST_TYPE`（即 `main_sfx`）。
 *
 * 智绘姬助手 (ai-assistant) 不走本机制 —— 它在自己的设置面板里独立配置。
 */

import { extension_settings } from "../../../../extensions.js";
import {
    extensionName,
    LLMRequestTypes,
    DEFAULT_REQUEST_TYPE,
    REQUEST_TYPE_LABELS,
} from "./config.js";
import { getTestContextMessagesByName } from "./ui-test-context.js";
import { clearTtsCache } from "./tts-cache.js";
import { clearRecentSfxCache } from "./recent-sfx-cache.js";
import { fetchWithCsrf, getRequestHeaders } from "./helpers.js";

/**
 * 触发「音效类」LLM 请求前的预览清理，避免预览列表无限增长造成内存爆炸。
 *
 * - 仅对会产出大量 TTS / 音效条目的请求类型生效：MAIN_SFX、SLEEP_AID_SFX
 * - 清空：音频预览缓存（ttsCache）、音效预览最近列表（recentSfxCache）
 * - 不动：audio-cache 中的音效文件二进制缓存（按用户要求保留）
 * - 同步停止预览界面里仍在播放的音频（动态 import 避免循环依赖）
 *
 * @param {string} type 已归一化的请求类型
 */
function maybeClearPreviewsForSfxRequest(type) {
    if (type !== LLMRequestTypes.MAIN_SFX && type !== LLMRequestTypes.SLEEP_AID_SFX) return;
    try { clearTtsCache(); } catch (e) { console.warn('[llm-service] clearTtsCache failed:', e); }
    try { clearRecentSfxCache(); } catch (e) { console.warn('[llm-service] clearRecentSfxCache failed:', e); }
    // 停止仍在播放的预览音频，避免引用未释放
    import('./ui-tts-preview.js')
        .then(m => m.stopAllTtsPreview?.())
        .catch(err => console.warn('[llm-service] stopAllTtsPreview failed:', err));
    import('./ui-sfx-preview.js')
        .then(m => m.stopAllSfxPreview?.())
        .catch(err => console.warn('[llm-service] stopAllSfxPreview failed:', err));
}

// 重新导出枚举，方便外部 `import { LLMRequestTypes } from './llm-service.js'`
export { LLMRequestTypes, DEFAULT_REQUEST_TYPE, REQUEST_TYPE_LABELS };

/**
 * 归一化 / 校验 requestType，非法时落到默认。
 * @param {string} type
 * @returns {string}
 */
export function normalizeRequestType(type) {
    if (!type) return DEFAULT_REQUEST_TYPE;
    const valid = Object.values(LLMRequestTypes);
    return valid.includes(type) ? type : DEFAULT_REQUEST_TYPE;
}

/**
 * 取指定请求类型的绑定 { api_profile, context_profile }。
 * 找不到时返回都是 "默认" 的兜底对象（不写回设置）。
 * @param {string} type
 * @returns {{api_profile:string, context_profile:string}}
 */
export function getRequestTypeBinding(type) {
    const t = normalizeRequestType(type);
    const s = extension_settings[extensionName] || {};
    const cfgs = s.llm_request_type_configs || {};
    const bind = cfgs[t];
    if (bind && typeof bind === 'object') {
        return {
            api_profile: bind.api_profile || '默认',
            context_profile: bind.context_profile || '默认',
        };
    }
    return { api_profile: '默认', context_profile: '默认' };
}

/**
 * 按请求类型取出有效的 LLM 配置（API 字段 + 各种开关），用于直接发起请求。
 *
 * - `api_profile` 在 `llm_profiles` 找不到时：回落到第一个可用 profile；都没有则返回各字段为空的对象（调用方自行报错）。
 * - 内置开关（stream / bypass_proxy / merge_system_user / send_images）跟随 `api_profile`。
 *
 * @param {string} type
 * @returns {object} { api_url, api_key, model, temperature, top_p, max_tokens,
 *                     stream, bypass_proxy, merge_system_user, send_images,
 *                     _api_profile_name, _context_profile_name }
 */
export function getEffectiveConfigForRequestType(type) {
    const { api_profile, context_profile } = getRequestTypeBinding(type);

    const llmProfiles = extension_settings[extensionName]?.llm_profiles || {};
    let resolvedApiName = api_profile;
    let apiProfile = llmProfiles[api_profile];
    if (!apiProfile) {
        // 绑定的预设已被删除：回落到第一个可用预设
        const firstName = Object.keys(llmProfiles)[0];
        resolvedApiName = firstName || api_profile;
        apiProfile = firstName ? llmProfiles[firstName] : {};
    }

    return {
        api_url: apiProfile.api_url || '',
        api_key: apiProfile.api_key || '',
        model: apiProfile.model_custom || apiProfile.model || '',
        temperature: typeof apiProfile.temperature === 'number' ? apiProfile.temperature : 0.7,
        top_p: typeof apiProfile.top_p === 'number' ? apiProfile.top_p : 1.0,
        max_tokens: typeof apiProfile.max_tokens === 'number' ? apiProfile.max_tokens : 512,
        stream: !!apiProfile.stream,
        bypass_proxy: !!apiProfile.bypass_proxy,
        merge_system_user: apiProfile.merge_system_user !== false, // 默认 true
        send_images: !!apiProfile.send_images,
        _api_profile_name: resolvedApiName,
        _context_profile_name: context_profile,
    };
}

/**
 * 按请求类型构建提示词消息（基于绑定的上下文预设）。
 * 绑定的预设若不存在，回落到「全局当前」上下文预设；再不行就空数组。
 *
 * @param {string} type
 * @param {string} [triggerText] 用于 trigger 模式关键词命中
 * @returns {Array<{role:string, content:string}>}
 */
export function buildPromptForRequestType(type, triggerText = '') {
    const { context_profile } = getRequestTypeBinding(type);

    let msgs = getTestContextMessagesByName(context_profile, triggerText);
    if (msgs.length === 0) {
        // 预设不存在或为空：回落到当前选中的上下文（保持向后兼容）
        const fallbackName = extension_settings[extensionName]?.current_test_context_profile;
        if (fallbackName && fallbackName !== context_profile) {
            msgs = getTestContextMessagesByName(fallbackName, triggerText);
        }
    }
    return msgs;
}

// ─── 内部工具：图片过滤 + 合并相邻消息（与 ai-assistant/llm.js 同语义） ───

function stripImagesFromMessages(messages) {
    return messages.map((m) => {
        if (!m || typeof m !== 'object') return m;
        const c = m.content;
        if (Array.isArray(c)) {
            const textParts = c
                .filter((p) => p && (p.type === 'text' || typeof p === 'string'))
                .map((p) => (typeof p === 'string' ? p : (p.text || '')));
            return { ...m, content: textParts.join('\n') };
        }
        return m;
    });
}

function mergeAdjacentMessages(messages, mergeSystemUser = false) {
    const norm = (role) => (mergeSystemUser && role === 'system') ? 'user' : role;
    const out = [];
    for (const m of messages) {
        if (!m) continue;
        const last = out[out.length - 1];
        if (last && norm(last.role) === norm(m.role) && typeof last.content === 'string' && typeof m.content === 'string') {
            last.content = (last.content ? last.content + '\n\n' : '') + (m.content || '');
        } else {
            out.push({ ...m, role: norm(m.role) });
        }
    }
    return out;
}

// ─── 错误详情解析工具 ─────────────────────────────────────────

function trimErrorText(text, maxLen = 300) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length > maxLen ? normalized.slice(0, maxLen) + '…' : normalized;
}

function tryParseJsonText(text) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return null;
    try { return JSON.parse(trimmed); } catch (_) { return null; }
}

function extractApiErrorMessage(data) {
    if (!data) return '';
    if (typeof data === 'string') return trimErrorText(data);
    const source = (typeof data === 'object' && data.error !== undefined) ? data.error : data;
    if (typeof source === 'string') return trimErrorText(source);
    if (!source || typeof source !== 'object') return '';
    let msg = typeof source.message === 'string' ? source.message.trim() : '';
    const details = [];
    if (source.type) details.push(`类型: ${source.type}`);
    if (source.code !== undefined && source.code !== null && source.code !== '') details.push(`代码: ${source.code}`);
    if (source.param) details.push(`参数: ${source.param}`);
    if (details.length) msg = msg ? `${msg} (${details.join(', ')})` : details.join(', ');
    if (msg) return msg;
    return trimErrorText(JSON.stringify(source));
}

export function buildHttpErrorMessage(resp, rawText, parsedData) {
    const statusText = resp.statusText ? ` ${resp.statusText}` : '';
    const prefix = `HTTP ${resp.status}${statusText}`;
    const apiMessage = extractApiErrorMessage(parsedData);
    if (apiMessage) return `${prefix}: ${apiMessage}`;
    const snippet = trimErrorText(rawText);
    return snippet ? `${prefix}: ${snippet}` : prefix;
}

function parseJsonResponseText(rawText, label) {
    const data = tryParseJsonText(rawText);
    if (data) return data;
    const snippet = trimErrorText(rawText);
    throw new Error(`${label}不是有效 JSON${snippet ? `: ${snippet}` : ''}`);
}

async function readStreamResponse(resp) {
    if (!resp.body) throw new Error('响应无 body，无法流式读取');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let full = '';
    let lastParseIssue = '';

    const handleLine = (input) => {
        let line = String(input || '').trim();
        if (!line || line.startsWith(':') || line.startsWith('event:')) return false;
        if (line.startsWith('data:')) line = line.slice(5).trim();
        if (!line) return false;
        if (line === '[DONE]') return true;
        const json = tryParseJsonText(line);
        if (!json) {
            const snippet = trimErrorText(line);
            if (snippet) lastParseIssue = `流式响应不是有效 JSON: ${snippet}`;
            return false;
        }
        const apiError = extractApiErrorMessage(json);
        if (apiError) throw new Error(apiError);
        const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? '';
        if (delta) full += delta;
        return false;
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
            if (handleLine(line)) return full;
        }
    }
    if (buf.trim()) handleLine(buf);
    if (full) return full;
    if (lastParseIssue) throw new Error(lastParseIssue);
    throw new Error('未收到有效回复。');
}

export const __llmErrorUtils = { trimErrorText, tryParseJsonText, extractApiErrorMessage, buildHttpErrorMessage, parseJsonResponseText };

/**
 * 实际发起一次 OpenAI 兼容的 chat/completions 请求（非流式）。
 * 支持「直连」与「酒馆代理」两种路径，与 ui-llm.js 的逻辑保持一致。
 *
 * @param {Array<{role,content}>} prompt
 * @param {string} type 请求类型
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} 返回 AI 回复文本
 */
export async function executeTypedLLMRequest(prompt, type, signal) {
    const normalizedType = normalizeRequestType(type);
    // 在真正发出请求前，按类型清空 TTS / 音效预览缓存，避免内存累积
    maybeClearPreviewsForSfxRequest(normalizedType);

    const cfg = getEffectiveConfigForRequestType(normalizedType);
    const { api_url, api_key, model, temperature, top_p, max_tokens,
        stream, bypass_proxy, merge_system_user, send_images } = cfg;

    if (!api_url) throw new Error('未配置 API Base URL');
    if (!model) throw new Error('未配置模型');
    if (!api_key) throw new Error('未配置 API Key');

    // 处理输入消息
    let outbound = send_images ? prompt : stripImagesFromMessages(prompt);
    outbound = mergeAdjacentMessages(outbound, merge_system_user);

    const baseUrl = api_url.replace(/\/$/, '');
    const payload = {
        model,
        messages: outbound,
        temperature,
        top_p,
        max_tokens,
        stream: !!stream,
    };

    let url, headers, body;
    if (bypass_proxy) {
        url = baseUrl + '/chat/completions';
        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${api_key}`,
        };
        body = JSON.stringify(payload);
    } else {
        // 通过酒馆后端代理
        let proxyBase = baseUrl;
        if (!proxyBase.endsWith('/v1') && !proxyBase.includes('/v1/')) proxyBase = proxyBase + '/v1';
        proxyBase = proxyBase.replace(/\/v1\/$/, '/v1');
        url = '/api/backends/chat-completions/generate';
        headers = getRequestHeaders();
        body = JSON.stringify({
            ...payload,
            chat_completion_source: 'custom',
            custom_url: proxyBase,
            custom_include_headers: `Authorization: "Bearer ${api_key}"`,
        });
    }

    const resp = bypass_proxy
        ? await fetch(url, { method: 'POST', headers, body, signal })
        : await fetchWithCsrf(url, { method: 'POST', headers, body, signal });

    if (!resp.ok) {
        const rawErrorText = await resp.text().catch(() => '');
        const parsedError = tryParseJsonText(rawErrorText);
        throw new Error(buildHttpErrorMessage(resp, rawErrorText, parsedError));
    }

    if (stream) return readStreamResponse(resp);

    const rawText = await resp.text();
    const data = parseJsonResponseText(rawText, 'LLM 响应');
    const apiError = extractApiErrorMessage(data?.error);
    if (apiError) throw new Error(apiError);
    return data?.choices?.[0]?.message?.content || '';
}

// ─── 设置迁移 ────────────────────────────────────────────────────────

/**
 * 一次性迁移：若 `llm_request_type_configs` 缺失或不完整，按
 * 旧的 `current_llm_profile` / `current_test_context_profile` 填充默认绑定。
 * 同时清理已被删除的预设引用。
 */
export function migrateRequestTypeConfigs() {
    const s = extension_settings[extensionName];
    if (!s) return;

    const llmNames = Object.keys(s.llm_profiles || {});
    const ctxNames = Object.keys(s.test_context_profiles || {});
    const defaultApi = s.current_llm_profile || llmNames[0] || '默认';
    const defaultCtx = s.current_test_context_profile || ctxNames[0] || '默认';

    if (!s.llm_request_type_configs || typeof s.llm_request_type_configs !== 'object') {
        s.llm_request_type_configs = {};
    }

    let dirty = false;
    for (const t of Object.values(LLMRequestTypes)) {
        const cur = s.llm_request_type_configs[t];
        if (!cur || typeof cur !== 'object') {
            s.llm_request_type_configs[t] = {
                api_profile: defaultApi,
                context_profile: defaultCtx,
            };
            dirty = true;
            continue;
        }
        // 清理坏引用
        if (cur.api_profile && llmNames.length && !llmNames.includes(cur.api_profile)) {
            cur.api_profile = defaultApi;
            dirty = true;
        }
        if (cur.context_profile && ctxNames.length && !ctxNames.includes(cur.context_profile)) {
            cur.context_profile = defaultCtx;
            dirty = true;
        }
    }
    return dirty;
}

// @ts-nocheck
/**
 * LLM 调用 + handleSend
 *
 * 复用 ui-llm.js 已有的 LLM 预设体系（extension_settings.llm_profiles），
 * 但因 ui-llm.js 的请求逻辑直接绑死 UI，这里实现独立 callLLM。
 */

import {
    dom, getActiveChat, setIsGenerating, getIsGenerating,
    setAbortController, getAbortController,
    getPendingEditIndex, setPendingEditIndex, clearPendingEdit,
} from './context.js';
import { getEffectiveLLMConfig } from './settingsPanel.js';
import { appendMessage, createStreamingAssistantBubble, scrollToBottom, renderAllMessages } from './message.js';
import { touchActiveChat, flushNow } from './session.js';
import { buildSystemPrompt, parseAndApplyCommands, handleSystemQuery, buildTailReminder, buildAssistantPrefill } from './pluginBridge.js';
import { fetchWithCsrf, getRequestHeaders } from '../helpers.js';
import { __llmErrorUtils } from '../llm-service.js';
const { tryParseJsonText, extractApiErrorMessage, buildHttpErrorMessage, trimErrorText } = __llmErrorUtils;

const MAX_QUERY_ROUNDS = 5; // 防止无限循环 SystemQuery（load_module 后续询常需要 2~3 轮）

/**
 * 把消息中可能存在的图片 part 过滤掉，仅保留文本。
 * 支持 OpenAI 多模态格式：content 为数组、含 { type:'image_url' } / { type:'input_image' } 等。
 */
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

/**
 * 把相邻同角色消息合并为一条；
 * 当 mergeSystemUser=true 时，system 视同 user 一并合并。
 */
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

/**
 * 调用 LLM（OpenAI 兼容 /chat/completions），支持流式 + 酒馆代理 + 合并 + 图片过滤
 * @param {Array<{role,content}>} messages
 * @param {object} cfg - { api_url, api_key, model, temperature, top_p, max_tokens, stream, bypass_proxy, merge_system_user, send_images }
 * @param {AbortSignal} signal
 * @param {(delta:string)=>void} onDelta - 流式回调
 * @returns {Promise<string>} 完整回复文本
 */
async function callLLM(messages, cfg, signal, onDelta) {
    if (!cfg.api_url) throw new Error('未配置 API 地址');
    if (!cfg.model) throw new Error('未配置模型');

    const stream = !!cfg.stream;
    const bypassProxy = !!cfg.bypass_proxy;

    // 1. 图片过滤
    let outbound = cfg.send_images ? messages : stripImagesFromMessages(messages);
    // 2. 合并相邻消息
    outbound = mergeAdjacentMessages(outbound, !!cfg.merge_system_user);

    const baseUrl = cfg.api_url.replace(/\/$/, '');
    const payload = {
        model: cfg.model,
        messages: outbound,
        temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.8,
        top_p: typeof cfg.top_p === 'number' ? cfg.top_p : 1.0,
        max_tokens: typeof cfg.max_tokens === 'number' ? cfg.max_tokens : 8000,
        stream,
    };

    let url, headers, body;
    if (bypassProxy) {
        // 直连 OpenAI 兼容 API
        url = baseUrl + '/chat/completions';
        headers = { 'Content-Type': 'application/json' };
        if (cfg.api_key) headers.Authorization = `Bearer ${cfg.api_key}`;
        body = JSON.stringify(payload);
    } else {
        // 通过酒馆后端代理转发，避免 CORS
        let proxyBase = baseUrl;
        if (!proxyBase.endsWith('/v1') && !proxyBase.includes('/v1/')) proxyBase = proxyBase + '/v1';
        proxyBase = proxyBase.replace(/\/v1\/$/, '/v1');
        url = '/api/backends/chat-completions/generate';
        headers = getRequestHeaders();
        body = JSON.stringify({
            ...payload,
            chat_completion_source: 'custom',
            custom_url: proxyBase,
            custom_include_headers: cfg.api_key ? `Authorization: "Bearer ${cfg.api_key}"` : '',
        });
    }

    const resp = bypassProxy
        ? await fetch(url, { method: 'POST', headers, body, signal })
        : await fetchWithCsrf(url, { method: 'POST', headers, body, signal });

    if (!resp.ok) {
        const rawErrorText = await resp.text().catch(() => '');
        const parsedError = tryParseJsonText(rawErrorText);
        throw new Error(buildHttpErrorMessage(resp, rawErrorText, parsedError));
    }

    if (!stream) {
        const rawText = await resp.text();
        const data = tryParseJsonText(rawText);
        if (!data) {
            const snippet = trimErrorText(rawText);
            throw new Error(`LLM 响应不是有效 JSON${snippet ? `: ${snippet}` : ''}`);
        }
        const apiError = extractApiErrorMessage(data?.error);
        if (apiError) throw new Error(apiError);
        return data?.choices?.[0]?.message?.content || '';
    }

    // ── SSE 流式解析 ──────────────────────────────────────
    if (!resp.body) throw new Error('响应无 body，无法流式读取');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let full = '';
    let lastParseIssue = '';

    const handleLine = (raw) => {
        let line = String(raw || '').trim();
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
        const delta = json?.choices?.[0]?.delta?.content
            ?? json?.choices?.[0]?.message?.content
            ?? '';
        if (delta) {
            full += delta;
            if (typeof onDelta === 'function') onDelta(delta);
        }
        return false;
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop(); // 保留不完整行
        for (const line of lines) {
            if (handleLine(line)) return full;
        }
    }
    if (buf && buf.trim()) handleLine(buf);
    if (full) return full;
    if (lastParseIssue) throw new Error(lastParseIssue);
    return full;
}

/**
 * 把会话历史 + 系统提示词 + 用户消息组装成 messages
 * 多轮 SystemQuery 续询的中间消息直接 push 到 chat.messages，所以这里不需要 scratchHistory。
 */
function buildMessages() {
    const chat = getActiveChat();
    const messages = [];
    messages.push({ role: 'system', content: buildSystemPrompt() });

    // 找最后一条「真用户消息」（排除 <SystemQueryResult> 那种系统反馈）作为尾部提醒里的「用户最新需求」
    let lastRealUserText = '';
    if (chat?.messages?.length) {
        for (const m of chat.messages) {
            if (m && (m.role === 'user' || m.role === 'assistant')) {
                messages.push({ role: m.role, content: m.content || '' });
            }
        }
        for (let i = chat.messages.length - 1; i >= 0; i--) {
            const m = chat.messages[i];
            if (m?.role === 'user' && typeof m.content === 'string'
                && !/<SystemQueryResult>/i.test(m.content)) {
                lastRealUserText = m.content;
                break;
            }
        }
    }

    // 尾部固定 system 提醒（参考 st-chatu8）：再次贴脸提醒工作原则 + 用户最新需求
    messages.push({ role: 'system', content: buildTailReminder(lastRealUserText) });

    // 助手前缀：把模型推到 think 模式开头，避免漏掉 <think> 标签
    messages.push({ role: 'assistant', content: buildAssistantPrefill() });

    return messages;
}

/**
 * 主流程：发送当前输入框文字 → 推入会话 → 调 LLM → 解析指令 →（必要时）二次续询
 */
export async function handleSend() {
    if (getIsGenerating()) return;
    const text = (dom.input?.val() || '').trim();
    if (!text) return;
    const chat = getActiveChat();
    if (!chat) return;

    // 0. 处理「编辑模式」：发送时才真正截断到该索引
    const editIdx = getPendingEditIndex();
    if (editIdx != null && editIdx < chat.messages.length) {
        chat.messages.splice(editIdx);
    }
    clearPendingEdit();
    hideEditBanner();

    // 1. 追加用户消息（带索引）
    chat.messages.push({ role: 'user', content: text });
    const userIdx = chat.messages.length - 1;
    // 编辑模式下需要先把 DOM 重新渲染一遍，再以正确顺序展示
    if (editIdx != null) {
        renderAllMessages(chat.messages);
    } else {
        appendMessage('user', text, userIdx);
    }
    dom.input.val('').css('height', 'auto');
    touchActiveChat();
    // 用户消息立即落库一次，避免在 LLM 回复期间崩溃就丢失
    flushNow().catch((err) => console.error('[ST-IS-AI] flushNow(user) failed:', err));

    await runGeneration();
}

/**
 * 重新生成：从指定 assistant 消息开始，删除该条及之后所有消息，再次走 LLM 流程。
 */
export async function regenerateFromIndex(idx) {
    if (getIsGenerating()) return;
    const chat = getActiveChat();
    if (!chat) return;
    if (!Number.isInteger(idx) || idx < 0 || idx >= chat.messages.length) return;
    // 必须是 assistant 才能"重生成"
    if (chat.messages[idx].role !== 'assistant') return;
    // 取消任何编辑模式
    clearPendingEdit();
    hideEditBanner();
    chat.messages.splice(idx);
    renderAllMessages(chat.messages);
    touchActiveChat();
    await runGeneration();
}

/**
 * 进入编辑模式：把该 user 消息内容回填到输入框，并标记「待发送时截断」。
 * 不立即删除任何消息。用户可以点击取消按钮放弃编辑，或正常发送以执行。
 */
export function editAndResendFromIndex(idx) {
    const chat = getActiveChat();
    if (!chat) return;
    if (!Number.isInteger(idx) || idx < 0 || idx >= chat.messages.length) return;
    const m = chat.messages[idx];
    if (m.role !== 'user') return;

    setPendingEditIndex(idx);
    if (dom.input) {
        dom.input.val(m.content || '');
        const el = dom.input[0];
        if (el) {
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 120) + 'px';
        }
        dom.input.trigger('focus');
    }
    showEditBanner(idx);
    highlightEditingMessage(idx);
}

/**
 * 取消编辑模式（恢复输入框 + 清除高亮）
 */
export function cancelEdit() {
    clearPendingEdit();
    hideEditBanner();
    if (dom.input) {
        dom.input.val('').css('height', 'auto');
    }
    if (dom.chatBody) dom.chatBody.find('.st-is-ai-msg.editing').removeClass('editing');
}

// ── 编辑模式 UI 辅助 ─────────────────────────────────────────
function showEditBanner(idx) {
    if (!dom.dialog) return;
    let $banner = dom.dialog.find('#st-is-ai-edit-banner');
    if (!$banner.length) {
        $banner = $(`
            <div id="st-is-ai-edit-banner" class="st-is-ai-edit-banner">
                <span><i class="fa-solid fa-pen"></i> 正在编辑第 <b class="edit-idx"></b> 条消息（发送后生效）</span>
                <button id="st-is-ai-edit-cancel" class="st-is-ai-mini-btn">
                    <i class="fa-solid fa-xmark"></i> 取消
                </button>
            </div>
        `);
        // 插入到 footer 之前（作为兄弟节点），避免破坏 footer 内 textarea+button 的横向布局
        dom.dialog.find('.st-is-ai-footer').before($banner);
        $banner.find('#st-is-ai-edit-cancel').on('click', () => cancelEdit());
    }
    $banner.find('.edit-idx').text(idx + 1);
    $banner.show();
}

function hideEditBanner() {
    if (!dom.dialog) return;
    dom.dialog.find('#st-is-ai-edit-banner').hide();
    if (dom.chatBody) dom.chatBody.find('.st-is-ai-msg.editing').removeClass('editing');
}

function highlightEditingMessage(idx) {
    if (!dom.chatBody) return;
    dom.chatBody.find('.st-is-ai-msg.editing').removeClass('editing');
    dom.chatBody.find(`.st-is-ai-msg[data-msg-index="${idx}"]`).addClass('editing');
}

/**
 * 删除该条及之后所有消息
 */
export function deleteFromIndex(idx) {
    const chat = getActiveChat();
    if (!chat) return;
    if (!Number.isInteger(idx) || idx < 0 || idx >= chat.messages.length) return;
    chat.messages.splice(idx);
    renderAllMessages(chat.messages);
    touchActiveChat();
}

/**
 * 复制原文到剪贴板
 */
export function copyMessage(idx) {
    const chat = getActiveChat();
    if (!chat) return;
    const m = chat.messages[idx];
    if (!m) return;
    const text = m.content || '';
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            if (typeof toastr !== 'undefined') toastr.info('已复制');
        });
    }
}

/**
 * 实际跑一次 LLM 生成（流式 + SystemQuery 续询）。调用前调用方需保证 chat.messages 末尾是 user。
 */
async function runGeneration() {
    const chat = getActiveChat();
    if (!chat) return;

    const cfg = getEffectiveLLMConfig();
    setIsGenerating(true);
    updateSendButton(true);

    const streamer = createStreamingAssistantBubble();
    const ac = new AbortController();
    setAbortController(ac);

    try {
        let finalReply = '';
        for (let round = 0; round < MAX_QUERY_ROUNDS; round++) {
            const messages = buildMessages();
            const reply = await callLLM(
                messages, cfg, ac.signal,
                (delta) => streamer.append(delta)
            );
            finalReply = reply;

            // 系统查询：派发本轮所有指令
            const q = await handleSystemQuery(reply);
            if (q && q.text) {
                // 续询路径：把本轮 assistant 回复 + 系统返回结果都落到 chat.messages
                // → 用户能在 UI 上看到完整过程（命令折叠 + 结果折叠）
                streamer.finalize(reply);
                chat.messages.push({ role: 'assistant', content: reply });
                chat.messages.push({
                    role: 'user',
                    content: `<SystemQueryResult>\n${q.text}\n</SystemQueryResult>\n\n（以上是系统返回的指令执行结果。请根据它继续推进用户最初的请求：\n- 刚 load_module 完毕？按模块 workflow 继续，不要只回"已加载"。\n- 信息不够就用人话问用户。\n- 操作完成就给最终总结。\n可以再发新的 SystemQuery / UpdateSettings / UIAction，系统会继续执行。）`,
                });
                touchActiveChat();
                flushNow().catch((err) => console.error('[ST-IS-AI] flushNow(round) failed:', err));
                // 执行本轮的非 SystemQuery 指令（UpdateSettings / UIAction）
                parseAndApplyCommands(reply);

                // 重新建一个流式气泡，让下一轮的过程可见
                const nextStreamer = createStreamingAssistantBubble();
                streamer.append = nextStreamer.append;
                streamer.setFull = nextStreamer.setFull;
                streamer.finalize = nextStreamer.finalize;
                streamer.getText = nextStreamer.getText;
                continue;
            }
            break;
        }

        // 最终一轮（无 SystemQuery）的完整回复
        streamer.finalize(finalReply);
        chat.messages.push({ role: 'assistant', content: finalReply });
        touchActiveChat();
        flushNow().catch((err) => console.error('[ST-IS-AI] flushNow(final) failed:', err));
        parseAndApplyCommands(finalReply);
    } catch (e) {
        if (e?.name === 'AbortError') {
            streamer.finalize(streamer.getText() + '\n\n_（已中止）_');
        } else {
            console.error('[ST-IS-AI] LLM error:', e);
            streamer.finalize(`❌ 请求失败: ${e.message || e}`);
            if (typeof toastr !== 'undefined') toastr.error(`AI 助手请求失败: ${e.message || e}`);
        }
        // 把当前已有内容落库
        const partial = streamer.getText();
        if (partial) chat.messages.push({ role: 'assistant', content: partial });
        touchActiveChat();
        flushNow().catch((err) => console.error('[ST-IS-AI] flushNow(catch) failed:', err));
    } finally {
        setIsGenerating(false);
        setAbortController(null);
        updateSendButton(false);
        // 重新渲染：让所有气泡都附上正确的 data-msg-index + 操作按钮
        renderAllMessages(chat.messages);
        scrollToBottom();
    }
}

function updateSendButton(generating) {
    if (!dom.sendBtn) return;
    if (generating) {
        dom.sendBtn.addClass('is-stop').html('<i class="fa-solid fa-stop"></i>').attr('title', '中止');
    } else {
        dom.sendBtn.removeClass('is-stop').html('<i class="fa-solid fa-paper-plane"></i>').attr('title', '发送');
    }
}

/**
 * 中止当前生成
 */
export function abortGeneration() {
    const ac = getAbortController();
    if (ac) ac.abort();
}

/**
 * 绑定输入框 / 发送按钮事件
 */
export function initInputEvents() {
    dom.input?.on('input', function () {
        // 自适应高度
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    dom.input?.on('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            handleSend();
        }
    });
    dom.sendBtn?.on('click', () => {
        if (getIsGenerating()) abortGeneration();
        else handleSend();
    });
}

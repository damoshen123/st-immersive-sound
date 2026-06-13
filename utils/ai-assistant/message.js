// @ts-nocheck
/**
 * 消息渲染：用户/助手气泡、Markdown、<think> 折叠、流式更新器
 */

import { dom, stream } from './context.js';
import { escapeHTML, renderMarkdown, removeThinkBlocks, extractThinkBlocks, stripCommandTags, extractCommandTags, throttle } from './utils.js';

/**
 * 渲染助手消息内容（去掉指令标签 + Markdown + think 折叠）
 */
function renderAssistantHtml(text) {
    const raw = text || '';
    // 解析顺序非常重要：
    // 1) 先把 SystemQuery / UpdateSettings / UIAction 命令抽出 & 剥离掉
    //    → 防止 <think> 没闭合时，「未闭合 think 兜底」把后面的命令吞进思考块
    // 2) 在「剥离命令后的文本」里再识别 <think>...</think>
    const cmds = extractCommandTags(raw);
    const noCmds = stripCommandTags(raw);
    const thinks = extractThinkBlocks(noCmds);
    const visible = removeThinkBlocks(noCmds).trim();

    let html = '';
    if (thinks.length) {
        for (const t of thinks) {
            html += `<details class="st-is-ai-think"><summary>💭 思考</summary><div>${escapeHTML(t).replace(/\n/g,'<br>')}</div></details>`;
        }
    }
    if (visible) {
        html += `<div class="msg-md">${renderMarkdown(visible)}</div>`;
    } else if (cmds.length && !thinks.length) {
        html += `<div class="msg-md"><i style="opacity:0.7;">已调用内部工具…</i></div>`;
    }
    if (cmds.length) {
        html += `<details class="st-is-ai-cmd"><summary><i class="fa-solid fa-microchip"></i> 执行内部命令 (${cmds.length})</summary><pre>${escapeHTML(cmds.join('\n'))}</pre></details>`;
    }
    return html;
}

function renderUserHtml(text) {
    const t = text || '';
    const m = t.match(/<SystemQueryResult>([\s\S]*?)<\/SystemQueryResult>/i);
    if (m) {
        const inner = m[1].trim();
        const tail = t.replace(/<SystemQueryResult>[\s\S]*?<\/SystemQueryResult>/i, '').trim();
        let html = `<details class="st-is-ai-query-result"><summary><i class="fa-solid fa-code"></i> 内部工具查询结果（点击展开）</summary><pre>${escapeHTML(inner)}</pre></details>`;
        if (tail) html += `<div class="msg-md tail">${escapeHTML(tail).replace(/\n/g,'<br>')}</div>`;
        return html;
    }
    return `<div class="msg-md">${escapeHTML(t).replace(/\n/g,'<br>')}</div>`;
}

/**
 * 在底部追加一条消息
 * @param {'user'|'assistant'|'system'} role
 * @param {string} text
 * @param {number|null} index - 在 chat.messages 中的下标，null 表示不可操作（如欢迎语、流式中）
 * @returns {jQuery} 消息根元素
 */
export function appendMessage(role, text, index = null) {
    const isUser = role === 'user';
    const isSys = role === 'system';
    const cls = isUser ? 'user-msg' : (isSys ? 'system-msg' : 'assistant-msg');
    const avatarIcon = isUser ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';

    const $msg = $(`
        <div class="st-is-ai-msg ${cls}">
            <div class="msg-avatar">${avatarIcon}</div>
            <div class="msg-content"></div>
        </div>
    `);
    if (typeof index === 'number') $msg.attr('data-msg-index', index);
    const $content = $msg.find('.msg-content');
    if (isUser) $content.html(renderUserHtml(text));
    else $content.html(renderAssistantHtml(text));

    if (typeof index === 'number' && !isSys) {
        $content.append(buildActionsHtml(role));
    }

    dom.chatBody.append($msg);
    scrollToBottom();
    return $msg;
}

function buildActionsHtml(role) {
    if (role === 'user') {
        return `
        <div class="msg-actions">
            <button class="act-edit" title="编辑并重新发送"><i class="fa-solid fa-pen"></i> 编辑</button>
            <button class="act-delete" title="删除该条及之后"><i class="fa-solid fa-trash"></i></button>
        </div>`;
    }
    return `
    <div class="msg-actions">
        <button class="act-regenerate" title="重新生成"><i class="fa-solid fa-rotate"></i> 重生成</button>
        <button class="act-copy" title="复制原文"><i class="fa-solid fa-copy"></i></button>
        <button class="act-delete" title="删除该条及之后"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}

/**
 * 绑定消息区动作事件委派（在 init 时调一次）
 * @param {object} cb { onEdit(idx, text), onRegenerate(idx), onDelete(idx) }
 */
export function bindMessageActions(cb) {
    if (!dom.chatBody) return;
    dom.chatBody.off('click.stIsAiMsg').on('click.stIsAiMsg', '.msg-actions button', function (e) {
        e.preventDefault();
        const $btn = $(this);
        const $msg = $btn.closest('.st-is-ai-msg');
        const idx = parseInt($msg.attr('data-msg-index'), 10);
        if (Number.isNaN(idx)) return;
        if ($btn.hasClass('act-edit')) cb.onEdit?.(idx);
        else if ($btn.hasClass('act-regenerate')) cb.onRegenerate?.(idx);
        else if ($btn.hasClass('act-delete')) cb.onDelete?.(idx);
        else if ($btn.hasClass('act-copy')) cb.onCopy?.(idx);
    });
}

/**
 * 用流式数据替换助手气泡的内容
 */
export function setAssistantContent($msgEl, text) {
    if (!$msgEl || !$msgEl.length) return;
    $msgEl.find('.msg-content').html(renderAssistantHtml(text));
}

/**
 * 创建一个用于流式更新的助手气泡 + 节流刷新函数
 */
export function createStreamingAssistantBubble() {
    const $msg = appendMessage('assistant', '');
    stream.msgEl = $msg;
    stream.contentEl = $msg.find('.msg-content');
    let buf = '';

    const flush = throttle(() => {
        if (!stream.msgEl) return;
        setAssistantContent(stream.msgEl, buf);
        scrollToBottomIfNear();
    }, 100);

    function append(delta) {
        buf += delta;
        flush();
    }
    function setFull(text) {
        buf = text;
        if (stream.msgEl) setAssistantContent(stream.msgEl, buf);
    }
    function finalize(text) {
        buf = text != null ? text : buf;
        if (stream.msgEl) setAssistantContent(stream.msgEl, buf);
        scrollToBottomIfNear();
        const result = { msgEl: stream.msgEl, finalText: buf };
        stream.msgEl = null;
        stream.contentEl = null;
        return result;
    }
    function getText() { return buf; }
    return { append, setFull, finalize, getText };
}

/**
 * 渲染整个会话的所有消息
 */
export function renderAllMessages(messages) {
    if (!dom.chatBody) return;
    dom.chatBody.empty();
    if (!messages || !messages.length) {
        appendMessage('system', '👋 你好，我是「声临其境」AI 助手。我可以帮你查询和操作本插件的设置，有什么需要？');
        return;
    }
    messages.forEach((m, i) => appendMessage(m.role, m.content, i));
}

export function scrollToBottom() {
    if (!dom.chatBody || !dom.chatBody[0]) return;
    dom.chatBody.scrollTop(dom.chatBody[0].scrollHeight);
}

/**
 * 仅当用户已经接近底部时才自动滚动（避免打断用户向上翻阅）
 */
export function scrollToBottomIfNear() {
    const el = dom.chatBody?.[0];
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 80) el.scrollTop = el.scrollHeight;
}

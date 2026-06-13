// @ts-nocheck
/**
 * 多会话管理：新建 / 切换 / 删除 / 重命名 / 历史面板渲染 / 持久化（IndexedDB）
 */

import { dom, getActiveChat, setActiveChat, getChatIndex, setChatIndex, clearPendingEdit } from './context.js';
import { generateId, debounce, escapeHTML } from './utils.js';
import {
    saveChatIndex as dbSaveIndex,
    getChatIndex as dbGetIndex,
    saveChatData as dbSaveChat,
    getChatData as dbGetChat,
    deleteChatData as dbDeleteChat,
} from './configDatabase.js';
import { renderAllMessages, appendMessage } from './message.js';

const _saveActiveChatDebounced = debounce(async () => {
    const chat = getActiveChat();
    if (!chat || !chat.id) return;
    try { await dbSaveChat(chat.id, chat); }
    catch (e) { console.error('[ST-IS-AI] saveChatData failed:', e); }

    const idx = getChatIndex();
    const item = idx.chatList.find((c) => c.id === chat.id);
    if (item) {
        item.title = chat.title;
        item.updatedAt = chat.updatedAt;
        idx.chatList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        try { await dbSaveIndex(idx); } catch (e) { console.error(e); }
    }
}, 200);

/**
 * 立即把 active chat + index 落库（用于新建/删除/每轮 LLM 完成等关键时刻）
 */
export async function flushNow() {
    const chat = getActiveChat();
    if (chat && chat.id) {
        try { await dbSaveChat(chat.id, chat); } catch (e) { console.error(e); }
    }
    try { await dbSaveIndex(getChatIndex()); } catch (e) { console.error(e); }
}

// 页面卸载/切到后台时强制 flush 一次，避免 debounce 内的最后一轮丢失
function _bindUnloadFlush() {
    const handler = () => {
        const chat = getActiveChat();
        if (chat && chat.id) {
            // IndexedDB 不能阻塞，但 put 请求会被浏览器排队；fire-and-forget 即可
            try { dbSaveChat(chat.id, chat); } catch (e) { /* ignore */ }
        }
        try { dbSaveIndex(getChatIndex()); } catch (e) { /* ignore */ }
    };
    window.addEventListener('beforeunload', handler);
    window.addEventListener('pagehide', handler);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') handler();
    });
}
let _unloadBound = false;

/**
 * 把当前活动会话标记 dirty，并节流持久化
 * 同时把首条用户消息的前 24 字符作为标题（如果还是默认）
 */
export function touchActiveChat() {
    const chat = getActiveChat();
    if (!chat) return;
    chat.updatedAt = Date.now();

    if ((chat.title === '新对话' || !chat.title) && Array.isArray(chat.messages)) {
        const firstUser = chat.messages.find((m) => m.role === 'user');
        if (firstUser && typeof firstUser.content === 'string') {
            const t = firstUser.content.replace(/\s+/g, ' ').slice(0, 24);
            if (t) chat.title = t;
        }
    }

    const idx = getChatIndex();
    const item = idx.chatList.find((c) => c.id === chat.id);
    if (item) {
        item.title = chat.title;
        item.updatedAt = chat.updatedAt;
    }
    _saveActiveChatDebounced();
}

/**
 * 新建会话并设为活动
 */
export async function createNewChat({ render = true } = {}) {
    clearPendingEdit();
    const $banner = dom.dialog?.find('#st-is-ai-edit-banner'); if ($banner?.length) $banner.hide();
    const chat = {
        id: generateId('chat'),
        title: '新对话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
    };
    setActiveChat(chat);

    const idx = getChatIndex();
    idx.activeChatId = chat.id;
    idx.chatList.unshift({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt });
    setChatIndex(idx);

    await flushNow();

    if (render) {
        renderAllMessages([]);
        renderHistoryPanel();
    }
    return chat;
}

/**
 * 切换会话
 */
export async function switchChat(chatId) {
    if (!chatId) return;
    const chat = await dbGetChat(chatId);
    if (!chat) {
        console.warn('[ST-IS-AI] switchChat: chat not found:', chatId);
        return;
    }
    clearPendingEdit();
    const $banner = dom.dialog?.find('#st-is-ai-edit-banner'); if ($banner?.length) $banner.hide();
    setActiveChat(chat);
    const idx = getChatIndex();
    idx.activeChatId = chatId;
    setChatIndex(idx);
    try { await dbSaveIndex(idx); } catch (e) { console.error(e); }
    renderAllMessages(chat.messages);
    renderHistoryPanel();
}

/**
 * 删除会话
 */
export async function deleteChat(chatId) {
    if (!chatId) return;
    const idx = getChatIndex();
    idx.chatList = idx.chatList.filter((c) => c.id !== chatId);
    try { await dbDeleteChat(chatId); } catch (e) { console.error(e); }

    if (idx.activeChatId === chatId) {
        if (idx.chatList.length) {
            await switchChat(idx.chatList[0].id);
        } else {
            await createNewChat();
        }
    } else {
        await flushNow();
        renderHistoryPanel();
    }
}

/**
 * 渲染历史面板
 */
export function renderHistoryPanel() {
    const $list = dom.dialog?.find('#st-is-ai-history-list');
    if (!$list || !$list.length) return;
    const idx = getChatIndex();
    $list.empty();
    if (!idx.chatList.length) {
        $list.html('<div style="color:var(--st-is-text-secondary); padding:12px; text-align:center;">暂无聊天记录</div>');
        return;
    }
    for (const c of idx.chatList) {
        const isActive = c.id === idx.activeChatId;
        const time = new Date(c.updatedAt || 0).toLocaleString();
        const $item = $(`
            <div class="st-is-ai-history-item ${isActive ? 'active' : ''}" data-chat-id="${c.id}">
                <div class="h-title" title="${escapeHTML(c.title)}">${escapeHTML(c.title || '未命名')}</div>
                <div class="h-meta">${time}</div>
                <button class="h-del" title="删除"><i class="fa-solid fa-trash"></i></button>
            </div>
        `);
        $list.append($item);
    }
    $list.off('click.stIsAi').on('click.stIsAi', '.st-is-ai-history-item', async function (e) {
        const $btn = $(e.target).closest('.h-del');
        const id = $(this).data('chat-id');
        if ($btn.length) {
            if (confirm('确定删除该会话？')) await deleteChat(id);
            e.stopPropagation();
            return;
        }
        await switchChat(id);
        dom.dialog.find('#st-is-ai-history-panel').hide();
    });
}

/**
 * 启动时载入索引和当前会话
 */
export async function initSessionState() {
    let idx = await dbGetIndex();
    if (!idx) idx = { version: 1, activeChatId: null, chatList: [] };
    setChatIndex(idx);

    if (idx.activeChatId) {
        const chat = await dbGetChat(idx.activeChatId);
        if (chat) {
            setActiveChat(chat);
            return;
        }
    }
    if (idx.chatList.length) {
        const first = await dbGetChat(idx.chatList[0].id);
        if (first) {
            setActiveChat(first);
            idx.activeChatId = first.id;
            await dbSaveIndex(idx);
            return;
        }
    }
    // 啥都没有 → 新建一个
    await createNewChat({ render: false });
}

/**
 * 绑定头部「新建聊天」按钮
 */
export function initSessionEvents() {
    dom.newChatBtn?.on('click', async () => {
        await createNewChat();
    });

    // 初次显示时渲染历史面板
    renderHistoryPanel();

    // 绑定一次页面卸载兜底 flush
    if (!_unloadBound) {
        _bindUnloadFlush();
        _unloadBound = true;
    }
}

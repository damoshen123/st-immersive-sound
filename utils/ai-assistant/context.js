// @ts-nocheck
/**
 * AI 助手共享上下文 —— DOM 引用 / 全局状态
 */

// DOM 引用（initDomRefs 后填充）
export const dom = {
    dialog: null,           // jQuery #st-is-ai-dialog
    chatBody: null,         // jQuery #st-is-ai-chat-body
    input: null,            // jQuery textarea
    sendBtn: null,          // jQuery 发送按钮
    settingsBtn: null,
    settingsPanel: null,
    historyBtn: null,
    historyPanel: null,
    newChatBtn: null,
    closeBtn: null,
    trigger: null,          // 设置面板里的 🤖 触发图标
};

// 当前活动会话 { id, title, createdAt, updatedAt, messages: [] }
let _activeChat = null;
export function getActiveChat() { return _activeChat; }
export function setActiveChat(chat) { _activeChat = chat; }

// 会话索引 { version, activeChatId, chatList: [{id,title,updatedAt}] }
let _chatIndex = { version: 1, activeChatId: null, chatList: [] };
export function getChatIndex() { return _chatIndex; }
export function setChatIndex(idx) { _chatIndex = idx; }

// 是否正在生成
let _isGenerating = false;
export function getIsGenerating() { return _isGenerating; }
export function setIsGenerating(v) { _isGenerating = !!v; }

// 当前 LLM 请求 AbortController
let _abortController = null;
export function getAbortController() { return _abortController; }
export function setAbortController(c) { _abortController = c; }

// 编辑模式：当前正在被编辑的消息索引（点击「编辑」后到「发送」前的状态）
// null 表示无；当用户真正点击发送时才会按此索引截断历史并发送新内容
let _pendingEditIndex = null;
export function getPendingEditIndex() { return _pendingEditIndex; }
export function setPendingEditIndex(i) { _pendingEditIndex = (Number.isInteger(i) && i >= 0) ? i : null; }
export function clearPendingEdit() { _pendingEditIndex = null; }

// 当前流式接收的助手气泡 jQuery 元素 / 内容元素
export const stream = {
    msgEl: null,
    contentEl: null,
};

// 设置面板刷新回调（外部可调）
let _refreshSettingsFn = null;
export function setRefreshSettingsFn(fn) { _refreshSettingsFn = fn; }
export function callRefreshSettings() {
    if (typeof _refreshSettingsFn === 'function') _refreshSettingsFn();
}

export function initDomRefs(dialog) {
    dom.dialog = dialog;
    dom.chatBody = dialog.find('#st-is-ai-chat-body');
    dom.input = dialog.find('#st-is-ai-input');
    dom.sendBtn = dialog.find('#st-is-ai-send');
    dom.settingsBtn = dialog.find('#st-is-ai-settings-btn');
    dom.settingsPanel = dialog.find('#st-is-ai-settings-panel');
    dom.historyBtn = dialog.find('#st-is-ai-history-btn');
    dom.historyPanel = dialog.find('#st-is-ai-history-panel');
    dom.newChatBtn = dialog.find('#st-is-ai-new-chat');
    dom.closeBtn = dialog.find('#st-is-ai-close');
}

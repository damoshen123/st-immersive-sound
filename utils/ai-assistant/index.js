// @ts-nocheck
/**
 * AI 助手编排入口
 * 对外仅暴露 initAiAssistant() 与 refreshAiAssistantSettings()
 */

import { extensionFolderPath } from '../config.js';
import { loadMarked } from './utils.js';
import { initDialog } from './dialog.js';
import { initSettingsPanel, refreshSettingsPanel } from './settingsPanel.js';
import { initSessionState, initSessionEvents, renderHistoryPanel } from './session.js';
import { renderAllMessages, bindMessageActions } from './message.js';
import { initInputEvents, regenerateFromIndex, editAndResendFromIndex, deleteFromIndex, copyMessage } from './llm.js';
import { getActiveChat } from './context.js';

let _initialized = false;

/**
 * 注入 AI 助手 CSS
 */
function injectCss() {
    const id = 'st-is-ai-assistant-css';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `${extensionFolderPath}/css/ai-assistant.css`;
    document.head.appendChild(link);
}

export async function initAiAssistant() {
    if (_initialized) return;
    _initialized = true;

    try {
        injectCss();

        // 预加载 marked（失败不阻塞）
        loadMarked().catch(() => console.warn('[ST-IS-AI] marked.js 加载失败，使用纯文本模式'));

        // 1. 注入 HTML / 触发器 / 拖拽
        await initDialog();

        // 2. 设置面板
        initSettingsPanel();

        // 3. 加载会话索引 + 当前会话
        await initSessionState();

        // 4. 渲染当前会话消息
        const chat = getActiveChat();
        renderAllMessages(chat ? chat.messages : []);

        // 5. 历史面板 + 新建按钮
        initSessionEvents();
        renderHistoryPanel();

        // 6. 输入区 + 发送按钮
        initInputEvents();

        // 7. 消息操作按钮（编辑/重生成/删除/复制）
        bindMessageActions({
            onEdit: editAndResendFromIndex,
            onRegenerate: regenerateFromIndex,
            onDelete: deleteFromIndex,
            onCopy: copyMessage,
        });

        console.log('[ST-IS-AI] AI 助手初始化完成');
    } catch (e) {
        console.error('[ST-IS-AI] 初始化失败:', e);
    }
}

export function refreshAiAssistantSettings() {
    try { refreshSettingsPanel(); } catch (e) { /* ignore */ }
}

// @ts-nocheck
/**
 * 对话框：注入 HTML / 触发器按钮 / 显隐 / 拖拽 / 缩放 / 历史面板与设置面板切换
 */

import { extension_settings } from '../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../script.js';
import { extensionName, extensionFolderPath } from '../config.js';
import { dom, initDomRefs } from './context.js';

let _initialized = false;

/**
 * 加载 ai-assistant.html 模板并注入到 body
 */
async function injectDialogHtml() {
    if (document.getElementById('st-is-ai-dialog')) return; // 已存在
    const html = await $.get(`${extensionFolderPath}/ai-assistant.html`);
    $('body').append(html);
}

/**
 * 在设置面板标题区注入触发图标
 * 目标：`#st-immersive-sound-settings-modal .st-is-modal-header`
 */
function injectTrigger() {
    const $header = $('#st-immersive-sound-settings-modal .st-is-modal-header');
    if (!$header.length) return;
    if ($header.find('#st-is-ai-trigger').length) return;
    const $trigger = $(`
        <span id="st-is-ai-trigger" class="st-is-ai-trigger" title="呼唤 AI 助手">
            <i class="fa-solid fa-robot"></i>
        </span>
    `);
    // 放到 h2 里、紧跟在版本号 / 更新提示之后
    const $h2 = $header.find('h2').first();
    const $anchor = $h2.find('#st-is-title-update-notification, #st-is-version-display').last();
    if ($anchor.length) $anchor.after($trigger);
    else $h2.append($trigger);
    $trigger.on('click', () => {
        toggleDialog();
    });
}

export function showDialog() {
    if (!dom.dialog) return;
    dom.dialog.show();
    setTimeout(() => dom.input?.trigger('focus'), 50);
}

export function hideDialog() {
    if (!dom.dialog) return;
    dom.dialog.hide();
}

export function toggleDialog() {
    if (!dom.dialog) return;
    if (dom.dialog.is(':visible')) hideDialog();
    else showDialog();
}

/**
 * 应用 UI 状态（位置/尺寸）
 */
function applyUiState() {
    const cfg = extension_settings[extensionName]?.ai_assistant?.ui;
    if (!cfg || !dom.dialog) return;
    if (cfg.width) dom.dialog.css('width', cfg.width + 'px');
    if (cfg.height) dom.dialog.css('height', cfg.height + 'px');
    if (typeof cfg.x === 'number' && typeof cfg.y === 'number') {
        dom.dialog.css({ left: cfg.x + 'px', top: cfg.y + 'px', right: 'auto', bottom: 'auto' });
    }
}

function saveUiState(patch) {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].ai_assistant = extension_settings[extensionName].ai_assistant || {};
    const ui = extension_settings[extensionName].ai_assistant.ui || {};
    Object.assign(ui, patch);
    extension_settings[extensionName].ai_assistant.ui = ui;
    saveSettingsDebounced();
}

/**
 * 拖拽
 */
function initDrag() {
    const $header = dom.dialog.find('.st-is-ai-header');
    let dragging = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    $header.on('mousedown', (e) => {
        if ($(e.target).closest('.st-is-ai-icon-btn, .st-is-ai-close').length) return;
        dragging = true;
        const rect = dom.dialog[0].getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        startX = e.clientX;
        startY = e.clientY;
        $('body').css('user-select', 'none');
        e.preventDefault();
    });

    $(document).on('mousemove.stIsAiDrag', (e) => {
        if (!dragging) return;
        const nx = origLeft + (e.clientX - startX);
        const ny = origTop + (e.clientY - startY);
        dom.dialog.css({ left: nx + 'px', top: ny + 'px', right: 'auto', bottom: 'auto' });
    });

    $(document).on('mouseup.stIsAiDrag', () => {
        if (!dragging) return;
        dragging = false;
        $('body').css('user-select', '');
        const rect = dom.dialog[0].getBoundingClientRect();
        saveUiState({ x: Math.round(rect.left), y: Math.round(rect.top) });
    });
}

/**
 * 缩放
 */
function initResize() {
    const $handle = dom.dialog.find('.st-is-ai-resize-handle');
    let resizing = false;
    let startX = 0, startY = 0, origW = 0, origH = 0;

    $handle.on('mousedown', (e) => {
        resizing = true;
        const rect = dom.dialog[0].getBoundingClientRect();
        origW = rect.width;
        origH = rect.height;
        startX = e.clientX;
        startY = e.clientY;
        $('body').css('user-select', 'none');
        e.preventDefault();
    });
    $(document).on('mousemove.stIsAiResize', (e) => {
        if (!resizing) return;
        const w = Math.max(320, origW + (e.clientX - startX));
        const h = Math.max(360, origH + (e.clientY - startY));
        dom.dialog.css({ width: w + 'px', height: h + 'px' });
    });
    $(document).on('mouseup.stIsAiResize', () => {
        if (!resizing) return;
        resizing = false;
        $('body').css('user-select', '');
        const rect = dom.dialog[0].getBoundingClientRect();
        saveUiState({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
}

/**
 * 关闭、设置、历史面板按钮
 */
function initPanels() {
    dom.closeBtn.on('click', () => hideDialog());

    const settingsPanel = dom.settingsPanel;
    const historyPanel = dom.historyPanel;

    dom.settingsBtn.on('click', () => {
        historyPanel.hide();
        settingsPanel.toggle();
    });
    dom.dialog.find('#st-is-ai-settings-close').on('click', () => settingsPanel.hide());

    dom.historyBtn.on('click', () => {
        settingsPanel.hide();
        historyPanel.toggle();
    });
    dom.dialog.find('#st-is-ai-history-close').on('click', () => historyPanel.hide());

    // 设置 Tab 切换
    dom.dialog.find('.st-is-ai-panel-tab').on('click', function () {
        const t = $(this).data('panel-tab');
        dom.dialog.find('.st-is-ai-panel-tab').removeClass('active');
        $(this).addClass('active');
        dom.dialog.find('.st-is-ai-panel-content').removeClass('active');
        dom.dialog.find(`.st-is-ai-panel-content[data-panel-content="${t}"]`).addClass('active');
    });
}

/**
 * 初始化对话框（注入 HTML + 绑定事件）
 * @returns {Promise<void>}
 */
export async function initDialog() {
    if (_initialized) return;
    _initialized = true;

    await injectDialogHtml();
    const dialog = $('#st-is-ai-dialog');
    initDomRefs(dialog);
    injectTrigger();
    applyUiState();
    initDrag();
    initResize();
    initPanels();
}

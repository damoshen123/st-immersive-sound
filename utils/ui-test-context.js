/* global toastr */
// @ts-nocheck
/**
 * ui-test-context.js
 * 「测试上下文」预设管理（参考 st-chatu8 上下文预设格式）
 *
 * 数据结构：
 *   extension_settings[extensionName].test_context_profiles = {
 *       "<name>": {
 *           entries: [
 *               { id, name, role, content, enabled, triggerMode, triggerWords }
 *           ]
 *       }
 *   };
 *   extension_settings[extensionName].current_test_context_profile = "<name>";
 */

import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced, eventSource } from "../../../../../script.js";
import { extensionName, eventNames } from "./config.js";

// ==================== DOM 缓存 ====================

let testContextSelect;
let presetEntriesContainer;

// ==================== 状态 ====================

let entryIdCounter = 0;
let currentEditingEntry = null;

// ==================== 工具函数 ====================

function generateEntryId() {
    return `entry_${Date.now()}_${++entryIdCounter}`;
}

function escapeHtml(text) {
    if (text === undefined || text === null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function getRoleBadgeText(role) {
    const map = { system: 'SYS', user: 'USR', assistant: 'AI' };
    return map[role] || 'USR';
}

/**
 * 旧格式 → 新格式迁移
 * 旧格式：{ history: [{ user, assistant }] }
 * 新格式：{ entries: [...] }
 */
function migrateOldContextData(contextData) {
    if (contextData && Array.isArray(contextData.entries)) {
        return contextData;
    }
    if (contextData && Array.isArray(contextData.history)) {
        const entries = [];
        contextData.history.forEach((h, i) => {
            if (h.user && String(h.user).trim()) {
                entries.push({
                    id: generateEntryId(),
                    name: `用户消息 ${i + 1}`,
                    role: 'user',
                    content: h.user,
                    enabled: true,
                    triggerMode: 'always',
                    triggerWords: ''
                });
            }
            if (h.assistant && String(h.assistant).trim()) {
                entries.push({
                    id: generateEntryId(),
                    name: `AI回复 ${i + 1}`,
                    role: 'assistant',
                    content: h.assistant,
                    enabled: true,
                    triggerMode: 'always',
                    triggerWords: ''
                });
            }
        });
        if (entries.length === 0) {
            entries.push({
                id: generateEntryId(),
                name: '系统提示',
                role: 'system',
                content: '',
                enabled: true,
                triggerMode: 'always',
                triggerWords: ''
            });
        }
        return { entries };
    }
    return {
        entries: [{
            id: generateEntryId(),
            name: '系统提示',
            role: 'system',
            content: '',
            enabled: true,
            triggerMode: 'always',
            triggerWords: ''
        }]
    };
}

/**
 * worldBooks 格式 → 内部 entries 格式
 */
function convertWorldBooksToEntries(worldBooks) {
    const entries = [];
    (worldBooks || []).forEach((book, index) => {
        const isAlwaysOn = book.triggerMode === 'blue';
        const triggerWords = Array.isArray(book.keywords) ? book.keywords.join(', ') : (book.keywords || '');
        entries.push({
            id: book.id || generateEntryId(),
            name: book.name || `条目 ${index + 1}`,
            role: book.role || 'system',
            content: book.content || '',
            enabled: book.enabled !== false && book.active !== false,
            triggerMode: isAlwaysOn ? 'always' : 'trigger',
            triggerWords: triggerWords
        });
    });
    return { entries };
}

function detectImportFormat(data) {
    if (Array.isArray(data) && data.length > 0 && data[0].worldBooks) return 'worldBooksArrayOuter';
    if (data && data.worldBooks && Array.isArray(data.worldBooks)) return 'worldBooks';
    if (!Array.isArray(data) && data && typeof data === 'object') {
        const keys = Object.keys(data);
        if (keys.length > 0) {
            const v = data[keys[0]];
            if (v && (v.entries || v.history)) return 'standard';
        }
    }
    return 'unknown';
}

// ==================== 编辑弹窗 ====================

function getEntryEditModalHTML() {
    return `
        <div class="st-is-entry-edit-modal-backdrop" id="entry-edit-modal">
            <div class="st-is-entry-edit-modal">
                <div class="st-is-entry-edit-modal-header">
                    <h4>编辑条目</h4>
                    <span class="st-is-entry-edit-modal-close">&times;</span>
                </div>
                <div class="st-is-entry-edit-modal-body">
                    <div class="st-is-modal-field">
                        <label>条目名称</label>
                        <input type="text" id="modal-entry-name" class="st-is-text-input" placeholder="条目名称" />
                    </div>
                    <div class="st-is-modal-field-row">
                        <div class="st-is-modal-field">
                            <label>角色</label>
                            <select id="modal-entry-role" class="st-is-select">
                                <option value="system">System</option>
                                <option value="user">User</option>
                                <option value="assistant">Assistant</option>
                            </select>
                        </div>
                        <div class="st-is-modal-field">
                            <label>触发模式</label>
                            <select id="modal-trigger-mode" class="st-is-select">
                                <option value="always">常开</option>
                                <option value="trigger">触发</option>
                            </select>
                        </div>
                        <div class="st-is-modal-field st-is-modal-toggle-field">
                            <label>启用</label>
                            <label class="st-is-toggle">
                                <input id="modal-entry-enabled" type="checkbox" checked />
                                <span class="st-is-slider"></span>
                            </label>
                        </div>
                    </div>
                    <div class="st-is-modal-field" id="modal-trigger-words-container" style="display: none;">
                        <label>触发词（逗号分隔）</label>
                        <input type="text" id="modal-trigger-words" class="st-is-text-input" placeholder="触发词1, 触发词2" />
                    </div>
                    <div class="st-is-modal-field">
                        <label>内容</label>
                        <textarea id="modal-entry-content" class="st-is-textarea" rows="10" placeholder="输入内容..."></textarea>
                    </div>
                </div>
                <div class="st-is-entry-edit-modal-footer">
                    <button class="st-is-btn st-is-modal-cancel-btn">取消</button>
                    <button class="st-is-btn st-is-btn-primary st-is-modal-save-btn">保存</button>
                </div>
            </div>
        </div>
    `;
}

function ensureEditModal() {
    let $modal = $('#entry-edit-modal');
    if ($modal.length) return $modal;
    $('body').append(getEntryEditModalHTML());
    $modal = $('#entry-edit-modal');

    $modal.find('.st-is-entry-edit-modal-close').on('click', closeEntryEditModal);
    $modal.find('.st-is-modal-cancel-btn').on('click', closeEntryEditModal);
    $modal.find('.st-is-modal-save-btn').on('click', saveEntryFromModal);

    $modal.find('#modal-trigger-mode').on('change', function () {
        const $c = $modal.find('#modal-trigger-words-container');
        if ($(this).val() === 'trigger') $c.show(); else $c.hide();
    });
    return $modal;
}

function showEntryEditModal($entry) {
    currentEditingEntry = $entry;
    const $modal = ensureEditModal();

    $modal.find('#modal-entry-name').val($entry.find('.st-is-entry-name').val() || $entry.attr('data-name') || '');
    $modal.find('#modal-entry-role').val($entry.attr('data-role') || 'user');
    $modal.find('#modal-entry-enabled').prop('checked', !$entry.hasClass('disabled'));
    $modal.find('#modal-trigger-mode').val($entry.attr('data-trigger-mode') || 'always').trigger('change');
    $modal.find('#modal-trigger-words').val($entry.attr('data-trigger-words') || '');
    $modal.find('#modal-entry-content').val($entry.find('.st-is-entry-content').val() || '');

    $modal.css('display', 'flex').hide().fadeIn(150);
}

function closeEntryEditModal() {
    const $modal = $('#entry-edit-modal');
    if ($modal.length) $modal.fadeOut(150);
    currentEditingEntry = null;
}

function saveEntryFromModal() {
    if (!currentEditingEntry) {
        closeEntryEditModal();
        return;
    }
    const $modal = $('#entry-edit-modal');
    const $entry = currentEditingEntry;

    const name = $modal.find('#modal-entry-name').val();
    const role = $modal.find('#modal-entry-role').val();
    const enabled = $modal.find('#modal-entry-enabled').is(':checked');
    const triggerMode = $modal.find('#modal-trigger-mode').val();
    const triggerWords = $modal.find('#modal-trigger-words').val();
    const content = $modal.find('#modal-entry-content').val();

    $entry.find('.st-is-entry-name').val(name);
    $entry.attr('data-name', name);
    $entry.attr('data-role', role);
    $entry.find('.st-is-entry-role-badge').text(getRoleBadgeText(role)).attr('data-role', role);
    $entry.attr('data-trigger-mode', triggerMode);
    $entry.attr('data-trigger-words', triggerWords);
    $entry.find('.st-is-entry-content').val(content);

    $entry.find('.st-is-entry-toggle input').prop('checked', enabled);
    if (enabled) $entry.removeClass('disabled'); else $entry.addClass('disabled');

    const preview = content && content.length > 50 ? content.substring(0, 50) + '...' : (content || '(空)');
    $entry.find('.st-is-entry-preview').text(preview);

    autoSaveCurrentContext();
    if (window.toastr) toastr.success('条目已更新并保存');
    closeEntryEditModal();
}

// ==================== 条目渲染 ====================

function buildEntryElement(entry, index) {
    const id = entry.id || generateEntryId();
    const name = entry.name || `条目 ${index + 1}`;
    const role = entry.role || 'user';
    const content = entry.content || '';
    const enabled = entry.enabled !== false;
    const triggerMode = entry.triggerMode || 'always';
    const triggerWords = entry.triggerWords || '';
    const disabledClass = enabled ? '' : 'disabled';
    const preview = content.length > 50 ? content.substring(0, 50) + '...' : (content || '(空)');

    return $(`
        <div class="st-is-preset-entry ${disabledClass}"
             data-entry-id="${escapeHtml(id)}"
             data-name="${escapeHtml(name)}"
             data-role="${escapeHtml(role)}"
             data-trigger-mode="${escapeHtml(triggerMode)}"
             data-trigger-words="${escapeHtml(triggerWords)}"
             draggable="true">
            <div class="st-is-entry-header">
                <span class="st-is-entry-drag-handle" title="拖拽排序">
                    <i class="fa-solid fa-grip-vertical"></i>
                </span>
                <span class="st-is-entry-role-badge" data-role="${escapeHtml(role)}">${getRoleBadgeText(role)}</span>
                <input type="text" class="st-is-entry-name" value="${escapeHtml(name)}" placeholder="条目名称" readonly />
                <span class="st-is-entry-preview">${escapeHtml(preview)}</span>
                <div class="st-is-entry-actions">
                    <label class="st-is-entry-toggle" title="启用/禁用">
                        <input type="checkbox" ${enabled ? 'checked' : ''} />
                        <span class="st-is-slider-mini"></span>
                    </label>
                    <button class="st-is-icon-btn st-is-entry-edit" title="编辑">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="st-is-icon-btn danger st-is-entry-delete" title="删除条目">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <textarea class="st-is-entry-content" style="display:none;">${escapeHtml(content)}</textarea>
        </div>
    `);
}

function renderPresetEntries(entriesData) {
    presetEntriesContainer.empty();
    const arr = Array.isArray(entriesData) ? entriesData : [];
    if (arr.length === 0) {
        presetEntriesContainer.html(`
            <div class="st-is-entries-empty">
                <i class="fa-solid fa-inbox"></i>
                <p>暂无条目，点击上方按钮添加</p>
            </div>
        `);
        return;
    }
    arr.forEach((entry, idx) => {
        presetEntriesContainer.append(buildEntryElement(entry, idx));
    });
}

function addNewPresetEntry() {
    presetEntriesContainer.find('.st-is-entries-empty').remove();
    const count = presetEntriesContainer.find('.st-is-preset-entry').length;
    const newEntry = {
        id: generateEntryId(),
        name: `条目 ${count + 1}`,
        role: 'user',
        content: '',
        enabled: true,
        triggerMode: 'always',
        triggerWords: ''
    };
    presetEntriesContainer.append(buildEntryElement(newEntry, count));
    const c = presetEntriesContainer[0];
    if (c) c.scrollTop = c.scrollHeight;
    autoSaveCurrentContext();
    if (window.toastr) toastr.success('已添加新条目');
}

// ==================== 收集 / 保存 ====================

function collectTestContextDataFromUI() {
    const entries = [];
    presetEntriesContainer.find('.st-is-preset-entry').each(function () {
        const $e = $(this);
        entries.push({
            id: $e.attr('data-entry-id'),
            name: $e.find('.st-is-entry-name').val() || $e.attr('data-name') || '',
            role: $e.attr('data-role') || 'user',
            content: $e.find('.st-is-entry-content').val() || '',
            enabled: $e.find('.st-is-entry-toggle input').is(':checked'),
            triggerMode: $e.attr('data-trigger-mode') || 'always',
            triggerWords: $e.attr('data-trigger-words') || ''
        });
    });
    return { entries };
}

function autoSaveCurrentContext() {
    const name = testContextSelect.val();
    if (!name) return;
    const profiles = extension_settings[extensionName].test_context_profiles || {};
    if (!profiles[name]) return;
    profiles[name] = collectTestContextDataFromUI();
    saveSettingsDebounced();
}

// ==================== 预设选择器 ====================

function loadTestContextProfiles() {
    const profiles = extension_settings[extensionName].test_context_profiles || {};
    const current = extension_settings[extensionName].current_test_context_profile;
    testContextSelect.empty();
    Object.keys(profiles).forEach(name => {
        const opt = new Option(name, name, name === current, name === current);
        testContextSelect.append(opt);
    });
    if (testContextSelect.val()) {
        testContextSelect.trigger('change');
    }
    // 通知请求类型卡片刷新下拉
    try { eventSource.emit(eventNames.LLM_CONTEXT_PROFILES_CHANGED); } catch (e) { /* ignore */ }
}

function onTestContextSelectChange() {
    const name = $(this).val();
    if (!name) return;
    const settings = extension_settings[extensionName];
    settings.test_context_profiles = settings.test_context_profiles || {};
    let context = settings.test_context_profiles[name];
    if (!context) return;

    const migrated = migrateOldContextData(context);
    if (migrated !== context) {
        settings.test_context_profiles[name] = migrated;
        saveSettingsDebounced();
        context = migrated;
    }
    renderPresetEntries(context.entries || []);
    settings.current_test_context_profile = name;
    saveSettingsDebounced();
}

// ==================== CRUD ====================

function ensureProfilesObject() {
    const s = extension_settings[extensionName];
    if (!s.test_context_profiles) s.test_context_profiles = {};
    return s.test_context_profiles;
}

function onSaveTestContextClick() {
    const name = testContextSelect.val();
    if (!name) {
        if (window.toastr) toastr.warning('没有选中的测试上下文配置。');
        return;
    }
    const profiles = ensureProfilesObject();
    profiles[name] = collectTestContextDataFromUI();
    saveSettingsDebounced();
    if (window.toastr) toastr.success(`测试上下文 "${name}" 已保存。`);
}

function onNewTestContextClick() {
    const newName = prompt('请输入新的测试上下文名称：');
    if (!newName || !newName.trim()) {
        if (window.toastr) toastr.warning('测试上下文名称不能为空。');
        return;
    }
    const profiles = ensureProfilesObject();
    if (profiles[newName]) {
        if (window.toastr) toastr.error(`测试上下文 "${newName}" 已存在。`);
        return;
    }
    profiles[newName] = {
        entries: [{
            id: generateEntryId(),
            name: '系统提示',
            role: 'system',
            content: '',
            enabled: true,
            triggerMode: 'always',
            triggerWords: ''
        }]
    };
    extension_settings[extensionName].current_test_context_profile = newName;
    saveSettingsDebounced();
    loadTestContextProfiles();
    if (window.toastr) toastr.success(`测试上下文 "${newName}" 已创建并选中。`);
}

function onDeleteTestContextClick() {
    const name = testContextSelect.val();
    if (!name) {
        if (window.toastr) toastr.warning('没有选中的测试上下文配置。');
        return;
    }
    const profiles = ensureProfilesObject();
    if (Object.keys(profiles).length <= 1) {
        if (window.toastr) toastr.error('不能删除最后一个测试上下文配置。');
        return;
    }
    if (!confirm(`你确定要删除测试上下文 "${name}" 吗？`)) return;
    delete profiles[name];
    extension_settings[extensionName].current_test_context_profile = Object.keys(profiles)[0];
    saveSettingsDebounced();
    loadTestContextProfiles();
    if (window.toastr) toastr.success(`测试上下文 "${name}" 已删除。`);
}

function onRenameTestContextClick() {
    const oldName = testContextSelect.val();
    if (!oldName) {
        if (window.toastr) toastr.warning('没有选中的测试上下文配置。');
        return;
    }
    const newName = prompt('请输入新的测试上下文名称：', oldName);
    if (!newName || !newName.trim()) {
        if (window.toastr) toastr.warning('测试上下文名称不能为空。');
        return;
    }
    if (newName === oldName) return;
    const profiles = ensureProfilesObject();
    if (profiles[newName]) {
        if (window.toastr) toastr.error(`测试上下文 "${newName}" 已存在。`);
        return;
    }
    profiles[newName] = profiles[oldName];
    delete profiles[oldName];
    extension_settings[extensionName].current_test_context_profile = newName;
    saveSettingsDebounced();
    loadTestContextProfiles();
    if (window.toastr) toastr.success(`测试上下文已从 "${oldName}" 重命名为 "${newName}"。`);
}

function onExportTestContextClick() {
    const name = testContextSelect.val();
    if (!name) {
        if (window.toastr) toastr.warning('没有选中的测试上下文可导出。');
        return;
    }
    const profiles = extension_settings[extensionName].test_context_profiles || {};
    const data = { [name]: profiles[name] };
    downloadJson(data, `st_is_test_context_${name}.json`);
}

function onExportAllTestContextClick() {
    const profiles = extension_settings[extensionName].test_context_profiles || {};
    const count = Object.keys(profiles).length;
    if (count === 0) {
        if (window.toastr) toastr.warning('没有测试上下文可导出。');
        return;
    }
    downloadJson(profiles, `st_is_all_test_contexts.json`);
    if (window.toastr) toastr.success(`成功导出 ${count} 个测试上下文配置。`);
}

function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

function onImportTestContextClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                const profiles = ensureProfilesObject();
                let importedCount = 0;
                let totalEntries = 0;
                const format = detectImportFormat(imported);

                if (format === 'worldBooksArrayOuter') {
                    imported.forEach(item => {
                        const profileName = item.name || `导入配置_${importedCount + 1}`;
                        profiles[profileName] = convertWorldBooksToEntries(item.worldBooks);
                        importedCount++;
                        totalEntries += (item.worldBooks || []).length;
                    });
                    if (window.toastr) toastr.success(`成功导入 ${importedCount} 个配置，共 ${totalEntries} 个条目。`);
                } else if (format === 'worldBooks') {
                    const profileName = imported.name || file.name.replace('.json', '');
                    profiles[profileName] = convertWorldBooksToEntries(imported.worldBooks);
                    importedCount = 1;
                    if (window.toastr) toastr.success(`成功导入配置 "${profileName}"，共 ${(imported.worldBooks || []).length} 个条目。`);
                } else {
                    for (const name in imported) {
                        if (Object.prototype.hasOwnProperty.call(imported, name)) {
                            profiles[name] = {
                                ...(profiles[name] || {}),
                                ...imported[name]
                            };
                            importedCount++;
                        }
                    }
                    if (window.toastr) toastr.success(`成功导入 ${importedCount} 个测试上下文。`);
                }

                saveSettingsDebounced();
                loadTestContextProfiles();
            } catch (err) {
                console.error('导入测试上下文失败:', err);
                if (window.toastr) toastr.error('导入失败，文件格式无效。');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ==================== 拖拽排序 ====================

let draggedEntry = null;
let dragScrollInterval = null;
const SCROLL_THRESHOLD = 50;
const SCROLL_SPEED = 8;

function bindDragEvents() {
    presetEntriesContainer.on('dragstart', '.st-is-preset-entry', function (e) {
        draggedEntry = this;
        $(this).addClass('dragging');
        if (e.originalEvent && e.originalEvent.dataTransfer) {
            e.originalEvent.dataTransfer.effectAllowed = 'move';
        }
    });

    presetEntriesContainer.on('dragend', '.st-is-preset-entry', function () {
        $(this).removeClass('dragging');
        presetEntriesContainer.find('.st-is-preset-entry').removeClass('drag-over');
        draggedEntry = null;
        if (dragScrollInterval) {
            clearInterval(dragScrollInterval);
            dragScrollInterval = null;
        }
    });

    presetEntriesContainer.on('dragover', '.st-is-preset-entry', function (e) {
        e.preventDefault();
        if (e.originalEvent && e.originalEvent.dataTransfer) {
            e.originalEvent.dataTransfer.dropEffect = 'move';
        }
        if (this !== draggedEntry) {
            presetEntriesContainer.find('.st-is-preset-entry').removeClass('drag-over');
            $(this).addClass('drag-over');
        }
    });

    presetEntriesContainer.on('dragover', function (e) {
        e.preventDefault();
        if (!draggedEntry) return;
        const c = presetEntriesContainer[0];
        if (!c) return;
        const rect = c.getBoundingClientRect();
        const y = e.originalEvent.clientY;
        const distTop = y - rect.top;
        const distBottom = rect.bottom - y;
        if (dragScrollInterval) {
            clearInterval(dragScrollInterval);
            dragScrollInterval = null;
        }
        if (distTop < SCROLL_THRESHOLD && c.scrollTop > 0) {
            dragScrollInterval = setInterval(() => {
                c.scrollTop -= SCROLL_SPEED;
                if (c.scrollTop <= 0) { clearInterval(dragScrollInterval); dragScrollInterval = null; }
            }, 16);
        } else if (distBottom < SCROLL_THRESHOLD && c.scrollTop < c.scrollHeight - c.clientHeight) {
            dragScrollInterval = setInterval(() => {
                c.scrollTop += SCROLL_SPEED;
                if (c.scrollTop >= c.scrollHeight - c.clientHeight) { clearInterval(dragScrollInterval); dragScrollInterval = null; }
            }, 16);
        }
    });

    presetEntriesContainer.on('drop', '.st-is-preset-entry', function (e) {
        e.preventDefault();
        if (dragScrollInterval) {
            clearInterval(dragScrollInterval);
            dragScrollInterval = null;
        }
        if (this !== draggedEntry && draggedEntry) {
            const $target = $(this);
            const $dragged = $(draggedEntry);
            const targetRect = this.getBoundingClientRect();
            const insertAfter = e.originalEvent.clientY > targetRect.top + targetRect.height / 2;
            if (insertAfter) $target.after($dragged); else $target.before($dragged);
            autoSaveCurrentContext();
        }
        presetEntriesContainer.find('.st-is-preset-entry').removeClass('drag-over');
    });

    presetEntriesContainer.on('dragleave', function (e) {
        const c = presetEntriesContainer[0];
        if (!c) return;
        const rect = c.getBoundingClientRect();
        const x = e.originalEvent.clientX;
        const y = e.originalEvent.clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            if (dragScrollInterval) {
                clearInterval(dragScrollInterval);
                dragScrollInterval = null;
            }
        }
    });
}

function bindEntryEvents() {
    presetEntriesContainer.on('click', '.st-is-entry-edit', function (e) {
        e.stopPropagation();
        const $entry = $(this).closest('.st-is-preset-entry');
        showEntryEditModal($entry);
    });

    presetEntriesContainer.on('change', '.st-is-entry-toggle input', function () {
        const $entry = $(this).closest('.st-is-preset-entry');
        const enabled = $(this).is(':checked');
        if (enabled) $entry.removeClass('disabled'); else $entry.addClass('disabled');
        autoSaveCurrentContext();
    });

    presetEntriesContainer.on('click', '.st-is-entry-delete', function (e) {
        e.stopPropagation();
        const total = presetEntriesContainer.find('.st-is-preset-entry').length;
        if (total <= 1) {
            if (window.toastr) toastr.warning('至少需要保留一个条目');
            return;
        }
        $(this).closest('.st-is-preset-entry').remove();
        autoSaveCurrentContext();
        if (window.toastr) toastr.info('已删除条目');
    });

    presetEntriesContainer.on('dblclick', '.st-is-preset-entry', function (e) {
        if ($(e.target).closest('.st-is-entry-actions, .st-is-entry-drag-handle').length) return;
        showEntryEditModal($(this));
    });
}

// ==================== 一次性迁移：旧 profile.history → test_context_profiles ====================

/**
 * 启动时把所有 llm_profiles[*].history 迁移到独立 test_context_profiles
 * 仅在目标预设不存在时写入，避免覆盖用户数据。
 */
function migrateLegacyHistoryToTestContexts() {
    const settings = extension_settings[extensionName];
    if (!settings) return;
    const llmProfiles = settings.llm_profiles || {};
    settings.test_context_profiles = settings.test_context_profiles || {};

    let migratedCount = 0;
    Object.keys(llmProfiles).forEach(name => {
        const profile = llmProfiles[name];
        if (!profile || !Array.isArray(profile.history)) return;
        const hasContent = profile.history.some(h =>
            (h.user && String(h.user).trim()) || (h.assistant && String(h.assistant).trim())
        );
        if (!hasContent) return;
        if (settings.test_context_profiles[name]) return; // 已有同名预设，跳过

        const migrated = migrateOldContextData({ history: profile.history });
        settings.test_context_profiles[name] = migrated;
        migratedCount++;
    });

    if (migratedCount > 0) {
        if (!settings.current_test_context_profile ||
            !settings.test_context_profiles[settings.current_test_context_profile]) {
            settings.current_test_context_profile = Object.keys(settings.test_context_profiles)[0];
        }
        saveSettingsDebounced();
        console.log(`[st-immersive-sound] 已迁移 ${migratedCount} 个旧 profile.history → test_context_profiles`);
    }

    // 兜底：保证至少有一个默认上下文
    if (Object.keys(settings.test_context_profiles).length === 0) {
        settings.test_context_profiles['默认'] = {
            entries: [{
                id: generateEntryId(),
                name: '系统提示',
                role: 'system',
                content: '',
                enabled: true,
                triggerMode: 'always',
                triggerWords: ''
            }]
        };
        settings.current_test_context_profile = '默认';
        saveSettingsDebounced();
    }
}

// ==================== 对外 API ====================

/**
 * 获取当前选中的上下文条目（按 enabled 与 triggerMode 过滤）
 * @param {string} [userMessage] 用于 trigger 模式关键词命中
 * @returns {Array<{role:string, content:string}>}
 */
export function getCurrentTestContextMessages(userMessage = '') {
    const settings = extension_settings[extensionName] || {};
    const name = settings.current_test_context_profile;
    return getTestContextMessagesByName(name, userMessage);
}

/**
 * 按指定上下文预设名取消息（供请求类型路由 / llm-service 使用）。
 * 找不到时返回空数组，由调用方决定 fallback。
 * @param {string} profileName
 * @param {string} [userMessage]
 * @returns {Array<{role:string, content:string}>}
 */
export function getTestContextMessagesByName(profileName, userMessage = '') {
    const settings = extension_settings[extensionName] || {};
    const profiles = settings.test_context_profiles || {};
    const profile = profileName && profiles[profileName];
    if (!profile || !Array.isArray(profile.entries)) return [];

    const lower = String(userMessage || '').toLowerCase();
    return profile.entries
        .filter(e => e && e.enabled !== false && e.content && String(e.content).trim())
        .filter(e => {
            if (e.triggerMode !== 'trigger') return true;
            const words = String(e.triggerWords || '')
                .split(',')
                .map(w => w.trim().toLowerCase())
                .filter(Boolean);
            if (words.length === 0) return false;
            return words.some(w => lower.includes(w));
        })
        .map(e => ({ role: e.role || 'user', content: e.content }));
}

/**
 * 初始化：缓存 DOM、绑定事件、迁移旧数据、加载列表
 */
export function initTestContextSettings() {
    testContextSelect = $('#test_context_select');
    presetEntriesContainer = $('#preset-entries-container');

    if (!testContextSelect.length || !presetEntriesContainer.length) {
        console.warn('[st-immersive-sound] 测试上下文 UI 未挂载，跳过初始化');
        return;
    }

    // 一次性迁移
    migrateLegacyHistoryToTestContexts();

    // 选择器事件
    testContextSelect.on('change', onTestContextSelectChange);
    $('#new_test_context_button').on('click', onNewTestContextClick);
    $('#save_test_context_button').on('click', onSaveTestContextClick);
    $('#rename_test_context_button').on('click', onRenameTestContextClick);
    $('#delete_test_context_button').on('click', onDeleteTestContextClick);
    $('#import_test_context_button').on('click', onImportTestContextClick);
    $('#export_test_context_button').on('click', onExportTestContextClick);
    $('#export_all_test_context_button').on('click', onExportAllTestContextClick);

    // 添加条目
    $('#add_preset_entry_button').on('click', addNewPresetEntry);

    // 列表事件（拖拽 + 条目操作）
    bindDragEvents();
    bindEntryEvents();

    // 初次加载
    loadTestContextProfiles();
}

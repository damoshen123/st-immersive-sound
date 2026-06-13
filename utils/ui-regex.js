// 正则页面（移植自 st-chatu8/utils/settings/regex.js，去除手势/点击触发分支）
// 兼容现有 example.html DOM ID（regex_*）与事件协议（REGEX_TEST_MESSAGE / REGEX_RESULT_MESSAGE）

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced, eventSource } from '../../../../../script.js';
import { extensionName, eventNames } from './config.js';
import { executeRegexWithTimeout, executeRegexWithWarning } from './regex-worker.js';
import {
    detectDangerousRegex,
    hasCriticalDanger,
    generateDangerousRegexWarningHTML,
} from './regex-danger.js';
import {
    DEFAULT_REGEX_ENTRY,
    createNewRegexEntry,
    generateRegexEntryId,
    parseSTRegexFormat,
    exportToSTRegexFormat,
    validateRegexEntry,
    isRegexLiteral,
    parseRegexLiteralParts,
    escapeRegex,
    escapeHtmlForRegex,
} from './regex-entry.js';
import { debugLog, debugBranch, debugTimer, debugContent, addLog, clearLog } from './debug-logger.js';
import { computeSkipRangesByDiff } from './helpers.js';

// ==================== DOM 元素缓存 ====================
let profileSelect, beforeAfterEditor, textEditor, originalText, resultText, regexTestModeSwitch;
let builtInFiltersSwitch;
let regexEntriesContainer;
let currentEditingRegexEntry = null;

// ==================== Profile（配置）操作 ====================

/**
 * Loads regex profiles from settings and populates the dropdown.
 */
export function loadRegexProfiles() {
    const profiles = extension_settings[extensionName].regex_profiles || {};
    const currentProfileName = extension_settings[extensionName].current_regex_profile;

    profileSelect.empty();
    Object.keys(profiles).forEach((name) => {
        const option = new Option(name, name, name === currentProfileName, name === currentProfileName);
        profileSelect.append(option);
    });

    if (profileSelect.val()) {
        profileSelect.trigger('change');
    }
}

function onProfileSelectChange() {
    const profileName = $(this).val();
    if (!profileName) return;

    const profiles = extension_settings[extensionName].regex_profiles;
    const profile = profiles[profileName];

    if (profile) {
        beforeAfterEditor.val(profile.beforeAfterRegex || '');
        textEditor.val(profile.textRegex || '');
        extension_settings[extensionName].current_regex_profile = profileName;
        saveSettingsDebounced();

        loadRegexEntriesFromProfile();
    }
}

function onSaveProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning('没有选中的配置。');
        return;
    }

    const profiles = extension_settings[extensionName].regex_profiles;
    const existingEntries = profiles[profileName]?.regexEntries || [];

    profiles[profileName] = {
        beforeAfterRegex: beforeAfterEditor.val(),
        textRegex: textEditor.val(),
        regexEntries: collectRegexEntriesFromUI() || existingEntries,
    };

    saveSettingsDebounced();
    toastr.success(`配置 "${profileName}" 已保存。`);
}

function onSaveAsProfileClick() {
    const newName = prompt('请输入新的配置名称：');
    if (!newName || newName.trim() === '') {
        toastr.warning('配置名称不能为空。');
        return;
    }

    const profiles = extension_settings[extensionName].regex_profiles;
    if (profiles[newName]) {
        toastr.error(`配置 "${newName}" 已存在。`);
        return;
    }

    profiles[newName] = {
        beforeAfterRegex: '',
        textRegex: '',
        regexEntries: [],
    };
    extension_settings[extensionName].current_regex_profile = newName;
    saveSettingsDebounced();
    loadRegexProfiles();
    toastr.success(`配置 "${newName}" 已创建并选中。`);
}

function onDeleteProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning('没有选中的配置。');
        return;
    }

    if (Object.keys(extension_settings[extensionName].regex_profiles).length <= 1) {
        toastr.error('不能删除最后一个配置。');
        return;
    }

    if (confirm(`你确定要删除配置 "${profileName}" 吗？`)) {
        delete extension_settings[extensionName].regex_profiles[profileName];
        extension_settings[extensionName].current_regex_profile = Object.keys(
            extension_settings[extensionName].regex_profiles,
        )[0];
        saveSettingsDebounced();
        loadRegexProfiles();
        toastr.success(`配置 "${profileName}" 已删除。`);
    }
}

function onExportProfileClick() {
    const profileName = profileSelect.val();
    if (!profileName) {
        toastr.warning('没有选中的配置可导出。');
        return;
    }
    const profile = extension_settings[extensionName].regex_profiles[profileName];
    const exportData = { [profileName]: profile };
    const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_is_regex_profile_${profileName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function onImportProfileClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedProfiles = JSON.parse(e.target.result);
                let importedCount = 0;
                for (const name in importedProfiles) {
                    if (Object.prototype.hasOwnProperty.call(importedProfiles, name)) {
                        extension_settings[extensionName].regex_profiles[name] = importedProfiles[name];
                        importedCount++;
                    }
                }
                saveSettingsDebounced();
                loadRegexProfiles();
                toastr.success(`成功导入 ${importedCount} 个配置。`);
            } catch (error) {
                toastr.error('导入失败，文件格式无效。');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ==================== 正则条目编辑弹窗 ====================

function getRegexEntryEditModalHTML() {
    return `
        <div class="st-is-entry-edit-modal-backdrop" id="regex_entry_edit_modal">
            <div class="st-is-entry-edit-modal">
                <div class="st-is-entry-edit-modal-header">
                    <h4>编辑正则条目</h4>
                    <span class="st-is-entry-edit-modal-close">&times;</span>
                </div>
                <div class="st-is-entry-edit-modal-body">
                    <div class="st-is-modal-field">
                        <label>脚本名称</label>
                        <input type="text" id="regex_modal_script_name" class="st-is-text-input" placeholder="脚本名称" />
                    </div>
                    <div class="st-is-modal-field">
                        <label>查找正则 (findRegex)</label>
                        <textarea id="regex_modal_find_regex" class="st-is-textarea" rows="4" placeholder="输入正则表达式，支持 /pattern/flags 格式..."></textarea>
                    </div>
                    <div class="st-is-modal-field">
                        <label>替换字符串 (replaceString)</label>
                        <textarea id="regex_modal_replace_string" class="st-is-textarea" rows="4" placeholder="输入替换字符串..."></textarea>
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

function showRegexEntryEditModal($entryElement) {
    currentEditingRegexEntry = $entryElement;

    let $modal = $('#regex_entry_edit_modal');
    if (!$modal.length) {
        $('body').append(getRegexEntryEditModalHTML());
        $modal = $('#regex_entry_edit_modal');
        $modal.find('.st-is-entry-edit-modal-close').on('click', closeRegexEntryEditModal);
        $modal.find('.st-is-modal-cancel-btn').on('click', closeRegexEntryEditModal);
        $modal.find('.st-is-modal-save-btn').on('click', saveRegexEntryFromModal);
    }

    const entryData = $entryElement.data('entryData') || {};

    $modal.find('#regex_modal_script_name').val(entryData.scriptName || $entryElement.find('.st-is-entry-name').val());
    $modal.find('#regex_modal_find_regex').val(entryData.findRegex || '');
    $modal.find('#regex_modal_replace_string').val(entryData.replaceString || '');

    $modal.fadeIn(200);
}

function closeRegexEntryEditModal() {
    $('#regex_entry_edit_modal').fadeOut(200);
    currentEditingRegexEntry = null;
}

function saveRegexEntryFromModal() {
    if (!currentEditingRegexEntry) {
        closeRegexEntryEditModal();
        return;
    }

    const $modal = $('#regex_entry_edit_modal');
    const $entry = currentEditingRegexEntry;

    const scriptName = $modal.find('#regex_modal_script_name').val() || '未命名正则';
    const findRegex = $modal.find('#regex_modal_find_regex').val() || '';
    const replaceString = $modal.find('#regex_modal_replace_string').val() || '';

    const entryData = $entry.data('entryData') || {};
    entryData.scriptName = scriptName;
    // 启用状态由列表行开关管理，保留 entryData.disabled 原值
    entryData.findRegex = findRegex;
    entryData.replaceString = replaceString;

    $entry.find('.st-is-entry-name').val(scriptName);
    $entry.attr('data-find-regex', findRegex);
    $entry.attr('data-replace-string', replaceString);

    const regexPreview = findRegex.length > 40 ? findRegex.substring(0, 40) + '...' : (findRegex || '(空)');
    $entry.find('.st-is-entry-preview').text(regexPreview);

    const hasLongReplaceString = replaceString.length > 100;
    $entry.find('.st-is-entry-warning').remove();
    $entry.find('.st-is-entry-danger-warning').remove();

    const dangerResult = detectDangerousRegex(findRegex);
    if (dangerResult.isDangerous) {
        const dangerHtml = generateDangerousRegexWarningHTML(dangerResult.warnings);
        $entry.find('.st-is-entry-name').after(dangerHtml);
    }

    if (hasLongReplaceString) {
        const warningHtml = `<span class="st-is-entry-warning" title="替换字符串超过100字符 (${replaceString.length}字符)"><i class="fa-solid fa-triangle-exclamation"></i></span>`;
        const $danger = $entry.find('.st-is-entry-danger-warning');
        if ($danger.length) {
            $danger.after(warningHtml);
        } else {
            $entry.find('.st-is-entry-name').after(warningHtml);
        }
    }

    $entry.data('entryData', entryData);

    if (dangerResult.isDangerous) {
        const warningText = dangerResult.warnings.map((w) => `<b>${w.name}</b>: ${w.description}`).join('<br>');
        toastr.error(warningText, '⚠️ 危险正则警告 - 可能导致浏览器卡顿', {
            timeOut: 10000,
            extendedTimeOut: 5000,
            escapeHtml: false,
            closeButton: true,
        });
    } else {
        toastr.success('正则条目已更新');
    }

    closeRegexEntryEditModal();
    saveRegexEntriesToProfile();
}

// ==================== 条目列表渲染 ====================

function renderRegexEntries(entriesData = []) {
    refreshContainerRef();
    if (!regexEntriesContainer || regexEntriesContainer.length === 0) return;

    regexEntriesContainer.empty();

    if (entriesData.length === 0) {
        regexEntriesContainer.html(`
            <div class="st-is-entries-empty">
                <i class="fa-solid fa-inbox"></i>
                <p>暂无正则条目，点击上方按钮添加</p>
            </div>
        `);
        return;
    }

    entriesData.forEach((entry, index) => addRegexEntryDOM(entry, index));
}

function addRegexEntryDOM(entry, index = -1) {
    refreshContainerRef();
    if (!regexEntriesContainer || regexEntriesContainer.length === 0) return false;

    const entryId = entry.id || generateRegexEntryId();
    const scriptName = entry.scriptName || `正则 ${index + 1}`;
    const findRegex = entry.findRegex || '';
    const replaceString = entry.replaceString || '';
    const entryDisabled = entry.disabled === true;
    const disabledClass = entryDisabled ? 'disabled' : '';
    const regexPreview = findRegex.length > 40 ? findRegex.substring(0, 40) + '...' : (findRegex || '(空)');

    const hasLongReplaceString = replaceString.length > 100;
    const warningHtml = hasLongReplaceString
        ? `<span class="st-is-entry-warning" title="替换字符串超过100字符 (${replaceString.length}字符)"><i class="fa-solid fa-triangle-exclamation"></i></span>`
        : '';

    const dangerResult = detectDangerousRegex(findRegex);
    const dangerHtml = generateDangerousRegexWarningHTML(dangerResult.warnings);

    const entryElement = $(`
        <div class="st-is-preset-entry ${disabledClass}"
             data-entry-id="${entryId}"
             data-find-regex="${escapeHtmlForRegex(findRegex)}"
             data-replace-string="${escapeHtmlForRegex(replaceString)}"
             draggable="true">
            <div class="st-is-entry-header">
                <span class="st-is-entry-drag-handle" title="拖拽排序">
                    <i class="fa-solid fa-grip-vertical"></i>
                </span>
                <span class="st-is-entry-role-badge" data-role="regex">REG</span>
                <input type="text" class="st-is-entry-name" value="${escapeHtmlForRegex(scriptName)}" placeholder="脚本名称" readonly />
                ${dangerHtml}
                ${warningHtml}
                <span class="st-is-entry-preview">${escapeHtmlForRegex(regexPreview)}</span>
                <div class="st-is-entry-actions">
                    <label class="st-is-entry-toggle" title="启用/禁用">
                        <input type="checkbox" ${!entryDisabled ? 'checked' : ''} />
                        <span class="st-is-slider-mini"></span>
                    </label>
                    <button class="st-is-icon-btn st-is-entry-edit" title="编辑">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="st-is-icon-btn st-is-entry-export" title="导出">
                        <i class="fa-solid fa-file-export"></i>
                    </button>
                    <button class="st-is-icon-btn danger st-is-entry-delete" title="删除条目">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `);

    entryElement.data('entryData', entry);
    regexEntriesContainer.append(entryElement);
    return true;
}

function refreshContainerRef() {
    const inDoc = regexEntriesContainer && $.contains(document, regexEntriesContainer[0]);
    if (!inDoc) {
        regexEntriesContainer = $('#regex_entries_container');
    }
}

// ==================== 条目 CRUD ====================

function addNewRegexEntry() {
    refreshContainerRef();
    if (regexEntriesContainer && regexEntriesContainer.length > 0) {
        regexEntriesContainer.find('.st-is-entries-empty').remove();
    }

    const newEntry = createNewRegexEntry();
    addRegexEntryDOM(newEntry);

    if (regexEntriesContainer && regexEntriesContainer[0]) {
        const c = regexEntriesContainer[0];
        c.scrollTop = c.scrollHeight;
    }

    const $newEntry = regexEntriesContainer.find('.st-is-preset-entry').last();
    showRegexEntryEditModal($newEntry);
}

function deleteRegexEntry($entryElement) {
    $entryElement.remove();
    toastr.info('已删除正则条目');

    refreshContainerRef();
    if (!regexEntriesContainer || regexEntriesContainer.length === 0) return;

    const $entries = regexEntriesContainer.find('.st-is-preset-entry');
    if ($entries.length === 0) {
        regexEntriesContainer.html(`
            <div class="st-is-entries-empty">
                <i class="fa-solid fa-inbox"></i>
                <p>暂无正则条目，点击上方按钮添加</p>
            </div>
        `);
    }

    saveRegexEntriesToProfile();
}

function toggleRegexEntry($entryElement, enabled) {
    const entryData = $entryElement.data('entryData') || {};
    entryData.disabled = !enabled;
    $entryElement.data('entryData', entryData);

    if (enabled) $entryElement.removeClass('disabled');
    else $entryElement.addClass('disabled');

    saveRegexEntriesToProfile();
}

function exportRegexEntry($entryElement) {
    const entryData = $entryElement.data('entryData');
    if (!entryData) {
        toastr.warning('无法导出：条目数据不存在');
        return;
    }

    const exportData = exportToSTRegexFormat(entryData);
    const scriptName = entryData.scriptName || '未命名正则';
    const safeFileName = scriptName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');

    const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_regex_${safeFileName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toastr.success(`已导出正则条目: ${scriptName}`);
}

// ==================== 条目导入 ====================

function importRegexEntries() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = true;
    input.onchange = async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        let importedCount = 0;
        const readPromises = [];

        for (const file of files) {
            const promise = new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = JSON.parse(e.target.result);
                        const entry = parseSTRegexFormat(data);
                        if (entry && validateRegexEntry(entry)) {
                            refreshContainerRef();
                            regexEntriesContainer.find('.st-is-entries-empty').remove();
                            addRegexEntryDOM(entry);
                            importedCount++;
                        }
                    } catch (error) {
                        console.warn(`解析文件 ${file.name} 失败:`, error);
                    }
                    resolve();
                };
                reader.onerror = () => resolve();
                reader.readAsText(file);
            });
            readPromises.push(promise);
        }

        await Promise.all(readPromises);

        if (importedCount > 0) {
            saveRegexEntriesToProfile();
            toastr.success(`成功导入 ${importedCount} 个正则条目`);
        } else {
            toastr.warning('没有有效的正则条目可导入');
        }
    };
    input.click();
}

async function importRegexEntriesFromEngine() {
    let regexEngine;
    try {
        // 当前路径: third-party/st-immersive-sound/utils/ui-regex.js
        // 目标路径: scripts/extensions/regex/engine.js
        regexEngine = await import('../../../regex/engine.js');
    } catch (importError) {
        console.error('无法加载正则引擎模块:', importError);
        toastr.error('无法加载ST正则引擎模块，请确保正则扩展已启用');
        return;
    }

    try {
        if (typeof regexEngine.getScriptsByType !== 'function') {
            toastr.error('ST正则引擎版本过旧，缺少 getScriptsByType 函数。\n请更新 SillyTavern 到最新版本。');
            return;
        }
        if (!regexEngine.SCRIPT_TYPES) {
            toastr.error('ST正则引擎版本过旧，缺少 SCRIPT_TYPES 常量。\n请更新 SillyTavern 到最新版本。');
            return;
        }

        const globalScripts = regexEngine.getScriptsByType(regexEngine.SCRIPT_TYPES.GLOBAL) || [];
        const scopedScripts = regexEngine.getScriptsByType(regexEngine.SCRIPT_TYPES.SCOPED) || [];
        const presetScripts = regexEngine.getScriptsByType(regexEngine.SCRIPT_TYPES.PRESET) || [];

        const filterScripts = (scripts) =>
            scripts.filter((script) => {
                if (script.disabled) return false;
                if (!script.findRegex) return false;
                const minDepthValid =
                    script.minDepth === 0 || script.minDepth === null || script.minDepth === undefined;
                const markdownOnlyValid = script.markdownOnly === true;
                const placementValid = Array.isArray(script.placement) && script.placement.includes(2);
                return minDepthValid && markdownOnlyValid && placementValid;
            });

        const scriptsByType = {
            global: filterScripts(globalScripts),
            scoped: filterScripts(scopedScripts),
            preset: filterScripts(presetScripts),
        };

        const totalCount = scriptsByType.global.length + scriptsByType.scoped.length + scriptsByType.preset.length;
        if (totalCount === 0) {
            toastr.warning('没有符合条件的正则脚本可导入。\n条件: 未禁用, minDepth=0或null, markdownOnly=true, placement包含2');
            return;
        }

        const selectedScripts = await showRegexEntrySelectionDialog(scriptsByType);

        if (selectedScripts.length > 0) {
            refreshContainerRef();
            regexEntriesContainer.find('.st-is-entries-empty').remove();
            selectedScripts.forEach((script) => {
                const entry = parseSTRegexFormat(script);
                if (entry) addRegexEntryDOM(entry);
            });
            saveRegexEntriesToProfile();
            toastr.success(`成功导入 ${selectedScripts.length} 个正则条目`);
        } else {
            toastr.info('未选择任何正则脚本');
        }
    } catch (error) {
        console.error('加载正则引擎模块失败:', error);
        toastr.error('加载ST正则引擎模块失败，请确保正则扩展已启用');
    }
}

function getRegexEntryImportModalHTML(listHtml) {
    return `
        <div class="st-is-entry-edit-modal-backdrop" id="regex_st_selection_modal">
            <div class="st-is-entry-edit-modal">
                <div class="st-is-entry-edit-modal-header">
                    <h4>选择要导入的正则条目</h4>
                    <span class="st-is-entry-edit-modal-close">&times;</span>
                </div>
                <div class="st-is-entry-edit-modal-body">
                    <div class="st-is-modal-field st-is-import-toolbar">
                        <button type="button" class="st-is-btn" id="regex_st_select_all">
                            <i class="fa-solid fa-check-double"></i> 全选
                        </button>
                        <button type="button" class="st-is-btn" id="regex_st_deselect_all">
                            <i class="fa-solid fa-xmark"></i> 取消全选
                        </button>
                    </div>
                    <div class="st-is-modal-field st-is-import-list">
                        ${listHtml}
                    </div>
                </div>
                <div class="st-is-entry-edit-modal-footer">
                    <button class="st-is-btn st-is-modal-cancel-btn">取消</button>
                    <button class="st-is-btn st-is-btn-primary st-is-modal-save-btn">
                        <i class="fa-solid fa-file-import"></i> 导入选中
                    </button>
                </div>
            </div>
        </div>
    `;
}

function showRegexEntrySelectionDialog(scriptsByType) {
    return new Promise((resolve) => {
        const typeLabels = { global: '全局正则', scoped: '角色正则', preset: '预设正则' };

        let listHtml = '';
        for (const [type, scripts] of Object.entries(scriptsByType)) {
            if (scripts.length === 0) continue;
            listHtml += `
                <div class="st-is-import-type-group">
                    <h5 class="st-is-import-type-header">${typeLabels[type] || type} <span class="st-is-import-count">(${scripts.length})</span></h5>
            `;
            scripts.forEach((script, index) => {
                const scriptId = `regex_st_${type}_${index}`;
                const scriptName = script.scriptName || `未命名正则 ${index + 1}`;
                listHtml += `
                    <div class="st-is-import-item">
                        <label class="st-is-import-label">
                            <input type="checkbox" class="st-is-import-checkbox" id="${scriptId}"
                                   data-type="${type}" data-index="${index}" checked>
                            <span class="st-is-import-name">${escapeHtmlForRegex(scriptName)}</span>
                        </label>
                    </div>
                `;
            });
            listHtml += `</div>`;
        }

        $('#regex_st_selection_modal').remove();
        $('body').append(getRegexEntryImportModalHTML(listHtml));
        const $modal = $('#regex_st_selection_modal');

        $modal.find('#regex_st_select_all').on('click', () => {
            $modal.find('.st-is-import-checkbox').prop('checked', true);
        });
        $modal.find('#regex_st_deselect_all').on('click', () => {
            $modal.find('.st-is-import-checkbox').prop('checked', false);
        });

        $modal.find('.st-is-modal-save-btn').on('click', () => {
            const selectedScripts = [];
            $modal.find('.st-is-import-checkbox:checked').each(function () {
                const type = $(this).data('type');
                const index = $(this).data('index');
                const script = scriptsByType[type][index];
                if (script) selectedScripts.push(script);
            });
            $modal.fadeOut(200, () => $modal.remove());
            resolve(selectedScripts);
        });

        $modal.find('.st-is-modal-cancel-btn, .st-is-entry-edit-modal-close').on('click', () => {
            $modal.fadeOut(200, () => $modal.remove());
            resolve([]);
        });

        $modal.on('click', (e) => {
            if ($(e.target).hasClass('st-is-entry-edit-modal-backdrop')) {
                $modal.fadeOut(200, () => $modal.remove());
                resolve([]);
            }
        });

        $modal.fadeIn(200);
    });
}

// ==================== 条目数据持久化 ====================

function collectRegexEntriesFromUI() {
    const entries = [];
    refreshContainerRef();
    if (!regexEntriesContainer || regexEntriesContainer.length === 0) return entries;

    regexEntriesContainer.find('.st-is-preset-entry').each(function () {
        const $entry = $(this);
        const entryData = $entry.data('entryData');
        if (entryData) entries.push(entryData);
    });
    return entries;
}

function saveRegexEntriesToProfile() {
    const profileName = profileSelect.val();
    if (!profileName) return;

    const profiles = extension_settings[extensionName].regex_profiles;
    if (!profiles[profileName]) profiles[profileName] = {};

    profiles[profileName].regexEntries = collectRegexEntriesFromUI();
    saveSettingsDebounced();
}

function loadRegexEntriesFromProfile() {
    const profileName = profileSelect.val();
    if (!profileName) return;
    const profiles = extension_settings[extensionName].regex_profiles;
    const profile = profiles[profileName];

    if (profile && Array.isArray(profile.regexEntries)) {
        renderRegexEntries(profile.regexEntries);
    } else {
        renderRegexEntries([]);
    }
}

// ==================== 条目拖拽 + 交互事件 ====================

function bindRegexEntryDragEvents() {
    if (!regexEntriesContainer) return;

    let draggedEntry = null;
    let autoScrollInterval = null;
    const SCROLL_SPEED = 8;
    const SCROLL_ZONE = 50;

    function stopAutoScroll() {
        if (autoScrollInterval) {
            clearInterval(autoScrollInterval);
            autoScrollInterval = null;
        }
    }

    function handleAutoScroll(clientY) {
        const container = regexEntriesContainer[0];
        if (!container) return;
        const rect = container.getBoundingClientRect();
        stopAutoScroll();
        if (clientY < rect.top + SCROLL_ZONE && clientY >= rect.top) {
            autoScrollInterval = setInterval(() => { container.scrollTop -= SCROLL_SPEED; }, 16);
        } else if (clientY > rect.bottom - SCROLL_ZONE && clientY <= rect.bottom) {
            autoScrollInterval = setInterval(() => { container.scrollTop += SCROLL_SPEED; }, 16);
        }
    }

    regexEntriesContainer.on('dragstart', '.st-is-preset-entry', function (e) {
        draggedEntry = this;
        $(this).addClass('dragging');
        e.originalEvent.dataTransfer.effectAllowed = 'move';
    });

    regexEntriesContainer.on('dragend', '.st-is-preset-entry', function () {
        $(this).removeClass('dragging');
        regexEntriesContainer.find('.st-is-preset-entry').removeClass('drag-over');
        draggedEntry = null;
        stopAutoScroll();
    });

    regexEntriesContainer.on('dragover', '.st-is-preset-entry', function (e) {
        e.preventDefault();
        e.originalEvent.dataTransfer.dropEffect = 'move';
        if (this !== draggedEntry) {
            regexEntriesContainer.find('.st-is-preset-entry').removeClass('drag-over');
            $(this).addClass('drag-over');
        }
        handleAutoScroll(e.originalEvent.clientY);
    });

    regexEntriesContainer.on('dragover', function (e) {
        if (draggedEntry) {
            e.preventDefault();
            handleAutoScroll(e.originalEvent.clientY);
        }
    });

    regexEntriesContainer.on('drop', '.st-is-preset-entry', function (e) {
        e.preventDefault();
        stopAutoScroll();
        if (this !== draggedEntry && draggedEntry) {
            const $target = $(this);
            const $dragged = $(draggedEntry);
            const targetRect = this.getBoundingClientRect();
            const insertAfter = e.originalEvent.clientY > targetRect.top + targetRect.height / 2;
            if (insertAfter) $target.after($dragged);
            else $target.before($dragged);
            saveRegexEntriesToProfile();
        }
        regexEntriesContainer.find('.st-is-preset-entry').removeClass('drag-over');
    });

    regexEntriesContainer.on('dragleave', function (e) {
        const rect = this.getBoundingClientRect();
        const x = e.originalEvent.clientX;
        const y = e.originalEvent.clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            stopAutoScroll();
        }
    });
}

function bindRegexEntryEvents() {
    if (!regexEntriesContainer) return;

    regexEntriesContainer.on('click', '.st-is-entry-edit', function (e) {
        e.stopPropagation();
        const $entry = $(this).closest('.st-is-preset-entry');
        showRegexEntryEditModal($entry);
    });

    regexEntriesContainer.on('change', '.st-is-entry-toggle input', function () {
        const $entry = $(this).closest('.st-is-preset-entry');
        toggleRegexEntry($entry, $(this).is(':checked'));
    });

    regexEntriesContainer.on('click', '.st-is-entry-export', function (e) {
        e.stopPropagation();
        const $entry = $(this).closest('.st-is-preset-entry');
        exportRegexEntry($entry);
    });

    regexEntriesContainer.on('click', '.st-is-entry-delete', function (e) {
        e.stopPropagation();
        const $entry = $(this).closest('.st-is-preset-entry');
        deleteRegexEntry($entry);
    });

    regexEntriesContainer.on('dblclick', '.st-is-preset-entry', function (e) {
        if ($(e.target).closest('.st-is-entry-actions, .st-is-entry-drag-handle').length) return;
        showRegexEntryEditModal($(this));
    });

    regexEntriesContainer.on('click', '.st-is-entry-danger-warning', function (e) {
        e.stopPropagation();
        const warningText = $(this).attr('title');
        if (warningText) {
            toastr.error(warningText.replace(/\n/g, '<br>'), '⚠️ 危险正则警告', {
                timeOut: 8000,
                extendedTimeOut: 3000,
                escapeHtml: false,
            });
        }
    });

    regexEntriesContainer.on('click', '.st-is-entry-warning', function (e) {
        e.stopPropagation();
        const warningText = $(this).attr('title');
        if (warningText) toastr.warning(warningText, '替换字符串警告');
    });
}

// ==================== Range 工具 ====================

function mergeRanges(ranges) {
    if (ranges.length < 2) return ranges;
    ranges.sort((a, b) => a.start - b.start);
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
        const last = merged[merged.length - 1];
        const current = ranges[i];
        if (current.start <= last.end) {
            last.end = Math.max(last.end, current.end);
        } else {
            merged.push(current);
        }
    }
    return merged;
}

// ==================== 核心：正则测试/应用 ====================

/**
 * 应用正则并产出最终文本 + 移除范围
 * @param {string} [requestId] - 来自 REGEX_TEST_MESSAGE 的请求 ID（手动点击为空）
 * @param {object} [options]
 * @param {boolean} [options.keepImageTag] - 保护 <image>...</image> 不被任何正则清除
 */
async function onTestRegexClick(requestId, options = {}) {
    const timer = debugTimer('regex.onTestRegexClick', '正则处理流程');
    const keepImageTag = options.keepImageTag === true;

    const sourceText = originalText.val();
    const beforeAfterRegexStr = (beforeAfterEditor.val() || '').trim();
    const textRegexStr = textEditor.val() || '';
    let allRemovedRanges = [];

    debugLog('regex.onTestRegexClick', '开始正则处理', {
        请求ID: requestId || '(手动测试)',
        原文长度: sourceText?.length || 0,
        保护image标签: keepImageTag,
    });
    debugContent('regex.onTestRegexClick', '原始文本', sourceText, 300);

    try {
        let textToProcess = sourceText || '';
        let baseOffset = 0;

        // 保护 <image> 块
        const imgPlaceholders = [];
        const imgProtectPrefix = `@@ST_IS_IMG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
        if (keepImageTag) {
            textToProcess = textToProcess.replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, (match) => {
                const token = `${imgProtectPrefix}${imgPlaceholders.length}@@`;
                imgPlaceholders.push({ token, original: match });
                return token;
            });
        }

        // 1. 先跑 regexEntries（结构化条目）
        const regexEntries = collectRegexEntriesFromUI();

        for (let index = 0; index < regexEntries.length; index++) {
            const entry = regexEntries[index];
            if (entry.disabled) continue;
            if (!entry.findRegex) continue;

            const dangerCheck = detectDangerousRegex(entry.findRegex);
            if (hasCriticalDanger(dangerCheck.warnings)) {
                const warningNames = dangerCheck.warnings.map((w) => w.name).join(', ');
                console.warn(`[regex] 跳过危险正则 "${entry.scriptName}": ${warningNames}`);
                toastr.warning(`跳过危险正则 "${entry.scriptName}"<br>原因: ${warningNames}`, '正则安全检查', {
                    timeOut: 5000,
                    escapeHtml: false,
                });
                continue;
            }

            try {
                const findRegexStr = entry.findRegex.trim();
                let pattern, flags;

                if (isRegexLiteral(findRegexStr)) {
                    const parts = parseRegexLiteralParts(findRegexStr);
                    if (!parts) continue;
                    pattern = parts.pattern;
                    flags = parts.flags;
                } else {
                    pattern = findRegexStr;
                    flags = 'g';
                }

                const replaceString = entry.replaceString || '';

                // match 仅用于统计
                const matchResult = await executeRegexWithTimeout('match', textToProcess, pattern, flags);
                if (!matchResult.success) {
                    if (matchResult.timeout) {
                        toastr.warning(`正则条目 "${entry.scriptName}" 执行超时 (>1000ms)，已跳过`, '正则超时', { timeOut: 5000 });
                    } else {
                        console.warn(`正则条目 "${entry.scriptName}" 匹配失败:`, matchResult.error);
                    }
                    continue;
                }

                const replaceResult = await executeRegexWithTimeout('replace', textToProcess, pattern, flags, replaceString);
                if (!replaceResult.success) {
                    if (replaceResult.timeout) {
                        toastr.warning(`正则条目 "${entry.scriptName}" 替换超时 (>1000ms)，已跳过`, '正则超时', { timeOut: 5000 });
                    } else {
                        console.warn(`正则条目 "${entry.scriptName}" 替换失败:`, replaceResult.error);
                    }
                    continue;
                }
                if (replaceResult.result == null) continue;
                textToProcess = replaceResult.result;
            } catch (e) {
                console.warn(`正则条目 "${entry.scriptName}" 执行失败:`, e);
            }
        }

        // 2. 前后正则（context trimming）
        if (beforeAfterRegexStr.includes('|')) {
            const parts = beforeAfterRegexStr.split('|');
            if (parts.length === 2) {
                const before = parts[0] === '^' ? '^' : escapeRegex(parts[0]);
                const after = parts[1] === '$' ? '$' : escapeRegex(parts[1]);
                const contextPattern = `${before}([\\s\\S]*?)${after}`;

                const matchResult = await executeRegexWithTimeout('match', textToProcess, contextPattern, 'i');

                if (
                    matchResult.success &&
                    matchResult.result &&
                    matchResult.result.matches &&
                    typeof matchResult.result.matches[1] === 'string'
                ) {
                    const m = matchResult.result;
                    const content = m.matches[1];
                    const contentStart = m.index + m.matches[0].indexOf(content);
                    const contentEnd = contentStart + content.length;

                    if (contentStart > 0) allRemovedRanges.push({ start: 0, end: contentStart });
                    if (contentEnd < textToProcess.length)
                        allRemovedRanges.push({ start: contentEnd, end: textToProcess.length });

                    textToProcess = content;
                    baseOffset = contentStart;
                } else if (matchResult.timeout) {
                    toastr.warning('前后正则匹配超时 (>1000ms)，已跳过', '正则超时', { timeOut: 5000 });
                }
            }
        }

        // 3. 内置默认过滤
        const settings = extension_settings[extensionName] || {};
        const builtInEnabled = settings.regexBuiltInFiltersEnabled !== false;
        if (builtInEnabled) {
            const startTag = settings.regexImageStartTag || 'image###';
            const endTag = settings.regexImageEndTag || '###';
            const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const builtInFilters = [
                ...(keepImageTag ? [] : [{ pattern: /<image>[\s\S]*?<\/image>/g, desc: '过滤 <image> 标签' }]),
                { pattern: new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g'), desc: `过滤 ${startTag} 标记` },
                { pattern: /<!--[\s\S]*?-->/g, desc: '过滤 HTML 注释' },
            ];
            if (startTag !== 'image###') {
                builtInFilters.push({ pattern: /image###[\s\S]*?###/g, desc: '过滤旧的 image### 标记' });
            }
            for (const filter of builtInFilters) {
                textToProcess = executeRegexWithWarning(
                    () => textToProcess.replace(filter.pattern, ''),
                    filter.desc,
                );
            }
        }

        // 4. 文字正则（按行）
        const relativeRanges = [];
        if (textRegexStr.trim()) {
            const lines = textRegexStr.split('\n');
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                let pattern, flags;
                if (isRegexLiteral(trimmedLine)) {
                    const parts = parseRegexLiteralParts(trimmedLine);
                    if (!parts) continue;
                    pattern = parts.pattern;
                    flags = parts.flags;
                } else if (trimmedLine.includes('|')) {
                    const parts = trimmedLine.split('|');
                    if (parts.length === 2) {
                        const start = parts[0] === '^' ? '^' : escapeRegex(parts[0]);
                        const end = parts[1] === '$' ? '$' : escapeRegex(parts[1]);
                        pattern = `${start}[\\s\\S]*?${end}`;
                        flags = 'g';
                    } else {
                        continue;
                    }
                } else {
                    pattern = escapeRegex(trimmedLine);
                    flags = 'g';
                }

                const matchAllResult = await executeRegexWithTimeout('matchAll', textToProcess, pattern, flags);
                if (matchAllResult.success && matchAllResult.result) {
                    for (const m of matchAllResult.result) {
                        if (m && m.match != null) {
                            relativeRanges.push({ start: m.index, end: m.index + m.match.length });
                        }
                    }
                } else if (matchAllResult.timeout) {
                    toastr.warning(
                        `文字正则匹配超时 (>1000ms)，已跳过: ${trimmedLine.substring(0, 30)}...`,
                        '正则超时',
                        { timeOut: 5000 },
                    );
                }
            }
        }

        // 5. 合并 ranges 并生成最终文本
        const mergedRelativeRanges = mergeRanges(relativeRanges);
        let final_text = '';
        let lastIndex = 0;
        mergedRelativeRanges.forEach((range) => {
            final_text += textToProcess.substring(lastIndex, range.start);
            lastIndex = range.end;
        });
        final_text += textToProcess.substring(lastIndex);

        const absoluteTextRanges = mergedRelativeRanges.map((range) => ({
            start: range.start + baseOffset,
            end: range.end + baseOffset,
        }));
        allRemovedRanges.push(...absoluteTextRanges);
        let finalRemovedRanges = mergeRanges(allRemovedRanges);

        // 还原 <image> 占位符
        if (keepImageTag && imgPlaceholders.length > 0) {
            for (const { token, original } of imgPlaceholders) {
                final_text = final_text.split(token).join(original);
            }
        }

        // 强制：无论内置过滤开关如何，最终文本一律剥离 HTML 注释 <!-- ... -->
        // 这条放在 textRegex / regexEntries 全部跑完之后，确保用户用 $1 提取产生的
        // 注释残片也会被清掉；后续 LCS diff 会把这些字符自动并入 removedRanges。
        try {
            final_text = final_text.replace(/<!--[\s\S]*?-->/g, '');
        } catch (_) { /* noop */ }

        final_text = final_text.trim();
        resultText.val(final_text);

        // ────────────────────────────────────────────────────────────
        //  末尾校准：用 LCS diff 在 (sourceText, final_text) 之间反推真正的 removedRanges。
        //  必须放在这里：上面的 allRemovedRanges 累加器对「regexEntries 用 $1 提取捕获组」
        //  这种"替换式"完全没有记录，导致下游的 marker / narration TTS 拿不到跳过区。
        //  这道兜底覆盖：$1/$<name> 提取、空替换、模板替换等所有无法靠累加器精确追踪的情形。
        // ────────────────────────────────────────────────────────────
        try {
            const baseText = sourceText || '';
            if (baseText && typeof final_text === 'string') {
                const diff = computeSkipRangesByDiff(baseText, final_text);
                if (Array.isArray(diff) && diff.length > 0) {
                    finalRemovedRanges = mergeRanges([...finalRemovedRanges, ...diff]);
                    debugLog('regex.onTestRegexClick',
                        `末尾 LCS diff 命中 ${diff.length} 段 → 合并后共 ${finalRemovedRanges.length} 段 removedRanges`);
                } else if (diff === null) {
                    debugLog('regex.onTestRegexClick',
                        `文本过长（src=${baseText.length}, cleaned=${final_text.length}），LCS diff 跳过；沿用累加器 removedRanges`);
                }
            }
        } catch (e) {
            console.warn('[ui-regex] 末尾 LCS diff 失败（已忽略）：', e);
        }

        debugContent('regex.onTestRegexClick', '处理后文本', final_text, 300);
        addLog(`[Regex 处理后文本]\n${final_text}`);

        const isAutomatedCall = !!requestId;
        const isTestMode = extension_settings[extensionName].regexTestMode;

        if (isAutomatedCall || !isTestMode) {
            eventSource.emit(eventNames.REGEX_RESULT_MESSAGE, {
                message: final_text,
                removedRanges: finalRemovedRanges,
                id: requestId,
            });
        }

        timer.end(`原文${sourceText?.length || 0}字 → 最终${final_text?.length || 0}字`);
    } catch (e) {
        timer.end(`处理失败: ${e.message}`);
        toastr.error(`正则表达式错误: ${e.message}`);
        resultText.val(`错误: ${e.message}`);
    }
}

function onRegexTestModeChange() {
    extension_settings[extensionName].regexTestMode = $(this).is(':checked');
    saveSettingsDebounced();
}

function onBuiltInFiltersChange() {
    extension_settings[extensionName].regexBuiltInFiltersEnabled = $(this).is(':checked');
    saveSettingsDebounced();
}

// ==================== AI 桥接 ====================

function getRegexTestStatus() {
    const testMode = extension_settings[extensionName].regexTestMode ?? false;
    const currentProfile = profileSelect ? profileSelect.val() : '';
    const origText = originalText ? originalText.val() : '';
    const resText = resultText ? resultText.val() : '';
    const baEditor = beforeAfterEditor ? beforeAfterEditor.val() : '';
    const tEditor = textEditor ? textEditor.val() : '';

    const entries = collectRegexEntriesFromUI();
    const entrySummary = entries.map((e, i) => ({
        index: i + 1,
        name: e.scriptName || '(无名称)',
        disabled: !!e.disabled,
        findRegex: (e.findRegex || '').substring(0, 60),
        replaceString: (e.replaceString || '').substring(0, 60),
    }));

    return {
        testMode,
        currentProfile,
        originalText: origText ? origText.substring(0, 30000) : '(空)',
        resultText: resText ? resText.substring(0, 30000) : '(空)',
        beforeAfterRegex: baEditor || '(空)',
        textRegex: tEditor || '(空)',
        regexEntries: entrySummary,
        entryCount: entries.length,
    };
}

function setRegexOriginalText(text) {
    if (!originalText || originalText.length === 0) return '❌ 原文框不存在，请先切换到正则页面。';
    originalText.val(text || '');
    return `✅ 已设置原文 (${(text || '').length} 字符)`;
}

function setRegexEditors(beforeAfter, textRegex) {
    const results = [];
    if (beforeAfter !== undefined && beforeAfter !== null) {
        if (!beforeAfterEditor || beforeAfterEditor.length === 0) {
            results.push('❌ 前后正则编辑器不存在');
        } else {
            beforeAfterEditor.val(beforeAfter);
            results.push('✅ 前后正则已设置');
        }
    }
    if (textRegex !== undefined && textRegex !== null) {
        if (!textEditor || textEditor.length === 0) {
            results.push('❌ 文字正则编辑器不存在');
        } else {
            textEditor.val(textRegex);
            results.push('✅ 文字正则已设置');
        }
    }
    return results.join('\n');
}

function createRegexEntryByAI(data) {
    if (!data || !data.findRegex) return '❌ 必须提供 findRegex 字段。';
    refreshContainerRef();
    if (!regexEntriesContainer || regexEntriesContainer.length === 0) {
        return '❌ 正则条目容器不存在，请先切换到正则页面。';
    }
    regexEntriesContainer.find('.st-is-entries-empty').remove();

    const newEntry = {
        ...DEFAULT_REGEX_ENTRY,
        id: generateRegexEntryId(),
        scriptName: data.scriptName || 'AI创建的正则',
        findRegex: data.findRegex,
        replaceString: data.replaceString || '',
        disabled: data.disabled === true,
    };

    addRegexEntryDOM(newEntry);
    saveRegexEntriesToProfile();

    return `✅ 已创建正则条目: "${newEntry.scriptName}"`;
}

async function triggerRegexTest() {
    try {
        await onTestRegexClick();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const resText = resultText ? resultText.val() : '';
        return `✅ 正则测试完成。\n结果文本:\n${resText ? resText.substring(0, 30000) : '(空)'}`;
    } catch (e) {
        return `❌ 正则测试失败: ${e.message}`;
    }
}

function setRegexTestMode(enabled) {
    if (!regexTestModeSwitch || regexTestModeSwitch.length === 0) {
        return '❌ 测试模式开关不存在，请先切换到正则页面。';
    }
    regexTestModeSwitch.prop('checked', !!enabled).trigger('change');
    return `✅ 正则测试模式已${enabled ? '开启' : '关闭'}`;
}

function getRegexResultText() {
    const resText = resultText ? resultText.val() : '';
    return resText || '(空)';
}

function clearAllRegexEntries() {
    refreshContainerRef();
    if (!regexEntriesContainer || regexEntriesContainer.length === 0) {
        return '❌ 正则条目容器不存在，请先切换到正则页面。';
    }
    const count = regexEntriesContainer.find('.st-is-preset-entry').length;
    regexEntriesContainer.empty();
    regexEntriesContainer.html(`
        <div class="st-is-entries-empty">
            <i class="fa-solid fa-inbox"></i>
            <p>暂无正则条目，点击上方按钮添加</p>
        </div>
    `);
    saveRegexEntriesToProfile();
    return `✅ 已清除全部 ${count} 个正则条目`;
}

// ==================== 入口：初始化 ====================

export function initRegexSettings() {
    profileSelect = $('#regex_profile_select');
    beforeAfterEditor = $('#regex_before_after_editor');
    textEditor = $('#regex_text_editor');
    originalText = $('#regex_test_original_text');
    resultText = $('#regex_test_result_text');
    regexTestModeSwitch = $('#regexTestMode');
    builtInFiltersSwitch = $('#regex_built_in_filters');
    regexEntriesContainer = $('#regex_entries_container');

    // 初始状态
    regexTestModeSwitch.prop('checked', extension_settings[extensionName].regexTestMode ?? false);
    builtInFiltersSwitch.prop(
        'checked',
        extension_settings[extensionName].regexBuiltInFiltersEnabled !== false,
    );

    // Profile 操作
    $('#new_regex_profile_button').on('click', onSaveAsProfileClick);
    $('#save_regex_profile_button').on('click', onSaveProfileClick);
    $('#save_as_regex_profile_button').on('click', onSaveAsProfileClick);
    $('#delete_regex_profile_button').on('click', onDeleteProfileClick);
    $('#import_regex_profile_button').on('click', onImportProfileClick);
    $('#export_regex_profile_button').on('click', onExportProfileClick);
    $('#test_regex_button').on('click', () => onTestRegexClick());
    profileSelect.on('change', onProfileSelectChange);
    regexTestModeSwitch.on('change', onRegexTestModeChange);
    builtInFiltersSwitch.on('change', onBuiltInFiltersChange);

    // 监听 REGEX_TEST_MESSAGE（外部调用，例如 newline_fix.js / chatDataUtils.js）
    eventSource.on(eventNames.REGEX_TEST_MESSAGE, (data) => {
        const { message, id, keepImageTag } = data || {};
        if (originalText && typeof message === 'string') {
            clearLog();
            addLog(`[Regex 原始文本]\n${message}`);
            originalText.val(message);
            onTestRegexClick(id, { keepImageTag: keepImageTag === true });
        }
    });

    // 条目相关按钮
    $('#add_regex_entry_button').on('click', addNewRegexEntry);
    $('#import_regex_entry_button').on('click', importRegexEntries);
    $('#import_regex_entry_engine_button').on('click', importRegexEntriesFromEngine);

    bindRegexEntryDragEvents();
    bindRegexEntryEvents();

    // 暴露 AI 桥接（使用 st-is 专属命名，避免与 st-chatu8 的 window.regexAIBridge 冲突）
    window.stIsRegexAIBridge = {
        getStatus: getRegexTestStatus,
        setOriginalText: setRegexOriginalText,
        setEditors: setRegexEditors,
        createEntry: createRegexEntryByAI,
        triggerTest: triggerRegexTest,
        setTestMode: setRegexTestMode,
        getResultText: getRegexResultText,
        clearAllEntries: clearAllRegexEntries,
    };

    // 加载配置（会触发 change 事件 → loadRegexEntriesFromProfile）
    loadRegexProfiles();
}

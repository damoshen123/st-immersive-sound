// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName } from "./config.js";
import { createProfileManagementUI } from "./ui_common.js";

// ==================== 条目辅助 ====================

let _audioEntryIdCounter = 0;
function generateAudioEntryId() {
    return `audio_entry_${Date.now()}_${++_audioEntryIdCounter}`;
}

function escapeHtml(text) {
    if (text === undefined || text === null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/**
 * 旧 profile.content 字符串解析为条目列表。
 * 支持形如：
 *   <名称>(loop)
 *   line1
 *   line2
 *   </名称>
 * 没有匹配标签时，整段内容会作为单个默认条目。
 */
function parseLegacyContentToEntries(content) {
    const entries = [];
    if (!content || !String(content).trim()) return entries;
    const re = /<([^<>\/\s][^<>\n]*?)>(\s*\(\s*loop\s*\))?\s*\r?\n([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        entries.push({
            id: generateAudioEntryId(),
            name: m[1].trim(),
            loop: !!m[2],
            content: (m[3] || '').replace(/^\s*\r?\n/, '').replace(/\r?\n\s*$/, ''),
            enabled: true,
        });
    }
    if (entries.length === 0) {
        entries.push({
            id: generateAudioEntryId(),
            name: '默认',
            loop: false,
            content: String(content),
            enabled: true,
        });
    }
    return entries;
}

/**
 * 把条目列表合成为最终注入用的字符串。
 * 仅启用的条目会被纳入。
 */
function generateContentFromEntries(entries) {
    return (entries || [])
        .filter(e => e && e.enabled !== false)
        .map(e => {
            const name = String(e.name || '').trim() || 'untitled';
            const loop = e.loop ? '(loop)' : '';
            const body = String(e.content || '').replace(/^\s*\r?\n/, '').replace(/\r?\n\s*$/, '');
            return `<${name}>${loop}\n${body}\n</${name}>`;
        })
        .join('\n');
}

/**
 * 确保 profile 拥有 entries 字段；从旧 content 自动迁移。
 * 返回是否做出了修改。
 */
function ensureProfileEntries(profile) {
    if (!profile || typeof profile !== 'object') return false;
    if (Array.isArray(profile.entries)) return false;
    profile.entries = parseLegacyContentToEntries(profile.content || '');
    profile.content = generateContentFromEntries(profile.entries);
    return true;
}

function getEntriesContainer() {
    return $('#st-is-audio-resources-entries');
}

function buildAudioEntryElement(entry, index) {
    const id = entry.id || generateAudioEntryId();
    const name = entry.name || `条目 ${index + 1}`;
    const content = entry.content || '';
    const enabled = entry.enabled !== false;
    const loop = !!entry.loop;
    const disabledClass = enabled ? '' : 'disabled';
    const previewSrc = content.replace(/\s+/g, ' ').trim();
    const preview = previewSrc.length > 50 ? previewSrc.substring(0, 50) + '...' : (previewSrc || '(空)');
    const labelText = loop ? `${name} (loop)` : name;

    return $(`
        <div class="st-is-preset-entry ${disabledClass}"
             data-entry-id="${escapeHtml(id)}"
             data-name="${escapeHtml(name)}"
             data-loop="${loop ? '1' : '0'}">
            <div class="st-is-entry-header">
                <span class="st-is-entry-role-badge" data-role="${loop ? 'assistant' : 'user'}" title="${loop ? '循环' : '单次'}">${loop ? 'LOOP' : 'ONCE'}</span>
                <input type="text" class="st-is-entry-name" value="${escapeHtml(labelText)}" placeholder="标签名" readonly />
                <span class="st-is-entry-preview">${escapeHtml(preview)}</span>
                <div class="st-is-entry-actions">
                    <label class="st-is-entry-toggle" title="启用/禁用">
                        <input type="checkbox" ${enabled ? 'checked' : ''} />
                        <span class="st-is-slider-mini"></span>
                    </label>
                    <button class="st-is-icon-btn st-is-entry-edit" title="编辑"><i class="fa-solid fa-pen"></i></button>
                    <button class="st-is-icon-btn danger st-is-entry-delete" title="删除条目"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <textarea class="st-is-entry-content" style="display:none;">${escapeHtml(content)}</textarea>
        </div>
    `);
}

function renderAudioEntries(entries) {
    const container = getEntriesContainer();
    container.empty();
    const arr = Array.isArray(entries) ? entries : [];
    if (arr.length === 0) {
        container.html(`
            <div class="st-is-entries-empty">
                <i class="fa-solid fa-inbox"></i>
                <p>暂无条目，点击上方按钮添加</p>
            </div>
        `);
        return;
    }
    arr.forEach((entry, idx) => container.append(buildAudioEntryElement(entry, idx)));
}

function collectAudioEntriesFromUI() {
    const entries = [];
    getEntriesContainer().find('.st-is-preset-entry').each(function () {
        const $e = $(this);
        entries.push({
            id: $e.attr('data-entry-id') || generateAudioEntryId(),
            name: $e.attr('data-name') || '',
            loop: $e.attr('data-loop') === '1',
            content: $e.find('.st-is-entry-content').val() || '',
            enabled: $e.find('.st-is-entry-toggle input').is(':checked'),
        });
    });
    return entries;
}

function getCurrentProfile() {
    const settings = extension_settings[extensionName];
    const name = settings.current_audio_resources_profile;
    if (!name) return null;
    const profiles = settings.audio_resources_profiles || {};
    return profiles[name] || null;
}

function autoSaveCurrentAudioResourcesProfile() {
    const profile = getCurrentProfile();
    if (!profile) return;
    profile.entries = collectAudioEntriesFromUI();
    profile.content = generateContentFromEntries(profile.entries);
    saveSettingsDebounced();
}

// ==================== 编辑弹窗 ====================

let _audioCurrentEditingEntry = null;

function getAudioEntryEditModalHTML() {
    return `
        <div class="st-is-entry-edit-modal-backdrop" id="audio-resources-entry-edit-modal">
            <div class="st-is-entry-edit-modal">
                <div class="st-is-entry-edit-modal-header">
                    <h4>编辑音效条目</h4>
                    <span class="st-is-entry-edit-modal-close">&times;</span>
                </div>
                <div class="st-is-entry-edit-modal-body">
                    <div class="st-is-modal-field">
                        <label>标签名</label>
                        <input type="text" id="audio-modal-entry-name" class="st-is-text-input" placeholder="例如：日常_环境音效列表" />
                    </div>
                    <div class="st-is-modal-field-row">
                        <div class="st-is-modal-field st-is-modal-toggle-field">
                            <label>循环 (loop)</label>
                            <label class="st-is-toggle">
                                <input id="audio-modal-entry-loop" type="checkbox" />
                                <span class="st-is-slider"></span>
                            </label>
                        </div>
                        <div class="st-is-modal-field st-is-modal-toggle-field">
                            <label>启用</label>
                            <label class="st-is-toggle">
                                <input id="audio-modal-entry-enabled" type="checkbox" checked />
                                <span class="st-is-slider"></span>
                            </label>
                        </div>
                    </div>
                    <div class="st-is-modal-field">
                        <label>音频列表（每行一个，可在名称后用括号标注备注）</label>
                        <textarea id="audio-modal-entry-content" class="st-is-textarea" rows="12"
                            placeholder="Ambiance_热闹集市叫卖_L(注意:仅适用于室外的热闹的集市)&#10;Ambiance_公园氛围_L"></textarea>
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

function ensureAudioEntryEditModal() {
    let $modal = $('#audio-resources-entry-edit-modal');
    if ($modal.length) return $modal;
    $('body').append(getAudioEntryEditModalHTML());
    $modal = $('#audio-resources-entry-edit-modal');
    $modal.find('.st-is-entry-edit-modal-close').on('click', closeAudioEntryEditModal);
    $modal.find('.st-is-modal-cancel-btn').on('click', closeAudioEntryEditModal);
    $modal.find('.st-is-modal-save-btn').on('click', saveAudioEntryFromModal);
    return $modal;
}

function showAudioEntryEditModal($entry) {
    _audioCurrentEditingEntry = $entry;
    const $modal = ensureAudioEntryEditModal();
    const name = $entry.attr('data-name') || '';
    const loop = $entry.attr('data-loop') === '1';
    const enabled = !$entry.hasClass('disabled');
    const content = $entry.find('.st-is-entry-content').val() || '';
    $modal.find('#audio-modal-entry-name').val(name);
    $modal.find('#audio-modal-entry-loop').prop('checked', loop);
    $modal.find('#audio-modal-entry-enabled').prop('checked', enabled);
    $modal.find('#audio-modal-entry-content').val(content);
    $modal.css('display', 'flex').hide().fadeIn(150);
}

function closeAudioEntryEditModal() {
    const $modal = $('#audio-resources-entry-edit-modal');
    if ($modal.length) $modal.fadeOut(150);
    _audioCurrentEditingEntry = null;
}

function saveAudioEntryFromModal() {
    if (!_audioCurrentEditingEntry) {
        closeAudioEntryEditModal();
        return;
    }
    const $modal = $('#audio-resources-entry-edit-modal');
    const $entry = _audioCurrentEditingEntry;

    const name = String($modal.find('#audio-modal-entry-name').val() || '').trim() || '默认';
    const loop = $modal.find('#audio-modal-entry-loop').is(':checked');
    const enabled = $modal.find('#audio-modal-entry-enabled').is(':checked');
    const content = $modal.find('#audio-modal-entry-content').val() || '';

    $entry.attr('data-name', name);
    $entry.attr('data-loop', loop ? '1' : '0');
    const labelText = loop ? `${name} (loop)` : name;
    $entry.find('.st-is-entry-name').val(labelText);
    $entry.find('.st-is-entry-role-badge')
        .text(loop ? 'LOOP' : 'ONCE')
        .attr('data-role', loop ? 'assistant' : 'user')
        .attr('title', loop ? '循环' : '单次');
    $entry.find('.st-is-entry-content').val(content);
    $entry.find('.st-is-entry-toggle input').prop('checked', enabled);
    if (enabled) $entry.removeClass('disabled'); else $entry.addClass('disabled');

    const previewSrc = content.replace(/\s+/g, ' ').trim();
    const preview = previewSrc.length > 50 ? previewSrc.substring(0, 50) + '...' : (previewSrc || '(空)');
    $entry.find('.st-is-entry-preview').text(preview);

    autoSaveCurrentAudioResourcesProfile();
    if (window.toastr) toastr.success('条目已更新并保存');
    closeAudioEntryEditModal();
}

function bindAudioEntryEvents() {
    const container = getEntriesContainer();
    if (container.data('events-bound')) return;
    container.data('events-bound', true);

    container.on('click', '.st-is-entry-edit', function (e) {
        e.stopPropagation();
        showAudioEntryEditModal($(this).closest('.st-is-preset-entry'));
    });

    container.on('change', '.st-is-entry-toggle input', function () {
        const $entry = $(this).closest('.st-is-preset-entry');
        const enabled = $(this).is(':checked');
        if (enabled) $entry.removeClass('disabled'); else $entry.addClass('disabled');
        autoSaveCurrentAudioResourcesProfile();
    });

    container.on('click', '.st-is-entry-delete', function (e) {
        e.stopPropagation();
        const total = container.find('.st-is-preset-entry').length;
        $(this).closest('.st-is-preset-entry').remove();
        if (total - 1 === 0) renderAudioEntries([]);
        autoSaveCurrentAudioResourcesProfile();
        if (window.toastr) toastr.info('已删除条目');
    });

    container.on('dblclick', '.st-is-preset-entry', function (e) {
        if ($(e.target).closest('.st-is-entry-actions').length) return;
        showAudioEntryEditModal($(this));
    });
}

/**
 * 收集所有资源预设里的资源 key 集合（每行格式 key=url=...）。
 */
function collectAllAssetKeys() {
    const settings = extension_settings[extensionName] || {};
    const profiles = settings.audio_asset_profiles || {};
    const keyToProfiles = new Map(); // key -> Set(profileName)
    Object.keys(profiles).forEach(profileName => {
        const content = profiles[profileName] && profiles[profileName].content;
        if (!content) return;
        String(content).split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const key = trimmed.split('=')[0].trim();
            if (!key) return;
            if (!keyToProfiles.has(key)) keyToProfiles.set(key, new Set());
            keyToProfiles.get(key).add(profileName);
        });
    });
    return keyToProfiles;
}

/**
 * 从条目内容的一行里抽取音效名称（去掉末尾的括号备注）。
 * 示例："Ambiance_xxx(注意:...)" -> "Ambiance_xxx"
 */
function extractNameFromLine(line) {
    if (!line) return '';
    let s = String(line).trim();
    if (!s || s.startsWith('#')) return '';
    // 去掉行尾的圆括号备注（中英文括号都支持）
    s = s.replace(/[（(][^（()）]*[)）]\s*$/u, '').trim();
    return s;
}

function checkAudioEntryNames() {
    const entries = collectAudioEntriesFromUI();
    const keyToProfiles = collectAllAssetKeys();
    const totalAssetKeys = keyToProfiles.size;

    const results = []; // { tag, name, found, profiles: [] }
    let totalChecked = 0;
    let missingCount = 0;

    entries.forEach(entry => {
        const tag = entry.name || '(未命名)';
        const lines = String(entry.content || '').split(/\r?\n/);
        lines.forEach(rawLine => {
            const name = extractNameFromLine(rawLine);
            if (!name) return;
            totalChecked++;
            const found = keyToProfiles.has(name);
            if (!found) missingCount++;
            results.push({
                entryId: entry.id,
                tag,
                entryEnabled: entry.enabled !== false,
                name,
                rawLine: rawLine.trim(),
                found,
                profiles: found ? Array.from(keyToProfiles.get(name)) : [],
            });
        });
    });

    showAudioCheckResultsModal({
        results,
        totalChecked,
        missingCount,
        totalAssetKeys,
        allAssetKeys: Array.from(keyToProfiles.keys()),
    });
}

// ==================== 相似度计算 ====================

function levenshtein(a, b) {
    a = String(a); b = String(b);
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    let prev = new Array(bl + 1);
    let cur = new Array(bl + 1);
    for (let j = 0; j <= bl; j++) prev[j] = j;
    for (let i = 1; i <= al; i++) {
        cur[0] = i;
        const ca = a.charCodeAt(i - 1);
        for (let j = 1; j <= bl; j++) {
            const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
            cur[j] = Math.min(
                cur[j - 1] + 1,
                prev[j] + 1,
                prev[j - 1] + cost
            );
        }
        const tmp = prev; prev = cur; cur = tmp;
    }
    return prev[bl];
}

function similarityScore(a, b) {
    const aL = String(a).toLowerCase();
    const bL = String(b).toLowerCase();
    const max = Math.max(aL.length, bL.length);
    if (max === 0) return 1;
    const dist = levenshtein(aL, bL);
    return 1 - dist / max;
}

function findTopMatches(name, allKeys, topN = 5) {
    if (!name || !allKeys || allKeys.length === 0) return [];
    const scored = allKeys.map(k => ({ key: k, score: similarityScore(name, k) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
}

// ==================== 删除 / 替换条目中的某一行 ====================

/**
 * 在指定 entryId 的条目里把 oldRawLine 整行替换为 newLine（保留备注）
 * 若 newLine 为 null 则删除该行
 * 返回是否成功修改
 */
function modifyEntryLine(entryId, oldRawLine, newLine) {
    const $entry = getEntriesContainer().find(`.st-is-preset-entry[data-entry-id="${$.escapeSelector ? $.escapeSelector(entryId) : entryId}"]`);
    if (!$entry.length) return false;
    const $textarea = $entry.find('.st-is-entry-content');
    const lines = String($textarea.val() || '').split(/\r?\n/);
    let modified = false;
    const newLines = [];
    for (const line of lines) {
        if (!modified && line.trim() === String(oldRawLine).trim()) {
            modified = true;
            if (newLine !== null && newLine !== undefined) newLines.push(newLine);
            // newLine === null 表示删除该行
            continue;
        }
        newLines.push(line);
    }
    if (!modified) return false;
    const newContent = newLines.join('\n');
    $textarea.val(newContent);

    // 同步预览
    const previewSrc = newContent.replace(/\s+/g, ' ').trim();
    const preview = previewSrc.length > 50 ? previewSrc.substring(0, 50) + '...' : (previewSrc || '(空)');
    $entry.find('.st-is-entry-preview').text(preview);

    autoSaveCurrentAudioResourcesProfile();
    return true;
}

/**
 * 用新名称替换原 rawLine，保留行尾括号备注。
 */
function replaceLineKeepRemark(rawLine, newName) {
    const m = String(rawLine).match(/[（(][^（()）]*[)）]\s*$/u);
    const remark = m ? m[0].trim() : '';
    return remark ? `${newName}${remark}` : newName;
}

function getAudioCheckResultsModalHTML() {
    return `
        <div class="st-is-entry-edit-modal-backdrop" id="audio-resources-check-modal">
            <div class="st-is-entry-edit-modal" style="max-width: 760px;">
                <div class="st-is-entry-edit-modal-header">
                    <h4>名称检测结果</h4>
                    <span class="st-is-entry-edit-modal-close">&times;</span>
                </div>
                <div class="st-is-entry-edit-modal-body">
                    <div class="st-is-modal-field">
                        <div id="audio-check-summary" style="margin-bottom: 8px;"></div>
                        <div id="audio-check-controls" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom: 8px;">
                            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
                                <input type="checkbox" id="audio-check-only-missing" checked />
                                只显示未找到的
                            </label>
                        </div>
                        <div id="audio-check-list" style="max-height: 50vh; overflow-y:auto; border:1px solid var(--st-is-border-color, #233554); border-radius:6px;"></div>
                    </div>
                </div>
                <div class="st-is-entry-edit-modal-footer">
                    <button class="st-is-btn" id="audio-check-copy-missing">复制未找到名称</button>
                    <button class="st-is-btn st-is-modal-cancel-btn">关闭</button>
                </div>
            </div>
        </div>
    `;
}

function ensureAudioCheckResultsModal() {
    let $modal = $('#audio-resources-check-modal');
    if ($modal.length) return $modal;
    $('body').append(getAudioCheckResultsModalHTML());
    $modal = $('#audio-resources-check-modal');
    $modal.find('.st-is-entry-edit-modal-close').on('click', () => $modal.fadeOut(150));
    $modal.find('.st-is-modal-cancel-btn').on('click', () => $modal.fadeOut(150));
    return $modal;
}

function showAudioCheckResultsModal(payload) {
    const $modal = ensureAudioCheckResultsModal();
    const { results, totalChecked, missingCount, totalAssetKeys, allAssetKeys } = payload;
    // 给每个 result 一个稳定 id，便于操作后定位 DOM 行
    results.forEach((r, i) => { r.__rowId = `arc_row_${i}`; });

    const $summary = $modal.find('#audio-check-summary');
    if (totalAssetKeys === 0) {
        $summary.html(`<span style="color:#e0a800;"><i class="fa-solid fa-triangle-exclamation"></i> 警告：所有资源预设均为空，无法进行匹配。</span>`);
    } else if (totalChecked === 0) {
        $summary.html(`<span><i class="fa-solid fa-circle-info"></i> 当前条目不包含任何待检测的音频名称。</span>`);
    } else {
        const okCount = totalChecked - missingCount;
        const color = missingCount === 0 ? '#28a745' : '#dc3545';
        $summary.html(
            `<div>资源库已加载 <b>${totalAssetKeys}</b> 个名称；已检测 <b>${totalChecked}</b> 行。</div>` +
            `<div>命中 <b style="color:#28a745;">${okCount}</b>，未找到 <b style="color:${color};">${missingCount}</b>。</div>`
        );
    }

    const renderList = () => {
        const onlyMissing = $modal.find('#audio-check-only-missing').is(':checked');
        const filtered = results.filter(r => onlyMissing ? !r.found : true);
        const $list = $modal.find('#audio-check-list');
        if (filtered.length === 0) {
            $list.html(`<div style="padding:16px; text-align:center; color:var(--st-is-text-secondary,#8892b0);">${onlyMissing ? '没有未找到的名称 🎉' : '没有可显示的项'}</div>`);
            return;
        }

        // 按 tag 分组渲染
        const byTag = new Map();
        filtered.forEach(r => {
            if (!byTag.has(r.tag)) byTag.set(r.tag, []);
            byTag.get(r.tag).push(r);
        });

        const parts = [];
        byTag.forEach((items, tag) => {
            const disabledNote = items[0] && items[0].entryEnabled === false ? ' <span style="color:var(--st-is-text-secondary,#8892b0); font-size:12px;">[已禁用]</span>' : '';
            parts.push(`<div style="padding:8px 12px; background:var(--st-is-bg-secondary,#172a45); border-bottom:1px solid var(--st-is-border-color,#233554);"><b>${escapeHtml(tag)}</b>${disabledNote} <span style="color:var(--st-is-text-secondary,#8892b0); font-size:12px;">(${items.length})</span></div>`);
            items.forEach(r => {
                const icon = r.found
                    ? `<i class="fa-solid fa-circle-check" style="color:#28a745;"></i>`
                    : `<i class="fa-solid fa-circle-xmark" style="color:#dc3545;"></i>`;
                const profilesText = r.found && r.profiles.length
                    ? `<span style="color:var(--st-is-text-secondary,#8892b0); font-size:12px; margin-left:8px;">来源: ${escapeHtml(r.profiles.join(', '))}</span>`
                    : '';
                const actions = !r.found
                    ? `<div style="margin-left:auto; display:flex; gap:6px; flex-shrink:0;">
                            <button class="st-is-icon-btn arc-row-suggest" data-row="${r.__rowId}" title="匹配相似度最高的名称">
                                <i class="fa-solid fa-wand-magic-sparkles"></i>
                            </button>
                            <button class="st-is-icon-btn danger arc-row-delete" data-row="${r.__rowId}" title="从条目中删除该行">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                       </div>`
                    : '';
                parts.push(
                    `<div class="arc-row" id="${r.__rowId}" data-row="${r.__rowId}" style="border-bottom:1px solid var(--st-is-border-color,#233554);">` +
                    `<div style="padding:6px 12px; display:flex; align-items:center; gap:8px;">` +
                    `${icon}<span class="arc-row-name" style="font-family:ui-monospace,Consolas,Menlo,monospace; color:var(--st-is-text-primary,#ff8c00); background:transparent; word-break:break-all;">${escapeHtml(r.name)}</span>${profilesText}${actions}` +
                    `</div>` +
                    `<div class="arc-row-suggest-panel" style="display:none; padding:6px 12px 10px 32px;"></div>` +
                    `</div>`
                );
            });
        });
        $list.html(parts.join(''));
    };

    $modal.find('#audio-check-only-missing').off('change').on('change', renderList);
    $modal.find('#audio-check-copy-missing').off('click').on('click', () => {
        const missingNames = results.filter(r => !r.found).map(r => r.name);
        if (missingNames.length === 0) {
            if (window.toastr) toastr.info('没有未找到的名称可复制。');
            return;
        }
        const text = missingNames.join('\n');
        const fallback = () => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            document.body.removeChild(ta);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(fallback);
        } else {
            fallback();
        }
        if (window.toastr) toastr.success(`已复制 ${missingNames.length} 个未找到的名称。`);
    });

    // 行内操作：匹配相似 / 删除该行 / 应用建议
    const $list = $modal.find('#audio-check-list');

    const updateSummary = () => {
        const newMissing = results.filter(r => !r.found).length;
        const okCount = totalChecked - newMissing;
        const color = newMissing === 0 ? '#28a745' : '#dc3545';
        $modal.find('#audio-check-summary').html(
            `<div>资源库已加载 <b>${totalAssetKeys}</b> 个名称；已检测 <b>${totalChecked}</b> 行。</div>` +
            `<div>命中 <b style="color:#28a745;">${okCount}</b>，未找到 <b style="color:${color};">${newMissing}</b>。</div>`
        );
    };

    $list.off('click.arcrow').on('click.arcrow', '.arc-row-suggest', function (e) {
        e.stopPropagation();
        const rowId = $(this).attr('data-row');
        const r = results.find(x => x.__rowId === rowId);
        if (!r) return;
        const $row = $list.find(`.arc-row[data-row="${rowId}"]`);
        const $panel = $row.find('.arc-row-suggest-panel');
        if ($panel.is(':visible')) {
            $panel.slideUp(120);
            return;
        }
        const matches = findTopMatches(r.name, allAssetKeys, 5);
        if (matches.length === 0) {
            $panel.html(`<span style="color:var(--st-is-text-secondary,#8892b0);">资源库为空，无法匹配。</span>`).slideDown(120);
            return;
        }
        const html = `
            <div style="font-size:12px; color:var(--st-is-text-secondary,#8892b0); margin-bottom:4px;">相似度最高的候选：</div>
            ${matches.map(m => {
                const pct = (m.score * 100).toFixed(0);
                const color = m.score >= 0.6 ? '#28a745' : (m.score >= 0.4 ? '#e0a800' : '#dc3545');
                return `<div style="display:flex; align-items:center; gap:8px; padding:3px 0;">
                    <span style="min-width:42px; text-align:right; color:${color}; font-weight:600;">${pct}%</span>
                    <span style="font-family:ui-monospace,Consolas,Menlo,monospace; color:var(--st-is-text-primary,#ff8c00); flex:1; word-break:break-all;">${escapeHtml(m.key)}</span>
                    <button class="st-is-btn arc-row-pick" data-row="${rowId}" data-pick="${escapeHtml(m.key)}" style="padding:2px 10px;">选择</button>
                </div>`;
            }).join('')}
        `;
        $panel.html(html).slideDown(120);
    });

    $list.on('click.arcrow', '.arc-row-pick', function (e) {
        e.stopPropagation();
        const rowId = $(this).attr('data-row');
        const pick = $(this).attr('data-pick');
        const r = results.find(x => x.__rowId === rowId);
        if (!r || !pick) return;
        const newLine = replaceLineKeepRemark(r.rawLine, pick);
        const ok = modifyEntryLine(r.entryId, r.rawLine, newLine);
        if (!ok) {
            if (window.toastr) toastr.error('无法定位原行（可能条目已被修改）。');
            return;
        }
        // 更新 result 状态 & 行 UI
        r.rawLine = newLine.trim();
        r.name = pick;
        r.found = true;
        r.profiles = [];
        const $row = $list.find(`.arc-row[data-row="${rowId}"]`);
        $row.find('.fa-circle-xmark').removeClass('fa-circle-xmark').addClass('fa-circle-check').css('color', '#28a745');
        $row.find('.arc-row-name').text(pick);
        $row.find('.arc-row-suggest-panel').slideUp(120, function () { $(this).empty(); });
        $row.find('.arc-row-suggest, .arc-row-delete').remove();
        updateSummary();
        // 若开启“只显示未找到”，把已修复的行移除
        if ($modal.find('#audio-check-only-missing').is(':checked')) {
            $row.slideUp(120, function () { $(this).remove(); });
        }
        if (window.toastr) toastr.success(`已替换为 "${pick}"`);
    });

    $list.on('click.arcrow', '.arc-row-delete', function (e) {
        e.stopPropagation();
        const rowId = $(this).attr('data-row');
        const r = results.find(x => x.__rowId === rowId);
        if (!r) return;
        if (!confirm(`确定从条目 "${r.tag}" 中删除：\n${r.rawLine}\n？`)) return;
        const ok = modifyEntryLine(r.entryId, r.rawLine, null);
        if (!ok) {
            if (window.toastr) toastr.error('无法定位原行（可能条目已被修改）。');
            return;
        }
        // 从 results 中移除该项
        const idx = results.findIndex(x => x.__rowId === rowId);
        if (idx !== -1) results.splice(idx, 1);
        const $row = $list.find(`.arc-row[data-row="${rowId}"]`);
        $row.slideUp(120, function () { $(this).remove(); });
        // 重新计算未找到计数（totalChecked 也要减少）
        // 注意：totalChecked 是闭包变量，重新设置一下汇总
        // 这里简化处理：直接用 results 重算
        // eslint-disable-next-line no-param-reassign
        payload.totalChecked = results.length;
        // 重渲染汇总
        const newMissing = results.filter(x => !x.found).length;
        const okCount = results.length - newMissing;
        const color = newMissing === 0 ? '#28a745' : '#dc3545';
        $modal.find('#audio-check-summary').html(
            `<div>资源库已加载 <b>${totalAssetKeys}</b> 个名称；已检测 <b>${results.length}</b> 行。</div>` +
            `<div>命中 <b style="color:#28a745;">${okCount}</b>，未找到 <b style="color:${color};">${newMissing}</b>。</div>`
        );
        if (window.toastr) toastr.info('已删除该行');
    });

    renderList();
    $modal.css('display', 'flex').hide().fadeIn(150);
}

function addNewAudioEntry() {
    const container = getEntriesContainer();
    container.find('.st-is-entries-empty').remove();
    const count = container.find('.st-is-preset-entry').length;
    const newEntry = {
        id: generateAudioEntryId(),
        name: `条目 ${count + 1}`,
        loop: false,
        content: '',
        enabled: true,
    };
    container.append(buildAudioEntryElement(newEntry, count));
    const c = container[0];
    if (c) c.scrollTop = c.scrollHeight;
    autoSaveCurrentAudioResourcesProfile();
    if (window.toastr) toastr.success('已添加新条目');
}

// Helper function to download data as a JSON file
function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Helper function to trigger file import and read the file
function handleFileImport(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
            const data = JSON.parse(text);
            callback(data, file.name);
        } catch (error) {
            toastr.error('导入失败: 无效的 JSON 文件。');
            console.error('JSON parsing error:', error);
        }
    };
    input.click();
}


/**
 * Initializes the audio resources settings tab.
 */
export function initAudioResourcesSettings() {
    const settings = extension_settings[extensionName];

    // Helper to refresh a profile dropdown
    const refreshProfileSelect = (selectElement, profiles, currentProfileKey) => {
        const currentProfileName = settings[currentProfileKey];
        selectElement.empty();
        Object.keys(profiles).sort().forEach(name => {
            const option = new Option(name, name, name === currentProfileName, name === currentProfileName);
            selectElement.append(option);
        });
        if (profiles[currentProfileName]) {
            selectElement.val(currentProfileName);
        }
        selectElement.trigger('change'); // To trigger onProfileLoad
    };

    // 1. Setup for "音效设定" (Audio Resources Profiles)
    // 启动时迁移所有旧的字符串型 content 至条目结构
    Object.values(settings.audio_resources_profiles || {}).forEach(p => ensureProfileEntries(p));

    bindAudioEntryEvents();
    $('#add_audio_resources_entry_button').off('click').on('click', addNewAudioEntry);
    $('#check_audio_resources_entry_button').off('click').on('click', checkAudioEntryNames);

    createProfileManagementUI({
        type: 'audio_resources',
        profiles: settings.audio_resources_profiles,
        currentProfileKey: 'current_audio_resources_profile',
        profileSelectElement: $('#audio_resources_profile_select'),
        newButtonElement: $('#new_audio_resources_profile_button'),
        saveButtonElement: $('#save_audio_resources_profile_button'),
        renameButtonElement: $('#rename_audio_resources_profile_button'),
        deleteButtonElement: $('#delete_audio_resources_profile_button'),
        onProfileLoad: (profile) => {
            ensureProfileEntries(profile);
            renderAudioEntries(profile.entries || []);
        },
        onProfileSave: (profileName) => {
            const profile = settings.audio_resources_profiles[profileName];
            if (!profile) return;
            profile.entries = collectAudioEntriesFromUI();
            profile.content = generateContentFromEntries(profile.entries);
            saveSettingsDebounced();
            toastr.success(`音效设定 "${profileName}" 已保存!`);
        },
        getNewProfileData: () => ({ enabled: true, entries: [], content: '' }),
    });

    // Manual handling for import/export of Audio Resources
    $('#export_audio_resources_profile_button').off('click').on('click', () => {
        const profileName = settings.current_audio_resources_profile;
        if (!profileName || !settings.audio_resources_profiles[profileName]) {
            toastr.warning('没有选择有效的预设。');
            return;
        }
        const profileData = settings.audio_resources_profiles[profileName];
        downloadJson(profileData, `st-is-audio-resources-${profileName}.json`);
    });

    $('#export_all_audio_resources_profile_button').off('click').on('click', () => {
        downloadJson(settings.audio_resources_profiles, `st-is-audio-resources-all.json`);
    });

    $('#import_audio_resources_profile_button').off('click').on('click', () => {
        handleFileImport((data, fileName) => {
            const isSingleProfile = typeof data.content !== 'undefined' && typeof data.enabled !== 'undefined';
            if (isSingleProfile) {
                let profileName = fileName.replace('.json', '').replace(/st-is-audio-resources-?/,'');
                if (settings.audio_resources_profiles[profileName] && !confirm(`预设 "${profileName}" 已存在。要覆盖它吗？`)) {
                    return;
                }
                settings.audio_resources_profiles[profileName] = data;
                ensureProfileEntries(settings.audio_resources_profiles[profileName]);
                toastr.success(`已导入预设 "${profileName}"。`);
            } else {
                if (!confirm(`这将导入多个预设，并可能覆盖现有预设。要继续吗？`)) {
                    return;
                }
                Object.assign(settings.audio_resources_profiles, data);
                Object.values(settings.audio_resources_profiles).forEach(p => ensureProfileEntries(p));
                toastr.success(`已导入多个预设。`);
            }
            saveSettingsDebounced();
            refreshProfileSelect($('#audio_resources_profile_select'), settings.audio_resources_profiles, 'current_audio_resources_profile');
        });
    });

    // 2. Setup for "资源预设" (Audio Asset Profiles)
    const assetsTextarea = $('#st-is-audio-assets-textarea');
    createProfileManagementUI({
        type: 'audio_asset',
        profiles: settings.audio_asset_profiles,
        currentProfileKey: 'current_audio_asset_profile',
        profileSelectElement: $('#audio_asset_profile_select'),
        newButtonElement: $('#new_audio_asset_profile_button'),
        saveButtonElement: $('#save_audio_asset_profile_button'),
        renameButtonElement: $('#rename_audio_asset_profile_button'),
        deleteButtonElement: $('#delete_audio_asset_profile_button'),
        onProfileLoad: (profile) => {
            assetsTextarea.val(profile.content || '');
        },
        onProfileSave: (profileName) => {
            const content = assetsTextarea.val();
            settings.audio_asset_profiles[profileName].content = content;
            saveSettingsDebounced();
            toastr.success(`资源预设 "${profileName}" 已保存!`);
        },
        getNewProfileData: () => ({ enabled: true, content: '' }),
    });

    // Manual handling for import/export of Audio Assets
    $('#export_audio_asset_profile_button').off('click').on('click', () => {
        const profileName = settings.current_audio_asset_profile;
        if (!profileName || !settings.audio_asset_profiles[profileName]) {
            toastr.warning('没有选择有效的预设。');
            return;
        }
        const profileData = settings.audio_asset_profiles[profileName];
        downloadJson(profileData, `st-is-audio-asset-${profileName}.json`);
    });

    $('#export_all_audio_asset_profile_button').off('click').on('click', () => {
        downloadJson(settings.audio_asset_profiles, `st-is-audio-asset-all.json`);
    });

    $('#import_audio_asset_profile_button').off('click').on('click', () => {
        handleFileImport((data, fileName) => {
            const isSingleProfile = typeof data.content !== 'undefined' && typeof data.enabled !== 'undefined';
            if (isSingleProfile) {
                let profileName = fileName.replace('.json', '').replace(/st-is-audio-asset-?/,'');
                if (settings.audio_asset_profiles[profileName] && !confirm(`预设 "${profileName}" 已存在。要覆盖它吗？`)) {
                    return;
                }
                settings.audio_asset_profiles[profileName] = data;
                toastr.success(`已导入预设 "${profileName}"。`);
            } else {
                if (!confirm(`这将导入多个预设，并可能覆盖现有预设。要继续吗？`)) {
                    return;
                }
                Object.assign(settings.audio_asset_profiles, data);
                toastr.success(`已导入多个预设。`);
            }
            saveSettingsDebounced();
            refreshProfileSelect($('#audio_asset_profile_select'), settings.audio_asset_profiles, 'current_audio_asset_profile');
        });
    });

    // Handle "Add to List" button
    $('#st-is-add-asset-button').on('click', () => {
        const key = $('#st-is-new-asset-key').val().trim();
        const url = $('#st-is-new-asset-url').val().trim();
        const uploader = $('#st-is-new-asset-uploader').val().trim() || 'N/A';
        const volume = $('#st-is-new-asset-volume').val().trim() || '100';
        const vibration = $('#st-is-new-asset-vibration').val().trim() || 'N/A';

        if (!key || !url) {
            toastr.warning('名称 (Key) 和 链接 (URL) 不能为空。');
            return;
        }

        const newEntry = `${key}=${url}=${uploader}=${volume}=${vibration}`;
        const currentContent = assetsTextarea.val();
        const newContent = currentContent ? `${currentContent}\n${newEntry}` : newEntry;
        
        assetsTextarea.val(newContent);

        // Clear input fields
        $('#st-is-new-asset-key').val('');
        $('#st-is-new-asset-url').val('');
        $('#st-is-new-asset-uploader').val('');
        $('#st-is-new-asset-volume').val('100');
        $('#st-is-new-asset-vibration').val('');
        
        toastr.info('新资源已添加到列表，请记得保存预设。');
    });

    console.log("Audio Resources settings initialized.");
}

// @ts-nocheck
import { extension_settings  } from "../../../../extensions.js";
import { eventSource,saveSettingsDebounced } from "../../../../../script.js";
import { extensionName, eventNames } from "./config.js";
import { loadAudio, getAllCachedAudio, initDB, memoryCache, storeName } from "./audio-cache.js";

let currentDisplayList = []; // The unfiltered list currently shown in the UI
let currentlyPlayingPreviews = [];
let cacheAllRunState = {
    isRunning: false,
    stopRequested: false,
    recentLogs: [],
    lastProgress: null,
    hideTimerId: null,
};

function getPreviewUrlById(previewId) {
    if (!previewId || typeof previewId !== 'string' || !previewId.startsWith('preview_')) {
        return null;
    }
    return previewId.slice('preview_'.length);
}

function setPreviewButtonState(url, isPlaying) {
    if (!url) return;
    const itemContainer = $('#ac-audio-list-container');
    const playButton = itemContainer.find(`.play-preview-button[data-url="${url}"]`);
    const stopButton = itemContainer.find(`.stop-preview-button[data-url="${url}"]`);

    if (playButton.length > 0 && stopButton.length > 0) {
        playButton.toggle(!isPlaying);
        stopButton.toggle(!!isPlaying);
    }
}

function handleExternalSoundPlaying(data) {
    if (!data || !data.is_preview) return;
    const { id, url } = data;
    const resolvedUrl = url || getPreviewUrlById(id);
    if (!resolvedUrl) return;

    currentlyPlayingPreviews = currentlyPlayingPreviews.filter(item => item.url === resolvedUrl);
    if (!currentlyPlayingPreviews.some(item => item.url === resolvedUrl)) {
        currentlyPlayingPreviews.push({ id, url: resolvedUrl });
    }

    setPreviewButtonState(resolvedUrl, true);
}

function escapeText(text) {
    return $('<div>').text(text == null ? '' : String(text)).html();
}

function getAudioDisplayName(audio) {
    if (!audio) return '未知音频';
    return audio.key || audio.name || audio.url || '未知音频';
}

function setCacheAllControlState(isRunning) {
    $('#ac-cache-all-world-audio-button').prop('disabled', isRunning);
    $('#ac-load-world-audio-button').prop('disabled', isRunning);
    $('#ac-reload-audio-list-button').prop('disabled', isRunning);
    $('#ac-delete-all-cache-button').prop('disabled', isRunning);
    $('#ac-stop-cache-all-button').toggle(isRunning).prop('disabled', false);
    $('#ac-audio-list-container').find('.cache-single-button, .clear-single-button').prop('disabled', isRunning);
}

function appendCacheAllLog(message) {
    if (!message) return;
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    cacheAllRunState.recentLogs.push(`[${timestamp}] ${message}`);
    if (cacheAllRunState.recentLogs.length > 50) {
        cacheAllRunState.recentLogs = cacheAllRunState.recentLogs.slice(-50);
    }
}

function clearCacheAllProgressHideTimer() {
    if (cacheAllRunState.hideTimerId) {
        clearTimeout(cacheAllRunState.hideTimerId);
        cacheAllRunState.hideTimerId = null;
    }
}

function scheduleCacheAllProgressHide(delay = 800) {
    clearCacheAllProgressHideTimer();
    cacheAllRunState.hideTimerId = setTimeout(() => {
        $('#ac-cache-progress-container').hide();
        cacheAllRunState.hideTimerId = null;
    }, delay);
}

function renderCacheAllProgress(state) {
    const cacheProgressContainer = $('#ac-cache-progress-container');
    const cacheProgressBar = $('#ac-cache-progress-bar');
    const cacheProgressLabel = $('#ac-cache-progress-label');
    const cacheProgressSummary = $('#ac-cache-progress-summary');
    const cacheProgressCurrent = $('#ac-cache-progress-current');
    const cacheProgressLog = $('#ac-cache-progress-log');
    const totalCount = state.totalCount || 0;
    const processedCount = state.processedCount || 0;
    const cachedCount = state.cachedCount || 0;
    const failedCount = state.failedCount || 0;
    const skippedCount = state.skippedCount || 0;
    const remainingCount = Math.max(totalCount - processedCount, 0);
    const progress = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;
    cacheAllRunState.lastProgress = {
        totalCount,
        processedCount,
        cachedCount,
        failedCount,
        skippedCount,
    };

    cacheProgressContainer.show();
    cacheProgressBar.val(progress);
    cacheProgressLabel.text(`${progress}%`);
    cacheProgressSummary.text(`总数: ${totalCount} | 已处理: ${processedCount} | 新增成功: ${cachedCount} | 已跳过: ${skippedCount} | 失败: ${failedCount} | 剩余: ${remainingCount}`);
    cacheProgressCurrent.text(state.currentText || '');
    cacheProgressLog.text(cacheAllRunState.recentLogs.join('\n'));
    if (cacheProgressLog.length) {
        cacheProgressLog.scrollTop(cacheProgressLog[0].scrollHeight);
    }
}

async function getCachedAudioSizeByUrl(url) {
    const db = await initDB();
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const cachedItem = await new Promise((resolve, reject) => {
        const request = store.get(url);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return cachedItem?.arrayBuffer?.byteLength || 0;
}

function updateRenderedAudioItemCachedState(audio, cachedSize) {
    const items = $('#ac-audio-list-container .audio-item');
    for (const element of items) {
        const item = $(element);
        const itemAudio = item.data('audio');
        if (!itemAudio || itemAudio.url !== audio.url) continue;
        item.data('audio', audio);
        item.removeClass('status-uncached').addClass('status-cached');
        item.find('.audio-size').text(formatBytes(cachedSize));
        const cacheButton = item.find('.cache-single-button');
        if (cacheButton.length) {
            const newButton = $(`<button class="action-button danger clear-single-button" title="清除" data-url="${audio.url}"><i class="fa-solid fa-trash"></i></button>`);
            newButton.prop('disabled', cacheAllRunState.isRunning);
            cacheButton.replaceWith(newButton);
        }
        break;
    }
}

/**
 * 从一行内容中提取资源名称（去掉行尾括号备注）。
 * 例："Ambiance_xxx (注意:...)" -> "Ambiance_xxx"
 */
function extractAssetNameFromLine(line) {
    if (!line) return '';
    let s = String(line).trim();
    if (!s || s.startsWith('#')) return '';
    s = s.replace(/[（(][^（()）]*[)）]\s*$/u, '').trim();
    return s;
}

function getCurrentResourcesProfile() {
    const settings = extension_settings[extensionName] || {};
    const name = settings.current_audio_resources_profile || null;
    const profile = name ? ((settings.audio_resources_profiles || {})[name] || null) : null;
    return { name, profile };
}

/**
 * 从当前"音效设定预设"的所有条目构建：
 *   assetKey -> Set<entryId>
 * 同时返回 entryId -> entryName 映射用于展示。
 */
function buildEntryMembership() {
    const map = new Map();
    const idToName = new Map();
    const { profile } = getCurrentResourcesProfile();
    if (!profile || !Array.isArray(profile.entries)) {
        return { map, idToName };
    }
    for (const entry of profile.entries) {
        if (!entry) continue;
        const tag = entry.name || '(未命名)';
        const eid = entry.id || '';
        if (eid) idToName.set(eid, tag);
        const lines = String(entry.content || '').split(/\r?\n/);
        for (const rawLine of lines) {
            const name = extractAssetNameFromLine(rawLine);
            if (!name) continue;
            if (!map.has(name)) map.set(name, new Set());
            map.get(name).add(eid);
        }
    }
    return { map, idToName };
}

/**
 * 以条目数组重新生成 profile.content（仅启用条目）。
 * 与 ui-audio-resources.js 中 generateContentFromEntries 保持一致。
 */
function regenerateResourcesProfileContent(entries) {
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

function syncResourcesEntryPreview(entry) {
    const $entryEl = $(`#st-is-audio-resources-entries .st-is-preset-entry[data-entry-id="${entry.id}"]`);
    if ($entryEl.length) {
        $entryEl.find('.st-is-entry-content').val(entry.content);
        const previewSrc = String(entry.content || '').replace(/\s+/g, ' ').trim();
        const preview = previewSrc.length > 50 ? previewSrc.substring(0, 50) + '...' : (previewSrc || '(空)');
        $entryEl.find('.st-is-entry-preview').text(preview);
    }
}

function renderMembershipBadgesHtml(audio, membership, selectedEntry) {
    const selectedEntryId = (typeof selectedEntry === 'string' && selectedEntry.startsWith('entry:'))
        ? selectedEntry.slice(6) : null;
    const assetKey = audio.key || audio.name || '';
    const memberIds = membership.map.get(assetKey) || new Set();
    const memberArray = [...memberIds]
        .map(id => ({ id, name: membership.idToName.get(id) || '(未命名)' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'));

    if (memberArray.length === 0) {
        return '<span class="ac-preset-badge none">未在任何条目</span>';
    }

    return memberArray.map(m => {
        const isCurrent = !!(selectedEntryId && m.id === selectedEntryId);
        return `<span class="ac-preset-badge${isCurrent ? ' current' : ''}" title="${escapeText(m.name)}">${escapeText(m.name)}</span>`;
    }).join('');
}

function refreshAudioItemMembershipDisplay(item, audio) {
    const membership = buildEntryMembership();
    const selectedEntry = $('#ac-entry-select').val() || '__all__';
    const badgesHtml = renderMembershipBadgesHtml(audio, membership, selectedEntry);
    item.find('.audio-item-presets').html(`
        <span class="ac-preset-badge-label">所在条目:</span>
        ${badgesHtml}
    `);
}

function onEditableClick(event) {
    const span = $(event.currentTarget);
    // Prevent editing non-profile items
    const audioData = span.closest('.audio-item').data('audio');
    if (audioData.source_profile === '未知来源 (仅缓存)') {
        toastr.info('无法编辑仅存在于缓存中的音频。');
        return;
    }

    // Prevent starting a new edit if one is already active in this item
    if (span.closest('.audio-item').find('input.inline-edit-input').length > 0) {
        return;
    }
    
    const oldValue = span.text();
    const field = span.data('field');
    const input = $('<input type="text" class="inline-edit-input">');
    input.val(oldValue);
    span.hide().after(input);
    input.focus();

    const saveChanges = async () => {
        const newValue = input.val().trim();
        const item = span.closest('.audio-item');
        const originalAudioData = { ...item.data('audio') }; // A snapshot before any changes

        // The URL before this specific edit. If we are editing the URL, the old value is the key.
        const urlToFind = (field === 'url') ? oldValue : originalAudioData.url;

        // Put UI back
        input.remove();
        span.show();

        if (newValue === oldValue || newValue === '') {
            if (newValue === '') toastr.warning('值不能为空。');
            return; // No change or empty value
        }

        // Find and update the line in settings
        const settings = extension_settings[extensionName];
        const profileName = originalAudioData.source_profile;
        const assetProfile = settings.audio_asset_profiles[profileName];

        if (!assetProfile) {
            toastr.error(`无法找到来源预设 "${profileName}"`);
            return;
        }

        const lines = assetProfile.content.split('\n');
        const lineIndex = lines.findIndex(line => {
            const parts = line.split('=');
            return parts[1] && parts[1].trim() === urlToFind;
        });

        if (lineIndex === -1) {
            toastr.error(`无法在预设 "${profileName}" 中找到条目: ${urlToFind}`);
            return;
        }

        // Update the audioData object for reconstructing the line
        const updatedAudioData = { ...originalAudioData, [field]: newValue };

        // Reconstruct the line
        const { key, url, uploader, volume, vibration } = updatedAudioData;
        lines[lineIndex] = `${key}=${url}=${uploader}=${volume}=${vibration}`;
        assetProfile.content = lines.join('\n');

        // Save settings
        try {
            await saveSettingsDebounced();
            toastr.success(`已更新 "${updatedAudioData.key}"`);
            
            // If save is successful, update UI and data permanently
            span.text(newValue);
            item.data('audio', updatedAudioData);

            // If URL was changed, we need to update the data-url on buttons too
            if (field === 'url') {
                item.find('.play-preview-button, .stop-preview-button, .clear-single-button, .cache-single-button').attr('data-url', newValue).data('url', newValue);
            }
            if (field === 'key') {
                 item.find('.play-preview-button, .cache-single-button').attr('data-name', newValue).data('name', newValue);
            }
            if (field === 'volume') {
                const normalizedVolume = Number(newValue) / 100;
                item.find('.play-preview-button').attr('data-volume', normalizedVolume).data('volume', normalizedVolume);
                item.find('.cache-single-button').attr('data-volume', newValue).data('volume', newValue);
            }
            if (field === 'uploader') {
                item.find('.play-preview-button, .cache-single-button').attr('data-uploader', newValue).data('uploader', newValue);
            }
            if (field === 'vibration') {
                item.find('.play-preview-button').attr('vibration', newValue);
                item.find('.cache-single-button').attr('data-vibration', newValue).data('vibration', newValue);
             }

             // Update the textarea in the Audio Resources tab if the profile matches
             const audioAssetProfileSelect = $('#audio_asset_profile_select');
             if (audioAssetProfileSelect.val() === profileName) {
                $('#st-is-audio-assets-textarea').val(assetProfile.content);
            }

        } catch (error) {
            toastr.error('保存失败!');
            // Don't update UI or data if save fails
        }
    };

    input.on('blur', saveChanges);
    input.on('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        } else if (e.key === 'Escape') {
            input.off('blur'); // Prevent saving on blur
            input.remove();
            span.show();
        }
    });
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '未知';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'kb', 'mb', 'gb', 'tb'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    let size = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
    if (i === 0) {
        return size + ' Bytes';
    }
    return size + sizes[i];
}

async function renderAudioList(audioList, membership, selectedEntry) {
    const container = $('#ac-audio-list-container');
    container.empty();

    if (!audioList || audioList.length === 0) {
        container.append('<p>没有找到音频文件。请尝试从预设加载或显示已缓存音频。</p>');
        return;
    }

    if (!membership) membership = buildEntryMembership();
    if (!selectedEntry) selectedEntry = $('#ac-entry-select').val() || '__all__';
    const selectedEntryId = (typeof selectedEntry === 'string' && selectedEntry.startsWith('entry:'))
        ? selectedEntry.slice(6) : null;

    for (const audio of audioList) {
        const cachedSize = Number.isFinite(audio.cachedSize)
            ? audio.cachedSize
            : (audio.arrayBuffer?.byteLength || 0);
        const isCached = cachedSize > 0;
        const uploader = audio.uploader || 'N/A';
        const volume = audio.volume || 100;
        const vibration = audio.vibration || 'N/A';
        const size = isCached ? formatBytes(cachedSize) : '未知';
        const displayVolume = volume / 100;

        const assetKey = audio.key || audio.name || '';
        const memberIds = membership.map.get(assetKey) || new Set();
        const memberArray = [...memberIds]
            .map(id => ({ id, name: membership.idToName.get(id) || '(未命名)' }))
            .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        let presetBadgesHtml;
        if (memberArray.length === 0) {
            presetBadgesHtml = '<span class="ac-preset-badge none">未在任何条目</span>';
        } else {
            presetBadgesHtml = memberArray.map(m => {
                const isCurrent = !!(selectedEntryId && m.id === selectedEntryId);
                return `<span class="ac-preset-badge${isCurrent ? ' current' : ''}" title="${escapeText(m.name)}">${escapeText(m.name)}</span>`;
            }).join('');
        }

        const item = $(`
            <div class="audio-item ${isCached ? 'status-cached' : 'status-uncached'}">
                <div class="audio-item-info">
                    <div class="audio-item-main">
                        <span class="audio-name editable" data-field="key">${audio.key || audio.name}</span>
                        <span class="audio-size"></span>
                    </div>
                    <div class="audio-item-details">
                        <span>上传者: <span class="editable" data-field="uploader">${uploader}</span></span>
                        <span>音量: <span class="editable" data-field="volume">${volume}</span></span>
                        <span>震动: <span class="editable" data-field="vibration">${vibration}</span></span>
                        <span>来源: <span>${audio.source_profile}</span></span>
                        <span class="analysis-result-span" style="display:none; color: #ff9800; font-weight: bold; margin-left: 10px;"></span>
                    </div>
                    <div class="audio-item-presets">
                        <span class="ac-preset-badge-label">所在条目:</span>
                        ${presetBadgesHtml}
                    </div>
                    <div class="audio-item-url">
                        <span>URL: <span class="editable" data-field="url">${audio.url}</span></span>
                    </div>
                </div>
                <div class="audio-item-actions">
                </div>
            </div>
        `);

        item.data('audio', audio);
        item.find('.audio-size').text(size);

        const actions = item.find('.audio-item-actions');
        actions.append(`<button class="action-button play-preview-button" title="播放" data-url="${audio.url}" data-name="${audio.key || audio.name}" data-volume=${displayVolume} data-uploader="${uploader}" vibration="${vibration}"><i class="fa-solid fa-play"></i></button>`);
        actions.append(`<button class="action-button stop-preview-button" title="停止" data-url="${audio.url}" style="display: none;"><i class="fa-solid fa-stop"></i></button>`);
        actions.append(`<button class="action-button analyze-audio-button" title="频响分析" data-url="${audio.url}"><i class="fa-solid fa-chart-bar"></i></button>`);
        actions.append(`<button class="action-button add-to-preset-button" title="添加到条目"><i class="fa-solid fa-plus"></i></button>`);
        actions.append(`<button class="action-button danger remove-from-entry-button" title="从条目移出"><i class="fa-solid fa-minus"></i></button>`);

        const isPlaying = currentlyPlayingPreviews.some(p => p.url === audio.url);
        if (isPlaying) {
            actions.find('.play-preview-button').hide();
            actions.find('.stop-preview-button').show();
        }

        if (isCached) {
            actions.append(`<button class="action-button danger clear-single-button" title="清除" data-url="${audio.url}"><i class="fa-solid fa-trash"></i></button>`);
        } else {
            actions.append(`<button class="action-button cache-single-button" title="缓存" data-url="${audio.url}" data-name="${audio.key || audio.name}" data-uploader="${audio.uploader || 'N/A'}" data-volume="${volume}" data-vibration="${vibration}"><i class="fa-solid fa-download"></i></button>`);
        }
        
        container.append(item);
    }
}

const KNOWN_CATEGORY_PREFIXES = ['SFX_', 'Music_', 'Ambiance_'];

function matchCategory(key, category) {
    if (!category || category === '__all__') return true;
    if (category === '__other__') {
        return !KNOWN_CATEGORY_PREFIXES.some(prefix => key.startsWith(prefix));
    }
    return key.startsWith(category);
}

async function applyAudioListFilter() {
    const searchTerm = ($('#ac-search-input').val() || '').toLowerCase();
    const category = $('#ac-category-select').val() || '__all__';
    const selectedEntry = $('#ac-entry-select').val() || '__all__';
    if (!currentDisplayList) {
        await renderAudioList([]);
        return;
    }

    const membership = buildEntryMembership();

    const filteredList = currentDisplayList.filter(audio => {
        const rawKey = audio.key || audio.name || '';
        if (!matchCategory(rawKey, category)) return false;
        if (!rawKey.toLowerCase().includes(searchTerm)) return false;

        if (selectedEntry !== '__all__') {
            const set = membership.map.get(rawKey) || null;
            if (selectedEntry === '__not_in_any__') {
                if (set && set.size > 0) return false;
            } else if (selectedEntry.startsWith('entry:')) {
                const entryId = selectedEntry.slice(6);
                if (!set || !set.has(entryId)) return false;
            }
        }
        return true;
    });
    await renderAudioList(filteredList, membership, selectedEntry);
}

/**
 * 将一条音频的 key 加入到当前"音效设定预设"的指定条目中
 */
async function addAudioToEntry(audio, entryId) {
    const { name: profileName, profile } = getCurrentResourcesProfile();
    if (!profile || !Array.isArray(profile.entries)) {
        toastr.warning('当前没有激活的音效设定预设。');
        return;
    }
    const entry = profile.entries.find(e => e && e.id === entryId);
    if (!entry) {
        toastr.error('找不到目标条目。');
        return;
    }
    const assetKey = audio.key || audio.name;
    if (!assetKey) {
        toastr.error('音频缺少名称，无法添加。');
        return;
    }

    const lines = String(entry.content || '').split(/\r?\n/);
    const exists = lines.some(line => extractAssetNameFromLine(line) === assetKey);
    if (exists) {
        toastr.info(`已存在于条目 "${entry.name || ''}"。`);
        return;
    }
    const trimmed = String(entry.content || '').replace(/\s*$/, '');
    entry.content = trimmed ? `${trimmed}\n${assetKey}` : assetKey;
    profile.content = regenerateResourcesProfileContent(profile.entries);

    try {
        await saveSettingsDebounced();
        toastr.success(`已添加到 "${profileName}" / "${entry.name || ''}"`);
        syncResourcesEntryPreview(entry);
        populateEntryFilterSelect();
        await applyAudioListFilter();
    } catch (e) {
        console.error('添加到条目失败:', e);
        toastr.error('保存失败，添加未成功。');
    }
}

/**
 * 显示"添加到条目"的下拉菜单。
 * 列出当前音效设定预设下的所有条目。
 */
function showAddToEntryMenu(buttonEl, audio) {
    $('.ac-add-preset-menu').remove();

    const { name: profileName, profile } = getCurrentResourcesProfile();
    if (!profile || !Array.isArray(profile.entries) || profile.entries.length === 0) {
        toastr.info('当前音效设定预设下没有可用条目。');
        return;
    }

    const membership = buildEntryMembership();
    const assetKey = audio.key || audio.name || '';
    const memberSet = (assetKey && membership.map.get(assetKey)) || new Set();

    const menu = $('<div class="ac-add-preset-menu"></div>');
    const titleText = `添加到条目（${profileName || '未选择预设'}）`;
    menu.append($('<div class="ac-add-preset-menu-title"></div>').text(titleText));

    for (const entry of profile.entries) {
        if (!entry) continue;
        const tag = entry.name || '(未命名)';
        const inIt = entry.id ? memberSet.has(entry.id) : false;
        const enabled = entry.enabled !== false;
        const extras = [];
        if (inIt) extras.push('已存在');
        if (!enabled) extras.push('未启用');
        const suffix = extras.length ? ` (${extras.join('，')})` : '';
        const itemEl = $(`<div class="ac-add-preset-menu-item${inIt ? ' disabled' : ''}"></div>`).text(tag + suffix);
        if (!inIt) {
            itemEl.on('click', async (ev) => {
                ev.stopPropagation();
                menu.remove();
                await addAudioToEntry(audio, entry.id);
            });
        }
        menu.append(itemEl);
    }

    const rect = buttonEl.getBoundingClientRect();
    const menuWidth = 240;
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    menu.css({
        position: 'fixed',
        top: (rect.bottom + 4) + 'px',
        left: left + 'px',
        'z-index': 10000,
        'min-width': menuWidth + 'px',
    });
    $('body').append(menu);

    // 垂直边界检查：如果菜单超出视口底部则向上弹出
    const menuHeight = menu[0].offsetHeight;
    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight - 8) {
        top = rect.top - menuHeight - 4;
        if (top < 8) top = 8;
    }
    menu.css('top', top + 'px');

    setTimeout(() => {
        $(document).one('mousedown.acAddPresetMenu', (ev) => {
            if (!$(ev.target).closest('.ac-add-preset-menu').length) {
                menu.remove();
            }
        });
    }, 0);
}

function onAddToPresetClick(event) {
    event.stopPropagation();
    const button = $(event.currentTarget);
    const item = button.closest('.audio-item');
    const audio = item.data('audio');
    if (!audio) return;
    showAddToEntryMenu(button[0], audio);
}

async function removeAudioFromEntry(audio, entryId, item) {
    const { name: profileName, profile } = getCurrentResourcesProfile();
    if (!profile || !Array.isArray(profile.entries)) {
        toastr.warning('当前没有激活的音效设定预设。');
        return;
    }
    const entry = profile.entries.find(e => e && e.id === entryId);
    if (!entry) {
        toastr.error('找不到目标条目。');
        return;
    }
    const assetKey = audio.key || audio.name;
    if (!assetKey) {
        toastr.error('音频缺少名称，无法移出。');
        return;
    }

    const originalLines = String(entry.content || '').split(/\r?\n/);
    const filteredLines = originalLines.filter(line => extractAssetNameFromLine(line) !== assetKey);
    if (filteredLines.length === originalLines.length) {
        toastr.info(`条目 "${entry.name || ''}" 中不存在该音频。`);
        return;
    }

    entry.content = filteredLines.join('\n').replace(/^\s*\r?\n/, '').replace(/\r?\n\s*$/, '');
    profile.content = regenerateResourcesProfileContent(profile.entries);

    try {
        await saveSettingsDebounced();
        toastr.success(`已从 "${profileName}" / "${entry.name || ''}" 移出`);
        syncResourcesEntryPreview(entry);
        populateEntryFilterSelect();
        if (item && item.length) {
            refreshAudioItemMembershipDisplay(item, audio);
        }
    } catch (e) {
        console.error('从条目移出失败:', e);
        toastr.error('保存失败，移出未成功。');
    }
}

function showRemoveFromEntryMenu(buttonEl, audio, item) {
    $('.ac-add-preset-menu').remove();

    const { name: profileName, profile } = getCurrentResourcesProfile();
    if (!profile || !Array.isArray(profile.entries) || profile.entries.length === 0) {
        toastr.info('当前音效设定预设下没有可用条目。');
        return;
    }

    const membership = buildEntryMembership();
    const assetKey = audio.key || audio.name || '';
    const memberSet = (assetKey && membership.map.get(assetKey)) || new Set();
    if (!memberSet.size) {
        toastr.info('该音频当前不在任何条目中。');
        return;
    }

    const menu = $('<div class="ac-add-preset-menu"></div>');
    const titleText = `从条目移出（${profileName || '未选择预设'}）`;
    menu.append($('<div class="ac-add-preset-menu-title"></div>').text(titleText));

    for (const entry of profile.entries) {
        if (!entry || !entry.id || !memberSet.has(entry.id)) continue;
        const tag = entry.name || '(未命名)';
        const enabled = entry.enabled !== false;
        const label = enabled ? tag : `${tag} (未启用)`;
        const itemEl = $('<div class="ac-add-preset-menu-item"></div>').text(label);
        itemEl.on('click', async (ev) => {
            ev.stopPropagation();
            menu.remove();
            await removeAudioFromEntry(audio, entry.id, item);
        });
        menu.append(itemEl);
    }

    const rect = buttonEl.getBoundingClientRect();
    const menuWidth = 240;
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    menu.css({
        position: 'fixed',
        top: (rect.bottom + 4) + 'px',
        left: left + 'px',
        'z-index': 10000,
        'min-width': menuWidth + 'px',
    });
    $('body').append(menu);

    // 垂直边界检查：如果菜单超出视口底部则向上弹出
    const menuHeight = menu[0].offsetHeight;
    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight - 8) {
        top = rect.top - menuHeight - 4;
        if (top < 8) top = 8;
    }
    menu.css('top', top + 'px');

    setTimeout(() => {
        $(document).one('mousedown.acAddPresetMenu', (ev) => {
            if (!$(ev.target).closest('.ac-add-preset-menu').length) {
                menu.remove();
            }
        });
    }, 0);
}

function onRemoveFromEntryClick(event) {
    event.stopPropagation();
    const button = $(event.currentTarget);
    const item = button.closest('.audio-item');
    const audio = item.data('audio');
    if (!audio) return;
    showRemoveFromEntryMenu(button[0], audio, item);
}

function populateEntryFilterSelect() {
    const select = $('#ac-entry-select');
    if (select.length === 0) return;
    const previousValue = select.val() || '__all__';
    const { profile } = getCurrentResourcesProfile();

    select.empty();
    select.append('<option value="__all__">全部</option>');
    select.append('<option value="__not_in_any__">未在任何条目</option>');

    if (profile && Array.isArray(profile.entries)) {
        for (const entry of profile.entries) {
            if (!entry || !entry.id) continue;
            const tag = entry.name || '(未命名)';
            const enabled = entry.enabled !== false;
            const label = enabled ? tag : `${tag} (未启用)`;
            const opt = $('<option></option>').attr('value', `entry:${entry.id}`).text(label);
            select.append(opt);
        }
    }

    // 还原之前的选择（若仍存在）
    const validValues = Array.from(select[0].options).map(o => o.value);
    select.val(validValues.includes(previousValue) ? previousValue : '__all__');
}

function populatePresetSelect() {
    const settings = extension_settings[extensionName];
    const assetProfiles = settings.audio_asset_profiles || {};
    const select = $('#ac-preset-select');
    if (select.length === 0) return;

    const previousValue = select.val() || '__all__';
    select.empty();
    select.append('<option value="__all__">全部启用的预设</option>');

    const profileNames = Object.keys(assetProfiles).sort((a, b) => a.localeCompare(b, 'zh'));
    for (const name of profileNames) {
        const profile = assetProfiles[name];
        const enabled = profile && profile.enabled;
        const label = enabled ? name : `${name} (未启用)`;
        const escapedName = $('<div>').text(name).html();
        const escapedLabel = $('<div>').text(label).html();
        select.append(`<option value="${escapedName}">${escapedLabel}</option>`);
    }

    if (profileNames.includes(previousValue) || previousValue === '__all__') {
        select.val(previousValue);
    } else {
        select.val('__all__');
    }
}

function onLoadProfilesAudioClick() {
    const settings = extension_settings[extensionName];
    const assetProfiles = settings.audio_asset_profiles || {};
    const selectedPreset = $('#ac-preset-select').val() || '__all__';
    let combinedAudioList = [];
    let loadedProfileCount = 0;

    const collectFromProfile = (profileName, profile) => {
        if (!profile || !profile.content) return;
        const lines = profile.content.split('\n');
        let added = 0;
        lines.forEach(line => {
            if (line.trim() === '') return;
            const [k, url, uploader, volume, vibration] = line.split('=');
            if (k && url) {
                combinedAudioList.push({
                    key: k.trim(),
                    url: url.trim(),
                    uploader: uploader ? uploader.trim() : 'N/A',
                    volume: volume ? parseFloat(volume.trim()) : 100,
                    vibration: vibration ? vibration.trim() : 'N/A',
                    source_profile: profileName,
                });
                added++;
            }
        });
        if (added > 0) loadedProfileCount++;
    };

    if (selectedPreset === '__all__') {
        for (const profileName in assetProfiles) {
            const profile = assetProfiles[profileName];
            if (profile && profile.enabled) {
                collectFromProfile(profileName, profile);
            }
        }
    } else {
        const profile = assetProfiles[selectedPreset];
        if (!profile) {
            toastr.error(`找不到预设 "${selectedPreset}"。`);
            return;
        }
        collectFromProfile(selectedPreset, profile);
    }

    if (combinedAudioList.length === 0) {
        toastr.info(selectedPreset === '__all__'
            ? "没有在启用的预设中找到音频。"
            : `预设 "${selectedPreset}" 中没有音频。`);
    } else if (selectedPreset === '__all__') {
        toastr.success(`已从 ${loadedProfileCount} 个预设中加载 ${combinedAudioList.length} 个音频。`);
    } else {
        toastr.success(`已从预设 "${selectedPreset}" 加载 ${combinedAudioList.length} 个音频。`);
    }

    currentDisplayList = combinedAudioList;
    applyAudioListFilter();
}

async function onCacheAllWorldAudioClick() {
    if (cacheAllRunState.isRunning) {
        toastr.info("批量缓存正在进行中。", "缓存管理");
        return;
    }
    if (!currentDisplayList || currentDisplayList.length === 0) {
        toastr.info("没有音频需要缓存。请先从预设加载。");
        return;
    }

    cacheAllRunState.isRunning = true;
    cacheAllRunState.stopRequested = false;
    cacheAllRunState.recentLogs = [];
    cacheAllRunState.lastProgress = null;
    clearCacheAllProgressHideTimer();
    setCacheAllControlState(true);

    let cachedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let processedCount = 0;
    const totalCount = currentDisplayList.length;
    const cachedAudioData = await getAllCachedAudio({ includeArrayBuffer: false });
    const cachedUrlSet = new Set(
        cachedAudioData
            .filter(item => item && item.url && item.cachedSize > 0)
            .map(item => item.url)
    );

    appendCacheAllLog(`开始缓存，共 ${totalCount} 个音频。`);
    renderCacheAllProgress({
        totalCount,
        processedCount,
        cachedCount,
        failedCount,
        skippedCount,
        currentText: `准备开始，共 ${totalCount} 个音频。`,
    });

    try {
        for (let i = 0; i < totalCount; i++) {
            if (cacheAllRunState.stopRequested) {
                break;
            }

            const audio = currentDisplayList[i];
            const audioName = getAudioDisplayName(audio);
            renderCacheAllProgress({
                totalCount,
                processedCount,
                cachedCount,
                failedCount,
                skippedCount,
                currentText: `正在缓存 (${i + 1}/${totalCount}): ${audioName}`,
            });

            try {
                if (cachedUrlSet.has(audio.url)) {
                    skippedCount++;
                    const cachedSize = audio.cachedSize || await getCachedAudioSizeByUrl(audio.url);
                    audio.cachedSize = cachedSize;
                    updateRenderedAudioItemCachedState(audio, cachedSize);
                    appendCacheAllLog(`跳过: ${audioName} - 已存在缓存`);
                    continue;
                }

                const persisted = await loadAudio(audio.url, audio.key, audio.uploader, audio.volume, audio.vibration, { forceRefresh: true, persistOnly: true });
                if (!persisted) {
                    throw new Error('写入缓存失败');
                }
                cachedCount++;
                const cachedSize = await getCachedAudioSizeByUrl(audio.url);
                audio.cachedSize = cachedSize;
                cachedUrlSet.add(audio.url);
                updateRenderedAudioItemCachedState(audio, cachedSize);
                appendCacheAllLog(`成功: ${audioName}`);
            } catch (error) {
                failedCount++;
                console.error(`缓存失败 ${audio.url}:`, error);
                appendCacheAllLog(`失败: ${audioName} - ${error.message || '未知错误'}`);
                toastr.error(`缓存失败 ${audioName}: ${error.message}`);
            } finally {
                processedCount++;
                renderCacheAllProgress({
                    totalCount,
                    processedCount,
                    cachedCount,
                    failedCount,
                    skippedCount,
                    currentText: `最近处理: ${audioName}`,
                });
            }
        }

        const wasStopped = cacheAllRunState.stopRequested && processedCount < totalCount;
        if (wasStopped) {
            const remainingCount = totalCount - processedCount;
            appendCacheAllLog(`已停止，剩余 ${remainingCount} 个未处理。`);
            renderCacheAllProgress({
                totalCount,
                processedCount,
                cachedCount,
                failedCount,
                skippedCount,
                currentText: `已停止。新增成功 ${cachedCount} 个，跳过 ${skippedCount} 个，失败 ${failedCount} 个，剩余 ${remainingCount} 个。`,
            });
            if (cachedCount > 0 || failedCount > 0 || skippedCount > 0) {
                toastr.warning(`缓存已停止，新增成功 ${cachedCount} 个，跳过 ${skippedCount} 个，失败 ${failedCount} 个，剩余 ${remainingCount} 个未处理。`);
            } else {
                toastr.info(`缓存已停止，剩余 ${remainingCount} 个未处理。`);
            }
            scheduleCacheAllProgressHide();
        } else if (failedCount > 0 && (cachedCount > 0 || skippedCount > 0)) {
            appendCacheAllLog(`缓存完成，新增成功 ${cachedCount} 个，跳过 ${skippedCount} 个，失败 ${failedCount} 个。`);
            renderCacheAllProgress({
                totalCount,
                processedCount,
                cachedCount,
                failedCount,
                skippedCount,
                currentText: `缓存完成，新增成功 ${cachedCount} 个，跳过 ${skippedCount} 个，失败 ${failedCount} 个。`,
            });
            toastr.warning(`缓存完成，新增成功 ${cachedCount} 个，跳过 ${skippedCount} 个，失败 ${failedCount} 个。`);
        } else if (failedCount > 0 && cachedCount === 0 && skippedCount === 0) {
            appendCacheAllLog(`所有 ${failedCount} 个音频均缓存失败。`);
            renderCacheAllProgress({
                totalCount,
                processedCount,
                cachedCount,
                failedCount,
                skippedCount,
                currentText: `所有 ${failedCount} 个音频均缓存失败。`,
            });
            toastr.error(`所有 ${failedCount} 个音频均缓存失败。`);
        } else if (failedCount === 0 && cachedCount > 0) {
            appendCacheAllLog(`缓存完成，新增成功 ${cachedCount} 个，跳过 ${skippedCount} 个。`);
            renderCacheAllProgress({
                totalCount,
                processedCount,
                cachedCount,
                failedCount,
                skippedCount,
                currentText: `缓存完成，新增成功 ${cachedCount} 个，跳过 ${skippedCount} 个。`,
            });
            toastr.success(`缓存完成，新增成功 ${cachedCount} 个，跳过 ${skippedCount} 个。`);
        } else if (failedCount === 0 && cachedCount === 0 && skippedCount > 0) {
            appendCacheAllLog(`全部 ${skippedCount} 个音频已存在缓存，无需重复下载。`);
            renderCacheAllProgress({
                totalCount,
                processedCount,
                cachedCount,
                failedCount,
                skippedCount,
                currentText: `全部 ${skippedCount} 个音频已存在缓存，无需重复下载。`,
            });
            toastr.info(`全部 ${skippedCount} 个音频已存在缓存，无需重复下载。`);
        } else {
            appendCacheAllLog('没有新的音频需要缓存。');
            renderCacheAllProgress({
                totalCount,
                processedCount,
                cachedCount,
                failedCount,
                skippedCount,
                currentText: '没有新的音频需要缓存。',
            });
            toastr.info("没有新的音频需要缓存。");
        }

        if (!wasStopped && cachedCount > 0) {
            await onReloadAudioListClick({ isManual: true });
        }
    } finally {
        cacheAllRunState.isRunning = false;
        cacheAllRunState.stopRequested = false;
        setCacheAllControlState(false);
    }
}

function onStopCacheAllClick() {
    if (!cacheAllRunState.isRunning || cacheAllRunState.stopRequested) {
        return;
    }
    cacheAllRunState.stopRequested = true;
    $('#ac-stop-cache-all-button').prop('disabled', true);
    appendCacheAllLog('已请求停止，等待当前音频处理完成。');
    renderCacheAllProgress({
        ...(cacheAllRunState.lastProgress || {}),
        currentText: '停止中，等待当前音频处理完成...',
    });
}

export async function onReloadAudioListClick(options) {
    if (!options?.isManual) {
        if (currentDisplayList.length === 0) {
            await renderAudioList([]);
            console.log("声临其境: 音频管理页面已加载，请手动加载资源。");
        } else {
            await applyAudioListFilter();
        }
        return;
    }
    // 1. Get all audio asset profiles from settings
    const settings = extension_settings[extensionName];
    const assetProfiles = settings.audio_asset_profiles || {};
    const profileAudioMap = new Map();

    for (const profileName in assetProfiles) {
        const profile = assetProfiles[profileName];
        if (profile && profile.enabled && profile.content) {
            const lines = profile.content.split('\n');
            lines.forEach(line => {
                if (line.trim() === '') return;
                const [k, url, uploader, volume, vibration] = line.split('=');
                if (k && url) {
                    profileAudioMap.set(url.trim(), {
                        key: k.trim(),
                        url: url.trim(),
                        uploader: uploader ? uploader.trim() : 'N/A',
                        volume: volume ? parseFloat(volume.trim()) : 100,
                        vibration: vibration ? vibration.trim() : 'N/A',
                        source_profile: profileName,
                    });
                }
            });
        }
    }

    // 2. Get all cached audio data {url, arrayBuffer}
    const cachedAudioData = await getAllCachedAudio({ includeArrayBuffer: false });
    if (cachedAudioData.length === 0) {
        toastr.info("没有找到已缓存的音频。");
        currentDisplayList = [];
        await applyAudioListFilter();
        return;
    }

    // 3. Merge cached data with profile metadata
    const mergedAudioList = [];
    for (const cachedItem of cachedAudioData) {
        const profileData = profileAudioMap.get(cachedItem.url);
        if (profileData) {
            // Found a match in the profiles, merge them
            mergedAudioList.push({
                ...profileData, // key, uploader, volume, etc. from profile
                cachedSize: cachedItem.cachedSize
            });
        } else {
            // Handle cached audio that is no longer in any profile
            mergedAudioList.push({
                key: '未知名称',
                url: cachedItem.url,
                uploader: 'N/A',
                volume: 100,
                vibration: 'N/A',
                source_profile: '未知来源 (仅缓存)',
                cachedSize: cachedItem.cachedSize
            });
        }
    }
    
    toastr.success(`已加载 ${mergedAudioList.length} 个已缓存的音频。`);
    currentDisplayList = mergedAudioList;
    await applyAudioListFilter();
}

async function onDeleteAllCacheClick() {
    if (cacheAllRunState.isRunning) {
        toastr.info("批量缓存进行中，请先停止或等待完成。", "缓存管理");
        return;
    }
    if (!confirm("确定要删除所有音频缓存吗？此操作不可逆。")) {
        return;
    }
    try {
        const db = await initDB();
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        await new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
        memoryCache.clear();
        toastr.success("所有音频缓存已删除。");
        await onReloadAudioListClick({ isManual: true });
    } catch (error) {
        console.error("删除缓存失败:", error);
        toastr.error("删除缓存失败。");
    }
}

async function onCacheSingleClick(event) {
    if (cacheAllRunState.isRunning) {
        toastr.info("批量缓存进行中，请先停止或等待完成。", "缓存管理");
        return;
    }
    const button = $(event.currentTarget);
    const item = button.closest('.audio-item');
    const audioData = item.data('audio');
    if (!audioData) return;

    try {
        button.html('<i class="fa-solid fa-spinner fa-spin"></i>').prop('disabled', true);
        const persisted = await loadAudio(audioData.url, audioData.key, audioData.uploader, audioData.volume, audioData.vibration, { forceRefresh: true, persistOnly: true });
        if (!persisted) {
            throw new Error('写入缓存失败');
        }
        toastr.success(`已缓存: ${audioData.key}`);

        const db = await initDB();
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const cachedItem = await new Promise((resolve, reject) => {
            const request = store.get(audioData.url);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        if (item.length && cachedItem) {
            item.removeClass('status-uncached').addClass('status-cached');
            if (cachedItem.arrayBuffer) {
                item.find('.audio-size').text(formatBytes(cachedItem.arrayBuffer.byteLength));
            }
            const newButton = $(`<button class="action-button danger clear-single-button" title="清除" data-url="${audioData.url}"><i class="fa-solid fa-trash"></i></button>`);
            button.replaceWith(newButton);
        } else {
            toastr.error(`缓存失败 ${audioData.key}: 验证失败。`);
            button.html('<i class="fa-solid fa-download"></i>').prop('disabled', false);
        }
    } catch (error) {
        console.error(`缓存失败 ${audioData.url}:`, error);
        toastr.error(`缓存失败 ${audioData.key}: ${error.message}。请检查网络或URL是否正确。`);
        button.html('<i class="fa-solid fa-download"></i>').prop('disabled', false);
    }
}

async function onClearSingleClick(event) {
    if (cacheAllRunState.isRunning) {
        toastr.info("批量缓存进行中，请先停止或等待完成。", "缓存管理");
        return;
    }
    const button = $(event.currentTarget);
    const item = button.closest('.audio-item');
    const audioData = item.data('audio');
    if (!audioData) return;

    try {
        button.prop('disabled', true);
        const db = await initDB();
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        await new Promise((resolve, reject) => {
            const request = store.delete(audioData.url);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
        memoryCache.delete(audioData.url);
        toastr.success(`已清除缓存`);

        if (item.length) {
            item.find('.audio-size').text('未知');
            item.removeClass('status-cached').addClass('status-uncached');
            
            const audio = item.data('audio');
            const newButton = $(`<button class="action-button cache-single-button" title="缓存" data-url="${audio.url}" data-name="${audio.key || audio.name}" data-uploader="${audio.uploader || 'N/A'}" data-volume="${audio.volume}" data-vibration="${audio.vibration}"><i class="fa-solid fa-download"></i></button>`);
            button.replaceWith(newButton);
        }
    } catch (error) {
        console.error(`清除缓存失败 ${audioData.url}:`, error);
        toastr.error(`清除缓存失败: ${error.message}`);
        button.prop('disabled', false);
    }
}

async function onAnalyzeAudioClick(event) {
    const button = $(event.currentTarget);
    const item = button.closest('.audio-item');
    const audioData = item.data('audio');
    if (!audioData) return;

    const resultSpan = item.find('.analysis-result-span');
    resultSpan.show().text(' 分析中...');
    button.prop('disabled', true);

    try {
        let arrayBuffer;
        if (audioData.cachedSize > 0) {
            const db = await initDB();
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const cachedItem = await new Promise((resolve, reject) => {
                const request = store.get(audioData.url);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            if (cachedItem && cachedItem.arrayBuffer) {
                arrayBuffer = cachedItem.arrayBuffer.slice(0);
            }
        }
        
        if (!arrayBuffer) {
            const response = await fetch(audioData.url);
            arrayBuffer = await response.arrayBuffer();
        }

        const decodeCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
        const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);

        const analyzeCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, audioBuffer.length, audioBuffer.sampleRate);
        const source = analyzeCtx.createBufferSource();
        source.buffer = audioBuffer;

        const analyser = analyzeCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(analyzeCtx.destination);
        source.start(0);

        const duration = audioBuffer.duration;
        const step = 0.05; // 50ms per step
        const steps = Math.floor(duration / step);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const settings = extension_settings[extensionName] || {};
        const lowBandPct = Number.isFinite(settings.autoVibrationLowBandPct) ? settings.autoVibrationLowBandPct : 25;
        const highBandPct = Number.isFinite(settings.autoVibrationHighBandPct) ? settings.autoVibrationHighBandPct : 25;

        const lowEnd = Math.max(1, Math.min(bufferLength, Math.floor(bufferLength * (lowBandPct / 100))));
        const highStart = Math.max(0, Math.min(bufferLength - 1, Math.floor(bufferLength * (1 - highBandPct / 100))));

        let globalMaxLow = 0;
        let globalMaxHigh = 0;
        let sumLow = 0;
        let sumHigh = 0;
        let count = 0;

        for (let i = 1; i <= steps; i++) {
            const time = i * step;
            analyzeCtx.suspend(time).then(() => {
                analyser.getByteFrequencyData(dataArray);
                let maxLow = 0;
                for (let j = 0; j < lowEnd; j++) {
                    if (dataArray[j] > maxLow) maxLow = dataArray[j];
                }
                let maxHigh = 0;
                for (let j = highStart; j < bufferLength; j++) {
                    if (dataArray[j] > maxHigh) maxHigh = dataArray[j];
                }
                if (maxLow > globalMaxLow) globalMaxLow = maxLow;
                if (maxHigh > globalMaxHigh) globalMaxHigh = maxHigh;
                sumLow += maxLow;
                sumHigh += maxHigh;
                count++;
                analyzeCtx.resume();
            });
        }

        await analyzeCtx.startRendering();

        const avgLow = count > 0 ? Math.round(sumLow / count) : 0;
        const avgHigh = count > 0 ? Math.round(sumHigh / count) : 0;

        resultSpan.text(` | 均响(低/高): ${avgLow}/${avgHigh} | 峰值(低/高): ${globalMaxLow}/${globalMaxHigh}`);
    } catch (error) {
        console.error("Analysis error:", error);
        resultSpan.text(' | 分析失败');
    } finally {
        button.prop('disabled', false);
    }
}

function onPlayPreviewClick(event) {
    const button = $(event.currentTarget);
    const url = button.data('url');
    const volume = button.data('volume');
    const name = button.data('name');
    const uploader = button.data('uploader');
    const vibration = button.attr('vibration');
    const previewId = `preview_${url}`;

    // The external player now handles stopping other previews.
    const playDetail = {
        id: previewId,
        url: url,
        volume: volume,
        name: name,
        uploader: uploader,
        vibration: vibration,
        is_preview: true
    };

    eventSource.emit(eventNames.PLAY_EXTERNAL_SOUND, playDetail);

    setPreviewButtonState(url, false);
}

function onStopPreviewClick(event) {
    const button = $(event.currentTarget);
    const url = button.data('url');
    const previewId = `preview_${url}`;

    eventSource.emit(eventNames.STOP_EXTERNAL_SOUND, { id: previewId });
    // UI update will be handled by handleExternalSoundStopped
}

function handleExternalSoundStopped(data) {
    if (!data) return;
    const { id, url } = data;
    const resolvedUrl = url || getPreviewUrlById(id);

    if (id && id.startsWith('preview_') && resolvedUrl) {
        const index = currentlyPlayingPreviews.findIndex(item => item.url === resolvedUrl);
        if (index > -1) {
            currentlyPlayingPreviews.splice(index, 1);
        }

        setPreviewButtonState(resolvedUrl, false);
    }
}

export function initAudioManagement() {
    // Rename the button and change its functionality
    const loadButton = $("#ac-load-world-audio-button");
    loadButton.html('<i class="fa-solid fa-book"></i> 从预设加载音频');
    loadButton.off("click").on("click", onLoadProfilesAudioClick);

    // Hide world book related UI elements that are no longer needed
    $('#st-is-world-book-selector').hide();
    $('#ac-new-audio-button').hide();
    $('#st-is-world-book-warning').hide();

    // Populate preset dropdown and refresh it whenever the user opens it
    populatePresetSelect();
    $('#ac-preset-select').on('mousedown focus', populatePresetSelect);

    // 填充"音效设定预设条目筛选"下拉，并在打开/切换时联动
    populateEntryFilterSelect();
    $('#ac-entry-select').on('mousedown focus', populateEntryFilterSelect);
    $('#ac-entry-select').on('change', applyAudioListFilter);

    $("#ac-cache-all-world-audio-button").on("click", onCacheAllWorldAudioClick);
    $("#ac-stop-cache-all-button").on("click", onStopCacheAllClick);
    $("#ac-reload-audio-list-button").on("click", () => onReloadAudioListClick({ isManual: true }));
    $("#ac-delete-all-cache-button").on("click", onDeleteAllCacheClick);
    $('#ac-search-input').on('input', applyAudioListFilter);
    $('#ac-category-select').on('change', applyAudioListFilter);
    $('#ac-audio-list-container').on('click', '.cache-single-button', onCacheSingleClick);
    $('#ac-audio-list-container').on('click', '.clear-single-button', onClearSingleClick);
    $('#ac-audio-list-container').on('click', '.play-preview-button', onPlayPreviewClick);
    $('#ac-audio-list-container').on('click', '.stop-preview-button', onStopPreviewClick);
    $('#ac-audio-list-container').on('click', '.analyze-audio-button', onAnalyzeAudioClick);
    $('#ac-audio-list-container').on('click', '.add-to-preset-button', onAddToPresetClick);
    $('#ac-audio-list-container').on('click', '.remove-from-entry-button', onRemoveFromEntryClick);
    $('#ac-audio-list-container').on('click', '.editable', onEditableClick);

    eventSource.on(eventNames.EXTERNAL_SOUND_PLAYING, handleExternalSoundPlaying);
    eventSource.on(eventNames.EXTERNAL_SOUND_STOPPED, handleExternalSoundStopped);
    eventSource.on(eventNames.EXTERNAL_SOUND_FAILED, handleExternalSoundStopped);
}

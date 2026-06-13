// @ts-nocheck
import { extension_settings } from '../../../../extensions.js';
import { loadAudio } from './audio-cache.js';
import { effectsProcessor } from './effects-processor.js';
import { extensionName } from './config.js';
import { getRecentSfxCache, RecentSfxCacheEmitter, getRecentSfxItem, updateRecentSfxItemData } from './recent-sfx-cache.js';
import { formatTimestamp } from './ui_common.js';

let container;
let searchInput;
let categorySelect;
let refreshButton;
let controlsBound = false;
let currentlyPlayingAudio = null;
let currentlyPlayingCacheKey = null;
let activeEffectPreviews = new Map();

function escapeHtml(value) {
    return $('<div>').text(value == null ? '' : String(value)).html();
}

function getTypeLabel(type) {
    switch (type) {
        case 'Music': return '音乐';
        case 'Ambiance': return '环境音';
        case 'SFX': return '音效';
        case 'SFX_WAIT': return '等待音效';
        default: return type || '未知';
    }
}

function getTypeIcon(type) {
    switch (type) {
        case 'Music': return '<i class="fa-solid fa-music" style="color: var(--st-is-accent-primary);"></i>';
        case 'Ambiance': return '<i class="fa-solid fa-cloud" style="color: var(--st-is-accent-primary);"></i>';
        case 'SFX': return '<i class="fa-solid fa-bolt" style="color: var(--st-is-accent-primary);"></i>';
        case 'SFX_WAIT': return '<i class="fa-solid fa-hourglass-half" style="color: var(--st-is-accent-primary);"></i>';
        default: return '<i class="fa-solid fa-wave-square" style="color: var(--st-is-text-secondary);"></i>';
    }
}

function getEffectsProfileOptions(profileType, selectedValue) {
    const profiles = extension_settings[extensionName]?.effectsProcessor?.[profileType] || {};
    const options = ['<option value="">(沿用当前/默认)</option>'];
    Object.keys(profiles).forEach(name => {
        const selected = name === selectedValue ? ' selected' : '';
        options.push(`<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`);
    });
    return options.join('');
}

async function ensureDecodedBuffer(item, cacheKey) {
    if (item?.decodedBuffer?.duration) {
        return item;
    }

    if (!item?.url) {
        return item;
    }

    const decodedBuffer = await loadAudio(item.url, item.src, item.uploader, item.volume, item.vibration);
    if (decodedBuffer) {
        return updateRecentSfxItemData(cacheKey, { decodedBuffer }) || item;
    }

    return item;
}

function stopOriginalPreviewPlayback() {
    if (!currentlyPlayingAudio) return;
    currentlyPlayingAudio.pause();
    currentlyPlayingAudio.currentTime = 0;
    currentlyPlayingAudio = null;
    currentlyPlayingCacheKey = null;
    document.querySelectorAll('.sfx-play-btn i').forEach(icon => {
        icon.className = 'fa-solid fa-play';
    });
}

async function stopEffectPreviewPlayback() {
    if (activeEffectPreviews.size === 0) return;
    for (const [cacheKey, preview] of activeEffectPreviews.entries()) {
        await preview.processor.stopPlayback();
        const button = document.querySelector(`.sfx-effects-preview-btn[data-cache-key="${cacheKey}"]`);
        if (button) {
            button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 预览特效';
        }
    }
    activeEffectPreviews.clear();
}

async function onPlayPreviewClick(event) {
    const button = event.currentTarget;
    const { cacheKey, audioUrl } = button.dataset;

    if (currentlyPlayingAudio) {
        const wasSameKey = currentlyPlayingCacheKey === cacheKey;
        stopOriginalPreviewPlayback();
        if (wasSameKey && !activeEffectPreviews.has(cacheKey)) {
            return;
        }
    }

    await stopEffectPreviewPlayback();

    if (!audioUrl) {
        toastr.error('当前记录没有可播放的音频地址。');
        return;
    }

    currentlyPlayingAudio = new Audio(audioUrl);
    currentlyPlayingCacheKey = cacheKey;
    currentlyPlayingAudio.play().catch(err => {
        toastr.error('音频播放失败: ' + err.message);
        currentlyPlayingAudio = null;
        currentlyPlayingCacheKey = null;
        button.querySelector('i').className = 'fa-solid fa-play';
    });

    button.querySelector('i').className = 'fa-solid fa-stop';
    currentlyPlayingAudio.onended = () => {
        button.querySelector('i').className = 'fa-solid fa-play';
        currentlyPlayingAudio = null;
        currentlyPlayingCacheKey = null;
    };
}

async function onPreviewEffectsClick(event) {
    const button = event.currentTarget;
    const { cacheKey } = button.dataset;
    let item = getRecentSfxItem(cacheKey);

    if (item) {
        item = await ensureDecodedBuffer(item, cacheKey);
    }

    if (!item?.decodedBuffer) {
        toastr.error('没有可供预览的音频数据。');
        return;
    }

    if (activeEffectPreviews.has(cacheKey)) {
        const preview = activeEffectPreviews.get(cacheKey);
        await preview.processor.stopPlayback();
        activeEffectPreviews.delete(cacheKey);
        button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 预览特效';
        return;
    }

    stopOriginalPreviewPlayback();
    await stopEffectPreviewPlayback();

    const detailsContent = button.closest('.st-is-tts-details-content');
    const specialEffectsProfileName = detailsContent.querySelector('.sfx-effects-select').value;
    const irProfileName = detailsContent.querySelector('.sfx-ir-select').value;
    const spatialProfileName = detailsContent.querySelector('.sfx-spatial-select').value;

    const fxProfile = extension_settings[extensionName].effectsProcessor.effectsProfiles[specialEffectsProfileName] || null;
    const irProfile = extension_settings[extensionName].effectsProcessor.irProfiles[irProfileName] || null;
    const spatialProfile = extension_settings[extensionName].effectsProcessor.spatialProfiles[spatialProfileName] || null;

    // 尊重全局 effectsEnabled 总开关：任一关闭时，预览也不应应用对应模块
    const effectsEnabled = extension_settings[extensionName].effectsProcessor?.effectsEnabled || {};
    const fxSettings = (fxProfile && effectsEnabled.effects !== false) ? { ...fxProfile, enabled: true } : { enabled: false };
    const irSettings = (irProfile && effectsEnabled.ir !== false) ? { ...irProfile, enabled: true } : { enabled: false };
    const spatialSettings = (spatialProfile && effectsEnabled.spatial !== false)
        ? { ...spatialProfile, enabled: true }
        : { enabled: false, points: [], params: {} };

    const processor = new effectsProcessor.constructor();
    processor.audioBuffer = item.decodedBuffer;
    if (spatialSettings.points) {
        processor.pathPoints = JSON.parse(JSON.stringify(spatialSettings.points));
    }

    const chain = await processor.buildProcessingChain({
        compressor: { enabled: false },
        effects: fxSettings,
        ir: irSettings,
        spatial: spatialSettings
    }, { irProfileName });

    button.innerHTML = '<i class="fa-solid fa-stop"></i> 停止预览';
    activeEffectPreviews.set(cacheKey, { processor });

    await processor.playWithChain(chain, null);
    if (processor.currentPlayer) {
        const originalOnStop = processor.currentPlayer.onstop;
        processor.currentPlayer.onstop = () => {
            if (typeof originalOnStop === 'function') {
                originalOnStop();
            }
            if (activeEffectPreviews.has(cacheKey)) {
                activeEffectPreviews.delete(cacheKey);
                button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 预览特效';
            }
        };
    }
}

function onDetailInputChange(event) {
    const inputElement = event.currentTarget;
    const detailsContent = inputElement.closest('.st-is-tts-details-content');
    if (!detailsContent) return;

    const cacheKey = detailsContent.dataset.cacheKey;
    if (!cacheKey) return;

    const item = getRecentSfxItem(cacheKey);
    if (!item) return;

    const updatedData = {};
    if (inputElement.classList.contains('sfx-volume-input')) {
        const value = Number(inputElement.value);
        if (!Number.isNaN(value)) updatedData.volume = value;
    } else if (inputElement.classList.contains('sfx-effects-select')) {
        updatedData.special_effects = inputElement.value;
    } else if (inputElement.classList.contains('sfx-ir-select')) {
        updatedData.ir_description = inputElement.value;
    } else if (inputElement.classList.contains('sfx-spatial-select')) {
        updatedData.spatial = inputElement.value;
    }

    if (Object.keys(updatedData).length > 0) {
        updateRecentSfxItemData(cacheKey, updatedData);
        toastr.success('已覆盖当前音效记录。');
    }
}

function onToggleDetailsClick(event) {
    const button = event.currentTarget;
    const card = button.closest('.st-is-tts-card');
    const detailsContent = card.querySelector('.st-is-tts-details-content');
    const icon = button.querySelector('i');

    if (detailsContent.style.display === 'none') {
        detailsContent.style.display = 'block';
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
        card.classList.add('is-expanded');
    } else {
        detailsContent.style.display = 'none';
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
        card.classList.remove('is-expanded');
    }
}

function getFilteredItems() {
    const searchTerm = String(searchInput?.value || '').trim().toLowerCase();
    const categoryValue = categorySelect?.value || '__all__';
    const items = Array.from(getRecentSfxCache().values())
        .filter(item => item && item.type && item.type !== 'VOICE')
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return items.filter(item => {
        if (categoryValue !== '__all__' && item.type !== categoryValue) return false;
        if (!searchTerm) return true;
        return [item.src, item.url, item.type, item.context, item.special_effects, item.ir_description, item.spatial]
            .join(' ')
            .toLowerCase()
            .includes(searchTerm);
    });
}

function renderSfxList() {
    if (!container) return;

    const items = getFilteredItems();
    if (items.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--st-is-text-secondary);">暂无最近使用的音效记录。</p>';
        return;
    }

    const cardsHtml = items.map(item => {
        const effectsOptions = getEffectsProfileOptions('effectsProfiles', item.special_effects);
        const irOptions = getEffectsProfileOptions('irProfiles', item.ir_description);
        const spatialOptions = getEffectsProfileOptions('spatialProfiles', item.spatial);
        const contextValue = item.context || (item.loop ? `${item.regex_start ?? 'N/A'} ~ ${item.regex_end ?? 'N/A'}` : (item.regex ?? 'N/A'));
        return `
        <div class="st-is-tts-card" data-cache-key="${escapeHtml(item.cacheKey)}">
            <div class="st-is-tts-card-header">
                <div class="st-is-tts-card-status" title="${escapeHtml(getTypeLabel(item.type))}">${getTypeIcon(item.type)}</div>
                <div class="st-is-tts-card-info">
                    <div class="st-is-tts-card-text" title="${escapeHtml(item.src)}">${escapeHtml(item.src)}</div>
                    <div class="st-is-tts-card-sub-info">
                        <span><i class="fa-solid fa-tag"></i> ${escapeHtml(getTypeLabel(item.type))}</span>
                        <span><i class="fa-solid fa-volume-high"></i> ${escapeHtml(item.volume ?? 100)}</span>
                        <span><i class="fa-solid fa-clock"></i> ${escapeHtml(formatTimestamp(item.timestamp))}</span>
                    </div>
                </div>
                <div class="st-is-tts-card-actions">
                    <button class="st-is-icon-btn sfx-play-btn"
                            data-cache-key="${escapeHtml(item.cacheKey)}"
                            data-audio-url="${escapeHtml(item.url || '')}"
                            title="播放原始音频"
                            ${item.url ? '' : 'disabled'}>
                        <i class="fa-solid fa-play"></i>
                    </button>
                    <button class="st-is-icon-btn sfx-details-toggle" title="展开/折叠高级设置">
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                </div>
            </div>
            <div class="st-is-tts-details-content" style="display: none;" data-cache-key="${escapeHtml(item.cacheKey)}">
                <div class="st-is-tts-details-grid">
                    <div class="st-is-form-group">
                        <label>类型</label>
                        <input class="st-is-text-input" type="text" value="${escapeHtml(getTypeLabel(item.type))}" readonly>
                    </div>
                    <div class="st-is-form-group">
                        <label>音量</label>
                        <input class="st-is-text-input sfx-volume-input" type="number" min="0" step="1" value="${escapeHtml(item.volume ?? 100)}">
                    </div>
                    <div class="st-is-form-group st-is-form-group-full-width">
                        <label>触发信息</label>
                        <textarea class="st-is-textarea" rows="2" readonly>${escapeHtml(contextValue)}</textarea>
                    </div>
                    <div class="st-is-form-group st-is-form-group-full-width">
                        <label>URL</label>
                        <input class="st-is-text-input" type="text" value="${escapeHtml(item.url || '')}" readonly>
                    </div>
                    <div class="st-is-form-group">
                        <label>声音特效 (Effects)</label>
                        <select class="st-is-select sfx-effects-select">${effectsOptions}</select>
                    </div>
                    <div class="st-is-form-group">
                        <label>环境混响 (IR)</label>
                        <select class="st-is-select sfx-ir-select">${irOptions}</select>
                    </div>
                    <div class="st-is-form-group">
                        <label>空间音频 (Spatial)</label>
                        <select class="st-is-select sfx-spatial-select">${spatialOptions}</select>
                    </div>
                </div>
                <div class="st-is-tts-details-actions">
                    <button class="st-is-btn sfx-effects-preview-btn" data-cache-key="${escapeHtml(item.cacheKey)}" ${item.url ? '' : 'disabled'}><i class="fa-solid fa-wand-magic-sparkles"></i> 预览特效</button>
                </div>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = `<div class="st-is-tts-card-list">${cardsHtml}</div>`;
    container.querySelectorAll('.sfx-play-btn').forEach(button => button.addEventListener('click', onPlayPreviewClick));
    container.querySelectorAll('.sfx-details-toggle').forEach(button => button.addEventListener('click', onToggleDetailsClick));
    container.querySelectorAll('.sfx-effects-preview-btn').forEach(button => button.addEventListener('click', onPreviewEffectsClick));
    container.querySelectorAll('.sfx-volume-input, .sfx-effects-select, .sfx-ir-select, .sfx-spatial-select').forEach(el => {
        el.addEventListener('change', onDetailInputChange);
    });
}

function bindControls() {
    if (controlsBound) return;
    controlsBound = true;

    searchInput?.addEventListener('input', renderSfxList);
    categorySelect?.addEventListener('change', renderSfxList);
    refreshButton?.addEventListener('click', renderSfxList);

    const tabLink = document.querySelector('.st-is-nav-link[data-tab="sfx-preview"]');
    tabLink?.addEventListener('click', renderSfxList);

    RecentSfxCacheEmitter.addEventListener('update', renderSfxList);
}

export async function stopAllSfxPreview() {
    stopOriginalPreviewPlayback();
    await stopEffectPreviewPlayback();
}

export function initSfxPreview() {
    container = document.getElementById('st-is-sfx-preview-list-container');
    searchInput = document.getElementById('st-is-sfx-preview-search');
    categorySelect = document.getElementById('st-is-sfx-preview-category');
    refreshButton = document.getElementById('st-is-sfx-preview-refresh');

    if (!container || !searchInput || !categorySelect || !refreshButton) {
        console.error('SFX Preview UI elements not found!');
        return;
    }

    bindControls();
    renderSfxList();
}

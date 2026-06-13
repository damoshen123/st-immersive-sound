// @ts-nocheck
import { getTtsCache, TtsCacheEmitter, initiateTtsRequest, getTtsItem, addOrUpdateTtsItem, updateTtsItemData, getSpeakers } from './tts-cache.js';
import { listAllSpeakers as listMinimaxSpeakers, findVoiceByName as findMinimaxVoiceByName } from './minimax-voices.js';
import { listEdgeSpeakers, findEdgeVoiceByName } from './edge-tts.js';
import { listAllSpeakers as listNimoSpeakers, findVoiceByName as findNimoVoiceByName } from './nimo-voices.js';
import { initiateMinimaxRequest } from './minimax-dispatch.js';
import { initiateEdgeRequest } from './edge-dispatch.js';
import { initiateNimoRequest } from './nimo-dispatch.js';
import { formatTimestamp, formatSize } from './ui_common.js';
import { eventSource } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { extensionName, eventNames } from "./config.js";
import { effectsProcessor } from './effects-processor.js';
import { getMainSfxConfigState, MainSfxConfigEmitter, setMainSfxConfigState } from './main-sfx-config-state.js';

let container;
let filterContainer;
let mainSfxConfigTextarea;
let mainSfxReparseButton;
let mainSfxConfigStatus;
let mainSfxIssuesPanel;
let mainSfxIssuesList;
let currentlyPlayingAudio = null;
let activeEffectPreviews = new Map(); // cacheKey -> { processor, settings }
let currentPreviewFilter = 'all';

function generateRequestId() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getIssueSearchCandidates(issue = {}) {
    return [
        issue.anchorText,
        issue.regex,
        issue.regex_start,
        issue.regex_end,
        issue.src,
        issue.speaker,
        issue.context_texts,
    ].filter(value => typeof value === 'string' && value.trim().length > 0);
}

function locateIssueInConfig(text, issue = {}) {
    const sourceText = String(text || '');
    if (!sourceText) {
        return { start: 0, end: 0, line: null, matchedText: '' };
    }

    const candidates = getIssueSearchCandidates(issue);
    let bestIndex = -1;
    let matchedText = '';

    // 从后往前搜索：正文音效配置文本通常会把 AI 对该段文本的"思考/分析"放在前面，
    // 真正的配置项位于尾部。使用 lastIndexOf 可以避免命中前置的分析文本。
    for (const candidate of candidates) {
        const index = sourceText.lastIndexOf(candidate);
        if (index >= 0) {
            bestIndex = index;
            matchedText = candidate;
            break;
        }
    }

    if (bestIndex < 0) {
        const fallback = `${issue.category || ''}${issue.code || ''}`;
        return { start: 0, end: Math.min(sourceText.length, fallback.length || 1), line: 1, matchedText: '' };
    }

    const line = sourceText.slice(0, bestIndex).split('\n').length;
    return {
        start: bestIndex,
        end: bestIndex + Math.max(1, matchedText.length),
        line,
        matchedText,
    };
}

function focusMainSfxIssue(issueIndex) {
    if (!mainSfxConfigTextarea) {
        return;
    }

    const state = getMainSfxConfigState();
    const currentText = typeof state.editedConfigText === 'string' && state.editedConfigText.length > 0
        ? state.editedConfigText
        : (state.rawConfigText || '');
    const issue = Array.isArray(state.parseIssues) ? state.parseIssues[issueIndex] : null;
    if (!issue) {
        return;
    }

    const location = locateIssueInConfig(currentText, issue);
    mainSfxConfigTextarea.focus();
    mainSfxConfigTextarea.setSelectionRange(location.start, location.end);
    const lineHeight = parseFloat(window.getComputedStyle(mainSfxConfigTextarea).lineHeight) || 20;
    const targetLine = Math.max(0, (location.line || 1) - 1);
    mainSfxConfigTextarea.scrollTop = Math.max(0, targetLine * lineHeight - lineHeight * 2);
}

function renderMainSfxIssues() {
    if (!mainSfxIssuesPanel || !mainSfxIssuesList) {
        return;
    }

    const state = getMainSfxConfigState();
    const issues = Array.isArray(state.parseIssues) ? state.parseIssues : [];
    const currentText = typeof state.editedConfigText === 'string' && state.editedConfigText.length > 0
        ? state.editedConfigText
        : (state.rawConfigText || '');

    if (issues.length === 0) {
        mainSfxIssuesPanel.style.display = 'none';
        mainSfxIssuesList.innerHTML = '';
        return;
    }

    const itemsHtml = issues.map((issue, index) => {
        const location = locateIssueInConfig(currentText, issue);
        const metaParts = [issue.category, issue.code, location.line ? `第 ${location.line} 行` : '未定位到行号'].filter(Boolean);
        const anchorText = issue.anchorText || issue.regex || issue.regex_start || issue.regex_end || issue.src || issue.speaker || '';
        return `
            <button class="st-is-main-sfx-issue-item" type="button" data-issue-index="${index}">
                <span class="st-is-main-sfx-issue-meta">${escapeHtml(metaParts.join(' · '))}</span>
                <span class="st-is-main-sfx-issue-message">${escapeHtml(issue.message || '未命中配置项')}</span>
                <span class="st-is-main-sfx-issue-anchor">${escapeHtml(anchorText)}</span>
            </button>
        `;
    }).join('');

    mainSfxIssuesPanel.style.display = 'block';
    mainSfxIssuesList.innerHTML = itemsHtml;
    mainSfxIssuesList.querySelectorAll('.st-is-main-sfx-issue-item').forEach(button => {
        button.addEventListener('click', () => {
            const issueIndex = Number(button.dataset.issueIndex);
            focusMainSfxIssue(issueIndex);
        });
    });
}

function renderMainSfxConfigPanel() {
    if (!mainSfxConfigTextarea || !mainSfxReparseButton || !mainSfxConfigStatus) {
        return;
    }

    const state = getMainSfxConfigState();
    const currentText = typeof state.editedConfigText === 'string' && state.editedConfigText.length > 0
        ? state.editedConfigText
        : (state.rawConfigText || '');

    if (mainSfxConfigTextarea.value !== currentText) {
        mainSfxConfigTextarea.value = currentText;
    }

    const hasText = currentText.trim().length > 0;
    mainSfxReparseButton.disabled = !hasText || state.isReparsing;
    mainSfxReparseButton.innerHTML = state.isReparsing
        ? '<i class="fa-solid fa-spinner fa-spin"></i> 重新解析中...'
        : '<i class="fa-solid fa-arrows-rotate"></i> 重新解析';

    if (state.isReparsing) {
        mainSfxConfigStatus.textContent = '正在重新解析正文音效配置...';
        return;
    }

    if (state.lastError) {
        mainSfxConfigStatus.textContent = `重新解析失败：${state.lastError}`;
        return;
    }

    if (hasText && state.updatedAt) {
        mainSfxConfigStatus.textContent = `最近更新：${formatTimestamp(state.updatedAt)}`;
        return;
    }

    mainSfxConfigStatus.textContent = '这里会显示最近一次正文音效生成的配置文本。';
}

function onMainSfxConfigInput() {
    setMainSfxConfigState({
        editedConfigText: mainSfxConfigTextarea?.value || '',
        lastError: '',
    });
}

async function onMainSfxReparseClick() {
    const state = getMainSfxConfigState();
    const text = typeof state.editedConfigText === 'string' && state.editedConfigText.trim().length > 0
        ? state.editedConfigText
        : state.rawConfigText;

    if (!text || text.trim().length === 0) {
        toastr.warning('没有可用于重新解析的正文音效配置文本。');
        return;
    }

    const requestId = generateRequestId();
    setMainSfxConfigState({ isReparsing: true, lastError: '' });

    try {
        await new Promise((resolve, reject) => {
            const handler = (data) => {
                if (!data || data.id !== requestId) {
                    return;
                }
                eventSource.removeListener(eventNames.MAIN_SFX_REPARSE_RESPONSE, handler);
                if (data.success) {
                    resolve(data);
                    return;
                }
                reject(new Error(data.error || '重新解析失败'));
            };

            eventSource.on(eventNames.MAIN_SFX_REPARSE_RESPONSE, handler);
            eventSource.emit(eventNames.MAIN_SFX_REPARSE_REQUEST, { id: requestId });
        });
        toastr.success('正文音效已重新解析。');
    } catch (error) {
        const errorMessage = error?.message || String(error);
        setMainSfxConfigState({ isReparsing: false, lastError: errorMessage });
        toastr.error(errorMessage);
    }
}

async function ensureAudioBuffer(item, cacheKey) {
    // Check if buffer is invalid (missing or detached)
    if (item && (!item.audioBuffer || item.audioBuffer.byteLength === 0)) {
        console.log(`[TTS Preview] audioBuffer for ${cacheKey} is missing or detached.`);
        
        // 1. Try to recover from audioBlob
        if (item.audioBlob && item.audioBlob.size > 0) {
            try {
                console.log(`[TTS Preview] Attempting to recover from blob...`);
                const audioBuffer = await item.audioBlob.arrayBuffer();
                if (audioBuffer && audioBuffer.byteLength > 0) {
                    console.log(`[TTS Preview] Successfully recovered from blob.`);
                    // Return the updated item directly
                    return addOrUpdateTtsItem(cacheKey, { audioBuffer });
                }
            } catch (e) {
                console.error(`[TTS Preview] Failed to recover from blob:`, e);
            }
        }

        // 2. Fallback: try to recover from audioUrl
        if (item.audioUrl) {
            try {
                console.log(`[TTS Preview] Blob recovery failed or blob missing. Attempting to recover from URL...`);
                const response = await fetch(item.audioUrl);
                const audioBuffer = await response.arrayBuffer();
                 if (audioBuffer && audioBuffer.byteLength > 0) {
                    // Also recreate the blob for future recoveries
                    const audioBlob = new Blob([audioBuffer], { type: "audio/mp3" });
                    console.log(`[TTS Preview] Successfully recovered from URL.`);
                    return addOrUpdateTtsItem(cacheKey, { audioBuffer, audioBlob });
                }
            } catch (e) {
                console.error(`[TTS Preview] Failed to recover from URL:`, e);
            }
        }
        
        // If all recovery fails, return the original (invalid) item
        console.warn(`[TTS Preview] All recovery methods failed for ${cacheKey}.`);
        return item;
    }
    // Buffer is already valid, return as is
    return item;
}

function getStatusIcon(status) {
    switch (status) {
        case 'success': return '<i class="fa-solid fa-check-circle" style="color: var(--st-is-accent-primary);"></i>';
        case 'pending': return '<i class="fa-solid fa-spinner fa-spin" style="color: var(--st-is-text-secondary);"></i>';
        case 'error': return '<i class="fa-solid fa-exclamation-circle" style="color: var(--st-is-danger-primary);"></i>';
        default: return '';
    }
}

function isNarrationItem(item) {
    return item?.isNarration === true || item?.metadata?.isNarration === true;
}

function getProviderForItem(item) {
    const settings = extension_settings[extensionName] || {};
    if (isNarrationItem(item)) {
        return item?.metadata?.engine || settings.narration_engine || 'edge';
    }
    return settings.voice_tts_provider || 'doubao';
}

function stripProviderPrefix(value, provider) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (provider === 'edge' && /^edge:/i.test(raw)) return raw.replace(/^edge:/i, '').trim();
    if (provider === 'nimo' && /^(?:mimo|nimo):/i.test(raw)) return raw.replace(/^(?:mimo|nimo):/i, '').trim();
    if (provider === 'minimax' && /^minimax:/i.test(raw)) return raw.replace(/^minimax:/i, '').trim();
    return raw;
}

function getSpeakerListForItem(item) {
    const provider = getProviderForItem(item);
    if (provider === 'minimax') return listMinimaxSpeakers();
    if (provider === 'edge') return listEdgeSpeakers();
    if (provider === 'nimo') return listNimoSpeakers();
    return getSpeakers();
}

function getSpeakerOptions(item) {
    const speakers = getSpeakerListForItem(item);
    const currentSpeakerName = item?.speaker_name || '';
    const hasCurrentSpeaker = currentSpeakerName && speakers.some(speaker => speaker.name === currentSpeakerName);
    const fullList = hasCurrentSpeaker || !currentSpeakerName
        ? speakers
        : [{ name: currentSpeakerName }, ...speakers];
    return fullList.map(speaker => `<option value="${speaker.name}">${speaker.name}</option>`).join('');
}

function resolveEdgeVoiceId(speakerName, item, isNarration = false) {
    const settings = extension_settings[extensionName] || {};
    const metadata = item?.metadata || {};
    const candidates = [
        stripProviderPrefix(speakerName, 'edge'),
        stripProviderPrefix(metadata.voiceId, 'edge'),
        stripProviderPrefix(metadata.voice, 'edge'),
        stripProviderPrefix(item?.speaker, 'edge'),
        stripProviderPrefix(item?.speaker_name, 'edge'),
        isNarration ? settings?.edge_tts?.narrationVoice : settings?.edge_tts?.voice,
        settings?.edge_tts?.voice,
    ].filter(Boolean);

    for (const candidate of candidates) {
        const resolved = findEdgeVoiceByName(candidate);
        if (resolved?.id) return resolved.id;
        if (/^[a-z]{2,3}-/i.test(candidate)) return candidate;
    }
    return '';
}

function resolveMinimaxVoiceId(speakerName, item) {
    const settings = extension_settings[extensionName] || {};
    const metadata = item?.metadata || {};
    const candidates = [
        stripProviderPrefix(speakerName, 'minimax'),
        stripProviderPrefix(metadata.voiceId, 'minimax'),
        stripProviderPrefix(item?.speaker, 'minimax'),
        stripProviderPrefix(item?.speaker_name, 'minimax'),
        settings?.minimax?.currentVoiceId,
    ].filter(Boolean);

    for (const candidate of candidates) {
        const resolved = findMinimaxVoiceByName(candidate);
        if (resolved?.voice_id) return resolved.voice_id;
        if (candidate) return candidate;
    }
    return '';
}

function resolveNimoVoiceId(speakerName, item, isNarration = false) {
    const settings = extension_settings[extensionName] || {};
    const metadata = item?.metadata || {};
    const candidates = [
        stripProviderPrefix(speakerName, 'nimo'),
        stripProviderPrefix(metadata.voiceId, 'nimo'),
        stripProviderPrefix(metadata.voice, 'nimo'),
        stripProviderPrefix(item?.speaker_name, 'nimo'),
        stripProviderPrefix(item?.speaker, 'nimo'),
        isNarration ? settings?.nimo?.narrationVoiceId : settings?.nimo?.currentVoiceId,
        settings?.nimo?.currentVoiceId,
    ].filter(Boolean);

    for (const candidate of candidates) {
        const resolved = findNimoVoiceByName(candidate);
        if (resolved?.id) return resolved.id;
        if (candidate) return candidate;
    }
    return '';
}

async function routeRegenerateRequest(item, requestData, speakerName) {
    const provider = getProviderForItem(item);
    const narration = isNarrationItem(item);

    if (provider === 'edge') {
        const voiceId = resolveEdgeVoiceId(speakerName, item, narration);
        if (!voiceId) {
            throw new Error(narration ? '旁白 Edge 音色未配置。' : `Edge 未匹配到音色 "${speakerName}"`);
        }
        addOrUpdateTtsItem(requestData.cacheKey, { status: 'pending' });
        return await initiateEdgeRequest({
            ...requestData,
            speaker: speakerName,
            voiceId,
            metadata: {
                ...requestData.metadata,
                engine: provider,
                voiceId,
                isNarration: narration,
            },
        });
    }

    if (provider === 'minimax') {
        const voiceId = resolveMinimaxVoiceId(speakerName, item);
        if (!voiceId) {
            throw new Error(`MiniMax 未匹配到音色 "${speakerName}"`);
        }
        addOrUpdateTtsItem(requestData.cacheKey, { status: 'pending' });
        return await initiateMinimaxRequest({
            ...requestData,
            speaker: speakerName,
            voiceId,
            metadata: {
                ...requestData.metadata,
                voiceId,
            },
        });
    }

    if (provider === 'nimo') {
        const voiceId = resolveNimoVoiceId(speakerName, item, narration);
        if (!voiceId) {
            throw new Error(narration ? '旁白 MiMo 音色未配置。' : `MiMo 未匹配到音色 "${speakerName}"`);
        }
        addOrUpdateTtsItem(requestData.cacheKey, { status: 'pending' });
        return await initiateNimoRequest({
            ...requestData,
            speaker: speakerName,
            voiceId,
            metadata: {
                ...requestData.metadata,
                engine: provider,
                voiceId,
                isNarration: narration,
            },
        });
    }

    return await initiateTtsRequest(requestData, true);
}
 
function getEffectsProfileOptions(profileType) {
    const profiles = extension_settings[extensionName].effectsProcessor?.[profileType] || {};
    return Object.keys(profiles).map(name => `<option value="${name}">${name}</option>`).join('');
}

async function onPlayPreviewClick(event) {
    const button = event.currentTarget;
    const { cacheKey, audioUrl } = button.dataset;

    if (currentlyPlayingAudio) {
        currentlyPlayingAudio.pause();
        currentlyPlayingAudio.currentTime = 0;
        document.querySelectorAll('.tts-play-btn i').forEach(icon => icon.className = 'fa-solid fa-play');
        if (currentlyPlayingAudio.src === audioUrl && !activeEffectPreviews.has(cacheKey)) {
            currentlyPlayingAudio = null;
            return;
        }
    }

    if (activeEffectPreviews.size > 0) {
        for (const [, preview] of activeEffectPreviews.entries()) {
            await preview.processor.stopPlayback();
        }
        activeEffectPreviews.clear();
    }

    if (audioUrl) {
        currentlyPlayingAudio = new Audio(audioUrl);
        currentlyPlayingAudio.play().catch(err => {
            toastr.error('音频播放失败: ' + err.message);
            console.error('Audio playback error:', err);
            currentlyPlayingAudio = null;
        });
        button.querySelector('i').className = 'fa-solid fa-stop';

        currentlyPlayingAudio.onended = () => {
            button.querySelector('i').className = 'fa-solid fa-play';
            currentlyPlayingAudio = null;
        };
    }
}

export async function regenerateTtsAudioByCacheKey(cacheKey) {
    const item = getTtsItem(cacheKey);
    if (!item) {
        throw new Error('找不到缓存项。');
    }

    const speakerName = item.speaker_name || item.metadata?.speaker || item.speaker || '';
    const text = item.text || item.metadata?.text || '';
    const context_texts = item.context_texts || item.metadata?.context_texts || '';
    const irDescription = item.ir_description || '';
    const specialEffects = item.special_effects || '';
    const spatial = item.spatial || '';

    const requestData = {
        ...item.metadata,
        cacheKey: cacheKey,
        text,
        context_texts,
        speaker: speakerName,
        ir_description: irDescription,
        special_effects: specialEffects,
        spatial,
        metadata: {
            ...item.metadata,
            speaker: speakerName,
            text,
            context_texts,
        },
    };

    await routeRegenerateRequest(item, requestData, speakerName);
    updateTtsItemData(cacheKey, { audioDirty: false });
}

async function onRegenerateClick(event) {
    const button = event.currentTarget;
    const { cacheKey: oldCacheKey } = button.dataset;
    const item = getTtsItem(oldCacheKey);
    if (!item) {
        toastr.error('找不到缓存项。');
        return;
    }

    const detailsContent = button.closest('.st-is-tts-details-content');
    const text = detailsContent.querySelector('.tts-text-input').value;
    const context_texts = detailsContent.querySelector('.tts-context-input').value;
    const speakerName = detailsContent.querySelector('.tts-speaker-select').value;
    const specialEffects = detailsContent.querySelector('.tts-effects-select').value;
    const irDescription = detailsContent.querySelector('.tts-ir-select').value;
    const spatial = detailsContent.querySelector('.tts-spatial-select').value;

    const requestData = {
        ...item.metadata,
        cacheKey: oldCacheKey,
        text,
        context_texts,
        speaker: speakerName,
        ir_description: irDescription,
        special_effects: specialEffects,
        spatial,
        metadata: {
            ...item.metadata,
            speaker: speakerName,
            text,
            context_texts,
        },
    };

    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    button.disabled = true;

    try {
        await routeRegenerateRequest(item, requestData, speakerName);
        updateTtsItemData(oldCacheKey, { audioDirty: false });
        toastr.success('音频已重新生成！');
    } catch (error) {
        toastr.error(`重新生成失败: ${error.message}`);
    } finally {
        button.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
        button.disabled = false;
    }
}

async function onPreviewEffectsClick(event) {
    const button = event.currentTarget;
    const { cacheKey } = button.dataset;
    let item = getTtsItem(cacheKey);

    if (item) {
        item = await ensureAudioBuffer(item, cacheKey);
    }

    if (!item || !item.audioBuffer || item.audioBuffer.byteLength === 0) {
        toastr.error('没有可供预览的音频数据。');
        console.warn(`[TTS Preview] Effects preview failed for ${cacheKey} due to missing audio data.`, item);
        return;
    }

    if (activeEffectPreviews.has(cacheKey)) {
        const preview = activeEffectPreviews.get(cacheKey);
        await preview.processor.stopPlayback();
        activeEffectPreviews.delete(cacheKey);
        button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
        return;
    }

    if (currentlyPlayingAudio) {
        currentlyPlayingAudio.pause();
        currentlyPlayingAudio = null;
        document.querySelectorAll('.tts-play-btn i').forEach(icon => icon.className = 'fa-solid fa-play');
    }
    if (activeEffectPreviews.size > 0) {
        for (const [key, preview] of activeEffectPreviews.entries()) {
            await preview.processor.stopPlayback();
            const otherButton = document.querySelector(`.tts-effects-preview-btn[data-cache-key="${key}"]`);
            if (otherButton) otherButton.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
        }
        activeEffectPreviews.clear();
    }

    const detailsContent = button.closest('.st-is-tts-details-content');
    const specialEffectsProfileName = detailsContent.querySelector('.tts-effects-select').value;
    const irProfileName = detailsContent.querySelector('.tts-ir-select').value;
    const spatialProfileName = detailsContent.querySelector('.tts-spatial-select').value;

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

    const tempProcessor = new effectsProcessor.constructor();
    await tempProcessor.handleAudioFile(new File([item.audioBuffer.slice(0)], 'preview.mp3', { type: 'audio/mp3' }));

    if (irSettings.enabled && irSettings.fileName) {
        await tempProcessor.loadIr(irSettings.fileName);
    }

    const settings = {
        compressor: { enabled: false },
        effects: fxSettings,
        ir: irSettings,
        spatial: spatialSettings,
    };

    try {
        const chain = await tempProcessor.buildProcessingChain(settings, { irProfileName });
        activeEffectPreviews.set(cacheKey, { processor: tempProcessor, settings });
        button.innerHTML = '<i class="fa-solid fa-stop"></i>';
        await tempProcessor.playWithChain(chain);
        if (tempProcessor.currentPlayer) {
            const originalOnStop = tempProcessor.currentPlayer.onstop;
            tempProcessor.currentPlayer.onstop = () => {
                if (typeof originalOnStop === 'function') {
                    originalOnStop();
                }
                if (activeEffectPreviews.has(cacheKey)) {
                    activeEffectPreviews.delete(cacheKey);
                    button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
                }
            };
        }
    } catch (error) {
        console.error('Effects preview failed:', error);
        toastr.error(`特效预览失败: ${error.message}`);
        try { await tempProcessor.stopPlayback(); } catch (_) {}
        activeEffectPreviews.delete(cacheKey);
        button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
    }
}

function onDetailInputChange(event) {
    const inputElement = event.currentTarget;
    const detailsContent = inputElement.closest('.st-is-tts-details-content');
    if (!detailsContent) return;

    const regenerateBtn = detailsContent.querySelector('.tts-regenerate-btn');
    const cacheKey = regenerateBtn?.dataset.cacheKey;
    if (!cacheKey) return;

    const item = getTtsItem(cacheKey);
    if (!item) return;

    let updatedData = {};

    if (inputElement.classList.contains('tts-text-input')) {
        updatedData.text = inputElement.value;
        updatedData.audioDirty = true;
    } else if (inputElement.classList.contains('tts-context-input')) {
        updatedData.context_texts = inputElement.value;
        updatedData.audioDirty = true;
    } else if (inputElement.classList.contains('tts-speaker-select')) {
        const speakerName = inputElement.value;
        const narration = isNarrationItem(item);
        const provider = getProviderForItem(item);
        const nextMetadata = { ...(item.metadata || {}), speaker: speakerName, isNarration: narration };

        updatedData.speaker_name = speakerName;
        updatedData.audioDirty = true;

        if (provider === 'edge') {
            const voiceId = resolveEdgeVoiceId(speakerName, item, narration);
            updatedData.speaker = voiceId ? `edge:${voiceId}` : speakerName;
            if (voiceId) nextMetadata.voiceId = voiceId;
            nextMetadata.engine = 'edge';
        } else if (provider === 'minimax') {
            const voiceId = resolveMinimaxVoiceId(speakerName, item);
            updatedData.speaker = voiceId ? `minimax:${voiceId}` : speakerName;
            if (voiceId) nextMetadata.voiceId = voiceId;
        } else if (provider === 'nimo') {
            const voiceId = resolveNimoVoiceId(speakerName, item, narration);
            updatedData.speaker = voiceId ? `nimo:${voiceId}` : speakerName;
            if (voiceId) nextMetadata.voiceId = voiceId;
            nextMetadata.engine = 'nimo';
        } else {
            const speakerInfo = getSpeakers().find(s => s.name === speakerName);
            if (speakerInfo) {
                updatedData.speaker = speakerInfo.speaker_id;
            }
        }

        updatedData.metadata = nextMetadata;
    } else if (inputElement.classList.contains('tts-effects-select')) {
        updatedData.special_effects = inputElement.value;
    } else if (inputElement.classList.contains('tts-ir-select')) {
        updatedData.ir_description = inputElement.value;
    } else if (inputElement.classList.contains('tts-spatial-select')) {
        updatedData.spatial = inputElement.value;
    }

    if (Object.keys(updatedData).length > 0) {
        updateTtsItemData(cacheKey, updatedData);
        console.log(`[TTS Preview] Updated cache for ${cacheKey}:`, updatedData);
        toastr.success('设置已更新并保存到缓存。');
    }
}

async function onDownloadOriginalClick(event) {
    const button = event.currentTarget;
    const { cacheKey } = button.dataset;
    let item = getTtsItem(cacheKey);

    if (item) {
        item = await ensureAudioBuffer(item, cacheKey);
    }

    if (!item || !item.audioBlob || item.audioBlob.size === 0) {
        toastr.error('没有可供下载的原始音频数据。');
        return;
    }

    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    button.disabled = true;

    try {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(item.audioBlob);
        a.download = `${item.text.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}_${cacheKey}_original.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        toastr.success('已开始下载原始音频！');
    } catch (error) {
        console.error('Original audio download failed:', error);
        toastr.error(`下载失败: ${error.message}`);
    } finally {
        button.innerHTML = '<i class="fa-solid fa-file-audio"></i>';
        button.disabled = false;
    }
}

async function onDownloadClick(event) {
    const button = event.currentTarget;
    const { cacheKey } = button.dataset;
    let item = getTtsItem(cacheKey);

    if (item) {
        item = await ensureAudioBuffer(item, cacheKey);
    }

    if (!item || !item.audioBuffer || item.audioBuffer.byteLength === 0) {
        toastr.error('没有可供下载的音频。');
        return;
    }

    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    button.disabled = true;

    try {
        const detailsContent = button.closest('.st-is-tts-details-content');
        const specialEffectsProfileName = detailsContent.querySelector('.tts-effects-select').value;
        const irProfileName = detailsContent.querySelector('.tts-ir-select').value;
        const spatialProfileName = detailsContent.querySelector('.tts-spatial-select').value;

        const fxSettings = extension_settings[extensionName].effectsProcessor.effectsProfiles[specialEffectsProfileName] || {};
        const irSettings = extension_settings[extensionName].effectsProcessor.irProfiles[irProfileName] || {};
        const spatialSettings = extension_settings[extensionName].effectsProcessor.spatialProfiles[spatialProfileName] || {};

        const tempProcessor = new effectsProcessor.constructor();
        await tempProcessor.handleAudioFile(new File([item.audioBuffer.slice(0)], 'export.mp3', { type: 'audio/mp3' }));

        if (irSettings && irSettings.fileName) {
            await tempProcessor.loadIr(irSettings.fileName);
        }

        const settings = {
            compressor: { enabled: false },
            effects: { ...fxSettings, enabled: true },
            ir: { ...irSettings, enabled: true },
            spatial: { ...spatialSettings, enabled: true },
        };

        const wavBlob = await tempProcessor.exportAudio(settings, 'wav');

        const a = document.createElement('a');
        a.href = URL.createObjectURL(wavBlob);
        a.download = `${item.text.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}_${cacheKey}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        toastr.success('已开始下载处理后的音频！');
    } catch (error) {
        console.error('Download failed:', error);
        toastr.error(`下载失败: ${error.message}`);
    } finally {
        button.innerHTML = '<i class="fa-solid fa-download"></i>';
        button.disabled = false;
    }
}

function getTriggerOrder(item) {
    const metadata = item?.metadata || {};
    const candidates = [
        item?.regex_start,
        metadata?.regex_start,
        item?.regex,
        metadata?.regex,
    ];

    for (const value of candidates) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }

    return Number.MAX_SAFE_INTEGER;
}

function getTriggerInfo(item) {
    const metadata = item?.metadata || {};
    const start = item?.regex_start ?? metadata?.regex_start;
    const end = item?.regex_end ?? metadata?.regex_end;
    const regex = item?.regex ?? metadata?.regex;
    const triggerText = item?.trigger_text ?? metadata?.trigger_text ?? metadata?.match_text ?? metadata?.raw_match ?? metadata?.trigger ?? '';

    const parts = [];

    if (triggerText) {
        parts.push(`文本: ${triggerText}`);
    }

    if (typeof start === 'number' && typeof end === 'number') {
        parts.push(`区间: ${start} ~ ${end}`);
    } else if (typeof start === 'number') {
        parts.push(`起点: ${start}`);
    } else if (typeof regex === 'number') {
        parts.push(`位置: ${regex}`);
    }

    return parts.length > 0 ? parts.join(' | ') : 'N/A';
}

function getFilteredItems(sortedItems) {
    if (currentPreviewFilter === 'narration') {
        return sortedItems.filter(item => isNarrationItem(item));
    }
    if (currentPreviewFilter === 'normal') {
        return sortedItems.filter(item => !isNarrationItem(item));
    }
    return sortedItems;
}

function getEmptyStateText() {
    if (currentPreviewFilter === 'narration') {
        return '暂无旁白音频记录。';
    }
    if (currentPreviewFilter === 'normal') {
        return '暂无普通 TTS 音频记录。';
    }
    return '暂无 TTS 音频记录。';
}

function updateFilterButtons() {
    if (!filterContainer) return;
    filterContainer.querySelectorAll('.st-is-tts-preview-filter-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.filter === currentPreviewFilter);
    });
}

function onPreviewFilterClick(event) {
    const button = event.currentTarget;
    const nextFilter = button.dataset.filter || 'all';
    if (nextFilter === currentPreviewFilter) {
        return;
    }
    currentPreviewFilter = nextFilter;
    updateFilterButtons();
    renderTtsList();
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

function renderTtsList() {
    if (!container) return;

    const ttsCache = getTtsCache();
    const sortedItems = Array.from(ttsCache.values()).sort((a, b) => {
        const orderDiff = getTriggerOrder(a) - getTriggerOrder(b);
        if (orderDiff !== 0) return orderDiff;
        return (a.timestamp || 0) - (b.timestamp || 0);
    });

    const filteredItems = getFilteredItems(sortedItems);

    if (filteredItems.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--st-is-text-secondary);">${getEmptyStateText()}</p>`;
        return;
    }

    const effectsOptions = getEffectsProfileOptions('effectsProfiles');
    const irOptions = getEffectsProfileOptions('irProfiles');
    const spatialOptions = getEffectsProfileOptions('spatialProfiles');

    const cardsHtml = filteredItems.map(item => `
        <div class="st-is-tts-card" data-cache-key="${item.cacheKey}">
            <div class="st-is-tts-card-header">
                <div class="st-is-tts-card-status" title="${item.status || ''}">${getStatusIcon(item.status)}</div>
                <div class="st-is-tts-card-info">
                    <div class="st-is-tts-card-text" title="${item.text}">${item.text}</div>
                    <div class="st-is-tts-card-sub-info">
                        <span><i class="fa-solid fa-user"></i> ${item.speaker_name || 'N/A'}</span>
                        <span><i class="fa-solid fa-database"></i> ${item.audioBuffer ? formatSize(item.audioBuffer.byteLength) : 'N/A'}</span>
                        <span><i class="fa-solid fa-clock"></i> ${formatTimestamp(item.timestamp)}</span>
                    </div>
                </div>
                <div class="st-is-tts-card-actions">
                    <button class="st-is-icon-btn tts-play-btn"
                            data-cache-key="${item.cacheKey}"
                            data-audio-url="${item.audioUrl || ''}"
                            title="${item.status === 'success' ? '播放原始音频' : (item.error || '不可用')}"
                            ${item.status !== 'success' ? 'disabled' : ''}>
                        <i class="fa-solid fa-play"></i>
                    </button>
                    <button class="st-is-icon-btn tts-details-toggle"
                            data-cache-key="${item.cacheKey}"
                            title="展开/折叠高级设置">
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                </div>
            </div>
            <div class="st-is-tts-details-content" style="display: none;">
                <div class="st-is-tts-details-grid">
                    <div class="st-is-form-group st-is-form-group-full-width">
                        <label>文本 (Text)</label>
                        <textarea class="st-is-textarea tts-text-input" rows="2">${item.text}</textarea>
                    </div>
                    <div class="st-is-form-group st-is-form-group-full-width">
                        <label>语气参考 (Context)</label>
                        <textarea class="st-is-textarea tts-context-input" rows="1">${item.context_texts || ''}</textarea>
                    </div>
                    <div class="st-is-form-group st-is-form-group-full-width">
                        <label>触发信息</label>
                        <textarea class="st-is-textarea" rows="2" readonly>${getTriggerInfo(item)}</textarea>
                    </div>
                    <div class="st-is-form-group">
                        <label>音色 (Speaker)</label>
                        <select class="st-is-select tts-speaker-select">
                            ${getSpeakerOptions(item).replace(`value="${item.speaker_name}"`, `value="${item.speaker_name}" selected`)}
                        </select>
                    </div>
                    <div class="st-is-form-group">
                        <label>声音特效 (Effects)</label>
                        <select class="st-is-select tts-effects-select">
                            ${effectsOptions.replace(`value="${item.special_effects}"`, `value="${item.special_effects}" selected`)}
                        </select>
                    </div>
                    <div class="st-is-form-group">
                        <label>环境混响 (IR)</label>
                        <select class="st-is-select tts-ir-select">
                            ${irOptions.replace(`value="${item.ir_description}"`, `value="${item.ir_description}" selected`)}
                        </select>
                    </div>
                    <div class="st-is-form-group">
                        <label>空间音频 (Spatial)</label>
                        <select class="st-is-select tts-spatial-select">
                            ${spatialOptions.replace(`value="${item.spatial}"`, `value="${item.spatial}" selected`)}
                        </select>
                    </div>
                </div>
                <div class="st-is-tts-details-actions">
                    <button class="st-is-btn tts-regenerate-btn" data-cache-key="${item.cacheKey}" title="使用上方新设置重新生成TTS音频"><i class="fa-solid fa-arrows-rotate"></i> 重新生成</button>
                    <button class="st-is-btn tts-effects-preview-btn" data-cache-key="${item.cacheKey}" title="预览应用特效后的音频，不重新生成" ${item.status !== 'success' ? 'disabled' : ''}><i class="fa-solid fa-wand-magic-sparkles"></i> 预览特效</button>
                    <button class="st-is-btn tts-download-original-btn" data-cache-key="${item.cacheKey}" title="下载原始MP3音频文件" ${item.status !== 'success' ? 'disabled' : ''}><i class="fa-solid fa-file-audio"></i> 下载原声</button>
                    <button class="st-is-btn tts-download-btn" data-cache-key="${item.cacheKey}" title="下载应用特效后的WAV音频文件" ${item.status !== 'success' ? 'disabled' : ''}><i class="fa-solid fa-download"></i> 下载特效版</button>
                </div>
            </div>
        </div>
    `).join('');

    container.innerHTML = `<div class="st-is-tts-card-list">${cardsHtml}</div>`;

    container.querySelectorAll('.tts-play-btn').forEach(b => b.addEventListener('click', onPlayPreviewClick));
    container.querySelectorAll('.tts-details-toggle').forEach(b => b.addEventListener('click', onToggleDetailsClick));
    container.querySelectorAll('.tts-regenerate-btn').forEach(b => b.addEventListener('click', onRegenerateClick));
    container.querySelectorAll('.tts-effects-preview-btn').forEach(b => b.addEventListener('click', onPreviewEffectsClick));
    container.querySelectorAll('.tts-download-original-btn').forEach(b => b.addEventListener('click', onDownloadOriginalClick));
    container.querySelectorAll('.tts-download-btn').forEach(b => b.addEventListener('click', onDownloadClick));

    const detailInputs = container.querySelectorAll('.tts-text-input, .tts-context-input, .tts-speaker-select, .tts-effects-select, .tts-ir-select, .tts-spatial-select');
    detailInputs.forEach(el => {
        el.addEventListener('change', onDetailInputChange);
    });
}

export async function stopAllTtsPreview() {
    if (currentlyPlayingAudio) {
        try { currentlyPlayingAudio.pause(); } catch (e) {}
        currentlyPlayingAudio = null;
        document.querySelectorAll('.tts-play-btn i').forEach(icon => icon.className = 'fa-solid fa-play');
    }
    if (activeEffectPreviews.size > 0) {
        for (const [key, preview] of activeEffectPreviews.entries()) {
            try { await preview.processor.stopPlayback(); } catch (e) {}
            const otherButton = document.querySelector(`.tts-effects-preview-btn[data-cache-key="${key}"]`);
            if (otherButton) otherButton.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
        }
        activeEffectPreviews.clear();
    }
}

export function initTtsPreview() {
    container = document.getElementById('st-is-tts-preview-list-container');
    filterContainer = document.getElementById('st-is-tts-preview-filter');
    mainSfxConfigTextarea = document.getElementById('st-is-main-sfx-config-text');
    mainSfxReparseButton = document.getElementById('st-is-main-sfx-reparse-button');
    mainSfxConfigStatus = document.getElementById('st-is-main-sfx-config-status');
    mainSfxIssuesPanel = document.getElementById('st-is-main-sfx-issues-panel');
    mainSfxIssuesList = document.getElementById('st-is-main-sfx-issues-list');
    if (!container) {
        console.error('TTS Preview container not found!');
        return;
    }

    if (filterContainer) {
        filterContainer.querySelectorAll('.st-is-tts-preview-filter-btn').forEach(button => {
            button.addEventListener('click', onPreviewFilterClick);
        });
        updateFilterButtons();
    }

    mainSfxConfigTextarea?.addEventListener('input', onMainSfxConfigInput);
    mainSfxReparseButton?.addEventListener('click', onMainSfxReparseClick);

    renderTtsList();
    renderMainSfxConfigPanel();
    renderMainSfxIssues();
    TtsCacheEmitter.addEventListener('update', renderTtsList);
    MainSfxConfigEmitter.addEventListener('update', renderMainSfxConfigPanel);
    MainSfxConfigEmitter.addEventListener('update', renderMainSfxIssues);
    console.log('TTS Preview UI initialized.');
}

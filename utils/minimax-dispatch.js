// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  MiniMax 高层调度
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { extensionName } from './config.js';
import { MinimaxClient, MinimaxError, hexToBlob, parseApiKeys } from './minimax-tts.js';
import {
    getRoot,
    markMyVoiceUsed,
    buildPronDict,
    buildVoiceModify,
} from './minimax-voices.js';
import {
    addOrUpdateTtsItem,
    getTtsItem,
    generateTtsCacheKey,
} from './tts-cache.js';
import { floatBallStateManager } from './ui-float-ball.js';
import { ttsNotifyStart, ttsNotifyEnd, ttsNotifyPhase } from './tts-notification.js';

let activeRequests = 0;

export function generateMinimaxCacheKey(text, control, voiceId) {
    return generateTtsCacheKey(text, control || '', `minimax:${voiceId || 'none'}`);
}

function setPhase(phase, extra = {}) {
    if (phase === 'waiting') {
        const sec = Math.max(1, Math.ceil((extra.waitMs || 0) / 1000));
        ttsNotifyPhase('minimax', 'waiting', `限流等待 ~${sec}s`);
    } else if (phase === 'downloading') {
        ttsNotifyPhase('minimax', 'downloading');
    } else {
        ttsNotifyPhase('minimax', '');
    }
}

function buildClient(onPoolEvent = null) {
    const s = extension_settings[extensionName]?.minimax || {};
    const keys = parseApiKeys(s.apiKey);
    if (!keys.length) throw new MinimaxError('MiniMax: 未配置 API Key，请到「MiniMax」设置页填写');
    return new MinimaxClient({
        apiKeys: keys,
        platform: s.platform || 'cn',
        timeout: 15000,
        retry: 1,
        onPoolEvent,
    });
}

/**
 * 与 tts-cache.initiateTtsRequest 形状一致
 * @param {object} requestData
 *   {cacheKey, text, context_texts, speaker, voiceId,
 *    ir_description, special_effects, spatial, metadata}
 *
 *   注：context_texts 仅参与 cacheKey；MiniMax API 不直接消费它
 *       （语气控制由文本内 (laughs)/<#1.0#> 标签 + emotion 字段表达）
 */
export async function initiateMinimaxRequest(requestData) {
    const {
        cacheKey, text, context_texts, speaker,
        voiceId,
        ir_description, special_effects, spatial, metadata,
    } = requestData;

    if (!text || !text.trim()) {
        throw new Error('MiniMax: 文本为空');
    }
    // 跳过纯标点 / 纯符号 / 纯 emoji 等无可朗读内容（如 "！！"、"……"）
    if (!/[\p{L}\p{N}]/u.test(text)) {
        const msg = `MiniMax: 跳过无可朗读字符的文本 "${text.slice(0, 20)}"`;
        console.warn('[MiniMax Dispatch]', msg);
        throw new Error(msg);
    }
    if (!voiceId) {
        throw new Error(`MiniMax: 未提供 voice_id（speaker="${speaker || ''}"）`);
    }

    // 内存缓存命中
    const cached = getTtsItem(cacheKey);
    if (cached && cached.status === 'success') {
        console.log(`[MiniMax Dispatch] cache hit: ${cacheKey}`);
        return { ...cached, metadata: { ...cached.metadata, ...metadata } };
    }

    addOrUpdateTtsItem(cacheKey, {
        cacheKey, text, context_texts,
        speaker, speaker_name: speaker,
        ir_description, special_effects, spatial,
        status: 'pending', metadata,
    });

    activeRequests++;
    ttsNotifyStart('minimax', 'MiniMax');
    floatBallStateManager.startLoading();

    try {
        const settings = getRoot();
        const cli = buildClient((ev) => {
            // 池在「全部 key 限速」阶段会 emit { phase: 'wait', waitMs, totalKeys }
            // 拿到 key 真正发出请求时 emit { phase: 'resume' }
            if (ev?.phase === 'wait') {
                setPhase('waiting', { waitMs: ev.waitMs });
            } else if (ev?.phase === 'resume') {
                setPhase('generating');
            }
        });

        const resp = await cli.t2a({
            text,
            voiceId,
            model: settings.model || 'speech-2.8-hd',
            speed: settings.speed ?? 1.0,
            vol: settings.vol ?? 1.0,
            pitch: settings.pitch ?? 0,
            emotion: settings.emotion || '',
            languageBoost: settings.languageBoost || 'auto',
            format: settings.format || 'mp3',
            sampleRate: settings.sampleRate || 32000,
            bitrate: settings.bitrate || 128000,
            channel: settings.channel || 1,
            voiceModify: buildVoiceModify(settings.vm),
            pronunciationDict: buildPronDict(settings.pronDict),
            outputFormat: 'hex',
        });

        // 拉音频
        let audioBlob;
        if (resp.audioHex) {
            audioBlob = hexToBlob(resp.audioHex, `audio/${settings.format || 'mp3'}`);
        } else if (resp.audioUrl) {
            setPhase('downloading');
            try {
                audioBlob = await cli.download(resp.audioUrl);
            } finally {
                // 下载完恢复为生成态（仍有其它请求在跑时 toastr 才有意义）
                setPhase('generating');
            }
        } else {
            throw new MinimaxError('MiniMax 返回了空音频');
        }
        const audioBuffer = await audioBlob.arrayBuffer();
        const audioUrl = URL.createObjectURL(audioBlob);

        // 标记音色使用过（仅当本地有这条 voice_id 的记录）
        try { markMyVoiceUsed(voiceId); } catch (_) {}

        const successItem = addOrUpdateTtsItem(cacheKey, {
            status: 'success',
            audioBuffer, audioBlob, audioUrl,
            text, context_texts,
            speaker: `minimax:${voiceId}`,
            speaker_name: speaker,
            ir_description, special_effects, spatial,
        });
        return successItem;
    } catch (e) {
        console.error('[MiniMax Dispatch] failed:', e);
        addOrUpdateTtsItem(cacheKey, {
            status: 'error',
            error: e?.message || String(e),
        });
        throw e;
    } finally {
        activeRequests--;
        floatBallStateManager.stopLoading();
        ttsNotifyEnd('minimax');
    }
}

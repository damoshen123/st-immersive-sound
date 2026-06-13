// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  Nimo（MiMo-V2.5-TTS）高层调度
//  与 minimax-dispatch / edge-dispatch 同构，供 index.js 的
//  人物 TTS 分支消费（ttsPromises）。
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { extensionName } from './config.js';
import { requestNimoTTS, parseApiKeys, NimoError } from './nimo-tts.js';
import { getRoot, resolveVoicePayload } from './nimo-voices.js';
import {
    addOrUpdateTtsItem,
    getTtsItem,
    generateTtsCacheKey,
} from './tts-cache.js';
import { floatBallStateManager } from './ui-float-ball.js';
import { ttsNotifyStart, ttsNotifyEnd, ttsNotifyPhase } from './tts-notification.js';

export function generateNimoCacheKey(text, control, voiceId) {
    return generateTtsCacheKey(text, control || '', `nimo:${voiceId || 'none'}`);
}

function setPhase(phase, extra = {}) {
    if (phase === 'waiting') {
        const sec = Math.max(1, Math.ceil((extra.waitMs || 0) / 1000));
        ttsNotifyPhase('nimo', 'waiting', `限流等待 ~${sec}s`);
    } else {
        ttsNotifyPhase('nimo', '');
    }
}

/**
 * @param {object} requestData
 *   {cacheKey, text, context_texts, speaker, voiceId,
 *    ir_description, special_effects, spatial, metadata}
 *   voiceId：这里是 nimo-voices.js 的内部 id（nv_xxx）或预置 voice 名
 */
export async function initiateNimoRequest(requestData) {
    const {
        cacheKey, text, context_texts, speaker,
        voiceId,
        ir_description, special_effects, spatial, metadata,
    } = requestData;

    if (!text || !text.trim()) throw new Error('Nimo: 文本为空');
    if (!/[\p{L}\p{N}]/u.test(text)) {
        const msg = `Nimo: 跳过无可朗读字符的文本 "${text.slice(0, 20)}"`;
        console.warn('[Nimo Dispatch]', msg);
        throw new Error(msg);
    }
    if (!voiceId) throw new Error(`Nimo: 未提供 voiceId（speaker="${speaker || ''}"）`);

    const cached = getTtsItem(cacheKey);
    if (cached && cached.status === 'success') {
        console.log(`[Nimo Dispatch] cache hit: ${cacheKey}`);
        return { ...cached, metadata: { ...cached.metadata, ...metadata } };
    }

    addOrUpdateTtsItem(cacheKey, {
        cacheKey, text, context_texts,
        speaker, speaker_name: speaker,
        ir_description, special_effects, spatial,
        status: 'pending', metadata,
    });

    ttsNotifyStart('nimo', 'MiMo');
    floatBallStateManager.startLoading();

    try {
        const settings = getRoot();
        const apiKeys = parseApiKeys(settings.apiKey);
        if (!apiKeys.length) throw new NimoError('Nimo: 未配置 API Key，请到「MiMo」设置页填写');

        const payload = await resolveVoicePayload(voiceId);
        const stylePrefix = String(context_texts || '').trim() || String(settings.stylePrefix || '').trim();

        const { blob, mime } = await requestNimoTTS(text, {
            apiKeys,
            baseUrl: settings.baseUrl,
            model: payload.model,
            voice: payload.voice,
            prompt: payload.prompt,
            format: settings.format || 'wav',
            stylePrefix,
            onRateLimitEvent: (event) => {
                if (event?.phase === 'wait') {
                    setPhase('waiting', event);
                } else {
                    setPhase('');
                }
            },
        });

        const audioBuffer = await blob.arrayBuffer();
        const audioUrl = URL.createObjectURL(blob);

        const successItem = addOrUpdateTtsItem(cacheKey, {
            status: 'success',
            audioBuffer, audioBlob: blob, audioUrl,
            text, context_texts,
            speaker: `nimo:${payload.displayName || voiceId}`,
            speaker_name: speaker,
            ir_description, special_effects, spatial,
        });
        return successItem;
    } catch (e) {
        console.error('[Nimo Dispatch] failed:', e);
        addOrUpdateTtsItem(cacheKey, {
            status: 'error',
            error: e?.message || String(e),
        });
        throw e;
    } finally {
        setPhase('');
        floatBallStateManager.stopLoading();
        ttsNotifyEnd('nimo');
    }
}

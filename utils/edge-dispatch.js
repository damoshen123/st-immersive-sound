// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  Edge TTS 高层调度（人物对话 TTS 入口）
//  与 minimax-dispatch.js 形状一致，返回值兼容 index.js 中
//  对 ttsPromises 结果（item.metadata / item.audioUrl 等）的消费逻辑。
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { extensionName } from './config.js';
import { requestEdgeTTS, validateEdgeStyle } from './edge-tts.js';
import {
    addOrUpdateTtsItem,
    getTtsItem,
    generateTtsCacheKey,
} from './tts-cache.js';
import { floatBallStateManager } from './ui-float-ball.js';
import { ttsNotifyStart, ttsNotifyEnd } from './tts-notification.js';

export function generateEdgeCacheKey(text, control, voiceId) {
    return generateTtsCacheKey(text, control || '', `edge:${voiceId || 'none'}`);
}

/**
 * @param {object} requestData
 *   {cacheKey, text, context_texts, speaker, voiceId,
 *    ir_description, special_effects, spatial, metadata}
 */
export async function initiateEdgeRequest(requestData) {
    const {
        cacheKey, text, context_texts, speaker,
        voiceId,
        ir_description, special_effects, spatial, metadata,
    } = requestData;

    if (!text || !text.trim()) {
        throw new Error('Edge: 文本为空');
    }
    if (!/[\p{L}\p{N}]/u.test(text)) {
        const msg = `Edge: 跳过无可朗读字符的文本 "${text.slice(0, 20)}"`;
        console.warn('[Edge Dispatch]', msg);
        throw new Error(msg);
    }
    if (!voiceId) {
        throw new Error(`Edge: 未提供 voice_id（speaker="${speaker || ''}"）`);
    }

    // 内存缓存命中
    const cached = getTtsItem(cacheKey);
    if (cached && cached.status === 'success') {
        console.log(`[Edge Dispatch] cache hit: ${cacheKey}`);
        return { ...cached, metadata: { ...cached.metadata, ...metadata } };
    }

    addOrUpdateTtsItem(cacheKey, {
        cacheKey, text, context_texts,
        speaker, speaker_name: speaker,
        ir_description, special_effects, spatial,
        status: 'pending', metadata,
    });

    ttsNotifyStart('edge', 'Edge');
    floatBallStateManager.startLoading();

    try {
        const cfg = extension_settings[extensionName]?.edge_tts || {};
        // 角色 TTS 用人物分支（与"测试音色"独立）：
        // 风格按当前 cfg.style 校验，无效则退回 general
        const style = validateEdgeStyle(cfg.style || 'general', voiceId) || 'general';
        const opts = {
            voice: voiceId,
            style,
            rate: Number.isFinite(cfg.rate) ? cfg.rate : 0,
            pitch: Number.isFinite(cfg.pitch) ? cfg.pitch : 0,
            volume: Number.isFinite(cfg.volume) ? cfg.volume : 50,
        };

        const edgeResult = await requestEdgeTTS(text, opts);
        const blobUrl = edgeResult.blobUrl;

        // 转 ArrayBuffer / Blob，方便 TTS 预览界面使用
        let audioBuffer = null;
        let audioBlob = edgeResult.blob || null;
        try {
            if (!audioBlob) {
                const resp = await fetch(blobUrl);
                audioBlob = await resp.blob();
            }
            audioBuffer = await audioBlob.arrayBuffer();
        } catch (e) {
            console.warn('[Edge Dispatch] 读取 blob 失败（不影响播放）：', e);
        }

        const successItem = addOrUpdateTtsItem(cacheKey, {
            status: 'success',
            audioBuffer, audioBlob, audioUrl: blobUrl,
            text, context_texts,
            speaker: `edge:${voiceId}`,
            speaker_name: speaker,
            ir_description, special_effects, spatial,
        });
        return successItem;
    } catch (e) {
        console.error('[Edge Dispatch] failed:', e);
        addOrUpdateTtsItem(cacheKey, {
            status: 'error',
            error: e?.message || String(e),
        });
        throw e;
    } finally {
        floatBallStateManager.stopLoading();
        ttsNotifyEnd('edge');
    }
}

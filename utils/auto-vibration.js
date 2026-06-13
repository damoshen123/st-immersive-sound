// @ts-nocheck
// 公共的 "auto" 自动震动模块。
// - 解析 auto 字符串配置
// - 以"旁路 (tap)"方式接入 AnalyserNode，不改变原主信号链
// - 基于频谱阈值的上升沿触发震动（与旧实现行为等价，默认参数下完全一致）
//
// 字符串协议（向后兼容，后面的字段都可省略，缺省走默认值）：
//   auto-lowThreshold-lowDuration-highThreshold-highDuration
//   auto-lowThreshold-lowDuration-highThreshold-highDuration-lowCooldownMs-highCooldownMs
//   auto-lowThreshold-lowDuration-highThreshold-highDuration-lowCooldownMs-highCooldownMs-lowBandPct-highBandPct
//
// 其中：
// - threshold: 0..255，getByteFrequencyData 刻度下的触发阈值
// - duration:  navigator.vibrate 毫秒数
// - cooldownMs: 触发后的最小间隔（默认 0，即与旧行为一致，仅靠上升沿去抖）
// - bandPct:   频段占 frequencyBinCount 的百分比（默认 25/25，即前 25% 为低频段、后 25% 为高频段）

import { extension_settings } from "../../../../extensions.js";
import { extensionName } from "./config.js";

/**
 * 读取全局默认参数。未写入 config 的键会 fallback 到硬编码默认。
 * 这些硬编码默认值与旧实现完全一致。
 */
export function getAutoVibrationDefaults() {
    const s = (extension_settings && extension_settings[extensionName]) || {};
    const pick = (v, fb) => (Number.isFinite(v) ? v : fb);
    return {
        lowThreshold:   pick(s.autoVibrationLowThreshold,   20),
        lowDuration:    pick(s.autoVibrationLowDuration,    50),
        highThreshold:  pick(s.autoVibrationHighThreshold,  80),
        highDuration:   pick(s.autoVibrationHighDuration,   100),
        lowCooldownMs:  pick(s.autoVibrationLowCooldownMs,  0),
        highCooldownMs: pick(s.autoVibrationHighCooldownMs, 0),
        lowBandPct:     pick(s.autoVibrationLowBandPct,     25),
        highBandPct:    pick(s.autoVibrationHighBandPct,    25),
    };
}

/**
 * 解析 "auto-..." 字符串。缺省字段走 defaults。
 * 只接受字符串输入；非字符串直接返回默认值。
 */
export function parseAutoVibrationString(str, defaults) {
    const d = defaults || getAutoVibrationDefaults();
    if (typeof str !== 'string') return { ...d };

    const parts = str.split('-');
    const toInt = (v, fb) => {
        if (v === undefined || v === null || v === '') return fb;
        const n = parseInt(String(v).trim(), 10);
        return Number.isFinite(n) ? n : fb;
    };

    return {
        lowThreshold:   toInt(parts[1], d.lowThreshold),
        lowDuration:    toInt(parts[2], d.lowDuration),
        highThreshold:  toInt(parts[3], d.highThreshold),
        highDuration:   toInt(parts[4], d.highDuration),
        lowCooldownMs:  toInt(parts[5], d.lowCooldownMs),
        highCooldownMs: toInt(parts[6], d.highCooldownMs),
        lowBandPct:     toInt(parts[7], d.lowBandPct),
        highBandPct:    toInt(parts[8], d.highBandPct),
    };
}

/**
 * 以"旁路"方式从 sourceNode 引出一个 AnalyserNode：
 *     sourceNode ──► 原有下游（调用方自己负责保持）
 *                └─► analyserNode  （仅读取数据，不再向后连接）
 *
 * 调用方继续自行把 sourceNode 连接到真正的下游，不要经过 analyser。
 * 返回 { analyserNode, disconnect }。
 */
export function setupAutoVibrationTap(audioContext, sourceNode, options) {
    const { fftSize = 256 } = options || {};
    const analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = fftSize;
    try {
        sourceNode.connect(analyserNode);
    } catch (e) {
        console.warn('[auto-vibration] failed to connect tap:', e);
    }
    return {
        analyserNode,
        disconnect() {
            try { sourceNode.disconnect(analyserNode); } catch (e) {}
            try { analyserNode.disconnect(); } catch (e) {}
        },
    };
}

/**
 * 启动自动震动分析循环。
 *
 * 行为（与旧实现等价）：
 * - 每 requestAnimationFrame 一次，读取频谱字节数据
 * - 低频段取最大值，高频段取最大值
 * - 过阈值 + 上升沿时触发一次 navigator.vibrate(duration)
 * - 同帧内高频触发优先于低频（保持旧实现的 if/else 语义）
 *
 * 新增但默认关闭（默认值下与旧行为一致）：
 * - cooldownMs：触发后屏蔽二次触发的最小间隔
 *
 * 生命周期：
 * - 传入 isAlive 回调，返回 false 时自动退出循环
 * - 返回对象 { stop() }，调用 stop() 会取消循环并发送 vibrate(0) 强制停振
 *
 * @param {AnalyserNode} analyserNode
 * @param {object} params parseAutoVibrationString 的返回值
 * @param {() => boolean} isAlive
 * @returns {{ stop: () => void }}
 */
export function startAutoVibration(analyserNode, params, isAlive) {
    const noop = { stop() {} };
    if (!analyserNode || typeof navigator === 'undefined' || !navigator.vibrate) {
        return noop;
    }

    const {
        lowThreshold, lowDuration, highThreshold, highDuration,
        lowCooldownMs = 0, highCooldownMs = 0,
        lowBandPct = 25, highBandPct = 25,
    } = params || {};

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // 频段按百分比划分（与旧实现一致：默认前 25% / 后 25%）
    const lowEnd = Math.max(
        1,
        Math.min(bufferLength, Math.floor(bufferLength * (lowBandPct / 100))),
    );
    const highStart = Math.max(
        0,
        Math.min(bufferLength - 1, Math.floor(bufferLength * (1 - highBandPct / 100))),
    );

    let wasAboveLow = false;
    let wasAboveHigh = false;
    let lastLowFireAt = -Infinity;
    let lastHighFireAt = -Infinity;

    let rafId = 0;
    let stopped = false;

    const tick = () => {
        if (stopped) return;
        if (typeof isAlive === 'function' && !isAlive()) {
            return;
        }

        analyserNode.getByteFrequencyData(dataArray);

        let maxLow = 0;
        for (let i = 0; i < lowEnd; i++) {
            if (dataArray[i] > maxLow) maxLow = dataArray[i];
        }
        let maxHigh = 0;
        for (let i = highStart; i < bufferLength; i++) {
            if (dataArray[i] > maxHigh) maxHigh = dataArray[i];
        }

        const isAboveLow = maxLow > lowThreshold;
        const isAboveHigh = maxHigh > highThreshold;

        const now = performance.now();

        if (isAboveHigh && !wasAboveHigh && (now - lastHighFireAt) >= highCooldownMs) {
            try { navigator.vibrate(highDuration); } catch (e) {}
            lastHighFireAt = now;
        } else if (isAboveLow && !wasAboveLow && (now - lastLowFireAt) >= lowCooldownMs) {
            try { navigator.vibrate(lowDuration); } catch (e) {}
            lastLowFireAt = now;
        }

        wasAboveLow = isAboveLow;
        wasAboveHigh = isAboveHigh;

        rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return {
        stop() {
            if (stopped) return;
            stopped = true;
            if (rafId) {
                try { cancelAnimationFrame(rafId); } catch (e) {}
                rafId = 0;
            }
            // 停止时强制停振，避免长 duration 在停止后仍继续
            try {
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    navigator.vibrate(0);
                }
            } catch (e) {}
        },
    };
}

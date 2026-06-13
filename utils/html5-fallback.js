// @ts-nocheck
/**
 * html5-fallback.js
 *
 * 大体积音频 (> SIZE_THRESHOLD_BYTES) 回退到 HTML5 <audio> 播放，
 * 规避移动端 decodeAudioData 对大 PCM 的限制。
 * 回退通道不挂任何效果器 / IR / 空间化，仍通过 MediaElementAudioSourceNode
 * 接入 WebAudio 图以保留 gainNode / 淡入淡出 / ducking / analyser 震动。
 */

import { extension_settings } from "../../../../extensions.js";
import { extensionName } from './config.js';
import { getFromDB } from './audio-cache.js';
import { getTtsItem } from './tts-cache.js';

export const SIZE_THRESHOLD_BYTES = 600 * 1024;

/**
 * 探测音频体积（字节）。未知返回 0。
 * - tts-* : 从 tts-cache 里读 blob / buffer size
 * - 其他  : 先查 IndexedDB，再 HEAD 请求
 */
export async function probeAudioSize(url) {
    if (!url) return 0;

    if (typeof url === 'string' && url.startsWith('tts-')) {
        try {
            const item = getTtsItem(url);
            if (item?.audioBlob?.size) return item.audioBlob.size;
            if (item?.audioBuffer?.byteLength) return item.audioBuffer.byteLength;
        } catch (e) {
            console.warn('[size-gate] tts probe failed:', e);
        }
        return 0;
    }

    try {
        const cached = await getFromDB(url);
        if (cached?.arrayBuffer?.byteLength) return cached.arrayBuffer.byteLength;
    } catch (e) {
        // ignore
    }

    try {
        const res = await fetch(url, { method: 'HEAD' });
        const len = res.headers.get('content-length');
        if (len) {
            const n = parseInt(len, 10);
            if (!Number.isNaN(n)) return n;
        }
    } catch (e) {
        // ignore
    }

    return 0;
}

/**
 * 判断是否应使用 HTML5 回退播放。
 * @returns {Promise<{useHtml5:boolean, size:number}>}
 */
export async function shouldUseHtml5Fallback(url) {
    // 兼容 Edge / 大文件 HTML5 回退总开关。默认关闭 —— 关闭时永远走 Tone.Player
    // + 效果链路径，避免在 iOS / WebKit 上由于 createMediaElementSource 不真正
    // 路由音频导致 auto 自动震动失效等问题。
    const enabled = !!(extension_settings?.[extensionName]?.compatibility_edge);
    if (!enabled) {
        return { useHtml5: false, size: 0 };
    }
    const size = await probeAudioSize(url);
    const useHtml5 = size > SIZE_THRESHOLD_BYTES;
    if (useHtml5) {
        console.log(`[size-gate] using HTML5 fallback, size=${size} url=${url}`);
    }
    return { useHtml5, size };
}

/**
 * 根据 url / tts key 得到可直接喂给 HTMLAudioElement 的 src。
 * 对 tts-* 用 Blob URL，调用方需在 dispose 时 revoke。
 * @returns {{src:string, revoke:()=>void}}
 */
function resolveHtml5Src(url) {
    if (typeof url === 'string' && url.startsWith('tts-')) {
        const item = getTtsItem(url);
        if (item?.audioBlob) {
            const objectUrl = URL.createObjectURL(item.audioBlob);
            return {
                src: objectUrl,
                revoke: () => {
                    try { URL.revokeObjectURL(objectUrl); } catch (e) { /* ignore */ }
                },
            };
        }
        throw new Error(`[html5-fallback] tts blob not available for ${url}`);
    }
    return { src: url, revoke: () => {} };
}

/**
 * 创建与 createPlaybackChain 形状兼容的回退链。
 *
 * @param {Object} params
 * @param {string} params.url  真实 URL 或 tts-* 键
 * @param {boolean} params.loop
 * @param {AudioContext} params.audioContext
 * @returns {Promise<Object>} chainWrapper
 */
export async function createHtml5Chain({ url, loop, audioContext }) {
    const { src, revoke } = resolveHtml5Src(url);

    const audioEl = new Audio();
    audioEl.crossOrigin = 'anonymous';
    audioEl.preload = 'auto';
    audioEl.loop = !!loop;
    audioEl.src = src;

    // 在需要时再 resume
    try { await audioContext.resume(); } catch (e) { /* ignore */ }

    let mediaSource;
    try {
        mediaSource = audioContext.createMediaElementSource(audioEl);
    } catch (e) {
        console.error('[html5-fallback] createMediaElementSource failed:', e);
        revoke();
        throw e;
    }

    // pass-through output gain，方便下游 connect
    const output = audioContext.createGain();
    output.gain.value = 1;
    mediaSource.connect(output);

    // 等一次 loadedmetadata，尽量让 buffer.duration 可用
    const metadataReady = new Promise(resolve => {
        if (audioEl.readyState >= 1 && audioEl.duration && !Number.isNaN(audioEl.duration)) {
            resolve();
            return;
        }
        const onMeta = () => {
            audioEl.removeEventListener('loadedmetadata', onMeta);
            resolve();
        };
        audioEl.addEventListener('loadedmetadata', onMeta);
        // 超时兜底
        setTimeout(resolve, 2000);
    });
    await metadataReady;

    let stopped = false;
    // 音量同步：在 iOS/WebKit 等浏览器上，createMediaElementSource 不会真正把
    // 音频重路由到 WebAudio 图，<audio> 仍会直接出声，导致 masterGain / typeGain /
    // perTrackGain 全部失效——UI 音量条对回退音频毫无影响。
    // 这里通过周期性地把「上游 Gain 链乘积」同步到 audioEl.volume 来修复。
    // 在 WebAudio 路由正常的桌面浏览器上，audioEl.volume 在建立 MediaElementSource
    // 之后不再影响信号，因此此同步是安全的 no-op。
    let volumeSyncTimer = null;
    let volumeSyncNodes = null;
    const applyVolumeSync = () => {
        if (!volumeSyncNodes) return;
        const { trackGainNode, typeGainNode, masterGainNode } = volumeSyncNodes;
        try {
            const t = trackGainNode?.gain?.value ?? 1;
            const y = typeGainNode?.gain?.value ?? 1;
            const m = masterGainNode?.gain?.value ?? 1;
            let v = t * y * m;
            if (!Number.isFinite(v)) v = 0;
            if (v < 0) v = 0;
            if (v > 1) v = 1;
            if (audioEl.volume !== v) audioEl.volume = v;
        } catch (e) { /* ignore */ }
    };

    const player = {
        _el: audioEl,
        loop: !!loop,
        onstop: () => {},
        // 兼容访问：chainWrapper.player.buffer.duration
        get buffer() {
            return {
                duration: (audioEl.duration && !Number.isNaN(audioEl.duration)) ? audioEl.duration : 0,
                get: () => null,
            };
        },
        start(when = 0) {
            const now = audioContext.currentTime;
            const delayMs = Math.max(0, (typeof when === 'number' ? when - now : 0) * 1000);
            const doStart = () => {
                if (stopped) return;
                try { audioEl.currentTime = 0; } catch (e) { /* ignore */ }
                const p = audioEl.play();
                if (p && typeof p.catch === 'function') {
                    p.catch(err => console.warn('[html5-fallback] play() rejected:', err));
                }
            };
            if (delayMs > 0) setTimeout(doStart, delayMs);
            else doStart();
        },
        stop(when = 0) {
            const now = audioContext.currentTime;
            const delayMs = Math.max(0, (typeof when === 'number' ? when - now : 0) * 1000);
            const doStop = () => {
                if (stopped) return;
                stopped = true;
                try { audioEl.pause(); } catch (e) { /* ignore */ }
                try { player.onstop && player.onstop(); } catch (e) { /* ignore */ }
            };
            if (delayMs > 0) setTimeout(doStop, delayMs);
            else doStop();
        },
        dispose() {
            stopped = true;
            try { audioEl.pause(); } catch (e) { /* ignore */ }
            try { audioEl.removeAttribute('src'); audioEl.load(); } catch (e) { /* ignore */ }
        },
    };

    // 自然结束
    audioEl.addEventListener('ended', () => {
        if (audioEl.loop) return;
        if (stopped) return;
        try { player.onstop && player.onstop(); } catch (e) { /* ignore */ }
    });

    // 错误时也触发 onstop，让上层清理
    audioEl.addEventListener('error', (ev) => {
        console.warn('[html5-fallback] audio element error:', audioEl.error);
        if (stopped) return;
        try { player.onstop && player.onstop(); } catch (e) { /* ignore */ }
    });

    return {
        player,
        nodes: [],
        panner: null,
        output,
        pathPoints: [],
        isHtml5Fallback: true,
        /**
         * 让回退链把上游 gain 图乘积同步到 audioEl.volume。
         * 主要用于修复 iOS / WebKit 上 createMediaElementSource 不真正路由音频、
         * UI 音量条对回退音频无效的问题。
         */
        attachVolumeChain({ trackGainNode, typeGainNode, masterGainNode } = {}) {
            volumeSyncNodes = { trackGainNode, typeGainNode, masterGainNode };
            applyVolumeSync();
            if (volumeSyncTimer) clearInterval(volumeSyncTimer);
            // 100ms 对淡入淡出 / ducking 动画已足够平滑，CPU 开销可忽略。
            volumeSyncTimer = setInterval(applyVolumeSync, 100);
        },
        dispose() {
            if (volumeSyncTimer) {
                clearInterval(volumeSyncTimer);
                volumeSyncTimer = null;
            }
            volumeSyncNodes = null;
            try { mediaSource.disconnect(); } catch (e) { /* ignore */ }
            try { output.disconnect(); } catch (e) { /* ignore */ }
            player.dispose();
            revoke();
        },
    };
}

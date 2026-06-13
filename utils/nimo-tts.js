// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  MiMo-V2.5-TTS（Nimo）底层 API 封装
//  - 鉴权头：api-key + Authorization: Bearer
//  - 请求体：OpenAI 风格 messages + audio
//  - 三种模型：mimo-v2.5-tts / -voicedesign / -voiceclone
//  - 输出格式：wav / mp3 / pcm16（前端需封装 WAV 头）
// ═══════════════════════════════════════════════════════════

// ── 异常 ────────────────────────────────────────────────

export class NimoError extends Error {
    constructor(message, status = null, detail = null) {
        super(message);
        this.name = 'NimoError';
        this.status = status;
        this.detail = detail;
    }
}

// ── Key 池（多 key 轮询）─────────────────────────────────

export function parseApiKeys(input) {
    if (Array.isArray(input)) {
        return [...new Set(input.map(s => String(s || '').trim()).filter(Boolean))];
    }
    if (!input) return [];
    return [...new Set(String(input).split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean))];
}

let _rrIndex = 0;
const _rateLimitedUntil = new Map();
function pickKey(keys) {
    if (!keys.length) return null;
    const now = Date.now();
    for (let i = 0; i < keys.length; i++) {
        const idx = (_rrIndex + i) % keys.length;
        const key = keys[idx];
        const until = _rateLimitedUntil.get(key) || 0;
        if (until <= now) {
            _rrIndex = (idx + 1) % keys.length;
            return key;
        }
    }
    return null;
}

function hasAvailableKey(keys) {
    const now = Date.now();
    return keys.some(key => (_rateLimitedUntil.get(key) || 0) <= now);
}

function getEarliestKeyReadyAt(keys) {
    let earliest = Infinity;
    for (const key of keys) {
        earliest = Math.min(earliest, _rateLimitedUntil.get(key) || 0);
    }
    return Number.isFinite(earliest) ? earliest : Date.now();
}

function markKeyRateLimited(key, waitMs) {
    if (!key) return;
    _rateLimitedUntil.set(key, Date.now() + Math.max(1000, waitMs || 0));
}

// ── 客户端侧滑动窗口限速（每个 key 1 分钟最多 N 次） ─────
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 150;
const _keyRequestTimestamps = new Map();

function pruneKeyTimestamps(key, now) {
    const list = _keyRequestTimestamps.get(key);
    if (!list || !list.length) return list;
    const cutoff = now - RATE_WINDOW_MS;
    let i = 0;
    while (i < list.length && list[i] <= cutoff) i++;
    if (i > 0) list.splice(0, i);
    return list;
}

/**
 * 申请一个本地速率槽位；若已达上限，等待最早一次请求过期。
 * 返回 true 表示已记录本次请求时间戳。
 */
async function acquireKeyRateSlot(key, signal, onRateLimitEvent) {
    if (!key) return false;
    while (true) {
        const now = Date.now();
        let list = _keyRequestTimestamps.get(key);
        if (!list) {
            list = [];
            _keyRequestTimestamps.set(key, list);
        }
        pruneKeyTimestamps(key, now);
        if (list.length < MAX_REQUESTS_PER_WINDOW) {
            list.push(now);
            return true;
        }
        const waitMs = Math.max(1000, list[0] + RATE_WINDOW_MS - now);
        if (typeof onRateLimitEvent === 'function') {
            try { onRateLimitEvent({ phase: 'wait', waitMs, source: key, reason: 'local-rpm' }); } catch (_) {}
        }
        await sleep(waitMs, signal);
        if (typeof onRateLimitEvent === 'function') {
            try { onRateLimitEvent({ phase: 'resume', source: key, reason: 'local-rpm' }); } catch (_) {}
        }
    }
}

// ── 工具 ────────────────────────────────────────────────

export function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
}

/**
 * 把 24 kHz 单声道 PCM16LE 字节封装为 WAV Blob
 */
export function pcm16ToWavBlob(pcmBytes, sampleRate = 24000) {
    const numSamples = pcmBytes.length / 2;
    const buffer = new ArrayBuffer(44 + pcmBytes.length);
    const view = new DataView(buffer);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + pcmBytes.length, true);
    writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, pcmBytes.length, true);
    new Uint8Array(buffer, 44).set(pcmBytes);
    return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * File -> 纯 base64（不带 data: 前缀）
 */
export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
            const s = String(r.result || '');
            resolve(s.split(',')[1] || '');
        };
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

export function inferAudioMime(fileOrName) {
    const name = (fileOrName && fileOrName.name) || String(fileOrName || '');
    const low = name.toLowerCase();
    if (low.endsWith('.wav')) return 'audio/wav';
    if (low.endsWith('.mp3')) return 'audio/mpeg';
    if (low.endsWith('.m4a')) return 'audio/mp4';
    if (low.endsWith('.ogg')) return 'audio/ogg';
    if (low.endsWith('.flac')) return 'audio/flac';
    return 'audio/mpeg';
}

export function normalizeBaseUrl(url) {
    return String(url || 'https://api.xiaomimimo.com/v1').trim().replace(/\/+$/, '');
}

const DEFAULT_TIMEOUT_MS = 15000;
const TIMEOUT_RETRY_COUNT = 1;
const DEFAULT_RATE_LIMIT_RETRY_COUNT = 2;
const DEFAULT_REQUEST_RETRY_COUNT = 2;
const DEFAULT_RETRY_AFTER_MS = 5000;
const MAX_RETRY_AFTER_MS = 60000;

function parseRetryAfterMs(value) {
    const raw = String(value || '').trim();
    if (!raw) return DEFAULT_RETRY_AFTER_MS;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, Math.round(seconds * 1000)));
    }
    const ts = Date.parse(raw);
    if (Number.isFinite(ts)) {
        return Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, ts - Date.now()));
    }
    return DEFAULT_RETRY_AFTER_MS;
}

function sleep(ms, signal) {
    if (!(ms > 0)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let settled = false;
        let tm = null;
        const cleanup = () => {
            if (tm !== null) clearTimeout(tm);
            if (signal) {
                try { signal.removeEventListener('abort', onAbort); } catch (_) {}
            }
        };
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            fn(value);
        };
        const onAbort = () => finish(reject, new NimoError('请求已取消'));
        if (signal?.aborted) {
            onAbort();
            return;
        }
        tm = setTimeout(() => finish(resolve), ms);
        if (signal) {
            try { signal.addEventListener('abort', onAbort, { once: true }); } catch (_) {}
        }
    });
}

function buildUserMessage(prompt, stylePrefix) {
    const parts = [];
    const promptText = String(prompt || '').trim();
    const styleText = String(stylePrefix || '').trim();
    if (promptText) parts.push(promptText);
    if (styleText) parts.push(styleText);
    return parts.join('\n');
}

function extractContentFilterMessage(data) {
    const choice = data?.choices?.[0];
    const finishReason = String(choice?.finish_reason || '').trim();
    const messageContent = String(choice?.message?.content || '').trim();
    if (finishReason === 'content_filter') {
        return messageContent || 'content_filter';
    }
    if (/considered high risk|content[_ -]?filter/i.test(messageContent)) {
        return messageContent;
    }
    return '';
}

function shouldRetryNimoError(error) {
    if (!(error instanceof NimoError)) return false;
    const message = String(error.message || '');
    if (/content_filter|high risk|内容过滤|风控拦截/i.test(message)) return true;
    if (error.status === 429) return false;
    if (typeof error.status === 'number') {
        if (error.status === 408) return true;
        if (error.status >= 500) return true;
        if (error.status >= 400) return false;
    }

    if (/请求超时|网络错误|非 JSON 响应|返回中未找到音频数据/i.test(message)) return true;
    return false;
}

// ── 核心请求 ────────────────────────────────────────────

/**
 * 发起一次 MiMo TTS 合成
 *
 * @param {string} text               Assistant 文本（要合成的目标内容）
 * @param {object} opts
 *   @param {string}  opts.apiKey     单个 key 字符串；可选（若用池则由外层轮询后传入）
 *   @param {string[]}[opts.apiKeys]  多个 key；若传入则内部轮询挑一个
 *   @param {string}  opts.baseUrl
 *   @param {string}  opts.model      mimo-v2.5-tts | mimo-v2.5-tts-voicedesign | mimo-v2.5-tts-voiceclone
 *   @param {string}  [opts.voice]    预置音色名 / 克隆 data URL / 自定义字符串
 *   @param {string}  [opts.prompt]   user 指令（风格 / voicedesign 音色描述）
 *   @param {string}  opts.format     wav | mp3 | pcm16
 *   @param {string}  [opts.stylePrefix]  例如 "(开心)"；非空时自动前置到 text
 *   @param {number}  [opts.timeout]  请求超时 ms
 *   @param {AbortSignal} [opts.signal]
 * @returns {Promise<{blob: Blob, mime: string, format: string}>}
 */
export async function requestNimoTTS(text, opts = {}) {
    const {
        apiKey, apiKeys,
        baseUrl,
        model = 'mimo-v2.5-tts',
        voice,
        prompt = '',
        format = 'wav',
        stylePrefix = '',
        timeout = DEFAULT_TIMEOUT_MS,
        retryCount = DEFAULT_REQUEST_RETRY_COUNT,
        signal,
        onRateLimitEvent,
    } = opts;

    if (!text || !String(text).trim()) throw new NimoError('Nimo: 文本为空');

    // 校验模型与 voice 字段的匹配关系
    if (model === 'mimo-v2.5-tts' && !voice) {
        throw new NimoError('Nimo: 预置音色模型需要指定 voice');
    }
    if (model === 'mimo-v2.5-tts-voiceclone' && !(voice && String(voice).startsWith('data:'))) {
        throw new NimoError('Nimo: 音色复刻模型需要 voice = data:audio/...;base64,...');
    }
    if (model === 'mimo-v2.5-tts-voicedesign' && !String(prompt || '').trim()) {
        throw new NimoError('Nimo: voicedesign 模型需要 prompt（音色描述）');
    }

    const keys = (Array.isArray(apiKeys) && apiKeys.length)
        ? apiKeys
        : (apiKey ? [apiKey] : []);
    if (!keys.length) throw new NimoError('Nimo: 未配置 API Key');

    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const finalText = String(text);
    const userMessage = buildUserMessage(prompt, stylePrefix);

    const audio = { format };
    if (model !== 'mimo-v2.5-tts-voicedesign' && voice) {
        audio.voice = voice;
    }

    const messages = [];
    if (userMessage) {
        messages.push({ role: 'user', content: userMessage });
    }
    messages.push({ role: 'assistant', content: finalText });

    const body = {
        model,
        messages,
        audio,
    };

    for (let requestAttempt = 0; requestAttempt <= retryCount; requestAttempt++) {
        try {
            let resp;
            const maxRateLimitRetries = Math.max(DEFAULT_RATE_LIMIT_RETRY_COUNT, keys.length - 1);
            let rateLimitRetries = 0;
            while (true) {
                let key = pickKey(keys);
                if (!key) {
                    const waitMs = Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, getEarliestKeyReadyAt(keys) - Date.now()));
                    if (typeof onRateLimitEvent === 'function') {
                        try { onRateLimitEvent({ phase: 'wait', waitMs, source: 'all-keys' }); } catch (_) {}
                    }
                    await sleep(waitMs, signal);
                    if (typeof onRateLimitEvent === 'function') {
                        try { onRateLimitEvent({ phase: 'resume', source: 'all-keys' }); } catch (_) {}
                    }
                    key = pickKey(keys);
                    if (!key) continue;
                }

                await acquireKeyRateSlot(key, signal, onRateLimitEvent);

                for (let attempt = 0; attempt <= TIMEOUT_RETRY_COUNT; attempt++) {
                    const ctrl = new AbortController();
                    const tm = setTimeout(() => ctrl.abort(), timeout);
                    if (signal) {
                        try { signal.addEventListener('abort', () => ctrl.abort(), { once: true }); } catch (_) {}
                    }
                    try {
                        resp = await fetch(url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'api-key': key,
                                'Authorization': `Bearer ${key}`,
                            },
                            body: JSON.stringify(body),
                            signal: ctrl.signal,
                        });
                        clearTimeout(tm);
                        break;
                    } catch (e) {
                        clearTimeout(tm);
                        const isTimeout = e?.name === 'AbortError';
                        if (!isTimeout || attempt >= TIMEOUT_RETRY_COUNT) {
                            throw new NimoError(
                                isTimeout ? `请求超时 (${timeout / 1000}s)` : `网络错误: ${e?.message || e}`,
                                isTimeout ? 408 : null,
                            );
                        }
                    }
                }

                if (resp?.status !== 429) break;

                const errText = await resp.text().catch(() => '');
                const waitMs = parseRetryAfterMs(resp.headers.get('retry-after'));
                markKeyRateLimited(key, waitMs);
                rateLimitRetries += 1;
                if (rateLimitRetries > maxRateLimitRetries) {
                    throw new NimoError(`HTTP 429: ${(errText || 'Too many requests').slice(0, 300)}`, 429, errText);
                }
                if (!hasAvailableKey(keys)) {
                    const actualWaitMs = Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, getEarliestKeyReadyAt(keys) - Date.now()));
                    if (typeof onRateLimitEvent === 'function') {
                        try { onRateLimitEvent({ phase: 'wait', waitMs: actualWaitMs, source: key }); } catch (_) {}
                    }
                    await sleep(actualWaitMs, signal);
                    if (typeof onRateLimitEvent === 'function') {
                        try { onRateLimitEvent({ phase: 'resume', source: key }); } catch (_) {}
                    }
                }
            }

            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                throw new NimoError(`HTTP ${resp.status}: ${errText.slice(0, 300)}`, resp.status, errText);
            }

            let data;
            try { data = await resp.json(); }
            catch (e) { throw new NimoError(`非 JSON 响应: ${e?.message || e}`); }

            const contentFilterMessage = extractContentFilterMessage(data);
            if (contentFilterMessage) {
                throw new NimoError(`Nimo 请求被内容过滤拦截: ${contentFilterMessage.slice(0, 300)}`, 400, JSON.stringify(data).slice(0, 300));
            }

            const audioObj = data?.choices?.[0]?.message?.audio;
            if (!audioObj?.data) {
                throw new NimoError('Nimo 返回中未找到音频数据: ' + JSON.stringify(data).slice(0, 300));
            }

            const bytes = b64ToBytes(audioObj.data);
            let blob, mime;
            if (format === 'pcm16') {
                blob = pcm16ToWavBlob(bytes, 24000);
                mime = 'audio/wav';
            } else if (format === 'mp3') {
                blob = new Blob([bytes], { type: 'audio/mpeg' });
                mime = 'audio/mpeg';
            } else {
                blob = new Blob([bytes], { type: 'audio/wav' });
                mime = 'audio/wav';
            }
            return { blob, mime, format };
        } catch (error) {
            const canRetry = requestAttempt < retryCount && shouldRetryNimoError(error);
            if (!canRetry) throw error;
            console.warn(`[Nimo TTS] request retry ${requestAttempt + 1}/${retryCount}:`, error);
        }
    }
}

/**
 * 简易连通性检测：发一条极短文本，预期能拿到音频。
 */
export async function pingNimo({ apiKey, apiKeys, baseUrl } = {}) {
    const { blob } = await requestNimoTTS('你好', {
        apiKey, apiKeys, baseUrl,
        model: 'mimo-v2.5-tts',
        voice: 'mimo_default',
        format: 'wav',
        timeout: 15000,
    });
    return { ok: true, bytes: blob.size };
}

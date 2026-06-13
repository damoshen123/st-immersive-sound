// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  MiniMax T2A v2 客户端（浏览器版）
//  翻译自 minimax语音接口.html:
//    - 按 platform 走 io / cn 直连
//    - Authorization: Bearer <apiKey>
//    - 5xx + 网络错误自动 backoff 重试
//    - data.base_resp.status_code !== 0 抛 MinimaxError
// ═══════════════════════════════════════════════════════════

const RETRY_STATUS = new Set([502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRY = 1;
const DEFAULT_BACKOFF_MS = 1500;

const DIRECT_MAP = {
    io: 'https://api.minimax.io/v1',
    cn: 'https://api.minimaxi.com/v1',
};

// ── 异常 ────────────────────────────────────────────────

export class MinimaxError extends Error {
    constructor(message, status = null, detail = null) {
        super(message);
        this.name = 'MinimaxError';
        this.status = status;
        this.detail = detail;
    }
}

// ── Key 池 / 速率限制 ────────────────────────────────────
// 服务端限速：每个 API Key 每分钟 10 次（RPM）。
// 模块级共享：所有 MinimaxClient 实例共用同一个池，跨设置页 / 调度器统一计数。

const RPM_LIMIT = 10;
const RPM_WINDOW_MS = 60_000;

/** key -> 最近 60s 内的请求时间戳数组（升序） */
const _keyHistory = new Map();

function _prune(key, now) {
    let arr = _keyHistory.get(key);
    if (!arr) { arr = []; _keyHistory.set(key, arr); }
    const cutoff = now - RPM_WINDOW_MS;
    while (arr.length && arr[0] <= cutoff) arr.shift();
    return arr;
}

function _record(key, ts) {
    const arr = _prune(key, ts);
    arr.push(ts);
}

/**
 * 撤回一次刚刚 _record 的预占（请求最终失败、非服务端限流时使用），
 * 避免本地池把失败的请求也算进 RPM 名额。
 * 找不到完全匹配的时间戳时，退化为弹出最后一个（容忍 _prune 截断）。
 */
function _releaseRecord(key, ts) {
    const arr = _keyHistory.get(key);
    if (!arr || !arr.length) return;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] === ts) { arr.splice(i, 1); return; }
    }
    arr.pop();
}

/**
 * 把某个 key 标记为已被服务端限流：把窗口塞满 RPM_LIMIT 个时间戳，
 * 让池在 ~60s 内不再选它。
 */
function _markRateLimited(key) {
    const now = Date.now();
    const arr = [];
    for (let i = 0; i < RPM_LIMIT; i++) arr.push(now);
    _keyHistory.set(key, arr);
}

/**
 * 解析多行 API Key 文本为去重数组
 * @param {string|string[]} input
 */
export function parseApiKeys(input) {
    if (Array.isArray(input)) {
        return [...new Set(input.map(s => String(s || '').trim()).filter(Boolean))];
    }
    return [...new Set(
        String(input || '')
            .split(/\r?\n|,/)
            .map(s => s.trim())
            .filter(Boolean),
    )];
}

/**
 * 从一组 key 中挑一个未触发 RPM 上限的 key；如全部到顶则等待。
 * 选择策略：当前窗口内调用次数最少者（均衡负载）。
 *
 * @param {string[]} keys
 * @param {number} [maxWaitMs=120000]  等待上限，避免无限阻塞
 * @returns {Promise<{key:string, ts:number}>}
 */
async function _acquireKey(keys, maxWaitMs = 120_000, onEvent = null) {
    const deadline = Date.now() + maxWaitMs;
    let waited = false;
    while (true) {
        const now = Date.now();
        let bestKey = null;
        let bestCount = Infinity;
        let earliestFreeAt = Infinity;
        for (const k of keys) {
            const arr = _prune(k, now);
            if (arr.length < RPM_LIMIT) {
                if (arr.length < bestCount) {
                    bestCount = arr.length;
                    bestKey = k;
                }
            } else {
                earliestFreeAt = Math.min(earliestFreeAt, arr[0] + RPM_WINDOW_MS);
            }
        }
        if (bestKey) {
            // 同步预占（在下一个 await 之前），避免并发拿到同一个 key
            _record(bestKey, now);
            if (waited && typeof onEvent === 'function') {
                try { onEvent({ phase: 'resume' }); } catch (_) {}
            }
            return { key: bestKey, ts: now };
        }
        if (now >= deadline) {
            throw new MinimaxError('MiniMax: 所有 API Key 均已达到 RPM 上限（10 次/分钟），请稍后再试或添加更多 Key');
        }
        const wait = Math.max(200, Math.min(earliestFreeAt - now + 100, 5_000));
        const totalWaitMs = Math.max(wait, earliestFreeAt - now);
        try { console.warn(`[MiniMax] 全部 ${keys.length} 个 Key 已达 RPM 上限，等待 ${wait}ms 后重试...`); } catch (_) {}
        if (typeof onEvent === 'function') {
            try {
                onEvent({
                    phase: 'wait',
                    waitMs: totalWaitMs,
                    totalKeys: keys.length,
                });
            } catch (_) {}
        }
        waited = true;
        await new Promise(r => setTimeout(r, wait));
    }
}

/**
 * 调试 / UI 展示：返回每个 key 当前 60s 窗口内已用次数
 * @param {string[]} keys
 */
export function getKeyPoolStats(keys) {
    const now = Date.now();
    return keys.map(k => ({
        key: k,
        used: _prune(k, now).length,
        limit: RPM_LIMIT,
    }));
}

// ── 客户端类 ─────────────────────────────────────────────

export class MinimaxClient {
    /**
     * @param {object} opts
     * @param {string|string[]} [opts.apiKey]   MiniMax API Key；可传单个或多行字符串（\n / 逗号分隔）
     * @param {string[]}        [opts.apiKeys]  也可直接传数组
     * @param {string} [opts.platform]     'io' | 'cn'，默认 'cn'
     * @param {number} [opts.timeout]
     * @param {number} [opts.retry]
     * @param {number} [opts.retryBackoff]
     */
    constructor({
        apiKey = '',
        apiKeys = null,
        platform = 'cn',
        timeout = DEFAULT_TIMEOUT_MS,
        retry = DEFAULT_RETRY,
        retryBackoff = DEFAULT_BACKOFF_MS,
        onPoolEvent = null,
    } = {}) {
        const keys = parseApiKeys(
            Array.isArray(apiKeys) && apiKeys.length ? apiKeys : apiKey,
        );
        if (!keys.length) throw new MinimaxError('未配置 API Key');
        if (!DIRECT_MAP[platform]) {
            throw new MinimaxError(`未知 platform: ${platform}（应为 'io' 或 'cn'）`);
        }
        this.apiKeys = keys;
        this.apiKey = keys[0];   // 兼容字段（仅用于展示/日志）
        this.platform = platform;
        this.timeout = timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
        this.retry = Math.max(0, retry | 0);
        this.retryBackoff = retryBackoff > 0 ? retryBackoff : DEFAULT_BACKOFF_MS;
        this.onPoolEvent = typeof onPoolEvent === 'function' ? onPoolEvent : null;
    }

    /** 当前 key 池状态（调试 / UI 展示用） */
    getKeyStats() { return getKeyPoolStats(this.apiKeys); }

    getBaseUrl() {
        return DIRECT_MAP[this.platform];
    }

    getEndpoint(path) {
        const p = path.startsWith('/') ? path : '/' + path;
        return this.getBaseUrl() + p;
    }

    // ── 内部:带重试 fetch ────────────────────────────
    async _fetchWithRetry(url, init) {
        let lastErr = null;
        for (let attempt = 0; attempt <= this.retry; attempt++) {
            const ctrl = new AbortController();
            const tm = setTimeout(() => ctrl.abort(), this.timeout);
            try {
                const resp = await fetch(url, { ...init, signal: ctrl.signal });
                clearTimeout(tm);
                if (RETRY_STATUS.has(resp.status) && attempt < this.retry) {
                    const text = await resp.text().catch(() => '');
                    lastErr = new MinimaxError(
                        `${resp.status} 重试 ${attempt + 1}/${this.retry}`,
                        resp.status, text,
                    );
                    await this._sleep(this.retryBackoff * (attempt + 1));
                    continue;
                }
                return resp;
            } catch (e) {
                clearTimeout(tm);
                lastErr = e instanceof MinimaxError ? e
                    : new MinimaxError(`网络错误: ${e?.message || e}`);
                if (attempt >= this.retry) throw lastErr;
                await this._sleep(this.retryBackoff * (attempt + 1));
            }
        }
        throw lastErr || new MinimaxError('未知错误');
    }

    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    async _downloadWithRetry(audioUrl) {
        let lastErr = null;
        for (let attempt = 0; attempt <= this.retry; attempt++) {
            const ctrl = new AbortController();
            const tm = setTimeout(() => ctrl.abort(), this.timeout);
            try {
                const resp = await fetch(audioUrl, { signal: ctrl.signal });
                clearTimeout(tm);
                if (!resp.ok) {
                    throw new MinimaxError(`下载音频失败: HTTP ${resp.status}`, resp.status);
                }
                return await resp.blob();
            } catch (e) {
                clearTimeout(tm);
                const isTimeout = e?.name === 'AbortError';
                lastErr = e instanceof MinimaxError
                    ? e
                    : new MinimaxError(isTimeout ? `下载音频超时 (${this.timeout / 1000}s)` : `下载音频失败: ${e?.message || e}`);
                if (!isTimeout || attempt >= this.retry) throw lastErr;
            }
        }
        throw lastErr || new MinimaxError('下载音频失败');
    }

    async _post(path, body) {
        const url = this.getEndpoint(path);
        // 最多按池大小再多 1 轮容错（防止偶发 1002 后立刻轮空）
        const maxKeyAttempts = this.apiKeys.length + 1;
        let lastErr = null;

        for (let attempt = 0; attempt < maxKeyAttempts; attempt++) {
            const { key, ts } = await _acquireKey(this.apiKeys, 120_000, this.onPoolEvent);
            const keyTag = key.slice(0, 6) + '…' + key.slice(-4);
            let consumed = false; // 是否真正消耗了一次服务端 RPM 名额

            try {
                const resp = await this._fetchWithRetry(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });
                const text = await resp.text();
                if (!resp.ok) {
                    throw new MinimaxError(
                        `HTTP ${resp.status}: ${text.slice(0, 300)}`,
                        resp.status, text,
                    );
                }
                let data;
                try { data = JSON.parse(text); }
                catch (e) {
                    throw new MinimaxError(`非 JSON 响应 (${resp.status}): ${text.slice(0, 200)}`, resp.status, text);
                }
                const code = data?.base_resp?.status_code;

                // 命中服务端 RPM 限流 → 把这个 key 标记为窗口已满，换下一个 key
                if (code === 1002) {
                    _markRateLimited(key);
                    consumed = true; // 服务端确实计了这次
                    lastErr = new MinimaxError(
                        `MiniMax RPM 限流: ${data?.base_resp?.status_msg || ''}`,
                        code, data,
                    );
                    try { console.warn(`[MiniMax] key=${keyTag} 命中 RPM 限流，切换下一个 key（attempt ${attempt + 1}/${maxKeyAttempts}）`); } catch (_) {}
                    continue;
                }

                if (code !== undefined && code !== 0) {
                    // 业务错误：服务端已收到并计数
                    consumed = true;
                    throw new MinimaxError(
                        `MiniMax 错误 ${code}: ${data?.base_resp?.status_msg || ''}`,
                        code, data,
                    );
                }
                consumed = true;
                return data;
            } finally {
                // 请求未真正抵达服务端（网络错误 / 超时 / HTTP 非 2xx / 非 JSON）
                // → 撤回本地预占，避免本地池白白扣掉一格
                if (!consumed) _releaseRecord(key, ts);
            }
        }
        throw lastErr || new MinimaxError('MiniMax: 所有 API Key 均被限流');
    }

    // ── 业务接口 ─────────────────────────────────────

    /**
     * T2A v2 — 文本合成语音
     *
     * @param {object} opts
     * @param {string} opts.text
     * @param {string} opts.voiceId
     * @param {string} [opts.model='speech-2.8-hd']
     * @param {number} [opts.speed=1.0]      0.5–2.0
     * @param {number} [opts.vol=1.0]        0.1–10.0
     * @param {number} [opts.pitch=0]        -12–12
     * @param {string} [opts.emotion]        '' | 'happy' | 'sad' | 'angry' | ...
     * @param {string} [opts.languageBoost='auto']
     * @param {string} [opts.format='mp3']   'mp3' | 'wav' | 'flac'
     * @param {number} [opts.sampleRate=32000]
     * @param {number} [opts.bitrate=128000] 仅 mp3 生效
     * @param {number} [opts.channel=1]
     * @param {object} [opts.voiceModify]    {pitch?, intensity?, timbre?, sound_effects?}|null
     * @param {object} [opts.pronunciationDict] {tone:[...]}|null
     * @param {string} [opts.outputFormat='url'] 'url'|'hex'
     * @returns {Promise<{audioUrl:string|null, audioHex:string|null, audioLength:number, wordCount:number, traceId:string|null, raw:object}>}
     */
    async t2a({
        text,
        voiceId,
        model = 'speech-2.8-hd',
        speed = 1.0,
        vol = 1.0,
        pitch = 0,
        emotion = '',
        languageBoost = 'auto',
        format = 'mp3',
        sampleRate = 32000,
        bitrate = 128000,
        channel = 1,
        voiceModify = null,
        pronunciationDict = null,
        outputFormat = 'url',
    }) {
        if (!text || !String(text).trim()) {
            throw new MinimaxError('text 为空');
        }
        if (!voiceId) throw new MinimaxError('voiceId 为空');

        const voiceSetting = {
            voice_id: voiceId,
            speed: Number(speed),
            vol: Number(vol),
            pitch: Number(pitch),
        };
        if (emotion) voiceSetting.emotion = emotion;

        const audioSetting = {
            format,
            sample_rate: Number(sampleRate),
            channel: Number(channel),
        };
        if (format === 'mp3') audioSetting.bitrate = Number(bitrate);

        const body = {
            model,
            text: String(text),
            stream: false,
            voice_setting: voiceSetting,
            audio_setting: audioSetting,
            language_boost: languageBoost || 'auto',
            output_format: outputFormat,
        };
        if (voiceModify && typeof voiceModify === 'object'
            && Object.keys(voiceModify).length > 0) {
            body.voice_modify = voiceModify;
        }
        if (pronunciationDict && typeof pronunciationDict === 'object'
            && Array.isArray(pronunciationDict.tone)
            && pronunciationDict.tone.length > 0) {
            body.pronunciation_dict = pronunciationDict;
        }

        const data = await this._post('/t2a_v2', body);
        const audio = data?.data?.audio || null;
        const ext = data?.extra_info || {};
        const isHex = audio && /^[0-9a-fA-F]+$/.test(audio) && audio.length > 200;

        return {
            audioUrl: outputFormat === 'url' && audio && !isHex ? audio : null,
            audioHex: isHex ? audio : null,
            audioLength: ext.audio_length || 0,
            wordCount: ext.word_count || 0,
            traceId: data?.trace_id || null,
            raw: data,
        };
    }

    /**
     * 拉取音色列表
     * @param {'all'|'system'|'voice_cloning'|'voice_generation'} voiceType
     */
    async getVoiceList(voiceType = 'all') {
        const data = await this._post('/get_voice', { voice_type: voiceType });
        return {
            system_voice: data.system_voice || [],
            voice_cloning: data.voice_cloning || [],
            voice_generation: data.voice_generation || [],
            raw: data,
        };
    }

    /**
     * 删除音色（仅 voice_cloning / voice_generation）
     */
    async deleteVoice(voiceId, voiceType = 'voice_cloning') {
        return this._post('/delete_voice', {
            voice_id: voiceId,
            voice_type: voiceType,
        });
    }

    /**
     * 健康检查 — 用 /get_voice voice_type=system 做轻量探针
     */
    async health() {
        const start = Date.now();
        try {
            const data = await this._post('/get_voice', { voice_type: 'system' });
            return {
                ok: true,
                latencyMs: Date.now() - start,
                count: (data?.system_voice || []).length,
            };
        } catch (e) {
            return {
                ok: false,
                latencyMs: Date.now() - start,
                error: e?.message || String(e),
                status: e?.status ?? null,
            };
        }
    }

    /**
     * 音乐生成
     */
    async musicGenerate(body) {
        return this._post('/music_generation', body);
    }

    /**
     * 翻唱预处理
     */
    async musicCoverPreprocess(body) {
        return this._post('/music_cover_preprocess', body);
    }

    /**
     * 下载音频 url 为 Blob（直接 fetch；如有跨域问题由调用方处理）
     */
    async download(audioUrl) {
        return this._downloadWithRetry(audioUrl);
    }
}

// ── 函数式入口 ──────────────────────────────────────────

export async function pingMinimax({ apiKey, apiKeys, platform } = {}) {
    const cli = new MinimaxClient({ apiKey, apiKeys, platform, retry: 0, timeout: 15000 });
    return cli.health();
}

/**
 * 把 hex 字符串转 Blob
 */
export function hexToBlob(hex, mime = 'audio/mp3') {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(x => parseInt(x, 16)));
    return new Blob([bytes], { type: mime });
}

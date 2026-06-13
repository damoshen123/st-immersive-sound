// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  Edge TTS 引擎模块（移植自 st-chatu8）
//  通过公开代理调用 Microsoft Edge 在线 TTS，无需 API 密钥
//  对外接口：
//    - EDGE_VOICES / EDGE_STYLE_MAP / EDGE_PROXY_SERVERS
//    - pingEdgeServers(force)   并发探测代理可用性
//    - getAvailableServers()    同步读取当前可用列表
//    - requestEdgeTTS(text, opts)  返回 { blobUrl }
//    - loadEdgePingFromSettings() / saveEdgePingToSettings()
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { extensionName } from './config.js';

const TIMEOUT_MS = 15000;
const TIMEOUT_RETRY_COUNT = 1;
const PING_TIMEOUT = 5000;    // ping 5s

// ── 代理服务器池（可改） ──────────────────────────────────
export const EDGE_PROXY_SERVERS = [
    // —— HTTPS 服务器（避免 mixed-content 问题，优先） ——
    { name: 'SkyBook (HTTPS)', url: 'https://skybook.qzz.io/tts' },
    // —— 原 7 个（已按 JSON 资料修正名称） ——
    { name: '中国', url: 'http://t.leftsite.cn/tts' },
    { name: '中国杭州', url: 'http://60.205.243.148:8080/tts' },
    { name: '德国法兰克福', url: 'http://5.45.99.149:8075/tts' },
    { name: '韩国首尔', url: 'http://193.122.107.44:9090/tts' },
    { name: '美国德克萨斯州', url: 'http://104.214.168.83:8080/tts' },
    { name: '美国纽约', url: 'http://74.48.40.244:8010/tts' },
    { name: '美国加利福尼亚州', url: 'http://47.79.92.215:18080/tts' },
    // —— 自动情绪版新增 9 个 ——
    { name: '中国湖北', url: 'http://171.113.113.119:8085/tts' },
    { name: '中国江苏', url: 'http://47.119.125.172:8080/tts' },
    { name: '中国广东', url: 'http://36.248.181.23:22335/tts' },
    { name: '中国上海', url: 'http://124.71.164.73:8085/tts' },
    { name: '美国洛杉矶', url: 'http://64.112.42.45:9080/tts' },
    { name: '荷兰阿姆斯特丹', url: 'http://146.56.188.115:8080/tts' },
    { name: '日本东京', url: 'http://180.114.35.250:1080/tts' },
    { name: '巴西圣保罗', url: 'http://190.92.218.92:8080/tts' },
];

// ── 风格 ID → 中文名映射 ──────────────────────────────────
export const EDGE_STYLE_MAP = {
    'general': '通用',
    'assistant': '助手',
    'chat': '闲聊',
    'customerservice': '客服',
    'newscast': '新闻播报',
    'affectionate': '亲切',
    'angry': '愤怒',
    'calm': '平静',
    'cheerful': '开朗',
    'disgruntled': '不满',
    'fearful': '恐惧',
    'gentle': '温柔',
    'lyrical': '抒情',
    'sad': '悲伤',
    'serious': '严肃',
    'poetry-reading': '诗歌朗诵',
    'livecommercial': '直播带货',
    'embarrassed': '尴尬',
    'depressed': '低落',
    'envious': '嫉妒',
    'narration-relaxed': '旁白-轻松',
    'sports-commentary': '体育解说',
    'sports-commentary-excited': '体育解说-激动',
    'narration-professional': '旁白-专业',
    'newscast-casual': '新闻-随意',
    'newscast-formal': '新闻-正式',
    'advertisement-upbeat': '广告-欢快',
    'documentary-narration': '纪录片旁白',
    'excited': '兴奋',
    'friendly': '友好',
    'terrified': '惊恐',
    'shouting': '喊叫',
    'unfriendly': '冷淡',
    'whispering': '耳语',
    'hopeful': '期待',
    'empathetic': '共情',
};

// ── 可用音色列表 ──────────────────────────────────────────
export const EDGE_VOICES = [
    // 中文（普通话）- 女声
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', lang: '中文', gender: 'Female', styles: ['general', 'assistant', 'chat', 'customerservice', 'newscast', 'affectionate', 'angry', 'calm', 'cheerful', 'disgruntled', 'fearful', 'gentle', 'lyrical', 'sad', 'serious', 'poetry-reading'] },
    { id: 'zh-CN-XiaoyiNeural', name: '晓伊', lang: '中文', gender: 'Female', styles: ['general', 'angry', 'disgruntled', 'affectionate', 'cheerful', 'fearful', 'gentle', 'sad', 'serious'] },
    { id: 'zh-CN-XiaochenNeural', name: '晓辰', lang: '中文', gender: 'Female', styles: ['general', 'livecommercial'] },
    { id: 'zh-CN-XiaohanNeural', name: '晓涵', lang: '中文', gender: 'Female', styles: ['general', 'calm', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad', 'gentle', 'affectionate', 'embarrassed'] },
    { id: 'zh-CN-XiaomengNeural', name: '晓梦', lang: '中文', gender: 'Female', styles: ['general', 'chat'] },
    { id: 'zh-CN-XiaomoNeural', name: '晓墨', lang: '中文', gender: 'Female', styles: ['general', 'embarrassed', 'calm', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad', 'depressed', 'affectionate', 'gentle', 'envious'] },
    { id: 'zh-CN-XiaoqiuNeural', name: '晓秋', lang: '中文', gender: 'Female', styles: ['general'] },
    { id: 'zh-CN-XiaoruiNeural', name: '晓睿', lang: '中文', gender: 'Female', styles: ['general', 'calm', 'fearful', 'angry', 'sad'] },
    { id: 'zh-CN-XiaoshuangNeural', name: '晓双（儿童）', lang: '中文', gender: 'Female', styles: ['general', 'chat'] },
    { id: 'zh-CN-XiaoxuanNeural', name: '晓萱', lang: '中文', gender: 'Female', styles: ['general', 'calm', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'gentle', 'depressed'] },
    { id: 'zh-CN-XiaoyanNeural', name: '晓颜', lang: '中文', gender: 'Female', styles: ['general'] },
    { id: 'zh-CN-XiaozhenNeural', name: '晓甄', lang: '中文', gender: 'Female', styles: ['general', 'angry', 'disgruntled', 'cheerful', 'fearful', 'sad', 'serious'] },
    // 中文（普通话）- 男声
    { id: 'zh-CN-YunxiNeural', name: '云希', lang: '中文', gender: 'Male', styles: ['general', 'narration-relaxed', 'embarrassed', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad', 'depressed', 'chat', 'assistant', 'newscast'] },
    { id: 'zh-CN-YunjianNeural', name: '云健', lang: '中文', gender: 'Male', styles: ['general', 'narration-relaxed', 'sports-commentary', 'sports-commentary-excited'] },
    { id: 'zh-CN-YunyangNeural', name: '云扬', lang: '中文', gender: 'Male', styles: ['general', 'customerservice', 'narration-professional', 'newscast-casual'] },
    { id: 'zh-CN-YunyeNeural', name: '云野', lang: '中文', gender: 'Male', styles: ['general', 'embarrassed', 'calm', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad'] },
    { id: 'zh-CN-YunzeNeural', name: '云泽', lang: '中文', gender: 'Male', styles: ['general', 'calm', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad', 'depressed', 'documentary-narration'] },
    { id: 'zh-CN-YunhaoNeural', name: '云皓', lang: '中文', gender: 'Male', styles: ['general', 'advertisement-upbeat'] },
    { id: 'zh-CN-YunfengNeural', name: '云枫', lang: '中文', gender: 'Male', styles: ['general', 'angry', 'disgruntled', 'cheerful', 'fearful', 'sad', 'serious'] },
    { id: 'zh-CN-YunxiaNeural', name: '云夏（儿童）', lang: '中文', gender: 'Male', styles: ['general'] },
    // 中文（台湾）
    { id: 'zh-TW-HsiaoChenNeural', name: '曉臻', lang: '台湾', gender: 'Female', styles: ['general'] },
    { id: 'zh-TW-YunJheNeural', name: '雲哲', lang: '台湾', gender: 'Male', styles: ['general'] },
    { id: 'zh-TW-HsiaoYuNeural', name: '曉雨', lang: '台湾', gender: 'Female', styles: ['general'] },
    // 粤语
    { id: 'zh-HK-HiuGaaiNeural', name: '曉佳', lang: '粤语', gender: 'Female', styles: ['general'] },
    { id: 'zh-HK-WanLungNeural', name: '雲龍', lang: '粤语', gender: 'Male', styles: ['general'] },
    { id: 'zh-HK-HiuMaanNeural', name: '曉曼', lang: '粤语', gender: 'Female', styles: ['general'] },
    // 英语
    { id: 'en-US-JennyNeural', name: 'Jenny', lang: '英语', gender: 'Female', styles: ['general', 'assistant', 'chat', 'customerservice', 'newscast', 'angry', 'cheerful', 'sad', 'excited', 'friendly', 'terrified', 'shouting', 'unfriendly', 'whispering', 'hopeful'] },
    { id: 'en-US-GuyNeural', name: 'Guy', lang: '英语', gender: 'Male', styles: ['general', 'newscast', 'angry', 'cheerful', 'sad', 'excited', 'friendly', 'terrified', 'shouting', 'unfriendly', 'whispering', 'hopeful'] },
    { id: 'en-US-AriaNeural', name: 'Aria', lang: '英语', gender: 'Female', styles: ['general', 'chat', 'customerservice', 'narration-professional', 'newscast-casual', 'newscast-formal', 'cheerful', 'empathetic', 'angry', 'sad', 'excited', 'friendly', 'terrified', 'shouting', 'unfriendly', 'whispering', 'hopeful'] },
    // 日语
    { id: 'ja-JP-NanamiNeural', name: '七海', lang: '日语', gender: 'Female', styles: ['general', 'chat', 'customerservice', 'cheerful'] },
    { id: 'ja-JP-KeitaNeural', name: '圭太', lang: '日语', gender: 'Male', styles: ['general'] },
    // 韩语
    { id: 'ko-KR-SunHiNeural', name: 'SunHi', lang: '韩语', gender: 'Female', styles: ['general', 'cheerful'] },
    { id: 'ko-KR-InJoonNeural', name: 'InJoon', lang: '韩语', gender: 'Male', styles: ['general'] },
];

// ── 内部状态 ──────────────────────────────────────────────
let availableServers = [];
let serverIndex = 0;
let pingInProgress = false;
let pingPromise = null;
let lastPingResult = null;
let lastPingTime = 0;

const log = (...args) => console.log('[ST-IS Edge TTS]', ...args);

// ── 持久化 ────────────────────────────────────────────────

export function saveEdgePingToSettings() {
    if (!extension_settings[extensionName]) return;
    if (!extension_settings[extensionName].edge_tts) extension_settings[extensionName].edge_tts = {};
    extension_settings[extensionName].edge_tts.pingCache = {
        servers: availableServers.map(s => ({ name: s.name, url: s.url, latency: s.latency })),
        pingResult: lastPingResult,
        pingTime: lastPingTime,
    };
    saveSettingsDebounced();
    log('💾 ping 结果已持久化');
}

/**
 * 启动时调用：从 settings 恢复上次的 ping 缓存
 * @returns {boolean} 是否恢复成功
 */
export function loadEdgePingFromSettings() {
    const cache = extension_settings[extensionName]?.edge_tts?.pingCache;
    if (!cache || !cache.servers || !cache.pingTime) return false;
    availableServers = cache.servers.map(s => ({ ...s }));
    serverIndex = 0;
    lastPingResult = cache.pingResult;
    lastPingTime = cache.pingTime;
    const ageMin = Math.round((Date.now() - cache.pingTime) / 60000);
    log(`📂 已加载 ping 缓存: ${availableServers.length} 个服务器 (${ageMin} 分钟前)`);
    return true;
}

// ── ping 服务器 ───────────────────────────────────────────

/**
 * 并发探测所有代理服务器，返回按延迟升序的可用列表
 * @param {boolean} force 强制重新探测（忽略缓存）
 */
export async function pingEdgeServers(force = false) {
    if (pingInProgress && pingPromise) {
        log('⏳ 已有 ping 进行中，等待...');
        return pingPromise;
    }
    if (!force && availableServers.length > 0) {
        log(`⚡ 使用缓存 (${availableServers.length} 个)`);
        return availableServers;
    }

    pingInProgress = true;
    log('🔍 开始探测代理服务器...');

    pingPromise = (async () => {
        try {
            const results = await Promise.allSettled(
                EDGE_PROXY_SERVERS.map(async (server) => {
                    const start = Date.now();
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
                    try {
                        const testUrl = `${server.url}?t=test&v=zh-CN-XiaoxiaoNeural&r=0&p=0&vol=100`;
                        const resp = await fetch(testUrl, {
                            signal: controller.signal,
                            headers: { 'User-Agent': 'TTS-Client/1.0', 'Accept': 'audio/*' },
                        });
                        clearTimeout(timer);
                        if (resp.ok) {
                            const latency = Date.now() - start;
                            log(`  ✅ ${server.name} (${latency}ms)`);
                            return { name: server.name, url: server.url, latency };
                        }
                        throw new Error(`HTTP ${resp.status}`);
                    } catch (e) {
                        clearTimeout(timer);
                        const latency = Date.now() - start;
                        log(`  ❌ ${server.name} (${latency}ms) - ${e.name === 'AbortError' ? '超时' : e.message}`);
                        throw e;
                    }
                })
            );

            availableServers = results
                .filter(r => r.status === 'fulfilled')
                .map(r => r.value)
                .sort((a, b) => a.latency - b.latency);

            serverIndex = 0;
            lastPingTime = Date.now();
            lastPingResult = {
                timestamp: lastPingTime,
                available: availableServers.map(s => ({ name: s.name, latency: s.latency })),
                failed: results
                    .map((r, i) => r.status === 'rejected' ? EDGE_PROXY_SERVERS[i].name : null)
                    .filter(Boolean),
            };

            log(`🔍 完成: ${availableServers.length}/${EDGE_PROXY_SERVERS.length} 可用`);
            saveEdgePingToSettings();
            return availableServers;
        } finally {
            pingInProgress = false;
            pingPromise = null;
        }
    })();

    return pingPromise;
}

export function getAvailableServers() {
    return availableServers.slice();
}

export function getLastPingResult() {
    return lastPingResult;
}

function getNextServer() {
    if (availableServers.length === 0) return null;
    const s = availableServers[serverIndex % availableServers.length];
    serverIndex++;
    return s;
}

function markServerFailed(server) {
    const idx = availableServers.findIndex(s => s.url === server.url);
    if (idx >= 0) {
        availableServers.splice(idx, 1);
        log(`🚫 摘除失败服务器 ${server.name}, 剩余 ${availableServers.length}`);
        saveEdgePingToSettings();
    }
}

// ── 音色查找 / 列表（供"人物 TTS"引擎使用） ───────────────

/**
 * 根据名字查找 Edge 音色，匹配优先级：
 *   1) 精确匹配 voice.id（不区分大小写）
 *   2) 精确匹配 voice.name（中文/英文显示名）
 *   3) 去除括号备注后匹配 voice.name（如 "晓双（儿童）" → "晓双"）
 * @param {string} name
 * @returns {{id:string,name:string,lang:string,gender:string,styles:string[]}|null}
 */
export function findEdgeVoiceByName(name) {
    if (!name) return null;
    const trimmed = String(name).trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    let v = EDGE_VOICES.find(x => x.id.toLowerCase() === lower);
    if (v) return v;
    v = EDGE_VOICES.find(x => x.name === trimmed);
    if (v) return v;
    // 去除括号备注后匹配
    v = EDGE_VOICES.find(x => x.name.replace(/[（(].*?[）)]/g, '').trim() === trimmed);
    return v || null;
}

/**
 * 返回供"人声列表"展示的扁平结构 [{name, description}]。
 * - name 用 voice.id（稳定唯一，便于后续解析回 Edge 配置）
 * - description 拼接语言/性别/中文名/支持风格，方便 LLM 选择
 */
export function listEdgeSpeakers() {
    return EDGE_VOICES.map(v => {
        const styles = (v.styles || []).map(s => EDGE_STYLE_MAP[s] || s).join('/');
        return {
            name: v.id,
            description: `${v.lang} · ${v.gender === 'Female' ? '女' : '男'} · ${v.name}${styles ? ` · 风格: ${styles}` : ''}`,
        };
    });
}

// ── 校验风格 ──────────────────────────────────────────────

/**
 * 校验风格 ID 是否在指定音色支持列表中
 * @returns {string|null} 有效风格 ID，无效则返回 null
 */
export function validateEdgeStyle(styleId, voiceId) {
    if (!styleId) return null;
    const voice = EDGE_VOICES.find(v => v.id === voiceId);
    if (!voice) return null;
    return voice.styles.includes(styleId) ? styleId : null;
}

// ── 核心请求 ──────────────────────────────────────────────

/**
 * 请求 Edge TTS 合成
 * @param {string} text
 * @param {object} opts {voice, style, rate, pitch, volume, timeoutMs, onServerSwitch}
 * @returns {Promise<{blobUrl: string, server: {name:string,url:string}}>}
 */
export async function requestEdgeTTS(text, opts = {}) {
    if (!text || !text.trim()) throw new Error('文本为空');
    // 跳过纯标点 / 纯符号 / 纯 emoji 等无可朗读内容（如 "！！"、"……"）
    if (!/[\p{L}\p{N}]/u.test(text)) {
        throw new Error(`Edge TTS: 跳过无可朗读字符的文本 "${text.slice(0, 20)}"`);
    }

    if (availableServers.length === 0) await pingEdgeServers();
    if (availableServers.length === 0) throw new Error('无可用 Edge TTS 代理服务器');

    const voice = opts.voice || 'zh-CN-XiaoxiaoNeural';
    const style = opts.style || 'general';
    const rate = opts.rate ?? 0;
    const pitch = opts.pitch ?? 0;
    // 用户输入 0~100 的"音量百分比"，移植自 chatu8：URL 参数需要 +50 偏置
    const volume = (opts.volume ?? 50) + 50;
    const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    const encodedText = encodeURIComponent(text);

    const tried = new Set();
    let lastError = null;

    async function fetchEdgeAudio(url, timeoutMs) {
        let lastError = null;
        for (let attempt = 0; attempt <= TIMEOUT_RETRY_COUNT; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const resp = await fetch(url, {
                    signal: controller.signal,
                    headers: { 'User-Agent': 'TTS-Client/1.0', 'Accept': 'audio/*' },
                });
                clearTimeout(timer);
                return resp;
            } catch (e) {
                clearTimeout(timer);
                const isTimeout = e?.name === 'AbortError';
                lastError = isTimeout
                    ? new Error(`请求超时 (${timeoutMs / 1000}s)`)
                    : e;
                if (!isTimeout || attempt >= TIMEOUT_RETRY_COUNT) {
                    throw lastError;
                }
                log(`⏱️ 请求超时，重试 ${attempt + 1}/${TIMEOUT_RETRY_COUNT}: ${url}`);
            }
        }
        throw lastError || new Error('请求失败');
    }

    while (true) {
        const server = getNextServer();
        if (!server || tried.has(server.url)) break;
        tried.add(server.url);

        if (typeof opts.onServerSwitch === 'function') {
            try { opts.onServerSwitch(server); } catch (_) { /* noop */ }
        }

        const url = `${server.url}?t=${encodedText}&v=${voice}&r=${rate}&p=${pitch}&s=${style}&vol=${volume}`;
        log(`🔊 请求 → ${server.name} "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}"`);

        try {
            const resp = await fetchEdgeAudio(url, timeoutMs);
            if (resp.ok) {
                const ct = resp.headers.get('Content-Type') || '';
                if (!ct || ct.includes('audio')) {
                    const blob = await resp.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    log(`✅ 成功 (${server.name})`);
                    return { blobUrl, blob, server };
                }
            }
            markServerFailed(server);
            lastError = new Error(`请求失败 - ${server.name}`);
            log(`⚠️ ${server.name} 失败: ${lastError.message}`);
            if (availableServers.length > 0) continue;
            break;
        } catch (e) {
            markServerFailed(server);
            lastError = e;
            log(`⚠️ ${server.name} 失败: ${lastError.message}`);
            if (availableServers.length > 0) continue;
            break;
        }
    }

    // 全部失败 → 强制重新 ping → 再尝试一次新的
    if (availableServers.length === 0 && tried.size > 0) {
        log('🔄 全部失败，重新探测...');
        await pingEdgeServers(true);
        if (availableServers.length > 0) {
            const retryServer = getNextServer();
            if (retryServer && !tried.has(retryServer.url)) {
                if (typeof opts.onServerSwitch === 'function') {
                    try { opts.onServerSwitch(retryServer); } catch (_) { /* noop */ }
                }
                const url = `${retryServer.url}?t=${encodedText}&v=${voice}&r=${rate}&p=${pitch}&s=${style}&vol=${volume}`;
                try {
                    const resp = await fetchEdgeAudio(url, timeoutMs);
                    if (resp.ok) {
                        const ct = resp.headers.get('Content-Type') || '';
                        if (!ct || ct.includes('audio')) {
                            const blob = await resp.blob();
                            const blobUrl = URL.createObjectURL(blob);
                            log(`✅ 重试成功 (${retryServer.name})`);
                            return { blobUrl, blob, server: retryServer };
                        }
                    }
                    markServerFailed(retryServer);
                } catch (e) {
                    markServerFailed(retryServer);
                    lastError = e;
                }
            }
        }
    }

    throw lastError || new Error('无可用 Edge TTS 代理服务器');
}

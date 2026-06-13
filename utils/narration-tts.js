// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  旁白 TTS 模块（Edge）
//  从 fullMesText 中扣除 VOICE 命中区间 + removedRanges，
//  把剩余的旁白文本切成段后通过 Edge TTS 合成，
//  并产出可被 playback.js / offline-renderer.js 复用的 VOICE 类条目。
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { extensionName } from './config.js';
import { requestEdgeTTS, validateEdgeStyle, getAvailableServers } from './edge-tts.js';
import { requestNimoTTS, parseApiKeys as parseNimoApiKeys } from './nimo-tts.js';
import { resolveVoicePayload as resolveNimoVoicePayload, getRoot as getNimoRoot, getNarrationVoiceId as getNimoNarrationVoiceId, getCurrentVoiceId as getNimoCurrentVoiceId } from './nimo-voices.js';
import { MinimaxClient, MinimaxError, hexToBlob, parseApiKeys as parseMinimaxApiKeys } from './minimax-tts.js';
import {
    getRoot as getMinimaxRoot,
    getNarrationVoiceId as getMinimaxNarrationVoiceId,
    getCurrentVoiceId as getMinimaxCurrentVoiceId,
    buildPronDict as buildMinimaxPronDict,
    buildVoiceModify as buildMinimaxVoiceModify,
} from './minimax-voices.js';
import { isRegexLiteral, parseRegexLiteralParts, escapeRegex } from './regex-entry.js';
import { ttsNotifyBatchStart, ttsNotifyBatchEnd } from './tts-notification.js';
import { addOrUpdateTtsItem, generateTtsCacheKey } from './tts-cache.js';
import { alignAndBuildSourceToDom } from './text-alignment.js';

const log = (...args) => console.log('[ST-IS Narration]', ...args);

// 切分参数
// 说明：旁白以"每个句末标点/换行"为最小单元；不再强行聚合到很长的目标长度，
// 否则 Edge 合成出的单段音频会过长，光标按每字时长反推时无法与 TTS 节奏对齐。
// 仅在极短片段（<SEG_MIN_CHARS）时才向后合并一句，避免"啊。"这种超短段单独发请求。
const SEG_MIN_CHARS = 12;        // 段聚合的目标下限（低于此才合并）
const SEG_TARGET_CHARS = 60;     // 段聚合的目标上限（软）
const SEG_HARD_MAX = 120;        // 段长硬上限
const SEG_DROP_BELOW = 4;        // 段内可朗读字符数小于此则丢弃
const CONCURRENCY_MIN = 6;       // 并发下限（即使代理少也至少这么多）
const CONCURRENCY_MAX = 16;      // 并发上限（Edge）
const NIMO_CONCURRENCY = 50;     // Nimo 旁白并发（直连 MiMo API，无代理瓶颈）
const MINIMAX_CONCURRENCY = 20;  // MiniMax 旁白并发（客户端内部按 key 池/RPM 自动节流）

// ── 内存缓存（key = sha1(text|voice|style|rate|pitch|volume) → { blob, blobUrl }） ──
const narrationCache = new Map();

async function makeCacheKey(text, opts) {
    // opts.engine 可选，区分 edge / nimo；nimo 用 voiceKey 代替 voice/style/rate...
    const payload = `${text}\u0001${opts.engine || 'edge'}\u0001${opts.voice || opts.voiceKey || ''}\u0001${opts.style || ''}\u0001${opts.rate ?? ''}\u0001${opts.pitch ?? ''}\u0001${opts.volume ?? ''}\u0001${opts.format || ''}\u0001${opts.stylePrefix || ''}`;
    try {
        const buf = new TextEncoder().encode(payload);
        const digest = await crypto.subtle.digest('SHA-1', buf);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
        return payload;
    }
}

export async function getOrFetchEdge(text, opts) {
    const key = await makeCacheKey(text, opts);
    const hit = narrationCache.get(key);
    if (hit) {
        log(`💾 缓存命中 ${key.slice(0, 8)} (${text.length} 字)`);
        return hit;
    }

    let blob = null;
    let blobUrl = null;
    if (opts.engine === 'nimo') {
        const nimo = opts.nimo || {};
        const { blob: nblob } = await requestNimoTTS(text, {
            apiKeys: nimo.apiKeys,
            baseUrl: nimo.baseUrl,
            model: nimo.model,
            voice: nimo.voice,
            prompt: nimo.prompt,
            format: nimo.format || 'wav',
            stylePrefix: opts.stylePrefix || '',
        });
        blob = nblob;
        blobUrl = URL.createObjectURL(blob);
    } else if (opts.engine === 'minimax') {
        const mm = opts.minimax || {};
        if (!mm.apiKeys?.length) throw new MinimaxError('MiniMax 旁白：未配置 API Key');
        if (!mm.voiceId) throw new MinimaxError('MiniMax 旁白：未配置旁白/当前音色');
        const cli = new MinimaxClient({
            apiKeys: mm.apiKeys,
            platform: mm.platform || 'cn',
            timeout: 15000,
            retry: 1,
        });
        const resp = await cli.t2a({
            text,
            voiceId: mm.voiceId,
            model: mm.model || 'speech-2.8-hd',
            speed: mm.speed ?? 1.0,
            vol: mm.vol ?? 1.0,
            pitch: mm.pitch ?? 0,
            emotion: mm.emotion || '',
            languageBoost: mm.languageBoost || 'auto',
            format: mm.format || 'mp3',
            sampleRate: mm.sampleRate || 32000,
            bitrate: mm.bitrate || 128000,
            channel: mm.channel || 1,
            voiceModify: mm.voiceModify || null,
            pronunciationDict: mm.pronunciationDict || null,
            outputFormat: 'hex',
        });
        if (resp.audioHex) {
            blob = hexToBlob(resp.audioHex, `audio/${mm.format || 'mp3'}`);
        } else if (resp.audioUrl) {
            blob = await cli.download(resp.audioUrl);
        } else {
            throw new MinimaxError('MiniMax 返回空音频');
        }
        blobUrl = URL.createObjectURL(blob);
    } else {
        const r = await requestEdgeTTS(text, opts);
        blobUrl = r.blobUrl;
        blob = r.blob || null;
        if (!blob) {
            try { blob = await (await fetch(blobUrl)).blob(); } catch (_) { /* 忽略 */ }
        }
    }

    const entry = { blob, blobUrl };
    narrationCache.set(key, entry);
    log(`📥 缓存写入 ${key.slice(0, 8)} (${text.length} 字, engine=${opts.engine || 'edge'})`);
    return entry;
}

/**
 * 把一段旁白（blob + DOM 锚点）登记到 tts-cache，让「音频预览」面板能展示和试听。
 *
 * @param {object} p
 * @param {Blob}   p.blob
 * @param {string} p.blobUrl
 * @param {string} p.text
 * @param {object} p.voiceOpts  readNarrationVoiceOpts 返回的 opts
 * @param {number} p.domStart
 * @param {number} p.domEnd
 * @param {number} p.index
 */
async function registerNarrationPreview({ blob, blobUrl, text, voiceOpts, domStart, domEnd, index }) {
    if (!blob) return;
    try {
        const speakerLabel = voiceOpts.speakerLabel
            || (voiceOpts.engine === 'nimo' ? `MiMo:${voiceOpts.voice || ''}` : `Edge:${voiceOpts.voice || ''}`);
        const cacheKey = generateTtsCacheKey(text, '', `narration:${speakerLabel}`);
        const audioBuffer = await blob.arrayBuffer();
        addOrUpdateTtsItem(cacheKey, {
            cacheKey,
            status: 'success',
            text,
            context_texts: '',
            speaker: speakerLabel,
            speaker_name: speakerLabel,
            audioBuffer,
            audioBlob: blob,
            audioUrl: blobUrl,
            ir_description: '默认 (无)',
            special_effects: '默认',
            spatial: '正前方站立',
            isNarration: true,
            regex: domStart,
            regex_start: domStart,
            regex_end: domEnd,
            metadata: {
                isNarration: true,
                engine: voiceOpts.engine,
                speaker: speakerLabel,
                text,
                regex_start: domStart,
                regex_end: domEnd,
                narration_index: index,
            },
        });
    } catch (e) {
        log(`⚠️ 登记旁白到 tts-cache 失败：${e?.message || e}`);
    }
}

export function clearNarrationCache() {
    for (const v of narrationCache.values()) {
        try { if (v.blobUrl) URL.revokeObjectURL(v.blobUrl); } catch (_) {}
    }
    narrationCache.clear();
    log('🗑 narration 缓存已清空');
}

// 句末标点（用于切句）
const SENTENCE_BREAKS = /[。！？!?…\n][”"’']?|；;/g;

/**
 * 直接对 fullMesText 跑一次"当前正则配置"，把所有匹配的位置作为额外的跳过区。
 * 这是一道独立于 removedRanges 的兜底：即使上游传过来的 removedRanges 不准，
 * 这里仍然能保证旁白不会朗读到正则匹配上的文本。
 *
 * 仅处理：
 *   - regex_profiles[当前 profile].textRegex（每行一条规则）
 *   - regex_profiles[当前 profile].regexEntries（ST 风格条目，未禁用的）
 *
 * 不处理 beforeAfterRegex（涉及裁剪而非删除，语义复杂；
 * 且大多数用户用不到）。
 */
// 检测「单一捕获组引用」的 replaceString：例如 "$1"、"$<name>"、" $1 "（容许两侧空白）。
// 命中时认为是"提取式"——保留捕获组、丢弃匹配的其余部分。
function parseSingleGroupRef(replaceString) {
    const s = String(replaceString || '').trim();
    const m = /^\$(?:(\d+)|<([^>]+)>)$/.exec(s);
    if (!m) return null;
    return m[1] ? { kind: 'index', ref: parseInt(m[1], 10) } : { kind: 'name', ref: m[2] };
}

function computeRegexSkipRanges(fullMesText) {
    try {
        const settings = extension_settings[extensionName];
        const profileName = settings?.current_regex_profile;
        const profile = settings?.regex_profiles?.[profileName];
        if (!profile) return [];

        /** @type {Array<{re: RegExp, extractRef: ({kind:'index'|'name', ref:any}|null)}>} */
        const items = [];

        // 1) textRegex：按行解析（仅删除整匹配，不存在捕获组替换语义）
        const lines = String(profile.textRegex || '').split('\n');
        for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            try {
                if (isRegexLiteral(line)) {
                    const parts = parseRegexLiteralParts(line);
                    if (parts) items.push({ re: new RegExp(parts.pattern, parts.flags.includes('g') ? parts.flags : parts.flags + 'g'), extractRef: null });
                } else if (line.includes('|')) {
                    const [a, b] = line.split('|');
                    if (a !== undefined && b !== undefined) {
                        const start = a === '^' ? '^' : escapeRegex(a);
                        const end = b === '$' ? '$' : escapeRegex(b);
                        items.push({ re: new RegExp(`${start}[\\s\\S]*?${end}`, 'g'), extractRef: null });
                    }
                } else {
                    items.push({ re: new RegExp(escapeRegex(line), 'g'), extractRef: null });
                }
            } catch (e) {
                log(`textRegex 解析失败：${line} → ${e?.message}`);
            }
        }

        // 1.5) 内置默认过滤（与 ui-regex.js 的 builtInFilters 对齐）
        //      这里只关心"删除型"过滤，用于把对应区间标记为旁白跳过区，
        //      避免 HTML 注释 / <image> 占位标签被旁白 TTS 念出来。
        const builtInEnabled = settings?.regexBuiltInFiltersEnabled !== false;
        if (builtInEnabled) {
            const startTagRaw = settings?.regexImageStartTag || 'image###';
            const endTagRaw = settings?.regexImageEndTag || '###';
            const escapedStart = startTagRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedEnd = endTagRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            try { items.push({ re: /<!--[\s\S]*?-->/g, extractRef: null }); } catch (_) {}
            try { items.push({ re: /<image>[\s\S]*?<\/image>/g, extractRef: null }); } catch (_) {}
            try { items.push({ re: new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g'), extractRef: null }); } catch (_) {}
            if (startTagRaw !== 'image###') {
                try { items.push({ re: /image###[\s\S]*?###/g, extractRef: null }); } catch (_) {}
            }
        }

        // 2) regexEntries（ST 风格）
        for (const entry of profile.regexEntries || []) {
            if (!entry || entry.disabled) continue;
            const find = entry.findRegex;
            if (typeof find !== 'string' || !find) continue;
            try {
                let pattern, flags;
                if (isRegexLiteral(find)) {
                    const parts = parseRegexLiteralParts(find);
                    if (!parts) continue;
                    pattern = parts.pattern;
                    flags = parts.flags || '';
                } else {
                    pattern = find;
                    flags = '';
                }
                if (!flags.includes('g')) flags += 'g';
                const extractRef = parseSingleGroupRef(entry.replaceString);
                // 提取式正则需要捕获组位置，加 'd' 标志
                if (extractRef && !flags.includes('d')) flags += 'd';
                items.push({ re: new RegExp(pattern, flags), extractRef });
            } catch (e) {
                log(`regexEntry "${entry.scriptName}" 解析失败：${e?.message}`);
            }
        }

        if (items.length === 0) return [];

        const ranges = [];
        for (const { re, extractRef } of items) {
            // 防御：限制每条规则最多 1000 次匹配，避免恶性回溯
            let safety = 0;
            for (const m of fullMesText.matchAll(re)) {
                if (++safety > 1000) break;
                if (!m || m.index === undefined || !m[0]) continue;
                const matchStart = m.index;
                const matchEnd = matchStart + m[0].length;

                if (extractRef) {
                    // 提取式：跳过区 = 匹配区间 减去 捕获组区间
                    let groupIdx = null;
                    if (m.indices) {
                        if (extractRef.kind === 'index') {
                            groupIdx = m.indices[extractRef.ref] || null;
                        } else if (m.indices.groups) {
                            groupIdx = m.indices.groups[extractRef.ref] || null;
                        }
                    }
                    if (groupIdx) {
                        const [gs, ge] = groupIdx;
                        if (gs > matchStart) ranges.push({ start: matchStart, end: gs });
                        if (ge < matchEnd) ranges.push({ start: ge, end: matchEnd });
                    } else {
                        // 捕获组没对上（罕见）：保守地不把整段当跳过，避免误杀
                        log(`提取式正则 ${re} 未取到捕获组 ${JSON.stringify(extractRef)}，跳过区放弃合并`);
                    }
                } else {
                    ranges.push({ start: matchStart, end: matchEnd });
                }
            }
        }
        return ranges;
    } catch (e) {
        log('computeRegexSkipRanges 出错（已忽略）：', e);
        return [];
    }
}

/**
 * 合并/排序占用区间。
 * @param {Array<{start:number,end:number}>} ranges
 * @returns {Array<{start:number,end:number}>}
 */
function mergeRanges(ranges) {
    if (!Array.isArray(ranges) || ranges.length === 0) return [];
    const sorted = ranges
        .filter(r => r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.start !== r.end)
        // 容错：start>end 自动交换；负值钳到 0
        .map(r => {
            const a = Math.max(0, Math.min(r.start, r.end));
            const b = Math.max(0, Math.max(r.start, r.end));
            return { start: a, end: b };
        })
        .sort((a, b) => a.start - b.start);
    if (sorted.length === 0) return [];
    const out = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const last = out[out.length - 1];
        const cur = sorted[i];
        if (cur.start <= last.end) {
            last.end = Math.max(last.end, cur.end);
        } else {
            out.push(cur);
        }
    }
    return out;
}

/**
 * 用 skipRanges 把若干 gap 进一步切碎：从每个 gap 中扣除任何与 skip 重叠的部分。
 * 防御性兜底，避免上游坐标对不齐的情况下 skip 失效。
 */
function clipGapsAgainstSkips(gaps, skipRanges) {
    if (!skipRanges.length) return gaps;
    const out = [];
    for (const g of gaps) {
        let pieces = [{ start: g.start, end: g.end }];
        for (const s of skipRanges) {
            const next = [];
            for (const p of pieces) {
                if (s.end <= p.start || s.start >= p.end) { next.push(p); continue; }
                if (s.start > p.start) next.push({ start: p.start, end: s.start });
                if (s.end < p.end) next.push({ start: s.end, end: p.end });
            }
            pieces = next;
            if (!pieces.length) break;
        }
        out.push(...pieces.filter(p => p.end > p.start));
    }
    return out;
}

/**
 * 从 generatedVoices（人物对话已成功合成的条目）和 removedRanges
 * 计算「被占用」的字符区间集合。
 * @param {string} fullMesText
 * @param {Array} voiceItems    finalMusicList 风格的 VOICE 条目
 * @param {Array} removedRanges {start,end} 跳过区
 */
function buildOccupiedRanges(fullMesText, voiceItems, removedRanges) {
    const occupied = [];

    for (const v of voiceItems || []) {
        // loop 型：直接用 regex_start/end
        if (Number.isFinite(v.regex_start) && Number.isFinite(v.regex_end) && v.regex_end > v.regex_start) {
            occupied.push({ start: v.regex_start, end: v.regex_end });
            continue;
        }
        const start = Number.isFinite(v.regex) ? v.regex : -1;
        if (start < 0) continue;
        const text = v.text || v.context || '';
        if (!text) continue;
        // 复核：若 indexOf 命中起点附近则用真实长度；否则按 text.length 估算
        let end = start + text.length;
        try {
            const probe = fullMesText.indexOf(text, Math.max(0, start - 4));
            if (probe >= 0 && probe - start <= 8) {
                end = probe + text.length;
            }
        } catch (_) { /* noop */ }
        occupied.push({ start, end });
    }

    for (const r of removedRanges || []) {
        if (Number.isFinite(r.start) && Number.isFinite(r.end)) {
            occupied.push({ start: r.start, end: r.end });
        }
    }

    return mergeRanges(occupied);
}

/**
 * 求 [0, total) 减去 occupied 后的补集（gaps）。
 */
function subtractRanges(total, occupied) {
    const gaps = [];
    let cursor = 0;
    for (const r of occupied) {
        if (r.start > cursor) gaps.push({ start: cursor, end: Math.min(r.start, total) });
        cursor = Math.max(cursor, r.end);
        if (cursor >= total) break;
    }
    if (cursor < total) gaps.push({ start: cursor, end: total });
    return gaps;
}

/**
 * 把一个 gap 内的文本按句末标点切片，再聚合到 SEG_TARGET_CHARS。
 * 返回 {start,end,text} 列表（坐标是全文索引）。
 */
function segmentGap(fullMesText, gap) {
    const slice = fullMesText.slice(gap.start, gap.end);
    if (!slice) return [];

    // 按句末标点切，保留标点；用 matchAll 取得各 break 的位置
    const breakIdxs = [];
    SENTENCE_BREAKS.lastIndex = 0;
    let m;
    while ((m = SENTENCE_BREAKS.exec(slice)) !== null) {
        breakIdxs.push(m.index + m[0].length); // 切点 = 标点之后
    }
    if (breakIdxs.length === 0 || breakIdxs[breakIdxs.length - 1] !== slice.length) {
        breakIdxs.push(slice.length);
    }

    // 把 slice 拆成 [prev, cut) 的句子
    const sentences = [];
    let prev = 0;
    for (const cut of breakIdxs) {
        if (cut > prev) {
            sentences.push({ start: prev, end: cut, text: slice.slice(prev, cut) });
            prev = cut;
        }
    }

    // 聚合到目标长度
    const segs = [];
    let buf = null;
    for (const s of sentences) {
        if (!buf) { buf = { ...s }; continue; }
        const newLen = (buf.end - buf.start) + (s.end - s.start);
        if (newLen <= SEG_TARGET_CHARS || (buf.end - buf.start) < SEG_MIN_CHARS) {
            buf.end = s.end;
            buf.text += s.text;
            if ((buf.end - buf.start) >= SEG_HARD_MAX) {
                segs.push(buf);
                buf = null;
            }
        } else {
            segs.push(buf);
            buf = { ...s };
        }
    }
    if (buf) segs.push(buf);

    // 转回全文坐标，并过滤可朗读字符过少的段
    return segs
        .map(s => ({
            start: gap.start + s.start,
            end: gap.start + s.end,
            text: s.text,
        }))
        .map(trimNarrationSegment)
        .filter(Boolean);
}

function trimNarrationSegment(segment) {
    if (!segment || typeof segment.text !== 'string') return null;
    const text = segment.text;
    if (!text) return null;

    let startTrim = 0;
    let endTrim = 0;

    const leading = text.match(/^(?:(?!["“”'‘’])[\s\p{P}\p{S}])+(?=[\p{L}\p{N}])/u);
    if (leading) startTrim = leading[0].length;

    const trailing = text.match(/[\s\u00a0\u200b]+$/u);
    if (trailing) endTrim = trailing[0].length;

    const start = segment.start + startTrim;
    const end = Math.max(start, segment.end - endTrim);
    const trimmedText = text.slice(startTrim, text.length - endTrim);

    if (countReadable(trimmedText) < SEG_DROP_BELOW) return null;
    return { start, end, text: trimmedText };
}

function buildCleanToDomCharMap(fullMesText, cleanedMesText) {
    // M4 集成：优先用新对齐算法（双向唯一锚点 + NW），失败回退旧 LCS。
    try {
        const r = alignAndBuildSourceToDom(fullMesText, cleanedMesText);
        if (r !== null) return r;
    } catch (e) {
        log('[Align] buildCleanToDomCharMap 异常，回退旧 LCS：', e?.message || e);
    }
    return _legacy_buildCleanToDomCharMap(fullMesText, cleanedMesText);
}

function _legacy_buildCleanToDomCharMap(fullMesText, cleanedMesText) {
    if (typeof fullMesText !== 'string' || typeof cleanedMesText !== 'string') return null;
    const D = fullMesText.length;
    const C = cleanedMesText.length;
    if (D === 0 || C === 0) return [];
    if ((D + 1) * (C + 1) > 16_000_000) return null;

    const normalizeCharCode = (code) => {
        switch (code) {
            case 34:
            case 39:
            case 96:
            case 8220:
            case 8221:
            case 8216:
            case 8217:
            case 171:
            case 187:
            case 12298:
            case 12299:
            case 12300:
            case 12301:
                return 34;
            default:
                return code;
        }
    };

    const W = C + 1;
    const dp = new Uint16Array((D + 1) * W);
    for (let i = 1; i <= D; i++) {
        const di = normalizeCharCode(fullMesText.charCodeAt(i - 1));
        const rowBase = i * W;
        const prevRowBase = (i - 1) * W;
        for (let j = 1; j <= C; j++) {
            if (di === normalizeCharCode(cleanedMesText.charCodeAt(j - 1))) {
                dp[rowBase + j] = dp[prevRowBase + (j - 1)] + 1;
            } else {
                const a = dp[prevRowBase + j];
                const b = dp[rowBase + (j - 1)];
                dp[rowBase + j] = a > b ? a : b;
            }
        }
    }

    const cleanToDom = new Array(C).fill(-1);
    let i = D;
    let j = C;
    while (i > 0 && j > 0) {
        if (normalizeCharCode(fullMesText.charCodeAt(i - 1)) === normalizeCharCode(cleanedMesText.charCodeAt(j - 1))) {
            cleanToDom[j - 1] = i - 1;
            i -= 1;
            j -= 1;
        } else if (dp[(i - 1) * W + j] >= dp[i * W + (j - 1)]) {
            i -= 1;
        } else {
            j -= 1;
        }
    }

    return cleanToDom;
}

function getMappedDomRange(cleanToDom, cleanStart, cleanEnd) {
    if (!Array.isArray(cleanToDom) || !Number.isFinite(cleanStart) || !Number.isFinite(cleanEnd) || cleanEnd <= cleanStart) {
        return null;
    }

    let domStart = -1;
    for (let i = Math.max(0, cleanStart); i < Math.min(cleanEnd, cleanToDom.length); i++) {
        const domIdx = cleanToDom[i];
        if (domIdx >= 0) {
            domStart = domIdx;
            break;
        }
    }
    if (domStart < 0) return null;

    let domEnd = -1;
    for (let i = Math.min(cleanEnd, cleanToDom.length) - 1; i >= Math.max(0, cleanStart); i--) {
        const domIdx = cleanToDom[i];
        if (domIdx >= 0) {
            domEnd = domIdx + 1;
            break;
        }
    }
    if (domEnd <= domStart) return null;

    return { start: domStart, end: domEnd };
}

function countReadable(text) {
    // 把空白和纯标点剔除后计算字符数
    return (text || '').replace(/[\s\p{P}\p{S}]/gu, '').length;
}

/**
 * 简单并发限制器
 */
async function runWithLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            try {
                results[i] = { status: 'fulfilled', value: await worker(items[i], i) };
            } catch (e) {
                results[i] = { status: 'rejected', reason: e };
            }
        }
    });
    await Promise.all(runners);
    return results;
}

export function readNarrationVoiceOpts() {
    const root = extension_settings[extensionName];
    const engine = root.narration_engine || 'edge';

    if (engine === 'nimo') {
        const nimoRoot = getNimoRoot();
        const apiKeys = parseNimoApiKeys(nimoRoot.apiKey);
        // 返回一个"占位 opts"，真正 voice 在 _expandNimoOpts 里异步解析
        return {
            engine: 'nimo',
            voice: getNimoNarrationVoiceId() || getNimoCurrentVoiceId() || '',
            voiceKey: getNimoNarrationVoiceId() || getNimoCurrentVoiceId() || '',
            stylePrefix: nimoRoot.narrationStylePrefix || nimoRoot.stylePrefix || '',
            format: nimoRoot.format || 'wav',
            nimo: {
                apiKeys,
                baseUrl: nimoRoot.baseUrl,
                format: nimoRoot.format || 'wav',
                // model/voice/prompt 会在 _expandNimoOpts 里填充
            },
            _needsExpand: true,
            speakerLabel: '', // 填充后变 "MiMo:<displayName>"
        };
    }

    if (engine === 'minimax') {
        const mmRoot = getMinimaxRoot();
        const apiKeys = parseMinimaxApiKeys(mmRoot.apiKey);
        const voiceId = getMinimaxNarrationVoiceId() || getMinimaxCurrentVoiceId() || '';
        return {
            engine: 'minimax',
            voice: voiceId,
            voiceKey: voiceId,
            format: mmRoot.format || 'mp3',
            minimax: {
                apiKeys,
                platform: mmRoot.platform || 'cn',
                voiceId,
                model: mmRoot.model || 'speech-2.8-hd',
                speed: mmRoot.speed ?? 1.0,
                vol: mmRoot.vol ?? 1.0,
                pitch: mmRoot.pitch ?? 0,
                emotion: mmRoot.emotion || '',
                languageBoost: mmRoot.languageBoost || 'auto',
                format: mmRoot.format || 'mp3',
                sampleRate: mmRoot.sampleRate || 32000,
                bitrate: mmRoot.bitrate || 128000,
                channel: mmRoot.channel || 1,
                voiceModify: buildMinimaxVoiceModify(mmRoot.vm),
                pronunciationDict: buildMinimaxPronDict(mmRoot.pronDict),
            },
            speakerLabel: `MiniMax:${voiceId || '(未设置)'}`,
        };
    }

    const cfg = root.edge_tts || {};
    const voice = cfg.narrationVoice || cfg.voice || 'zh-CN-XiaoxiaoNeural';
    const styleRaw = cfg.style || 'general';
    const style = validateEdgeStyle(styleRaw, voice) || 'general';
    return {
        engine: 'edge',
        voice,
        style,
        rate: Number.isFinite(cfg.rate) ? cfg.rate : 0,
        pitch: Number.isFinite(cfg.pitch) ? cfg.pitch : 0,
        volume: Number.isFinite(cfg.volume) ? cfg.volume : 50,
        speakerLabel: `Edge:${voice}`,
    };
}

/**
 * Nimo 旁白的 opts 需要异步解析音色（读 configDatabase 里的 clone 参考音频）。
 * 在真正发请求前调用一次即可。
 */
export async function _expandNimoOpts(opts) {
    if (opts.engine !== 'nimo' || !opts._needsExpand) return opts;
    if (!opts.voice) {
        throw new Error('Nimo 旁白：未配置旁白/当前音色，请到「MiMo TTS」设置页选择');
    }
    if (!opts.nimo?.apiKeys?.length) {
        throw new Error('Nimo 旁白：未配置 API Key');
    }
    const payload = await resolveNimoVoicePayload(opts.voice);
    opts.nimo.model = payload.model;
    opts.nimo.voice = payload.voice;
    opts.nimo.prompt = payload.prompt;
    opts.speakerLabel = `MiMo:${payload.displayName}`;
    opts._needsExpand = false;
    return opts;
}

/**
 * 把一段连续文本按句号切句、再聚合到目标长度。坐标体系是该段自身（局部 0 起）。
 * 返回 [{start, end, text}]
 */
function splitTextIntoSegments(text) {
    if (!text) return [];
    const breakIdxs = [];
    SENTENCE_BREAKS.lastIndex = 0;
    let m;
    while ((m = SENTENCE_BREAKS.exec(text)) !== null) {
        breakIdxs.push(m.index + m[0].length);
    }
    if (breakIdxs.length === 0 || breakIdxs[breakIdxs.length - 1] !== text.length) {
        breakIdxs.push(text.length);
    }

    const sentences = [];
    let prev = 0;
    for (const cut of breakIdxs) {
        if (cut > prev) {
            sentences.push({ start: prev, end: cut, text: text.slice(prev, cut) });
            prev = cut;
        }
    }

    const segs = [];
    let buf = null;
    for (const s of sentences) {
        if (!buf) { buf = { ...s }; continue; }
        const newLen = (buf.end - buf.start) + (s.end - s.start);
        if (newLen <= SEG_TARGET_CHARS || (buf.end - buf.start) < SEG_MIN_CHARS) {
            buf.end = s.end;
            buf.text += s.text;
            if ((buf.end - buf.start) >= SEG_HARD_MAX) {
                segs.push(buf);
                buf = null;
            }
        } else {
            segs.push(buf);
            buf = { ...s };
        }
    }
    if (buf) segs.push(buf);

    return segs
        .map(trimNarrationSegment)
        .filter(Boolean);
}

/**
 * 路径 A：从 cleanedMesText（正则清洗后的源文本）构造旁白条目。
 *
 * 策略：
 *   1. 把 cleanedMesText 按句切分聚合成 segments。
 *   2. 用 voiceItems 在 cleanedMesText 上的命中位置切除"对话占位"段（避免重复）。
 *   3. 每段单独发 Edge TTS。
 *   4. 锚点（regex/regex_end）通过在 fullMesText (DOM) 中 indexOf 查找段首/段尾片段确定；
 *      失败时退化为按"段在 cleanedMesText 中的相对比例 × DOM 长度"估算。
 */
async function buildFromCleanedText(cleanedMesText, fullMesText, voiceItems, voiceRegexStrings = [], opts = {}) {
    // 1) 算出 voice 在 cleanedMesText 中的占用，从而排除对话部分
    //    【关键】：无论 TTS 成功/失败，只要 BGM 里写了这条 VOICE，就要从旁白里扣掉，
    //    否则 TTS 失败的台词会被旁白补念，TTS 成功的台词若 indexOf 因引号/省略号差异失配也会被旁白重复念。
    const normalizeForMatch = (s) => String(s || '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’'`]/g, '"')
        // 单字符替换：避免「逐字归一化」(构造 normToOrig 时) 与「整串归一化」(cleanedNorm) 输出长度不一致。
        // 旧写法 /……/→'...' 是 2 字符 → 3 字符；逐字时单个 '…' 不匹配，整串时匹配，导致 normToOrig
        // 每遇一个 …… 就右移 +1，最终把对话后面的字（如 "他"）吞进 voice 占用区间。
        .replace(/…/g, '...')
        // 与 index.js 的 normalize() 对齐：把全角标点折叠到半角，
        // 否则 BGM 原始 regex 串（含全角 ，。 ）在 ASCII 化的 cleanedMesText 中无法定位，
        // 同层 BGM 标签会让旁白把对话开头的 "X， 一段当成旁白朗读出来。
        .replace(/？/g, '?')
        .replace(/！/g, '!')
        .replace(/：/g, ':')
        .replace(/；/g, ';')
        .replace(/，/g, ',')
        .replace(/。/g, '.')
        .replace(/\s+/g, '');
    const expandLocatedRange = (loc) => {
        if (!loc) return null;
        let start = loc.start;
        let end = loc.end;

        let left = start - 1;
        while (left >= 0 && /\s/.test(cleanedMesText[left])) left--;
        if (left >= 0 && normalizeForMatch(cleanedMesText[left]) === '"') {
            start = left;
        }

        let right = end;
        while (right < cleanedMesText.length && /\s/.test(cleanedMesText[right])) right++;
        if (right < cleanedMesText.length && normalizeForMatch(cleanedMesText[right]) === '"') {
            end = right + 1;
        }

        return { start, end };
    };
    const cleanedNorm = normalizeForMatch(cleanedMesText);
    // 为了从 cleanedNorm 的下标回推到 cleanedMesText 的下标，建一张映射表
    const normToOrig = new Array(cleanedNorm.length);
    {
        let j = 0;
        const src = cleanedMesText;
        let i = 0;
        while (i < src.length && j < cleanedNorm.length) {
            const piece = normalizeForMatch(src[i]);
            for (let k = 0; k < piece.length; k++) {
                normToOrig[j + k] = i;
            }
            j += piece.length;
            i += 1;
        }
        // 末尾回退
        if (j < cleanedNorm.length) normToOrig.fill(src.length - 1, j);
    }
    let searchCursor = 0;
    let searchCursorNorm = 0;

    const tryLocate = (raw) => {
        if (!raw) return null;

        // 0. If raw is a regex string, try RegExp matching
        if (raw.startsWith('/') && raw.endsWith('/') && raw.length > 2) {
            try {
                const regexStr = raw.slice(1, -1);
                const regex = new RegExp(regexStr);
                const slice = cleanedMesText.slice(searchCursor);
                const m = regex.exec(slice);
                if (m) {
                    const hit = searchCursor + m.index;
                    searchCursor = hit + m[0].length;
                    return expandLocatedRange({ start: hit, end: hit + m[0].length });
                }
                const m2 = regex.exec(cleanedMesText);
                if (m2) {
                    searchCursor = m2.index + m2[0].length;
                    return expandLocatedRange({ start: m2.index, end: m2.index + m2[0].length });
                }
            } catch (e) {
                // ignore invalid regex
            }
        }

        // 1. Direct match with cursor
        let direct = cleanedMesText.indexOf(raw, searchCursor);
        if (direct >= 0) {
            searchCursor = direct + raw.length;
            return expandLocatedRange({ start: direct, end: direct + raw.length });
        }
        direct = cleanedMesText.indexOf(raw);
        if (direct >= 0) {
            searchCursor = direct + raw.length;
            return expandLocatedRange({ start: direct, end: direct + raw.length });
        }

        // 2. Stripped match with cursor
        const stripped = raw.replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, '');
        if (stripped && stripped !== raw) {
            let d2 = cleanedMesText.indexOf(stripped, searchCursor);
            if (d2 >= 0) {
                searchCursor = d2 + stripped.length;
                return expandLocatedRange({ start: d2, end: d2 + stripped.length });
            }
            d2 = cleanedMesText.indexOf(stripped);
            if (d2 >= 0) {
                searchCursor = d2 + stripped.length;
                return expandLocatedRange({ start: d2, end: d2 + stripped.length });
            }
        }

        // 3. Normalized probe match with cursor (lowered length limit to 1)
        const probe = normalizeForMatch(stripped || raw);
        if (probe && probe.length >= 1) {
            let hit = cleanedNorm.indexOf(probe, searchCursorNorm);
            if (hit < 0) hit = cleanedNorm.indexOf(probe);
            
            if (hit >= 0) {
                const os = normToOrig[hit] ?? 0;
                const oe = (normToOrig[hit + probe.length - 1] ?? os) + 1;
                if (oe > os) {
                    searchCursor = oe;
                    searchCursorNorm = hit + probe.length;
                    return expandLocatedRange({ start: os, end: oe });
                }
            }
        }
        return null;
    };

    const voiceOccupiedClean = [];
    const visualizeClean = (s) => String(s || '')
        .replace(/\n/g, '⏎')
        .replace(/\t/g, '⇥')
        .replace(/\u00a0/g, '·')
        .replace(/\u200b/g, '∅');
    const dumpCleanedAround = (loc, label) => {
        if (!loc) { log(`[NARR-DBG] ${label}: tryLocate 未命中`); return; }
        const winFrom = Math.max(0, loc.start - 20);
        const winTo = Math.min(cleanedMesText.length, loc.end + 20);
        log(`[NARR-DBG] ${label}: clean=[${loc.start},${loc.end}) len=${loc.end - loc.start} matched="${visualizeClean(cleanedMesText.slice(loc.start, loc.end))}" 上下文="${visualizeClean(cleanedMesText.slice(winFrom, winTo))}"`);
    };
    // 1a) 已成功合成的 VOICE：用合成时记录的文本定位
    for (const v of voiceItems || []) {
        const t = v.text || v.context || '';
        const loc = tryLocate(t);
        const tag = `1a voice text="${visualizeClean(String(t).slice(0, 30))}"`;
        dumpCleanedAround(loc, tag);
        if (loc) voiceOccupiedClean.push(loc);
    }
    // 1b) BGM 原始 VOICE 正则（含失败/被跳过的）：确保旁白不会补念
    for (const raw of voiceRegexStrings || []) {
        const loc = tryLocate(raw);
        const tag = `1b raw regex="${visualizeClean(String(raw).slice(0, 30))}"`;
        dumpCleanedAround(loc, tag);
        if (loc) voiceOccupiedClean.push(loc);
    }
    const voiceMerged = mergeRanges(voiceOccupiedClean);
    const cleanGaps = subtractRanges(cleanedMesText.length, voiceMerged);
    log(`[NARR-DBG] voiceMerged=${JSON.stringify(voiceMerged)}`);
    log(`[NARR-DBG] cleanGaps=${JSON.stringify(cleanGaps)}`);

     const cleanToDom = buildCleanToDomCharMap(fullMesText, cleanedMesText);
     const domVoiceRanges = mergeRanges((voiceItems || [])
         .map(v => {
             const start = Number.isFinite(v?.regex_start) ? v.regex_start : v?.regex;
             const endExclusive = Number.isFinite(v?.regex_end)
                 ? v.regex_end + 1
                 : (Number.isFinite(v?.regex) ? v.regex + 1 : NaN);
             if (!Number.isFinite(start) || !Number.isFinite(endExclusive) || endExclusive <= start) {
                 return null;
             }
             return { start, end: endExclusive };
         })
         .filter(Boolean));

    // 2) 在 cleanedMesText 的每个 gap 内做切分
    const segments = [];
    for (const g of cleanGaps) {
        const localText = cleanedMesText.slice(g.start, g.end);
        log(`[NARR-DBG] gap=[${g.start},${g.end}) head="${visualizeClean(localText.slice(0, 30))}" tail="${visualizeClean(localText.slice(-30))}"`);
        const localSegs = splitTextIntoSegments(localText);
        for (const s of localSegs) {
            log(`[NARR-DBG]   localSeg local=[${s.start},${s.end}) → clean=[${g.start + s.start},${g.start + s.end}) text="${visualizeClean(s.text.slice(0, 40))}"`);
            segments.push({
                cleanStart: g.start + s.start,
                cleanEnd: g.start + s.end,
                text: s.text,
            });
        }
    }

    log(`🅰  cleanedMesText 路径：voice 占用 ${voiceMerged.length} 段，剩余 gap ${cleanGaps.length} 段，最终切出 ${segments.length} 个朗读段`);
    segments.forEach((s, i) => {
        const preview = s.text.replace(/\s+/g, ' ').slice(0, 40);
        log(`  seg#${i} clean=[${s.cleanStart},${s.cleanEnd}) len=${s.text.length} "${preview}${s.text.length > 40 ? '…' : ''}"`);
    });

    if (!segments.length) {
        log('无旁白片段（cleanedMesText 全部被对话占用）');
        return [];
    }

    // 3) 调旁白 TTS（Edge / Nimo 按 settings.narration_engine 分发）
    const voiceOpts = readNarrationVoiceOpts();
    await _expandNimoOpts(voiceOpts);
    const concurrency = voiceOpts.engine === 'nimo'
        ? NIMO_CONCURRENCY
        : voiceOpts.engine === 'minimax'
            ? MINIMAX_CONCURRENCY
            : Math.max(CONCURRENCY_MIN, Math.min(CONCURRENCY_MAX, (getAvailableServers?.() || []).length || CONCURRENCY_MIN));

    let settled;
    if (opts && opts.fakeTTS) {
        const cpm = opts.cpm || 600;
        settled = segments.map((seg, i) => {
            const charLen = String(seg.text || '').length;
            const durationSecs = (charLen / cpm) * 60;
            const blobUrl = `virtual-voice://?duration=${durationSecs.toFixed(3)}`;
            return {
                status: 'fulfilled',
                value: { seg, blobUrl, blob: null }
            };
        });
        log(`[NARR-DBG] 启用了伪旁白，共生成 ${settled.length} 个虚拟音频。`);
    } else {
        const notifSource = `narration-${voiceOpts.engine}`;
        const notifLabel = voiceOpts.engine === 'nimo' ? '旁白(MiMo)'
            : voiceOpts.engine === 'minimax' ? '旁白(MiniMax)'
            : '旁白(Edge)';
        ttsNotifyBatchStart(notifSource, notifLabel, segments.length);
        try {
            settled = await runWithLimit(segments, concurrency, async (seg) => {
                try {
                    const entry = await getOrFetchEdge(seg.text, voiceOpts);
                    let blobUrl = entry.blobUrl;
                    if (entry.blob) {
                        blobUrl = URL.createObjectURL(entry.blob);
                    }
                    return { seg, blobUrl, blob: entry.blob };
                } finally {
                    ttsNotifyBatchEnd(notifSource, 1);
                }
            });
        } catch (e) {
            ttsNotifyBatchEnd(notifSource, segments.length);
            throw e;
        }
    }

    // 4) 在 DOM 文本里反查锚点（保留空白，按 probe 长度递减重试）
    //    关键修复：
    //    - 先 trim 掉 segText 开头的空白，避免 cleaned 的 \n\n 在 DOM 里只剩 \n 导致 0 命中
    //    - searchFrom 给 16 字符 slack，避免上一段 tail 越界把下一段挤掉
    const buildAnchorCore = (segText) => {
        const raw = String(segText || '');
        if (!raw) return { text: '', skippedHead: 0, skippedTail: 0 };

        const headWs = raw.match(/^[\s\u00a0\u200b]*/)?.[0].length || 0;
        const tailWs = raw.match(/[\s\u00a0\u200b]*$/)?.[0].length || 0;

        let start = headWs;
        let end = raw.length - tailWs;

        const firstReadable = raw.search(/[\p{L}\p{N}]/u);
        if (firstReadable >= 0) {
            const prefix = raw.slice(0, firstReadable);
            if (prefix.length <= 16 && !/[\p{L}\p{N}]/u.test(prefix)) {
                start = Math.max(start, firstReadable);
            }
        }

        for (let i = raw.length - 1; i >= start; i--) {
            if (/[\p{L}\p{N}]/u.test(raw[i])) {
                const suffix = raw.slice(i + 1);
                if (suffix.length <= 16 && !/[\p{L}\p{N}]/u.test(suffix)) {
                    end = Math.min(end, i + 1);
                }
                break;
            }
        }

        if (end <= start) {
            start = headWs;
            end = raw.length - tailWs;
        }

        return {
            text: raw.slice(start, end),
            skippedHead: start,
            skippedTail: raw.length - end,
        };
    };

    const findDomAnchor = (segText, searchFromRaw, debugInfo) => {
        const SLACK = 16;
        const searchFrom = Math.max(0, searchFromRaw - SLACK);

        // 跳过段首空白与孤立引号/换行等边界噪声，避免 `”\n\n\n杨过...` 这类 cleaned 片段锚不到 DOM。
        const core = buildAnchorCore(segText);
        const trimmed = core.text || String(segText || '').slice(core.skippedHead);

        const candidates = [24, 16, 12, 8];
        for (const n of candidates) {
            if (trimmed.length < n) continue;
            const probe = trimmed.slice(0, n);
            const idx = fullMesText.indexOf(probe, searchFrom);
            if (debugInfo) debugInfo.tries.push({ n, probe, hit: idx, mode: `head${n}` });
            if (idx >= 0) return { idx, len: n, mode: `head${n}`, skipped: core.skippedHead, tailSkipped: core.skippedTail };
        }
        // 去空白滑动匹配（双方都跳过空白）
        const probeStripped = trimmed.replace(/\s+/g, '').slice(0, 16);
        if (probeStripped.length >= 6) {
            for (let i = searchFrom; i < fullMesText.length - probeStripped.length; i++) {
                let pi = 0, di = i;
                while (di < fullMesText.length && pi < probeStripped.length) {
                    if (/\s/.test(fullMesText[di])) { di++; continue; }
                    if (fullMesText[di] !== probeStripped[pi]) break;
                    di++; pi++;
                }
                if (pi === probeStripped.length) {
                    if (debugInfo) debugInfo.tries.push({ n: probeStripped.length, probe: probeStripped, hit: i, mode: 'stripped' });
                    return { idx: i, len: di - i, mode: 'stripped', skipped: core.skippedHead, tailSkipped: core.skippedTail };
                }
            }
            if (debugInfo) debugInfo.tries.push({ n: probeStripped.length, probe: probeStripped, hit: -1, mode: 'stripped' });
        }
        return null;
    };

    // 调试用：把不可见字符显式化，便于在控制台核对
    const visualize = (s) => (s || '')
        .replace(/\n/g, '⏎')
        .replace(/\t/g, '⇥')
        .replace(/\u00a0/g, '·')   // NBSP
        .replace(/\u200b/g, '∅')   // ZWSP
        .replace(/\u2028|\u2029/g, '¶');
    const charCodes = (s) => Array.from(s || '').map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join(' ');

    const items = [];
    let domSearchFrom = 0;
    for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status !== 'fulfilled') {
            log(`段 #${i} 合成失败：${r.reason?.message || r.reason}`);
            continue;
        }
        const { seg, blobUrl } = r.value;

        const dbg = { tries: [] };
        const mappedRange = getMappedDomRange(cleanToDom, seg.cleanStart, seg.cleanEnd);
        const anchor = findDomAnchor(seg.text, domSearchFrom, dbg);
        let domStart, domEnd;
        // 🩹 LCS 映射的合理性检查：当被切到末尾的 cleaned 段右侧没有"下一段"约束时，
        // LCS 会把段内常见字（"了/的/一/。"）greedy 匹配到后续 HTML 代码块的同款字上，
        // 导致 mappedRange 远比 seg.text 长（实测出现过 36 字 → 4499 字的离谱情况）。
        // 用 (seg.text.length + DRIFT) 作为上限做合理性校验；若超限则改走 anchor / tail-probe 路径。
        const MAPPED_DRIFT = 80;
        const mappedLooksSane = mappedRange
            && (mappedRange.end - mappedRange.start) <= (seg.text.length + MAPPED_DRIFT);
        if (mappedRange && !mappedLooksSane) {
            log(`  seg#${i} ⚠ DOM mapped=[${mappedRange.start},${mappedRange.end}) 长度 ${mappedRange.end - mappedRange.start} 超过 segLen=${seg.text.length}+${MAPPED_DRIFT}，改用 anchor/tail 收敛`);
        }
        if (mappedRange && mappedLooksSane) {
            domStart = mappedRange.start;
            domEnd = mappedRange.end;
            log(`  seg#${i} ✓ DOM mapped=[${domStart},${domEnd}) clean=[${seg.cleanStart},${seg.cleanEnd})`);
        } else if (anchor) {
            domStart = anchor.idx;
            // 段尾锚点：忽略段尾孤立引号/换行等边界噪声后，再取结尾探针。
            const anchorCore = buildAnchorCore(seg.text);
            const tailSkip = anchorCore.skippedTail;
            const trimmedTail = anchorCore.text || seg.text.slice(0, seg.text.length - tailSkip);
            const tail = trimmedTail.slice(-12);
            // 限制 tail 搜索范围：必须落在 [domStart, domStart + segLen + DRIFT] 之间
            // 否则容易抓到 DOM 后面又出现的同款标点/短语
            const DRIFT = 80;
            const tailWindowEnd = Math.min(
                fullMesText.length,
                domStart + seg.text.length + DRIFT,
            );
            let tailIdx = -1;
            if (tail.length >= 4) {
                const slice = fullMesText.slice(domStart + anchor.len, tailWindowEnd);
                const rel = slice.indexOf(tail);
                if (rel >= 0) tailIdx = domStart + anchor.len + rel;
            }
            const tailHit = tailIdx >= 0;
            domEnd = tailHit
                ? tailIdx + tail.length
                : Math.min(fullMesText.length, domStart + Math.max(1, trimmedTail.length));
            log(`  seg#${i} ✓ DOM anchor=[${domStart},${domEnd}) mode=${anchor.mode} probeLen=${anchor.len} skipped=${anchor.skipped} tailSkipped=${anchor.tailSkipped || 0} tail${tailHit ? '✓' : '✗'}="${visualize(tail)}"`);
        } else {
            // 回退：按 cleaned 中的相对位置映射，并保证不回退到 domSearchFrom 之前
            const anchorCore = buildAnchorCore(seg.text);
            const ratio = seg.cleanStart / Math.max(1, cleanedMesText.length);
            domStart = Math.max(domSearchFrom, Math.floor(ratio * fullMesText.length));
            domEnd = Math.min(fullMesText.length, domStart + Math.max(1, anchorCore.text.length || seg.text.length));

            // —— 详细诊断（完整不截断）——
            const winFrom = Math.max(0, domStart - 60);
            const winTo = Math.min(fullMesText.length, domEnd + 60);
            const window = fullMesText.slice(winFrom, winTo);
            log(`  seg#${i} ⚠ DOM anchor 未命中，按比例落点 [${domStart},${domEnd}) ratio=${ratio.toFixed(3)} domSearchFrom=${domSearchFrom} fullLen=${fullMesText.length} cleanLen=${cleanedMesText.length} skippedHead=${anchorCore.skippedHead} skippedTail=${anchorCore.skippedTail}`);
            log(`     seg.clean=[${seg.cleanStart},${seg.cleanEnd}) segLen=${seg.text.length}`);
            log(`     seg.text(完整)="${visualize(seg.text)}"`);
            log(`     seg.text(hex 全)=${charCodes(seg.text)}`);
            log(`     seg.text(core)="${visualize(anchorCore.text)}"`);
            log(`     DOM 窗口[${winFrom},${winTo})="${visualize(window)}"`);
            log(`     DOM 窗口(hex)=${charCodes(window)}`);
            log(`     探针尝试：`);
            dbg.tries.forEach(t => {
                log(`       - ${t.mode || ('head' + t.n)}(len=${t.n}) hit=${t.hit} probe="${visualize(t.probe)}" hex=${charCodes(t.probe)}`);
            });
            // 全局 indexOf（忽略 searchFrom）：依次用 24/16/12/8 找
            for (const n of [24, 16, 12, 8]) {
                if (seg.text.length < n) continue;
                const p = seg.text.slice(0, n);
                log(`     全局 indexOf(head${n})=${fullMesText.indexOf(p)}（searchFrom=${domSearchFrom}）`);
            }
        }

        // 单调推进，避免后段落在前段之前
        if (domStart < domSearchFrom) domStart = domSearchFrom;
        const nextVoiceRange = domVoiceRanges.find(range => range.start >= domStart);
        if (nextVoiceRange && domEnd > nextVoiceRange.start) {
            domEnd = nextVoiceRange.start;
        }
        if (domEnd <= domStart) domEnd = Math.min(fullMesText.length, domStart + 1);
        domSearchFrom = domEnd;

        const speakerLabel = voiceOpts.speakerLabel || `Edge:${voiceOpts.voice}`;
        const cacheKey = generateTtsCacheKey(seg.text, '', `narration:${speakerLabel}`);

        items.push({
            type: 'VOICE',
            src: `NARR-${i}-${domStart}`,
            url: blobUrl,
            text: seg.text,        // 朗读文本（cleaned），与音频一一对应
            speedTextLen: String(seg.text || '').length,
            regex: domStart,
            regex_start: domStart,
            regex_end: Math.max(domStart, domEnd - 1),
            clean_regex_start: seg.cleanStart,
            clean_regex_end: Math.max(seg.cleanStart, seg.cleanEnd - 1),
            volume: 100,
            ir_description: '默认 (无)',
            special_effects: '默认',
            spatial: '正前方站立',
            isNarration: true,
            speaker: speakerLabel,
            context: seg.text,
            cacheKey: cacheKey,
        });

        // 同步登记到 tts-cache，让「音频预览」面板能展示和试听
        registerNarrationPreview({
            blob: r.value.blob,
            blobUrl,
            text: seg.text,
            voiceOpts,
            domStart,
            domEnd,
            index: i,
        });
    }

    log(`✅ 旁白生成完成（cleaned 路径）：成功 ${items.length}/${segments.length}（缓存条目 ${narrationCache.size}）`);
    return items;
}

/**
 * 主入口：返回可直接 push 进 finalMusicList 的旁白条目数组。
 * @param {string} fullMesText      DOM 收集到的纯文本（用于光标定位）
 * @param {Array}  voiceItems       已生成的人物对话条目（来自 generatedVoices）
 * @param {Array}  removedRanges    上游 DOM 坐标的跳过区
 * @param {object} [opts]
 * @param {string} [opts.cleanedMesText]  正则清洗后、与 LLM 一致的源文本；
 *                 一旦提供，优先使用它作为旁白朗读内容，杜绝"被跳过文字仍被读出"。
 * @returns {Promise<Array>}
 */
export async function buildNarrationItems(fullMesText, voiceItems, removedRanges, opts = {}) {
    if (!fullMesText) return [];
    const { cleanedMesText, voiceRegexStrings } = opts || {};

    // ============================================================
    //  路径 A：优先使用 cleanedMesText 作为朗读源（与 LLM 一致）
    //  这条路径绕过 DOM 坐标 / removedRanges，直接朗读"已经被正则清洗"的文本，
    //  从根本上保证旁白绝不会读到任何被正则去除的内容。
    //  对话占位 / 光标定位仍然用 fullMesText 做 indexOf 查找。
    // ============================================================
    if (typeof cleanedMesText === 'string' && cleanedMesText.trim().length > 0) {
        log(`✂️  使用 cleanedMesText 作为朗读源（长度 ${cleanedMesText.length}，DOM ${fullMesText.length}）`);
        return await buildFromCleanedText(cleanedMesText, fullMesText, voiceItems, voiceRegexStrings, opts);
    }

    // ============================================================
    //  路径 B：兜底（当 cleanedMesText 未提供时）—— 仍走 DOM + 跳过区方案
    // ============================================================
    log('⚠️  cleanedMesText 未提供，回退到 DOM + skipRanges 模式');

    const upstreamSkip = mergeRanges(removedRanges || []);
    const localSkip = mergeRanges(computeRegexSkipRanges(fullMesText));
    const skipRanges = mergeRanges([...upstreamSkip, ...localSkip]);

    const occupied = buildOccupiedRanges(fullMesText, voiceItems, skipRanges);
    let gaps = subtractRanges(fullMesText.length, occupied);
    gaps = clipGapsAgainstSkips(gaps, skipRanges);

    log(`📐 fullMesText.length=${fullMesText.length} skipRanges(上游=${upstreamSkip.length} + 本地正则=${localSkip.length} = 合并 ${skipRanges.length}) voiceItems=${(voiceItems || []).length} occupied=${occupied.length} gaps=${gaps.length}`);
    if (skipRanges.length) {
        log('   skipRanges =', JSON.stringify(skipRanges.slice(0, 8)) + (skipRanges.length > 8 ? '…' : ''));
    }
    if (gaps.length) {
        log('   gaps =', JSON.stringify(gaps.slice(0, 6)) + (gaps.length > 6 ? '…' : ''));
    }

    const segments = [];
    for (const g of gaps) {
        segments.push(...segmentGap(fullMesText, g));
    }

    if (!segments.length) {
        log('无旁白片段（全文已被对话/跳过区覆盖）');
        return [];
    }

    // 最终安全网：丢弃任何与 skipRange 重叠的段（理论上不该出现，出现则是上游 bug）
    const safeSegments = [];
    for (const s of segments) {
        const overlap = skipRanges.find(sr => sr.start < s.end && sr.end > s.start);
        if (overlap) {
            log(`⚠️  丢弃越界段 [${s.start},${s.end}) 与 skip [${overlap.start},${overlap.end}) 重叠：${s.text.slice(0, 30)}…`);
            continue;
        }
        safeSegments.push(s);
    }

    log(`准备合成 ${safeSegments.length} 段旁白（占用 ${occupied.length} 段，gap ${gaps.length} 段）`);
    safeSegments.forEach((s, i) => {
        const preview = s.text.replace(/\s+/g, ' ').slice(0, 40);
        log(`  seg#${i} [${s.start},${s.end}) len=${s.end - s.start} "${preview}${s.text.length > 40 ? '…' : ''}"`);
    });

    const voiceOpts = readNarrationVoiceOpts();
    await _expandNimoOpts(voiceOpts);

    // 并发数：Edge 按可用代理服务器数量动态调整；Nimo 直连 API，用 NIMO_CONCURRENCY；MiniMax 用 MINIMAX_CONCURRENCY
    const concurrency = voiceOpts.engine === 'nimo'
        ? NIMO_CONCURRENCY
        : voiceOpts.engine === 'minimax'
            ? MINIMAX_CONCURRENCY
            : Math.max(CONCURRENCY_MIN, Math.min(CONCURRENCY_MAX, (getAvailableServers?.() || []).length || CONCURRENCY_MIN));
    log(`🚀 并发=${concurrency}（engine=${voiceOpts.engine}）`);

    let settled;
    if (opts && opts.fakeTTS) {
        const cpm = opts.cpm || 600;
        settled = safeSegments.map((seg, i) => {
            const charLen = String(seg.text || '').length;
            const durationSecs = (charLen / cpm) * 60;
            const blobUrl = `virtual-voice://?duration=${durationSecs.toFixed(3)}`;
            return {
                status: 'fulfilled',
                value: { seg, blobUrl, blob: null }
            };
        });
        log(`[NARR-DBG] 启用了伪旁白，共生成 ${settled.length} 个虚拟音频。`);
    } else {
        const notifSource = `narration-${voiceOpts.engine}`;
        const notifLabel = voiceOpts.engine === 'nimo' ? '旁白(MiMo)'
            : voiceOpts.engine === 'minimax' ? '旁白(MiniMax)'
            : '旁白(Edge)';
        ttsNotifyBatchStart(notifSource, notifLabel, safeSegments.length);
        try {
            settled = await runWithLimit(safeSegments, concurrency, async (seg) => {
                try {
                    const entry = await getOrFetchEdge(seg.text, voiceOpts);
                    // 命中缓存时，每次都用 entry.blob 重新 createObjectURL，避免上一次播放完后旧 url 已被释放
                    let blobUrl = entry.blobUrl;
                    if (entry.blob) {
                        blobUrl = URL.createObjectURL(entry.blob);
                    }
                    return { seg, blobUrl, blob: entry.blob };
                } finally {
                    ttsNotifyBatchEnd(notifSource, 1);
                }
            });
        } catch (e) {
            ttsNotifyBatchEnd(notifSource, safeSegments.length);
            throw e;
        }
    }

    const items = [];
    for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status !== 'fulfilled') {
            log(`段 #${i} 合成失败：${r.reason?.message || r.reason}`);
            continue;
        }
        const { seg, blobUrl } = r.value;
        const speakerLabel = voiceOpts.speakerLabel || `Edge:${voiceOpts.voice}`;
        const cacheKey = generateTtsCacheKey(seg.text, '', `narration:${speakerLabel}`);

        items.push({
            type: 'VOICE',                  // 复用 playback.js 的 VOICE 分支
            src: `NARR-${i}-${seg.start}`,
            url: blobUrl,
            text: seg.text,
            speedTextLen: String(seg.text || '').length,
            regex: seg.start,
            regex_start: seg.start,
            regex_end: Math.max(seg.start, seg.end - 1),
            clean_regex_start: seg.start,
            clean_regex_end: Math.max(seg.start, seg.end - 1),
            volume: 100,
            ir_description: '默认 (无)',
            special_effects: '默认',
            spatial: '正前方站立',
            isNarration: true,
            speaker: speakerLabel,
            context: seg.text,
            cacheKey: cacheKey,
        });

        // 同步登记到 tts-cache，让「音频预览」面板能展示和试听
        registerNarrationPreview({
            blob: r.value.blob,
            blobUrl,
            text: seg.text,
            voiceOpts,
            domStart: seg.start,
            domEnd: seg.end,
            index: i,
        });
    }

    log(`✅ 旁白生成完成：成功 ${items.length}/${safeSegments.length}（缓存条目 ${narrationCache.size}）`);
    return items;
}

// @ts-nocheck
/**
 * cleaned → DOM 字符位置对齐算法。
 *
 * 详细设计见 docs/plan-cleaned-to-dom-alignment.md。
 *
 * 当前实现阶段：M1–M5
 *   M1 归一化层（含 idxMap 回投）+ 阶段 A 倒排索引 + 阶段 B 双向唯一锚点 + 贪婪扩张
 *   M2 阶段 C：Needleman-Wunsch 段内对齐 + C-fallback（线性插值 + 局部 NW）
 *   M3 阶段 D：跳过区导出 + 孤岛吸收 + §0.5 不变量断言（含匹配率底线）
 *   M5 大消息分块（>50K，按 \n\n+ 切段）+ LRU 缓存（FNV-1a 哈希）
 *
 * 未实现：M7 VOICE regex 近似匹配、罕见字优先锚定。
 */

export class AlignmentError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'AlignmentError';
        this.details = details || null;
    }
}

/* ─────────────────────────── 归一化层 ─────────────────────────── */

// 引号统一为 "
const QUOTE_CHARS = new Set([
    0x22,   // "
    0x27,   // '
    0x60,   // `
    0x201C, 0x201D, 0x201E,  // “ ” „
    0x2018, 0x2019, 0x201A,  // ‘ ’ ‚
    0x00AB, 0x00BB,          // « »
    0x300A, 0x300B,          // 《 》
    0x300C, 0x300D,          // 「 」
    0x300E, 0x300F,          // 『 』
]);

// 中文标点 → 半角
const PUNCT_FOLD = {
    '？': '?', '！': '!', '：': ':', '；': ';', '，': ',', '。': '.',
};

// 空白码点
const WHITESPACE_CODES = new Set([
    0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20,
    0x00A0,   // NBSP
    0x3000,   // 全角空格
    0x200B,   // 零宽空格
]);

// 不可见控制字符 → 删除
function isInvisibleControl(code) {
    // BiDi 控制字符
    if (code >= 0x200C && code <= 0x200F) return true;
    if (code >= 0x202A && code <= 0x202E) return true;
    if (code === 0x2060 || code === 0xFEFF) return true; // word joiner / BOM
    if (code === 0x00AD) return true;                     // soft hyphen
    if (code >= 0xFE00 && code <= 0xFE0F) return true;    // variation selectors
    return false;
}

// Markdown 装饰符 → 删除（仅当成对出现的"标记字符"，保留正文）。
// 注意：M1 阶段保守处理，先剔除所有 * _ ` ~。后续若发现误杀正文里的星号/下划线，再细化。
const MD_DECORATIONS = new Set(['*', '_', '`', '~']);

/**
 * 归一化文本：折叠引号/标点/空白，剔除控制字符与 MD 装饰符。
 * 同时产出 idxMap：去噪空间下标 i → 原始下标。
 *
 * @param {string} text
 * @returns {{ norm: string, idxMap: Int32Array }}
 */
export function normalizeForAlign(text) {
    if (typeof text !== 'string' || text.length === 0) {
        return { norm: '', idxMap: new Int32Array(0) };
    }
    const out = [];
    const idxMap = [];
    let lastWasSpace = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const code = text.charCodeAt(i);

        if (isInvisibleControl(code)) continue;
        if (MD_DECORATIONS.has(ch)) continue;

        // 空白折叠成单个 ␣（这里用 ASCII 空格 0x20 作为代表）
        if (WHITESPACE_CODES.has(code)) {
            if (lastWasSpace) continue;
            out.push(' ');
            idxMap.push(i);
            lastWasSpace = true;
            continue;
        }
        lastWasSpace = false;

        // 引号统一
        if (QUOTE_CHARS.has(code)) {
            out.push('"');
            idxMap.push(i);
            continue;
        }

        // 中文标点折叠
        if (PUNCT_FOLD[ch] !== undefined) {
            out.push(PUNCT_FOLD[ch]);
            idxMap.push(i);
            continue;
        }

        // ASCII 字母小写
        if (code >= 0x41 && code <= 0x5A) {
            out.push(String.fromCharCode(code + 32));
            idxMap.push(i);
            continue;
        }

        out.push(ch);
        idxMap.push(i);
    }
    return { norm: out.join(''), idxMap: Int32Array.from(idxMap) };
}

/* ─────────────────────────── 阶段 A：倒排索引 ─────────────────────────── */

/**
 * 对去噪文本构造字符 → 升序下标数组的倒排索引。
 * @param {string} domNorm
 * @returns {Map<string, Uint32Array>}
 */
export function buildCharIndex(domNorm) {
    const tmp = new Map();
    for (let i = 0; i < domNorm.length; i++) {
        const ch = domNorm[i];
        let arr = tmp.get(ch);
        if (!arr) { arr = []; tmp.set(ch, arr); }
        arr.push(i);
    }
    const out = new Map();
    for (const [ch, arr] of tmp) out.set(ch, Uint32Array.from(arr));
    return out;
}

/* ─────────────────────────── 阶段 B：n-gram 锚点 ─────────────────────────── */

const DEFAULT_NGRAM_LENGTHS = [12, 8, 5, 3];

/**
 * 在 haystack 中统计 needle 的不重叠出现次数（最多到 cap），返回 [count, firstIndex]。
 * 用不重叠 indexOf 而非 KMP/Boyer-Moore，足够 M1 用。
 */
function countOccurrences(haystack, needle, cap = 3) {
    if (!needle) return [0, -1];
    let count = 0;
    let firstIdx = -1;
    let from = 0;
    while (count < cap) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1) break;
        if (firstIdx === -1) firstIdx = idx;
        count += 1;
        from = idx + needle.length; // 不重叠
    }
    return [count, firstIdx];
}

/**
 * 在 cleanedNorm 上按 ngramLen 扫描，对每个候选 gram 做双向唯一性检查。
 * 命中即推入锚点列表（cs/ce/ds/de，闭开区间，去噪空间下标）。
 *
 * @param {string} cleanedNorm
 * @param {string} domNorm
 * @param {number} ngramLen
 * @param {Uint8Array} cleanedClaimed  长度=cleanedNorm.length；已被先前锚点覆盖的位置为 1
 * @param {Uint8Array} domClaimed      长度=domNorm.length；已被先前锚点覆盖的位置为 1
 * @returns {{cs:number,ce:number,ds:number,de:number,gram:string,kind:'hard'}[]}
 */
function findUniqueAnchorsForLen(cleanedNorm, domNorm, ngramLen, cleanedClaimed, domClaimed) {
    const out = [];
    const N = cleanedNorm.length;
    if (ngramLen <= 0 || N < ngramLen) return out;

    let j = 0;
    while (j <= N - ngramLen) {
        // 跳过已被先前锚点覆盖的位置
        if (cleanedClaimed[j]) { j += 1; continue; }

        const gram = cleanedNorm.substr(j, ngramLen);

        // cleaned 中必须仅出现一次（不重叠计数 ≤ 1）
        const [cCount] = countOccurrences(cleanedNorm, gram, 2);
        if (cCount !== 1) { j += 1; continue; }

        // DOM 中必须仅出现一次
        const [dCount, dHit] = countOccurrences(domNorm, gram, 2);
        if (dCount !== 1) { j += 1; continue; }

        // DOM 命中位置不能落在已锚定区内
        let overlap = false;
        for (let k = 0; k < ngramLen; k++) {
            if (domClaimed[dHit + k]) { overlap = true; break; }
        }
        if (overlap) { j += 1; continue; }

        out.push({
            cs: j, ce: j + ngramLen,
            ds: dHit, de: dHit + ngramLen,
            gram, kind: 'hard',
        });

        // 推进，避免在同段内重复触发
        j += ngramLen;
    }
    return out;
}

/**
 * 锚点贪婪扩张：在保持 cleanedNorm[k] === domNorm[k'] 的前提下尽量延展边界。
 * 不能越过已锚定的相邻区间。
 */
function expandAnchor(anchor, cleanedNorm, domNorm, cleanedClaimed, domClaimed) {
    let { cs, ce, ds, de } = anchor;

    while (cs > 0 && ds > 0
        && !cleanedClaimed[cs - 1] && !domClaimed[ds - 1]
        && cleanedNorm[cs - 1] === domNorm[ds - 1]) {
        cs -= 1; ds -= 1;
    }
    while (ce < cleanedNorm.length && de < domNorm.length
        && !cleanedClaimed[ce] && !domClaimed[de]
        && cleanedNorm[ce] === domNorm[de]) {
        ce += 1; de += 1;
    }

    anchor.cs = cs; anchor.ce = ce; anchor.ds = ds; anchor.de = de;
    anchor.gram = cleanedNorm.slice(cs, ce);
    return anchor;
}

/**
 * 提取锚点（多次 ngramLen 由大到小），并执行贪婪扩张。
 * 内部已经维护 cleanedClaimed/domClaimed，避免锚点之间重叠或在 DOM 上越序。
 *
 * @param {string} cleanedNorm
 * @param {string} domNorm
 * @param {object} opts
 * @returns {{
 *   anchors: {cs:number,ce:number,ds:number,de:number,gram:string,kind:string}[],
 *   stats: { hard: number, expandedChars: number },
 * }}
 */
export function extractAnchors(cleanedNorm, domNorm, opts = {}) {
    const lens = opts.ngramLengths || DEFAULT_NGRAM_LENGTHS;
    const cleanedClaimed = new Uint8Array(cleanedNorm.length);
    const domClaimed = new Uint8Array(domNorm.length);
    /** @type {{cs:number,ce:number,ds:number,de:number,gram:string,kind:string}[]} */
    const anchors = [];

    let expandedChars = 0;

    for (const L of lens) {
        const found = findUniqueAnchorsForLen(cleanedNorm, domNorm, L, cleanedClaimed, domClaimed);
        for (const a of found) {
            const before = a.ce - a.cs;
            expandAnchor(a, cleanedNorm, domNorm, cleanedClaimed, domClaimed);
            expandedChars += (a.ce - a.cs) - before;
            for (let k = a.cs; k < a.ce; k++) cleanedClaimed[k] = 1;
            for (let k = a.ds; k < a.de; k++) domClaimed[k] = 1;
            anchors.push(a);
        }
    }

    // 按 cleaned 位置排序，最后强制 DOM 上严格单调（理论上已经满足，但保险）。
    anchors.sort((a, b) => a.cs - b.cs);
    const monotonic = [];
    let lastDe = -1;
    for (const a of anchors) {
        if (a.ds < lastDe) continue;
        monotonic.push(a);
        lastDe = a.de;
    }

    return {
        anchors: monotonic,
        stats: { hard: monotonic.length, expandedChars },
    };
}

/* ─────────────────────────── §0.5 不变量断言 ─────────────────────────── */

/**
 * 检查 cleanToDom 满足设计不变量。违反任意一条立即抛 AlignmentError。
 *
 * @param {Int32Array} cleanToDom 长度 = cleanedText.length（原始空间）
 * @param {string} cleanedText
 * @param {string} domText
 * @param {object} opts
 * @param {boolean} [opts.checkRatio=false]  是否启用匹配率底线（M1 还未做段内对齐，先关）
 * @param {number}  [opts.ratioThreshold=0.7]
 * @param {string} [opts.cleanedNorm]   若提供，会用归一化后的字符做同一性比较
 * @param {string} [opts.domNorm]
 * @param {Int32Array} [opts.cleanedIdxMap]
 * @param {Int32Array} [opts.domIdxMap]
 */
export function assertAlignmentInvariants(cleanToDom, cleanedText, domText, opts = {}) {
    if (!(cleanToDom instanceof Int32Array)) {
        throw new AlignmentError('cleanToDom must be Int32Array', { cleanToDom });
    }
    if (cleanToDom.length !== cleanedText.length) {
        throw new AlignmentError('cleanToDom length mismatch', {
            cleanToDomLen: cleanToDom.length,
            cleanedLen: cleanedText.length,
        });
    }

    // 1) 单调性 + 2) 互斥性（严格递增即互斥）
    let prev = -1;
    let matched = 0;
    for (let j = 0; j < cleanToDom.length; j++) {
        const v = cleanToDom[j];
        if (v < 0) continue;
        if (v >= domText.length) {
            throw new AlignmentError('cleanToDom value out of range', { j, v, domLen: domText.length });
        }
        if (v <= prev) {
            throw new AlignmentError('cleanToDom not strictly monotonic', { j, v, prev });
        }
        prev = v;
        matched += 1;
    }

    // 3) 字符同一性（如调用方提供归一化数据，则在归一化空间检查；否则原文逐字比较）
    const useNorm = opts.cleanedNorm && opts.domNorm
        && opts.cleanedIdxMap && opts.domIdxMap;
    if (useNorm) {
        // cleanToDom 是原始空间，需要反查归一化空间下标
        const cleanedOrigToNorm = invertIdxMap(opts.cleanedIdxMap, cleanedText.length);
        const domOrigToNorm = invertIdxMap(opts.domIdxMap, domText.length);
        for (let j = 0; j < cleanToDom.length; j++) {
            const v = cleanToDom[j];
            if (v < 0) continue;
            const ci = cleanedOrigToNorm[j];
            const di = domOrigToNorm[v];
            if (ci < 0 || di < 0) continue; // 归一化里被剔除的，跳过此校验
            if (opts.cleanedNorm[ci] !== opts.domNorm[di]) {
                throw new AlignmentError('cleanToDom char mismatch', {
                    j, v,
                    cleanedChar: cleanedText[j],
                    domChar: domText[v],
                    cleanedNormChar: opts.cleanedNorm[ci],
                    domNormChar: opts.domNorm[di],
                });
            }
        }
    } else {
        for (let j = 0; j < cleanToDom.length; j++) {
            const v = cleanToDom[j];
            if (v < 0) continue;
            if (cleanedText[j] !== domText[v]) {
                throw new AlignmentError('cleanToDom char mismatch (raw)', {
                    j, v,
                    cleanedChar: cleanedText[j],
                    domChar: domText[v],
                });
            }
        }
    }

    // 5) 匹配率底线（可选）
    if (opts.checkRatio) {
        const readable = countReadable(cleanedText);
        if (readable > 0) {
            const ratio = matched / readable;
            const threshold = opts.ratioThreshold ?? 0.7;
            if (ratio < threshold) {
                throw new AlignmentError('match ratio below threshold', {
                    matched, readable, ratio, threshold,
                });
            }
        }
    }
}

/* ─────────────────────────── 辅助 ─────────────────────────── */

/**
 * 把 idxMap (norm→orig) 反向成 origToNorm (orig→norm, -1=未保留)。
 */
function invertIdxMap(idxMap, origLen) {
    const out = new Int32Array(origLen);
    for (let i = 0; i < out.length; i++) out[i] = -1;
    for (let i = 0; i < idxMap.length; i++) {
        const orig = idxMap[i];
        if (orig >= 0 && orig < origLen) out[orig] = i;
    }
    return out;
}

function countReadable(text) {
    if (!text) return 0;
    return text.replace(/[\s\p{P}\p{S}]/gu, '').length;
}

/* ─────────────────────────── 阶段 C：Needleman-Wunsch ─────────────────────────── */

const NW_MATCH = 2;
const NW_MISMATCH = -3;
const NW_GAP = -1;
const NW_DEFAULT_CELL_LIMIT = 64 * 1024;

/**
 * 对归一化空间的 cleanedNorm[cs, ce) 与 domNorm[ds, de) 做 NW 全局对齐。
 * 返回长度 m = ce-cs 的 Int32Array：每个 cleaned 字符的 DOM 下标（归一化空间），-1 = 未投射（gap-in-dom）。
 *
 * 评分：
 *   match (字符相等)         +2  （±1 上下文一致再 +1，单边 +0.5 取整 → 这里近似为各 +1）
 *   mismatch                 -3
 *   gap-in-dom (cleaned 多)  -1
 *   gap-in-cleaned (DOM 多)  -1
 *
 * 复杂度 O(m·n) 时间和 O(m·n) 空间。调用前应保证 m·n ≤ NW_DEFAULT_CELL_LIMIT。
 */
export function alignSegmentNW(cleanedNorm, domNorm, cs, ce, ds, de) {
    const m = ce - cs;
    const n = de - ds;
    const out = new Int32Array(m);
    for (let i = 0; i < m; i++) out[i] = -1;
    if (m === 0 || n === 0) return out;

    const W = n + 1;
    const dp = new Int32Array((m + 1) * W);
    const trace = new Uint8Array((m + 1) * W); // 0=diag, 1=up (gap-dom), 2=left (gap-cleaned)

    for (let i = 1; i <= m; i++) { dp[i * W] = i * NW_GAP; trace[i * W] = 1; }
    for (let j = 1; j <= n; j++) { dp[j] = j * NW_GAP; trace[j] = 2; }

    for (let i = 1; i <= m; i++) {
        const ci = cleanedNorm.charCodeAt(cs + i - 1);
        const rowBase = i * W;
        const prevRow = (i - 1) * W;
        for (let j = 1; j <= n; j++) {
            const dj = domNorm.charCodeAt(ds + j - 1);

            let matchScore;
            if (ci === dj) {
                matchScore = NW_MATCH;
                // ±1 上下文加分
                if (i > 1 && j > 1
                    && cleanedNorm.charCodeAt(cs + i - 2) === domNorm.charCodeAt(ds + j - 2)) {
                    matchScore += 1;
                }
                if (i < m && j < n
                    && cleanedNorm.charCodeAt(cs + i) === domNorm.charCodeAt(ds + j)) {
                    matchScore += 1;
                }
            } else {
                matchScore = NW_MISMATCH;
            }

            const diag = dp[prevRow + j - 1] + matchScore;
            const up = dp[prevRow + j] + NW_GAP;
            const left = dp[rowBase + j - 1] + NW_GAP;

            let best = diag;
            let dir = 0;
            if (up > best) { best = up; dir = 1; }
            if (left > best) { best = left; dir = 2; }
            dp[rowBase + j] = best;
            trace[rowBase + j] = dir;
        }
    }

    // 回溯：仅在 diag 且字符相等时记录映射
    let i = m, j = n;
    while (i > 0 && j > 0) {
        const dir = trace[i * W + j];
        if (dir === 0) {
            if (cleanedNorm.charCodeAt(cs + i - 1) === domNorm.charCodeAt(ds + j - 1)) {
                out[i - 1] = ds + j - 1;
            }
            i -= 1; j -= 1;
        } else if (dir === 1) {
            i -= 1;
        } else {
            j -= 1;
        }
    }
    return out;
}

/**
 * C-fallback：线性插值 + 局部 ±radius 字符匹配。
 * 用于 m·n 超过 cell 上限的段。
 */
export function alignSegmentLocal(cleanedNorm, domNorm, cs, ce, ds, de, radius = 8) {
    const m = ce - cs;
    const n = de - ds;
    const out = new Int32Array(m);
    for (let i = 0; i < m; i++) out[i] = -1;
    if (m === 0 || n === 0) return out;

    let lastMapped = ds - 1;
    for (let i = 0; i < m; i++) {
        const ci = cleanedNorm.charCodeAt(cs + i);
        const expected = ds + Math.floor(i * n / m);
        const lo = Math.max(lastMapped + 1, expected - radius);
        const hi = Math.min(de, expected + radius + 1);
        let bestJ = -1;
        let bestDist = Infinity;
        for (let j = lo; j < hi; j++) {
            if (domNorm.charCodeAt(j) === ci) {
                const d = Math.abs(j - expected);
                if (d < bestDist) { bestDist = d; bestJ = j; }
            }
        }
        if (bestJ >= 0) {
            out[i] = bestJ;
            lastMapped = bestJ;
        }
    }
    return out;
}

/* ─────────────────────────── 阶段 D：跳过区导出 ─────────────────────────── */

// 可吸收为孤岛的字符：空白、Markdown 装饰符、常见列表/项目符号、横线类。
const ABSORBABLE_CHAR_RE = /^[\s*_`~•▸▪‣◦►▶◆◇■□●○\-–—]$/;

/**
 * 由 cleanToDom 反推 DOM 跳过区，并做孤岛吸收。
 *
 * 孤岛吸收：长度 ≤ 2、内容全为空白/装饰类字符、左右紧邻匹配字符的 skip 段被合并回匹配区，
 * 处理 MD 渲染时 DOM 主动多出的小段（列表前缀 "▸ "、行号 "1. " 等）。
 *
 * @returns {{start:number,end:number}[]}
 */
export function buildSkipRanges(cleanToDom, domText) {
    const domLen = domText.length;
    const matched = new Uint8Array(domLen);
    for (let j = 0; j < cleanToDom.length; j++) {
        const v = cleanToDom[j];
        if (v >= 0 && v < domLen) matched[v] = 1;
    }

    // 孤岛吸收
    let runStart = -1;
    for (let i = 0; i <= domLen; i++) {
        const cur = i < domLen ? matched[i] : 1;
        if (!cur && runStart === -1) {
            runStart = i;
        } else if (cur && runStart !== -1) {
            const len = i - runStart;
            if (len <= 2 && runStart > 0 && i < domLen) {
                let absorbable = true;
                for (let k = runStart; k < i; k++) {
                    if (!ABSORBABLE_CHAR_RE.test(domText[k])) { absorbable = false; break; }
                }
                if (absorbable) {
                    for (let k = runStart; k < i; k++) matched[k] = 1;
                }
            }
            runStart = -1;
        }
    }

    // 收集 0-run，相邻 ≤ 1 间隙合并
    const ranges = [];
    runStart = -1;
    for (let i = 0; i <= domLen; i++) {
        const cur = i < domLen ? matched[i] : 1;
        if (!cur && runStart === -1) runStart = i;
        else if (cur && runStart !== -1) {
            ranges.push({ start: runStart, end: i });
            runStart = -1;
        }
    }
    const merged = [];
    for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r.start - last.end <= 1) {
            last.end = r.end;
        } else {
            merged.push({ start: r.start, end: r.end });
        }
    }
    return merged;
}

/* ─────────────────────────── 缓存（FNV-1a + LRU） ─────────────────────────── */

/** 32-bit FNV-1a 字符串哈希（无加密性，仅用作缓存 key 区分）。 */
function fnv1a32(s) {
    let h = 0x811C9DC5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

class LRUCache {
    constructor(max = 16) {
        this.max = max;
        this.map = new Map();
    }
    get(k) {
        if (!this.map.has(k)) return undefined;
        const v = this.map.get(k);
        this.map.delete(k); this.map.set(k, v);
        return v;
    }
    set(k, v) {
        if (this.map.has(k)) this.map.delete(k);
        else if (this.map.size >= this.max) {
            const oldest = this.map.keys().next().value;
            this.map.delete(oldest);
        }
        this.map.set(k, v);
    }
    clear() { this.map.clear(); }
    get size() { return this.map.size; }
}

const _alignCache = new LRUCache(16);

export function clearAlignmentCache() { _alignCache.clear(); }

/* ─────────────────────────── 大消息分块 ─────────────────────────── */

const CHUNK_THRESHOLD = 50000;

/** 在 text 上按 \n\n+ 切段，返回 [{start, end, text}]（end 闭开，包含分隔空行）。 */
function splitParagraphs(text) {
    const parts = [];
    const re = /\n{2,}/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        parts.push({ start: last, end: m.index, text: text.slice(last, m.index) });
        last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ start: last, end: text.length, text: text.slice(last) });
    return parts;
}

/* ─────────────────────────── 主入口 ─────────────────────────── */

/**
 * 对 cleanedText 在 domText 上做位置对齐。
 *
 * 流程：归一化 → 阶段 A 倒排索引 → 阶段 B 双向唯一锚点 + 贪婪扩张 →
 *      阶段 C 段间 NW（超大段走 C-fallback）→ 阶段 D 跳过区 + 孤岛吸收 → §0.5 不变量断言。
 *
 * @param {string} cleanedText
 * @param {string} domText
 * @param {object} [options]
 * @param {boolean} [options.enableCache=true]
 * @param {boolean} [options.checkRatio=true]
 * @param {number}  [options.ratioThreshold=0.7]
 * @param {number[]}[options.ngramLengths]
 * @param {number}  [options.nwCellLimit]
 * @returns {{
 *   cleanToDom: Int32Array,
 *   domSkipRanges: {start:number,end:number}[],
 *   anchors: object[],
 *   stats: object,
 *   stage: string,
 *   cacheHit: boolean
 * }}
 */
export function alignCleanedToDom(cleanedText, domText, options = {}) {
    const t0 = nowMs();
    const enableCache = options.enableCache !== false;

    const cleanToDom = new Int32Array(cleanedText.length);
    for (let i = 0; i < cleanToDom.length; i++) cleanToDom[i] = -1;

    if (!cleanedText || !domText) {
        return makeEmptyResult(cleanToDom, t0);
    }

    // 缓存命中
    let cacheKey = null;
    if (enableCache) {
        cacheKey = fnv1a32(cleanedText) + ':' + fnv1a32(domText);
        const cached = _alignCache.get(cacheKey);
        if (cached) return { ...cached, cacheHit: true };
    }

    // 大消息分块
    if (cleanedText.length > CHUNK_THRESHOLD) {
        const result = alignChunked(cleanedText, domText, options);
        if (enableCache && cacheKey) _alignCache.set(cacheKey, result);
        return result;
    }

    const cleanedN = normalizeForAlign(cleanedText);
    const domN = normalizeForAlign(domText);

    const { anchors: anchorsNorm, stats: anchorStats } =
        extractAnchors(cleanedN.norm, domN.norm, options);

    // 在归一化空间填充 cleanToDomNorm（先锚点，再段间 NW）
    const cleanToDomNorm = new Int32Array(cleanedN.norm.length);
    for (let i = 0; i < cleanToDomNorm.length; i++) cleanToDomNorm[i] = -1;
    for (const a of anchorsNorm) {
        for (let k = 0; k < a.ce - a.cs; k++) cleanToDomNorm[a.cs + k] = a.ds + k;
    }

    // 段间区间：[prevCe, nextCs) × [prevDe, nextDs)，含开头与结尾两段
    const cellLimit = options.nwCellLimit || NW_DEFAULT_CELL_LIMIT;
    let prevCe = 0, prevDe = 0;
    let nwSegments = 0, fallbackSegments = 0;
    const runSegment = (cs, ce, ds, de) => {
        const m = ce - cs, n = de - ds;
        if (m <= 0 || n <= 0) return;
        let mapping;
        if (m * n <= cellLimit) {
            mapping = alignSegmentNW(cleanedN.norm, domN.norm, cs, ce, ds, de);
            nwSegments += 1;
        } else {
            mapping = alignSegmentLocal(cleanedN.norm, domN.norm, cs, ce, ds, de);
            fallbackSegments += 1;
        }
        for (let k = 0; k < mapping.length; k++) {
            if (mapping[k] >= 0) cleanToDomNorm[cs + k] = mapping[k];
        }
    };
    for (const a of anchorsNorm) {
        runSegment(prevCe, a.cs, prevDe, a.ds);
        prevCe = a.ce; prevDe = a.de;
    }
    runSegment(prevCe, cleanedN.norm.length, prevDe, domN.norm.length);

    // 投回原始空间
    let matched = 0;
    for (let nj = 0; nj < cleanToDomNorm.length; nj++) {
        const ni = cleanToDomNorm[nj];
        if (ni < 0) continue;
        const origJ = cleanedN.idxMap[nj];
        const origI = domN.idxMap[ni];
        if (origJ < 0 || origI < 0) continue;
        // 单调性保险：保留首次写入（极少情况下 norm→orig 多对一）
        if (cleanToDom[origJ] === -1) {
            cleanToDom[origJ] = origI;
            matched += 1;
        }
    }

    // 阶段 D
    const domSkipRanges = buildSkipRanges(cleanToDom, domText);

    // §0.5 不变量断言（含匹配率）
    assertAlignmentInvariants(cleanToDom, cleanedText, domText, {
        checkRatio: options.checkRatio !== false,
        ratioThreshold: options.ratioThreshold ?? 0.7,
        cleanedNorm: cleanedN.norm,
        domNorm: domN.norm,
        cleanedIdxMap: cleanedN.idxMap,
        domIdxMap: domN.idxMap,
    });

    // 锚点回投到原始空间
    const anchorsOrig = anchorsNorm.map(a => ({
        ...a,
        csOrig: cleanedN.idxMap[a.cs],
        ceOrig: cleanedN.idxMap[a.ce - 1] + 1,
        dsOrig: domN.idxMap[a.ds],
        deOrig: domN.idxMap[a.de - 1] + 1,
    }));

    const result = {
        cleanToDom,
        domSkipRanges,
        anchors: anchorsOrig,
        stats: {
            matched,
            anchorsHard: anchorStats.hard,
            anchorExpandedChars: anchorStats.expandedChars,
            nwSegments,
            fallbackSegments,
            elapsedMs: nowMs() - t0,
            normCleanedLen: cleanedN.norm.length,
            normDomLen: domN.norm.length,
            skipRangeCount: domSkipRanges.length,
        },
        stage: 'M3',
        cacheHit: false,
    };

    if (enableCache && cacheKey) _alignCache.set(cacheKey, result);
    return result;
}

/**
 * 大消息分块对齐：按 \n\n+ 切段，逐段独立对齐后拼接。
 */
function alignChunked(cleanedText, domText, options) {
    const t0 = nowMs();
    const cParts = splitParagraphs(cleanedText);
    const dParts = splitParagraphs(domText);

    const cleanToDom = new Int32Array(cleanedText.length);
    for (let i = 0; i < cleanToDom.length; i++) cleanToDom[i] = -1;
    let totalMatched = 0, totalAnchors = 0, totalNw = 0, totalFallback = 0;
    const allAnchors = [];

    // 简易 1:1 配对：如果段数相同直接对齐；否则按比例选 min。
    // 真正的双向 ngram 配段比较复杂，此处先用顺序配对；后续可优化。
    const pairs = Math.min(cParts.length, dParts.length);
    for (let p = 0; p < pairs; p++) {
        const cp = cParts[p], dp = dParts[p];
        if (!cp.text || !dp.text) continue;
        try {
            const sub = alignCleanedToDom(cp.text, dp.text, {
                ...options,
                enableCache: false,
                checkRatio: false, // 子段单独评估匹配率不可靠
            });
            for (let j = 0; j < sub.cleanToDom.length; j++) {
                const v = sub.cleanToDom[j];
                if (v >= 0) cleanToDom[cp.start + j] = dp.start + v;
            }
            totalMatched += sub.stats.matched;
            totalAnchors += sub.stats.anchorsHard;
            totalNw += sub.stats.nwSegments || 0;
            totalFallback += sub.stats.fallbackSegments || 0;
            for (const a of sub.anchors) {
                allAnchors.push({
                    ...a,
                    csOrig: cp.start + (a.csOrig ?? 0),
                    ceOrig: cp.start + (a.ceOrig ?? 0),
                    dsOrig: dp.start + (a.dsOrig ?? 0),
                    deOrig: dp.start + (a.deOrig ?? 0),
                });
            }
        } catch (e) {
            // 子段失败：跳过，留 -1
            if (e && e.name === 'AlignmentError') continue;
            throw e;
        }
    }

    const domSkipRanges = buildSkipRanges(cleanToDom, domText);

    // 顶层不变量检查
    assertAlignmentInvariants(cleanToDom, cleanedText, domText, {
        checkRatio: options.checkRatio !== false,
        ratioThreshold: options.ratioThreshold ?? 0.5, // 分块时阈值放宽
    });

    return {
        cleanToDom,
        domSkipRanges,
        anchors: allAnchors,
        stats: {
            matched: totalMatched,
            anchorsHard: totalAnchors,
            anchorExpandedChars: 0,
            nwSegments: totalNw,
            fallbackSegments: totalFallback,
            elapsedMs: nowMs() - t0,
            normCleanedLen: -1,
            normDomLen: -1,
            skipRangeCount: domSkipRanges.length,
            chunked: true,
            chunkPairs: pairs,
        },
        stage: 'M5-chunked',
        cacheHit: false,
    };
}

function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function makeEmptyResult(cleanToDom, t0) {
    return {
        cleanToDom,
        domSkipRanges: [],
        anchors: [],
        stats: {
            matched: 0, anchorsHard: 0, anchorExpandedChars: 0,
            nwSegments: 0, fallbackSegments: 0,
            elapsedMs: nowMs() - t0,
            normCleanedLen: 0, normDomLen: 0, skipRangeCount: 0,
        },
        stage: 'empty',
        cacheHit: false,
    };
}

/* ─────────────────────────── 旧 API 适配器（M4 集成用） ─────────────────────────── */

/**
 * 兼容 `index.js: buildSourceToDomCharMap(domText, sourceText)` 的签名。
 * 调用方原本期待：null（失败）、空数组、或 length=S 的 Array<number>（DOM 下标或 -1）。
 *
 * 新算法 cleanToDom 是 Int32Array；这里转成普通 Array 以保持完全兼容。
 *
 * @param {string} domText
 * @param {string} sourceText
 * @returns {number[] | null}
 */
export function alignAndBuildSourceToDom(domText, sourceText) {
    if (typeof domText !== 'string' || typeof sourceText !== 'string') return null;
    if (sourceText.length === 0) return [];
    if (domText.length === 0) return new Array(sourceText.length).fill(-1);
    try {
        const r = alignCleanedToDom(sourceText, domText, { checkRatio: false });
        return Array.from(r.cleanToDom);
    } catch (e) {
        if (e && e.name === 'AlignmentError') return null;
        throw e;
    }
}

/**
 * 兼容 `helpers.js: computeSkipRangesByDiff(domText, cleanedText)` 的签名。
 * 调用方原本期待：Array<{start,end}> 或 null（文本太长）。
 *
 * @param {string} domText
 * @param {string} cleanedText
 * @returns {{start:number,end:number}[] | null}
 */
export function alignAndComputeSkipRanges(domText, cleanedText) {
    if (typeof domText !== 'string' || typeof cleanedText !== 'string') return null;
    if (cleanedText.length === 0 || domText.length === 0) return [];
    try {
        const r = alignCleanedToDom(cleanedText, domText, { checkRatio: false });
        return r.domSkipRanges || [];
    } catch (e) {
        if (e && e.name === 'AlignmentError') return null;
        throw e;
    }
}

/**
 * 兼容 `index.js: mapSourceRangeToDomRange(sourceToDom, start, end)` 的签名。
 * sourceToDom 既可以是 Array<number>（旧）也可以是 Int32Array（新），统一处理。
 */
export function compatMapSourceRangeToDom(sourceToDom, sourceStart, sourceEnd) {
    if (!sourceToDom || !Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) {
        return null;
    }
    return mapCleanRangeToDom(sourceToDom, sourceStart, sourceEnd);
}

/**
 * 兼容旧 mapSourceRangeToDomRange 的便捷函数。
 * 在 cleanToDom 区间 [cs, ce) 内找首尾有效投射，返回 DOM 空间 [start, end)。
 * 同时支持 Int32Array 与普通 Array<number>。
 */
export function mapCleanRangeToDom(cleanToDom, cs, ce) {
    if (!cleanToDom || !Number.isFinite(cs) || !Number.isFinite(ce) || ce <= cs) return null;
    const lo = Math.max(0, cs);
    const hi = Math.min(cleanToDom.length, ce);
    let start = -1;
    for (let j = lo; j < hi; j++) {
        if (cleanToDom[j] >= 0) { start = cleanToDom[j]; break; }
    }
    if (start < 0) return null;
    let end = -1;
    for (let j = hi - 1; j >= lo; j--) {
        if (cleanToDom[j] >= 0) { end = cleanToDom[j] + 1; break; }
    }
    if (end <= start) return null;
    return { start, end };
}

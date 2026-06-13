import { getContext } from "../../../../st-context.js";
import { alignAndComputeSkipRanges } from "./text-alignment.js";

let cachedCsrfToken = '';

function setCachedCsrfToken(token) {
    if (typeof token === 'string' && token) {
        cachedCsrfToken = token;
    }
    return cachedCsrfToken;
}

function getCurrentCsrfToken(token) {
    if (typeof token === 'string' && token) {
        return token;
    }
    const liveToken = typeof window !== 'undefined' ? window.token : undefined;
    if (typeof liveToken === 'string' && liveToken) {
        return liveToken;
    }
    return cachedCsrfToken || '';
}

async function refreshCsrfToken() {
    const response = await fetch('/csrf-token', { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`Failed to refresh CSRF token: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const nextToken = typeof data?.token === 'string' ? data.token : '';
    if (!nextToken) {
        throw new Error('Failed to refresh CSRF token: empty token');
    }
    cachedCsrfToken = nextToken;
    if (typeof window !== 'undefined') {
        window.token = nextToken;
    }
    return nextToken;
}

function getRequestHeaders(token) {
    const resolvedToken = getCurrentCsrfToken(token);
    return {
        'Content-Type': 'application/json',
        ...(resolvedToken ? { 'X-CSRF-Token': resolvedToken } : {}),
    };
}

async function fetchWithCsrf(input, init = {}, token) {
    const buildInit = (csrfToken) => {
        const headers = new Headers(init.headers || {});
        if (csrfToken) {
            headers.set('X-CSRF-Token', csrfToken);
        }
        return { ...init, headers };
    };

    const response = await fetch(input, buildInit(getCurrentCsrfToken(token)));
    if (response.status !== 403) {
        return response;
    }

    let invalidCsrf = false;
    try {
        const responseText = await response.clone().text();
        invalidCsrf = /invalid csrf token/i.test(responseText);
    } catch (error) {
        console.warn('[st-immersive-sound] Failed to inspect CSRF error response:', error);
    }

    if (!invalidCsrf) {
        return response;
    }

    const refreshedToken = await refreshCsrfToken();
    return fetch(input, buildInit(refreshedToken));
}

function getParagraphOffsetsRange(fullText, paragraph1, paragraph2, src, isFirstMusic = false, settings = {},lastMusicEnd,isMusic) {
    console.log("src", src);

    // 检查输入是否有效，不允许空字符串
    if (!paragraph1 || !paragraph2) {
        return [-1, `音频《${src}》起始或结束段落无效或为空。起始: "${paragraph1}", 结束: "${paragraph2}"`];
    }

    // 规范化引号和标点以处理中英文全角/半角差异
    const normalize = (text) => {
        if (typeof text !== 'string') {
            return text;
        }
        // 同时替换中英文的引号和常用标点
        return text
            .replace(/[“”]/g, '"')  // 双引号
            .replace(/[‘’'`]/g, '"')  // 单引号和反引号全部统一为双引号
            .replace(/？/g, '?')   // 问号
            .replace(/！/g, '!')   // 感叹号
            .replace(/：/g, ':')   // 冒号
            .replace(/；/g, ';')   // 分号
            .replace(/，/g, ',')   // 逗号
            .replace(/。/g, '.') // 句号
    };

    const normalizedFullText = normalize(fullText);
    const normalizedParagraph1 = normalize(paragraph1);
    const normalizedParagraph2 = normalize(paragraph2);

    // 查找段落1在全文中的开始位置
    let startOffset;

    if (settings.musicStartsWithParagraph && isFirstMusic && isMusic) {
        startOffset = 0;
    } else {
        startOffset = normalizedFullText.indexOf(normalizedParagraph1);
    }

    if (lastMusicEnd !== -1 && isMusic && settings.seamlessMusic && !isFirstMusic) {
        startOffset = lastMusicEnd;
    }

    if (startOffset === -1 ) startOffset = normalizedFullText.indexOf(normalizedParagraph1.replace(/…/g, '...'));
    if (startOffset === -1 ) startOffset = normalizedFullText.indexOf(normalizedParagraph1.replace(/.../g, '…'));

    // --- 模糊匹配兜底：尝试去除首尾可能多余的双引号 ---
    if (startOffset === -1) {
        const unquoted1 = normalizedParagraph1.replace(/^"+|"+$/g, '');
        if (unquoted1 && unquoted1 !== normalizedParagraph1) {
            startOffset = normalizedFullText.indexOf(unquoted1);
            if (startOffset === -1) startOffset = normalizedFullText.indexOf(unquoted1.replace(/…/g, '...'));
            if (startOffset === -1) startOffset = normalizedFullText.indexOf(unquoted1.replace(/.../g, '…'));
        }
    }

    // 如果找不到，直接返回错误
    if (startOffset === -1) {
        if (lastMusicEnd !== -1 && isMusic && settings.seamlessMusic && !isFirstMusic) {
            startOffset = lastMusicEnd;
        } else {
            // --- 调试信息开始 ---
            console.error(`[DEBUG] 匹配失败 for src: ${src}`);
            console.log('[DEBUG] 规范化后要查找的段落:', `"${normalizedParagraph1}"`);
            console.log('[DEBUG] 字符编码:', Array.from(normalizedParagraph1).map(c => `${c} (${c.charCodeAt(0)})`).join(', '));

            // --- 原始错误信息 ---
            console.log(`未在文本中找到起始段落 for ${src}`, paragraph1, fullText.indexOf(paragraph1), fullText);
            return [-1, `音频《${src}》未在文本中找到起始段落: "${paragraph1}"`];
        }
    }

    // 从段落1结束位置之后开始查找段落2
    const searchStartPosition = startOffset;
    let paragraph2StartOffset = normalizedFullText.indexOf(normalizedParagraph2, searchStartPosition);
    if (paragraph2StartOffset === -1 ) paragraph2StartOffset = normalizedFullText.indexOf(normalizedParagraph2.replace(/…/g, '...'), searchStartPosition);
    if (paragraph2StartOffset === -1 ) paragraph2StartOffset = normalizedFullText.indexOf(normalizedParagraph2.replace(/.../g, '…'), searchStartPosition);

    // --- 模糊匹配兜底：尝试去除首尾可能多余的双引号 ---
    if (paragraph2StartOffset === -1) {
        const unquoted2 = normalizedParagraph2.replace(/^"+|"+$/g, '');
        if (unquoted2 && unquoted2 !== normalizedParagraph2) {
            paragraph2StartOffset = normalizedFullText.indexOf(unquoted2, searchStartPosition);
            if (paragraph2StartOffset === -1) paragraph2StartOffset = normalizedFullText.indexOf(unquoted2.replace(/…/g, '...'), searchStartPosition);
            if (paragraph2StartOffset === -1) paragraph2StartOffset = normalizedFullText.indexOf(unquoted2.replace(/.../g, '…'), searchStartPosition);
        }
    }

    // 如果找不到，直接返回错误
    if (paragraph2StartOffset === -1) {
        console.log(`未在起始段落后找到结束段落 for ${src}`, searchStartPosition, normalizedFullText.slice(searchStartPosition), normalizedFullText.indexOf(normalizedParagraph2));
        console.log("paragraph2",normalizedParagraph2);
        console.log("normalizedFullText",normalizedFullText);
        return [-1, `音频《${src}》未在起始段落后找到结束段落: "${paragraph2}"`];
    }

    // 计算段落2的结束位置（开始位置 + 段落长度）
    const endOffset = paragraph2StartOffset + normalizedParagraph2.length;

    // 返回范围偏移量
    return [startOffset, endOffset];
}

function parseBGMContent(bgmText) {


    console.log("bgmText",bgmText);
    // 去除 AI 的思维链，防止其中的假标签导致解析串台
    // 很多推理模型（或者 API 返回时）可能没有开头的 <think>，只有结尾的 </think>
    // 用户的要求：直接删除 </thinking> 及之前的所有东西，无论前面是什么！
    bgmText = bgmText.replace(/^[\s\S]*?<\/(?:think|thinking|BgmThink)>/i, '');
    
    // 如果中间还有成对的、或者多余的孤立标签，继续清理干净
    bgmText = bgmText.replace(/<(?:think|thinking|BgmThink)>[\s\S]*?<\/(?:think|thinking|BgmThink)>/gi, '');
    bgmText = bgmText.replace(/<\/?(?:think|thinking|BgmThink)>/gi, '');

    // 提取各个部分的内容
    const musicMatch = bgmText.match(/<Music>([\s\S]*?)<\/Music>/i);
    const ambianceMatch = bgmText.match(/<Ambiance>([\s\S]*?)<\/Ambiance>/i);
    const sfxMatch = bgmText.match(/<SFX>([\s\S]*?)<\/SFX>/i);
    const sfxWaitMatch = bgmText.match(/<SFX_WAIT>([\s\S]*?)<\/SFX_WAIT>/i);
    const VOICEMatch = bgmText.match(/<VOICE>([\s\S]*?)<\/VOICE>/i);

    // 新的通用解析函数，可以处理逗号在值中的情况，并且不依赖于前缀
    function universalParser(itemText) {
        const attributes = {};
        let content = itemText.substring(1, itemText.length - 1).trim();

        // Regex for one key-value pair. The value is either a /.../ literal,
        // or a non-greedy match until the next ",key=" or end of string.
        const pairRegex = /^\s*([a-zA-Z_]+)\s*[:=]\s*(\/(?:\\.|[^/])+\/|.*?(?=\s*,\s*[a-zA-Z_]+\s*[:=]|$))/;

        while (content.length > 0) {
            const match = content.match(pairRegex);
            if (!match) {
                console.error("Could not parse BGM attributes from: ", content);
                break;
            }

            const key = match[1];
            let value = match[2].trim();

            if (key === 'loop') {
                attributes[key] = (value === 'true');
            } else if ((key === 'regex' || key === 'regex_start' || key === 'regex_end') && value.startsWith('/') && value.endsWith('/')) {
                attributes[key] = value.slice(1, -1);
            } else {
                attributes[key] = value;
            }
            
            // Remove the matched part for the next iteration.
            content = content.substring(match[0].length).trim();
            // And remove the leading comma if it exists.
            if (content.startsWith(',')) {
                content = content.substring(1).trim();
            }
        }

        // src 的特殊处理
        if (attributes.src) {
            attributes.src = attributes.src.replaceAll('-', '');
        }
        return attributes;
    }

    // 通用的多项解析函数，接受一个解析器作为参数
    function parseMultipleItems(text, parser) {
        if (!text) return [];

        const itemMatches = text.match(/\[[^\]]+\]/g);
        if (!itemMatches) return [];

        return itemMatches.map(item => parser(item));
    }

    // 构建结果对象
    const result = {
        Music: parseMultipleItems(musicMatch ? musicMatch[1] : '', universalParser),
        Ambiance: parseMultipleItems(ambianceMatch ? ambianceMatch[1] : '', universalParser),
        SFX: parseMultipleItems(sfxMatch ? sfxMatch[1] : '', universalParser),
        SFX_WAIT: parseMultipleItems(sfxWaitMatch ? sfxWaitMatch[1] : '', universalParser),
        VOICE: parseMultipleItems(VOICEMatch ? VOICEMatch[1] : '', universalParser),
    };

    return result;
}

async function getRegexExtensionSettings() {
    const context = getContext();
    const settings = context.extensionSettings["regex"];
    const regex = [];

    if (!settings) {
        return [];
    }

    for (let i = 0; i < settings.length; i++) {
        const setting = settings[i];

        if (setting.disabled) continue;
        if (!setting.markdownOnly) continue;

        let out=false;

       let placement= setting.placement

       for (let j = 0; j < placement.length; j++) {
           if (placement[j]==2){
            out=true;
           }
       }

       if (!out) continue;

        const findRegexString = setting.findRegex;
        const replaceString = setting.replaceString;

        if (!findRegexString) continue;

        // Updated logic to parse regex string with flags
        const match = findRegexString.match(/^\/(.*)\/([gimuy]*)$/);
        let re;

        try {
            if (match) {
                // It's in /pattern/flags format
                const pattern = match[1];
                const flags = match[2];
                re = new RegExp(pattern, flags);
            } else {
                // It's just a pattern string, no delimiters
                re = new RegExp(findRegexString);
            }
            regex.push({ findRegex: re, replaceString: replaceString });
        } catch (e) {
            console.error(`Invalid regular expression: "${findRegexString}".`, e);
        }
    }

    return regex;
}

export {
    getRequestHeaders,
    getCurrentCsrfToken,
    setCachedCsrfToken,
    refreshCsrfToken,
    fetchWithCsrf,
    getParagraphOffsetsRange,
    parseBGMContent,
    getRegexExtensionSettings,
    generateUUID,
    mapRawRangesToDom,
    computeSkipRangesByDiff,
};

/**
 * 通过对比 DOM 文本和「正则清洗后的源文本」，反推出 DOM 上的跳过区。
 *
 * 思路（用户提议）：
 *   skipRanges(DOM) = DOM 中存在但 cleaned 中没有的字符位置
 *
 * 对 DOM 与 cleaned 做最长公共子序列(LCS)对齐：
 *   - LCS 中的字符 = 朗读区
 *   - DOM 中不在 LCS 中的字符 = 跳过区
 *
 * 这种方式天然处理了三种情况：
 *   1) raw 中被正则删掉、DOM 仍保留的内容（如 <details> 里的 think 块）→ 正确归为跳过
 *   2) markdown 渲染差异（cleaned 含 `**`、DOM 不含）→ 仅在 cleaned 侧丢弃，DOM 不被误标
 *   3) 完全没差异 → 返回空数组
 *
 * 性能：DP 表 O(D*C)。当字数过大时（默认 D*C > 4_000_000）会跳过计算返回 null，
 * 调用方应做兜底。
 *
 * @param {string} domText
 * @param {string} cleanedText
 * @param {object} [opts]
 * @param {number} [opts.maxCells=4000000]  DP 表上限格子数，超出返回 null。
 * @returns {Array<{start:number,end:number}>|null}  null 表示文本太大、未计算。
 */
function computeSkipRangesByDiff(domText, cleanedText, opts = {}) {
    // M4 集成：优先用新对齐算法（双向唯一锚点 + NW + 段内 NW + 孤岛吸收），失败再回退旧 LCS。
    if (!opts.skipNewAlignment) {
        try {
            const r = alignAndComputeSkipRanges(domText, cleanedText);
            if (Array.isArray(r)) return r;
        } catch (e) {
            console.warn('[computeSkipRangesByDiff] 新算法异常，回退旧 LCS：', e?.message || e);
        }
    }
    return _legacy_computeSkipRangesByDiff(domText, cleanedText, opts);
}

function _legacy_computeSkipRangesByDiff(domText, cleanedText, opts = {}) {
    // 默认上限从 4M 提到 16M：dp 表 Uint16Array 占 ~32MB，对长消息（DOM~4000、cleaned~4000）
    // 仍然能直接算出来，避免对 "$1 提取式" 正则的兜底 bail。
    const { maxCells = 16_000_000 } = opts;
    if (typeof domText !== 'string') return [];
    const D = domText.length;
    if (D === 0) return [];
    if (typeof cleanedText !== 'string' || cleanedText.length === 0) {
        return [{ start: 0, end: D }]; // cleaned 全空 → 整段 DOM 都跳过
    }
    const C = cleanedText.length;
    if ((D + 1) * (C + 1) > maxCells) {
        console.warn(`[computeSkipRangesByDiff] 文本过长（DOM=${D}, cleaned=${C}），跳过 LCS 计算`);
        return null;
    }

    const W = C + 1;
    // Uint16Array：单次匹配长度最大 65535，对正常消息够用
    const dp = new Uint16Array((D + 1) * W);
    const normalizeDiffCharCode = (code) => {
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

    for (let i = 1; i <= D; i++) {
        const di = normalizeDiffCharCode(domText.charCodeAt(i - 1));
        const rowBase = i * W;
        const prevRowBase = (i - 1) * W;
        for (let j = 1; j <= C; j++) {
            if (di === normalizeDiffCharCode(cleanedText.charCodeAt(j - 1))) {
                dp[rowBase + j] = dp[prevRowBase + (j - 1)] + 1;
            } else {
                const a = dp[prevRowBase + j];
                const b = dp[rowBase + (j - 1)];
                dp[rowBase + j] = a > b ? a : b;
            }
        }
    }

    // 回溯标记 DOM 中匹配上的字符
    const matched = new Uint8Array(D);
    let i = D, j = C;
    while (i > 0 && j > 0) {
        if (normalizeDiffCharCode(domText.charCodeAt(i - 1)) === normalizeDiffCharCode(cleanedText.charCodeAt(j - 1))) {
            matched[i - 1] = 1;
            i--; j--;
        } else if (dp[(i - 1) * W + j] >= dp[i * W + (j - 1)]) {
            i--;
        } else {
            j--;
        }
    }

    // 把连续未匹配的 DOM 位置组成 ranges
    const skips = [];
    let s = -1;
    for (let k = 0; k < D; k++) {
        if (!matched[k]) {
            if (s < 0) s = k;
        } else if (s >= 0) {
            skips.push({ start: s, end: k });
            s = -1;
        }
    }
    if (s >= 0) skips.push({ start: s, end: D });
    return skips;
}

/**
 * 将"原始文本(raw)"上的字符区间映射为"DOM 收集到的文字(dom)"上的字符区间。
 *
 * 使用场景：正则在 raw 上跑（能匹配 <think> 等标签），得到要"跳过"的区间；
 * 但播放器是在 DOM 文字上前进的（DOM 不含标签），需要把区间换算到 DOM 空间。
 *
 * 多重匹配策略（按顺序尝试）：
 *   1. raw 片段在 dom 中的精确子串匹配
 *   2. 双方都去除空白后再做子串匹配（避免空白渲染差异）
 *   3. 当片段去空白后长度 > 100，允许 ≥80% 的前缀/后缀作为锚点定位
 * 多个候选时取"前一个匹配之后的第一个"。
 *
 * @param {string} rawText 原始文本
 * @param {Array<{start:number,end:number}>} rawRanges raw 空间的待去除区间
 * @param {string} domText DOM 收集到的文字
 * @returns {Array<{start:number,end:number}>} dom 空间的区间（顺序保持）
 */
function mapRawRangesToDom(rawText, rawRanges, domText) {
    if (!Array.isArray(rawRanges) || rawRanges.length === 0) return [];
    if (typeof rawText !== 'string' || typeof domText !== 'string') return [];

    // 预构建 dom 去空白映射：strippedDom + idxMap[i] = stripped 位置 i 对应的原始 dom 索引
    const stripWS = /\s/;
    let strippedDom = '';
    const idxMap = [];
    for (let i = 0; i < domText.length; i++) {
        const ch = domText[i];
        if (!stripWS.test(ch)) {
            strippedDom += ch;
            idxMap.push(i);
        }
    }

    const result = [];
    let cursorDom = 0;       // dom 原始坐标，按已匹配区间向后推进
    let cursorStripped = 0;  // 与 cursorDom 对应的 strippedDom 索引

    const advanceStrippedCursor = (domPos) => {
        while (cursorStripped < idxMap.length && idxMap[cursorStripped] < domPos) cursorStripped++;
    };

    for (const r of rawRanges) {
        const fragment = rawText.slice(r.start, r.end);
        if (!fragment) continue;

        let located = null;

        // 策略 1：精确子串
        let idx = domText.indexOf(fragment, cursorDom);
        if (idx === -1) idx = domText.indexOf(fragment);
        if (idx !== -1) {
            located = { start: idx, end: idx + fragment.length };
        }

        // 策略 2：去空白后子串
        if (!located) {
            const fragNoWS = fragment.replace(/\s+/g, '');
            if (fragNoWS.length > 0) {
                let sIdx = strippedDom.indexOf(fragNoWS, cursorStripped);
                if (sIdx === -1) sIdx = strippedDom.indexOf(fragNoWS);
                if (sIdx !== -1) {
                    const endStrip = sIdx + fragNoWS.length - 1;
                    const startDom = idxMap[sIdx];
                    const endDom = (idxMap[endStrip] ?? idxMap[idxMap.length - 1]) + 1;
                    located = { start: startDom, end: endDom };
                }

                // 策略 3：长片段（>100）允许 ≥80% 的前缀/后缀锚点
                if (!located && fragNoWS.length > 100) {
                    const minLen = Math.floor(fragNoWS.length * 0.8);
                    for (let len = fragNoWS.length - 1; len >= minLen; len--) {
                        const prefix = fragNoWS.slice(0, len);
                        let pIdx = strippedDom.indexOf(prefix, cursorStripped);
                        if (pIdx === -1) pIdx = strippedDom.indexOf(prefix);
                        if (pIdx !== -1) {
                            const endStrip = Math.min(pIdx + fragNoWS.length, idxMap.length) - 1;
                            const startDom = idxMap[pIdx];
                            const endDom = (idxMap[endStrip] ?? idxMap[idxMap.length - 1]) + 1;
                            located = { start: startDom, end: endDom };
                            break;
                        }
                        const suffix = fragNoWS.slice(fragNoWS.length - len);
                        let suIdx = strippedDom.indexOf(suffix, cursorStripped);
                        if (suIdx === -1) suIdx = strippedDom.indexOf(suffix);
                        if (suIdx !== -1) {
                            const startStrip = Math.max(0, suIdx - (fragNoWS.length - len));
                            const endStrip = suIdx + len - 1;
                            const startDom = idxMap[startStrip];
                            const endDom = (idxMap[endStrip] ?? idxMap[idxMap.length - 1]) + 1;
                            located = { start: startDom, end: endDom };
                            break;
                        }
                    }
                }
            }
        }

        if (located) {
            result.push(located);
            cursorDom = located.end;
            advanceStrippedCursor(cursorDom);
        } else {
            console.warn('[st-immersive-sound] mapRawRangesToDom: 未能在 DOM 文本中定位片段，已跳过：',
                fragment.length > 80 ? fragment.slice(0, 80) + '…' : fragment);
        }
    }

    // 合并相邻/重叠区间
    result.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const rg of result) {
        if (merged.length && rg.start <= merged[merged.length - 1].end) {
            merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, rg.end);
        } else {
            merged.push({ ...rg });
        }
    }
    return merged;
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

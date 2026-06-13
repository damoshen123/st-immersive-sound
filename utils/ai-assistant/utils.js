// @ts-nocheck
/**
 * AI 助手通用工具
 */

export function escapeHTML(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function generateId(prefix = 'chat') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function throttle(fn, wait = 100) {
    let last = 0;
    let timer = null;
    let lastArgs = null;
    return function (...args) {
        const now = Date.now();
        const remain = wait - (now - last);
        lastArgs = args;
        if (remain <= 0) {
            last = now;
            if (timer) { clearTimeout(timer); timer = null; }
            fn.apply(this, args);
        } else if (!timer) {
            timer = setTimeout(() => {
                last = Date.now();
                timer = null;
                fn.apply(this, lastArgs);
            }, remain);
        }
    };
}

export function debounce(fn, wait = 300) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

// marked 使用"隔离加载"：避免页面被其它插件（如 @monaco-editor/loader）带入 AMD
// 环境后，UMD 库走 AMD 分支导致 window.marked === undefined。
const SCOPED_MARKED_KEY = 'stImmersiveSoundMarked';

function isValidMarked(m) {
    return Boolean(m && (typeof m === 'function' || typeof m.parse === 'function'));
}

function getScopedMarked() {
    if (typeof window === 'undefined') return undefined;
    return window[SCOPED_MARKED_KEY] ?? window.marked;
}

export function loadMarked() {
    const existing = getScopedMarked();
    if (isValidMarked(existing)) return Promise.resolve(existing);

    // 动态 import 以避免循环依赖（utils.js 处于 ai-assistant 目录内）。
    return import('../scoped-lib-loader.js').then(({ loadScopedGlobalLibrary }) =>
        loadScopedGlobalLibrary({
            url: 'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
            globalName: 'marked',
            scopeKey: SCOPED_MARKED_KEY,
            validate: isValidMarked,
        })
    );
}

/**
 * 渲染 Markdown，失败则降级为 escapeHTML + 换行转 <br>
 */
export function renderMarkdown(text) {
    if (!text) return '';
    try {
        const m = getScopedMarked();
        if (isValidMarked(m)) {
            if (typeof m.parse === 'function') return m.parse(text);
            return m(text);
        }
    } catch (e) {
        console.warn('[ST-IS-AI] markdown render failed:', e);
    }
    return escapeHTML(text).replace(/\n/g, '<br>');
}

/**
 * 移除 <think>...</think> 块（包括未闭合的尾部和无头的 </think>）
 */
export function removeThinkBlocks(text) {
    if (!text) return '';
    let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // 仅当文本里**没有 <think> 起始**、却出现了 </think> 时，才认为是「无头思考」并剥除前缀。
    // 这能避免正文里出现字面量 </think>（例如用户的正则字符串）被误吞。
    if (!/<think>/i.test(out) && /<\/think>/i.test(out)) {
        out = out.replace(/^[\s\S]*?<\/think>/i, '');
    }
    // 未闭合：有 <think> 但找不到对应的 </think>
    if (/<think>/i.test(out) && !/<\/think>/i.test(out)) {
        out = out.replace(/<think>[\s\S]*$/gi, '');
    }
    return out.trim();
}

/**
 * 抽取 think 块内容（用于折叠显示）
 * 同时兼容三种形态：
 *  - 标准 <think>...</think>
 *  - 仅有结尾 </think>（无头，常见于 prefill 截断 / Gemini 等模型）
 *  - 仅有开头 <think>（未闭合，模型截断或在思考中）
 */
export function extractThinkBlocks(text) {
    if (!text) return [];
    const out = [];

    // 1. 标准成对
    const re = /<think>([\s\S]*?)<\/think>/gi;
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[1]);

    // 2. 无头：没有 <think>，但出现了 </think>，则把开头到第一个 </think> 当思考
    if (!/<think>/i.test(text) && /<\/think>/i.test(text)) {
        const headless = text.match(/^([\s\S]*?)<\/think>/i);
        if (headless && headless[1].trim()) out.push(headless[1]);
    }

    // 3. 未闭合：有 <think>，但找不到 </think>
    if (/<think>/i.test(text) && !/<\/think>/i.test(text)) {
        const tail = text.match(/<think>([\s\S]*)$/i);
        if (tail) out.push(tail[1]);
    }

    return out;
}

/**
 * 将文本中所有 < ... > 包围的指令标签隐藏（保留原文给 LLM history，但展示给用户的去掉）
 * 仅去掉我们已知的指令 tag
 */
const KNOWN_TAGS = ['UpdateSettings', 'SystemQuery', 'UIAction'];

/**
 * 真指令的严格匹配模式：要求标签内必须是 { ... } 形式的 JSON。
 * 这样可以避免 AI 在思考/解释时把字面量 `<SystemQuery>` 写出来导致伪闭合（见用例：
 *   "<SystemQuery>` 指令，`type` 为 `load_module`..."  ← 不带 { 开头，会和后面真指令的 </SystemQuery> 错配）。
 *
 * 正则解释：
 *   <Tag>          字面起始标签
 *   \s*            可选空白
 *   \{[\s\S]*?\}   非贪婪匹配的 JSON 对象
 *   \s*
 *   </Tag>
 */
function buildStrictTagRegex(tag, flags = 'gi') {
    return new RegExp(`<${tag}>\\s*(\\{[\\s\\S]*?\\})\\s*<\\/${tag}>`, flags);
}

export function stripCommandTags(text) {
    if (!text) return '';
    let out = text;
    for (const tag of KNOWN_TAGS) {
        out = out.replace(buildStrictTagRegex(tag), '');
    }
    return out;
}

/**
 * 抽取所有指令标签（保留外层标签，原样返回）
 * 用于「执行内部命令」折叠面板展示
 */
export function extractCommandTags(text) {
    if (!text) return [];
    const out = [];
    for (const tag of KNOWN_TAGS) {
        const re = buildStrictTagRegex(tag);
        let m;
        while ((m = re.exec(text)) !== null) out.push(m[0]);
    }
    return out;
}

export function nowMs() { return Date.now(); }

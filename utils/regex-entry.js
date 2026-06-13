// 正则条目（regexEntries）数据结构与 ST 兼容工具
// 移植自 st-chatu8/utils/settings/regex.js

let regexEntryIdCounter = 0;

/** 默认正则条目（与 SillyTavern 正则脚本格式兼容） */
export const DEFAULT_REGEX_ENTRY = {
    id: '',
    scriptName: '新建正则',
    disabled: false,
    runOnEdit: true,
    findRegex: '',
    replaceString: '',
    trimStrings: [],
    placement: [2],
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    markdownOnly: true,
    promptOnly: false,
};

/** 生成唯一条目 ID */
export function generateRegexEntryId() {
    return `regex_entry_${Date.now()}_${++regexEntryIdCounter}`;
}

/** 创建带默认值与 ID 的新条目 */
export function createNewRegexEntry() {
    return { ...DEFAULT_REGEX_ENTRY, id: generateRegexEntryId() };
}

/**
 * 从 ST 正则 JSON 解析为内部条目格式
 * @param {object} json
 * @returns {object|null}
 */
export function parseSTRegexFormat(json) {
    if (!json || typeof json !== 'object') return null;
    if (typeof json.findRegex !== 'string') return null;

    return {
        id: json.id || generateRegexEntryId(),
        scriptName: json.scriptName || '导入的正则',
        disabled: json.disabled === true,
        runOnEdit: json.runOnEdit !== false,
        findRegex: json.findRegex || '',
        replaceString: json.replaceString || '',
        trimStrings: Array.isArray(json.trimStrings) ? json.trimStrings : [],
        placement: Array.isArray(json.placement) ? json.placement : [2],
        substituteRegex: typeof json.substituteRegex === 'number' ? json.substituteRegex : 0,
        minDepth: json.minDepth ?? null,
        maxDepth: json.maxDepth ?? null,
        markdownOnly: json.markdownOnly !== false,
        promptOnly: json.promptOnly === true,
    };
}

/** 导出为 ST 正则脚本 JSON */
export function exportToSTRegexFormat(entry) {
    return {
        id: entry.id || generateRegexEntryId(),
        scriptName: entry.scriptName || '未命名正则',
        disabled: entry.disabled === true,
        runOnEdit: entry.runOnEdit !== false,
        findRegex: entry.findRegex || '',
        replaceString: entry.replaceString || '',
        trimStrings: Array.isArray(entry.trimStrings) ? entry.trimStrings : [],
        placement: Array.isArray(entry.placement) ? entry.placement : [2],
        substituteRegex: typeof entry.substituteRegex === 'number' ? entry.substituteRegex : 0,
        minDepth: entry.minDepth ?? null,
        maxDepth: entry.maxDepth ?? null,
        markdownOnly: entry.markdownOnly !== false,
        promptOnly: entry.promptOnly === true,
    };
}

/** 校验条目对象基本字段 */
export function validateRegexEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.findRegex !== 'string') return false;
    if (typeof entry.scriptName !== 'string') return false;
    return true;
}

/** 是否为 /pattern/flags 字面量字符串 */
export function isRegexLiteral(str) {
    return /^\/(.+)\/([gimsuy]*)$/.test(String(str || ''));
}

/**
 * 解析 /pattern/flags 字面量；自动补 g 标志
 * @returns {{pattern: string, flags: string} | null}
 */
export function parseRegexLiteralParts(str) {
    const match = String(str || '').match(/^\/(.+)\/([gimsuy]*)$/);
    if (!match) return null;
    let flags = match[2] || '';
    if (!flags.includes('g')) flags += 'g';
    return { pattern: match[1], flags };
}

/** 转义为正则字面量（用于纯文本匹配） */
export function escapeRegex(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** HTML 转义（用于属性值） */
export function escapeHtmlForRegex(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '&quot;');
}

// 危险正则模式检测（移植自 st-chatu8/utils/settings/regex.js）
// 用于在保存/运行前识别可能导致灾难性回溯的正则表达式

export const DANGEROUS_REGEX_PATTERNS = [
    {
        pattern: /\([^)]*[+*][^)]*\)[+*]/,
        name: '嵌套量词',
        description: '如 (a+)+, (.+)+ 会导致指数级回溯',
    },
    {
        pattern: /\.\*\.\*|\.\+\.\+|\.\*\?\.\+|\.\+\?\.\*/,
        name: '连续通配符',
        description: '如 .*.*, .+.+ 会导致大量回溯',
    },
    {
        pattern: /\.\+[^?].*\.\+|\.\*[^?].*\.\*/,
        name: '多重贪婪匹配',
        description: '多个贪婪匹配可能导致性能问题',
    },
    {
        pattern: /\(\s*\)[+*]/,
        name: '空匹配循环',
        description: '空括号加量词会导致无限循环',
    },
    {
        pattern: /\(\([^)]*[+*][^)]*\)[+*]\)/,
        name: '深层嵌套量词',
        description: '多层嵌套量词风险极高',
    },
    {
        pattern: /\([^)]*\|[^)]*[+*][^)]*\)[+*]|\([^)]*[+*][^)]*\|[^)]*\)[+*]/,
        name: '交替量词组合',
        description: '如 (a|b+)+ 可能导致回溯',
    },
];

const CRITICAL_DANGER_NAMES = new Set(['嵌套量词', '深层嵌套量词', '空匹配循环']);

/**
 * 检测正则字符串是否含有危险模式
 * @param {string} regexStr
 * @returns {{isDangerous: boolean, warnings: Array<{name: string, description: string}>}}
 */
export function detectDangerousRegex(regexStr) {
    if (!regexStr || typeof regexStr !== 'string') {
        return { isDangerous: false, warnings: [] };
    }

    const warnings = [];

    for (const rule of DANGEROUS_REGEX_PATTERNS) {
        if (rule.pattern.test(regexStr)) {
            warnings.push({ name: rule.name, description: rule.description });
        }
    }

    if (regexStr.length > 500) {
        warnings.push({
            name: '过长正则',
            description: `正则长度 ${regexStr.length} 字符，可能影响性能`,
        });
    }

    const quantifierCount = (regexStr.match(/[+*?]|\{\d+,?\d*\}/g) || []).length;
    if (quantifierCount > 10) {
        warnings.push({
            name: '过多量词',
            description: `包含 ${quantifierCount} 个量词，可能影响性能`,
        });
    }

    return { isDangerous: warnings.length > 0, warnings };
}

/**
 * 是否触发关键级别危险（应直接跳过执行）
 */
export function hasCriticalDanger(warnings) {
    if (!Array.isArray(warnings)) return false;
    return warnings.some((w) => CRITICAL_DANGER_NAMES.has(w.name));
}

/**
 * 生成危险警告 HTML 片段（用于条目列表）
 * @param {Array<{name: string, description: string}>} warnings
 */
export function generateDangerousRegexWarningHTML(warnings) {
    if (!warnings || warnings.length === 0) return '';
    const warningText = warnings.map((w) => `${w.name}: ${w.description}`).join('\n');
    return `<span class="st-is-entry-danger-warning" title="${warningText}"><i class="fa-solid fa-skull-crossbones"></i></span>`;
}

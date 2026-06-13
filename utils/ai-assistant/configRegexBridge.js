// @ts-nocheck
/**
 * 正则 AI 桥接 —— 包装 utils/ui-regex.js 中暴露的 window.stIsRegexAIBridge
 * 所有函数返回字符串结果，用于直接放进 SystemQueryResult 反馈给 AI。
 */

function _bridge() {
    if (typeof window === 'undefined' || !window.stIsRegexAIBridge) return null;
    return window.stIsRegexAIBridge;
}

function _err(msg = '正则模块未加载，请先打开正则设置页面') {
    return `❌ ${msg}`;
}

export function getRegexStatus() {
    const b = _bridge();
    if (!b) return _err();
    try {
        const status = b.getStatus();
        let r = '📋 正则测试区域状态:\n';
        r += `- 测试模式: ${status.testMode ? '✅ 已开启' : '❌ 未开启'}\n`;
        r += `- 当前配置: ${status.currentProfile || '(无)'}\n`;
        r += `- 前后正则: ${status.beforeAfterRegex || '(空)'}\n`;
        r += `- 文字正则: ${status.textRegex || '(空)'}\n`;
        r += `- 原文:\n${status.originalText ? truncate(status.originalText, 20000) : '(空)'}\n`;
        r += `- 正则后文本:\n${status.resultText ? truncate(status.resultText, 20000) : '(空)'}\n`;
        r += `- 正则条目 (${status.entryCount || 0}个):\n`;
        if (Array.isArray(status.regexEntries) && status.regexEntries.length) {
            status.regexEntries.forEach((e) => {
                const flag = e.disabled ? '[禁用]' : '[启用]';
                r += `  ${e.index}. ${flag} ${e.name} | 查找: ${e.findRegex} | 替换: ${e.replaceString}\n`;
            });
        } else {
            r += '  (暂无条目)\n';
        }
        return r;
    } catch (e) {
        return `❌ 获取正则状态失败: ${e.message}`;
    }
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + ` ...(共${s.length}字)` : s;
}

export function setRegexOriginalText(text) {
    const b = _bridge(); if (!b) return _err();
    try { return b.setOriginalText(text) || '✅ 已设置原文'; }
    catch (e) { return `❌ 设置原文失败: ${e.message}`; }
}

export function setRegexEditors(beforeAfter, textRegex) {
    const b = _bridge(); if (!b) return _err();
    try { return b.setEditors(beforeAfter, textRegex) || '✅ 已设置正则编辑器'; }
    catch (e) { return `❌ 设置正则编辑器失败: ${e.message}`; }
}

export function createRegexEntry(data) {
    const b = _bridge(); if (!b) return _err();
    try { return b.createEntry(data) || '✅ 已创建正则条目'; }
    catch (e) { return `❌ 创建正则条目失败: ${e.message}`; }
}

export async function triggerRegexTest() {
    const b = _bridge(); if (!b) return _err();
    try {
        const r = await b.triggerTest();
        return r || '✅ 已执行测试';
    } catch (e) { return `❌ 执行测试失败: ${e.message}`; }
}

export function setRegexTestMode(enabled) {
    const b = _bridge(); if (!b) return _err();
    try { return b.setTestMode(!!enabled) || `✅ 测试模式已${enabled ? '开启' : '关闭'}`; }
    catch (e) { return `❌ 切换测试模式失败: ${e.message}`; }
}

export function getRegexResultText() {
    const b = _bridge(); if (!b) return _err();
    try {
        const t = b.getResultText();
        return t == null ? '(空)' : `📝 正则后文本:\n${t}`;
    } catch (e) { return `❌ 获取结果失败: ${e.message}`; }
}

export function clearAllRegexEntries() {
    const b = _bridge(); if (!b) return _err();
    try { return b.clearAllEntries() || '✅ 已清除所有正则条目'; }
    catch (e) { return `❌ 清除失败: ${e.message}`; }
}

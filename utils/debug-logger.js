// 简化版调试日志器（移植自 st-chatu8/utils/debugLogger.js 的 API 子集）
// 桥接到本项目的 logManager（utils/log.js）；console 始终输出，logManager 仅写关键事件。

import { logManager } from './log.js';

const DEBUG_PREFIX = '[regex]';

/**
 * 是否启用详细调试输出（可通过 window.__ST_IS_REGEX_DEBUG = true 临时打开）
 */
function isDebugEnabled() {
    try {
        return window.__ST_IS_REGEX_DEBUG === true;
    } catch (_) {
        return false;
    }
}

/**
 * 普通调试日志
 */
export function debugLog(scope, title, payload) {
    if (!isDebugEnabled()) return;
    if (payload === undefined) {
        console.log(`${DEBUG_PREFIX}[${scope}] ${title}`);
    } else {
        console.log(`${DEBUG_PREFIX}[${scope}] ${title}`, payload);
    }
}

/**
 * 分支判定日志
 */
export function debugBranch(scope, branchName, taken, payload) {
    if (!isDebugEnabled()) return;
    const tag = taken ? '✓' : '✗';
    if (payload === undefined) {
        console.log(`${DEBUG_PREFIX}[${scope}] ${tag} ${branchName}`);
    } else {
        console.log(`${DEBUG_PREFIX}[${scope}] ${tag} ${branchName}`, payload);
    }
}

/**
 * 计时器
 */
export function debugTimer(scope, title) {
    const start = performance.now();
    return {
        end(message) {
            if (!isDebugEnabled()) return;
            const elapsed = (performance.now() - start).toFixed(2);
            console.log(`${DEBUG_PREFIX}[${scope}] ⏱ ${title} - ${elapsed}ms${message ? ' | ' + message : ''}`);
        },
    };
}

/**
 * 内容预览日志（截断长文本）
 */
export function debugContent(scope, title, content, maxLen = 200) {
    if (!isDebugEnabled()) return;
    const text = String(content ?? '');
    const preview = text.length > maxLen ? text.substring(0, maxLen) + `...(共${text.length}字)` : text;
    console.log(`${DEBUG_PREFIX}[${scope}] 📝 ${title}:\n${preview}`);
}

/**
 * 写入日志面板（始终生效，与 chatu8 的 utils/utils.js#addLog 兼容）
 */
export function addLog(message) {
    try {
        logManager.add(String(message ?? ''));
    } catch (e) {
        console.warn(`${DEBUG_PREFIX} addLog failed`, e);
    }
}

/**
 * 清除日志面板（与 chatu8 的 clearLog 兼容；这里调用 logManager.clear，如果未实现则忽略）
 */
export function clearLog() {
    try {
        if (typeof logManager.clear === 'function') {
            logManager.clear();
        }
    } catch (e) {
        // ignore
    }
}

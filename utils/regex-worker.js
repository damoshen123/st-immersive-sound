// 共享 Worker 的超时安全正则执行（移植自 st-chatu8/utils/settings/regex.js 顶部）
// 通过 Worker 隔离执行 RegExp，主线程 1s 超时强制 terminate 并销毁 Worker。

import { debugLog } from './debug-logger.js';

/** 单次正则执行超时时间 (ms) */
export const REGEX_TIMEOUT_MS = 1000;

let sharedRegexWorker = null;
let sharedRegexWorkerUrl = null;
let regexRequestIdCounter = 0;
const pendingRegexRequests = new Map();

const REGEX_WORKER_CODE = `
    self.onmessage = function(e) {
        const { requestId, operation, text, pattern, flags, replacement } = e.data;
        // 通知主线程开始计时
        self.postMessage({ requestId, ready: true });
        try {
            const regex = new RegExp(pattern, flags);
            let result;
            switch(operation) {
                case 'test':
                    result = regex.test(text);
                    break;
                case 'match': {
                    const m = text.match(regex);
                    if (m) {
                        result = {
                            matches: Array.from(m),
                            index: m.index,
                            input: m.input
                        };
                    } else {
                        result = null;
                    }
                    break;
                }
                case 'replace':
                    result = text.replace(regex, replacement);
                    break;
                case 'matchAll':
                    result = [...text.matchAll(regex)].map(m => ({
                        match: m[0],
                        index: m.index,
                        groups: m.groups || null
                    }));
                    break;
                default:
                    throw new Error('Unknown operation: ' + operation);
            }
            self.postMessage({ requestId, success: true, result });
        } catch (err) {
            self.postMessage({ requestId, success: false, error: err.message });
        }
    };
`;

function destroySharedRegexWorker() {
    if (sharedRegexWorker) {
        try { sharedRegexWorker.terminate(); } catch (_) { /* noop */ }
        sharedRegexWorker = null;
    }
    if (sharedRegexWorkerUrl) {
        try { URL.revokeObjectURL(sharedRegexWorkerUrl); } catch (_) { /* noop */ }
        sharedRegexWorkerUrl = null;
    }
}

function getSharedRegexWorker() {
    if (sharedRegexWorker) return sharedRegexWorker;

    const blob = new Blob([REGEX_WORKER_CODE], { type: 'application/javascript' });
    sharedRegexWorkerUrl = URL.createObjectURL(blob);
    sharedRegexWorker = new Worker(sharedRegexWorkerUrl);

    sharedRegexWorker.onmessage = (e) => {
        const { requestId, ready, success, result, error } = e.data;
        const pending = pendingRegexRequests.get(requestId);
        if (!pending) return;

        if (ready) {
            const timeoutId = setTimeout(() => {
                const p = pendingRegexRequests.get(requestId);
                if (p) {
                    pendingRegexRequests.delete(requestId);
                    p.resolve({
                        success: false,
                        error: `正则执行超时 (>${REGEX_TIMEOUT_MS}ms)`,
                        timeout: true,
                    });
                }
                // 超时时 Worker 可能卡住了，销毁重建
                destroySharedRegexWorker();
            }, REGEX_TIMEOUT_MS);
            pending.timeoutId = timeoutId;
            return;
        }

        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        pendingRegexRequests.delete(requestId);
        pending.resolve({ success, result, error });
    };

    sharedRegexWorker.onerror = (e) => {
        for (const [, pending] of pendingRegexRequests) {
            if (pending.timeoutId) clearTimeout(pending.timeoutId);
            pending.resolve({ success: false, error: (e && e.message) || 'Worker error' });
        }
        pendingRegexRequests.clear();
        destroySharedRegexWorker();
    };

    return sharedRegexWorker;
}

/**
 * 在 Worker 中执行正则操作并带超时
 * @param {'test'|'match'|'replace'|'matchAll'} operation
 * @param {string} text
 * @param {string} pattern
 * @param {string} flags
 * @param {string} [replacement]
 * @returns {Promise<{success: boolean, result: any, error?: string, timeout?: boolean}>}
 */
export function executeRegexWithTimeout(operation, text, pattern, flags, replacement = '') {
    return new Promise((resolve) => {
        try {
            const requestId = ++regexRequestIdCounter;
            const worker = getSharedRegexWorker();
            pendingRegexRequests.set(requestId, { resolve, timeoutId: null });
            worker.postMessage({ requestId, operation, text, pattern, flags, replacement });
        } catch (e) {
            // Worker 创建失败（CSP 等），降级为同步执行
            try {
                const re = new RegExp(pattern, flags);
                let result;
                switch (operation) {
                    case 'test':
                        result = re.test(text);
                        break;
                    case 'match': {
                        const m = text.match(re);
                        result = m ? { matches: Array.from(m), index: m.index, input: m.input } : null;
                        break;
                    }
                    case 'replace':
                        result = text.replace(re, replacement);
                        break;
                    case 'matchAll':
                        result = [...text.matchAll(re)].map(m => ({
                            match: m[0],
                            index: m.index,
                            groups: m.groups || null,
                        }));
                        break;
                    default:
                        throw new Error('Unknown operation: ' + operation);
                }
                resolve({ success: true, result });
            } catch (err) {
                resolve({ success: false, error: err.message });
            }
        }
    });
}

/**
 * 同步版正则执行 + 时长警告（不带超时拦截，仅记录）
 * @param {Function} regexFn
 * @param {string} regexDesc
 */
export function executeRegexWithWarning(regexFn, regexDesc = '未知正则') {
    const startTime = performance.now();
    const result = regexFn();
    const elapsed = performance.now() - startTime;
    if (elapsed > REGEX_TIMEOUT_MS) {
        console.warn(`[regex] 同步正则执行慢 (${elapsed.toFixed(2)}ms): ${regexDesc}`);
        debugLog('regex.timeout', `正则执行慢: ${regexDesc}`, { 耗时: elapsed.toFixed(2) + 'ms' });
    }
    return result;
}

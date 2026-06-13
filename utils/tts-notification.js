// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  全局 TTS 批量通知
//  - 所有 dispatcher（doubao / edge / minimax / nimo / narration）共用
//  - 单例 toastr，按各 source 的计数聚合显示
//  - clear 时强制 hideDuration:0，避免 DOM 残留
// ═══════════════════════════════════════════════════════════

const counters = new Map();   // source -> count
const meta = new Map();       // source -> { label, phase?, detail? }
let currentToast = null;
let renderScheduled = false;

function clearCurrent() {
    if (!currentToast) return;
    try {
        // 强制立即隐藏（绕过 fade-out 动画，避免 clear→info 连续调用时 DOM 残留）
        toastr.clear(currentToast, { force: true });
    } catch (_) {}
    try {
        const $el = currentToast;
        if ($el && $el.length) $el.remove();
    } catch (_) {}
    currentToast = null;
}

function totalCount() {
    let n = 0;
    for (const v of counters.values()) n += v;
    return n;
}

function buildMessage() {
    const parts = [];
    for (const [source, cnt] of counters.entries()) {
        if (cnt <= 0) continue;
        const m = meta.get(source) || {};
        const label = m.label || source;
        const detail = m.detail || '';
        const phase = m.phase || '';
        if (phase === 'waiting') {
            parts.push(`⏳ ${label}: ${detail || '限流等待'}（剩 ${cnt}）`);
        } else if (phase === 'downloading') {
            parts.push(`⬇️ ${label}: 下载 ${cnt} 个`);
        } else {
            parts.push(`${label}: ${cnt}`);
        }
    }
    if (!parts.length) return '';
    return `正在生成语音 · ${parts.join(' | ')}`;
}

function doRender() {
    renderScheduled = false;
    const n = totalCount();
    if (n <= 0) {
        clearCurrent();
        return;
    }
    const msg = buildMessage();
    clearCurrent();
    try {
        currentToast = toastr.info(msg, 'TTS', {
            timeOut: 0,
            extendedTimeOut: 0,
            showDuration: 0,
            hideDuration: 0,
            closeButton: true,
            preventDuplicates: false,
        });
    } catch (_) {}
}

function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    // 微任务合并：并发多个 increment/decrement 只渲染一次
    queueMicrotask(doRender);
}

/**
 * 开始一个 TTS 任务。
 * @param {string} source  分发器标识，如 'doubao' | 'edge' | 'minimax' | 'nimo' | 'narration-edge' | 'narration-nimo'
 * @param {string} label   界面展示的引擎名，如 'Edge' | 'MiMo' | '旁白(MiMo)'
 */
export function ttsNotifyStart(source, label) {
    counters.set(source, (counters.get(source) || 0) + 1);
    const m = meta.get(source) || {};
    m.label = label || m.label || source;
    meta.set(source, m);
    scheduleRender();
}

/**
 * 结束一个 TTS 任务（无论成功失败都要调）。
 */
export function ttsNotifyEnd(source) {
    const cur = counters.get(source) || 0;
    const next = cur - 1;
    if (next <= 0) {
        counters.delete(source);
        meta.delete(source);
    } else {
        counters.set(source, next);
    }
    scheduleRender();
}

/**
 * 批量开始：一次增加 N 个任务（旁白会一次性下发 N 段）。
 */
export function ttsNotifyBatchStart(source, label, count) {
    if (!count || count <= 0) return;
    counters.set(source, (counters.get(source) || 0) + count);
    const m = meta.get(source) || {};
    m.label = label || m.label || source;
    meta.set(source, m);
    scheduleRender();
}

/**
 * 批量结束：一次性扣减 N。
 */
export function ttsNotifyBatchEnd(source, count) {
    if (!count || count <= 0) return;
    const cur = counters.get(source) || 0;
    const next = cur - count;
    if (next <= 0) {
        counters.delete(source);
        meta.delete(source);
    } else {
        counters.set(source, next);
    }
    scheduleRender();
}

/**
 * 更新某个 source 的阶段（例如 MiniMax 的限流等待 / 下载阶段）。
 * 不改变计数，仅刷新文案。
 */
export function ttsNotifyPhase(source, phase, detail = '') {
    const m = meta.get(source);
    if (!m) return;
    m.phase = phase;
    m.detail = detail;
    scheduleRender();
}

/**
 * 紧急清理（比如页面切换时），直接把通知干掉。
 */
export function ttsNotifyReset() {
    counters.clear();
    meta.clear();
    clearCurrent();
}

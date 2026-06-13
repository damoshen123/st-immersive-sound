// @ts-nocheck

const recentSfxCache = new Map();
const MAX_CACHE_ITEMS = 100;

export const RecentSfxCacheEmitter = new EventTarget();

function normalizePart(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/[|\n\r]/g, '_').trim();
}

export function generateRecentSfxCacheKey(item = {}) {
    const parts = [
        item.type,
        item.src,
        item.regex_start,
        item.regex_end,
        item.regex,
        item.url,
        item.context,
    ].map(normalizePart);
    return `recent-sfx|${parts.join('|')}`;
}

export function getRecentSfxCache() {
    return recentSfxCache;
}

export function getRecentSfxItem(cacheKey) {
    return recentSfxCache.get(cacheKey);
}

function emitUpdate(cacheKey, item) {
    RecentSfxCacheEmitter.dispatchEvent(new CustomEvent('update', { detail: { cacheKey, item } }));
}

function trimCacheIfNeeded() {
    while (recentSfxCache.size > MAX_CACHE_ITEMS) {
        const oldestKey = recentSfxCache.keys().next().value;
        if (!oldestKey) break;
        recentSfxCache.delete(oldestKey);
    }
}

/**
 * 清空整个「音效预览」最近列表缓存，并通知 UI 重新渲染。
 * 注意：这只清空 UI 列表所用的「最近音效记录」，不影响 audio-cache 中
 * 已下载的音效文件二进制缓存。
 */
export function clearRecentSfxCache() {
    if (recentSfxCache.size === 0) return;
    recentSfxCache.clear();
    RecentSfxCacheEmitter.dispatchEvent(new CustomEvent('update', { detail: { cleared: true } }));
}

export function addOrUpdateRecentSfxItem(cacheKey, data) {
    const existing = recentSfxCache.get(cacheKey) || {};
    if (recentSfxCache.has(cacheKey)) {
        recentSfxCache.delete(cacheKey);
    }
    const updatedItem = { ...existing, ...data, cacheKey, timestamp: Date.now() };
    recentSfxCache.set(cacheKey, updatedItem);
    trimCacheIfNeeded();
    emitUpdate(cacheKey, updatedItem);
    return updatedItem;
}

export function updateRecentSfxItemData(cacheKey, data) {
    const existing = recentSfxCache.get(cacheKey);
    if (!existing) return null;
    const updatedItem = { ...existing, ...data };
    recentSfxCache.set(cacheKey, updatedItem);
    return updatedItem;
}

export function applyRecentSfxOverrides(item = {}) {
    const cacheKey = item.cacheKey || generateRecentSfxCacheKey(item);
    const existing = recentSfxCache.get(cacheKey);
    if (!existing) {
        return { ...item, cacheKey };
    }

    return {
        ...item,
        cacheKey,
        url: existing.url || item.url,
        volume: existing.volume ?? item.volume,
        vibration: existing.vibration ?? item.vibration,
        uploader: existing.uploader ?? item.uploader,
        special_effects: existing.special_effects ?? item.special_effects,
        ir_description: existing.ir_description ?? item.ir_description,
        spatial: existing.spatial ?? item.spatial,
        context: existing.context ?? item.context,
    };
}

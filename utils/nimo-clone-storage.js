// @ts-nocheck
/**
 * Nimo / MiMo TTS 复刻音频存储抽象层
 *
 * 支持两种后端：
 *   - 'browser'  : 浏览器 IndexedDB（默认，与旧版行为一致）
 *   - 'jiuguan'  : 酒馆服务器图片 API（/api/images/upload + /api/images/delete）
 *                  元数据路径存在 extension_settings[extensionName].nimoAudioStorage
 *
 * 参考实现：st-chatu8/utils/configDatabase.js 的 saveConfigImage / getConfigImage / deleteConfigImage
 *
 * 读取时始终两端都探测（优先服务端，降级 IndexedDB），保证旧数据不丢失。
 */

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { extensionName } from './config.js';
import { fetchWithCsrf, getRequestHeaders } from './helpers.js';
import { saveKv, getKv, deleteKv } from './ai-assistant/configDatabase.js';

// ── 工具 ─────────────────────────────────────────────────────

function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ── 配置 ──────────────────────────────────────────────────────

/**
 * 读取当前存储后端设置。
 * @returns {'browser'|'jiuguan'}
 */
export function getNimoCloneStorageBackend() {
    return extension_settings[extensionName]?.nimoCloneStorage || 'browser';
}

/**
 * 确保服务端元数据映射表存在。
 * @returns {Object} nimoAudioStorage map
 */
function _ensureServerStorage() {
    if (!extension_settings[extensionName].nimoAudioStorage) {
        extension_settings[extensionName].nimoAudioStorage = {};
    }
    return extension_settings[extensionName].nimoAudioStorage;
}

// ── 公开 API ─────────────────────────────────────────────────

/**
 * 保存复刻音频。
 * @param {string} kvId   - 存储键（如 'nimo_audio_nv_xxxxx'）
 * @param {string} base64 - 纯 base64（不含 data: 前缀）
 * @param {string} mime   - MIME 类型（如 'audio/wav'）
 * @returns {Promise<void>}
 */
export async function saveCloneAudio(kvId, base64, mime) {
    if (getNimoCloneStorageBackend() === 'jiuguan') {
        const ext = (mime.split('/')[1] || 'wav').replace('mpeg', 'mp3');
        try {
            const response = await fetchWithCsrf('/api/images/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    image: base64,
                    format: ext,
                    ch_name: 'st_is_nimo_audio',
                    filename: `${kvId}.${ext}`,
                }),
            });
            if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);
            const result = await response.json();
            const path = result.path;
            const storage = _ensureServerStorage();
            storage[kvId] = { path, mime, date: Date.now() };
            saveSettingsDebounced();
            console.log(`[Nimo Clone Storage] 已保存到酒馆: ${kvId} -> ${path}`);
        } catch (error) {
            console.error('[Nimo Clone Storage] 上传到酒馆失败:', error);
            throw error;
        }
    } else {
        await saveKv(kvId, { b64: base64, mime });
        console.log(`[Nimo Clone Storage] 已保存到 IndexedDB: ${kvId}`);
    }
}

/**
 * 读取复刻音频。优先服务端，降级 IndexedDB。
 * @param {string} kvId
 * @returns {Promise<{b64: string, mime: string}|null>}
 */
export async function getCloneAudio(kvId) {
    if (!kvId) return null;

    // 优先服务端
    const serverStorage = extension_settings[extensionName]?.nimoAudioStorage || {};
    const serverEntry = serverStorage[kvId];
    if (serverEntry?.path) {
        try {
            const response = await fetch(serverEntry.path);
            if (response.ok) {
                const blob = await response.blob();
                const dataUrl = await _blobToBase64(blob);
                const b64 = dataUrl.split(',')[1] || dataUrl;
                return { b64, mime: serverEntry.mime || 'audio/wav' };
            }
        } catch (e) {
            console.warn('[Nimo Clone Storage] 从酒馆读取失败，降级到 IndexedDB:', e);
        }
    }

    // 降级 IndexedDB
    try {
        const rec = await getKv(kvId);
        if (rec) return rec;
    } catch (e) {
        console.warn('[Nimo Clone Storage] 从 IndexedDB 读取失败:', e);
    }

    return null;
}

/**
 * 删除复刻音频（同时清理服务端记录与 IndexedDB）。
 * @param {string} kvId
 * @returns {Promise<boolean>}
 */
export async function deleteCloneAudio(kvId) {
    if (!kvId) return false;
    let deleted = false;

    // 清理服务端
    const serverStorage = extension_settings[extensionName]?.nimoAudioStorage || {};
    const serverEntry = serverStorage[kvId];
    if (serverEntry?.path) {
        try {
            const response = await fetchWithCsrf('/api/images/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ path: serverEntry.path }),
            });
            if (!response.ok) console.warn('[Nimo Clone Storage] 删除服务端文件失败:', response.statusText);
        } catch (e) {
            console.warn('[Nimo Clone Storage] 删除服务端文件异常:', e);
        }
        delete serverStorage[kvId];
        saveSettingsDebounced();
        deleted = true;
        console.log(`[Nimo Clone Storage] 已从酒馆删除: ${kvId}`);
    }

    // 清理 IndexedDB
    try {
        await deleteKv(kvId);
        deleted = true;
        console.log(`[Nimo Clone Storage] 已从 IndexedDB 删除: ${kvId}`);
    } catch (e) {
        // 可能在 IndexedDB 中本来就不存在
    }

    return deleted;
}

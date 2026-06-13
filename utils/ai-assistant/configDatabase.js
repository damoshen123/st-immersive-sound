// @ts-nocheck
/**
 * AI 助手 IndexedDB 持久化模块
 *
 * 存储分层：
 *   - 索引层 ai_chat_index           会话清单
 *   - 会话层 ai_chat_data_<chatId>   单个会话完整 messages
 *   - 缓存层 kv_<name>               通用 KV（模型列表等）
 *
 * 与 st-chatu8/configDatabase.js 的区别：
 *   - 仅 IndexedDB（不写酒馆服务器，不要图片层、不要 V1→V2 迁移）
 *   - 直接存 JS 对象（结构化克隆），不做 base64 编码
 */

const DB_NAME = 'st_is_ai_assistant';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

let dbPromise = null;

// ───── 内部：打开 DB ─────────────────────────────────────────
function _openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (ev) => {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onerror = (ev) => {
            console.error('[ST-IS-AI][DB] open failed:', ev.target.error);
            reject(ev.target.error);
        };
        req.onsuccess = (ev) => resolve(ev.target.result);
    });
    return dbPromise;
}

export async function openDB() {
    return _openDB();
}

export async function closeDB() {
    if (!dbPromise) return;
    const db = await dbPromise;
    db.close();
    dbPromise = null;
}

// ───── 内部：通用 put / get / delete ─────────────────────────
async function _put(id, data) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = { id, data, updatedAt: Date.now() };
        const req = store.put(record);
        req.onsuccess = () => resolve(true);
        req.onerror = (ev) => reject(ev.target.error);
    });
}

async function _get(id) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = (ev) => {
            const rec = ev.target.result;
            resolve(rec ? rec.data : null);
        };
        req.onerror = (ev) => reject(ev.target.error);
    });
}

async function _delete(id) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = (ev) => reject(ev.target.error);
    });
}

async function _getAllKeys() {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAllKeys();
        req.onsuccess = (ev) => resolve(ev.target.result || []);
        req.onerror = (ev) => reject(ev.target.error);
    });
}

// ───── 调试：清空全部 ────────────────────────────────────────
export async function clearAll() {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = (ev) => reject(ev.target.error);
    });
}

// ───── 会话索引 ──────────────────────────────────────────────
const INDEX_KEY = 'ai_chat_index';

export async function saveChatIndex(indexData) {
    if (!indexData) return;
    if (!indexData.version) indexData.version = 1;
    return _put(INDEX_KEY, indexData);
}

export async function getChatIndex() {
    return _get(INDEX_KEY);
}

// ───── 会话数据 ──────────────────────────────────────────────
const CHAT_DATA_PREFIX = 'ai_chat_data_';

export async function saveChatData(chatId, chatData) {
    if (!chatId) throw new Error('saveChatData: chatId 不能为空');
    return _put(CHAT_DATA_PREFIX + chatId, chatData);
}

export async function getChatData(chatId) {
    if (!chatId) return null;
    return _get(CHAT_DATA_PREFIX + chatId);
}

export async function deleteChatData(chatId) {
    if (!chatId) return false;
    return _delete(CHAT_DATA_PREFIX + chatId);
}

export async function listChatIds() {
    const keys = await _getAllKeys();
    return keys
        .filter((k) => typeof k === 'string' && k.startsWith(CHAT_DATA_PREFIX))
        .map((k) => k.slice(CHAT_DATA_PREFIX.length));
}

// ───── 通用 KV 缓存 ──────────────────────────────────────────
const KV_PREFIX = 'kv_';

export async function saveKv(name, data) {
    if (!name) throw new Error('saveKv: name 不能为空');
    return _put(KV_PREFIX + name, data);
}

export async function getKv(name) {
    if (!name) return null;
    return _get(KV_PREFIX + name);
}

export async function deleteKv(name) {
    if (!name) return false;
    return _delete(KV_PREFIX + name);
}

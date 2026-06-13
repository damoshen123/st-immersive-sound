import { getAudioContext } from './audio-context.js';
import { getTtsItem } from './tts-cache.js';
import { floatBallStateManager } from './ui-float-ball.js';

let memoryCache = new Map();
const dbName = 'AudioCacheDB';
const storeName = 'audioCache';

async function initDB() {
    return new Promise((resolve, reject) => {
        // Bump the version to 5 to simplify the schema
        const request = indexedDB.open(dbName, 5);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // For a clean migration, delete the old store and create a new one.
            if (db.objectStoreNames.contains(storeName)) {
                db.deleteObjectStore(storeName);
            }
            const store = db.createObjectStore(storeName, { keyPath: 'url' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
        };
    });
}

async function getFromDB(url) {
  const db = await initDB();
  const transaction = db.transaction([storeName], 'readonly');
  const store = transaction.objectStore(storeName);
  
  return new Promise((resolve, reject) => {
      const request = store.get(url);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
  });
}

async function saveToDB(url, arrayBuffer) {
    const db = await initDB();
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
        const request = store.put({
            url: url,
            arrayBuffer: arrayBuffer,
            timestamp: Date.now()
        });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function loadAudio(url, name, uploader = 'N/A', volume = 100, vibration = 'N/A', options = {}) {
    const { forceRefresh = false, maxAge = 7 * 24 * 60 * 60 * 1000, persistOnly = false } = options;
    let audioContext = null;
    const ensureAudioContext = () => {
        if (!audioContext) {
            audioContext = getAudioContext();
        }
        return audioContext;
    };

    // New: Handle virtual fake TTS audio
    if (url && url.startsWith('virtual-voice://')) {
        if (persistOnly) return null;
        try {
            const urlParams = new URL(url);
            const duration = parseFloat(urlParams.searchParams.get('duration')) || 1.0;
            const ctx = ensureAudioContext();
            const sampleRate = ctx.sampleRate || 44100;
            const length = Math.max(1, Math.floor(duration * sampleRate));
            const audioBuffer = ctx.createBuffer(1, length, sampleRate);
            console.log(`[audio-cache] Generated virtual audio buffer for duration: ${duration}s`);
            return audioBuffer;
        } catch (e) {
            console.error(`[audio-cache] Failed to generate virtual audio buffer:`, e);
            return null;
        }
    }

    // New: Check if it's a TTS key and try to get it from the TTS memory cache
    if (url && url.startsWith('tts-')) {
        if (persistOnly) {
            return null;
        }
        const ttsItem = getTtsItem(url);
        if (ttsItem && ttsItem.status === 'success' && ttsItem.audioBuffer) {
            console.log(`Returning from TTS memory cache: ${url}`);
            // The playback logic expects a decoded AudioBuffer.
            // We need to decode it if it's not already an AudioBuffer instance.
            // For simplicity, we assume tts-cache stores the raw ArrayBuffer, so we decode it.
            // This could be optimized by storing the decoded buffer in tts-cache as well.
            try {
                // Check if it's already decoded
                if (ttsItem.decodedBuffer) {
                    return ttsItem.decodedBuffer;
                }
                const decodedBuffer = await ensureAudioContext().decodeAudioData(ttsItem.audioBuffer.slice(0));
                ttsItem.decodedBuffer = decodedBuffer; // Cache the decoded buffer
                return decodedBuffer;
            } catch (e) {
                console.error(`Failed to decode TTS audio from cache for ${url}:`, e);
                return null;
            }
        } else {
            console.warn(`TTS audio not ready or not found in memory cache for key: ${url}`);
            return null; // Don't proceed to fetch from network for TTS keys here
        }
    }

    // 1. Check memory cache (fastest: holds decoded AudioBuffers)
    if (!forceRefresh && memoryCache.has(url)) {
        console.log(`Returning from memory cache: ${url}`);
        return memoryCache.get(url);
    }

    // 2. Check IndexedDB (slower: holds raw ArrayBuffers)
    if (!forceRefresh) {
        try {
            const cached = await getFromDB(url);
            if (cached && cached.arrayBuffer && (Date.now() - cached.timestamp < maxAge)) {
                console.log(`Decoding from IndexedDB cache: ${url}`);
                // Decode the ArrayBuffer into an AudioBuffer
                const audioBuffer = await ensureAudioContext().decodeAudioData(cached.arrayBuffer.slice(0));
                // Promote to memory cache for next time
                memoryCache.set(url, audioBuffer);
                return audioBuffer;
            }
        } catch (error) {
            console.error(`Failed to get/decode from IndexedDB, will fetch from network: ${url}`, error);
            // If decoding fails, we should clear the bad entry from the DB
            try {
                const db = await initDB();
                await db.transaction(storeName, 'readwrite').objectStore(storeName).delete(url);
                console.log(`Removed corrupted audio from IndexedDB: ${url}`);
            } catch (dbError) {
                console.error(`Failed to remove corrupted audio from DB:`, dbError);
            }
        }
    }

    // 3. Fetch from network (last resort)
    // Blob URL 是临时的：允许解码播放，但不持久化到 IndexedDB
    if (typeof url === 'string' && url.startsWith('blob:')) {
        if (persistOnly) {
            return null;
        }
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await ensureAudioContext().decodeAudioData(arrayBuffer);
            memoryCache.set(url, audioBuffer);
            return audioBuffer;
        } catch (error) {
            console.warn(`[audio-cache] Failed to decode blob URL audio: ${url}`, error);
            return null;
        }
    }
    try {
        console.log(`Fetching from network: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();

        // Save the raw buffer to IndexedDB for persistence
        await saveToDB(url, arrayBuffer.slice(0));
        if (persistOnly) {
            memoryCache.delete(url);
            return true;
        }

        // Decode for immediate use
        const audioBuffer = await ensureAudioContext().decodeAudioData(arrayBuffer);

        // Store the decoded buffer in memory cache
        memoryCache.set(url, audioBuffer);

        return audioBuffer;
    } catch (error) {
        console.error(`Failed to fetch or decode audio from ${url}:`, error);
        return null;
    }
}

// 清理过期缓存
async function cleanupCache(maxAge = 1000) { // 7 * 24 * 60 * 60 * 1000
  const db = await initDB();
  const transaction = db.transaction([storeName], 'readwrite');
  const store = transaction.objectStore(storeName);
  const index = store.index('timestamp');
  const cutoffTime = Date.now() - maxAge;
  const range = IDBKeyRange.upperBound(cutoffTime);
  
  const request = index.openCursor(range);
  request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
      }
  };
}

// 获取缓存大小
async function getCacheSize() {
  const db = await initDB();
  const transaction = db.transaction([storeName], 'readonly');
  const store = transaction.objectStore(storeName);
  let totalSize = 0;

  return new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
              totalSize += cursor.value.arrayBuffer.byteLength;
              cursor.continue();
          } else {
              resolve(totalSize);
          }
      };
      request.onerror = () => reject(request.error);
  });
}

async function getAllCachedAudio(options = {}) {
    const { includeArrayBuffer = true } = options;
    const db = await initDB();
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);

    if (!includeArrayBuffer) {
        return new Promise((resolve, reject) => {
            const items = [];
            const request = store.openCursor();
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const value = cursor.value;
                    items.push({
                        url: value.url,
                        cachedSize: value.arrayBuffer?.byteLength || 0,
                        timestamp: value.timestamp,
                    });
                    cursor.continue();
                } else {
                    resolve(items);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function ensureAudiosAreCached(musicList) {
    // Filter out items that don't have a URL, TTS items, or virtual-voice items
    const audiosToCache = musicList.filter(music => music.url && !music.url.startsWith('tts-') && !music.url.startsWith('virtual-voice://'));

    if (audiosToCache.length === 0) {
        console.log("No new static audio to cache.");
        return;
    }

    const uncachedAudios = [];
    // Check against IndexedDB directly to see if the raw data is stored
    const checkPromises = audiosToCache.map(async (music) => {
        const cached = await getFromDB(music.url);
        if (!cached || !cached.arrayBuffer) {
            uncachedAudios.push(music);
        }
    });
    await Promise.all(checkPromises);

    if (uncachedAudios.length === 0) {
        console.log("All required audio is already in persistent cache.");
        return;
    }

    floatBallStateManager.startLoading();
    try {
        const totalCount = uncachedAudios.length;
        let downloadedCount = 0;
        let allSucceeded = true;

        const toastrInfo = toastr.info(`开始下载 ${totalCount} 个音频... (0/${totalCount})`, "缓存音频", { timeOut: 0, extendedTimeOut: 0, "progressBar": true });

        const downloadPromises = uncachedAudios.map(music =>
            (async () => {
                try {
                    const response = await fetch(music.url);
                    if (!response.ok) throw new Error(`HTTP 错误! status: ${response.status}`);
                    const arrayBuffer = await response.arrayBuffer();
                    // Save raw ArrayBuffer to DB. Decoding and memory caching will happen in loadAudio.
                    await saveToDB(music.url, arrayBuffer);
                } catch (error) {
                    allSucceeded = false;
                    console.error(`缓存失败 ${music.src} from ${music.url}:`, error);
                    toastr.error(`缓存失败: ${music.src}`);
                } finally {
                    downloadedCount++;
                    const progress = Math.round((downloadedCount / totalCount) * 100);
                    if (toastrInfo) {
                        $(toastrInfo).find('.toast-message').text(`正在下载 ${totalCount} 个音频... (${downloadedCount}/${totalCount})`);
                        $(toastrInfo).find('.progress').css('width', progress + '%');
                    }
                }
            })()
        );

        await Promise.all(downloadPromises);

        if (toastrInfo) toastr.clear(toastrInfo);

        if (allSucceeded) {
            toastr.success(`成功缓存 ${totalCount} 个音频文件。`);
        } else {
            toastr.warning(`部分音频下载失败，请检查控制台。`);
        }
    } finally {
        floatBallStateManager.stopLoading();
    }
}

export {
    memoryCache,
    dbName,
    storeName,
    initDB,
    loadAudio,
    getFromDB,
    saveToDB,
    cleanupCache,
    getCacheSize,
    getAllCachedAudio,
    ensureAudiosAreCached,
};

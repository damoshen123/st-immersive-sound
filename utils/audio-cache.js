import { getAudioContext } from './audio-context.js';

let memoryCache = new Map();
const dbName = 'AudioCacheDB';
const storeName = 'audioCache';

async function initDB() {
    return new Promise((resolve, reject) => {
        // Bump the version to 4 to trigger onupgradeneeded for adding volume and vibration
        const request = indexedDB.open(dbName, 4);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            let store;
            if (!db.objectStoreNames.contains(storeName)) {
                store = db.createObjectStore(storeName, { keyPath: 'url' });
            } else {
                store = event.target.transaction.objectStore(storeName);
            }
            
            if (!store.indexNames.contains('timestamp')) {
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
            // Add a new index for the name
            if (!store.indexNames.contains('name')) {
                store.createIndex('name', 'name', { unique: false });
            }
            // Add a new index for the uploader
            if (!store.indexNames.contains('uploader')) {
                store.createIndex('uploader', 'uploader', { unique: false });
            }
            // Add new indexes for volume and vibration
            if (!store.indexNames.contains('volume')) {
                store.createIndex('volume', 'volume', { unique: false });
            }
            if (!store.indexNames.contains('vibration')) {
                store.createIndex('vibration', 'vibration', { unique: false });
            }
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

async function saveToDB(url, name, uploader, arrayBuffer, volume, vibration) {
    const db = await initDB();
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
        const request = store.put({
            url: url,
            name: name,
            uploader: uploader,
            arrayBuffer: arrayBuffer,
            timestamp: Date.now(),
            volume: volume,
            vibration: vibration
        });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function loadAudio(url, name, uploader = 'N/A', volume = 100, vibration = 'N/A', options = {}) {
    const { forceRefresh = false, maxAge = 7 * 24 * 60 * 60 * 1000 } = options;
    const audioContext = getAudioContext();

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
                const audioBuffer = await audioContext.decodeAudioData(cached.arrayBuffer.slice(0));
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
    try {
        console.log(`Fetching from network: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();

        // Save the raw buffer to IndexedDB for persistence
        await saveToDB(url, name, uploader, arrayBuffer.slice(0), volume, vibration);

        // Decode for immediate use
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

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

async function getAllCachedAudio() {
    const db = await initDB();
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function ensureAudiosAreCached(musicList) {
    const uncachedAudios = [];
    // Check against IndexedDB directly to see if the raw data is stored
    const checkPromises = musicList.map(async (music) => {
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
                await saveToDB(music.url, music.src, music.uploader || 'N/A', arrayBuffer, music.volume, music.vibration);
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

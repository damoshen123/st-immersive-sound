import { getAudioContext } from './audio-context.js';

let memoryCache = new Map();
const dbName = 'AudioCacheDB';
const storeName = 'audioCache';

async function initDB() {
    return new Promise((resolve, reject) => {
        // Bump the version to 3 to trigger onupgradeneeded for adding uploader
        const request = indexedDB.open(dbName, 3);

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

async function saveToDB(url, name, uploader, arrayBuffer) {
    const db = await initDB();
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
        const request = store.put({
            url: url,
            name: name,
            uploader: uploader,
            arrayBuffer: arrayBuffer,
            timestamp: Date.now()
        });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function loadAudio(url, name, uploader = 'N/A', options = {}) {
    const { forceRefresh = false, maxAge = 7 * 24 * 60 * 60 * 1000 } = options;

    // Helper to create the audio source node from a URL or a Blob
    function createSourceNode(audioData) {
        const audio = new Audio();
        audio.crossOrigin = "anonymous"; // Good practice for cross-origin resources
        const context = getAudioContext();
        const source = context.createMediaElementSource(audio);

        if (audioData instanceof Blob) {
            const blobUrl = URL.createObjectURL(audioData);
            audio.src = blobUrl;
            // Store the blob URL on the element itself so we can revoke it later
            audio.blobUrl = blobUrl;
        } else {
            // It's a regular URL string
            audio.src = audioData;
            audio.blobUrl = null;
        }
        
        return source;
    }

    // Helper to cache the audio in the background
    async function cacheInBackground(url, name, uploader) {
        // Avoid re-caching if it's already in memory
        if (memoryCache.has(url)) return;

        try {
            console.log(`Background caching started for: ${url}`);
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            // Save to both caches
            await saveToDB(url, name, uploader, arrayBuffer.slice(0));
            memoryCache.set(url, arrayBuffer.slice(0));
            console.log(`Successfully cached in background: ${url}`);
        } catch (error) {
            console.error(`Background caching failed for ${url}:`, error);
        }
    }

    // 1. Check caches first for offline/repeat playback.
    if (!forceRefresh) {
        // Check memory cache (fastest)
        if (memoryCache.has(url)) {
            console.log(`Playing from memory cache: ${url}`);
            const arrayBuffer = memoryCache.get(url);
            const blob = new Blob([arrayBuffer], { type: 'audio/mp3' });
            return createSourceNode(blob);
        }

        // Check IndexedDB (slower, but persistent)
        try {
            const cached = await getFromDB(url);
            if (cached && (Date.now() - cached.timestamp < maxAge)) {
                console.log(`Playing from IndexedDB cache: ${url}`);
                const arrayBuffer = cached.arrayBuffer;
                memoryCache.set(url, arrayBuffer.slice(0)); // Promote to memory cache
                const blob = new Blob([arrayBuffer], { type: 'audio/mp3' });
                return createSourceNode(blob);
            }
        } catch (error) {
            console.error(`Failed to get from IndexedDB, will stream from network: ${url}`, error);
        }
    }

    // 2. If not in cache (or forced refresh), stream from network for immediate playback.
    console.log(`Streaming from network and caching in background: ${url}`);
    
    // Start caching in the background, but don't wait for it to finish.
    cacheInBackground(url, name, uploader);

    // Immediately return a source node that streams directly from the original URL.
    return createSourceNode(url);
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
    const checkPromises = musicList.map(async (music) => {
        if (memoryCache.has(music.url)) return;
        const cached = await getFromDB(music.url);
        if (!cached) {
            uncachedAudios.push(music);
        }
    });
    await Promise.all(checkPromises);

    if (uncachedAudios.length === 0) {
        console.log("All required audio is already cached.");
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
                await saveToDB(music.url, music.src, music.uploader || 'N/A', arrayBuffer.slice(0));
                memoryCache.set(music.url, arrayBuffer.slice(0));
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

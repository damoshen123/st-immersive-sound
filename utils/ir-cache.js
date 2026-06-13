import { extensionFolderPath } from './config.js';

const irCache = new Map();

/**
 * Asynchronously loads an Impulse Response (IR) file from the extension's folder,
 * using a cache to avoid redundant fetches and decoding.
 * @param {string} fileName - The name of the .wav file to load.
 * @returns {Promise<AudioBuffer|null>} The decoded audio buffer or null if loading fails.
 */
export async function loadIrBufferWithCache(fileName) {
    if (!fileName) {
        return null;
        
    }

    if (irCache.has(fileName)) {
        // console.log(`[IR Cache] Returning cached buffer for: ${fileName}`);
        return irCache.get(fileName);
    }

    try {
        await Tone.start();
        const url = `${extensionFolderPath}/${fileName}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch IR file: ${response.statusText} (URL: ${url})`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await Tone.context.decodeAudioData(arrayBuffer);
        
        irCache.set(fileName, audioBuffer);
        console.log(`[IR Cache] Fetched and cached buffer for: ${fileName}`);
        
        return audioBuffer;
    } catch (error) {
        console.error(`[st-immersive-sound] Failed to load IR file "${fileName}":`, error);
       // toastr.error(`加载环境混响文件失败: ${fileName}`);
        return null;
    }
}

/**
 * Clears the entire IR cache.
 */
export function clearIrCache() {
    irCache.clear();
    console.log('[IR Cache] Cache cleared.');
}

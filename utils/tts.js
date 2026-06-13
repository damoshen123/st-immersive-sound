// @ts-nocheck
import { floatBallStateManager } from "./ui-float-ball.js";
const API_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const DEFAULT_TIMEOUT_MS = 15000;
const TIMEOUT_RETRY_COUNT = 1;

/**
 * A simple concurrency limiter for async functions.
 * @param {number} limit - The maximum number of concurrent executions.
 * @returns {function(function): function} - A function that takes an async function and returns a new, limited function.
 */
function createConcurrencyLimiter(limit) {
    const queue = [];
    let activeCount = 0;

    const next = () => {
        if (activeCount < limit && queue.length > 0) {
            activeCount++;
            const { fn, args, resolve, reject } = queue.shift();
            fn(...args)
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    activeCount--;
                    next();
                });
        }
    };

    return (fn) => {
        return (...args) => {
            return new Promise((resolve, reject) => {
                queue.push({ fn, args, resolve, reject });
                next();
            });
        };
    };
}

/**
 * Performs the actual TTS API call and returns the audio buffer.
 * This function is now a pure API client.
 * @param {object} requestData - The data for the TTS request.
 * @returns {Promise<{audioBuffer: ArrayBuffer}>} - A promise that resolves with the audio buffer.
 */
async function fetchTtsAudio(requestData) {
    const { appId, accessKey, speaker, resourceId, text, context_texts, options = {} } = requestData;
    const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const headers = {
        "X-Api-App-Key": appId,          // 必须
        "X-Api-Access-Key": accessKey,   // 必须
        "X-Api-Resource-Id": resourceId, // 必须
        "Content-Type": "application/json",
      };


    const payload = {
        user: { uid: "1222356" },
        req_params: {
            text,
            speaker,
            audio_params: {
                format: "mp3",
                sample_rate: 24000,
            },
            additions: JSON.stringify({
                context_texts: context_texts ? [context_texts] : [],
            }),
        },
    };

  try {
    floatBallStateManager.startLoading();
    for (let attempt = 0; attempt <= TIMEOUT_RETRY_COUNT; attempt++) {
      const controller = new AbortController();
      const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`HTTP error! status: ${response.status}${errText ? `, body: ${errText}` : ''}`);
        }
        if (!response.body) {
          throw new Error("No response body (ReadableStream not supported?).");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = '';
        let finished = false;
        const audioChunks = [];
        let totalBytes = 0;

        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let boundary;
          while ((boundary = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 1);

            if (!line) continue;

            let data;
            try {
              data = JSON.parse(line);
            } catch (e) {
              console.error("Failed to parse JSON line:", e, "Line:", line);
              continue;
            }

            if (data.code === 0 && data.data) {
              const chunkAudio = Uint8Array.from(atob(data.data), c => c.charCodeAt(0));
              audioChunks.push(chunkAudio);
              totalBytes += chunkAudio.length;
            } else if (data.code === 0 && data.sentence) {
            } else if (data.code === 20000000) {
              finished = true;
              break;
            } else if (data.code > 0) {
              console.error("TTS API Error:", data);
              throw new Error(JSON.stringify(data));
            }
          }
        }

        if (totalBytes > 0) {
            const merged = new Uint8Array(totalBytes);
            let offset = 0;
            for (const c of audioChunks) {
                merged.set(c, offset);
                offset += c.length;
            }
            return { audioBuffer: merged.buffer };
        }
        throw new Error("Received no audio data from TTS API.");
      } catch (error) {
        const isTimeout = error?.name === 'AbortError';
        if (!isTimeout || attempt >= TIMEOUT_RETRY_COUNT) {
          throw (isTimeout ? new Error(`请求超时 (${timeoutMs / 1000}s)`) : error);
        }
      } finally {
        clearTimeout(timeoutTimer);
      }
    }
  } catch (error) {
    console.error("TTS request failed:", error);
    // Re-throw the error to be caught by the caller (tts-cache)
    throw error;
  } finally {
    floatBallStateManager.stopLoading();
  }
}

/**
 * Initializes the TTS API module.
 * It returns a concurrency-limited function for making TTS requests.
 * @param {number} [concurrency=5] - The max number of parallel API requests.
 * @returns {function(object): Promise<{audioBuffer: ArrayBuffer}>} - The function to call to make a TTS request.
 */
export function initTtsApi(concurrency = 5) {
    const limit = createConcurrencyLimiter(concurrency);
    const limitedFetchTts = limit(fetchTtsAudio);

    console.log(`TTS API module initialized with a concurrency limit of ${concurrency}.`);

    // This is the function that tts-cache will use.
    return async (requestData) => {
        const { appId, accessKey, speaker, resourceId, text } = requestData || {};
        if (appId && accessKey && speaker && resourceId && text) {
            return limitedFetchTts(requestData);
        } else {
            console.error("Invalid TTS request data:", requestData);
            throw new Error("TTS 请求参数不完整。");
        }
    };
}

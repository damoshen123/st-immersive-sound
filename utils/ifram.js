// @ts-nocheck
import { eventSource, settings, saveSettingsDebounced } from "../../../../../script.js";
import { CharacterReadingMarker } from './reading-marker.js';
import { mapRawRangesToDom } from './helpers.js';
import { eventNames,extensionName } from "./config.js";
import { extension_settings } from "../../../../extensions.js";
import { getContext } from "../../../../st-context.js";
import { GENERATION_audio,LLM_EXECUTE,LLM_GET_PROMPT } from "./newline_fix.js";
import { stopAllAudio, sourceisPlaying, isSfxWaitPlaying } from "./playback.js";
import { isLLMRequestActive, abortLLMRequest } from './ui-llm.js';
import { floatBallStateManager } from "./ui-float-ball.js";
import * as requestCache from './request-cache.js';
import { TtsCacheEmitter } from './tts-cache.js';
import { logManager } from './log.js';
import { saveMainSfxConfigSession } from './main-sfx-config-state.js';
/**
 * 双击监控模块 - 简化版
 */
let lastDoubleClickTime = 0;
// 存储已绑定的元素
const boundElements = new WeakSet();

// 轮询定时器
let pollingTimer = null;

/**
 * 从点击目标向上查找第一个 div
 * @param {Element} target
 * @returns {Element|null}
 */
function findFirstDivContainer(target) {
    let el = target;
    let depth = 0;
    const maxDepth = 15;

    while (el && depth < maxDepth) {
        if (el.tagName?.toLowerCase() === 'div') {
            return el;
        }
        el = el.parentElement;
        depth++;
    }

    return null;
}

/**
 * 从任意元素定位到外层 mes_text
 * 【同层】元素在 iframe 内 -> 主文档寻找对应 iframe.closest('.mes_text')
 * 【非同层】元素在主文档 -> el.closest('.mes_text')
 * @param {Element} el
 * @returns {Element|null}
 */
function findMesTextElement(el) {
    if (!el) return null;
    if (el.classList?.contains?.('mes_text')) return el;
    if (el.ownerDocument && el.ownerDocument !== document) {
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                if (iframe.contentDocument === el.ownerDocument || iframe.contentWindow?.document === el.ownerDocument) {
                    return iframe.closest('.mes_text');
                }
            } catch (_) { /* 跨域忽略 */ }
        }
    }
    return el.closest?.('.mes_text') || null;
}

/**
 * 从点击元素获取当前消息的原始文本（走 SillyTavern context.chat[mesId].mes）
 * 只取当前一条；跳过 mesId === 0（开场白不是正常消息）
 * 与长度不足 100 的场景 -> 返回 null让调用方回退到 DOM 文本
 * @param {Element} el
 * @returns {{text: string, mesId: number}|null}
 */
function getRawMessageTextFromEl(el) {
    try {
        const mesTextEl = findMesTextElement(el);
        if (!mesTextEl) return null;
        const mesEl = mesTextEl.parentElement?.parentElement;
        const mesIdStr = mesEl?.getAttribute?.('mesid');
        if (!mesIdStr) return null;
        const mesId = parseInt(mesIdStr, 10);
        if (Number.isNaN(mesId) || mesId === 0) return null;
        const ctx = getContext?.();
        const rawText = ctx?.chat?.[mesId]?.mes || '';
        if (!rawText || rawText.length < 100) return null;
        return { text: rawText, mesId };
    } catch (err) {
        console.warn('[监控] getRawMessageTextFromEl 异常:', err);
        return null;
    }
}

/**
 * 获取点击位置的具体字符信息
 * @param {MouseEvent|TouchEvent} e 
 * @param {Document} doc
 * @returns {Object|null}
 */
function getClickedCharInfo(e, doc = document) {
    let x, y;
    
    if (e.changedTouches && e.changedTouches.length > 0) {
        x = e.changedTouches[0].clientX;
        y = e.changedTouches[0].clientY;
    } else {
        x = e.clientX;
        y = e.clientY;
    }

    let range = null;
    let textNode = null;
    let offset = 0;

    if (doc.caretRangeFromPoint) {
        range = doc.caretRangeFromPoint(x, y);
        if (range) {
            textNode = range.startContainer;
            offset = range.startOffset;
        }
    } else if (doc.caretPositionFromPoint) {
        const pos = doc.caretPositionFromPoint(x, y);
        if (pos) {
            textNode = pos.offsetNode;
            offset = pos.offset;
        }
    }

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        return null;
    }

    const text = textNode.textContent || '';
    const clickedChar = text.charAt(offset) || text.charAt(offset - 1) || '';
    
    const contextBefore = text.substring(Math.max(0, offset - 10), offset);
    const contextAfter = text.substring(offset, Math.min(text.length, offset + 10));

    return {
        char: clickedChar,
        offset: offset,
        textNode: textNode,
        textContent: text,
        parentElement: textNode.parentElement,
        contextBefore: contextBefore,
        contextAfter: contextAfter,
        context: contextBefore + '[' + clickedChar + ']' + contextAfter,
        range: range
    };
}

/**
 * 构建双击信息对象
 * @param {Event} e 
 * @param {Element} container 
 * @param {Document} doc 
 * @returns {Object}
 */
function buildDoubleClickInfo(e, container, doc) {
    const clickedElement = e.target;
    // containerText will be generated later using CharacterReadingMarker
    const charInfo = getClickedCharInfo(e, doc);

    return {
        container: container,
        clickedElement: clickedElement,
        doc: doc,
        charInfo: charInfo
    };
}

function capturePlaybackStartInfo(info) {
    if (!info?.charInfo?.textNode) return null;

    let startGlobalIndex = null;
    try {
        const tempMarker = new CharacterReadingMarker(info.container);
        tempMarker.collectCharacterPositions();
        const matchedChar = tempMarker.charPositions.find(position => (
            position.node === info.charInfo.textNode && position.offset === info.charInfo.offset
        ));
        if (matchedChar) {
            startGlobalIndex = matchedChar.globalIndex;
        }
        tempMarker.destroy();
    } catch (err) {
        console.warn('[st-immersive-sound] 捕获播放起点失败，回退为节点定位：', err);
    }

    return {
        startNode: info.charInfo.textNode,
        startOffset: info.charInfo.offset,
        startGlobalIndex,
    };
}

/**
 * 处理双击事件
 * @param {Event} e 
 * @param {Element} boundContainer
 * @param {Document} doc
 */
async function runPlaybackLogic(info, preciseText, options = {}) {
    const { fromStart = true, forceLlm = false } = options;

    // Set start position for playback
    if (!fromStart && info.charInfo) {
        const startInfo = capturePlaybackStartInfo(info);
        if (startInfo) {
            window.stImmersiveSoundStartInfo = startInfo;
        } else {
            delete window.stImmersiveSoundStartInfo;
        }
    } else {
        delete window.stImmersiveSoundStartInfo;
    }

    const cacheKey = preciseText;

    // 计算 DOM 收集到的纯文字（播放/标记器使用的坐标系）。
    // 正则跑在 raw（preciseText）上以便匹配 <think> 等标签；
    // 但 removedRanges/regex_start/regex_end 最终需要在 DOM 文本坐标系下生效，
    // 因此这里取一份 DOM 文本，下面把 raw 上的区间映射回 DOM 上。
    let domMesText = preciseText;
    try {
        const tempMarker = new CharacterReadingMarker(info.container);
        domMesText = tempMarker.getCollectedText();
        tempMarker.destroy();
    } catch (err) {
        console.warn('[st-immersive-sound] 取 DOM 文本失败，回退使用原始文本：', err);
    }
    const mapRanges = (rawRanges) => {
        if (!rawRanges || rawRanges.length === 0) return [];
        if (domMesText === preciseText) return rawRanges;
        return mapRawRangesToDom(preciseText, rawRanges, domMesText);
    };

    if (forceLlm) {
        console.log('[Cache] Force LLM: Clearing caches.');
        requestCache.clear();
        const { clearTtsCache } = await import('./tts-cache.js');
        clearTtsCache();
        const { clearRecentSfxCache } = await import('./recent-sfx-cache.js');
        clearRecentSfxCache();
        toastr.info('声临其境：缓存已清空，将重新请求。');
    }

    if (!forceLlm && requestCache.has(cacheKey)) {
        console.log('[Cache] Hit! Loading BGM data from cache.');
        const cachedPromt = requestCache.get(cacheKey);

        // Even with a cache hit for the prompt, we still need to calculate the removed ranges.
        // We can call GENERATION_audio with a flag to only perform the regex part.
        // This assumes GENERATION_audio is modified to handle such a flag.
        console.log('[Cache] Recalculating removed ranges for cached prompt.');
        const { removedRanges: rawRemovedRanges, cleanedMessage } = await GENERATION_audio(preciseText);
        const removedRanges = mapRanges(rawRemovedRanges);

        // 缓存命中也要遵守测试模式（否则相当于失效）
        if (extension_settings[extensionName].regexTestMode) {
            console.log("声临其境：正则测试模式（缓存命中分支）");
            logManager.add("声临其境：正则测试模式（缓存命中）\n");
            toastr.info('🧪 声临其境：正则测试模式已启用：已停止后续处理（缓存命中也拦截）');
            // 一次性消耗
            extension_settings[extensionName].regexTestMode = false;
            $('#regexTestMode').prop('checked', false);
            saveSettingsDebounced();
            console.log('[ifram] 正则测试模式已自动关闭（一次性触发-缓存）');
            return;
        }
        if (extension_settings[extensionName].llmTestMode) {
            console.log("声临其境：LLM 测试模式（缓存命中分支）");
            logManager.add("声临其境：LLM 测试模式（缓存命中）\n");
            toastr.info('🧪 声临其境：LLM 测试模式已启用：已停止音频生成（缓存命中也拦截）');
            // 一次性消耗
            extension_settings[extensionName].llmTestMode = false;
            $('#llmTestMode').prop('checked', false);
            saveSettingsDebounced();
            console.log('[ifram] LLM 测试模式已自动关闭（一次性触发-缓存）');
            return;
        }

        saveMainSfxConfigSession({
            configText: cachedPromt,
            fullMesText: domMesText,
            rawMesText: preciseText,
            cleanedMesText: cleanedMessage,
            removedRanges: removedRanges,
            mesTextElement: info.container,
        });

        eventSource.emit('st-immersive-sound:double-click', {
            mesTextElement: info.container,
            fullMesText: domMesText,
            rawMesText: preciseText,
            mestxt: cachedPromt,
            removedRanges: removedRanges, // Pass ranges even on cache hit
            cleanedMesText: cleanedMessage, // 正则清洗后的源文本（与 LLM 一致）
        });
        return;
    }

    toastr.info('正在生成音频指令...');
    floatBallStateManager.startLoading();
    // GENERATION_audio now returns an object { promt, removedRanges }

    
    const { promt: mestxt, removedRanges: rawRemovedRanges, cleanedMessage } = await GENERATION_audio(preciseText);
    const removedRanges = mapRanges(rawRemovedRanges);
    floatBallStateManager.stopLoading();
    
    if (extension_settings[extensionName].regexTestMode) {
        console.log("声临其境：正则测试模式");
        logManager.add("声临其境：正则测试模式\n")
        toastr.info('🧪 声临其境：正则测试模式已启用：已停止 LLM 请求，仅展示最终 Prompt');

        // 自动关闭正则测试模式（一次性消耗）
        extension_settings[extensionName].regexTestMode = false;
        $('#regexTestMode').prop('checked', false);
        saveSettingsDebounced();
        console.log('[ifram] 正则测试模式已自动关闭（一次性触发）');
        return;
    }

    toastr.success('消息已发送到LLM处理...');
    try {
        floatBallStateManager.startLoading();
        let next_promt = await LLM_EXECUTE(mestxt, { timeoutMs: 300000 });
      
        floatBallStateManager.stopLoading();
        console.log("声临其境：LLM 处理结果:", next_promt);

        logManager.add("声临其境：LLM 处理结果:\n"+next_promt)

        saveMainSfxConfigSession({
            configText: next_promt,
            fullMesText: domMesText,
            rawMesText: preciseText,
            cleanedMesText: cleanedMessage,
            removedRanges: removedRanges,
            mesTextElement: info.container,
        });

        if (next_promt) {
            requestCache.set(cacheKey, next_promt);
            console.log('[Cache] BGM data has been saved to cache.');
        }

        if (extension_settings[extensionName].llmTestMode) {
            console.log("声临其境：LLM 测试模式");
            logManager.add("声临其境：LLM 测试模式\n")
            toastr.info('🧪 声临其境：LLM 测试模式已启用：已停止后续处理，仅展示 LLM 结果');

            // 自动关闭 LLM 测试模式（一次性消耗）
            extension_settings[extensionName].llmTestMode = false;
            $('#llmTestMode').prop('checked', false);
            saveSettingsDebounced();
            console.log('[ifram] LLM 测试模式已自动关闭（一次性触发）');
            return;
        }

        eventSource.emit('st-immersive-sound:double-click', {
            mesTextElement: info.container,
            fullMesText: domMesText,
            rawMesText: preciseText,
            mestxt: next_promt,
            removedRanges: removedRanges, // Pass the ranges to the next step
            cleanedMesText: cleanedMessage, // 正则清洗后的源文本（与 LLM 一致）
        });
    } catch (error) {
        floatBallStateManager.stopLoading();
        if (error.name !== 'AbortError') {
            toastr.error(error.message);
        }
        // If aborted, the message is already handled by abortLLMRequest
    }
}


function showActionBubble(info, preciseText, e) {
    // Remove existing bubble if any
    const existingBubble = document.getElementById('st-is-action-bubble-overlay');
    if (existingBubble) {
        existingBubble.remove();
    }
    logManager.clear();
    const overlay = document.createElement('div');
    overlay.id = 'st-is-action-bubble-overlay';
    overlay.className = 'st-is-action-bubble-overlay';

    const bubble = document.createElement('div');
    bubble.className = 'st-is-action-bubble';

    const llmActive = isLLMRequestActive();
    const hasCache = requestCache.has(preciseText);

    const buttons = [
        {
            text: '从头播放',
            icon: 'fa-solid fa-backward-fast',
            action: () => runPlaybackLogic(info, preciseText, { fromStart: true, forceLlm: false })
        },
        {
            text: '从当前位置播放',
            icon: 'fa-solid fa-play-circle',
            action: () => runPlaybackLogic(info, preciseText, { fromStart: false, forceLlm: false })
        },
        {
            text: '重新请求 (清空缓存)',
            icon: 'fa-solid fa-arrows-rotate',
            action: () => runPlaybackLogic(info, preciseText, { fromStart: true, forceLlm: true })
        },
        {
            text: '取消',
            icon: 'fa-solid fa-xmark',
            action: () => {} // The generic onclick handles removal, so the action is empty.
        },
    ];

    if (hasCache) {
        buttons.splice(2, 0, { // Insert at index 2
            text: '下载音频',
            icon: 'fa-solid fa-download',
            action: () => {
                const cachedPromt = requestCache.get(preciseText);
                eventSource.emit('st-immersive-sound:download-audio', {
                    fullMesText: preciseText, // 下载分支会再走一遍 GENERATION_audio，仍需 raw
                    mesTextElement: info.container,
                    mestxt: cachedPromt,
                });
                toastr.info('已开始准备音频文件，请稍候...');
            }
        });
    }

    if (llmActive) {
        buttons.unshift({
            text: '停止请求',
            icon: 'fa-solid fa-stop-circle',
            className: 'danger',
            action: () => abortLLMRequest()
        });
    }

    buttons.forEach(btnInfo => {
        const button = document.createElement('button');
        button.className = 'st-is-action-bubble-button';
        if (btnInfo.className) {
            button.classList.add(btnInfo.className);
        }
        button.innerHTML = `<i class="${btnInfo.icon}"></i><span>${btnInfo.text}</span>`;
        button.onclick = () => {
            overlay.remove();
            btnInfo.action();

            // 点击按钮后，取消页面上的文字选中
            if (window.getSelection) {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    selection.removeAllRanges();
                }
            } else if (document.selection) { // 兼容旧版IE
                document.selection.empty();
            }
        };
        bubble.appendChild(button);
    });

    overlay.appendChild(bubble);
    document.body.appendChild(overlay);

    // --- Responsive Sizing via JS ---
    const isMobile = window.innerWidth <= 480;
    if (isMobile) {
        bubble.style.padding = '16px';
        bubble.style.gap = '10px';
        bubble.style.minWidth = '240px';
        
        buttons.forEach(btnInfo => {
            const buttonEl = bubble.querySelector(`i.${btnInfo.icon.replace(/ /g, '.')}`).parentElement;
            if (buttonEl) {
                buttonEl.style.padding = '10px 16px';
                buttonEl.style.fontSize = '0.9rem';
                buttonEl.style.gap = '6px';
            }
        });
    }

    // --- Positioning Logic ---
    const clickX = e.clientX ?? e.changedTouches?.[0]?.clientX ?? 0;
    const clickY = e.clientY ?? e.changedTouches?.[0]?.clientY ?? 0;

    const bubbleRect = bubble.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let newLeft = clickX;
    let newTop = clickY;

    // Adjust horizontal position to keep it within the viewport
    if (newLeft + bubbleRect.width > viewportWidth) {
        newLeft = viewportWidth - bubbleRect.width - 10; // 10px padding from the edge
    }
    if (newLeft < 0) {
        newLeft = 10; // 10px padding from the edge
    }

    // Adjust vertical position to keep it within the viewport
    if (newTop + bubbleRect.height > viewportHeight) {
        newTop = clickY - bubbleRect.height - 10; // Show above the cursor with padding
    }
    if (newTop < 0) {
        newTop = 10; // 10px padding from the edge
    }

    bubble.style.position = 'absolute';
    bubble.style.left = `${newLeft}px`;
    bubble.style.top = `${newTop}px`;


    // Close bubble on overlay click
    const closeHandler = (evt) => {
        if (evt.target === overlay) {
            overlay.remove();
        }
    };

    overlay.addEventListener('click', closeHandler);
    overlay.addEventListener('touchend', closeHandler);
}

async function handleDoubleClick(e, boundContainer, doc = document) {
    const now = Date.now();

    if (extension_settings[extensionName].enable_plugin == "false" || extension_settings[extensionName].enable_plugin == false) {
        console.log('[Cache] Plugin is disabled.');
        return;
    }

    if (window.isOfflineRendering) {
        toastr.warning('正在进行离线渲染，请稍后...');
        return;
    }

    lastDoubleClickTime = now;

    // If audio is playing, stop it.
    let marker = window.marker;
    if (marker && (marker.isPlaying || isSfxWaitPlaying())) {
        if (typeof window.cancelImmersiveSoundSession === 'function') {
            window.cancelImmersiveSoundSession();
        } else {
            stopAllAudio(marker);
        }
        window.marker = null;
        toastr.info('声临其境：已停止播放！');
        return;
    }

    // --- Basic element and text validation ---
    const clickedElement = e.target;
    const excludedTags = new Set(['IMG', 'BUTTON', 'SELECT', 'INPUT', 'TEXTAREA', 'A', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG']);
    if (excludedTags.has(clickedElement.tagName?.toUpperCase())) {
        console.log(`[监控] 点击的是 ${clickedElement.tagName?.toUpperCase()} 元素，忽略`);
        return;
    }

    const container = findFirstDivContainer(clickedElement);
    if (!container) {
        console.log('[监控] 未找到父级 div');
        return;
    }

    // 优先尝试从 SillyTavern context.chat[mesId].mes 获取原始消息文本
    // （同层楼 iframe 内 / 非同层主文档 都走同一条路径）
    let preciseText;
    const rawInfo = getRawMessageTextFromEl(clickedElement);
    if (rawInfo) {
        preciseText = rawInfo.text;
        console.log(`[监控] 使用原始消息文本 (mesId=${rawInfo.mesId}, len=${preciseText.length})`);
    } else {
        // 回退：从 DOM 收集文本（mesId=0 / 未找到 mes_text / context 不可用 等场景）
        const tempMarker = new CharacterReadingMarker(container);
        preciseText = tempMarker.getCollectedText();
        tempMarker.destroy();
        console.log(`[监控] 使用 DOM 文本 (len=${preciseText.length})`);
    }

    if (preciseText.length < 100) { // Reduced length for easier testing
        console.log('[监控] 容器文本长度不足 100，忽略');
        // toastr.warning('文本太短，忽略处理。');
        return;
    }

    // --- Show Action Bubble ---
    const info = buildDoubleClickInfo(e, container, doc);
    showActionBubble(info, preciseText, e);
}

/**
 * 为元素绑定双击事件（桌面使用 dblclick，移动端使用 touchend）
 * @param {Element} el
 * @param {Document} doc
 */
function bindDoubleClick(el, doc = document) {
    if (boundElements.has(el)) {
        return;
    }
    
    boundElements.add(el);

    // 桌面端：使用原生 dblclick 事件
    el.addEventListener('dblclick', (e) => {
        console.log('[监控] 桌面原生双击成功!');
        handleDoubleClick(e, el, doc);
    });

    // 移动端：优化触摸双击检测
    let lastTapTime = 0;
    const doubleTapThreshold = 200; // 双击时间阈值

    el.addEventListener('touchend', (e) => {
        const currentTime = new Date().getTime();
        const timeSinceLastTap = currentTime - lastTapTime;

        if (timeSinceLastTap < doubleTapThreshold && timeSinceLastTap > 0) {
            // 判定为双击
            console.log('[监控] 移动端触摸双击成功!');
            
            // 执行核心逻辑
            handleDoubleClick(e, el, doc);
            
            // 重置时间戳，防止三次或更多次点击被误判
            lastTapTime = 0;
        } else {
            // 记录本次点击时间，用于下一次判断
            lastTapTime = currentTime;
        }
    });

    console.log('[监控] ✓ 已绑定 (新版):', el.className || el.tagName);
}

/**
 * 扫描 mes_text 元素
 */
function scanMesTextElements() {
    const elements = document.getElementsByClassName("mes_text");
    let count = 0;
    
    for (const element of elements) {
        if (!boundElements.has(element)) {
            bindDoubleClick(element, document);
            count++;
        }
    }
    
    return count;
}

/**
 * 扫描 iframe
 */
function scanIframes() {
    const iframes = document.querySelectorAll('iframe');
    let count = 0;
    
    iframes.forEach(iframe => {
        try {
            const iframeDoc = iframe.contentDocument;
            if (iframeDoc && iframeDoc.body) {
                if (!boundElements.has(iframeDoc.body)) {
                    bindDoubleClick(iframeDoc.body, iframeDoc);
                    count++;
                }
            }
        } catch (e) {
            // 跨域
        }
    });
    
    return count;
}

/**
 * 执行完整扫描
 */
function scanAll() {
    let total = 0;
    
    total += scanMesTextElements();
    total += scanIframes();
    
    if (total > 0) {
        console.log(`[监控] 本次扫描绑定了 ${total} 个元素`);
    }
}

/**
 * 初始化监控
 */
function initIframeDoubleClickMonitor() {
    console.log('[监控] ====== 初始化双击监控 ======');
    
    if (pollingTimer) {
        console.log('[监控] 已在运行');
        return;
    }
    
    scanAll();
    
    pollingTimer = setInterval(scanAll, 3000);
    
    console.log('[监控] ✓ 轮询已启动');
}

/**
 * 兼容原接口
 */
function setupIframeDoubleClick(iframe) {
    try {
        const iframeDoc = iframe.contentDocument;
        if (iframeDoc && iframeDoc.body && !boundElements.has(iframeDoc.body)) {
            bindDoubleClick(iframeDoc.body, iframeDoc);
        }
    } catch (e) {
        // 跨域
    }
}

/**
 * 启动
 */
function startMonitor() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initIframeDoubleClickMonitor);
    } else {
        initIframeDoubleClickMonitor();
    }
}

startMonitor();

export { initIframeDoubleClickMonitor, setupIframeDoubleClick };

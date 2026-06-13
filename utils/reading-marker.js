// @ts-nocheck
import { playList, stopAllAudio, playingList, isSfxWaitPlaying } from './playback.js';
import { masterGainNode } from './audio-context.js';

class CharacterReadingMarker {
  constructor(element, options = {}) {
    this.element = element;
    
    // *** IFRAME-AWARE CONTEXT ***
    // Get the correct document and window context, whether it's the main page or an iframe.
    this.doc = this.element.ownerDocument;
    this.win = this.doc.defaultView;

    this.options = {
      charactersPerMinute: options.cpm || 600,
      highlightColor: options.highlightColor || 'rgba(255, 255, 0, 0.5)',
      textColor: options.textColor || '#ff0000',
      skipSpaces: options.skipSpaces !== false,
      startNode: options.startNode || null,
      startOffset: options.startOffset || 0,
      startGlobalIndex: Number.isFinite(options.startGlobalIndex) ? options.startGlobalIndex : null,
      onComplete: options.onComplete || (() => {}),
      musicList: options.musicList || [],
      removedRanges: options.removedRanges || [], // Store the removed ranges
    };
    
    this.isSupported = this.win.CSS && this.win.CSS.highlights && typeof this.win.Highlight !== 'undefined';
    if (!this.isSupported) {
        console.warn("CSS Custom Highlight API not supported in this context. Reading marker will not function.");
    }

    this.delay = 60000 / this.options.charactersPerMinute;
    this.currentIndex = 0;
    this.startingIndex = 0;
    this.anchorIndex = 0;
    this.charPositions = [];
    this.isPlaying = false;
    this.animationFrameId = null;
    this.highlight = null;
    this.timePaused = 0;
    
    // Offline rendering support
    this.isOfflineMode = this.options.musicList.length === 1 && this.options.musicList[0].isOfflineRender;
    this.offlinePlayer = null;
    this.timingMap = this.isOfflineMode ? this.options.musicList[0].timingMap : null;
    this.charTimestamps = []; // Stores the exact timestamp for each character in offline mode

    this.init();
  }

  init() {
    this.addStyles();
    if (this.isSupported) {
        if (!this.win.CSS.highlights.has('reading-highlight')) {
            this.win.CSS.highlights.set('reading-highlight', new this.win.Highlight());
        }
        this.highlight = this.win.CSS.highlights.get('reading-highlight');
    }
  }


  collectCharacterPositions() {
    this.charPositions = [];
    this.startingIndex = 0;

    // 过滤掉 <details>（思维链/可展开块）、<style>、<script> 等容器内的文本节点。
    // 这些节点虽然渲染在 .mes_text 内，但并不属于原始 mes 文本，
    // 否则会导致 globalIndex 与正则/旁白坐标系错位（"从头开始"会从隐藏的思维链开始读）。
    const NodeFilter = this.win.NodeFilter;
    // 1) 文本节点直接位于以下容器内 → 跳过
    //    - details/summary：思维链/可展开块
    //    - style/script：样式与脚本节点
    //    - button：交互按钮（如 st-chatu8 的图片标签按钮、"点击展开图片"按钮）
    //    - .st-chatu8-image-span / .st-chatu8-image-button：插画扩展注入的占位元素
    const SKIP_SELECTOR = 'details, summary, style, script, button, .st-chatu8-image-span, .st-chatu8-image-button';
    // 2) 文本节点的"段落级祖先"如果里面存在 <img> 或 st-chatu8 占位元素，
    //    说明整段是"图片占位段落"（如 <p><img>【日向跨坐上机车】<button>…</button></p>），
    //    这种 <p> 内的纯文本（如 【...】 标签）也一并跳过。
    const IMAGE_PARAGRAPH_PROBE = 'img, .st-chatu8-image-span, .st-chatu8-image-button';
    const PARAGRAPH_TAGS = new Set(['P', 'DIV', 'LI']);
    const walker = this.doc.createTreeWalker(
      this.element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parentEl = node.parentElement;
          if (!parentEl || typeof parentEl.closest !== 'function') {
            return NodeFilter.FILTER_ACCEPT;
          }
          if (parentEl.closest(SKIP_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          // 向上找最近的段落级祖先（不跨出 this.element），
          // 若它内部出现了图片/占位元素，则视为图片占位段落，跳过文本。
          let p = parentEl;
          while (p && p !== this.element) {
            if (PARAGRAPH_TAGS.has(p.tagName)) {
              if (p.querySelector(IMAGE_PARAGRAPH_PROBE)) {
                return NodeFilter.FILTER_REJECT;
              }
              break;
            }
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
      false
    );

    let globalCharIndex = 0;
    const hasStartGlobalIndex = Number.isFinite(this.options.startGlobalIndex);
    let foundStart = !hasStartGlobalIndex && !this.options.startNode;
    let nodeIndex = 0;
    let node;

    while (node = walker.nextNode()) {
        const text = node.textContent;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (hasStartGlobalIndex && globalCharIndex === this.options.startGlobalIndex) {
                this.startingIndex = this.charPositions.length;
                foundStart = true;
            } else if (!foundStart && node === this.options.startNode && i === this.options.startOffset) {
                this.startingIndex = this.charPositions.length;
                foundStart = true;
            }

            this.charPositions.push({
                char: char,
                node: node,
                offset: i,
                globalIndex: globalCharIndex,
                nodeIndex: nodeIndex,
                parentTag: node.parentNode.tagName
            });
            globalCharIndex++;
        }
        nodeIndex++;
    }

    console.log(`收集完成: ${this.charPositions.length} 个字符（跳过空格: ${this.options.skipSpaces}）`);
  }

  getCollectedText() {
    this.collectCharacterPositions();
    return this.charPositions.map(p => p.char).join('');
  }

  getExpectedRealtimeIndex(timestamp) {
    return this.anchorIndex + Math.floor((timestamp - this.startTime) / this.delay);
  }

  reanchorRealtime(index, timestamp = this.win.performance.now()) {
    this.anchorIndex = Math.max(0, index);
    this.startTime = timestamp;
  }

  animationLoop(timestamp) {
    if (!this.isPlaying) return;

    let elapsedTime = timestamp - this.startTime;
    let expectedCharArrIndex;

    if (this.isOfflineMode) {
        // In offline mode, elapsedTime is the absolute time from the beginning of the track.
        if (this.charTimestamps.length > 0) {
            // Find the character index corresponding to the absolute time.
            let i = this.currentIndex;
            while (i < this.charTimestamps.length && this.charTimestamps[i] < elapsedTime) {
                i++;
            }
            expectedCharArrIndex = i;
        } else {
            // Fallback for offline mode without a timing map (constant speed).
            expectedCharArrIndex = Math.floor(elapsedTime / this.delay);
        }
    } else {
        // In real-time mode, elapsedTime is relative to the start of this reading session.
        expectedCharArrIndex = this.getExpectedRealtimeIndex(timestamp);
    }

    if (expectedCharArrIndex >= this.charPositions.length) {
        stopAllAudio(this);
        if (this.options.onComplete) {
            this.options.onComplete();
        }
        return;
    }

    // Check if the current index falls into a removed range
    if (this.options.removedRanges && this.options.removedRanges.length > 0) {
        const currentCharGlobalIndex = this.charPositions[expectedCharArrIndex]?.globalIndex;
        if (currentCharGlobalIndex !== undefined) {
            for (const range of this.options.removedRanges) {
                if (currentCharGlobalIndex >= range.start && currentCharGlobalIndex < range.end) {
                    // 🩺 诊断：进入跳过区
                    if (!this._loggedSkips) this._loggedSkips = new Set();
                    const skipKey = `${range.start}-${range.end}`;
                    if (!this._loggedSkips.has(skipKey)) {
                        this._loggedSkips.add(skipKey);
                        console.log(`[ST-IS Marker] ⏭ 触发跳过 [${range.start},${range.end}) @ globalIndex=${currentCharGlobalIndex}`);
                    }
                    // We are inside a removed range, so we need to jump.
                    const jumpToIndex = this.charPositions.findIndex(p => p.globalIndex >= range.end);

                    // 🩹 跳过区尾部超出了 charPositions（DOM 可见字符数不足 range.end）
                    // → 等价于"剩下文本全部跳过"
                    if (jumpToIndex === -1) {
                        // ⚠️ 关键：必须先用 finishIfDone 判断是否还有音频在播。
                        // 之前无条件 stopAllAudio 会在 VOICE 仍在播时强行打断
                        // （例：TTS 文本包含被正则移除的 HTML 代码块，
                        // VOICE.regex_end 等于跳过区起点 / 终点附近时极易复现）。
                        const lastVisibleIndex = this.charPositions.length - 1;
                        const lastVisibleGlobal = this.charPositions[lastVisibleIndex]?.globalIndex ?? currentCharGlobalIndex;

                        // 把光标推到最后一个可见字符，避免高亮残留
                        if (this.currentIndex < lastVisibleIndex) {
                            this.currentIndex = lastVisibleIndex;
                            if (this.isSupported) {
                                const last = this.charPositions[lastVisibleIndex];
                                if (last && last.node?.isConnected) {
                                    this.highlight.clear();
                                    const r = this.doc.createRange();
                                    r.setStart(last.node, last.offset);
                                    r.setEnd(last.node, last.offset + 1);
                                    this.highlight.add(r);
                                }
                            }
                        }

                        console.log(`[ST-IS Marker] 跳过区 [${range.start},${range.end}) 超出 charPositions(len=${this.charPositions.length})，直接收尾`);
                        stopAllAudio(this);
                        if (this.options.onComplete) {
                            this.options.onComplete();
                        }
                        return;
                    }

                    if (jumpToIndex !== -1) {
                        // Calculate the time duration of the skipped section
                        const charsToSkip = jumpToIndex - expectedCharArrIndex;
                        let timeToSkip;

                        if (this.isOfflineMode && this.charTimestamps && this.charTimestamps.length > jumpToIndex) {
                            // Accurate calculation for offline mode with timing map
                            const timeBeforeJump = this.charTimestamps[expectedCharArrIndex] || (expectedCharArrIndex * this.delay);
                            const timeAfterJump = this.charTimestamps[jumpToIndex];
                            timeToSkip = timeAfterJump - timeBeforeJump;
                        } else {
                            // Fallback for real-time mode or offline without timing map
                            timeToSkip = 0;
                        }

                        // Adjust startTime to "fast-forward" the clock. This is the core of the fix.
                        // By subtracting the skipped time, the next elapsedTime calculation will be larger,
                        // effectively jumping the reading progress forward.
                        if (this.isOfflineMode) {
                            this.startTime -= timeToSkip;
                        } else {
                            this.reanchorRealtime(jumpToIndex, timestamp);
                        }

                        // Re-calculate elapsedTime and the expected index *within the same frame*
                        // to ensure the highlight jumps immediately and synchronously.
                        elapsedTime = timestamp - this.startTime;
                        
                        // Re-calculate the expected index using the correct logic for the current mode
                        if (this.isOfflineMode) {
                            if (this.charTimestamps.length > 0) {
                                let i = this.currentIndex;
                                while (i < this.charTimestamps.length && this.charTimestamps[i] < elapsedTime) {
                                    i++;
                                }
                                expectedCharArrIndex = i;
                            } else {
                                expectedCharArrIndex = Math.floor(elapsedTime / this.delay);
                            }
                        } else {
                            expectedCharArrIndex = jumpToIndex;
                        }
                        
                        // Ensure we land at or after the jump target, preventing getting stuck.
                        if (expectedCharArrIndex < jumpToIndex) {
                            expectedCharArrIndex = jumpToIndex;
                        }

                        break; // Exit the loop after handling the first matching range
                    }
                }
            }
        }
    }


    if (expectedCharArrIndex > this.currentIndex) {
        this.currentIndex = expectedCharArrIndex;
        
        if (this.isSupported) {
            this.highlight.clear();
            let currentCharData = this.charPositions[this.currentIndex];

            if (currentCharData && !currentCharData.node.isConnected) {
                console.warn('Reading marker: Node is detached. Attempting to recover...');
                const lastGoodGlobalIndex = currentCharData.globalIndex;
                
                this.collectCharacterPositions();
                
                const newIndex = this.charPositions.findIndex(p => p.globalIndex === lastGoodGlobalIndex);

                if (newIndex !== -1) {
                    this.currentIndex = newIndex;
                    currentCharData = this.charPositions[this.currentIndex];
                    console.log('Reading marker: Recovery successful.');
                } else {
                    console.error('Reading marker: Failed to recover from detached node. Stopping playback.');
                    this.stop();
                    return;
                }
            }

            if (currentCharData) {
                const { node, offset } = currentCharData;
                const range = this.doc.createRange();
                range.setStart(node, offset);
                range.setEnd(node, offset + 1);
                this.highlight.add(range);
                
                // Only call playList in real-time mode
                if (!this.isOfflineMode) {
                    playList(currentCharData.globalIndex, this.options.musicList, this, this.options.playbackSessionId);
                }

                // Check if all audio has been played and finished (only in real-time mode)
                // 语义：playingList 已空 且 后续没有还未开始的音频（regex_start > globalIndex）→ 停止光标
                // 这里复用 finishIfDone()，它内部判断 playingList 空、SFX_WAIT 不在播、且 hasFutureAudioAfter 为 false
                // 跳过区清理（pauseWithFadeOutAndCleanup 路径）不会走 naturallyEndedHandler，所以必须在这里兜底
                if (!this.isOfflineMode && this.options.musicList && this.options.musicList.length > 0) {
                    if (this.finishIfDone(currentCharData.globalIndex)) {
                        console.log('[st-immersive-sound] All audio tracks have finished playing. Stopping reading marker.');
                        return; // Stop the animation loop
                    }
                }
            }
        }
    }

    this.animationFrameId = this.win.requestAnimationFrame(this.animationLoop.bind(this));
  }

  getCharacterPosition(index) {
    if (index < 0 || index >= this.charPositions.length) return null;
    
    const charData = this.charPositions[index];
    const { node, offset, char } = charData;

    if (!this.doc.body.contains(node) || node.textContent.length <= offset) {
        return null;
    }

    const range = this.doc.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    
    return {
      char: char, left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      bottom: rect.bottom, right: rect.right, visible: this.isCharacterVisible(rect)
    };
  }

  getCharDataByGlobalIndex(globalIndex) {
    if (!Number.isFinite(globalIndex) || !this.charPositions.length) return null;

    const arrIndex = this.charPositions.findIndex(p => p.globalIndex === globalIndex);
    if (arrIndex === -1) return null;

    const charData = this.charPositions[arrIndex];
    return {
      index: arrIndex,
      globalIndex: charData.globalIndex,
      char: charData.char,
      nodeIndex: charData.nodeIndex,
      parentTag: charData.parentTag,
    };
  }

  getTextSliceByGlobalRange(startGlobalIndex, endGlobalIndex) {
    if (!Number.isFinite(startGlobalIndex) || !Number.isFinite(endGlobalIndex) || !this.charPositions.length) {
      return null;
    }

    const start = Math.min(startGlobalIndex, endGlobalIndex);
    const end = Math.max(startGlobalIndex, endGlobalIndex);
    const slice = [];
    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < this.charPositions.length; i++) {
      const item = this.charPositions[i];
      if (item.globalIndex < start) continue;
      if (item.globalIndex > end) break;
      if (startIndex === -1) startIndex = i;
      endIndex = i;
      slice.push(item.char);
    }

    return {
      startIndex,
      endIndex,
      startGlobalIndex: start,
      endGlobalIndex: end,
      text: slice.join(''),
    };
  }

  getDebugCursorSnapshot(contextRadius = 8) {
    if (!this.charPositions.length || this.currentIndex < 0 || this.currentIndex >= this.charPositions.length) {
      return null;
    }

    const from = Math.max(0, this.currentIndex - contextRadius);
    const to = Math.min(this.charPositions.length, this.currentIndex + contextRadius + 1);
    const current = this.charPositions[this.currentIndex];

    return {
      index: this.currentIndex,
      globalIndex: current.globalIndex,
      char: current.char,
      context: this.charPositions.slice(from, to).map(p => p.char).join(''),
      contextStartIndex: from,
      contextEndIndex: to - 1,
      contextStartGlobalIndex: this.charPositions[from]?.globalIndex,
      contextEndGlobalIndex: this.charPositions[to - 1]?.globalIndex,
    };
  }

  isCharacterVisible(rect) {
    const buffer = 50;
    return rect.top >= -buffer && 
           rect.bottom <= this.win.innerHeight + buffer &&
           rect.left >= -buffer && 
           rect.right <= this.win.innerWidth + buffer &&
           rect.width > 0 && 
           rect.height > 0;
  }

  start() {
    if (!this.isSupported) return;
    if (this.isPlaying) this.stop();
    
    this.isPlaying = true;
    this.collectCharacterPositions();
    this.currentIndex = this.startingIndex || 0;
    this.anchorIndex = this.currentIndex;
    
    // --- Offline Mode Player Start & Timing Calculation ---
    if (this.isOfflineMode) {
        console.log('[Reading Marker] Offline mode detected.');
        const offlineTrack = this.options.musicList[0];
        let startTimeInSeconds = 0;

        // 1. Pre-calculate timestamps if a timing map is available.
        if (this.timingMap && this.timingMap.length > 0) {
            console.log('[Reading Marker] Timing map found. Pre-calculating character timestamps.');
            this.preCalculateTimestamps();
        } else {
            console.log('[Reading Marker] No timing map. Using constant speed for timing.');
        }

        // 2. Calculate the start time offset if not starting from the beginning.
        if (this.startingIndex > 0) {
            if (this.charTimestamps && this.charTimestamps.length > this.startingIndex) {
                startTimeInSeconds = this.charTimestamps[this.startingIndex] / 1000;
                console.log(`[Reading Marker] Starting from index ${this.startingIndex}. Calculated offset: ${startTimeInSeconds.toFixed(3)}s (from timestamp)`);
            } else {
                startTimeInSeconds = this.startingIndex * (this.delay / 1000);
                console.log(`[Reading Marker] Starting from index ${this.startingIndex}. Calculated offset: ${startTimeInSeconds.toFixed(3)}s (from CPM)`);
            }
        }

        // 3. Start the player with the calculated offset.
        if (offlineTrack && offlineTrack.buffer) {
            console.log(`[Reading Marker] Starting single rendered track with an offset of ${startTimeInSeconds.toFixed(3)}s.`);
            this.offlinePlayer = new Tone.Player(offlineTrack.buffer).connect(masterGainNode);

            this.offlinePlayer.onstop = () => {
                console.log('[Reading Marker] Offline track finished playing naturally.');
                if (this.isPlaying) {
                    this.stop();
                    if (this.options.onComplete) {
                        this.options.onComplete();
                    }
                }
            };

            this.offlinePlayer.start(undefined, startTimeInSeconds);
        } else {
            console.error('[Reading Marker] Offline mode error: Buffer not found.');
            this.isOfflineMode = false; // Fallback to real-time (silent)
        }
        
        // For offline mode, startTime is adjusted to represent the absolute time in the track.
        this.startTime = this.win.performance.now() - (startTimeInSeconds * 1000);
    } else {
        // For real-time mode, startTime is just the current time.
        this.reanchorRealtime(this.currentIndex, this.win.performance.now());
    }
    // --- End Offline Mode ---
    this.animationFrameId = this.win.requestAnimationFrame(this.animationLoop.bind(this));

    console.log(`开始逐字阅读，速度: ${this.options.charactersPerMinute} 字/分钟`);
  }

  addStyles() {
    let style = this.doc.getElementById('char-reading-styles');
    if (!style) {
        style = this.doc.createElement('style');
        style.id = 'char-reading-styles';
        this.doc.head.appendChild(style);
    }
    const styleSheet = style.sheet;

    while (styleSheet.cssRules.length > 0) {
        styleSheet.deleteRule(0);
    }

    const rule = `
      ::highlight(reading-highlight) {
        background-color: ${this.options.highlightColor} !important;
        color: ${this.options.textColor} !important;
      }
    `;
    styleSheet.insertRule(rule, 0);
  }

  pause() {
    if (this.animationFrameId) {
        this.win.cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = null;
    this.isPlaying = false;
    this.timePaused = this.win.performance.now();
  }

  resume() {
    if (!this.isSupported) return;
    if (!this.isPlaying && this.currentIndex < this.charPositions.length) {
        this.isPlaying = true;
        this.startTime += (this.win.performance.now() - this.timePaused);
        this.animationFrameId = this.win.requestAnimationFrame(this.animationLoop.bind(this));
    }
  }

  fastForward(charactersToSkip) {
    if (charactersToSkip <= 0) return;
    if (!this.charPositions.length) return;

    const newIndex = Math.min(this.charPositions.length - 1, this.currentIndex + charactersToSkip);
    const actualSkipped = newIndex - this.currentIndex;

    if (actualSkipped <= 0) return;

    this.currentIndex = newIndex;
    if (this.isOfflineMode) {
        const timeSkipped = actualSkipped * this.delay;
        this.startTime -= timeSkipped;
    } else {
        this.reanchorRealtime(this.currentIndex, this.win.performance.now());
    }

    if (this.isSupported) {
        this.highlight.clear();
        const currentCharData = this.charPositions[this.currentIndex];
        if (currentCharData) {
            const { node, offset } = currentCharData;
            const range = this.doc.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            this.highlight.add(range);
            playList(currentCharData.globalIndex, this.options.musicList, this, this.options.playbackSessionId);
        }
    }
  }

  syncToGlobalIndex(targetGlobalIndex) {
    if (!Number.isFinite(targetGlobalIndex)) return false;
    if (!this.charPositions.length) {
        this.collectCharacterPositions();
    }
    if (!this.charPositions.length) return false;

    let targetIndex = this.charPositions.findIndex(p => p.globalIndex >= targetGlobalIndex);
    if (targetIndex === -1) {
        targetIndex = this.charPositions.length - 1;
    }
    if (targetIndex <= this.currentIndex) return false;

    this.currentIndex = targetIndex;
    if (this.isPlaying && !this.isOfflineMode) {
        this.reanchorRealtime(this.currentIndex, this.win.performance.now());
    } else if (!this.isOfflineMode) {
        this.anchorIndex = this.currentIndex;
    }

    if (this.isSupported) {
        this.highlight.clear();
        const currentCharData = this.charPositions[this.currentIndex];
        if (currentCharData && currentCharData.node?.isConnected) {
            const { node, offset } = currentCharData;
            const range = this.doc.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            this.highlight.add(range);
        }
    }
    return true;
  }

  hasFutureAudioAfter(globalIndex) {
    const list = this.options.musicList || [];
    return list.some(music => {
        const start = music.regex_start ?? music.regex;
        return Number.isFinite(start) && start > globalIndex;
    });
  }

  finishIfDone(globalIndex, { debug = false } = {}) {
    if (!this.isPlaying || this.isOfflineMode) return false;
    const playingKeys = Object.keys(playingList);
    if (isSfxWaitPlaying()) {
        if (debug) {
            console.log('[ST-IS finishIfDone] ❌ 仍有音频在播', {
                globalIndex,
                playingList: playingKeys,
                sfxWait: isSfxWaitPlaying(),
            });
        }
        return false;
    }
    if (this.hasFutureAudioAfter(globalIndex)) {
        if (debug) {
            const futureItems = (this.options.musicList || [])
                .filter(m => {
                    const start = m.regex_start ?? m.regex;
                    return Number.isFinite(start) && start > globalIndex;
                })
                .map(m => ({
                    src: m.src,
                    type: m.type,
                    regex_start: m.regex_start,
                    regex_end: m.regex_end,
                    regex: m.regex,
                }));
            console.log('[ST-IS finishIfDone] ❌ 后续仍有未开始的音频', {
                globalIndex,
                futureItems,
            });
        }
        return false;
    }
    stopAllAudio(this);
    if (this.options.onComplete) {
        this.options.onComplete();
    }
    return true;
  }

  stop() {
    if (this.animationFrameId) {
        this.win.cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = null;
    this.isPlaying = false;

    if (this.isSupported && this.highlight) {
        this.highlight.clear();
    }

    // --- Offline Mode Player Stop ---
    if (this.isOfflineMode && this.offlinePlayer) {
        try {
            // 在手动停止之前，清除 onstop 回调，以防止重复调用 stop()
            this.offlinePlayer.onstop = () => {};
            this.offlinePlayer.stop();
            this.offlinePlayer.dispose();
        } catch (e) {
            console.warn('[Reading Marker] Error stopping offline player:', e);
        }
        this.offlinePlayer = null;
    }
    // --- End Offline Mode ---

    this.currentIndex = 0;
    this.anchorIndex = 0;
  }

  setSpeed(charactersPerMinute) {
    if (charactersPerMinute <= 0) return;
    const newDelay = 60000 / charactersPerMinute;
    if (this.isPlaying && this.isOfflineMode) {
        const charactersProcessed = this.currentIndex - this.startingIndex;
        this.startTime = this.win.performance.now() - charactersProcessed * newDelay;
    } else if (!this.isOfflineMode) {
        const anchorTime = this.isPlaying
            ? this.win.performance.now()
            : (this.timePaused || this.win.performance.now());
        this.reanchorRealtime(this.currentIndex, anchorTime);
    }
    this.options.charactersPerMinute = charactersPerMinute;
    this.delay = newDelay;
  }

  setSpeedByDuration(charLength, seconds) {
    if (charLength <= 0 || seconds <= 0) return;
    const charactersPerMinute = (charLength / seconds) * 60;
    this.setSpeed(charactersPerMinute);
  }

  preCalculateTimestamps() {
    this.charTimestamps = [];
    if (this.charPositions.length === 0) return;

    const fullTextLength = this.charPositions.length;
    const defaultSecondsPerChar = this.delay / 1000;

    // 1. Create a per-character duration map, initialized with default speed.
    const charDurations = new Array(fullTextLength).fill(defaultSecondsPerChar);

    // 2. Apply `removedRanges` by setting character durations to 0.
    if (this.options.removedRanges && this.options.removedRanges.length > 0) {
        for (const range of this.options.removedRanges) {
            for (let i = range.start; i < range.end; i++) {
                if (i < charDurations.length) {
                    charDurations[i] = 0;
                }
            }
        }
        console.log('[Reading Marker] Applied removedRanges to timestamp calculation.');
    }

    // 3. Apply variable speed from voice segments (`timingMap`).
    if (this.timingMap && this.timingMap.length > 0) {
        for (const segment of this.timingMap) {
            const voiceCharCount = segment.end - segment.start;
            if (voiceCharCount > 0 && segment.duration > 0) {
                const secondsPerVoiceChar = segment.duration / voiceCharCount;
                for (let i = segment.start; i < segment.end; i++) {
                    // Only apply if the character hasn't been "removed".
                    if (i < charDurations.length && charDurations[i] !== 0) {
                        charDurations[i] = secondsPerVoiceChar;
                    }
                }
            }
        }
        console.log('[Reading Marker] Applied voice segment speeds to timestamp calculation.');
    }

    // 4. Calculate the final cumulative timestamps.
    let currentTime = 0;
    // We push a timestamp for each character, representing the time *at the end* of that character.
    for (let i = 0; i < fullTextLength; i++) {
        currentTime += charDurations[i];
        this.charTimestamps.push(currentTime * 1000); // Convert to milliseconds
    }

    console.log('[Reading Marker] Pre-calculation complete. Total timestamps:', this.charTimestamps.length);
  }

  destroy() {
    this.stop();
    if (this.isSupported) {
        // Use a try-catch as the highlight might not exist if it was never started
        try {
            this.win.CSS.highlights.delete('reading-highlight');
        } catch (e) {
            console.warn("Could not delete highlight on destroy:", e);
        }
    }
    const style = this.doc.getElementById('char-reading-styles');
    if (style) style.remove();
  }
}

export { CharacterReadingMarker };

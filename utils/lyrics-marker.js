// @ts-nocheck
/**
 * 歌词播放器虚拟 Marker - st-immersive-sound
 * 与 CharacterReadingMarker 接口兼容，但不操作页面 DOM，
 * 而是基于原始文本字符串驱动歌词播放器 UI。
 */
import { playList, stopAllAudio, playingList, isSfxWaitPlaying } from './playback.js';

class LyricsReadingMarker {
    /**
     * @param {string} sourceText - 原始文本
     * @param {Object} options
     * @param {number} options.cpm - 每分钟字符数
     * @param {Array}  options.musicList - 音频列表
     * @param {Array}  options.removedRanges - 跳过区间
     * @param {string} options.playbackSessionId - 播放会话 ID
     * @param {import('./lyrics-player.js').LyricsPlayer} options.lyricsPlayer - 歌词播放器实例
     * @param {Function} options.onComplete - 播放完成回调
     */
    constructor(sourceText, options = {}) {
        this.sourceText = sourceText || '';
        this.element = null; // 无 DOM 依赖

        this.options = {
            charactersPerMinute: options.cpm || 600,
            onComplete: options.onComplete || (() => {}),
            musicList: options.musicList || [],
            removedRanges: options.removedRanges || [],
            playbackSessionId: options.playbackSessionId || '',
        };

        /** @type {import('./lyrics-player.js').LyricsPlayer} */
        this.lyricsPlayer = options.lyricsPlayer || null;

        this.delay = 60000 / this.options.charactersPerMinute;
        this.currentIndex = 0;
        this.startingIndex = 0;
        this.anchorIndex = 0;
        this.charPositions = [];
        this.isPlaying = false;
        this.animationFrameId = null;
        this.timePaused = 0;
        this.startTime = 0;

        // 跳过区日志去重
        this._loggedSkips = new Set();

        this._collectCharacterPositions();
    }

    // ========== 字符位置收集 ==========

    _collectCharacterPositions() {
        this.charPositions = [];
        const text = this.sourceText;

        for (let i = 0; i < text.length; i++) {
            this.charPositions.push({
                char: text[i],
                globalIndex: i,
                node: null,
                offset: i,
                nodeIndex: 0,
                parentTag: 'VIRTUAL',
            });
        }

        console.log(`[LyricsMarker] 收集完成: ${this.charPositions.length} 个字符`);
    }

    // ========== 公共 API（与 CharacterReadingMarker 兼容） ==========

    getCollectedText() {
        return this.sourceText;
    }

    getExpectedRealtimeIndex(timestamp) {
        return this.anchorIndex + Math.floor((timestamp - this.startTime) / this.delay);
    }

    reanchorRealtime(index, timestamp = performance.now()) {
        this.anchorIndex = Math.max(0, index);
        this.startTime = timestamp;
    }

    getCharDataByGlobalIndex(globalIndex) {
        if (!Number.isFinite(globalIndex) || !this.charPositions.length) return null;
        if (globalIndex < 0 || globalIndex >= this.charPositions.length) return null;

        const charData = this.charPositions[globalIndex];
        return {
            index: globalIndex,
            globalIndex: charData.globalIndex,
            char: charData.char,
            nodeIndex: charData.nodeIndex,
            parentTag: charData.parentTag,
        };
    }

    getTextSliceByGlobalRange(startGlobalIndex, endGlobalIndex) {
        if (!Number.isFinite(startGlobalIndex) || !Number.isFinite(endGlobalIndex)) return null;

        const start = Math.max(0, Math.min(startGlobalIndex, endGlobalIndex));
        const end = Math.min(this.charPositions.length, Math.max(startGlobalIndex, endGlobalIndex));

        return {
            startIndex: start,
            endIndex: end - 1,
            startGlobalIndex: start,
            endGlobalIndex: end,
            text: this.sourceText.slice(start, end),
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
            context: this.sourceText.slice(from, to),
            contextStartIndex: from,
            contextEndIndex: to - 1,
            contextStartGlobalIndex: from,
            contextEndGlobalIndex: to - 1,
        };
    }

    hasFutureAudioAfter(globalIndex) {
        const list = this.options.musicList || [];
        return list.some(music => {
            const start = music.regex_start ?? music.regex;
            return Number.isFinite(start) && start > globalIndex;
        });
    }

    finishIfDone(globalIndex, { debug = false } = {}) {
        if (!this.isPlaying) return false;

        const playingKeys = Object.keys(playingList);
        if (playingKeys.length > 0 || isSfxWaitPlaying()) {
            return false;
        }
        if (this.hasFutureAudioAfter(globalIndex)) {
            return false;
        }

        stopAllAudio(this);
        if (this.options.onComplete) {
            this.options.onComplete();
        }
        return true;
    }

    // ========== 动画循环 ==========

    animationLoop(timestamp) {
        if (!this.isPlaying) return;

        let expectedCharArrIndex = this.getExpectedRealtimeIndex(timestamp);

        // ==== 真·音频强驱动同步模式 ====
        const voiceKeys = Object.keys(playingList).filter(k => 
            playingList[k].type === 'VOICE' || playingList[k].type === 'SFX_WAIT'
        );

        if (voiceKeys.length > 0) {
            const activeAudio = playingList[voiceKeys[0]];
            const startIdx = activeAudio.regex;
            const endIdx = activeAudio.regex_end;
            
            if (startIdx !== undefined && endIdx !== undefined && endIdx > startIdx) {
                if (activeAudio.startedAtMs && activeAudio.durationMs > 0) {
                    // 按照真实音频播放时长计算百分比
                    const elapsed = Math.max(0, timestamp - activeAudio.startedAtMs);
                    let ratio = elapsed / activeAudio.durationMs;
                    ratio = Math.min(1, Math.max(0, ratio)); // 限制在 0~1 之间
                    
                    expectedCharArrIndex = startIdx + Math.floor(ratio * (endIdx - startIdx));
                    // 强制：只要当前这句音频还在 playingList 中（没收到 onended 信号），
                    // 光标最多只能走到这句话的最后一个字（endIdx - 1），绝不允许到达 endIdx 触发下一句！
                    expectedCharArrIndex = Math.min(expectedCharArrIndex, endIdx - 1);
                } else {
                    // 没有持续时间（退化逻辑）：死死卡在这句话的末尾，不许跨越到下一句
                    expectedCharArrIndex = Math.min(expectedCharArrIndex, endIdx - 1);
                }
                
                // 将这个通过真实音频算出来的精确进度，不断重新锚定给虚拟时钟。
                this.reanchorRealtime(expectedCharArrIndex, timestamp);
            }
        }

        // 检查是否播放完成
        if (expectedCharArrIndex >= this.charPositions.length) {
            stopAllAudio(this);
            if (this.options.onComplete) {
                this.options.onComplete();
            }
            return;
        }

        // 处理 removedRanges 跳过逻辑
        if (this.options.removedRanges && this.options.removedRanges.length > 0) {
            const currentCharGlobalIndex = this.charPositions[expectedCharArrIndex]?.globalIndex;
            if (currentCharGlobalIndex !== undefined) {
                for (const range of this.options.removedRanges) {
                    if (currentCharGlobalIndex >= range.start && currentCharGlobalIndex < range.end) {
                        // 跳过日志
                        const skipKey = `${range.start}-${range.end}`;
                        if (!this._loggedSkips.has(skipKey)) {
                            this._loggedSkips.add(skipKey);
                            console.log(`[LyricsMarker] ⏭ 触发跳过 [${range.start},${range.end}) @ globalIndex=${currentCharGlobalIndex}`);
                        }

                        const jumpToIndex = this.charPositions.findIndex(p => p.globalIndex >= range.end);

                        // 跳过区超出全部文本
                        if (jumpToIndex === -1) {
                            console.log(`[LyricsMarker] 跳过区超出文本，直接收尾`);
                            stopAllAudio(this);
                            if (this.options.onComplete) {
                                this.options.onComplete();
                            }
                            return;
                        }

                        // 重新锚定时间
                        this.reanchorRealtime(jumpToIndex, timestamp);
                        expectedCharArrIndex = jumpToIndex;
                        break;
                    }
                }
            }
        }

        // 推进字符
        if (expectedCharArrIndex > this.currentIndex) {
            this.currentIndex = expectedCharArrIndex;

            const currentCharData = this.charPositions[this.currentIndex];
            if (currentCharData) {
                // 触发音频播放
                playList(currentCharData.globalIndex, this.options.musicList, this, this.options.playbackSessionId);

                // 更新歌词播放器 UI
                if (this.lyricsPlayer) {
                    this.lyricsPlayer.updateProgress(currentCharData.globalIndex, this.charPositions.length);
                }

                // 检查是否所有音频已结束
                if (this.options.musicList && this.options.musicList.length > 0) {
                    if (this.finishIfDone(currentCharData.globalIndex)) {
                        console.log('[LyricsMarker] 所有音频播放完成，停止');
                        return;
                    }
                }
            }
        }

        this.animationFrameId = requestAnimationFrame(this.animationLoop.bind(this));
    }

    // ========== 生命周期 ==========

    start() {
        if (this.isPlaying) this.stop();

        this.isPlaying = true;
        this._collectCharacterPositions();
        this.currentIndex = this.startingIndex || 0;
        this.anchorIndex = this.currentIndex;
        this.reanchorRealtime(this.currentIndex, performance.now());

        // 显示歌词播放器
        if (this.lyricsPlayer) {
            this.lyricsPlayer.show();
            // 计算预估总时长
            const estimatedDuration = (this.charPositions.length * this.delay) / 1000;
            this.lyricsPlayer.setDuration(estimatedDuration);
        }

        this.animationFrameId = requestAnimationFrame(this.animationLoop.bind(this));
        console.log(`[LyricsMarker] 开始播放，速度: ${this.options.charactersPerMinute} 字/分钟，共 ${this.charPositions.length} 字符`);
    }

    stop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = null;
        this.isPlaying = false;
        this.currentIndex = 0;
        this.anchorIndex = 0;
    }

    pause() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = null;
        this.isPlaying = false;
        this.timePaused = performance.now();
    }

    resume() {
        if (!this.isPlaying && this.currentIndex < this.charPositions.length) {
            this.isPlaying = true;
            this.startTime += (performance.now() - this.timePaused);
            this.animationFrameId = requestAnimationFrame(this.animationLoop.bind(this));
        }
    }

    destroy() {
        this.stop();
        if (this.lyricsPlayer) {
            this.lyricsPlayer.destroy();
            this.lyricsPlayer = null;
        }
    }

    setSpeed(charactersPerMinute) {
        if (charactersPerMinute <= 0) return;
        const newDelay = 60000 / charactersPerMinute;

        const anchorTime = this.isPlaying
            ? performance.now()
            : (this.timePaused || performance.now());
        this.reanchorRealtime(this.currentIndex, anchorTime);

        this.options.charactersPerMinute = charactersPerMinute;
        this.delay = newDelay;

        // 更新预估总时长
        if (this.lyricsPlayer && this.charPositions.length > 0) {
            const estimatedDuration = (this.charPositions.length * newDelay) / 1000;
            this.lyricsPlayer.setDuration(estimatedDuration);
        }
    }

    setSpeedByDuration(charLength, seconds) {
        if (charLength <= 0 || seconds <= 0) return;
        const charactersPerMinute = (charLength / seconds) * 60;
        this.setSpeed(charactersPerMinute);
    }

    syncToGlobalIndex(targetGlobalIndex) {
        if (!Number.isFinite(targetGlobalIndex)) return false;
        if (!this.charPositions.length) return false;

        let targetIndex = this.charPositions.findIndex(p => p.globalIndex >= targetGlobalIndex);
        if (targetIndex === -1) {
            targetIndex = this.charPositions.length - 1;
        }

        // 在切换前先停止所有正在播放的音频（传入null，避免彻底关停marker引擎）
        stopAllAudio(null);

        this.currentIndex = targetIndex;
        if (this.isPlaying) {
            this.reanchorRealtime(this.currentIndex, performance.now());
        } else {
            this.anchorIndex = this.currentIndex;
        }

        // 更新歌词播放器
        if (this.lyricsPlayer) {
            const charData = this.charPositions[this.currentIndex];
            if (charData) {
                this.lyricsPlayer.updateProgress(charData.globalIndex, this.charPositions.length);
                // 如果当前处于播放状态，立即触发该位置可能存在的音频
                if (this.isPlaying) {
                    playList(charData.globalIndex, this.options.musicList, this, this.options.playbackSessionId);
                }
            }
        }

        return true;
    }

    // ========== 与原 Marker 兼容但无效的方法 ==========

    collectCharacterPositions() {
        // 公共调用兼容（部分外部代码可能直接调用）
        this._collectCharacterPositions();
    }

    fastForward(charactersToSkip) {
        if (charactersToSkip <= 0 || !this.charPositions.length) return;

        const newIndex = Math.min(this.charPositions.length - 1, this.currentIndex + charactersToSkip);
        const actualSkipped = newIndex - this.currentIndex;
        if (actualSkipped <= 0) return;

        this.currentIndex = newIndex;
        this.reanchorRealtime(this.currentIndex, performance.now());

        const currentCharData = this.charPositions[this.currentIndex];
        if (currentCharData) {
            playList(currentCharData.globalIndex, this.options.musicList, this, this.options.playbackSessionId);
            if (this.lyricsPlayer) {
                this.lyricsPlayer.updateProgress(currentCharData.globalIndex, this.charPositions.length);
            }
        }
    }
}

export { LyricsReadingMarker };

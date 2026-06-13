import { playList, stopAllAudio, playingList, isSfxWaitPlaying } from './playback.js';

/**
 * 歌词顺序播放引擎 - st-immersive-sound
 * 依靠音频片段（VOICE/SFX_WAIT）顺序播放，当上一段音频结束时，自动触发下一段。
 * 
 * 核心原则：
 *   - _animationLoop 是唯一的"自然推进"机制（轮询 playingList）
 *   - playback.js onstop 会回调 syncToGlobalIndex，但对于自然结束的情况必须忽略
 *   - 用户手动 seek（点击歌词行）也通过 syncToGlobalIndex，需要正确处理
 */
export class SequentialAudioEngine {
    constructor(sourceText, options = {}) {
        this.sourceText = sourceText || '';
        this.options = {
            musicList: options.musicList || [],
            playbackSessionId: options.playbackSessionId || '',
            onComplete: options.onComplete || (() => {})
        };
        this.lyricsPlayer = options.lyricsPlayer || null;
        this.isPlaying = false;
        
        // 只保留 VOICE 和 SFX_WAIT 作为"主时间线"段落
        // SFX、BGM/Ambiance 不占时间线位置，由游标触发
        this.segments = this.options.musicList
            .filter(m => m.type === 'VOICE' || m.type === 'SFX_WAIT')
            .sort((a, b) => (a.regex_start ?? a.regex) - (b.regex_start ?? b.regex));
            
        this.currentSegmentIndex = 0;
        this._audioDuration = 0;
        this._startTime = 0;
        this._animationFrameId = null;
        
        this._currentSrc = null;
        this._audioStarted = false;
        
        // 记录最近自然结束的 globalIndex，用于过滤 onstop 的重复回调
        this._lastNaturalEndIndex = -1;
        this.currentGlobalCharIndex = -1;
        this._initialStartGlobalIndex = options.startGlobalIndex;
    }

    start() {
        if (this.isPlaying) this.stop();
        this.isPlaying = true;
        this.currentSegmentIndex = 0;
        this._lastNaturalEndIndex = -1;
        this.currentGlobalCharIndex = -1;
        
        if (Number.isFinite(this._initialStartGlobalIndex)) {
            let targetIdx = this.segments.findIndex(s => {
                const sStart = s.regex_start ?? s.regex;
                const sEnd = s.regex_end ?? sStart;
                return sStart >= this._initialStartGlobalIndex || sEnd >= this._initialStartGlobalIndex;
            });
            if (targetIdx !== -1) {
                this.currentSegmentIndex = targetIdx;
                this.currentGlobalCharIndex = this._initialStartGlobalIndex;
            }
            this._initialStartGlobalIndex = null;
        }

        if (this.lyricsPlayer) {
            this.lyricsPlayer.show();
            this.lyricsPlayer.setDuration(0); 
            this.lyricsPlayer.setPlayingState(true);
        }
        
        this._playCurrentSegment();
        this._animationLoop();
    }
    
    _playCurrentSegment() {
        if (!this.isPlaying) return;
        
        if (this.currentSegmentIndex >= this.segments.length) {
            this.finishIfDone(Number.MAX_SAFE_INTEGER);
            return;
        }
        
        const seg = this.segments[this.currentSegmentIndex];
        const globalIndex = seg.regex_start ?? seg.regex;
        
        // Fast-forward cursor to trigger gap audio
        if (this.currentGlobalCharIndex !== undefined && this.currentGlobalCharIndex !== -1 && this.currentGlobalCharIndex < globalIndex) {
            for (let i = this.currentGlobalCharIndex + 1; i < globalIndex; i++) {
                playList(i, this.options.musicList, this, this.options.playbackSessionId);
            }
        }
        
        this.currentGlobalCharIndex = globalIndex;
        this._segmentStartGlobalIndex = globalIndex;
        this._segmentEndGlobalIndex = seg.regex_end ?? globalIndex;
        this._segmentCharLength = Math.max(0, this._segmentEndGlobalIndex - this._segmentStartGlobalIndex);
        
        this._currentSrc = seg.src;
        this._audioStarted = false;
        
        // playList 内部会遍历整个 musicList:
        //   - 对 VOICE/SFX_WAIT: 匹配 regex == currentGlobalCharIndex
        //   - 对 Music/Ambiance: 匹配 regex_start <= currentGlobalCharIndex && regex_end > currentGlobalCharIndex
        //   - 对 SFX: 匹配 regex == currentGlobalCharIndex
        // 所以只需传入当前 VOICE 的 globalIndex，playList 会自动触发
        // 覆盖该位置的所有 BGM/Ambiance，也会自动清理已过期的音频。
        playList(globalIndex, this.options.musicList, this, this.options.playbackSessionId);
        
        if (this.lyricsPlayer) {
            this.lyricsPlayer.updateActiveSegment(this.currentSegmentIndex);
        }
    }
    
    _animationLoop() {
        if (!this.isPlaying) return;
        
        if (this._audioDuration > 0) {
            const elapsed = (performance.now() - this._startTime) / 1000;
            const ratio = Math.min(1, Math.max(0, elapsed / this._audioDuration));
            
            if (this.lyricsPlayer) {
                this.lyricsPlayer.animateSegmentProgress(ratio);
            }
            
            // Cursor interpolation
            if (this.currentGlobalCharIndex !== undefined && this._segmentStartGlobalIndex !== undefined) {
                 const expectedIndex = Math.min(
                     this._segmentEndGlobalIndex, 
                     Math.floor(this._segmentStartGlobalIndex + this._segmentCharLength * ratio)
                 );
                 if (expectedIndex > this.currentGlobalCharIndex) {
                     for (let i = this.currentGlobalCharIndex + 1; i <= expectedIndex; i++) {
                         playList(i, this.options.musicList, this, this.options.playbackSessionId);
                     }
                     this.currentGlobalCharIndex = expectedIndex;
                 }
            }
        }
        
        // Check if current segment audio has finished playing
        if (this._currentSrc) {
            if (!this._audioStarted && playingList.hasOwnProperty(this._currentSrc)) {
                this._audioStarted = true;
            } else if (this._audioStarted && !playingList.hasOwnProperty(this._currentSrc)) {
                // Audio has finished or failed, advance to next segment!
                const finishedSeg = this.segments[this.currentSegmentIndex];
                if (finishedSeg) {
                    this._lastNaturalEndIndex = finishedSeg.regex_end ?? finishedSeg.regex;
                }
                
                this._currentSrc = null;
                this._audioStarted = false;
                this._audioDuration = 0;
                
                this.currentSegmentIndex++;
                this._playCurrentSegment();
            }
        }
        
        this._animationFrameId = requestAnimationFrame(() => this._animationLoop());
    }

    stop() {
        this.isPlaying = false;
        if (this._animationFrameId) cancelAnimationFrame(this._animationFrameId);
        if (this.lyricsPlayer) this.lyricsPlayer.setPlayingState(false);
    }
    
    pause() {
        this.isPlaying = false;
        if (this._animationFrameId) cancelAnimationFrame(this._animationFrameId);
        if (this.lyricsPlayer) this.lyricsPlayer.setPlayingState(false);
    }
    
    resume() {
        if (!this.isPlaying) {
            this.isPlaying = true;
            this._startTime = performance.now();
            if (this.lyricsPlayer) this.lyricsPlayer.setPlayingState(true);
            
            // Re-trigger the current audio if it was stopped completely
            if (this._currentSrc && !playingList.hasOwnProperty(this._currentSrc)) {
                 this._audioStarted = false;
                 const seg = this.segments[this.currentSegmentIndex];
                 if (seg) {
                     const globalIndex = seg.regex_start ?? seg.regex;
                     playList(globalIndex, this.options.musicList, this, this.options.playbackSessionId);
                 }
            } else if (!this._currentSrc && this.currentSegmentIndex >= 0 && this.currentSegmentIndex < this.segments.length) {
                 this._playCurrentSegment();
            }
            
            this._animationLoop();
        }
    }

    destroy() {
        this.stop();
        if (this.lyricsPlayer) {
            this.lyricsPlayer.destroy();
            this.lyricsPlayer = null;
        }
    }

    setSpeedByDuration(len, dur) {
        this._audioDuration = dur;
        this._startTime = performance.now();
    }
    
    setSpeed(cpm) { }
    
    hasFutureAudioAfter(index) {
        return this.currentSegmentIndex < this.segments.length - 1;
    }
    
    finishIfDone(globalIndex) {
        if (!this.isPlaying) return false;
        
        if (isSfxWaitPlaying()) {
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
    
    /**
     * 由 playback.js onstop 回调触发，也由用户手动 seek 触发。
     * 
     * 关键：_animationLoop 已经是唯一的自然推进机制。
     * playback.js onstop 回来的 globalIndex 如果等于当前段/上一段的结束位置，
     * 说明是自然结束的回调，必须忽略，否则会导致重复播放。
     */
    syncToGlobalIndex(globalIndex) {
        // 允许在暂停时更新进度
        // if (!this.isPlaying) return false;
        
        // 检查是否是 _animationLoop 已经处理过的自然结束回调
        if (globalIndex === this._lastNaturalEndIndex) {
            return true;
        }
        
        const currentSeg = this.segments[this.currentSegmentIndex];
        const currentEnd = currentSeg ? (currentSeg.regex_end ?? currentSeg.regex) : 0;
        
        // 当前段的结束点 —— 也是自然结束
        if (globalIndex === currentEnd) {
            return true;
        }
        
        // 上一段的结束点 —— _animationLoop 可能已推进，onstop 迟到
        if (this.currentSegmentIndex > 0) {
            const prevSeg = this.segments[this.currentSegmentIndex - 1];
            const prevEnd = prevSeg ? (prevSeg.regex_end ?? prevSeg.regex) : -1;
            if (globalIndex === prevEnd) {
                return true;
            }
        }
        
        // 如果 globalIndex 落在当前段的起止范围内，也忽略（不是 seek）
        if (currentSeg) {
            const currentStart = currentSeg.regex_start ?? currentSeg.regex;
            if (globalIndex >= currentStart && globalIndex <= currentEnd) {
                return true;
            }
        }
        
        // ---- 到这里说明是真正的用户 seek ----
        stopAllAudio(null);
        
        let targetIdx = this.segments.findIndex(s => {
            const sStart = s.regex_start ?? s.regex;
            const sEnd = s.regex_end ?? sStart;
            return sStart >= globalIndex || sEnd >= globalIndex;
        });
        if (targetIdx !== -1) {
            this.currentSegmentIndex = targetIdx;
        } else {
            this.currentSegmentIndex = this.segments.length - 1;
        }
        
        // 不需要单独恢复 BGM/Ambiance —— _playCurrentSegment 调用的
        // playList(globalIndex, musicList) 会自动匹配区间内的 Music/Ambiance 并启动。
        
        this._currentSrc = null;
        this._audioStarted = false;
        this._audioDuration = 0;
        this.currentGlobalCharIndex = globalIndex; // Prevent gap-triggering on manual seek
        
        if (this.isPlaying) {
            this._playCurrentSegment();
        } else {
            // 如果是在暂停状态下跳转，只更新高亮UI，不播放音频
            if (this.lyricsPlayer) {
                this.lyricsPlayer.updateActiveSegment(this.currentSegmentIndex);
            }
        }
        return true;
    }
    
    getDebugCursorSnapshot() { return null; }
    getCharDataByGlobalIndex(idx) { return null; }
    getTextSliceByGlobalRange(start, end) { return null; }
}

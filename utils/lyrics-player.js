// @ts-nocheck
/**
 * 歌词播放器 UI 模块 - st-immersive-sound
 * 负责歌词播放器窗口的创建、展示、歌词滚动、进度条交互等。
 */
import { extension_settings } from "../../../../extensions.js";
import { extensionName, extensionFolderPath, defaultLyricsPlayerThemes } from "./config.js";
import { regenerateTtsAudioByCacheKey } from "./ui-tts-preview.js";
import { getTtsItem } from "./tts-cache.js";

/** CSS 是否已注入 */
let cssInjected = false;

/** 注入歌词播放器 CSS（仅一次） */
function ensureCSS() {
    if (cssInjected) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${extensionFolderPath}/css/lyrics-player.css`;
    document.head.appendChild(link);
    cssInjected = true;
}

/**
 * 将秒数格式化为 mm:ss
 */
function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 将主题 CSS 变量应用到播放器容器
 */
function applyThemeToContainer(container, themeId) {
    const settings = extension_settings[extensionName];
    const allThemes = { ...defaultLyricsPlayerThemes, ...(settings.lyrics_player_themes || {}) };
    const theme = allThemes[themeId] || allThemes['深邃夜空'] || Object.values(allThemes)[0];
    if (!theme || !container) return;
    for (const [key, value] of Object.entries(theme)) {
        container.style.setProperty(key, value);
    }
}

/**
 * 歌词播放器类
 */
export class LyricsPlayer {
    /**
     * @param {Object} options
     * @param {string} options.sourceText - 原始文本
     * @param {Array}  options.musicList - 音频列表
     * @param {Array}  options.removedRanges - 跳过区间
     * @param {Function} options.onSeek - 进度跳转回调 (globalCharIndex) => void
     * @param {Function} options.onClose - 关闭回调
     */
    constructor(options = {}) {
        this.sourceText = options.sourceText || '';
        this.musicList = options.musicList || [];
        this.removedRanges = options.removedRanges || [];
        this.onSeek = options.onSeek || (() => {});
        this.onClose = options.onClose || (() => {});
        this.onPrev = options.onPrev || (() => {});
        this.onNext = options.onNext || (() => {});
        this.onTogglePlay = options.onTogglePlay || (() => {});
        this.initialVolumes = options.initialVolumes || { master: 1, music: 1, ambiance: 1, sfx: 1, sfx_wait: 1, voice: 1 };
        this.onVolumeChange = options.onVolumeChange || (() => {});

        this.segments = [];
        if (this.musicList && this.musicList.length > 0) {
            this.segments = this.musicList
                .filter(m => m.type === 'VOICE' || m.type === 'SFX_WAIT')
                .sort((a, b) => (a.regex_start ?? a.regex) - (b.regex_start ?? b.regex));
        }
        this.audioSegments = [];
        this.totalAudioLength = 0;
        
        if (this.musicList && this.musicList.length > 0) {
            const tempSegs = [];
            for (const music of this.musicList) {
                if (music.type === 'VOICE' || music.type === 'SFX_WAIT') {
                    const start = music.regex_start !== undefined ? music.regex_start : music.regex;
                    let end = music.regex_end;
                    if (end === undefined) {
                        end = start + (music.text ? music.text.length : 1);
                    }
                    if (start !== undefined && end > start) {
                        tempSegs.push({ start, end, length: end - start });
                    }
                }
            }
            // 排序并处理重叠
            tempSegs.sort((a, b) => a.start - b.start);
            for (const seg of tempSegs) {
                if (this.audioSegments.length === 0) {
                    this.audioSegments.push(seg);
                } else {
                    const last = this.audioSegments[this.audioSegments.length - 1];
                    if (seg.start <= last.end) {
                        last.end = Math.max(last.end, seg.end);
                        last.length = last.end - last.start;
                    } else {
                        this.audioSegments.push(seg);
                    }
                }
            }
            for (const seg of this.audioSegments) {
                this.totalAudioLength += seg.length;
            }
        }

        /** 解析后的歌词行数组 */
        this.lines = [];
        /** 当前高亮行索引 */
        this.activeLineIndex = -1;
        /** 当前高亮音频片段索引 */
        this.activeSegmentIndex = -1;
        /** 是否全屏 */
        this.isFullscreen = false;
        /** 是否可见 */
        this.isVisible = false;
        /** 进度条拖拽状态 */
        this._isDraggingProgress = false;

        /** DOM 引用 */
        this._backdrop = null;
        this._container = null;
        this._lyricsContent = null;
        this._progressFill = null;
        this._progressThumb = null;
        this._timeCurrentEl = null;
        this._timeTotalEl = null;

        /** 时间信息 */
        this._duration = 0;
        this._currentTime = 0;

        ensureCSS();
        this._parseTextToLines();
    }

    // ========== 文本解析 ==========

    _parseTextToLines() {
        this.lines = [];
        const text = this.sourceText;
        if (!text || !this.segments || this.segments.length === 0) {
            this.totalChars = 0;
            return;
        }

        // 1. 构建所有显示节点（包含 VOICE/SFX_WAIT 台词 + BGM/Ambiance/SFX 标记）
        const displayNodes = [];

        // 1a. 添加台词节点（VOICE/SFX_WAIT），与 engine 的 segments 一一对应
        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            const segStart = seg.regex_start ?? seg.regex;
            let segEnd = segStart;
            if (seg.regex_end !== undefined && seg.regex_end !== null) {
                segEnd = seg.regex_end + 1;
            } else if (seg.text && typeof seg.text === 'string') {
                segEnd = segStart + seg.text.length;
            } else {
                segEnd = segStart + 1;
            }
            let lineText = "";
            if (seg.text && typeof seg.text === 'string' && seg.text.trim().length > 0) {
                lineText = seg.text.replace(/\n/g, ' ').trim();
            } else {
                lineText = text.substring(segStart, segEnd).replace(/\n/g, ' ').trim();
            }
            if (!lineText) {
                lineText = "（音效等待）"; 
            }

            displayNodes.push({
                text: lineText,
                globalStartIndex: segStart,
                globalEndIndex: segEnd,
                isRemoved: false,
                segmentIndex: i,   // 对应 engine segments 的索引
                isSpecial: false,
                sortKey: segStart,
                cacheKey: seg.cacheKey
            });
        }

        // 1b. 从 musicList 扫描 BGM、Ambiance、SFX，插入标记节点
        if (this.musicList) {
            for (const m of this.musicList) {
                if (m.type === 'Music' || m.type === 'Ambiance' || m.type === 'SFX') {
                    const start = m.regex_start ?? m.regex;
                    let icon = '🍃';
                    let typeName = '环境音';
                    if (m.type === 'Music') { icon = '🎵'; typeName = '背景音乐'; }
                    else if (m.type === 'SFX') { icon = '💥'; typeName = '特效音'; }
                    
                    const name = m.name || m.src?.split('/').pop() || '未知音频';
                    // 开始标记
                    displayNodes.push({
                        text: `[${icon} ${m.type === 'SFX' ? '' : '开始播放 '}${typeName}: ${name}]`,
                        globalStartIndex: start,
                        globalEndIndex: start,
                        isRemoved: false,
                        segmentIndex: -1,  // 不对应 engine segment
                        isSpecial: true,
                        sortKey: start - 0.2  // 排在同位置台词之前
                    });
                    // 结束标记
                    if (m.type !== 'SFX' && m.regex_end !== undefined && m.regex_end > start) {
                        displayNodes.push({
                            text: `[🛑 停止播放 ${typeName}: ${name}]`,
                            globalStartIndex: m.regex_end,
                            globalEndIndex: m.regex_end,
                            isRemoved: false,
                            segmentIndex: -1,
                            isSpecial: true,
                            sortKey: m.regex_end + 0.1  // 排在同位置台词之后
                        });
                    }
                }
            }
        }

        // 2. 按位置排序
        displayNodes.sort((a, b) => a.sortKey - b.sortKey);

        this.lines = displayNodes;
        this.totalChars = text.length;
    }

    // ========== DOM 创建 ==========

    _createDOM() {
        // 遮罩
        this._backdrop = document.createElement('div');
        this._backdrop.className = 'st-is-lyrics-backdrop';

        // 播放器容器
        this._container = document.createElement('div');
        this._container.className = 'st-is-lyrics-player';

        // --- 标题栏 ---
        const titlebar = document.createElement('div');
        titlebar.className = 'st-is-lyrics-titlebar';
        titlebar.style.cursor = 'move';

        const title = document.createElement('span');
        title.className = 'st-is-lyrics-titlebar-title';
        title.textContent = '🎵 歌词播放器';

        const actions = document.createElement('div');
        actions.className = 'st-is-lyrics-titlebar-actions';

        const btnFullscreen = document.createElement('button');
        btnFullscreen.className = 'st-is-lyrics-titlebar-btn';
        btnFullscreen.title = '全屏';
        btnFullscreen.innerHTML = '<i class="fa-solid fa-expand"></i>';
        btnFullscreen.addEventListener('click', () => this._toggleFullscreen());
        this._btnFullscreen = btnFullscreen;

        const btnClose = document.createElement('button');
        btnClose.className = 'st-is-lyrics-titlebar-btn';
        btnClose.title = '关闭';
        btnClose.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        btnClose.addEventListener('click', () => this._handleClose());

        actions.appendChild(btnFullscreen);
        actions.appendChild(btnClose);
        titlebar.appendChild(title);
        titlebar.appendChild(actions);

        // --- 拖拽逻辑 ---
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initialLeft = 0;
        let initialTop = 0;

        const onDragStart = (e) => {
            if (this.isFullscreen) return;
            if (e.target.closest('.st-is-lyrics-titlebar-btn')) return;
            
            isDragging = true;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            startX = clientX;
            startY = clientY;

            // 获取当前实际位置，并取消 transform
            const rect = this._container.getBoundingClientRect();
            this._container.style.transform = 'none';
            this._container.style.margin = '0';
            this._container.style.left = `${rect.left}px`;
            this._container.style.top = `${rect.top}px`;
            
            initialLeft = rect.left;
            initialTop = rect.top;

            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('touchmove', onDragMove, { passive: false });
            document.addEventListener('mouseup', onDragEnd);
            document.addEventListener('touchend', onDragEnd);
        };

        const onDragMove = (e) => {
            if (!isDragging || this.isFullscreen) return;
            e.preventDefault(); // 防止移动端滚动
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            
            const dx = clientX - startX;
            const dy = clientY - startY;

            this._container.style.left = `${initialLeft + dx}px`;
            this._container.style.top = `${initialTop + dy}px`;
        };

        const onDragEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('touchmove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
            document.removeEventListener('touchend', onDragEnd);
        };

        titlebar.addEventListener('mousedown', onDragStart);
        titlebar.addEventListener('touchstart', onDragStart, { passive: false });

        // --- 进度条区域 ---
        const progressArea = document.createElement('div');
        progressArea.className = 'st-is-lyrics-progress-area';

        this._timeCurrentEl = document.createElement('span');
        this._timeCurrentEl.className = 'st-is-lyrics-time';
        this._timeCurrentEl.textContent = '00:00';

        const progressTrack = document.createElement('div');
        progressTrack.className = 'st-is-lyrics-progress-track';

        this._progressFill = document.createElement('div');
        this._progressFill.className = 'st-is-lyrics-progress-fill';

        this._progressThumb = document.createElement('div');
        this._progressThumb.className = 'st-is-lyrics-progress-thumb';

        progressTrack.appendChild(this._progressFill);
        progressTrack.appendChild(this._progressThumb);

        this._timeTotalEl = document.createElement('span');
        this._timeTotalEl.className = 'st-is-lyrics-time';
        this._timeTotalEl.textContent = '00:00';

        progressArea.appendChild(this._timeCurrentEl);
        progressArea.appendChild(progressTrack);
        progressArea.appendChild(this._timeTotalEl);

        // 进度条拖拽事件
        this._setupProgressDrag(progressTrack);

        // --- 控制按钮区域 ---
        const controlsArea = document.createElement('div');
        controlsArea.className = 'st-is-lyrics-controls';

        const btnPrev = document.createElement('button');
        btnPrev.className = 'st-is-lyrics-control-btn';
        btnPrev.title = '上一句';
        btnPrev.innerHTML = '<i class="fa-solid fa-backward-step"></i>';
        btnPrev.addEventListener('click', () => this.onPrev());

        const btnPlay = document.createElement('button');
        btnPlay.className = 'st-is-lyrics-control-btn play-btn';
        btnPlay.title = '播放/暂停';
        btnPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';
        btnPlay.addEventListener('click', () => this.onTogglePlay());
        this._btnPlayIcon = btnPlay.querySelector('i');

        const btnNext = document.createElement('button');
        btnNext.className = 'st-is-lyrics-control-btn';
        btnNext.title = '下一句';
        btnNext.innerHTML = '<i class="fa-solid fa-forward-step"></i>';
        btnNext.addEventListener('click', () => this.onNext());

        controlsArea.appendChild(btnPrev);
        controlsArea.appendChild(btnPlay);
        controlsArea.appendChild(btnNext);

        const volumeContainer = document.createElement('div');
        volumeContainer.className = 'st-is-lyrics-volume-container';

        const volumeIcon = document.createElement('i');
        volumeIcon.className = 'fa-solid fa-volume-high st-is-lyrics-volume-icon';
        
        volumeIcon.addEventListener('click', (e) => {
            volumeContainer.classList.toggle('expanded');
            e.stopPropagation();
        });

        // 点击外部时关闭滑动条
        this._onDocumentClick = (e) => {
            if (this._container && volumeContainer && !volumeContainer.contains(e.target)) {
                volumeContainer.classList.remove('expanded');
            }
        };
        document.addEventListener('click', this._onDocumentClick);

        const volumePanel = document.createElement('div');
        volumePanel.className = 'st-is-lyrics-volume-panel';

        const volumeTypes = [
            { key: 'master', label: '整体音量' },
            { key: 'music', label: 'Music 音量' },
            { key: 'ambiance', label: 'Ambiance 音量' },
            { key: 'sfx', label: 'SFX 音量' },
            { key: 'sfx_wait', label: 'SFX_WAIT 音量' },
            { key: 'voice', label: 'VOICE 音量' }
        ];

        this._volumeSliders = {};
        this._volumeDisplays = {};

        volumeTypes.forEach(v => {
            const item = document.createElement('div');
            item.className = 'st-is-lyrics-volume-item';

            const label = document.createElement('div');
            label.className = 'st-is-lyrics-volume-label';
            label.textContent = v.label;

            const row = document.createElement('div');
            row.className = 'st-is-lyrics-volume-slider-row';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'st-is-lyrics-volume-slider';
            slider.min = '0';
            slider.max = '2';
            slider.step = '0.01';
            slider.value = this.initialVolumes[v.key] !== undefined ? this.initialVolumes[v.key] : 1;

            const valDisplay = document.createElement('div');
            valDisplay.className = 'st-is-lyrics-volume-value';
            valDisplay.textContent = Number(slider.value).toFixed(2);

            slider.addEventListener('input', (e) => {
                const val = Number(e.target.value);
                valDisplay.textContent = val.toFixed(2);
                this.onVolumeChange(v.key, val);
            });

            this._volumeSliders[v.key] = slider;
            this._volumeDisplays[v.key] = valDisplay;

            row.appendChild(slider);
            row.appendChild(valDisplay);
            item.appendChild(label);
            item.appendChild(row);
            volumePanel.appendChild(item);
        });

        volumeContainer.appendChild(volumeIcon);
        volumeContainer.appendChild(volumePanel);
        controlsArea.appendChild(volumeContainer);

        // --- 歌词区域 ---
        this._lyricsContent = document.createElement('div');
        this._lyricsContent.className = 'st-is-lyrics-content';

        this._renderLyricLines();

        // --- 组装 ---
        this._container.appendChild(titlebar);
        this._container.appendChild(progressArea);
        this._container.appendChild(controlsArea);
        this._container.appendChild(this._lyricsContent);

        document.body.appendChild(this._backdrop);
        document.body.appendChild(this._container);
    }

    setPlayingState(isPlaying) {
        if (this._btnPlayIcon) {
            this._btnPlayIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        }
    }

    _renderLyricLines() {
        if (!this._lyricsContent) return;
        this._lyricsContent.innerHTML = '';

        this._lineElements = [];
        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            const div = document.createElement('div');
            div.className = 'st-is-lyrics-line';
            div.textContent = line.text || '\u00A0'; // 空行用 nbsp
            div.dataset.lineIndex = i;

            if (line.isRemoved) {
                div.classList.add('skipped');
            }
            if (line.isSpecial) {
                div.classList.add('st-is-lyrics-line-special');
            }

            // 点击歌词行跳转
            div.addEventListener('click', () => {
                if (line.isRemoved) return;
                if (line.segmentIndex === -1) return; // 特殊标记行不可跳转
                this.onSeek(line.segmentIndex);
            });

            console.log('[LyricsPlayer] check line for contextmenu:', line);
            // 长按或右键弹出重新生成选项
            if (line.cacheKey) {
                console.log('[LyricsPlayer] Attaching contextmenu and touchstart for cacheKey:', line.cacheKey);
                const showContextMenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
                    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);
                    this._showRegenerateMenu(clientX, clientY, line.cacheKey);
                };

                div.addEventListener('contextmenu', showContextMenu);

                let touchTimer;
                let startX = 0;
                let startY = 0;
                div.addEventListener('touchstart', (e) => {
                    startX = e.touches[0].clientX;
                    startY = e.touches[0].clientY;
                    touchTimer = setTimeout(() => {
                        showContextMenu(e);
                    }, 500); // 500ms 长按
                }, { passive: false });
                div.addEventListener('touchend', () => clearTimeout(touchTimer));
                div.addEventListener('touchmove', (e) => {
                    const dx = Math.abs(e.touches[0].clientX - startX);
                    const dy = Math.abs(e.touches[0].clientY - startY);
                    if (dx > 10 || dy > 10) {
                        clearTimeout(touchTimer);
                    }
                });
            }

            this._lyricsContent.appendChild(div);
            this._lineElements.push(div);
        }
    }

    _showRegenerateMenu(x, y, cacheKey) {
        if (this._contextMenu) {
            this._contextMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'st-is-lyrics-context-menu';
        
        const btn = document.createElement('button');
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> 重新生成';
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';
            btn.disabled = true;

            // 如果当前正在播放，先暂停
            const wasPlaying = this.isPlaying;
            if (this.isPlaying) {
                this.onTogglePlay();
            }

            try {
                await regenerateTtsAudioByCacheKey(cacheKey);
                
                // 实时更新播放器内的音频引用
                const newItem = getTtsItem(cacheKey);
                if (newItem && newItem.audioUrl) {
                    // 更新底层音乐列表
                    for (let m of this.musicList) {
                        if (m.cacheKey === cacheKey) {
                            m.url = newItem.audioUrl;
                            m.audioBlob = newItem.audioBlob;
                            m.audioBuffer = newItem.audioBuffer;
                        }
                    }
                    // 更新本类的缓存段
                    for (let s of this.segments) {
                        if (s.cacheKey === cacheKey) {
                            s.url = newItem.audioUrl;
                            s.audioBlob = newItem.audioBlob;
                            s.audioBuffer = newItem.audioBuffer;
                        }
                    }
                    // 如果被重新生成的句子正好是当前正在播放的句子，立即重新触发播放
                    const activeSeg = this.segments[this.activeSegmentIndex];
                    if (activeSeg && activeSeg.cacheKey === cacheKey) {
                        if (wasPlaying) {
                            this.onSeek(this.activeSegmentIndex, true);
                        }
                    } else {
                        // 如果生成的不是当前句，且之前在播放，则恢复播放
                        if (wasPlaying && !this.isPlaying) {
                            this.onTogglePlay();
                        }
                    }
                }

                toastr.success('音频已重新生成！');
            } catch (err) {
                toastr.error(`重新生成失败: ${err.message}`);
                // 失败时也恢复播放
                if (wasPlaying && !this.isPlaying) {
                    this.onTogglePlay();
                }
            } finally {
                if (this._contextMenu) {
                    this._contextMenu.remove();
                    this._contextMenu = null;
                }
            }
        });

        menu.appendChild(btn);
        document.body.appendChild(menu);
        this._contextMenu = menu;

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                this._contextMenu = null;
                document.removeEventListener('click', closeMenu);
                document.removeEventListener('touchstart', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
            document.addEventListener('touchstart', closeMenu);
        }, 10);
    }

    // ========== 进度条拖拽 ==========

    _setupProgressDrag(trackEl) {
        const onDrag = (e) => {
            if (!this._isDraggingProgress) return;
            e.preventDefault();
            const rect = trackEl.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            
            // 简单的将拖拽映射到片段列表
            const targetSegIdx = Math.floor(ratio * (this.segments.length - 1));
            this.onSeek(Math.max(0, targetSegIdx));
        };

        const onDragEnd = () => {
            if (!this._isDraggingProgress) return;
            this._isDraggingProgress = false;
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('touchmove', onDrag);
            document.removeEventListener('mouseup', onDragEnd);
            document.removeEventListener('touchend', onDragEnd);
        };

        const onDragStart = (e) => {
            this._isDraggingProgress = true;
            onDrag(e);
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('touchmove', onDrag, { passive: false });
            document.addEventListener('mouseup', onDragEnd);
            document.addEventListener('touchend', onDragEnd);
        };

        trackEl.addEventListener('mousedown', onDragStart);
        trackEl.addEventListener('touchstart', onDragStart, { passive: false });
    }

    _updateProgressUI(ratio) {
        if (this._progressFill) {
            this._progressFill.style.width = `${ratio * 100}%`;
        }
        if (this._progressThumb) {
            this._progressThumb.style.left = `${ratio * 100}%`;
        }
    }

    // ========== 全屏切换 ==========

    _toggleFullscreen() {
        this.isFullscreen = !this.isFullscreen;
        if (this._container) {
            this._container.classList.toggle('fullscreen', this.isFullscreen);
        }
        if (this._btnFullscreen) {
            const icon = this._btnFullscreen.querySelector('i');
            if (icon) {
                icon.className = this.isFullscreen
                    ? 'fa-solid fa-compress'
                    : 'fa-solid fa-expand';
            }
            this._btnFullscreen.title = this.isFullscreen ? '退出全屏' : '全屏';
        }
    }

    // ========== 关闭处理 ==========

    _handleClose() {
        this.hide();
        this.onClose();
    }

    // ========== 公共 API ==========

    /** 显示播放器 */
    show() {
        if (this.isVisible) return;
        this.isVisible = true;

        if (!this._container) {
            this._createDOM();
        } else {
            this._backdrop.style.display = '';
            this._container.style.display = '';
        }

        // 应用主题
        const themeId = extension_settings[extensionName]?.lyrics_player_theme || '深邃夜空';
        applyThemeToContainer(this._container, themeId);

        // 入场动画
        this._backdrop.classList.remove('exiting');
        this._container.classList.remove('exiting');
        this._backdrop.classList.add('entering');
        this._container.classList.add('entering');

        // 动画结束后移除 entering class
        const onAnimEnd = () => {
            this._container?.classList.remove('entering');
            this._backdrop?.classList.remove('entering');
        };
        this._container.addEventListener('animationend', onAnimEnd, { once: true });
    }

    /** 隐藏播放器（带退场动画） */
    hide() {
        if (!this.isVisible || !this._container) return;
        this.isVisible = false;

        this._backdrop.classList.remove('entering');
        this._container.classList.remove('entering');
        this._backdrop.classList.add('exiting');
        this._container.classList.add('exiting');

        const onAnimEnd = () => {
            if (this._backdrop) this._backdrop.style.display = 'none';
            if (this._container) this._container.style.display = 'none';
            this._backdrop?.classList.remove('exiting');
            this._container?.classList.remove('exiting');
        };
        this._container.addEventListener('animationend', onAnimEnd, { once: true });
    }

    /** 销毁播放器（移除 DOM） */
    destroy() {
        if (this._onDocumentClick) {
            document.removeEventListener('click', this._onDocumentClick);
            this._onDocumentClick = null;
        }
        this.isVisible = false;
        this._backdrop?.remove();
        this._container?.remove();
        this._backdrop = null;
        this._container = null;
        this._lyricsContent = null;
        this._progressFill = null;
        this._progressThumb = null;
        this._lineElements = null;
        this._volumeSlider = null;
    }

    /** 更新界面音量滑块 */
    updateVolumeUI(type, val) {
        if (this._volumeSliders && this._volumeSliders[type]) {
            this._volumeSliders[type].value = val;
        }
        if (this._volumeDisplays && this._volumeDisplays[type]) {
            this._volumeDisplays[type].textContent = Number(val).toFixed(2);
        }
    }

    _updateLineHighlights(activeIndex) {
        for (let i = 0; i < this._lineElements.length; i++) {
            const el = this._lineElements[i];
            if (!el) continue;

            if (i === activeIndex) {
                el.classList.add('st-is-lyrics-line-active');
            } else {
                el.classList.remove('st-is-lyrics-line-active');
            }
        }
    }

    _scrollToActiveLine(activeIndex) {
        const container = this._lyricsContent;
        const lineEl = this._lineElements[activeIndex];
        if (!container || !lineEl) return;

        // 计算让当前行垂直居中的滚动位置
        const containerHeight = container.clientHeight;
        const lineTop = lineEl.offsetTop;
        const lineHeight = lineEl.offsetHeight;

        const targetScrollTop = lineTop - containerHeight / 2 + lineHeight / 2;

        container.scrollTo({
            top: targetScrollTop,
            behavior: 'smooth'
        });
    }

    /**
     * 更新当前高亮的音频片段（由 Engine 驱动）
     * @param {number} segmentIndex - engine segments 数组中的索引
     */
    updateActiveSegment(segmentIndex) {
        if (!this.isVisible || !this._lineElements) return;
        
        this.activeSegmentIndex = segmentIndex;
        
        // 在 lines 数组中找到 segmentIndex 对应的 display line 索引
        const lineIndex = this.lines.findIndex(l => l.segmentIndex === segmentIndex);
        if (lineIndex === -1) return;

        // 1. 更新行高亮
        if (this.activeLineIndex !== lineIndex) {
            this._updateLineHighlights(lineIndex);
            this.activeLineIndex = lineIndex;

            // 2. 滚动到当前行
            this._scrollToActiveLine(lineIndex);
        }
        
        // 总体进度条基于已播放的片段数
        if (!this._isDraggingProgress && this.segments.length > 0) {
            const ratio = segmentIndex / this.segments.length;
            this._updateProgressUI(ratio);
        }
    }
    
    /**
     * 细微动画：更新单句内的时间进度显示
     */
    animateSegmentProgress(ratio) {
        if (!this._isDraggingProgress && this.segments.length > 0) {
            const baseRatio = this.activeSegmentIndex / this.segments.length;
            const segmentShare = 1 / this.segments.length;
            const totalRatio = Math.min(1, baseRatio + ratio * segmentShare);
            this._updateProgressUI(totalRatio);
        }
    }

    _updateLineHighlights(newActiveIndex) {
        if (!this._lineElements) return;

        for (let i = 0; i < this._lineElements.length; i++) {
            const el = this._lineElements[i];
            el.classList.remove('active', 'played');

            if (i === newActiveIndex) {
                el.classList.add('active');
            } else if (i < newActiveIndex) {
                el.classList.add('played');
            }
        }
    }

    _scrollToActiveLine(lineIndex) {
        if (!this._lineElements || !this._lyricsContent) return;
        const el = this._lineElements[lineIndex];
        if (!el) return;

        const container = this._lyricsContent;
        const containerHeight = container.clientHeight;
        const lineTop = el.offsetTop;
        const lineHeight = el.offsetHeight;

        // 将当前行滚动到容器的中央
        const targetScroll = lineTop - containerHeight / 2 + lineHeight / 2;

        container.scrollTo({
            top: targetScroll,
            behavior: 'smooth'
        });
    }

    /**
     * 设置总时长
     * @param {number} seconds 总秒数
     */
    setDuration(seconds) {
        // 如果我们算出了音频总字符数，可以等比例缩放时长（因为原逻辑传入的是全文本预计时长）
        if (this.totalAudioLength > 0 && this.totalChars > 0) {
            seconds = seconds * (this.totalAudioLength / this.totalChars);
        }
        this._duration = seconds;
        if (this._timeTotalEl) {
            this._timeTotalEl.textContent = formatTime(seconds);
        }
    }

    /**
     * 设置当前时间
     * @param {number} seconds 当前秒数
     */
    setCurrentTime(seconds) {
        this._currentTime = seconds;
        if (this._timeCurrentEl) {
            this._timeCurrentEl.textContent = formatTime(seconds);
        }

        // 更新进度条（基于时间）
        if (!this._isDraggingProgress && this._duration > 0) {
            const ratio = Math.min(1, seconds / this._duration);
            this._updateProgressUI(ratio);
        }
    }

    /**
     * 重新应用当前主题（从外部调用，如设置页面切换主题后）
     */
    applyCurrentTheme() {
        if (!this._container) return;
        const themeId = extension_settings[extensionName]?.lyrics_player_theme || '深邃夜空';
        applyThemeToContainer(this._container, themeId);
    }
}

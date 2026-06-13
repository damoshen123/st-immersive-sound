class LogManager {
    constructor() {
        this.logTextarea = null;
        this.playingListContainer = null;
    }

    /**
     * 初始化 LogManager 并关联到指定的 UI 元素
     * @param {object} elements - 包含 UI 元素的对豄
     * @param {HTMLTextAreaElement} elements.logTextarea - 用于显示日志的 textarea
     * @param {HTMLElement} elements.playingListContainer - 用于显示播放列表的容器
     */
    init({ logTextarea, playingListContainer }) {
        this.logTextarea = logTextarea;
        this.playingListContainer = playingListContainer;
    }

    /**
     * 更新正在播放的列表UI
     * @param {object} playingList - 当前正在播放的音频列表
     */
    updatePlayingList(playingList) {
        if (!this.playingListContainer) {
            return;
        }

        // Clear previous list
        this.playingListContainer.innerHTML = '';

        if (Object.keys(playingList).length === 0) {
            this.playingListContainer.innerHTML = '<p style="text-align: center; color: var(--st-is-text-secondary);">当前没有正在播放的音频。</p>';
            return;
        }

        for (const key in playingList) {
            if (playingList.hasOwnProperty(key)) {
                const item = playingList[key];
                if (!item || !item.source || !item.source.buffer) continue;

                const progress = (item.source.progress * 100).toFixed(2);
                const duration = item.source.buffer.duration.toFixed(2);
                const currentTime = (item.source.buffer.duration * item.source.progress).toFixed(2);

                const itemElement = document.createElement('div');
                itemElement.className = 'st-is-playing-item';
                
                const title = item.type === 'VOICE' && item.text ? item.text : key;

                itemElement.innerHTML = `
                    <div class="st-is-playing-item-header" title="${title}">${title}</div>
                    <div class="st-is-playing-item-details">
                        <span><strong>类型:</strong> ${item.type}</span>
                        <span><strong>音量:</strong> ${item.baseVolume.toFixed(2)}</span>
                        <span>${currentTime}s / ${duration}s</span>
                    </div>
                    <div class="st-is-playing-item-progress-bar-container">
                        <div class="st-is-playing-item-progress-bar" style="width: ${progress}%;"></div>
                    </div>
                `;
                this.playingListContainer.appendChild(itemElement);
            }
        }
    }

    /**
     * 添加一条日志
     * @param {string} message - 日志消息
     */
    add(message) {
        if (!this.logTextarea) {
            console.error("LogManager has not been initialized.");
            return;
        }
        const timestamp = new Date().toLocaleString();
        const currentLog = this.logTextarea.value;
        this.logTextarea.value = `${currentLog}[${timestamp}] ${message}\n`;
        // 自动滚动到底部
        this.logTextarea.scrollTop = this.logTextarea.scrollHeight;
    }

    /**
     * 清空日志
     */
    clear() {
        if (this.logTextarea) {
            this.logTextarea.value = '';
        }
    }

    /**
     * 导出日志到文件
     */
    export() {
        if (!this.logTextarea || !this.logTextarea.value) {
            this.add("没有日志可以导出。");
            return;
        }

        const blob = new Blob([this.logTextarea.value], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `st-immersive-sound-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.add("日志已导出。");
    }
}

// 导出一个单例
export const logManager = new LogManager();

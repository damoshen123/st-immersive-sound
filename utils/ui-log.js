import { logManager } from './log.js';
import { playingList } from './playback.js';

let updateInterval = null;

export function initLogTab() {
    const exportLogButton = document.getElementById('st-is-export-log');
    const clearLogButton = document.getElementById('st-is-clear-log');
    const logTextarea = document.getElementById('st-is-log-textarea');
    const playingListContainer = document.getElementById('st-is-playing-list-container');
    const logTab = document.querySelector('.st-is-nav-link[data-tab="log"]');

    // 初始化 logManager，将其与 UI 元素关联
    logManager.init({ logTextarea, playingListContainer });

    exportLogButton.addEventListener('click', () => {
        logManager.export();
    });

    clearLogButton.addEventListener('click', () => {
        logManager.clear();
        logManager.add("日志已清空。");
    });

    // Function to start updating the playing list
    const startUpdating = () => {
        if (!updateInterval) {
            updateInterval = setInterval(() => {
                logManager.updatePlayingList(playingList);
            }, 500); // Update every 500ms
        }
    };

    // Function to stop updating the playing list
    const stopUpdating = () => {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
    };

    // Use a MutationObserver to check if the log tab is active
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.attributeName === 'class') {
                const isActive = logTab.classList.contains('active');
                if (isActive) {
                    startUpdating();
                } else {
                    stopUpdating();
                }
            }
        });
    });

    observer.observe(logTab, { attributes: true });

    // Initial check in case the tab is already active on load
    if (logTab.classList.contains('active')) {
        startUpdating();
    }

    logManager.add("日志模块已初始化。");
}

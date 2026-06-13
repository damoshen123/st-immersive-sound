// @ts-nocheck
import { extensionFolderPath ,extensionName} from './config.js';
import { fetchWithCsrf, getRequestHeaders } from './helpers.js';
import { extension_settings, extensionTypes } from "../../../../extensions.js";
// 全局变量来存储版本信息和更新状态
let localVersion = null;
let remoteVersion = null;
let updateAvailable = false;

function getExtensionType(externalId) {
    const id = Object.keys(extensionTypes).find(
        (id) => id === externalId || (id.startsWith('third-party') && id.endsWith(externalId)),
    );
    return id ? extensionTypes[id] : 'local';
}


async function update_extension(extensionname, global) {
    const response = await fetchWithCsrf('/api/extensions/update', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ extensionName: extensionname, global }),
    });
    return response;
}

async function check_update() {
    const global = getExtensionType(extensionName) === 'global' ? true : false;

    const reload = () => {
        toastr.success(`成功更新插件`);
        console.log(`成功更新插件`);
        setTimeout(() => location.reload(), 4000);
    };

    const update_response = await update_extension(extensionName, global);
    if (update_response.ok) {
        if ((await update_response.json()).isUpToDate) {
            toastr.success("插件是最新版本");
            console.log("插件是最新版本");
        } else {
            reload();
        }
        return true;
    }
}
async function checkForUpdates() {
    const updateNotesElement = document.getElementById('st-is-update-notes');
    const checkUpdateButton = document.getElementById('st-is-check-update');

    if (checkUpdateButton) checkUpdateButton.disabled = true;
    if (updateNotesElement) updateNotesElement.value = '正在检查更新...';

    // 1. 获取本地版本
    try {
        const localManifestResponse = await fetch(`${extensionFolderPath}/manifest.json?t=${new Date().getTime()}`, { cache: 'no-cache' });
        if (localManifestResponse.ok) {
            const localManifest = await localManifestResponse.json();
            localVersion = localManifest.version;
        } else {
            console.error('无法获取本地 manifest.json 文件。');
            if (updateNotesElement) updateNotesElement.value = '无法获取本地版本信息。';
        }
    } catch (error) {
        console.error('获取本地 manifest.json 时出错:', error);
        if (updateNotesElement) updateNotesElement.value = '获取本地版本信息失败。';
    }

    // 2. 获取远程版本
    try {
        const remoteManifestUrl = `https://raw.githubusercontent.com/damoshen123/st-immersive-sound/master/manifest.json?t=${new Date().getTime()}`;
        const response = await fetch(remoteManifestUrl, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const remoteManifest = await response.json();
        remoteVersion = remoteManifest.version;

        if (updateNotesElement) {
            updateNotesElement.value = remoteManifest.update_notes || remoteManifest.updata || '暂无更新说明。';
        }

        // 3. 比较版本
        if (localVersion) {
            // 使用 localeCompare 进行版本号比较，适用于 "1.0.0" vs "1.0.10" 等情况
            if (remoteVersion.localeCompare(localVersion, undefined, { numeric: true, sensitivity: 'base' }) > 0) {
                console.log(`发现新版本: ${remoteVersion} (当前: ${localVersion})`);
                updateAvailable = true;

                check_update();
            } else {
                console.log('插件已是最新版本。');
                updateAvailable = false;
                if (updateNotesElement) updateNotesElement.value = `插件已是最新版本。\n\n${remoteManifest.update_notes || remoteManifest.updata || ''}`;
            }
        } else {
            updateAvailable = false;
        }

    } catch (error) {
        console.error('检查更新时出错:', error);
        if (updateNotesElement) {
            updateNotesElement.value = '无法连接到更新服务器，请检查网络连接或稍后再试。';
        }
        updateAvailable = false;
    } finally {
        if (checkUpdateButton) checkUpdateButton.disabled = false;
        // 4. 更新UI
        updateVersionInfo();
    }
}

/**
 * 根据检查结果更新设置界面中的版本信息和提示。
 */
function updateVersionInfo() {
    const localVersionDisplay = document.getElementById('st-is-local-version');
    const remoteVersionDisplay = document.getElementById('st-is-remote-version');
    const updateIndicator = document.getElementById('st-is-update-indicator');
    const titleUpdateNotification = document.getElementById('st-is-title-update-notification');
    const versionDisplay = document.getElementById('st-is-version-display');

    if (versionDisplay && localVersion) {
        versionDisplay.textContent = `v${localVersion}`;
    }
    if (localVersionDisplay && localVersion) {
        localVersionDisplay.textContent = `v${localVersion}`;
    }
    if (remoteVersionDisplay && remoteVersion) {
        remoteVersionDisplay.textContent = `v${remoteVersion}`;
    }

    if (updateIndicator) {
        updateIndicator.style.display = updateAvailable ? 'inline-block' : 'none';
    }

    if (titleUpdateNotification) {
        titleUpdateNotification.style.display = updateAvailable ? 'inline' : 'none';
    }
}

/**
 * 初始化更新检查功能，绑定事件并执行首次检查。
 * @param {JQuery} settingsModal - 设置面板的 jQuery 对象。
 */
export async function initUpdateCheck(settingsModal) {
    // 为“关于”页面中的检查更新按钮绑定事件
    settingsModal.find('#st-is-check-update').on('click', checkForUpdates);
    
    // 首次加载时自动检查更新
      checkForUpdates();
}

// 导出一个独立的检查函数，给侧边栏的按钮使用
export const checkUpdateFunction = checkForUpdates;

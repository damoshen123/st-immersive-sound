// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { extensionName } from "./config.js";

let audioArray = [];
let yinxiaoSttingArray = [];

/**
 * 异步函数：从插件设置中获取音效资源信息
 * 该函数加载插件设置中所有启用的“资源预设”，并将其解析到 audioArray 中。
 * @returns {Promise<void>}
 */
async function get_yin_xiao_world_info() {
    audioArray = []; // Reset the array
    const settings = extension_settings[extensionName];
    const assetProfiles = settings.audio_asset_profiles || {};
    const currentProfileName = settings.current_audio_asset_profile;
    const profile = assetProfiles[currentProfileName];

    if (profile && profile.enabled && profile.content) {
        const lines = profile.content.split('\n');
        lines.forEach(line => {
            if (line.trim() === '') return;
            const [k, url, uploader, volume, vibration] = line.split('=');
            if (k && url) {
                audioArray.push({
                    key: k.trim(),
                    url: url.trim(),
                    uploader: uploader ? uploader.trim() : 'N/A',
                    volume: volume ? parseFloat(volume.trim()) : 100,
                    vibration: vibration ? vibration.trim() : 'N/A',
                    source_profile: currentProfileName, // Track the source profile
                });
            }
        });
    }
    console.log("声临其境: 已从插件设置加载音效资源", audioArray);
}

/**
 * 异步函数：从插件设置中获取音效设定
 * 该函数加载插件设置中所有启用的“音效设定预设”，并将其内容添加到 yinxiaoSttingArray。
 * @returns {Promise<string[]>}
 */
async function get_yin_xiao_world_setting() {
    yinxiaoSttingArray = []; // Reset the array
    const settings = extension_settings[extensionName];
    const resourcesProfiles = settings.audio_resources_profiles || {};
    const currentProfileName = settings.current_audio_resources_profile;
    const profile = resourcesProfiles[currentProfileName];

    if (profile && profile.enabled && profile.content) {
        yinxiaoSttingArray.push(profile.content);
    }
    console.log("声临其境: 已从插件设置加载音效设定", yinxiaoSttingArray);
    return yinxiaoSttingArray;
}

/**
 * 搜索音效资源函数
 * @param {String} name - 要搜索的音效资源名称
 * @returns {Object|String} 返回找到的音效资源对象，如果未找到则返回空字符串
 */
function search_yin_xiao_zi_yuan(name) {
    if (typeof name !== 'string') return "";
    const queryKey = name.trim();
    let result = audioArray.find(item => item.key === queryKey);

    if (result) {
        console.log(`查询结果: ${result.key} => ${result.url}`);
        return { url: result.url, volume: result.volume, uploader: result.uploader, vibration: result.vibration };
    } else {
        console.log(`未找到精确键: ${queryKey}，尝试模糊匹配...`);
        
        const normalize = (str) => str.replace(/_/g, '');
        const targetStr = normalize(queryKey);
        const targetChars = Array.from(targetStr);
        
        let bestMatch = null;
        let highestScore = -1;
        let bestLengthDiff = Infinity;
        
        for (const item of audioArray) {
            const candidateStr = normalize(item.key);
            const candidateChars = Array.from(candidateStr);
            let availableChars = [...targetChars];
            let score = 0;
            
            for (const char of candidateChars) {
                const idx = availableChars.indexOf(char);
                if (idx !== -1) {
                    score++;
                    availableChars.splice(idx, 1);
                }
            }
            
            const lengthDiff = Math.abs(candidateChars.length - targetChars.length);
            if (score > highestScore || (score === highestScore && lengthDiff < bestLengthDiff)) {
                highestScore = score;
                bestMatch = item;
                bestLengthDiff = lengthDiff;
            }
        }
        
        if (bestMatch && highestScore > 0) {
            console.log(`模糊匹配结果: ${queryKey} => ${bestMatch.key} (得分: ${highestScore})`);
            return { url: bestMatch.url, volume: bestMatch.volume, uploader: bestMatch.uploader, vibration: bestMatch.vibration };
        }
        
        console.log(`未找到模糊匹配的键: ${queryKey}`);
        return "";
    }
}

// Note: The functions for adding, updating, and deleting entries (addWorldbookEntrie, etc.)
// have been removed as this logic will now be handled directly by the new UI module
// (ui-audio-resources.js) by modifying the extension_settings object.

export {
    get_yin_xiao_world_info,
    get_yin_xiao_world_setting,
    search_yin_xiao_zi_yuan,
    audioArray,
    yinxiaoSttingArray,
};

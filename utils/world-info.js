
import { getContext } from "../../../../st-context.js";
import { getWorldInfoSettings, world_names,world_info,saveWorldInfo} from "../../../../world-info.js";

let audioArray = [];
let yin_xiao_world_name;
let char_world_name;
let worldEntries = {};


/**
 * 异步函数：获取音效世界信息
 * 该函数用于加载特定世界中的音效资源信息，并将其解析为键值对数组
 * @returns {Promise<void>} 无返回值，但会设置全局变量 yin_xiao_world_info、yin_xiao_zi_yuan 和 audioArray
 */
async function get_yin_xiao_world_info() {
    let context = getContext();
    // 获取当前世界信息设置
    let world = world_info.globalSelect;
    let yin_xiao_world_info = "";

    console.log("world_info", world);

    // Reset globals
    worldEntries = {};
    audioArray = [];
    yin_xiao_world_name = undefined;
    char_world_name = undefined;

    const processedWorlds = new Set();

    char_world_name = getContext().characters[getContext().characterId]?.data?.extensions?.world;
    console.log("char_world_name", char_world_name)

     // 遍历所有世界名称，查找包含"声临其境"的世界并加载其信息
     for (let i = 0; i < world.length; i++) {
        let worldname = world[i];
        if (worldname.includes("声临其境") && !processedWorlds.has(worldname)) {
            processedWorlds.add(worldname);
            try {
                yin_xiao_world_info = await context.loadWorldInfo(worldname);
                if (yin_xiao_world_info && yin_xiao_world_info.entries) {
                    yin_xiao_world_name = worldname;
                    worldEntries[yin_xiao_world_name] = yin_xiao_world_info.entries;
                    console.log("已找到'声临其境'世界信息", yin_xiao_world_info);

                    for (let key in yin_xiao_world_info.entries) {
                        if (yin_xiao_world_info.entries[key].comment.includes("音效资源")) {
                            const entry = yin_xiao_world_info.entries[key];
                            const entryName = entry.comment;
                            const content = entry.content;
                            const lines = content.split('\n');
                            lines.forEach(line => {
                                const [k, url, uploader, volume, vibration] = line.split('=');
                                if (k && url) {
                                    audioArray.push({
                                        yin_xiao_world_name: yin_xiao_world_name,
                                        yin_xiao_entrie_name: entryName,
                                        key: k.trim(),
                                        url: url.trim(),
                                        volume: volume ? volume.trim() : 100,
                                        uploader: uploader ? uploader.trim() : 'N/A',
                                        vibration: vibration ? vibration.trim() : 'N/A'
                                    });
                                }
                            });
                        }
                    }
                }
            } catch (e) { console.error(e); }
        }
    }

    if (!yin_xiao_world_name) {
        console.log("未找到'声临其境'世界信息");
    }

    if (char_world_name) {
        processedWorlds.add(char_world_name);
        try {
            let char_WorldInfo = await getContext().loadWorldInfo(char_world_name);
            if (char_WorldInfo && char_WorldInfo.entries) {
                worldEntries[char_world_name] = char_WorldInfo.entries;
                for (let key in char_WorldInfo.entries) {
                    if (char_WorldInfo.entries[key].comment.includes("音效资源")) {
                        const entry = char_WorldInfo.entries[key];
                        const entryName = entry.comment;
                        const content = entry.content;
                        const lines = content.split('\n');
                        lines.forEach(line => {
                            const [k, url, uploader, volume, vibration] = line.split('=');
                            if (k && url) {
                                audioArray.push({
                                    char_world_name: char_world_name,
                                    char_yin_xiao_entrie_name: entryName,
                                    key: k.trim(),
                                    url: url.trim(),
                                    volume: volume ? volume.trim() : 100,
                                    uploader: uploader ? uploader.trim() : 'N/A',
                                    vibration: vibration ? vibration.trim() : 'N/A'
                                });
                            }
                        });
                    }
                }
            }
        } catch (e) { console.error(e); }
    } else {
        console.log('未找到角色卡音频资源');
    }

   
}

/**
 * 更新世界书中的音频条目
 * @param {object} audioData - 包含要更新的音频信息的对象
 * @param {string} [oldName] - The original key of the audio entry, used for finding the line if the key itself is changed.
 */
async function updateWorldbookEntrie(audioData, oldName) {
    const context = getContext();
    const { 
        key, 
        url, 
        uploader, 
        volume, 
        vibration, 
        char_world_name, 
        yin_xiao_world_name, 
        char_yin_xiao_entrie_name, 
        yin_xiao_entrie_name 
    } = audioData;

    const isCharWorld = !!char_world_name;
    const worldName = isCharWorld ? char_world_name : yin_xiao_world_name;
    const entryName = isCharWorld ? char_yin_xiao_entrie_name : yin_xiao_entrie_name;

    if (!worldName || !entryName) {
        console.error("World name or entry name is missing for update.", audioData);
        toastr.error("更新失败：世界书或条目名称丢失。");
        return;
    }

    try {
        const worldInfo = await context.loadWorldInfo(worldName);
        if (!worldInfo || !worldInfo.entries) {
            console.error(`Failed to load world info for "${worldName}"`);
            toastr.error(`加载世界书失败: ${worldName}`);
            return;
        }

        const entryKey = Object.keys(worldInfo.entries).find(
            k => worldInfo.entries[k].comment === entryName
        );

        if (!entryKey) {
            console.error(`Entry "${entryName}" not found in world book "${worldName}"`);
            toastr.error(`在 ${worldName} 中未找到条目: ${entryName}`);
            return;
        }

        const entry = worldInfo.entries[entryKey];
        
        const lines = entry.content.split('\n');
        let found = false;
        // If oldName is provided, use it to find the line. Otherwise, use the current key.
        const keyToFind = (oldName || key).trim();

        const newLines = lines.map(line => {
            const parts = line.split('=');
            if (parts.length > 0 && parts[0].trim() === keyToFind) {
                found = true;
                // Always use the new key for the updated line.
                return `${key.trim()}=${url.trim()}=${(uploader || 'N/A').trim()}=${(volume || 100).toString().trim()}=${(vibration || 'N/A').trim()}`;
            }
            return line;
        });

        if (!found) {
            console.error(`Audio key "${keyToFind}" not found in entry "${entryName}"`);
            toastr.error(`在条目 ${entryName} 中未找到音频: ${keyToFind}`);
            return;
        }

        entry.content = newLines.join('\n');
        worldInfo.entries[entryKey] = entry;

        await saveWorldInfo(worldName, worldInfo);

        console.log(`Successfully updated entry "${key}" in "${worldName}".`);
        
        // Update the in-memory audioArray
        const index = audioArray.findIndex(item => item.key === keyToFind && (item.yin_xiao_world_name === worldName || item.char_world_name === worldName));
        if (index !== -1) {
            // Update with all new data, including the potentially new key
            audioArray[index] = { ...audioArray[index], key, url, uploader, volume, vibration };
        }

    } catch (error) {
        console.error("Error updating world book entry:", error);
        toastr.error(`更新世界书条目时出错: ${error.message}`);
        throw error; // Re-throw the error to notify the caller
    }
}

/**
 * Deletes an audio entry from a world book.
 * @param {object} audioData - The audio data for the entry to delete.
 */
async function deleteWorldbookEntrie(audioData) {
    const context = getContext();
    const {
        key,
        char_world_name,
        yin_xiao_world_name,
        char_yin_xiao_entrie_name,
        yin_xiao_entrie_name
    } = audioData;

    const isCharWorld = !!char_world_name;
    const worldName = isCharWorld ? char_world_name : yin_xiao_world_name;
    const entryName = isCharWorld ? char_yin_xiao_entrie_name : yin_xiao_entrie_name;

    if (!worldName || !entryName) {
        const errorMsg = "删除失败：世界书或条目名称丢失。";
        console.error(errorMsg, audioData);
        toastr.error(errorMsg);
        throw new Error("World name or entry name is missing for deletion.");
    }

    try {
        const worldInfo = await context.loadWorldInfo(worldName);
        if (!worldInfo || !worldInfo.entries) {
            throw new Error(`加载世界书失败: "${worldName}"`);
        }

        const entryKey = Object.keys(worldInfo.entries).find(
            k => worldInfo.entries[k].comment === entryName
        );

        if (!entryKey) {
            throw new Error(`在世界书 "${worldName}" 中未找到条目 "${entryName}"`);
        }

        const entry = worldInfo.entries[entryKey];
        const lines = entry.content.split('\n');
        let found = false;
        const keyToFind = key.trim();

        const newLines = lines.filter(line => {
            const parts = line.split('=');
            if (parts.length > 0 && parts[0].trim() === keyToFind) {
                found = true;
                return false; // Exclude this line
            }
            return true; // Keep this line
        });

        if (!found) {
            throw new Error(`在条目 "${entryName}" 中未找到音频: "${keyToFind}"`);
        }

        entry.content = newLines.join('\n');
        worldInfo.entries[entryKey] = entry;

        await saveWorldInfo(worldName, worldInfo);

        console.log(`Successfully deleted entry "${key}" from "${worldName}".`);

        // Remove from the in-memory audioArray
        const index = audioArray.findIndex(item => item.key === keyToFind && (item.yin_xiao_world_name === worldName || item.char_world_name === worldName));
        if (index !== -1) {
            audioArray.splice(index, 1);
        }

    } catch (error) {
        console.error("删除世界书条目时出错:", error);
        toastr.error(`删除世界书条目时出错: ${error.message}`);
        throw error;
    }
}

/**
 * Adds a new audio entry to a world book.
 * @param {object} audioData - The audio data for the new entry.
 * @param {string} worldName - The name of the world book to modify.
 * @param {string} entryName - The comment/name of the specific entry to add to.
 * @returns {Promise<object>} The newly created audio data object with all properties.
 */
async function addWorldbookEntrie(audioData, worldName, entryName) {
    const context = getContext();
    const { 
        key, 
        url, 
        uploader = 'N/A', 
        volume = 100, 
        vibration = 'N/A'
    } = audioData;

    if (!worldName) {
        throw new Error("World name is required to add a new entry.");
    }
    if (!entryName) {
        throw new Error("条目名称是必填项。");
    }
    if (!key || !url) {
        throw new Error("名称 (key) 和 URL 是必填项。");
    }

    try {
        const worldInfo = await context.loadWorldInfo(worldName);
        if (!worldInfo || !worldInfo.entries) {
            throw new Error(`Failed to load world info for "${worldName}"`);
        }

        // Find the entry by its comment (entryName)
        const entryKey = Object.keys(worldInfo.entries).find(
            k => worldInfo.entries[k].comment === entryName
        );

        if (!entryKey) {
            throw new Error(`在世界书 "${worldName}" 中未找到条目 "${entryName}"`);
        }

        const entry = worldInfo.entries[entryKey];
        const newEntryLine = `\n${key.trim()}=${url.trim()}=${uploader.trim()}=${volume.toString().trim()}=${vibration.trim()}`;
        
        // Append the new line, ensuring not to add a newline if content is empty
        entry.content = entry.content.trim() ? entry.content.trim() + newEntryLine : newEntryLine.trim();
        
        worldInfo.entries[entryKey] = entry;

        await saveWorldInfo(worldName, worldInfo);
        console.log(`Successfully added entry "${key}" to "${worldName}".`);

        // Construct the full new audio object to return and add to the array
        const newAudioObject = {
            key: key.trim(),
            url: url.trim(),
            uploader: uploader.trim(),
            volume: volume,
            vibration: vibration.trim(),
            [worldName === char_world_name ? 'char_world_name' : 'yin_xiao_world_name']: worldName,
            [worldName === char_world_name ? 'char_yin_xiao_entrie_name' : 'yin_xiao_entrie_name']: entry.comment
        };

        audioArray.push(newAudioObject);
        return newAudioObject;

    } catch (error) {
        console.error("Error adding world book entry:", error);
        toastr.error(`添加世界书条目时出错: ${error.message}`);
        throw error;
    }
}

/**
 * 搜索音效资源函数
 * @param {String} name - 要搜索的音效资源名称
 * @returns {String} 返回找到的音效资源URL，如果未找到则返回空字符串
 */
function search_yin_xiao_zi_yuan(name) {
    // 输出结果
    console.log("audioArray", audioArray);

    // 查询示例
    const queryKey = name;
    const result = audioArray.find(item => item.key === queryKey);

    if (result) {
        console.log(`查询结果: ${result.key} => ${result.url}`);
        return {url:result.url,volume:result.volume,uploader:result.uploader,vibration:result.vibration};
    } else {
        console.log("未找到该键");
        return "";
    }
}

export {
    get_yin_xiao_world_info,
    search_yin_xiao_zi_yuan,
    updateWorldbookEntrie,
    addWorldbookEntrie,
    deleteWorldbookEntrie,
    world_info,
    audioArray,
    yin_xiao_world_name,
    char_world_name,
    worldEntries,
};

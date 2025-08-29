// 扩展的主脚本
// 以下是一些基本扩展功能的示例

// 你可能需要从 extensions.js 导入 extension_settings, getContext 和 loadExtensionSettings
import { extension_settings, loadExtensionSettings,extensionTypes} from "../../../extensions.js";
import { createNewWorldInfo, deleteWorldInfo, getWorldInfoSettings, selected_world_info, setWorldInfoButtonClass, world_info, world_names } from "../../../world-info.js";
// 你可能需要从主脚本导入一些其他函数
import { saveSettingsDebounced,this_chid} from "../../../../script.js";

import { getContext } from "../../../st-context.js";
import { searchCharByName } from "../../../tags.js";
// @require      


console.log("getContext",getContext())

console.log("getWorldInfoPrompt",getWorldInfoSettings())



let context=getContext()



console.log("getCharacters",getContext().characterId)



console.log("extension_settings.regex",extension_settings.regex)


let yin_xiao_world_info="";

let  yin_xiao_zi_yuan="";

let  audioArray=[];


let musicList=[];


let playingList={}

let previewAudio = {
    source: null,
    url: null
};

let audioCtx;
let pannerNode_Music;
let pannerNode_Ambiance;
let pannerNode_SFX;

let masterGainNode;
let musicGainNode;
let ambianceGainNode;
let sfxGainNode;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        pannerNode_Music = audioCtx.createPanner();
        pannerNode_Music.panningModel = 'HRTF'; // 使用头部相关传输函数
        pannerNode_Music.distanceModel = 'inverse';
        pannerNode_Music.refDistance = 0.6;
        pannerNode_Music.maxDistance = 20;
        pannerNode_Music.rolloffFactor = 0.3;

        pannerNode_Ambiance = audioCtx.createPanner();
        pannerNode_Ambiance.panningModel = 'HRTF'; // 使用头部相关传输函数
        pannerNode_Ambiance.distanceModel = 'inverse';
        pannerNode_Ambiance.refDistance = 0.6;
        pannerNode_Ambiance.maxDistance = 20;
        pannerNode_Ambiance.rolloffFactor = 0.3;

        pannerNode_SFX = audioCtx.createPanner();
        pannerNode_SFX.panningModel = 'HRTF'; // 使用头部相关传输函数
        pannerNode_SFX.distanceModel = 'inverse';
        pannerNode_SFX.refDistance = 0.6;
        pannerNode_SFX.maxDistance = 20;
        pannerNode_SFX.rolloffFactor = 0.3;

        // Explicitly set listener orientation to default (facing forward)
        const listener = audioCtx.listener;
        if (listener.forwardX) { // Modern API
            listener.forwardX.value = 0;
            listener.forwardY.value = 0;
            listener.forwardZ.value = -1;
            listener.upX.value = 0;
            listener.upY.value = 1;
            listener.upZ.value = 0;
        } else { // Deprecated fallback
            listener.setOrientation(0, 0, -1, 0, 1, 0);
        }

        masterGainNode = audioCtx.createGain();
        musicGainNode = audioCtx.createGain();
        ambianceGainNode = audioCtx.createGain();
        sfxGainNode = audioCtx.createGain();

        musicGainNode.connect(masterGainNode);
        ambianceGainNode.connect(masterGainNode);
        sfxGainNode.connect(masterGainNode);
        masterGainNode.connect(audioCtx.destination);

        console.log("AudioContext initialized on demand.");
    }
}

function getAudioContext() {
    initAudio();
    return audioCtx;
}


let memoryCache=new Map();
let dbName = 'AudioCacheDB';

let storeName = 'audioCache';



let marker;

let sourceisPlaying={};

let is3dAudioEnabled = false;





/**
 * 异步函数：获取音效世界信息
 * 该函数用于加载特定世界中的音效资源信息，并将其解析为键值对数组
 * @returns {Promise<void>} 无返回值，但会设置全局变量 yin_xiao_world_info、yin_xiao_zi_yuan 和 audioArray
 */
async  function get_yin_xiao_world_info(){

  // 获取当前世界信息设置
  let world=getWorldInfoSettings()

  console.log("world_info",world)

  let worldname=world.world_info.globalSelect

  // 遍历所有世界名称，查找包含"声临其境"的世界并加载其信息
  for (let i = 0; i < world_names.length; i++) {
    let worldname = world_names[i];
    console.log("worldname",worldname)
    if(worldname.includes("声临其境")){{

      

      yin_xiao_world_info=await context.loadWorldInfo(worldname)

      console.log("yin_xiao_world_info",yin_xiao_world_info)

    }}

  }

  console.log("yin_xiao_world_info",yin_xiao_world_info)

  // 获取音效资源的第二个条目
  yin_xiao_zi_yuan=yin_xiao_world_info.entries[1]

  console.log("yin_xiao_zi_yuan",yin_xiao_zi_yuan)

  console.log("worldname",worldname)

  // 获取音效资源的内容字符串
  const yin_xiao_zi_yuan_string =yin_xiao_zi_yuan.content ;

  // 按行分割字符串
  const lines = yin_xiao_zi_yuan_string.split('\n');

  // 初始化对象数组
   audioArray = [];

  // 遍历每一行并分割键和值，构建音频资源数组
  lines.forEach(line => {
      const [key, url, uploader] = line.split('=');
      // 创建对象并推入数组
      if (key && url) {
        audioArray.push({ key: key.trim(), url: url.trim(), uploader: uploader ? uploader.trim() : 'N/A' });
      }
  });

}


/**
 * 搜索音效资源函数
 * @param {String} name - 要搜索的音效资源名称
 * @returns {String} 返回找到的音效资源URL，如果未找到则返回空字符串
 */
function search_yin_xiao_zi_yuan(name){
  
    // 输出结果
  console.log("audioArray",audioArray);

  // 查询示例
  const queryKey = name;
  const result = audioArray.find(item => item.key === queryKey);

  if (result) {
      console.log(`查询结果: ${result.key} => ${result.url}`);
      return result.url;
  } else {
      console.log("未找到该键");
      return "";
  }

}


// function loadJSZip() {
//   return new Promise((resolve, reject) => {
//     const script = document.createElement('script');
//     script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js";
//     script.onload = () => resolve();
//     script.onerror = (err) => reject(err);
//     document.head.appendChild(script);
//   });
// }

// // 使用方式
// loadJSZip();



// function loadcrypto() {
//   return new Promise((resolve, reject) => {
//     const script = document.createElement('script');
//     script.src = "https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js";
//     script.onload = () => resolve();
//     script.onerror = (err) => reject(err);
//     document.head.appendChild(script);
//   });
// }

// // 使用方式
// loadcrypto();


// 记录扩展的位置，名称应与仓库名称匹配
const extensionName = "st-immersive-sound";
const extensionFolderPath = `scripts/extensions/third-party/st-immersive-sound`;

// 在访问之前确保设置对象存在
extension_settings[extensionName] = extension_settings[extensionName] || {};

const extensionSettings = extension_settings[extensionName];


let token;
const defaultSettings = {
    enable_plugin: false,
    highlightColor: '#FFC800',
    highlightOpacity: 0.4,
    textColor: '#000000',
    readingSpeed: 600,
    enable3dAudio: false,
    musicFadeIn: 3,
    musicFadeOut: 2,
    ambianceFadeIn: 3,
    ambianceFadeOut: 2,
    sfxFadeIn: 0.1,
    sfxFadeOut: 0.1,
    masterVolume: 1,
    musicVolume: 1,
    ambianceVolume: 1,
    sfxVolume: 1,
    music_refDistance: 0.6,
    music_maxDistance: 20,
    music_rolloffFactor: 0.3,
    music_posX: 0,
    music_posY: 0,
    music_posZ: 0,
    ambiance_refDistance: 0.6,
    ambiance_maxDistance: 20,
    ambiance_rolloffFactor: 0.3,
    ambiance_posX: 0,
    ambiance_posY: 0,
    ambiance_posZ: 0,
    sfx_refDistance: 0.6,
    sfx_maxDistance: 20,
    sfx_rolloffFactor: 0.3,
    sfx_posX: 0,
    sfx_posY: 0,
    sfx_posZ: 0,
};


function GM_getValue(key,defaultValue){
  return extension_settings[extensionName][key]?extension_settings[extensionName][key]:defaultValue;
}

function GM_setValue(key,value){
  extension_settings[extensionName][key]=value;
}


function getRequestHeaders() {
  return {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
  };
}


/**
 * Gets the type of an extension based on its external ID.
 * @param {string} externalId External ID of the extension (excluding or including the leading 'third-party/')
 * @returns {string} Type of the extension (global, local, system, or empty string if not found)
 */
function getExtensionType(externalId) {
  const id = Object.keys(extensionTypes).find(
    // eslint-disable-next-line no-shadow
    (id) => id === externalId || (id.startsWith('third-party') && id.endsWith(externalId)),
  );
  return id ? extensionTypes[id] : 'local';
}


/**
 * 检查更新
 */
async function check_for_updates() {
  const global = getExtensionType(extensionName) === 'global' ? true : false;

  const reload = () => {
    toastr.success(`成功更新插件, 准备刷新页面以生效...`);
    console.log(`成功更新插件, 准备刷新页面以生效...`);
    setTimeout(() => location.reload(), 3000);
  };

  const update_response = await update_extension(extensionName, global);
  if (update_response.ok) {
    if ((await update_response.json()).isUpToDate) {
      toastr.success(`插件已是最新版本, 无需更新`);
      console.log(`插件已是最新版本, 无需更新`);
    } else {
      reload();
    }
    return true;
  }

  // const reinstall_response = await reinstall_extension(extensionName, global);
  // if (!reinstall_response.ok) {
  //   const text = await reinstall_response.text();
  //   toastr.error(text || reinstall_response.statusText, `更新插件失败`, { timeOut: 5000 });
  //   console.error(`更新插件失败: ${text}`);
  //   return false;
  // }

  // reload();
  // return true;
}

async function update_extension(extension_name, global) {
  const response = await fetch('/api/extensions/update', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ extensionName: extension_name, global }),
  });
  return response;
}

async function reinstall_extension(extension_name, global) {
  // 先卸载
  const response = await uninstall_extension(extension_name, global);
  if (!response.ok) {
    return response;
  }
  // 再安装
  return install_extension(extension_name, global);
}

async function uninstall_extension(extension_name, global) {
    const response = await fetch('/api/extensions/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ extensionName: extension_name, global }),
    });
    return response;
}

async function install_extension(url, global) {
  const response = await fetch('/api/extensions/install', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ url, global }),
  });
  return response;
}


// 如果扩展设置存在则加载，否则初始化为默认值
async function loadSettings() {
  // 将保存的设置与默认值合并
  Object.assign(extensionSettings, { ...defaultSettings, ...extensionSettings });

  console.log("设置被加载" , extensionSettings);

  // 在UI中更新设置
  $("#enable_plugin").prop("checked", extensionSettings.enable_plugin).trigger("input");

  const highlightColor = extension_settings[extensionName].highlightColor || '#FFC800';
  const highlightOpacity = extension_settings[extensionName].highlightOpacity ?? 0.4;
  const textColor = extension_settings[extensionName].textColor || '#000000';
  $("#highlightColor").val(highlightColor);
  $("#textColor").val(textColor);
  $("#highlightOpacity").val(highlightOpacity);
  $("#highlightOpacity_value").val(highlightOpacity);

  // Load reading speed settings
  const readingSpeed = extensionSettings.readingSpeed;
  $("#readingSpeed").val(readingSpeed);
  $("#readingSpeed_value").val(readingSpeed);

  // Load 3D audio settings
  is3dAudioEnabled = extensionSettings.enable3dAudio;
  $("#enable3dAudio").prop("checked", is3dAudioEnabled);

  // Load Fade settings
  const fadeTypes = ['music', 'ambiance', 'sfx'];
  fadeTypes.forEach(type => {
      const fadeInSetting = extensionSettings[`${type}FadeIn`];
      const fadeOutSetting = extensionSettings[`${type}FadeOut`];

      $(`#${type}FadeIn`).val(fadeInSetting);
      $(`#${type}FadeIn_value`).val(fadeInSetting);
      $(`#${type}FadeOut`).val(fadeOutSetting);
      $(`#${type}FadeOut_value`).val(fadeOutSetting);
  });

  loadPannerControls('music');
  loadPannerControls('ambiance');
  loadPannerControls('sfx');

  // Apply the loaded values to the panner nodes
  $('#music_refDistance, #music_maxDistance, #music_rolloffFactor, #music_posX, #music_posY, #music_posZ').trigger('input');
  $('#ambiance_refDistance, #ambiance_maxDistance, #ambiance_rolloffFactor, #ambiance_posX, #ambiance_posY, #ambiance_posZ').trigger('input');
  $('#sfx_refDistance, #sfx_maxDistance, #sfx_rolloffFactor, #sfx_posX, #sfx_posY, #sfx_posZ').trigger('input');

  // Load volume settings
  $('#masterVolume, #musicVolume, #ambianceVolume, #sfxVolume').trigger('input');
}

function stopAllAudio() {
    // Stop the reading marker
    if (marker) {
        marker.stop();
    }

    // Stop and clear all previously playing audio
    for (const key in playingList) {
        if (playingList.hasOwnProperty(key)) {
            const [source, gainNode, pannerNode] = playingList[key];
            if (source && source.mediaElement) {
                source.mediaElement.pause();
                source.mediaElement.src = ''; // Detach source
            }
            if (gainNode) {
                gainNode.disconnect();
            }
            if (pannerNode && pannerNode.numberOfOutputs > 0) {
                pannerNode.disconnect();
            }
        }
    }
    playingList = {};
    musicList = [];
    sourceisPlaying = {};
    console.log("All audio stopped and cleared.");
}

// 当UI中的扩展设置发生变化时调用此函数
function onEnablePluginInput(event) {
  const value = Boolean($(event.target).prop("checked"));
  extension_settings[extensionName].enable_plugin = value;
  console.log("设置被更改" );
  if (!value) {
    stopAllAudio();
  }
  saveSettingsDebounced();
}

// New functions for audio management

function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '未知';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'kb', 'mb', 'gb', 'tb'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    let size = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
    if (i === 0) {
        return size + ' Bytes';
    }
    return size + sizes[i];
}

async function renderAudioList(audioList) {
    const container = $('#audio_list_container');
    container.empty();

    if (!audioList || audioList.length === 0) {
        container.append('<p>没有找到音频文件。</p>');
        return;
    }

    const cachedAudioData = await getAllCachedAudio();
    const cachedUrls = new Map(cachedAudioData.map(item => [item.url, item]));

    const table = $('<table class="custom-table"></table>');
    table.append('<thead><tr><th>名称</th><th>大小</th><th>状态</th><th>上传者</th><th>播放</th><th>操作</th></tr></thead>');
    const tbody = $('<tbody></tbody>');

    for (const audio of audioList) {
        const cachedItem = cachedUrls.get(audio.url);
        const isCached = !!cachedItem;
        const uploader = audio.uploader || (cachedItem ? cachedItem.uploader : 'N/A');
        const size = isCached ? formatBytes(cachedItem.arrayBuffer.byteLength) : '未知';
        const row = $('<tr></tr>');
        row.append(`<td>${audio.key || audio.name}</td>`);
        row.append(`<td>${size}</td>`);
        row.append(`<td>${isCached ? '<span style="color: green;">已缓存</span>' : '未缓存'}</td>`);
        row.append(`<td>${uploader}</td>`);

        // Playback controls
        const playbackTd = $('<td></td>');
        playbackTd.append(`<button class="menu_button play-preview-button" data-url="${audio.url}" data-name="${audio.key || audio.name}" data-uploader="${uploader}"><i class="fa-solid fa-play"></i></button>`);
        playbackTd.append(`<button class="menu_button stop-preview-button" data-url="${audio.url}" style="display: none;"><i class="fa-solid fa-stop"></i></button>`);
        row.append(playbackTd);

        const actions = $('<td></td>');
        if (!isCached) {
            actions.append(`<button class="menu_button cache-single-button" data-url="${audio.url}" data-name="${audio.key || audio.name}" data-uploader="${audio.uploader || 'N/A'}">Cache</button>`);
        }
        actions.append(`<button class="menu_button danger_button clear-single-button" data-url="${audio.url}">Clear</button>`);
        row.append(actions);
        tbody.append(row);
    }

    table.append(tbody);
    container.append(table);
}


async function onLoadWorldAudioClick() {
    await get_yin_xiao_world_info();
    if (!audioArray || audioArray.length === 0) {
        toastr.info("世界书中没有找到音频。");
        return;
    }
    await renderAudioList(audioArray);
    toastr.success("已从世界书加载音频列表。");
}

async function onCacheAllWorldAudioClick() {
    await get_yin_xiao_world_info();

    if (!audioArray || audioArray.length === 0) {
        toastr.info("没有音频需要缓存。");
        return;
    }

    const cacheProgressContainer = $('#cache_progress_container');
    const cacheProgressBar = $('#cache_progress_bar');
    const cacheProgressLabel = $('#cache_progress_label');

    cacheProgressContainer.show();
    cacheProgressBar.val(0);
    cacheProgressLabel.text('0%');

    let cachedCount = 0;
    const totalCount = audioArray.length;

    for (const audio of audioArray) {
        try {
            await loadAudio(audio.url, audio.key, audio.uploader, { forceRefresh: true });
            cachedCount++;
            const progress = Math.round((cachedCount / totalCount) * 100);
            cacheProgressBar.val(progress);
            cacheProgressLabel.text(`${progress}%`);
        } catch (error) {
            console.error(`缓存失败 ${audio.url}:`, error);
            toastr.error(`缓存失败 ${audio.key}: ${error.message}`);
        }
    }

    toastr.success("所有世界书中的音频文件已缓存。");
    await onReloadAudioListClick();
    setTimeout(() => {
        cacheProgressContainer.hide();
    }, 2000);
}

async function onReloadAudioListClick() {
    const cachedAudio = await getAllCachedAudio();
    await renderAudioList(cachedAudio);
    toastr.success("音频列表已刷新。");
}

async function onDeleteAllCacheClick() {
    if (!confirm("确定要删除所有音频缓存吗？此操作不可逆。")) {
        return;
    }
    try {
        const db = await initDB();
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        await new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
        memoryCache.clear();
        toastr.success("所有音频缓存已删除。");
        await onReloadAudioListClick();
    } catch (error) {
        console.error("删除缓存失败:", error);
        toastr.error("删除缓存失败。");
    }
}

async function onCacheSingleClick(event) {
    const button = $(event.target);
    const url = button.data('url');
    const name = button.data('name');
    const uploader = button.data('uploader');
    try {
        button.text('Caching...').prop('disabled', true);
        await loadAudio(url, name, uploader, { forceRefresh: true });
        toastr.success(`Cached: ${name}`);
        await onReloadAudioListClick();
    } catch (error) {
        console.error(`Failed to cache ${url}:`, error);
        toastr.error(`Failed to cache ${name}: ${error.message}`);
        button.text('Cache').prop('disabled', false);
    }
}

async function onClearSingleClick(event) {
    const button = $(event.target);
    const url = button.data('url');
    try {
        button.prop('disabled', true);
        // Clear from DB
        const db = await initDB();
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        await new Promise((resolve, reject) => {
            const request = store.delete(url);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
        // Clear from memory
        memoryCache.delete(url);
        toastr.success(`已清除缓存`);
        await onReloadAudioListClick();
    } catch (error) {
        console.error(`清除缓存失败 ${url}:`, error);
        toastr.error(`清除缓存失败: ${error.message}`);
        button.prop('disabled', false);
    }
}

async function onPlayPreviewClick(event) {
    const button = $(event.currentTarget);
    const url = button.data('url');
    const name = button.data('name');
    const uploader = button.data('uploader');

    // Stop any currently playing preview
    if (previewAudio.source) {
        previewAudio.source.mediaElement.pause();
        previewAudio.source.disconnect();
        // Reset the UI for the previously playing button
        $(`.stop-preview-button[data-url="${previewAudio.url}"]`).hide();
        $(`.play-preview-button[data-url="${previewAudio.url}"]`).show();
    }

    try {
        const source = await loadAudio(url, name, uploader);
        if (!source) {
            toastr.error("无法加载音频进行预览。");
            return;
        }
        
        source.connect(masterGainNode); // Connect to master gain to respect volume settings
        getAudioContext().resume();
        source.mediaElement.play();

        previewAudio.source = source;
        previewAudio.url = url;

        // Update UI for the current button
        button.hide();
        button.siblings('.stop-preview-button').show();

        source.mediaElement.onended = () => {
            onStopPreviewClick(event); // Reuse stop logic
        };

    } catch (error) {
        console.error(`预览播放失败 ${url}:`, error);
        toastr.error(`预览播放失败 ${name}: ${error.message}`);
    }
}

function onStopPreviewClick(event) {
    const button = $(event.currentTarget);
    const url = button.data('url');

    if (previewAudio.source && previewAudio.url === url) {
        previewAudio.source.mediaElement.pause();
        previewAudio.source.disconnect();
        previewAudio.source = null;
        previewAudio.url = null;
    }

    // Update UI
    button.hide();
    button.siblings('.play-preview-button').show();
}


function loadPannerControls(type) {
    const settings = extension_settings[extensionName];
    let val;

    val = settings[`${type}_refDistance`] ?? 0.6;
    $(`#${type}_refDistance`).val(val);
    $(`#${type}_refDistance_value`).val(val);

    val = settings[`${type}_maxDistance`] ?? 20;
    $(`#${type}_maxDistance`).val(val);
    $(`#${type}_maxDistance_value`).val(val);

    val = settings[`${type}_rolloffFactor`] ?? 0.3;
    $(`#${type}_rolloffFactor`).val(val);
    $(`#${type}_rolloffFactor_value`).val(val);

    val = settings[`${type}_posX`] ?? 0;
    $(`#${type}_posX`).val(val);
    $(`#${type}_posX_value`).val(val);

    val = settings[`${type}_posY`] ?? 0;
    $(`#${type}_posY`).val(val);
    $(`#${type}_posY_value`).val(val);

    val = settings[`${type}_posZ`] ?? 0;
    $(`#${type}_posZ`).val(val);
    $(`#${type}_posZ_value`).val(val);
}

function setupPannerControls(type, pannerNode) {
    const settings = extension_settings[extensionName];
    const controls = ['refDistance', 'maxDistance', 'rolloffFactor', 'posX', 'posY', 'posZ'];

    const updatePanner = () => {
        const values = {};
        controls.forEach(control => {
            const value = parseFloat($(`#${type}_${control}`).val());
            values[control] = value;
            settings[`${type}_${control}`] = value;
        });

        if (pannerNode) {
            pannerNode.refDistance = values.refDistance;
            pannerNode.maxDistance = values.maxDistance;
            pannerNode.rolloffFactor = values.rolloffFactor;
            if(pannerNode.positionX) pannerNode.positionX.value = values.posX;
            if(pannerNode.positionY) pannerNode.positionY.value = values.posY;
            if(pannerNode.positionZ) pannerNode.positionZ.value = values.posZ;
        }
        
        saveSettingsDebounced();
    };

    controls.forEach(control => {
        const slider = $(`#${type}_${control}`);
        const numberInput = $(`#${type}_${control}_value`);

        slider.on('input', () => {
            numberInput.val(slider.val());
            updatePanner();
        });

        numberInput.on('input', () => {
            slider.val(numberInput.val());
            updatePanner();
        });
    });
}

function setupVolumeControl(type, gainNode) {
    const slider = $(`#${type}Volume`);
    const valueDisplay = $(`#${type}Volume_value`);
    const settings = extension_settings[extensionName];
    const settingName = `${type}Volume`;

    // Set initial value from settings
    const initialValue = settings[settingName] ?? 1;
    slider.val(initialValue);
    valueDisplay.val(parseFloat(initialValue).toFixed(2));
    if (gainNode) gainNode.gain.value = initialValue;

    const updateVolume = () => {
        const value = parseFloat(slider.val());
        if (gainNode) gainNode.gain.value = value;
        settings[settingName] = value;
        saveSettingsDebounced();
    };

    // Slider -> Number Input
    slider.on('input', () => {
        valueDisplay.val(parseFloat(slider.val()).toFixed(2));
        updateVolume();
    });

    // Number Input -> Slider
    valueDisplay.on('input', () => {
        slider.val(valueDisplay.val());
        updateVolume();
    });
}
// 当扩展加载时调用此函数
jQuery(async () => {
 // await Promise.all([loadcrypto(), loadJSZip()]);
 // console.log("crypto, and jszip loaded successfully");

  try {
    const tokenResponse = await fetch('/csrf-token');
    const data = await tokenResponse.json();
    token = data.token;
  } catch(err) {
    console.error('Initialization failed', err);
    throw new Error('Initialization failed');
  }


  // 这是从文件加载HTML的示例
  const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);

  // 将settingsHtml添加到extensions_settings
  // extension_settings和extensions_settings2是设置菜单的左右两列
  // 左侧应该是处理系统功能的扩展，右侧应该是与视觉/UI相关的扩展
  $("#extensions_settings").append(settingsHtml);

  // 这些是监听事件的示例
  $("#enable_plugin").on("input", onEnablePluginInput);
  $("#update_plugin_button").on("click", check_for_updates);
  // New audio management listeners
  $("#load_world_audio_button").on("click", onLoadWorldAudioClick);
  $("#cache_all_world_audio_button").on("click", onCacheAllWorldAudioClick);
  $("#reload_audio_list_button").on("click", onReloadAudioListClick);
  $("#delete_all_cache_button").on("click", onDeleteAllCacheClick);
  $('#audio_list_container').on('click', '.cache-single-button', onCacheSingleClick);
  $('#audio_list_container').on('click', '.clear-single-button', onClearSingleClick);
  $('#audio_list_container').on('click', '.play-preview-button', onPlayPreviewClick);
  $('#audio_list_container').on('click', '.stop-preview-button', onStopPreviewClick);

  // Highlight settings listeners
  $("#highlightColor").on("input", (event) => {
      extension_settings[extensionName].highlightColor = $(event.target).val();
      saveSettingsDebounced();
  });

  $("#textColor").on("input", (event) => {
      extension_settings[extensionName].textColor = $(event.target).val();
      saveSettingsDebounced();
  });

  $('#highlightOpacity').on('input', (event) => {
      const value = parseFloat($(event.target).val());
      $('#highlightOpacity_value').val(value.toFixed(1));
      extension_settings[extensionName].highlightOpacity = value;
      saveSettingsDebounced();
  });

  $('#highlightOpacity_value').on('input', (event) => {
      const value = parseFloat($(event.target).val());
      $('#highlightOpacity').val(value);
      extension_settings[extensionName].highlightOpacity = value;
      saveSettingsDebounced();
  });

  // Reading speed listeners
  $('#readingSpeed').on('input', (event) => {
      const value = parseInt($(event.target).val(), 10);
      $('#readingSpeed_value').val(value);
      extension_settings[extensionName].readingSpeed = value;
      saveSettingsDebounced();
  });

  $('#readingSpeed_value').on('input', (event) => {
      const value = parseInt($(event.target).val(), 10);
      $('#readingSpeed').val(value);
      extension_settings[extensionName].readingSpeed = value;
      saveSettingsDebounced();
  });

  // 3D Audio Listeners
  $('#enable3dAudio').on('input', (event) => {
      is3dAudioEnabled = $(event.target).prop('checked');
      extension_settings[extensionName].enable3dAudio = is3dAudioEnabled;
      saveSettingsDebounced();

      // Reroute existing audio
      for (const src in playingList) {
          if (playingList.hasOwnProperty(src)) {
              const [source, gainNode, pannerNode, volume, regex_end, regex, type] = playingList[src];

              // Disconnect the gainNode from its current path to avoid multiple paths
              gainNode.disconnect();
              // Also disconnect the panner to be safe
              if(pannerNode.numberOfOutputs > 0) pannerNode.disconnect();


              let typeGainNode;
              switch (type) {
                  case "Music":
                      typeGainNode = musicGainNode;
                      break;
                  case "Ambiance":
                      typeGainNode = ambianceGainNode;
                      break;
                  case "SFX":
                      typeGainNode = sfxGainNode;
                      break;
              }

              if (typeGainNode) {
                if (is3dAudioEnabled) {
                    gainNode.connect(pannerNode);
                    pannerNode.connect(typeGainNode);
                } else {
                    gainNode.connect(typeGainNode);
                }
              }
          }
      }
  });

  // Fade Controls Listeners
  const fadeTypes = ['music', 'ambiance', 'sfx'];
  fadeTypes.forEach(type => {
      $(`#${type}FadeIn`).on('input', (event) => {
          const value = parseFloat($(event.target).val());
          $(`#${type}FadeIn_value`).val(value.toFixed(1));
          extension_settings[extensionName][`${type}FadeIn`] = value;
          saveSettingsDebounced();
      });
      $(`#${type}FadeIn_value`).on('input', (event) => {
          const value = parseFloat($(event.target).val());
          $(`#${type}FadeIn`).val(value);
          extension_settings[extensionName][`${type}FadeIn`] = value;
          saveSettingsDebounced();
      });
      $(`#${type}FadeOut`).on('input', (event) => {
          const value = parseFloat($(event.target).val());
          $(`#${type}FadeOut_value`).val(value.toFixed(1));
          extension_settings[extensionName][`${type}FadeOut`] = value;
          saveSettingsDebounced();
      });
      $(`#${type}FadeOut_value`).on('input', (event) => {
          const value = parseFloat($(event.target).val());
          $(`#${type}FadeOut`).val(value);
          extension_settings[extensionName][`${type}FadeOut`] = value;
          saveSettingsDebounced();
      });
  });

  initAudio(); // Ensure audio nodes exist before setting up controls

  // Setup volume controls
  setupVolumeControl('master', masterGainNode);
  setupVolumeControl('music', musicGainNode);
  setupVolumeControl('ambiance', ambianceGainNode);
  setupVolumeControl('sfx', sfxGainNode);

  // Setup 3D panner controls
  setupPannerControls('music', pannerNode_Music);
  setupPannerControls('ambiance', pannerNode_Ambiance);
  setupPannerControls('sfx', pannerNode_SFX);

  // 启动时加载设置（如果有的话）
  loadSettings();
  const audioPlayer = document.getElementById('audioPlayer') ;
  document.getElementById('stopButton').addEventListener('click', () => {
    stopAllAudio();
  });

  // Load initial audio list from DB
  onReloadAudioListClick();
});


// 每隔两秒检查一次
const intervalId = setInterval(() => p_addEventListener(), 2000);


function  p_addEventListener() {
  let ps = document.getElementsByClassName("mes_text");
  for (let i = 0; i < ps.length; i++) {
    let p = ps[i];
    let mesid=p.parentNode.parentNode.getAttribute("mesid");
    p.dataset.mesid=mesid;

    if (!p.hasyinxiao == true) {
      p.hasyinxiao = true;
      p.addEventListener("click",async function(event) {
          // 获取点击的目标元素


          let head=getRequestHeaders()

          console.log("点击了元素：", head);

          const targetElement = event.target;
          let thisMesid = event.currentTarget.dataset.mesid;
  
          // 检查目标元素是否是可用的文本节点
          if (targetElement.nodeType === Node.ELEMENT_NODE) {
              
              if (event.detail === 2) { // 二击触发
                  if (!extension_settings[extensionName].enable_plugin) {
                    console.log("声临其境 plugin is disabled.");
                    return;
                  }

                  // If clicking the same element that is currently playing, stop it.
                  if (marker && marker.isPlaying && marker.element === event.currentTarget) {
                      stopAllAudio();
                      marker = null;
                      return;
                  }
                  
                  // 停止之前的阅读（如果有的话）
                  if (window.currentReadingInterval) {
                      clearInterval(window.currentReadingInterval);
                      // 清除之前的高亮
                      document.querySelectorAll('.reading-highlight').forEach(span => {
                          const parent = span.parentNode;
                          parent.replaceChild(document.createTextNode(span.textContent), span);
                          parent.normalize();
                      });
                  }
                  //重置播放
                  sourceisPlaying={}

  
                  // 找到包含的父元素 mes_text
                  let mesTextElement = targetElement;
                  while (mesTextElement && !mesTextElement.classList.contains('mes_text')) {
                      mesTextElement = mesTextElement.parentNode;
                  }
  
                  // 如果没有找到 mes_text，返回
                  if (!mesTextElement) return;
                  if(marker){
                    marker.stop(); 
                  }

                  // 获取整个 mes_text 的文本内容
                  const fullMesText = mesTextElement.textContent;
                  let  RegexExtensionSettings= await getRegexExtensionSettings();
                  
                  //获取BGM
                  const mestest=context.chat[thisMesid].mes;
                  let bgmlist=parseBGMContent(mestest);

                  for (const key in bgmlist) {
                    if (Object.hasOwnProperty.call(bgmlist, key)) {
                      const bgmCategory = bgmlist[key];
                      for (let i = 0; i < bgmCategory.length; i++) {
                        let bgm = bgmCategory[i];
                        for (let j = 0; j < RegexExtensionSettings.length; j++) {
                          if (bgm.regex_start) {
                            bgm.regex_start = bgm.regex_start.replace(RegexExtensionSettings[j].findRegex, RegexExtensionSettings[j].replaceString);
                          }
                          if (bgm.regex_end) {
                            bgm.regex_end = bgm.regex_end.replace(RegexExtensionSettings[j].findRegex, RegexExtensionSettings[j].replaceString);
                          }
                          if (bgm.regex) {
                            bgm.regex = bgm.regex.replace(RegexExtensionSettings[j].findRegex, RegexExtensionSettings[j].replaceString);
                          }
                        }
                      }
                    }
                  }

                  console.log("bgmlist:",bgmlist);

                  //更新世界书
                  await get_yin_xiao_world_info()

                  // Stop and clear all previously playing audio
                  for (const key in playingList) {
                      if (playingList.hasOwnProperty(key)) {
                          const [source, gainNode, pannerNode] = playingList[key];
                          if (source && source.mediaElement) {
                              source.mediaElement.pause();
                          }
                          if (gainNode) {
                              gainNode.disconnect();
                          }
                          if (pannerNode && pannerNode.numberOfOutputs > 0) {
                              pannerNode.disconnect();
                          }
                      }
                  }
                  playingList = {};
                  musicList=[];

                  //创建音乐列表
                  if(bgmlist){ 
                    const categories = ["Music", "Ambiance", "SFX"];
                    for (const category of categories) {
                        if(bgmlist.hasOwnProperty(category)){ 
                            for(let i=0; i<bgmlist[category].length; i++){
                                let music = {};
                                const bgmItem = bgmlist[category][i];
                                if(bgmItem.loop === true){ 
                                    let re = getParagraphOffsetsRange(fullMesText, bgmItem.regex_start, bgmItem.regex_end);
                                    if(re === -1){
                                        // Error is shown in getParagraphOffsetsRange, just log and skip.
                                        console.log(`Skipping looped audio due to invalid/missing start/end markers for ${category}:`, bgmItem);
                                        return ;
                                    }
                                    music.regex_start = re[0];
                                    music.regex_end = re[1];
                                } else { 
                                    if (!bgmItem.regex) {
                                        const errorMsg = `无效的 regex 触发词: "${bgmItem.regex}"`;
                                        console.log(errorMsg);
                                        toastr.error(errorMsg);
                                        continue;
                                    }
                                    music.regex = fullMesText.indexOf(bgmItem.regex);
                                    if (music.regex === -1) {
                                        const errorMsg = `未在文本中找到 regex 触发词: "${bgmItem.regex}"`;
                                        console.log(errorMsg);
                                        toastr.error(errorMsg);
                                        continue;
                                    }
                                }
                            
                                music.src = bgmItem.src;
                                music.volume = bgmItem.volume;
                                music.loop = bgmItem.loop;
                                music.type = category;

                                let url = search_yin_xiao_zi_yuan(bgmItem.src);
                                if(url !== ""){
                                    music.url = url;
                                } else {
                                    console.log(`未找到音乐文件：${bgmItem.src}`);
                                    continue;
                                }
                                musicList.push(music);
                            }
                        }
                    }
                  }

                  console.log("musicList", musicList);

                  // Ensure all audios are cached before starting playback.
                  await ensureAudiosAreCached(musicList);

                  // --- Start CharacterReadingMarker after caching ---
                  const selection = window.getSelection();
                  const startNode = selection.anchorNode;
                  const startOffset = selection.anchorOffset;

                  // Get highlight settings
                  const colorHex = extension_settings[extensionName].highlightColor || '#FFC800';
                  const opacity = extension_settings[extensionName].highlightOpacity ?? 0.4;

                  // Convert hex to RGB
                  const r = parseInt(colorHex.slice(1, 3), 16);
                  const g = parseInt(colorHex.slice(3, 5), 16);
                  const b = parseInt(colorHex.slice(5, 7), 16);
                  
                  const highlightColorRgba = `rgba(${r}, ${g}, ${b}, ${opacity})`;

                  marker = new CharacterReadingMarker(
                    mesTextElement,
                    {
                      cpm: extension_settings[extensionName].readingSpeed || 600,
                      highlightColor: highlightColorRgba,
                      textColor: extension_settings[extensionName].textColor || '#000000',
                      hideBorder: true,
                      skipSpaces: false,
                      pulseAnimation: true,
                      showStats: false,
                      debug: false,
                      startNode: startNode,
                      startOffset: startOffset,
                      onComplete: () => {
                        console.log('阅读完成！');
                      }
                    }
                  );

                  console.log("marker", marker);
                  marker.start();
              }
          }
      });
  }

}

}

function getParagraphOffsetsRange(fullText, paragraph1, paragraph2) {
  // 检查输入是否有效，不允许空字符串
  if (!paragraph1 || !paragraph2) {
      toastr.error(`起始或结束段落无效或为空。起始: "${paragraph1}", 结束: "${paragraph2}"`);
      return -1;
  }

  // 查找段落1在全文中的开始位置
  const startOffset = fullText.indexOf(paragraph1);


  
  
  // 如果段落1不在全文中，返回 -1
  if (startOffset === -1) {
      toastr.error(`未在文本中找到起始段落: "${paragraph1}"`);
      return -1;
  }
  
  // 从段落1结束位置之后开始查找段落2
  const searchStartPosition = startOffset + paragraph1.length;
  const paragraph2StartOffset = fullText.indexOf(paragraph2, searchStartPosition);

  console.log("paragraph2StartOffset", paragraph2StartOffset,paragraph2);
  
  // 如果段落2不在段落1之后，返回 -1
  if (paragraph2StartOffset === -1) {
      toastr.error(`未在起始段落后找到结束段落: "${paragraph2}"`);
      return -1;
  }
  
  // 计算段落2的结束位置（开始位置 + 段落长度）
  const endOffset = paragraph2StartOffset + paragraph2.length;
  
  // 返回范围偏移量
  return [startOffset, endOffset];
}



function parseBGMContent(bgmText) {
  // 提取各个部分的内容
  const musicMatch = bgmText.match(/<Music>([\s\S]*?)<\/Music>/);
  const ambianceMatch = bgmText.match(/<Ambiance>([\s\S]*?)<\/Ambiance>/);
  const sfxMatch = bgmText.match(/<SFX>([\s\S]*?)<\/SFX>/);
  
  // 解析单个音频项的函数
  function parseAudioItem(itemText) {
      const params = {};
      
      // 提取 src
      const srcMatch = itemText.match(/src=([^,\s\]]+)/);
      if (srcMatch) params.src = srcMatch[1];
      
      // 提取 volume
      const volumeMatch = itemText.match(/volume=(\d+)/);
      if (volumeMatch) params.volume = parseInt(volumeMatch[1]);
      
      // 提取 loop
      const loopMatch = itemText.match(/loop[=:](\w+)/);
      if (loopMatch) params.loop = loopMatch[1] === 'true';
      
      // 提取 regex_start
      const regexStartMatch = itemText.match(/regex_start=\/(.*?)\//);
      if (regexStartMatch) params.regex_start = regexStartMatch[1];
      
      // 提取 regex_end
      const regexEndMatch = itemText.match(/regex_end=\/(.*?)\//);
      if (regexEndMatch) params.regex_end = regexEndMatch[1];
      
      // 提取 regex (单独的regex参数)
      const regexMatch = itemText.match(/regex[=:]\/(.*?)\//);
      if (regexMatch) params.regex = regexMatch[1];
      
      return params;
  }
  
  // 解析多个音频项的函数
  function parseMultipleItems(text) {
      if (!text) return [];
      
      // 匹配所有 [...] 格式的项
      const itemMatches = text.match(/\[[^\]]+\]/g);
      if (!itemMatches) return [];
      
      return itemMatches.map(item => parseAudioItem(item));
  }
  
  // 构建结果对象
  const result = {
      Music: [],
      Ambiance: [],
      SFX: []
  };
  
  // 解析各部分
  if (musicMatch) {
      result.Music = parseMultipleItems(musicMatch[1]);
  }
  
  if (ambianceMatch) {
      result.Ambiance = parseMultipleItems(ambianceMatch[1]);
  }
  
  if (sfxMatch) {
      result.SFX = parseMultipleItems(sfxMatch[1]);
  }
  
  return result;
}



async function initDB() {
    return new Promise((resolve, reject) => {
        // Bump the version to 3 to trigger onupgradeneeded for adding uploader
        const request = indexedDB.open(dbName, 3);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            let store;
            if (!db.objectStoreNames.contains(storeName)) {
                store = db.createObjectStore(storeName, { keyPath: 'url' });
            } else {
                store = event.target.transaction.objectStore(storeName);
            }
            
            if (!store.indexNames.contains('timestamp')) {
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
            // Add a new index for the name
            if (!store.indexNames.contains('name')) {
                store.createIndex('name', 'name', { unique: false });
            }
            // Add a new index for the uploader
            if (!store.indexNames.contains('uploader')) {
                store.createIndex('uploader', 'uploader', { unique: false });
            }
        };
    });
}

async function loadAudio(url, name, uploader = 'N/A', options = {}) {
    const { forceRefresh = false, maxAge = 7 * 24 * 60 * 60 * 1000 } = options;

    // Helper to create the audio source node from a URL (streaming or blob)
    function createSourceNode(audioUrl) {
        const audio = new Audio(audioUrl);
        const context = getAudioContext();
        const source = context.createMediaElementSource(audio);
        return source;
    }

    // Helper to cache the audio in the background
    async function cacheInBackground(url, name, uploader) {
        // Avoid re-caching if it's already in memory
        if (memoryCache.has(url)) return;

        try {
            console.log(`Background caching started for: ${url}`);
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            // Save to both caches
            await saveToDB(url, name, uploader, arrayBuffer.slice(0));
            memoryCache.set(url, arrayBuffer.slice(0));
            console.log(`Successfully cached in background: ${url}`);
        } catch (error) {
            console.error(`Background caching failed for ${url}:`, error);
        }
    }

    // 1. Check caches first for offline/repeat playback.
    if (!forceRefresh) {
        // Check memory cache (fastest)
        if (memoryCache.has(url)) {
            console.log(`Playing from memory cache: ${url}`);
            const arrayBuffer = memoryCache.get(url);
            const blob = new Blob([arrayBuffer], { type: 'audio/mp3' });
            return createSourceNode(URL.createObjectURL(blob));
        }

        // Check IndexedDB (slower, but persistent)
        try {
            const cached = await getFromDB(url);
            if (cached && (Date.now() - cached.timestamp < maxAge)) {
                console.log(`Playing from IndexedDB cache: ${url}`);
                const arrayBuffer = cached.arrayBuffer;
                memoryCache.set(url, arrayBuffer.slice(0)); // Promote to memory cache
                const blob = new Blob([arrayBuffer], { type: 'audio/mp3' });
                return createSourceNode(URL.createObjectURL(blob));
            }
        } catch (error) {
            console.error(`Failed to get from IndexedDB, will stream from network: ${url}`, error);
        }
    }

    // 2. If not in cache (or forced refresh), stream from network for immediate playback.
    console.log(`Streaming from network and caching in background: ${url}`);
    
    // Start caching in the background, but don't wait for it to finish.
    cacheInBackground(url, name, uploader);

    // Immediately return a source node that streams directly from the original URL.
    return createSourceNode(url);
}

async function  getFromDB(url) {
  const db = await initDB();
  const transaction = db.transaction([storeName], 'readonly');
  const store = transaction.objectStore(storeName);
  
  return new Promise((resolve, reject) => {
      const request = store.get(url);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
  });
}

async function saveToDB(url, name, uploader, arrayBuffer) {
    const db = await initDB();
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
        const request = store.put({
            url: url,
            name: name,
            uploader: uploader,
            arrayBuffer: arrayBuffer,
            timestamp: Date.now()
        });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// 清理过期缓存
async function  cleanupCache(maxAge = 1000) {// 7 * 24 * 60 * 60 * 1000
  const db = await initDB();
  const transaction = db.transaction([storeName], 'readwrite');
  const store = transaction.objectStore(storeName);
  const index = store.index('timestamp');
  const cutoffTime = Date.now() - maxAge;
  const range = IDBKeyRange.upperBound(cutoffTime);
  
  const request = index.openCursor(range);
  request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
      }
  };
}

// 获取缓存大小
async function  getCacheSize() {
  const db = await initDB();
  const transaction = db.transaction([storeName], 'readonly');
  const store = transaction.objectStore(storeName);
  let totalSize = 0;

  return new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
              totalSize += cursor.value.arrayBuffer.byteLength;
              cursor.continue();
          } else {
              resolve(totalSize);
          }
      };
      request.onerror = () => reject(request.error);
  });
}

async function getAllCachedAudio() {
    const db = await initDB();
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function ensureAudiosAreCached(musicList) {
    const uncachedAudios = [];
    const checkPromises = musicList.map(async (music) => {
        if (memoryCache.has(music.url)) return;
        const cached = await getFromDB(music.url);
        if (!cached) {
            uncachedAudios.push(music);
        }
    });
    await Promise.all(checkPromises);

    if (uncachedAudios.length === 0) {
        console.log("All required audio is already cached.");
        return;
    }

    const totalCount = uncachedAudios.length;
    let downloadedCount = 0;
    let allSucceeded = true;

    const toastrInfo = toastr.info(`开始下载 ${totalCount} 个音频... (0/${totalCount})`, "缓存音频", { timeOut: 0, extendedTimeOut: 0, "progressBar": true });

    const downloadPromises = uncachedAudios.map(music => 
        (async () => {
            try {
                const response = await fetch(music.url);
                if (!response.ok) throw new Error(`HTTP 错误! status: ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                await saveToDB(music.url, music.src, music.uploader || 'N/A', arrayBuffer.slice(0));
                memoryCache.set(music.url, arrayBuffer.slice(0));
            } catch (error) {
                allSucceeded = false;
                console.error(`缓存失败 ${music.src} from ${music.url}:`, error);
                toastr.error(`缓存失败: ${music.src}`);
            } finally {
                downloadedCount++;
                const progress = Math.round((downloadedCount / totalCount) * 100);
                if (toastrInfo) {
                    $(toastrInfo).find('.toast-message').text(`正在下载 ${totalCount} 个音频... (${downloadedCount}/${totalCount})`);
                    $(toastrInfo).find('.progress').css('width', progress + '%');
                }
            }
        })()
    );

    await Promise.all(downloadPromises);

    if (toastrInfo) toastr.clear(toastrInfo);

    if (allSucceeded) {
        toastr.success(`成功缓存 ${totalCount} 个音频文件。`);
    } else {
        toastr.warning(`部分音频下载失败，请检查控制台。`);
    }
}



function playWithFadeIn(gainNode,audioElement,fadeInDuration = 1) {

  const now =getAudioContext().currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(1, now + fadeInDuration);
  audioElement.play();

}


    // 带淡出的暂停
function pauseWithFadeOut(gainNode,audioElement,fadeOutDuration = 1) {

  const now =getAudioContext().currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(0, now + fadeOutDuration);

  console.log("gainNode暂停",gainNode)
      
  setTimeout(() => {
          audioElement.pause();
      }, fadeOutDuration * 1000);
}


async function playList(currentGlobalCharIndex) { 

   
  let index=0

  for (let i = index; i < musicList.length; i++) { 

        let music = musicList[i];
 
        if(!playingList.hasOwnProperty(music.src)&&((music.regex_start<=currentGlobalCharIndex&&music.regex_end>=currentGlobalCharIndex)||music.regex==currentGlobalCharIndex)){

        playingList[music.src]=[];

        let source = await loadAudio(music.url, music.src);

        if (!source) {
            console.error("Failed to load audio source for " + music.src);
            continue; // Skip to the next music item
        }


        source.mediaElement.loop = music.loop;

        const gainNode = getAudioContext().createGain();

        gainNode.gain.value =music.volume/100;

        console.log("gainNode",gainNode)

        source.connect(gainNode);

        if(music.type=="Music"){

          if (is3dAudioEnabled) {
            gainNode.connect(pannerNode_Music);
            pannerNode_Music.connect(musicGainNode);
          } else {
            gainNode.connect(musicGainNode);
          }

          const cursrc=music.src;

          sourceisPlaying[cursrc]=false;

          source.mediaElement.onended = () => {
            sourceisPlaying[cursrc]=false;
          };

          getAudioContext().resume();
          // 设置静音播放。
          const fadeIn = extension_settings[extensionName].musicFadeIn ?? 3;
          playWithFadeIn(gainNode,source.mediaElement, fadeIn);
  
          playingList[music.src]=[source,gainNode,pannerNode_Music,music.volume,music.regex_end,music.regex,music.type];
  
          console.log("playingList",playingList)

        }

        if(music.type=="Ambiance"){

          if (is3dAudioEnabled) {
            gainNode.connect(pannerNode_Ambiance);
            pannerNode_Ambiance.connect(ambianceGainNode);
          } else {
            gainNode.connect(ambianceGainNode);
          }

          const cursrc=music.src;

          sourceisPlaying[cursrc]=false;

          source.mediaElement.onended = () => {
            sourceisPlaying[cursrc]=false;
          };


          getAudioContext().resume();
          // 设置静音播放。
          const fadeIn = extension_settings[extensionName].ambianceFadeIn ?? 3;
          playWithFadeIn(gainNode,source.mediaElement, fadeIn);
  
          playingList[music.src]=[source,gainNode,pannerNode_Ambiance,music.volume,music.regex_end,music.regex,music.type];
  
          console.log("playingList",playingList)

        }

        if(music.type=="SFX"){

          if (is3dAudioEnabled) {
            gainNode.connect(pannerNode_SFX);
            pannerNode_SFX.connect(sfxGainNode);
          } else {
            gainNode.connect(sfxGainNode);
          }


          getAudioContext().resume();
          // 设置静音播放。
          const fadeIn = extension_settings[extensionName].sfxFadeIn ?? 0.1;
          playWithFadeIn(gainNode,source.mediaElement, fadeIn);

          const cursrc=music.src;

          sourceisPlaying[cursrc]=false;

          source.mediaElement.onended = () => {
            sourceisPlaying[cursrc]=false;
          };
  
          playingList[music.src]=[source,gainNode,pannerNode_SFX,music.volume,music.regex_end,music.regex,music.type];
  
          console.log("playingList",playingList)

        }

}

  }
  
  for (let key in playingList) {
    if (playingList.hasOwnProperty(key)) {
        // 处理 playingList[key]
        let item=playingList[key];

        if(sourceisPlaying[key]){
          console.log(key+"播放结束");


          console.log("item",item)
          

          if(item[6]=="Music"){
            console.log("item",item)
            const fadeOut = extension_settings[extensionName].musicFadeOut ?? 2;
            pauseWithFadeOut(item[1],item[0].mediaElement, fadeOut);
          }
          if(item[6]=="Ambiance"){
            console.log("item",item)
            const fadeOut = extension_settings[extensionName].ambianceFadeOut ?? 2;
            pauseWithFadeOut(item[1],item[0].mediaElement, fadeOut);
          }
          if(item[6]=="SFX"){
            console.log("item",item)
            const fadeOut = extension_settings[extensionName].sfxFadeOut ?? 0.1;
            pauseWithFadeOut(item[1],item[0].mediaElement, fadeOut);
          }
          delete playingList[key];
        }

        if(item[4]&&item[4]<currentGlobalCharIndex){
          console.log(key+"播放结束");

          console.log("item",item)

          if(item[6]=="Music"){
            console.log("item",item)
            const fadeOut = extension_settings[extensionName].musicFadeOut ?? 2;
            pauseWithFadeOut(item[1],item[0].mediaElement, fadeOut);
          }
          if(item[6]=="Ambiance"){
            console.log("item",item)
            const fadeOut = extension_settings[extensionName].ambianceFadeOut ?? 2;
            pauseWithFadeOut(item[1],item[0].mediaElement, fadeOut);
          }
          if(item[6]=="SFX"){
            console.log("item",item)
            const fadeOut = extension_settings[extensionName].sfxFadeOut ?? 0.1;
            pauseWithFadeOut(item[1],item[0].mediaElement, fadeOut);
          }
          delete playingList[key];
        }
    }
}
  
}
class CharacterReadingMarker {
  constructor(element, options = {}) {
    this.element = element;
    this.options = {
      charactersPerMinute: options.cpm || 600,
      highlightColor: options.highlightColor || 'rgba(255, 255, 0, 0.5)',
      textColor: options.textColor || '#ff0000',
      skipSpaces: options.skipSpaces !== false,
      showStats: options.showStats !== false,
      debug: options.debug !== false,
      startNode: options.startNode || null,
      startOffset: options.startOffset || 0,
      onComplete: options.onComplete || (() => {}),
    };
    
    this.isSupported = CSS.highlights && typeof Highlight !== 'undefined';
    if (!this.isSupported) {
        console.warn("CSS Custom Highlight API not supported. Reading marker will not function.");
    }

    this.delay = 60000 / this.options.charactersPerMinute;
    this.currentIndex = 0;
    this.startingIndex = 0;
    this.charPositions = [];
    this.isPlaying = false;
    this.animationFrameId = null;
    this.highlight = null;
    this.timePaused = 0;
    
    // 调试相关
    this.textContentString = '';
    this.traversedString = '';
    this.debugInfo = [];
    
    this.init();
  }

  init() {
    this.addStyles();
    if (this.isSupported) {
        if (!CSS.highlights.has('reading-highlight')) {
            CSS.highlights.set('reading-highlight', new Highlight());
        }
        this.highlight = CSS.highlights.get('reading-highlight');
    }
    
    if (this.options.debug) {
      this.createDebugPanel();
    }
    if (this.options.showStats) {
        this.createProgressIndicator();
    }
  }

  createDebugPanel() {
    this.debugPanel = document.createElement('div');
    this.debugPanel.id = 'debug-panel';
    this.debugPanel.style.cssText = `
      position: fixed;
      top: 60px;
      right: 10px;
      width: 400px;
      max-height: 500px;
      background: rgba(0, 0, 0, 0.9);
      color: #00ff00;
      padding: 15px;
      border-radius: 8px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      z-index: 10004;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0, 255, 0, 0.3);
    `;
    
    this.debugPanel.innerHTML = `
      <h3 style="margin: 0 0 10px 0; color: #00ff00; border-bottom: 1px solid #00ff00; padding-bottom: 5px;">
        🔍 调试信息
      </h3>
      <div id="debug-content"></div>
    `;
    
    document.body.appendChild(this.debugPanel);
  }

  collectCharacterPositions() {
    this.textContentString = this.element.textContent;
    this.charPositions = [];
    this.startingIndex = 0;

    if (this.options.debug) {
        this.traversedString = '';
        this.debugInfo = [];
    }

    const walker = document.createTreeWalker(
      this.element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let globalCharIndex = 0;
    let foundStart = !this.options.startNode;
    let nodeIndex = 0;
    let node;

    while (node = walker.nextNode()) {
        const text = node.textContent;

        if (this.options.debug) {
            this.debugInfo.push({
                nodeIndex: nodeIndex,
                parentTag: node.parentNode.tagName,
                text: text,
                length: text.length,
                startIndex: globalCharIndex
            });
        }

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (this.options.debug) {
                this.traversedString += char;
            }

            if (!foundStart && node === this.options.startNode && i === this.options.startOffset) {
                this.startingIndex = this.charPositions.length;
                foundStart = true;
            }

            if (this.options.skipSpaces && /\s/.test(char)) {
                globalCharIndex++;
                continue;
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

  performDebugValidation() {
    const debugContent = document.getElementById('debug-content');
    if (!debugContent) return;
    
    let html = '';
    
    // 1. 基本信息对比
    html += `
      <div style="margin-bottom: 15px;">
        <h4 style="color: #ffff00;">📊 基本信息</h4>
        <div>textContent 长度: <span style="color: #fff;">${this.textContentString.length}</span></div>
        <div>遍历文本长度: <span style="color: #fff;">${this.traversedString.length}</span></div>
        <div>收集的字符数: <span style="color: #fff;">${this.charPositions.length}</span></div>
        <div>是否相同: <span style="color: ${this.textContentString === this.traversedString ? '#00ff00' : '#ff0000'};">
          ${this.textContentString === this.traversedString ? '✅ 相同' : '❌ 不同'}
        </span></div>
      </div>
    `;
    
    // 2. 字符对比（前100个）
    html += `
      <div style="margin-bottom: 15px;">
        <h4 style="color: #ffff00;">🔤 字符对比（前50个）</h4>
        <div style="display: grid; grid-template-columns: auto 1fr 1fr 1fr; gap: 5px; font-size: 11px;">
          <div style="color: #888;">索引</div>
          <div style="color: #888;">textContent</div>
          <div style="color: #888;">遍历所得</div>
          <div style="color: #888;">状态</div>
    `;
    
    for (let i = 0; i < Math.min(50, Math.max(this.textContentString.length, this.traversedString.length)); i++) {
      const tcChar = this.textContentString[i] || '❌';
      const trChar = this.traversedString[i] || '❌';
      const isMatch = tcChar === trChar;
      
      const displayTc = this.escapeChar(tcChar);
      const displayTr = this.escapeChar(trChar);
      
      html += `
        <div style="color: #aaa;">${i}</div>
        <div style="color: ${isMatch ? '#fff' : '#ff6666'};">${displayTc}</div>
        <div style="color: ${isMatch ? '#fff' : '#ff6666'};">${displayTr}</div>
        <div>${isMatch ? '✅' : '❌'}</div>
      `;
    }
    html += `</div></div>`;
    
    // 3. 文本节点详情
    html += `
      <div style="margin-bottom: 15px;">
        <h4 style="color: #ffff00;">📝 文本节点详情</h4>
        <div style="max-height: 150px; overflow-y: auto; background: rgba(255,255,255,0.05); padding: 5px; border-radius: 4px;">
    `;
    
    this.debugInfo.forEach((info, index) => {
      html += `
        <div style="margin-bottom: 5px; padding: 3px; border-left: 2px solid #00ff00;">
          <div style="color: #00ff00;">节点 #${info.nodeIndex} (${info.parentTag})</div>
          <div style="color: #aaa; font-size: 10px;">
            起始索引: ${info.startIndex} | 长度: ${info.length}
          </div>
          <div style="color: #fff; word-break: break-all;">
            "${this.escapeChar(info.text.substring(0, 50))}${info.text.length > 50 ? '...' : ''}"
          </div>
        </div>
      `;
    });
    
    html += `</div></div>`;
    
    // 4. 当前字符信息（动态更新）
    html += `
      <div id="current-char-info" style="margin-bottom: 15px;">
        <h4 style="color: #ffff00;">▶️ 当前字符</h4>
        <div id="current-char-details" style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px;">
          等待开始...
        </div>
      </div>
    `;
    
    debugContent.innerHTML = html;
  }

  escapeChar(char) {
    if (char === ' ') return '[空格]';
    if (char === '\n') return '[换行]';
    if (char === '\t') return '[制表]';
    if (char === '\r') return '[回车]';
    if (char === '❌') return '[无]';
    return char;
  }

  updateCurrentCharDebug() {
    if (!this.options.debug) return;
    
    const currentCharDetails = document.getElementById('current-char-details');
    if (!currentCharDetails) return;
    
    if (this.currentIndex >= this.charPositions.length) {
      currentCharDetails.innerHTML = '✅ 阅读完成';
      return;
    }
    
    const charInfo = this.charPositions[this.currentIndex];
    const tcChar = this.textContentString[charInfo.globalIndex];
    const isMatch = charInfo.char === tcChar;
    
    const pos = this.getCharacterPosition(this.currentIndex);
    
    currentCharDetails.innerHTML = `
      <div style="display: grid; grid-template-columns: 120px 1fr; gap: 5px;">
        <div style="color: #888;">全局索引:</div>
        <div style="color: #fff;">${charInfo.globalIndex}</div>
        
        <div style="color: #888;">当前字符:</div>
        <div style="color: #fff; font-size: 18px; font-weight: bold;">
          "${this.escapeChar(charInfo.char)}"
        </div>
        
        <div style="color: #888;">textContent[${charInfo.globalIndex}]:</div>
        <div style="color: ${isMatch ? '#00ff00' : '#ff0000'}; font-size: 18px; font-weight: bold;">
          "${this.escapeChar(tcChar || '❌')}"
        </div>
        
        <div style="color: #888;">匹配状态:</div>
        <div style="color: ${isMatch ? '#00ff00' : '#ff0000'};">
          ${isMatch ? '✅ 匹配' : '❌ 不匹配'}
        </div>
        
        <div style="color: #888;">父元素:</div>
        <div style="color: #fff;"><${charInfo.parentTag.toLowerCase()}></div>
        
        <div style="color: #888;">节点索引:</div>
        <div style="color: #fff;">#${charInfo.nodeIndex}</div>
        
        <div style="color: #888;">屏幕位置:</div>
        <div style="color: #fff;">
          ${pos ? `(${pos.left.toFixed(0)}, ${pos.top.toFixed(0)})` : '不可见'}
        </div>
        
        <div style="color: #888;">可见状态:</div>
        <div style="color: ${pos && pos.visible ? '#00ff00' : '#ff9900'};">
          ${pos && pos.visible ? '✅ 可见' : '⚠️ 不可见'}
        </div>
      </div>
    `;
    
    if (!isMatch) {
      console.warn(`字符不匹配 at index ${charInfo.globalIndex}:`, {
        expected: tcChar,
        actual: charInfo.char,
        charInfo: charInfo
      });
    }
  }

  animationLoop(timestamp) {
    if (!this.isPlaying) return;

    const elapsedTime = timestamp - this.startTime;
    const expectedCharArrIndex = this.startingIndex + Math.floor(elapsedTime / this.delay);

    if (expectedCharArrIndex >= this.charPositions.length) {
        this.stop();
        if (this.options.onComplete) {
            this.options.onComplete();
        }
        return;
    }

    if (expectedCharArrIndex > this.currentIndex) {
        this.currentIndex = expectedCharArrIndex;
        
        if (this.isSupported) {
            this.highlight.clear();
            const currentCharData = this.charPositions[this.currentIndex];
            if (currentCharData) {
                const { node, offset } = currentCharData;
                const range = document.createRange();
                range.setStart(node, offset);
                range.setEnd(node, offset + 1);
                this.highlight.add(range);
                playList(currentCharData.globalIndex);
            }
        }
        
        this.updateCurrentCharDebug();
        this.updateProgress();
    }

    this.animationFrameId = requestAnimationFrame(this.animationLoop.bind(this));
  }

  validateTextConsistency() {
    console.group('📊 文本一致性验证');
    
    const isEqual = this.textContentString === this.traversedString;
    
    console.log('textContent:', this.textContentString);
    console.log('遍历所得:', this.traversedString);
    console.log('长度对比:', {
      textContent: this.textContentString.length,
      traversed: this.traversedString.length,
      difference: Math.abs(this.textContentString.length - this.traversedString.length)
    });
    
    if (!isEqual) {
      console.warn('⚠️ 文本不一致！');
      
      for (let i = 0; i < Math.max(this.textContentString.length, this.traversedString.length); i++) {
        if (this.textContentString[i] !== this.traversedString[i]) {
          console.error(`第一个不同位置: index ${i}`);
          console.error(`textContent[${i}]: "${this.escapeChar(this.textContentString[i] || '❌')}"`);
          console.error(`traversed[${i}]: "${this.escapeChar(this.traversedString[i] || '❌')}"`);
          break;
        }
      }
    } else {
      console.log('✅ 文本完全一致！');
    }
    
    console.groupEnd();
    
    return isEqual;
  }

  getCharacterPosition(index) {
    if (index < 0 || index >= this.charPositions.length) return null;
    
    const charData = this.charPositions[index];
    const { node, offset, char } = charData;

    if (!document.body.contains(node) || node.textContent.length <= offset) {
        return null;
    }

    const range = document.createRange();
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

  isCharacterVisible(rect) {
    const buffer = 50;
    return rect.top >= -buffer && 
           rect.bottom <= window.innerHeight + buffer &&
           rect.left >= -buffer && 
           rect.right <= window.innerWidth + buffer &&
           rect.width > 0 && 
           rect.height > 0;
  }

  createProgressIndicator() {
    this.progressBar = document.createElement('div');
    this.progressBar.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 0%;
      height: 3px;
      background: linear-gradient(90deg, #4CAF50, #8BC34A);
      z-index: 10002;
      transition: width 0.2s ease;
    `;
    document.body.appendChild(this.progressBar);

    this.statsDisplay = document.createElement('div');
    this.statsDisplay.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 12px;
      border-radius: 20px;
      font-size: 12px;
      z-index: 10002;
      font-family: monospace;
    `;
    document.body.appendChild(this.statsDisplay);
  }

  updateProgress() {
    if (!this.options.showStats) return;
    
    const progress = (this.currentIndex / this.charPositions.length) * 100;
    this.progressBar.style.width = `${progress}%`;
    
    const current = this.charPositions[this.currentIndex];
    const pos = this.getCharacterPosition(this.currentIndex);
    
    this.statsDisplay.innerHTML = `
      字符: ${this.currentIndex + 1}/${this.charPositions.length}<br>
      当前: "${current ? current.char : ''}"<br>
      进度: ${progress.toFixed(1)}%<br>
      状态: ${pos && pos.visible ? '✅ 可见' : '❌ 不可见'}
    `;
  }

  start() {
    if (!this.isSupported) return;
    if (this.isPlaying) this.stop();
    
    this.isPlaying = true;
    this.collectCharacterPositions();
    this.currentIndex = this.startingIndex || 0;
    
    if (this.options.debug) {
      this.validateTextConsistency();
      this.performDebugValidation();
    }
    
    this.startTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this.animationLoop.bind(this));

    console.log(`开始逐字阅读，速度: ${this.options.charactersPerMinute} 字/分钟`);
  }

  addStyles() {
    let style = document.getElementById('char-reading-styles');
    if (!style) {
        style = document.createElement('style');
        style.id = 'char-reading-styles';
        document.head.appendChild(style);
    }
    this.styleSheet = style.sheet;

    // Clear existing rules
    while (this.styleSheet.cssRules.length > 0) {
        this.styleSheet.deleteRule(0);
    }

    // Add new rule for CSS Custom Highlights
    const rule = `
      ::highlight(reading-highlight) {
        background-color: ${this.options.highlightColor};
        color: ${this.options.textColor};
      }
    `;
    this.styleSheet.insertRule(rule, 0);
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
    if (!this.isSupported) return;
    if (!this.isPlaying && this.currentIndex < this.charPositions.length) {
        this.isPlaying = true;
        this.startTime += (performance.now() - this.timePaused);
        this.animationFrameId = requestAnimationFrame(this.animationLoop.bind(this));
    }
  }

  stop() {
    if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = null;
    this.isPlaying = false;

    if (this.isSupported && this.highlight) {
        this.highlight.clear();
    }

    this.currentIndex = 0;
    if (this.options.showStats) {
        this.updateProgress();
    }
  }

  setSpeed(charactersPerMinute) {
    this.options.charactersPerMinute = charactersPerMinute;
    this.delay = 60000 / charactersPerMinute;
    
    if (this.isPlaying) {
      this.pause();
      this.resume();
    }
  }

  destroy() {
    this.stop();
    if (this.isSupported) {
        CSS.highlights.delete('reading-highlight');
    }
    const style = document.getElementById('char-reading-styles');
    if (style) style.remove();
    if (this.progressBar) this.progressBar.remove();
    if (this.statsDisplay) this.statsDisplay.remove();
    if (this.debugPanel) this.debugPanel.remove();
  }
}


async function getRegexExtensionSettings() {
  const settings = context.extensionSettings["regex"];
  const regex = [];

  if (!settings) {
    return [];
  }

  for (let i = 0; i < settings.length; i++) {
    const setting = settings[i];

    if (setting.disabled) continue;

    if (!setting.markdownOnly) continue;

    const findRegexString = setting.findRegex;
    const replaceString = setting.replaceString;

    if (!findRegexString) continue;

    // Updated logic to parse regex string with flags
    const match = findRegexString.match(/^\/(.*)\/([gimuy]*)$/);
    let re;

    try {
      if (match) {
        // It's in /pattern/flags format
        const pattern = match[1];
        const flags = match[2];
        re = new RegExp(pattern, flags);
      } else {
        // It's just a pattern string, no delimiters
        re = new RegExp(findRegexString);
      }
      regex.push({ findRegex: re, replaceString: replaceString });
    } catch (e) {
      console.error(`Invalid regular expression: "${findRegexString}".`, e);
    }
  }

  return regex;
}

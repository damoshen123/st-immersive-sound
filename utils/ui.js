import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName, extensionFolderPath, defaultSettings } from "./config.js";
import { get_yin_xiao_world_info, audioArray } from "./world-info.js";
import { loadAudio, getAllCachedAudio, initDB, memoryCache, storeName} from "./audio-cache.js";
import {audioCtx, masterGainNode,getAudioContext, musicGainNode, ambianceGainNode, sfxGainNode, sfx_waitGainNode, pannerNode_Music, pannerNode_Ambiance, pannerNode_SFX, pannerNode_SFX_WAIT } from "./audio-context.js";
import { stopAllAudio, playingList } from "./playback.js";
import { extensionName as immersiveSoundExtensionName } from './config.js';

let previewAudio = {
    source: null,
    url: null
};

function onEnablePluginInput(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[immersiveSoundExtensionName].enable_plugin = value;
    console.log("设置被更改");
    if (!value) {
        stopAllAudio();
    }
    saveSettingsDebounced();
}

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
        const volume=audio.volume/100 || 1;
        const size = isCached ? formatBytes(cachedItem.arrayBuffer.byteLength) : '未知';
        const row = $('<tr></tr>');
        row.append(`<td>${audio.key || audio.name}</td>`);
        row.append(`<td>${size}</td>`);
        row.append(`<td>${isCached ? '<span style="color: green;">已缓存</span>' : '未缓存'}</td>`);
        row.append(`<td>${uploader}</td>`);

        // Playback controls
        const playbackTd = $('<td></td>');
        playbackTd.append(`<button class="menu_button play-preview-button" data-url="${audio.url}" data-name="${audio.key || audio.name}" data-volume=${volume} data-uploader="${uploader}"><i class="fa-solid fa-play"></i></button>`);
        playbackTd.append(`<button class="menu_button stop-preview-button" data-url="${audio.url}" style="display: none;"><i class="fa-solid fa-stop"></i></button>`);
        row.append(playbackTd);

        const actions = $('<td></td>');
        if (!isCached) {
            actions.append(`<button class="menu_button cache-single-button" data-url="${audio.url}" data-name="${audio.key || audio.name}" data-uploader="${audio.uploader || 'N/A'}" data-volume="${volume}>Cache</button>`);
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
    const volume = button.data('volume');

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
        const gainNode = getAudioContext().createGain();
        gainNode.gain.value =masterGainNode.gain.value*volume;
        console.log("gainNode.gain.value", gainNode.gain.value);
        source.connect(gainNode); // Connect to master gain to respect volume settings
        gainNode.connect(getAudioContext().destination)
        getAudioContext().resume();
        source.mediaElement.play();

        previewAudio.source = source;
        previewAudio.url = url;
        previewAudio.gainNode=gainNode;

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
        previewAudio.gainNode.disconnect();
        previewAudio.url = null;
    }

    // Update UI
    button.hide();
    button.siblings('.play-preview-button').show();
}

function loadPannerControls(type) {
    const settings = extension_settings[immersiveSoundExtensionName];
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
    const settings = extension_settings[immersiveSoundExtensionName];
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
    const settings = extension_settings[immersiveSoundExtensionName];
    const settingName = `${type}Volume`;

    // Set initial value from settings
    const initialValue = settings[settingName] ?? 1;
    slider.val(initialValue);
    valueDisplay.val(parseFloat(initialValue).toFixed(2));
    if (gainNode) gainNode.gain.value = initialValue;

    let oldValue = initialValue;

    const updateVolume = () => {
        const newValue = parseFloat(slider.val());

        // Update the main gain node for future sounds
        if (gainNode) {
            gainNode.gain.value = newValue;
        }

        // Adjust volume for currently playing tracks
        for (const src in playingList) {
            if (playingList.hasOwnProperty(src)) {
                const track = playingList[src];
                const trackGainNode = track[1];
                const trackType = track[6]; // 'Music', 'Ambiance', etc.
                const baseVolume = track[3] / 100; // music.volume

                const isMaster = (type === 'master');
                const isMatchingType = (trackType && trackType.toLowerCase() === type);

                if (isMaster || isMatchingType) {
                    const currentGain = trackGainNode.gain.value;
                    let newGain;

                    if (oldValue !== 0) {
                        newGain = (currentGain / oldValue) * newValue;
                    } else {
                        // Recalculate from scratch if old value was 0
                        const masterVolume = settings['masterVolume'];
                        let typeVolume;
                        switch(trackType) {
                            case 'Music': typeVolume = settings['musicVolume']; break;
                            case 'Ambiance': typeVolume = settings['ambianceVolume']; break;
                            case 'SFX': typeVolume = settings['sfxVolume']; break;
                            case 'SFX_WAIT': typeVolume = settings['sfx_waitVolume']; break;
                            default: typeVolume = 1;
                        }

                        if (isMaster) {
                            // Master slider is changing. `typeVolume` is the old value from settings.
                            newGain = baseVolume * newValue * typeVolume;
                        } else { // isMatchingType
                            // Type slider is changing. `masterVolume` is the old value from settings.
                            newGain = baseVolume * masterVolume * newValue;
                        }
                    }
                    // Ensure gain is not negative
                    trackGainNode.gain.value = Math.max(0, newGain);
                }
            }
        }

        // Save settings and update oldValue for the next change
        settings[settingName] = newValue;
        saveSettingsDebounced();
        oldValue = newValue;
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

async function loadSettings(apply = true) {
    // 将保存的设置与默认值合并
    const mergedSettings = { ...JSON.parse(JSON.stringify(defaultSettings)), ...extension_settings[immersiveSoundExtensionName] };
    Object.assign(extension_settings[immersiveSoundExtensionName], mergedSettings);
    const settings = extension_settings[immersiveSoundExtensionName];

    console.log("设置被加载", settings);

    // 在UI中更新设置
    $("#enable_plugin").prop("checked", settings.enable_plugin);

    const highlightColor = settings.highlightColor || '#FFC800';
    const highlightOpacity = settings.highlightOpacity ?? 0.4;
    const textColor = settings.textColor || '#000000';
    $("#highlightColor").val(highlightColor);
    $("#textColor").val(textColor);
    $("#highlightOpacity").val(highlightOpacity);
    $("#highlightOpacity_value").val(highlightOpacity);

    // Load reading speed settings
    const readingSpeed = settings.readingSpeed;
    $("#readingSpeed").val(readingSpeed);
    $("#readingSpeed_value").val(readingSpeed);

    // Load auxiliary settings
    $("#musicStartsWithParagraph").prop("checked", settings.musicStartsWithParagraph);
    $("#seamlessMusic").prop("checked", settings.seamlessMusic);
    $("#regexReplace").prop("checked", settings.regexReplace);

    // Load 3D audio settings
    $("#enable3dAudio_music").prop("checked", settings.enable3dAudio_music);
    $("#enable3dAudio_ambiance").prop("checked", settings.enable3dAudio_ambiance);
    $("#enable3dAudio_sfx").prop("checked", settings.enable3dAudio_sfx);
    $("#enable3dAudio_sfx_wait").prop("checked", settings.enable3dAudio_sfx_wait);

    // Load Fade settings
    const fadeTypes = ['music', 'ambiance', 'sfx', 'sfx_wait'];
    fadeTypes.forEach(type => {
        const fadeInSetting = settings[`${type}FadeIn`];
        const fadeOutSetting = settings[`${type}FadeOut`];

        $(`#${type}FadeIn`).val(fadeInSetting);
        $(`#${type}FadeIn_value`).val(fadeInSetting);
        $(`#${type}FadeOut`).val(fadeOutSetting);
        $(`#${type}FadeOut_value`).val(fadeOutSetting);
    });

    loadPannerControls('music');
    loadPannerControls('ambiance');
    loadPannerControls('sfx');
    loadPannerControls('sfx_wait');

    // Load volume settings
    const volumeTypes = ['master', 'music', 'ambiance', 'sfx', 'sfx_wait'];
    volumeTypes.forEach(type => {
        const volume = settings[`${type}Volume`];
        $(`#${type}Volume`).val(volume);
        $(`#${type}Volume_value`).val(volume);
    });

    if (apply) {
        // Apply the loaded values to the audio nodes directly
        const pannerTypes = ['music', 'ambiance', 'sfx', 'sfx_wait'];
        pannerTypes.forEach(type => {
            const pannerNode = getPannerNode(type);
            if (pannerNode) {
                pannerNode.refDistance = settings[`${type}_refDistance`];
                pannerNode.maxDistance = settings[`${type}_maxDistance`];
                pannerNode.rolloffFactor = settings[`${type}_rolloffFactor`];
                if(pannerNode.positionX) pannerNode.positionX.value = settings[`${type}_posX`];
                if(pannerNode.positionY) pannerNode.positionY.value = settings[`${type}_posY`];
                if(pannerNode.positionZ) pannerNode.positionZ.value = settings[`${type}_posZ`];
            }
        });

        masterGainNode.gain.value = settings.masterVolume;
        musicGainNode.gain.value = settings.musicVolume;
        ambianceGainNode.gain.value = settings.ambianceVolume;
        sfxGainNode.gain.value = settings.sfxVolume;
        sfx_waitGainNode.gain.value = settings.sfx_waitVolume;
    }
}

function getPannerNode(type) {
    switch (type) {
        case 'music': return pannerNode_Music;
        case 'ambiance': return pannerNode_Ambiance;
        case 'sfx': return pannerNode_SFX;
        case 'sfx_wait': return pannerNode_SFX_WAIT;
        default: return null;
    }
}

function onRestoreDefaultSettingsClick() {
    if (confirm("你确定要恢复默认设置吗？")) {
        // 使用深拷贝以确保`defaultSettings`不会被意外修改
        extension_settings[immersiveSoundExtensionName] = JSON.parse(JSON.stringify(defaultSettings));
        saveSettingsDebounced();
        loadSettings(true); // Pass true to apply settings immediately
        toastr.success("已恢复默认设置。");
    }
}

function onExportSettingsClick() {
    const settingsString = JSON.stringify(extension_settings[immersiveSoundExtensionName], null, 4);
    const blob = new Blob([settingsString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${extensionName}_settings.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toastr.success("设置已导出。");
}

function onImportSettingsClick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedSettings = JSON.parse(e.target.result);
                    // 合并导入的设置，而不是完全替换
                    Object.assign(extension_settings[immersiveSoundExtensionName], importedSettings);
                    saveSettingsDebounced();
                    loadSettings(true); // Pass true to apply settings immediately
                    toastr.success("设置已导入。");
                } catch (error) {
                    toastr.error("导入设置失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

export async function initUI() {
    const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
    $("#extensions_settings").append(settingsHtml);

    // These are listening events
    $("#enable_plugin").on("input", onEnablePluginInput);
    $("#restore_default_settings_button").on("click", onRestoreDefaultSettingsClick);
    $("#export_settings_button").on("click", onExportSettingsClick);
    $("#import_settings_button").on("click", onImportSettingsClick);

    // About modal listeners
    const aboutModal = document.getElementById('about_modal_stis');
    const aboutBtn = document.getElementById('about_button');
    const aboutCloseBtn = document.getElementById('about_modal_close_stis');

    aboutBtn.onclick = function() {
        aboutModal.style.display = "block";
    }
    aboutCloseBtn.onclick = function() {
        aboutModal.style.display = "none";
    }
    window.onclick = function(event) {
        if (event.target == aboutModal) {
            aboutModal.style.display = "none";
        }
    }
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
        extension_settings[immersiveSoundExtensionName].highlightColor = $(event.target).val();
        saveSettingsDebounced();
    });

    $("#textColor").on("input", (event) => {
        extension_settings[immersiveSoundExtensionName].textColor = $(event.target).val();
        saveSettingsDebounced();
    });

    $('#highlightOpacity').on('input', (event) => {
        const value = parseFloat($(event.target).val());
        $('#highlightOpacity_value').val(value.toFixed(1));
        extension_settings[immersiveSoundExtensionName].highlightOpacity = value;
        saveSettingsDebounced();
    });

    $('#highlightOpacity_value').on('input', (event) => {
        const value = parseFloat($(event.target).val());
        $('#highlightOpacity').val(value);
        extension_settings[immersiveSoundExtensionName].highlightOpacity = value;
        saveSettingsDebounced();
    });

    // Reading speed listeners
    $('#readingSpeed').on('input', (event) => {
        const value = parseInt($(event.target).val(), 10);
        $('#readingSpeed_value').val(value);
        extension_settings[immersiveSoundExtensionName].readingSpeed = value;
        saveSettingsDebounced();
    });

    $('#readingSpeed_value').on('input', (event) => {
        const value = parseInt($(event.target).val(), 10);
        $('#readingSpeed').val(value);
        extension_settings[immersiveSoundExtensionName].readingSpeed = value;
        saveSettingsDebounced();
    });

    // Auxiliary settings listeners
    $('#musicStartsWithParagraph').on('input', (event) => {
        extension_settings[immersiveSoundExtensionName].musicStartsWithParagraph = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#seamlessMusic').on('input', (event) => {
        extension_settings[immersiveSoundExtensionName].seamlessMusic = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#regexReplace').on('input', (event) => {
        extension_settings[immersiveSoundExtensionName].regexReplace = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    // 3D Audio Listeners
    function setup3dAudioToggle(type) {
        const checkbox = $(`#enable3dAudio_${type}`);
        const settingName = `enable3dAudio_${type}`;

        checkbox.on('input', (event) => {
            const isEnabled = $(event.target).prop('checked');
            extension_settings[immersiveSoundExtensionName][settingName] = isEnabled;
            saveSettingsDebounced();

            // Reroute existing audio of this type
            for (const src in playingList) {
                if (playingList.hasOwnProperty(src)) {
                    const [source, gainNode, pannerNode, volume, regex_end, regex, audioType] = playingList[src];
                    
                    if (audioType.toLowerCase() === type) {
                        // Disconnect everything after the individual gainNode
                        gainNode.disconnect();
                        if (pannerNode) {
                            pannerNode.disconnect();
                        }

                        // Reconnect based on the new 3D setting
                        if (isEnabled) {
                            gainNode.connect(pannerNode);
                            pannerNode.connect(getAudioContext().destination);
                        } else {
                            gainNode.connect(getAudioContext().destination);
                        }
                    }
                }
            }
        });
    }

    setup3dAudioToggle('music');
    setup3dAudioToggle('ambiance');
    setup3dAudioToggle('sfx');
    setup3dAudioToggle('sfx_wait');

    // Fade Controls Listeners
    const fadeTypes = ['music', 'ambiance', 'sfx', 'sfx_wait'];
    fadeTypes.forEach(type => {
        $(`#${type}FadeIn`).on('input', (event) => {
            const value = parseFloat($(event.target).val());
            $(`#${type}FadeIn_value`).val(value.toFixed(1));
            extension_settings[immersiveSoundExtensionName][`${type}FadeIn`] = value;
            saveSettingsDebounced();
        });
        $(`#${type}FadeIn_value`).on('input', (event) => {
            const value = parseFloat($(event.target).val());
            $(`#${type}FadeIn`).val(value);
            extension_settings[immersiveSoundExtensionName][`${type}FadeIn`] = value;
            saveSettingsDebounced();
        });
        $(`#${type}FadeOut`).on('input', (event) => {
            const value = parseFloat($(event.target).val());
            $(`#${type}FadeOut_value`).val(value.toFixed(1));
            extension_settings[immersiveSoundExtensionName][`${type}FadeOut`] = value;
            saveSettingsDebounced();
        });
        $(`#${type}FadeOut_value`).on('input', (event) => {
            const value = parseFloat($(event.target).val());
            $(`#${type}FadeOut`).val(value);
            extension_settings[immersiveSoundExtensionName][`${type}FadeOut`] = value;
            saveSettingsDebounced();
        });
    });

    // Setup volume controls
    setupVolumeControl('master', masterGainNode);
    setupVolumeControl('music', musicGainNode);
    setupVolumeControl('ambiance', ambianceGainNode);
    setupVolumeControl('sfx', sfxGainNode);
    setupVolumeControl('sfx_wait', sfx_waitGainNode);

    // Setup 3D panner controls
    setupPannerControls('music', pannerNode_Music);
    setupPannerControls('ambiance', pannerNode_Ambiance);
    setupPannerControls('sfx', pannerNode_SFX);
    setupPannerControls('sfx_wait', pannerNode_SFX_WAIT);

    // 启动时加载设置（如果有的话）
    loadSettings();
    document.getElementById('stopButton').addEventListener('click', () => {
        stopAllAudio(window.marker);
    });

    // Load initial audio list from DB
    onReloadAudioListClick();
}

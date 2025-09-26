import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName, extensionFolderPath, defaultSettings } from "./config.js";
import { get_yin_xiao_world_info, audioArray, yin_xiao_world_name, char_world_name, worldEntries, updateWorldbookEntrie, addWorldbookEntrie, deleteWorldbookEntrie } from "./world-info.js";
import { loadAudio, getAllCachedAudio, initDB, memoryCache, storeName} from "./audio-cache.js";
import {audioCtx, masterGainNode,getAudioContext, musicGainNode, ambianceGainNode, sfxGainNode, sfx_waitGainNode, voiceGainNode, pannerNode_Music, pannerNode_Ambiance, pannerNode_SFX, pannerNode_SFX_WAIT, pannerNode_VOICE } from "./audio-context.js";
import { stopAllAudio, playingList, stopAudioByKey, startVolumeAnalysis } from "./playback.js";
import { extensionName as immersiveSoundExtensionName } from './config.js';

let isPreviewLoading = false;
let vibrationTestTimeout = null;
let previewVibrationTimeout = null;

function parseVibrationValue(valueString, defaultValue) {
    if (valueString === undefined || valueString === null) {
        return defaultValue;
    }
    valueString = String(valueString).trim();
    if (valueString.startsWith('[') && valueString.endsWith(']')) {
        try {
            const arr = JSON.parse(valueString);
            if (Array.isArray(arr) && arr.every(item => typeof item === 'number')) {
                return arr;
            }
        } catch (e) {
            console.warn(`Could not parse vibration value as array: ${valueString}`, e);
        }
    }
    const num = parseInt(valueString, 10);
    if (!isNaN(num)) {
        return num;
    }
    return defaultValue;
}
let currentDisplayList = []; // The unfiltered list currently shown in the UI
let isWorldBookDirty = false;

function showWorldBookWarning() {
    $('#st-is-world-book-warning').show();
    isWorldBookDirty = true;
    toastr.info('世界书已修改，请刷新页面以使更改生效。');
}

async function applyAudioListFilter() {
    const searchTerm = ($('#ac-search-input').val() || '').toLowerCase();
    if (!currentDisplayList) {
        await renderAudioList([]);
        return;
    }

    const filteredList = currentDisplayList.filter(audio => {
        const key = (audio.key || audio.name || '').toLowerCase();
        return key.includes(searchTerm);
    });
    await renderAudioList(filteredList);
}

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
    const container = $('#ac-audio-list-container');
    container.empty();

    if (!audioList || audioList.length === 0) {
        container.append('<p>没有找到音频文件。</p>');
        return;
    }

    const cachedAudioData = await getAllCachedAudio();
    const cachedUrls = new Map(cachedAudioData.map(item => [item.url, item]));

    for (const audio of audioList) {
        const cachedItem = cachedUrls.get(audio.url);
        const isCached = !!cachedItem;
        const uploader = audio.uploader || (cachedItem ? cachedItem.uploader : 'N/A');
        const volume = audio.volume || (cachedItem ? cachedItem.volume : 100);
        const vibration = audio.vibration || (cachedItem ? cachedItem.vibration : 'N/A');
        const size = isCached ? formatBytes(cachedItem.arrayBuffer.byteLength) : '未知';
        const displayVolume = volume / 100;

        const item = $(`
            <div class="audio-item ${isCached ? 'status-cached' : 'status-uncached'}">
                <div class="audio-item-info">
                    <div class="audio-item-main">
                        <span class="audio-name editable" data-field="key"></span>
                        <span class="audio-size"></span>
                    </div>
                    <div class="audio-item-details">
                        <span>上传者: <span class="editable" data-field="uploader"></span></span>
                        <span>音量: <span class="editable" data-field="volume"></span></span>
                        <span>震动: <span class="editable" data-field="vibration"></span></span>
                    </div>
                    <div class="audio-item-url">
                        <span>URL: <span class="editable" data-field="url"></span></span>
                    </div>
                </div>
                <div class="audio-item-actions">
                </div>
            </div>
        `);

        item.data('audio', audio);
        item.find('.audio-name').text(audio.key || audio.name);
        item.find('.audio-size').text(size);
        item.find('.editable[data-field="uploader"]').text(uploader);
        item.find('.editable[data-field="volume"]').text(volume);
        item.find('.editable[data-field="vibration"]').text(vibration);
        item.find('.editable[data-field="url"]').text(audio.url);

        const actions = item.find('.audio-item-actions');
        actions.append(`<button class="action-button play-preview-button" title="播放" data-url="${audio.url}" data-name="${audio.key || audio.name}" data-volume=${displayVolume} data-uploader="${uploader}" vibration="${vibration}"><i class="fa-solid fa-play"></i></button>`);
        actions.append(`<button class="action-button stop-preview-button" title="停止" data-url="${audio.url}" style="display: none;"><i class="fa-solid fa-stop"></i></button>`);

        if (isCached) {
            actions.append(`<button class="action-button danger clear-single-button" title="清除" data-url="${audio.url}"><i class="fa-solid fa-trash"></i></button>`);
        } else {
            actions.append(`<button class="action-button cache-single-button" title="缓存" data-url="${audio.url}" data-name="${audio.key || audio.name}" data-uploader="${audio.uploader || 'N/A'}" data-volume="${volume}" data-vibration="${vibration}"><i class="fa-solid fa-download"></i></button>`);
        }
        
        // Add the new delete button for world book entries
        if (audio.yin_xiao_world_name || audio.char_world_name) {
            actions.append(`<button class="action-button danger delete-entry-button" title="从世界书删除条目"><i class="fa-solid fa-book-skull"></i></button>`);
        }

        container.append(item);
    }
}

async function onLoadWorldAudioClick() {
    await get_yin_xiao_world_info();

    const worldBookSelector = $('#st-is-world-book-selector');
    const worldBookSelect = $('#st-is-world-book-select');

    worldBookSelect.empty();
    worldBookSelect.append('<option value="">--请选择一个世界书--</option>');

    const availableWorlds = new Set();
    if (char_world_name) {
        availableWorlds.add(char_world_name);
    }
    if (yin_xiao_world_name) {
        availableWorlds.add(yin_xiao_world_name);
    }

    availableWorlds.forEach(worldName => {
        worldBookSelect.append(`<option value="${worldName}">${worldName}</option>`);
    });

    if (availableWorlds.size > 0) {
        worldBookSelector.show();
        toastr.success("世界书列表已加载。");
    } else {
        toastr.warning("没有找到可用的世界书。");
        worldBookSelector.hide();
    }
    
    $('#ac-audio-list-container').empty();
}

function onWorldBookSelectChange() {
    const selectedWorld = $(this).val();
    const newAudioButton = $('#ac-new-audio-button');

    if (!selectedWorld) {
        currentDisplayList = [];
        $('#ac-audio-list-container').empty();
        newAudioButton.hide();
        return;
    }

    newAudioButton.show();

    const filteredAudio = audioArray.filter(audio => 
        audio.yin_xiao_world_name === selectedWorld || audio.char_world_name === selectedWorld
    );

    if (filteredAudio.length === 0) {
        toastr.info(`在 "${selectedWorld}" 中没有找到音频。`);
    }

    currentDisplayList = filteredAudio;
    applyAudioListFilter();
}

async function onCacheAllWorldAudioClick() {
    await get_yin_xiao_world_info();

    if (!audioArray || audioArray.length === 0) {
        toastr.info("没有音频需要缓存。");
        return;
    }

    const cacheProgressContainer = $('#ac-cache-progress-container');
    const cacheProgressBar = $('#ac-cache-progress-bar');
    const cacheProgressLabel = $('#ac-cache-progress-label');

    cacheProgressContainer.show();
    cacheProgressBar.val(0);
    cacheProgressLabel.text('0%');

    let cachedCount = 0;
    let failedCount = 0;
    const totalCount = audioArray.length;

    for (let i = 0; i < totalCount; i++) {
        const audio = audioArray[i];
        try {
            await loadAudio(audio.url, audio.key, audio.uploader, audio.volume, audio.vibration, { forceRefresh: true });
            cachedCount++;
        } catch (error) {
            failedCount++;
            console.error(`缓存失败 ${audio.url}:`, error);
            toastr.error(`缓存失败 ${audio.key}: ${error.message}`);
        }
        const progress = Math.round(((i + 1) / totalCount) * 100);
        cacheProgressBar.val(progress);
        cacheProgressLabel.text(`${progress}%`);
    }

    if (failedCount > 0 && cachedCount > 0) {
        toastr.warning(`缓存完成，${cachedCount} 个成功，${failedCount} 个失败。`);
    } else if (failedCount > 0 && cachedCount === 0) {
        toastr.error(`所有 ${failedCount} 个音频均缓存失败。`);
    } else if (failedCount === 0 && cachedCount > 0) {
        toastr.success(`所有 ${cachedCount} 个音频文件已成功缓存。`);
    } else { // cachedCount === 0 && failedCount === 0
        toastr.info("没有新的音频需要缓存。");
    }

    if (cachedCount > 0) {
        await onReloadAudioListClick();
    }

    setTimeout(() => {
        cacheProgressContainer.hide();
    }, 2000);
}

async function onReloadAudioListClick() {
    const cachedAudio = await getAllCachedAudio();
    if (cachedAudio.length === 0) {
        toastr.info("没有找到已缓存的音频。");
    } else {
        toastr.success("已缓存的音频列表已刷新。");
    }
    currentDisplayList = cachedAudio;
    await applyAudioListFilter();
    $('#st-is-world-book-selector').hide();
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
    const button = $(event.currentTarget);
    const item = button.closest('.audio-item');
    const url = item.find('.editable[data-field="url"]').text();
    const name = item.find('.editable[data-field="key"]').text();
    const uploader = item.find('.editable[data-field="uploader"]').text();
    const volume = item.find('.editable[data-field="volume"]').text();
    const vibration = item.find('.editable[data-field="vibration"]').text();
    try {
        button.html('<i class="fa-solid fa-spinner fa-spin"></i>').prop('disabled', true);
        await loadAudio(url, name, uploader, volume, vibration, { forceRefresh: true });
        toastr.success(`已缓存: ${name}`);

        const db = await initDB();
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const cachedItem = await new Promise((resolve, reject) => {
            const request = store.get(url);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const item = button.closest('.audio-item');
        if (item.length && cachedItem) {
            item.removeClass('status-uncached').addClass('status-cached');
            if (cachedItem.arrayBuffer) {
                item.find('.audio-size').text(formatBytes(cachedItem.arrayBuffer.byteLength));
            }
            const newButton = $(`<button class="action-button danger clear-single-button" title="清除" data-url="${url}"><i class="fa-solid fa-trash"></i></button>`);
            button.replaceWith(newButton);
        } else {
            toastr.error(`缓存失败 ${name}: 验证失败。`);
            button.html('<i class="fa-solid fa-download"></i>').prop('disabled', false);
        }
    } catch (error) {
        console.error(`缓存失败 ${url}:`, error);
        toastr.error(`缓存失败 ${name}: ${error.message}。请检查网络或URL是否正确。`);
        button.html('<i class="fa-solid fa-download"></i>').prop('disabled', false);
    }
}

async function onClearSingleClick(event) {
    const button = $(event.currentTarget);
    const item = button.closest('.audio-item');
    const url = item.find('.editable[data-field="url"]').text();
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

        if (item.length) {
            const audioData = item.data('audio');
            item.find('.audio-size').text('未知');
            item.removeClass('status-cached').addClass('status-uncached');
            
            const newButton = $(`<button class="action-button cache-single-button" title="缓存" data-url="${url}" data-name="${audioData.key || audioData.name}" data-uploader="${audioData.uploader || 'N/A'}" data-volume="${audioData.volume}" data-vibration="${audioData.vibration}"><i class="fa-solid fa-download"></i></button>`);
            button.replaceWith(newButton);
        } else {
            await applyAudioListFilter(); // Fallback
        }
    } catch (error) {
        console.error(`清除缓存失败 ${url}:`, error);
        toastr.error(`清除缓存失败: ${error.message}`);
        button.prop('disabled', false);
    }
}

async function onPlayPreviewClick(event) {
    if (isPreviewLoading) {
        toastr.info("请等待当前音频加载完成。");
        return;
    }
    isPreviewLoading = true;
    toastr.info("正在缓存音频...");

    const button = $(event.currentTarget);
    const item = button.closest('.audio-item');

    // Read current values directly from the UI for real-time preview
    const name = item.find('.editable[data-field="key"]').text();
    const uploader = item.find('.editable[data-field="uploader"]').text();
    const volume = parseFloat(item.find('.editable[data-field="volume"]').text()) / 100;
    const vibration = item.find('.editable[data-field="vibration"]').text();
    const url = item.find('.editable[data-field="url"]').text();
    const previewKey = `preview_${url}`;

    try {
        // Stop any currently playing preview by its key
        Object.keys(playingList).forEach(key => {
            if (key.startsWith('preview_')) {
                stopAudioByKey(key, 0.1);
                // Also reset the UI for the old button
                const oldUrl = key.replace('preview_', '');
                const oldStopButton = $(`.stop-preview-button[data-url="${oldUrl}"]`);
                oldStopButton.hide();
                oldStopButton.siblings('.play-preview-button').show();
            }
        });

        // Stop any existing preview vibration
        if (previewVibrationTimeout) {
            clearTimeout(previewVibrationTimeout);
            previewVibrationTimeout = null;
        }
        if (navigator.vibrate) {
            navigator.vibrate(0);
        }

        const audioBuffer = await loadAudio(url, name, uploader);
        if (!audioBuffer) {
            toastr.error("无法加载音频进行预览。");
            isPreviewLoading = false;
            return;
        }
        const audioContext = getAudioContext();
        await audioContext.resume();

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = false; // Previews should not loop

        const gainNode = audioContext.createGain();
        // Apply master volume and the specific preview volume
        gainNode.gain.value = masterGainNode.gain.value * volume;


        
        let lastNode = source;
        let analyserNode = null;
        let animationFrameId = null;

        // Vibration Logic
        if (extension_settings[immersiveSoundExtensionName].enable_vibration && vibration && vibration !== 'N/A' && navigator.vibrate) {
            // Auto-vibration based on volume
            if (typeof vibration === 'string' && vibration.startsWith('auto')) {
                analyserNode = audioContext.createAnalyser();
                analyserNode.fftSize = 256;
                source.connect(analyserNode);
                lastNode = analyserNode;

                const parts = vibration.split('-');
                const lowThreshold = parts.length > 1 && !isNaN(parseInt(parts[1])) ? parseInt(parts[1]) : 20;
                const lowDuration = parseVibrationValue(parts[2], 50);
                const highThreshold = parts.length > 3 && !isNaN(parseInt(parts[3])) ? parseInt(parts[3]) : 80;
                const highDuration = parseVibrationValue(parts[4], 100);

                animationFrameId = startVolumeAnalysis(analyserNode, lowThreshold, lowDuration, highThreshold, highDuration, previewKey);
            }
            // Pattern-based vibration
            else {
                const profiles = extension_settings[immersiveSoundExtensionName].vibration_profiles || {};
                let pattern;
                if (vibration.trim().startsWith('[')) {
                    try {
                        pattern = JSON.parse(vibration);
                    } catch (e) {
                        console.warn("Could not parse vibration string as array, falling back to profile lookup:", vibration);
                        pattern = profiles[vibration]; // Fallback to profile name
                    }
                } else {
                    pattern = profiles[vibration];
                }

                if (pattern && Array.isArray(pattern) && pattern.length > 0) {
                    // New logic: direct vibration array
                        const vibrationType = pattern[0];
                        const actualPattern = pattern.slice(1);

                        if (vibrationType === 0) { // Single
                            navigator.vibrate(actualPattern);
                        } else if (vibrationType === 1) { // Loop
                            if (actualPattern.length > 0) {
                                const duration = actualPattern.reduce((a, b) => a + b, 0);
                                if (duration > 0) {
                                    const vibrateLoop = () => {
                                        navigator.vibrate(actualPattern);
                                        previewVibrationTimeout = setTimeout(vibrateLoop, duration);
                                    };
                                    vibrateLoop();
                                }
                            }
                        }
                    
                }
            }
        }
        lastNode.connect(gainNode);
        gainNode.connect(audioContext.destination); // Connect the last node in the chain to the destination

        source.start();

        // Add to the global playingList
        playingList[previewKey] = [source, gainNode, null, volume * 100, null, null, 'Preview', analyserNode, animationFrameId];
        console.log("playingList updated with preview:", playingList);

        // Update UI
        button.hide();
        const stopButton = button.siblings('.stop-preview-button');
        stopButton.data('url', url); // Update the url on the stop button
        stopButton.attr('data-url', url); // Also update the attribute for safety
        stopButton.show();

        source.onended = () => {
            // The stop function will handle cleanup, but if it ends naturally:
            if (playingList[previewKey]) {
                delete playingList[previewKey];
                console.log(`Preview ${previewKey} ended naturally and was removed.`);
            }
            // Reset UI
            onStopPreviewClick({ currentTarget: stopButton[0] }); // Pass a synthetic event
        };

    } catch (error) {
        console.error(`预览播放失败 ${url}:`, error);
        toastr.error(`预览播放失败 ${name}: ${error.message}`);
        delete playingList[previewKey]; // Clean up on error
    } finally {
        setTimeout(() => { isPreviewLoading = false; }, 200);
    }
}

function onStopPreviewClick(event) {
    const button = $(event.currentTarget);
    const url = button.data('url');
    const previewKey = `preview_${url}`;

    // Use the centralized stop function
    stopAudioByKey(previewKey, 0.1);

    // Stop vibration
    if (previewVibrationTimeout) {
        clearTimeout(previewVibrationTimeout);
        previewVibrationTimeout = null;
    }
    if (navigator.vibrate) {
        navigator.vibrate(0);
    }

    // Reset the loading lock
    isPreviewLoading = false;

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
                            case 'VOICE': typeVolume = settings['voiceVolume']; break;
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

    const highlightColor = settings.highlightColor || '#007BFF';
    const highlightOpacity = settings.highlightOpacity ?? 0.4;
    const textColor = settings.textColor || '#FFFFFF';
    $("#highlightColor").val(highlightColor);
    $("#textColor").val(textColor);
    $("#highlightOpacity").val(highlightOpacity);
    $("#highlightOpacity_value").val(highlightOpacity);

    // Load reading speed settings
    const readingSpeed = settings.readingSpeed;
    $("#readingSpeed").val(readingSpeed);
    $("#readingSpeed_value").val(readingSpeed);

    // Load auxiliary settings
    $("#autoPlay").prop("checked", settings.autoPlay);
    $("#musicStartsWithParagraph").prop("checked", settings.musicStartsWithParagraph);
    $("#seamlessMusic").prop("checked", settings.seamlessMusic);
    $("#regexReplace").prop("checked", settings.regexReplace);

    // Load 3D audio settings
    $("#enable3dAudio_music").prop("checked", settings.enable3dAudio_music);
    $("#enable3dAudio_ambiance").prop("checked", settings.enable3dAudio_ambiance);
    $("#enable3dAudio_sfx").prop("checked", settings.enable3dAudio_sfx);
    $("#enable3dAudio_sfx_wait").prop("checked", settings.enable3dAudio_sfx_wait);
    $("#enable3dAudio_voice").prop("checked", settings.enable3dAudio_voice);

    // Load float ball settings
    $("#enable_float_ball").prop("checked", settings.enable_float_ball);
    $("#float_ball_bg_color").val(settings.float_ball_bg_color || '#ADD8E6');
    $("#float_ball_icon_color").val(settings.float_ball_icon_color || '#FFFFFF');
    $("#float_ball_opacity").val(settings.float_ball_opacity ?? 1);
    $("#float_ball_opacity_value").val(settings.float_ball_opacity ?? 1);
    const floatBallSize = settings.float_ball_size ?? 50;
    $("#float_ball_size").val(floatBallSize);
    $("#float_ball_size_value").val(floatBallSize);

    // Load Fade settings
    const fadeTypes = ['music', 'ambiance', 'sfx', 'sfx_wait', 'voice'];
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
    loadPannerControls('voice');

    // Load volume settings
    const volumeTypes = ['master', 'music', 'ambiance', 'sfx', 'sfx_wait', 'voice'];
    volumeTypes.forEach(type => {
        const volume = settings[`${type}Volume`];
        $(`#${type}Volume`).val(volume);
        $(`#${type}Volume_value`).val(volume);
    });

    // Load vibration settings
    $("#enable_vibration").prop("checked", settings.enable_vibration);
    
    loadVibrationProfiles(); // This will load profiles and select the current one

    if (apply) {
        // Apply the loaded values to the audio nodes directly
        const pannerTypes = ['music', 'ambiance', 'sfx', 'sfx_wait', 'voice'];
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
        voiceGainNode.gain.value = settings.voiceVolume;
    }
}

function getPannerNode(type) {
    switch (type) {
        case 'music': return pannerNode_Music;
        case 'ambiance': return pannerNode_Ambiance;
        case 'sfx': return pannerNode_SFX;
        case 'sfx_wait': return pannerNode_SFX_WAIT;
        case 'voice': return pannerNode_VOICE;
        default: return null;
    }
}

function onRestoreDefaultSettingsClick() {
    if (confirm("你确定要恢复默认设置吗？")) {
        // 使用深拷贝以确保`defaultSettings`不会被意外修改
        extension_settings[immersiveSoundExtensionName] = JSON.parse(JSON.stringify(defaultSettings));
        saveSettingsDebounced();
        loadSettings(true); // Pass true to apply settings immediately

        // Manually apply float ball settings after restoring defaults.
        const ball = $('#st-is-float-ball');
        if (ball.length) {
            ball.get(0).style.top = '';
            ball.get(0).style.left = '';
        }
        applyFloatBallSettings();

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

function applyFloatBallSettings() {
    const settings = extension_settings[immersiveSoundExtensionName];
    const ball = $('#st-is-float-ball');
    if (!ball.length) return;

    if (settings.enable_float_ball) {
        ball.show();
        ball.css('background-color', settings.float_ball_bg_color || '#ADD8E6');
        ball.find('i').css('color', settings.float_ball_icon_color || '#FFFFFF');
        ball.css('opacity', settings.float_ball_opacity ?? 1);

        const size = settings.float_ball_size ?? 50;
        ball.css('width', `${size}px`);
        ball.css('height', `${size}px`);
        ball.find('i').css('font-size', `${Math.round(size * 0.48)}px`);

        // Only set initial position if it's not already positioned by the user
        if (!ball.get(0).style.top || !ball.get(0).style.left) {
            const ballHeight = size;
            ball.css('top', `${window.innerHeight / 2 - ballHeight / 2}px`);
            ball.css('left', `20px`);
        }
    } else {
        ball.hide();
    }
}

function initFloatBall() {
    // Create float ball element if it doesn't exist
    let floatBall = document.getElementById('st-is-float-ball');
    if (!floatBall) {
        floatBall = document.createElement('div');
        floatBall.id = 'st-is-float-ball';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-headphones';
        floatBall.appendChild(icon);
        document.body.appendChild(floatBall);
    }

    let isDragging = false;
    let hasMoved = false;
    let offsetX, offsetY;

    const dragStart = (e) => {
        isDragging = true;
        hasMoved = false;
        floatBall.style.cursor = 'grabbing';
        
        const rect = floatBall.getBoundingClientRect();
        const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
        
        offsetX = clientX - rect.left;
        offsetY = clientY - rect.top;

        // Add move/end listeners to the document to capture movement anywhere on the page
        document.addEventListener('mousemove', dragMove);
        document.addEventListener('touchmove', dragMove, { passive: false });
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchend', dragEnd);
    };

    const dragMove = (e) => {
        if (!isDragging) return;
        
        // Prevent default actions like scrolling on touch devices
        if (e.type === 'touchmove') {
            e.preventDefault();
        }

        hasMoved = true;
        
        const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

        let newLeft = clientX - offsetX;
        let newTop = clientY - offsetY;

        // Boundary checks
        const ballWidth = floatBall.offsetWidth;
        const ballHeight = floatBall.offsetHeight;
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + ballWidth > screenWidth) newLeft = screenWidth - ballWidth;
        if (newTop + ballHeight > screenHeight) newTop = screenHeight - ballHeight;

        floatBall.style.left = `${newLeft}px`;
        floatBall.style.top = `${newTop}px`;
    };

    const dragEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        floatBall.style.cursor = 'grab';

        // Remove document-level listeners
        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('touchmove', dragMove);
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('touchend', dragEnd);

    };

    // Attach event listeners
    floatBall.addEventListener('mousedown', dragStart);
    floatBall.addEventListener('touchstart', dragStart, { passive: false });

    // Click functionality
    floatBall.addEventListener('click', () => {
        // A "click" is registered if the mouse/finger is released without significant movement
        if (!hasMoved) {
            window.showYinXiaoSettingsPanel();
        }
    });

    // Apply settings is now in module scope

    // Listen for settings changes
    $('#enable_float_ball').off('change').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].enable_float_ball = $(event.target).prop('checked');
        saveSettingsDebounced();
        applyFloatBallSettings();
    });
    $('#float_ball_bg_color').off('change').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].float_ball_bg_color = $(event.target).val();
        saveSettingsDebounced();
        applyFloatBallSettings();
    });
    $('#float_ball_icon_color').off('change').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].float_ball_icon_color = $(event.target).val();
        saveSettingsDebounced();
        applyFloatBallSettings();
    });
    $('#float_ball_opacity').off('input').on('input', (event) => {
        const value = parseFloat($(event.target).val());
        $('#float_ball_opacity_value').val(value.toFixed(1));
        extension_settings[immersiveSoundExtensionName].float_ball_opacity = value;
        saveSettingsDebounced();
        applyFloatBallSettings();
    });
     $('#float_ball_opacity_value').off('input').on('input', (event) => {
        const value = parseFloat($(event.target).val());
        $('#float_ball_opacity').val(value);
        extension_settings[immersiveSoundExtensionName].float_ball_opacity = value;
        saveSettingsDebounced();
        applyFloatBallSettings();
    });

    $('#float_ball_size').off('input').on('input', (event) => {
        const value = parseInt($(event.target).val(), 10);
        $('#float_ball_size_value').val(value);
        extension_settings[immersiveSoundExtensionName].float_ball_size = value;
        saveSettingsDebounced();
        applyFloatBallSettings();
    });
     $('#float_ball_size_value').off('input').on('input', (event) => {
        const value = parseInt($(event.target).val(), 10);
        $('#float_ball_size').val(value);
        extension_settings[immersiveSoundExtensionName].float_ball_size = value;
        saveSettingsDebounced();
        applyFloatBallSettings();
    });

    // Initial load
    applyFloatBallSettings();
    
    // Re-apply position on window resize to keep it within bounds
    window.addEventListener('resize', () => {
        if (extension_settings[immersiveSoundExtensionName].enable_float_ball) {
            const ball = document.getElementById('st-is-float-ball');
            const rect = ball.getBoundingClientRect();
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            
            let newLeft = rect.left;
            let newTop = rect.top;

            if (newLeft + rect.width > screenWidth) {
                newLeft = screenWidth - rect.width;
            }
            if (newTop + rect.height > screenHeight) {
                newTop = screenHeight - rect.height;
            }
            if (newLeft < 0) newLeft = 0;
            if (newTop < 0) newTop = 0;

            ball.style.left = `${newLeft}px`;
            ball.style.top = `${newTop}px`;
            
        }
    });
}


export async function initUI(callbacks = {}) {
    const { check_update } = callbacks;
    // Load the main settings panel
    const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
    $("body").append(settingsHtml);

    // These are listening events
    $('#st-immersive-sound-settings-modal').on('click', '.st-is-toggle', function() {
        const checkbox = $(this).find('input[type="checkbox"]');
        if (checkbox.length) {
            const currentState = checkbox.prop('checked');
            checkbox.prop('checked', !currentState).trigger('change');
        }
    });
    $("#enable_plugin").on("change", onEnablePluginInput);
    $("#restore_default_settings_button").on("click", onRestoreDefaultSettingsClick);
    $("#export_settings_button").on("click", onExportSettingsClick);
    $("#import_settings_button").on("click", onImportSettingsClick);
    if (check_update) {
        $("#update_plugin_button").on("click", check_update);
    }

    // New modal listeners
    const settingsModal = $('#st-immersive-sound-settings-modal');

    // This function will be attached to the new button in index.js
    window.showYinXiaoSettingsPanel = () => {
        const buttonHeight = $('#ai-config-button').outerHeight(true) || 0;
        settingsModal.css({
            'display': 'grid',
            'top': `${buttonHeight}px`,
            'height': `calc(100vh - ${buttonHeight}px)`
        });
        // Optional: Load something on open, e.g., refresh cache list if cache tab is active
        if ($('.st-immersive-sound-tab-button[data-tab="cache"]').hasClass('active')) {
            onReloadAudioListClick();
        }
    };

    $('#st-immersive-sound-settings-modal-close').on('click', () => {
        settingsModal.hide();
    });

    // Tab switching logic for the new sidebar navigation
    $('.st-is-nav-link').on('click', function(e) {
        e.preventDefault();
        const tab = $(this).data('tab');

        // Update nav link active state
        $('.st-is-nav-link').removeClass('active');
        $(this).addClass('active');

        // Show/hide content
        $('.st-is-tab-content').removeClass('active');
        $(`#st-is-tab-${tab}`).addClass('active');

        // Refresh cache list if switching to the cache tab
        // if (tab === 'cache') {
        //     onReloadAudioListClick();
        // }
    });

    // Audio management listeners
    $("#ac-load-world-audio-button").on("click", onLoadWorldAudioClick);
    $("#ac-cache-all-world-audio-button").on("click", onCacheAllWorldAudioClick);
    $("#ac-reload-audio-list-button").on("click", onReloadAudioListClick);
    $("#ac-delete-all-cache-button").on("click", onDeleteAllCacheClick);
    $("#ac-refresh-page-button").on("click", () => location.reload());
    $('#st-is-world-book-select').on('change', onWorldBookSelectChange);
    $('#ac-search-input').on('input', applyAudioListFilter);
    $('#ac-audio-list-container').on('click', '.cache-single-button', onCacheSingleClick);
    $('#ac-audio-list-container').on('click', '.clear-single-button', onClearSingleClick);
    $('#ac-audio-list-container').on('click', '.play-preview-button', onPlayPreviewClick);
    $('#ac-audio-list-container').on('click', '.stop-preview-button', onStopPreviewClick);
    $('#ac-audio-list-container').on('click', '.delete-entry-button', onDeleteEntryClick);
    $("#ac-new-audio-button").on("click", onNewAudioClick);


    // Highlight settings listeners
    $("#highlightColor").on("change", (event) => {
        extension_settings[immersiveSoundExtensionName].highlightColor = $(event.target).val();
        saveSettingsDebounced();
    });

    $("#textColor").on("change", (event) => {
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
    $('#musicStartsWithParagraph').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].musicStartsWithParagraph = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#seamlessMusic').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].seamlessMusic = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#regexReplace').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].regexReplace = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#autoPlay').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].autoPlay = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    // 3D Audio Listeners
    function setup3dAudioToggle(type) {
        const checkbox = $(`#enable3dAudio_${type}`);
        const settingName = `enable3dAudio_${type}`;

        checkbox.on('change', (event) => {
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
    setup3dAudioToggle('voice');

    // Fade Controls Listeners
    const fadeTypes = ['music', 'ambiance', 'sfx', 'sfx_wait', 'voice'];
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
    setupVolumeControl('voice', voiceGainNode);

    // Setup 3D panner controls
    setupPannerControls('music', pannerNode_Music);
    setupPannerControls('ambiance', pannerNode_Ambiance);
    setupPannerControls('sfx', pannerNode_SFX);
    setupPannerControls('sfx_wait', pannerNode_SFX_WAIT);
    setupPannerControls('voice', pannerNode_VOICE);

    // 启动时加载设置（如果有的话）
    loadSettings();
    document.getElementById('stopButton').addEventListener('click', () => {
        stopAllAudio(window.marker);
    });

    // Vibration settings listeners
    $('#enable_vibration').on('change', onEnableVibrationInput);


    $('#vibration_profile_select').on('change', onVibrationProfileSelectChange);
    $('#new_vibration_profile_button').on('click', onNewVibrationProfile);
    $('#save_vibration_profile_button').on('click', onSaveVibrationProfile);
    $('#rename_vibration_profile_button').on('click', onRenameVibrationProfile);
    $('#delete_vibration_profile_button').on('click', onDeleteVibrationProfile);
    $('#test_vibration_button').on('click', onTestVibrationClick);


    // Load vibration profiles
    loadVibrationProfiles();
    $('#ac-audio-list-container').on('dblclick', '.editable', onEditableCellDoubleClick);

    // Init float ball
    initFloatBall();
}

async function onDeleteEntryClick(event) {
    const button = $(event.currentTarget);
    const item = button.closest('.audio-item');
    const audioData = item.data('audio');

    if (!audioData) {
        toastr.error("无法找到音频数据。");
        return;
    }

    if (!confirm(`确定要从世界书中永久删除条目 "${audioData.key}" 吗？\n此操作还会清除该音频的缓存（如果存在）。此操作不可逆。`)) {
        return;
    }

    try {
        button.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i>');

        // 1. Delete from world book
        await deleteWorldbookEntrie(audioData);

        // 2. If it's cached, clear the cache as well
        try {
            const db = await initDB();
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.get(audioData.url);
            
            const cachedItem = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            if (cachedItem) {
                await new Promise((resolve, reject) => {
                    const deleteRequest = store.delete(audioData.url);
                    deleteRequest.onsuccess = () => resolve();
                    deleteRequest.onerror = () => reject(deleteRequest.error);
                });
                memoryCache.delete(audioData.url);
            }
        } catch (cacheError) {
            console.warn("Could not clear cache for deleted entry, maybe it wasn't cached.", cacheError);
        }


        // 3. Remove from UI and data list
        const index = currentDisplayList.findIndex(item => item.key === audioData.key && item.url === audioData.url);
        if (index > -1) {
            currentDisplayList.splice(index, 1);
        }
        item.fadeOut(400, function() {
            $(this).remove();
        });

        toastr.success(`已成功删除条目: ${audioData.key}`);
        showWorldBookWarning();

    } catch (error) {
        console.error(`删除条目失败:`, error);
        // The underlying function already shows a toastr error
        button.prop('disabled', false).html('<i class="fa-solid fa-book-skull"></i>');
    }
}

async function onNewAudioClick() {
    const selectedWorld = $('#st-is-world-book-select').val();
    if (!selectedWorld) {
        toastr.warning("请先选择一个世界书。");
        return;
    }

    const entries = worldEntries[selectedWorld];
    if (!entries) {
        toastr.error("无法加载世界书的条目。");
        return;
    }

    const audioResourceEntries = Object.values(entries).filter(entry => entry.comment.includes("音效资源"));

    if (audioResourceEntries.length === 0) {
        toastr.warning(`在 "${selectedWorld}" 中没有找到 "音效资源" 条目。`);
        return;
    }

    // Create a form for the new audio entry
    const formHtml = `
        <div id="new-audio-form" class="st-is-modal-backdrop" style="z-index: 1060;">
            <div class="st-is-modal-content" style="max-width: 500px; height: auto;">
                <div class="st-is-modal-header">
                    <h3>在 "${selectedWorld}" 中新建音频</h3>
                    <span id="new-audio-form-close" class="st-is-modal-close">&times;</span>
                </div>
                <div class="st-is-content">
                    <div class="st-is-field-col">
                        <label for="new-audio-entry-select">选择条目 <span style="color: red;">*</span></label>
                        <select id="new-audio-entry-select" class="st-is-select"></select>
                    </div>
                    <div class="st-is-field-col">
                        <label for="new-audio-name">名称 (Key) <span style="color: red;">*</span></label>
                        <input type="text" id="new-audio-name" class="st-is-text-input" required>
                    </div>
                    <div class="st-is-field-col">
                        <label for="new-audio-url">URL <span style="color: red;">*</span></label>
                        <input type="text" id="new-audio-url" class="st-is-text-input" required>
                    </div>
                    <div class="st-is-field-col">
                        <label for="new-audio-uploader">上传者</label>
                        <input type="text" id="new-audio-uploader" class="st-is-text-input" placeholder="N/A">
                    </div>
                    <div class="st-is-field-col">
                        <label for="new-audio-volume">音量</label>
                        <input type="number" id="new-audio-volume" class="st-is-text-input" placeholder="100" value="100">
                    </div>
                    <div class="st-is-field-col">
                        <label for="new-audio-vibration">震动</label>
                        <input type="text" id="new-audio-vibration" class="st-is-text-input" placeholder="N/A">
                    </div>
                    <div style="text-align: right; margin-top: 20px;">
                        <button id="save-new-audio-button" class="st-is-btn">保存</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('body').append(formHtml);

    const entrySelect = $('#new-audio-entry-select');
    audioResourceEntries.forEach(entry => {
        entrySelect.append(`<option value="${entry.comment}">${entry.comment}</option>`);
    });

    $('#new-audio-form-close').on('click', () => $('#new-audio-form').remove());
    $('#save-new-audio-button').on('click', async () => {
        const selectedEntryName = $('#new-audio-entry-select').val();
        const newAudioData = {
            key: $('#new-audio-name').val(),
            url: $('#new-audio-url').val(),
            uploader: $('#new-audio-uploader').val() || 'N/A',
            volume: parseInt($('#new-audio-volume').val(), 10) || 100,
            vibration: $('#new-audio-vibration').val() || 'N/A',
        };

        if (!newAudioData.key || !newAudioData.url) {
            toastr.error("名称和 URL 是必填项。");
            return;
        }
        if (!selectedEntryName) {
            toastr.error("请选择一个条目。");
            return;
        }

        try {
            const addedAudio = await addWorldbookEntrie(newAudioData, selectedWorld, selectedEntryName);
            toastr.success(`成功添加音频: ${addedAudio.key}`);
            
            // Add to current view and re-render
            currentDisplayList.push(addedAudio);
            await applyAudioListFilter();

            $('#new-audio-form').remove();
            showWorldBookWarning();
        } catch (error) {
            // Error is already shown by addWorldbookEntrie
        }
    });
}

function onEnableVibrationInput(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[immersiveSoundExtensionName].enable_vibration = value;
    saveSettingsDebounced();
}

function loadVibrationProfiles() {
    const profiles = extension_settings[immersiveSoundExtensionName].vibration_profiles || {};
    const select = $('#vibration_profile_select');
    const currentProfileName = extension_settings[immersiveSoundExtensionName].current_vibration_profile;

    select.empty();
    for (const name in profiles) {
        const option = $('<option></option>').val(name).text(name);
        if (name === currentProfileName) {
            option.prop('selected', true);
        }
        select.append(option);
    }
    onVibrationProfileSelectChange(); // Load the pattern for the selected profile
}

function onVibrationProfileSelectChange() {
    const select = $('#vibration_profile_select');
    const profileName = select.val();
    const profiles = extension_settings[immersiveSoundExtensionName].vibration_profiles || {};
    const pattern = profiles[profileName] || [];

    $('#vibration_pattern_editor').val(JSON.stringify(pattern));
    extension_settings[immersiveSoundExtensionName].current_vibration_profile = profileName;
    saveSettingsDebounced();
}

function onNewVibrationProfile() {
    const profileName = prompt("请输入新的震动配置名称:");
    if (profileName) {
        const profiles = extension_settings[immersiveSoundExtensionName].vibration_profiles || {};
        if (profiles[profileName]) {
            toastr.error("该名称的配置已存在。");
            return;
        }
        profiles[profileName] = [0, 200, 100, 200]; // Default pattern
        extension_settings[immersiveSoundExtensionName].vibration_profiles = profiles;
        extension_settings[immersiveSoundExtensionName].current_vibration_profile = profileName;
        saveSettingsDebounced();
        loadVibrationProfiles();
    }
}

function onSaveVibrationProfile() {
    const select = $('#vibration_profile_select');
    const profileName = select.val();
    if (!profileName) {
        toastr.error("没有选择要保存的配置。");
        return;
    }

    try {
        const patternString = $('#vibration_pattern_editor').val();
        const pattern = JSON.parse(patternString);
        if (!Array.isArray(pattern) || pattern.length < 1 || !pattern.every(Number.isInteger) || (pattern[0] !== 0 && pattern[0] !== 1)) {
            toastr.error("震动模式格式无效。它必须是一个以0或1开头的整数数组，例如 [0, 100, 50, 100]。");
            return;
        }

        const profiles = extension_settings[immersiveSoundExtensionName].vibration_profiles || {};
        profiles[profileName] = pattern;
        extension_settings[immersiveSoundExtensionName].vibration_profiles = profiles;
        saveSettingsDebounced();
        toastr.success(`配置 "${profileName}" 已保存。`);
    } catch (e) {
        toastr.error("震动模式格式无效。它必须是有效的JSON数组。");
    }
}

function onRenameVibrationProfile() {
    const select = $('#vibration_profile_select');
    const oldProfileName = select.val();
    if (!oldProfileName) {
        toastr.error("没有选择要重命名的配置。");
        return;
    }

    const newProfileName = prompt(`请输入新的配置名称:`, oldProfileName);
    if (newProfileName && newProfileName !== oldProfileName) {
        const profiles = extension_settings[immersiveSoundExtensionName].vibration_profiles || {};
        if (profiles[newProfileName]) {
            toastr.error("该名称的配置已存在。");
            return;
        }
        
        // Preserve the pattern, rename the key
        profiles[newProfileName] = profiles[oldProfileName];
        delete profiles[oldProfileName];

        extension_settings[immersiveSoundExtensionName].vibration_profiles = profiles;
        extension_settings[immersiveSoundExtensionName].current_vibration_profile = newProfileName;
        saveSettingsDebounced();
        loadVibrationProfiles();
        toastr.success(`配置 "${oldProfileName}" 已重命名为 "${newProfileName}"。`);
    }
}

function onDeleteVibrationProfile() {
    const select = $('#vibration_profile_select');
    const profileName = select.val();
    if (!profileName) {
        toastr.error("没有选择要删除的配置。");
        return;
    }

    if (confirm(`确定要删除震动配置 "${profileName}" 吗？`)) {
        const profiles = extension_settings[immersiveSoundExtensionName].vibration_profiles || {};
        delete profiles[profileName];
        extension_settings[immersiveSoundExtensionName].vibration_profiles = profiles;

        // Select the next available profile or none
        const remainingProfiles = Object.keys(profiles);
        extension_settings[immersiveSoundExtensionName].current_vibration_profile = remainingProfiles.length > 0 ? remainingProfiles[0] : null;

        saveSettingsDebounced();
        loadVibrationProfiles();
        toastr.success(`配置 "${profileName}" 已删除。`);
    }
}

function onEditableCellDoubleClick(event) {
    const cell = $(event.currentTarget);
    if (cell.find('input').length) return; // Already in edit mode

    const originalValue = cell.text();
    const field = cell.data('field');
    const input = $('<input type="text" class="inline-edit-input">');
    input.val(originalValue);
    cell.html(input);
    input.focus();

    const saveChanges = async () => {
        const newValue = input.val();
        cell.text(newValue);

        const item = cell.closest('.audio-item');
        const originalAudioData = item.data('audio');
        if (!originalAudioData) return;

        // The name to find in the file is always the original key.
        const oldName = originalAudioData.key;

        // Create a new data object with the updated value.
        const updatedAudioData = { ...originalAudioData, [field]: newValue };

        // Update the item's data to reflect the new state.
        item.data('audio', updatedAudioData);

        try {
            // Pass the new data, and the old name to find the entry.
            await updateWorldbookEntrie(updatedAudioData, oldName);

            // Update currentDisplayList
            const index = currentDisplayList.findIndex(item => item.key === oldName && item.url === originalAudioData.url);
            if (index > -1) {
                currentDisplayList[index] = updatedAudioData;
            }
            
            toastr.success(`已更新: ${updatedAudioData.key}`);
            showWorldBookWarning();
        } catch (error) {
            toastr.error(`更新失败: ${error.message}`);
            cell.text(originalValue); // Revert UI
            item.data('audio', originalAudioData); // Revert data
        }
    };

    input.on('blur', saveChanges);
    input.on('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        } else if (e.key === 'Escape') {
            input.off('blur'); // Prevent saving on escape
            cell.text(originalValue);
        }
    });
}

function onTestVibrationClick() {
    const testButton = $('#test_vibration_button');

    if (vibrationTestTimeout) {
        clearTimeout(vibrationTestTimeout);
        vibrationTestTimeout = null;
        navigator.vibrate(0); // Stop vibration
        testButton.text('测试震动');
        toastr.info("震动测试已停止。");
        return;
    }

    if (!navigator.vibrate) {
        toastr.error("您的浏览器不支持震动功能。");
        return;
    }

    try {
        const patternString = $('#vibration_pattern_editor').val();
        const pattern = JSON.parse(patternString);

        if (!Array.isArray(pattern) || pattern.length < 1 || !pattern.every(Number.isInteger) || (pattern[0] !== 0 && pattern[0] !== 1)) {
            toastr.error("震动模式格式无效。它必须是一个以0或1开头的整数数组，例如 [0, 100, 50, 100]。");
            return;
        }

        const vibrationType = pattern[0];
        const actualPattern = pattern.slice(1);

        if (actualPattern.length === 0) {
            toastr.warning("震动模式为空 (除类型标志外)。");
            return;
        }

        toastr.success("正在测试震动...");
        testButton.text('停止测试');

        if (vibrationType === 0) { // Single
            navigator.vibrate(actualPattern);
            // Reset button after vibration ends
            const duration = actualPattern.reduce((a, b) => a + b, 0);
            vibrationTestTimeout = setTimeout(() => {
                testButton.text('测试震动');
                vibrationTestTimeout = null;
            }, duration);
        } else if (vibrationType === 1) { // Loop
            if (actualPattern.length > 0) {
                const duration = actualPattern.reduce((a, b) => a + b, 0);
                if (duration > 0) {
                    const vibrateLoop = () => {
                        navigator.vibrate(actualPattern);
                        vibrationTestTimeout = setTimeout(vibrateLoop, duration);
                    };
                    vibrateLoop();
                } else {
                     testButton.text('测试震动');
                     toastr.warning("循环震动模式的总持续时间必须大于0。");
                }
            }
        }
    } catch (e) {
        toastr.error("震动模式格式无效。它必须是有效的JSON数组。");
    }
}

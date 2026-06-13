/* global toastr */
import { saveSettingsDebounced } from "../../../../../script.js";
import { extension_settings } from "../../../../extensions.js";
import { extensionName, defaultSettings } from "./config.js";
import { effectsProcessor } from "./effects-processor.js";
import { getDomElements } from "./ui_common.js";

// DOM elements cache
let dom = {};
let lastUploadedIrFile = null; // Store the last uploaded IR file object

// --- Helper Functions ---
function getProcessorSettings() {
    let processorSettings = extension_settings[extensionName].effectsProcessor;

    // 检查设置是否存在，并且是否拥有新版结构的关键属性。
    // 如果检查失败，则意味着它是缺失的或过时的配置。
    const requiredKeys = [
        'effectsEnabled', 'compressorProfiles', 'effectsProfiles', 'irProfiles', 'spatialProfiles',
        'effectsDescriptionProfiles', 'irDescriptionProfiles', 'spatialDescriptionProfiles',
        'irApplyToVoiceOnly' // 添加新的必需键
    ];
    const isMissingKeys = !processorSettings || requiredKeys.some(key => !processorSettings.hasOwnProperty(key));

    if (isMissingKeys) {
        console.log("声临其境: 效果器设置缺失或已过时，将与默认设置合并。");
        // 与默认设置合并，以保留用户现有设置，同时添加新字段
        const newProcessorSettings = { 
            ...JSON.parse(JSON.stringify(defaultSettings.effectsProcessor)), 
            ...(processorSettings || {}) 
        };
        
        // 确保所有顶层键都存在
        requiredKeys.forEach(key => {
            if (!newProcessorSettings.hasOwnProperty(key)) {
                const defaultValue = defaultSettings.effectsProcessor[key];
                newProcessorSettings[key] = defaultValue !== undefined 
                    ? JSON.parse(JSON.stringify(defaultValue)) 
                    : (key === 'irApplyToVoiceOnly' ? false : {});
            }
        });

        extension_settings[extensionName].effectsProcessor = newProcessorSettings;
        processorSettings = newProcessorSettings;
        onSettingsChanged(); // 立即保存新的、正确的结构
    }

    return processorSettings;
}

function onSettingsChanged() {
    saveSettingsDebounced();
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function updateSliderValue(id, unit, value) {
    const valueSpan = dom[id + 'Value'];
    if (!valueSpan) return;
    let displayValue = parseFloat(value);
    if (unit === ':1') valueSpan.textContent = displayValue + ':1';
    else if (unit === '半音') valueSpan.textContent = (displayValue > 0 ? '+' : '') + displayValue + ' 半音';
    else if (unit === '') valueSpan.textContent = displayValue.toFixed(1);
    else if (unit === 's') valueSpan.textContent = displayValue.toFixed(1) + ' s';
    else if (unit === '米/秒') valueSpan.textContent = displayValue.toFixed(1) + ' 米/秒';
    else if (unit === '秒') valueSpan.textContent = displayValue.toFixed(1) + ' 秒';
    else if (unit === 'Hz' && displayValue >= 1000) valueSpan.textContent = (displayValue / 1000).toFixed(1) + ' kHz';
    else valueSpan.textContent = `${displayValue} ${unit}`;
}

/**
 * Binds an input range slider to its display value and settings.
 * @param {string} sliderId - The base ID of the slider (e.g., 'threshold').
 * @param {string} unit - The unit to display (e.g., 'dB', '%').
 * @param {Function} settingUpdater - A function that takes the new value and updates the correct part of the settings object.
 * @param {string} [profileSelectId] - Optional ID of the profile dropdown to reset on change.
 */
function bindSliderEvents(sliderId, unit, settingUpdater, profileSelectId) {
    const slider = dom[sliderId];
    if (!slider) {
        console.warn(`Slider with ID "${sliderId}" not found in DOM cache.`);
        return;
    }

    slider.addEventListener('input', () => {
        const value = parseFloat(slider.value);
        updateSliderValue(sliderId, unit, value);
        // settingUpdater(value); // Removed to prevent direct settings modification
    });
}

/**
 * Binds toggle switches and radio buttons to settings.
 * @param {string} elementId - The ID of the input element.
 * @param {Function} settingUpdater - A function that takes the new value and updates the settings.
 * @param {string} [profileSelectId] - Optional ID of the profile dropdown to reset.
 * @param {boolean} [isRadio=false] - True if the element is a radio button.
 */
function bindSwitchAndRadioEvents(elementId, settingUpdater, profileSelectId, isRadio = false) {
    if (isRadio) {
        document.querySelectorAll(`input[name="${elementId}"]`).forEach(radio => {
            radio.addEventListener('change', (event) => {
                if (event.target.checked) {
                    // settingUpdater(event.target.value); // Removed to prevent direct settings modification
                }
            });
        });
    } else {
        const element = dom[elementId];
        if (!element) {
            console.warn(`Element with ID "${elementId}" not found in DOM cache.`);
            return;
        }
        element.addEventListener('change', () => {
            // settingUpdater(element.checked); // Removed to prevent direct settings modification
        });
    }
}


// --- Generic Profile Management ---
function createProfileManager(profileType) {
    const settings = getProcessorSettings();
    const profiles = settings[`${profileType}Profiles`];
    const currentProfileKey = `current${profileType.charAt(0).toUpperCase() + profileType.slice(1)}Profile`;
    const selectEl = dom[`ep_${profileType}_profile_select`];

    async function saveProfile(profileName) {
        if (!profileName) {
            toastr.warning("预设名称不能为空。");
            return;
        }

        let profileData;
        if (profileType === 'compressor') {
            profileData = {
                threshold: parseFloat(dom.threshold.value),
                ratio: parseFloat(dom.ratio.value),
                attack: parseFloat(dom.attack.value),
                release: parseFloat(dom.release.value),
                makeup: parseFloat(dom.makeup.value),
            };
        } else if (profileType === 'effects') {
            profileData = {
                pitch: { enabled: dom.pitchEnabled.checked, shift: parseFloat(dom.pitchShift.value), grainSize: document.querySelector('input[name="grainSize"]:checked').value },
                filter: { enabled: dom.filterEnabled.checked, highpass: { enabled: dom.highpassEnabled.checked, freq: parseFloat(dom.highpassFreq.value), q: parseFloat(dom.highpassQ.value) }, lowpass: { enabled: dom.lowpassEnabled.checked, freq: parseFloat(dom.lowpassFreq.value), q: parseFloat(dom.lowpassQ.value) } },
                distortion: { enabled: dom.distortionEnabled.checked, amount: parseFloat(dom.distortionAmount.value), type: document.querySelector('input[name="distortionType"]:checked').value },
                chorus: { enabled: dom.chorusEnabled.checked, depth: parseFloat(dom.chorusDepth.value), rate: parseFloat(dom.chorusRate.value), wet: parseFloat(dom.chorusWet.value) },
                delay: { enabled: dom.delayEnabled.checked, time: parseFloat(dom.delayTime.value), feedback: parseFloat(dom.delayFeedback.value), wet: parseFloat(dom.delayWet.value) },
                reverb: { enabled: dom.effectReverbEnabled.checked, decay: parseFloat(dom.reverbDecay.value), predelay: parseFloat(dom.reverbPredelay.value), wet: parseFloat(dom.reverbWet.value) },
            };
        } else if (profileType === 'ir') {
            profileData = {
                wet: parseFloat(dom.irWet.value),
                gain: parseFloat(dom.irGain.value),
                irData: null, // Always null, no more embedding
                fileName: `${profileName}.wav` // Automatically set filename based on profile name
            };
        } else if (profileType === 'spatial') {
            profileData = {
                points: JSON.parse(JSON.stringify(effectsProcessor.pathPoints)),
                params: {
                    distanceModel: dom.distanceModel.value,
                    refDistance: parseFloat(dom.refDistance.value),
                    maxDistance: parseFloat(dom.maxDistance.value),
                    rolloffFactor: parseFloat(dom.rolloff.value),
                    coneInnerAngle: parseFloat(dom.coneInner.value),
                    coneOuterAngle: parseFloat(dom.coneOuter.value),
                    coneOuterGain: parseFloat(dom.coneOuterGain.value),
                }
            };
        }
        
        profiles[profileName] = profileData;
        onSettingsChanged();
        toastr.success(`预设 "${profileName}" 已保存。`);
        loadProfiles();
        selectEl.value = profileName;
    }

    function loadProfiles() {
        const currentProfileName = settings[currentProfileKey];
        selectEl.innerHTML = '';
        Object.keys(profiles).forEach(name => {
            const option = new Option(name, name, name === currentProfileName, name === currentProfileName);
            selectEl.appendChild(option);
        });
        if (selectEl.value) {
            $(selectEl).trigger('change');
        }
    }

    function onProfileChange() {
        const profileName = this.value;
        if (!profileName || !profiles[profileName]) return;

        settings[currentProfileKey] = profileName;
        const profile = profiles[profileName];

        if (profileType === 'compressor') {
            loadCompressorProfileToUI(profile);
        } else if (profileType === 'effects') {
            loadEffectsProfileToUI(profile);
        } else if (profileType === 'ir') {
            loadIrProfileToUI(profile);
        } else if (profileType === 'spatial') {
            loadSpatialProfileToUI(profile);
        }
        onSettingsChanged();
    }

    function saveAsNewProfile() {
        const newName = prompt("请输入新预设的名称:", selectEl.value);
        if (!newName || newName.trim() === '') return;
        if (profiles[newName]) {
            toastr.error(`预设 "${newName}" 已存在。`);
            return;
        }
        saveProfile(newName);
    }

    function deleteProfile() {
        const profileName = selectEl.value;
        if (!profileName) return;
        if (profileName === '默认' || profileName === '默认 (无)') {
            toastr.error("不能删除默认预设。");
            return;
        }
        if (Object.keys(profiles).length <= 1) {
            toastr.error("不能删除最后一个预设。");
            return;
        }
        if (confirm(`确定要删除预设 "${profileName}" 吗？`)) {
            delete profiles[profileName];
            settings[currentProfileKey] = Object.keys(profiles)[0];
            onSettingsChanged();
            loadProfiles();
            toastr.success(`预设 "${profileName}" 已删除。`);
        }
    }

    function exportProfile() {
        const profileName = selectEl.value;
        if (!profileName) return;
        const data = { [profileName]: profiles[profileName] };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `st-is-ep-${profileType}-${profileName}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function exportAllProfiles() {
        if (Object.keys(profiles).length === 0) {
            toastr.info("没有可导出的预设。");
            return;
        }
        const data = { ...profiles };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `st-is-ep-${profileType}-all-profiles.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function importProfile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const imported = JSON.parse(e.target.result);
                    let count = 0;
                    for (const name in imported) {
                        profiles[name] = imported[name];
                        count++;
                    }
                    if (count > 0) {
                        onSettingsChanged();
                        loadProfiles();
                        toastr.success(`成功导入 ${count} 个预设。`);
                    }
                } catch (error) {
                    toastr.error("导入失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // Bind events
    $(selectEl).on('change', onProfileChange);
    $(`#ep_save_${profileType}_profile_button`).on('click', () => saveProfile(selectEl.value));
    $(`#ep_save_as_${profileType}_profile_button`).on('click', saveAsNewProfile);
    $(`#ep_delete_${profileType}_profile_button`).on('click', deleteProfile);
    $(`#ep_export_${profileType}_profile_button`).on('click', exportProfile);
    $(`#ep_export_all_${profileType}_profile_button`).on('click', exportAllProfiles);
    $(`#ep_import_${profileType}_profile_button`).on('click', importProfile);

    return { loadProfiles };
}

function createDescriptionProfileManager(descriptionType) { // e.g., 'effects_description'
    const settings = getProcessorSettings();
    
    // Convert snake_case to camelCase for settings keys
    const camelCaseType = descriptionType.replace(/_([a-z])/g, g => g[1].toUpperCase()); // effects_description -> effectsDescription

    const profilesKey = `${camelCaseType}Profiles`; // e.g., effectsDescriptionProfiles
    const currentProfileKey = `current${camelCaseType.charAt(0).toUpperCase() + camelCaseType.slice(1)}Profile`; // e.g., currentEffectsDescriptionProfile
    const profiles = settings[profilesKey];
    
    const selectEl = dom[`ep_${descriptionType}_profile_select`];
    const editorEl = dom[`ep_${descriptionType}_editor`];

    function loadProfiles() {
        const currentProfileName = settings[currentProfileKey];
        selectEl.innerHTML = '';
        Object.keys(profiles).forEach(name => {
            const option = new Option(name, name, name === currentProfileName, name === currentProfileName);
            selectEl.appendChild(option);
        });
        if (selectEl.value) {
            $(selectEl).trigger('change');
        } else if (Object.keys(profiles).length > 0) {
            selectEl.value = Object.keys(profiles)[0];
            $(selectEl).trigger('change');
        }
    }

    function onProfileChange() {
        const profileName = this.value;
        if (!profileName || profiles[profileName] === undefined) return;

        settings[currentProfileKey] = profileName;
        editorEl.value = profiles[profileName];
        onSettingsChanged();
    }

    function saveProfile() {
        const profileName = selectEl.value;
        if (!profileName) {
            toastr.warning("没有选中的介绍预设。");
            return;
        }
        profiles[profileName] = editorEl.value;
        onSettingsChanged();
        toastr.success(`介绍预设 "${profileName}" 已保存。`);
    }
    
    function saveAsNewProfile() {
        const newName = prompt("请输入新介绍预设的名称:", selectEl.value);
        if (!newName || newName.trim() === '') return;
        if (profiles[newName]) {
            toastr.error(`介绍预设 "${newName}" 已存在。`);
            return;
        }
        profiles[newName] = editorEl.value;
        settings[currentProfileKey] = newName;
        onSettingsChanged();
        toastr.success(`介绍预设 "${newName}" 已创建。`);
        loadProfiles();
        selectEl.value = newName;
    }

    function deleteProfile() {
        const profileName = selectEl.value;
        if (!profileName) return;
        if (profileName === '默认介绍') {
            toastr.error("不能删除默认的介绍预设。");
            return;
        }
        if (Object.keys(profiles).length <= 1) {
            toastr.error("不能删除最后一个介绍预设。");
            return;
        }
        if (confirm(`确定要删除介绍预设 "${profileName}" 吗？`)) {
            delete profiles[profileName];
            settings[currentProfileKey] = Object.keys(profiles)[0];
            onSettingsChanged();
            loadProfiles();
            toastr.success(`介绍预设 "${profileName}" 已删除。`);
        }
    }

    function exportProfiles() {
        const data = { ...profiles };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `st-is-ep-${descriptionType}-profiles.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function importProfiles() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const imported = JSON.parse(e.target.result);
                    let count = 0;
                    for (const name in imported) {
                        profiles[name] = imported[name];
                        count++;
                    }
                    if (count > 0) {
                        onSettingsChanged();
                        loadProfiles();
                        toastr.success(`成功导入 ${count} 个介绍预设。`);
                    }
                } catch (error) {
                    toastr.error("导入失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // Bind events
    $(selectEl).on('change', onProfileChange);
    $(`#ep_save_${descriptionType}_profile_button`).on('click', saveProfile);
    $(`#ep_save_as_${descriptionType}_profile_button`).on('click', saveAsNewProfile);
    $(`#ep_delete_${descriptionType}_profile_button`).on('click', deleteProfile);
    $(`#ep_export_${descriptionType}_profile_button`).on('click', exportProfiles);
    $(`#ep_import_${descriptionType}_profile_button`).on('click', importProfiles);

    return { loadProfiles };
}

// --- UI Loading Functions ---
function loadCompressorProfileToUI(profile) {
    if (!profile) return;
    dom.threshold.value = profile.threshold;
    dom.ratio.value = profile.ratio;
    dom.attack.value = profile.attack;
    dom.release.value = profile.release;
    dom.makeup.value = profile.makeup;
    updateSliderValue('threshold', 'dB', profile.threshold);
    updateSliderValue('ratio', ':1', profile.ratio);
    updateSliderValue('attack', 'ms', profile.attack);
    updateSliderValue('release', 'ms', profile.release);
    updateSliderValue('makeup', 'dB', profile.makeup);
}

function loadEffectsProfileToUI(profile) {
    if (!profile) return;
    const fx = profile; // profile is the effects object itself
    dom.pitchEnabled.checked = fx.pitch.enabled;
    dom.pitchShift.value = fx.pitch.shift;
    updateSliderValue('pitchShift', '半音', fx.pitch.shift);
    document.querySelector(`input[name="grainSize"][value="${fx.pitch.grainSize}"]`).checked = true;

    dom.filterEnabled.checked = fx.filter.enabled;
    dom.highpassEnabled.checked = fx.filter.highpass.enabled;
    dom.highpassFreq.value = fx.filter.highpass.freq;
    updateSliderValue('highpassFreq', 'Hz', fx.filter.highpass.freq);
    dom.highpassQ.value = fx.filter.highpass.q;
    updateSliderValue('highpassQ', '', fx.filter.highpass.q);
    dom.lowpassEnabled.checked = fx.filter.lowpass.enabled;
    dom.lowpassFreq.value = fx.filter.lowpass.freq;
    updateSliderValue('lowpassFreq', 'Hz', fx.filter.lowpass.freq);
    dom.lowpassQ.value = fx.filter.lowpass.q;
    updateSliderValue('lowpassQ', '', fx.filter.lowpass.q);

    dom.distortionEnabled.checked = fx.distortion.enabled;
    dom.distortionAmount.value = fx.distortion.amount;
    updateSliderValue('distortionAmount', '%', fx.distortion.amount);
    document.querySelector(`input[name="distortionType"][value="${fx.distortion.type}"]`).checked = true;

    dom.chorusEnabled.checked = fx.chorus.enabled;
    dom.chorusDepth.value = fx.chorus.depth;
    updateSliderValue('chorusDepth', '%', fx.chorus.depth);
    dom.chorusRate.value = fx.chorus.rate;
    updateSliderValue('chorusRate', 'Hz', fx.chorus.rate);
    dom.chorusWet.value = fx.chorus.wet;
    updateSliderValue('chorusWet', '%', fx.chorus.wet);

    dom.delayEnabled.checked = fx.delay.enabled;
    dom.delayTime.value = fx.delay.time;
    updateSliderValue('delayTime', 'ms', fx.delay.time);
    dom.delayFeedback.value = fx.delay.feedback;
    updateSliderValue('delayFeedback', '%', fx.delay.feedback);
    dom.delayWet.value = fx.delay.wet;
    updateSliderValue('delayWet', '%', fx.delay.wet);

    dom.effectReverbEnabled.checked = fx.reverb.enabled;
    dom.reverbDecay.value = fx.reverb.decay;
    updateSliderValue('reverbDecay', 's', fx.reverb.decay);
    dom.reverbPredelay.value = fx.reverb.predelay;
    updateSliderValue('reverbPredelay', 'ms', fx.reverb.predelay);
    dom.reverbWet.value = fx.reverb.wet;
    updateSliderValue('reverbWet', '%', fx.reverb.wet);
}

async function loadIrProfileToUI(profile) {
    if (!profile) return;
    dom.irWet.value = profile.wet;
    dom.irGain.value = profile.gain;
    updateSliderValue('irWet', '%', profile.wet);
    updateSliderValue('irGain', 'dB', profile.gain);

    // UI no longer shows file upload status, just the expected filename.
    const expectedFileName = `${profile.fileName}`;
    dom.irStatus.className = 'ir-status info';
    dom.irStatus.textContent = `ℹ️ 将加载文件: ${expectedFileName}`;
    
    // Clear any old IR buffer to ensure it reloads on demand
    effectsProcessor.irBuffer = null;
}

function loadSpatialProfileToUI(profile) {
    if (!profile) return;
    effectsProcessor.pathPoints = JSON.parse(JSON.stringify(profile.points || []));
    effectsProcessor.selectedPointIndex = effectsProcessor.pathPoints.length > 0 ? 0 : -1;
    
    const params = profile.params;
    dom.distanceModel.value = params.distanceModel;
    dom.refDistance.value = params.refDistance;
    dom.maxDistance.value = params.maxDistance;
    dom.rolloff.value = params.rolloffFactor;
    dom.coneInner.value = params.coneInnerAngle;
    dom.coneOuter.value = params.coneOuterAngle;
    dom.coneOuterGain.value = params.coneOuterGain;

    // --- FIX: Update slider value displays ---
    updateSliderValue('refDistance', '米', params.refDistance);
    updateSliderValue('maxDistance', '米', params.maxDistance);
    updateSliderValue('rolloff', '', params.rolloffFactor);
    updateSliderValue('coneInner', '°', params.coneInnerAngle);
    updateSliderValue('coneOuter', '°', params.coneOuterAngle);
    updateSliderValue('coneOuterGain', '', params.coneOuterGain);
    // --- END FIX ---

    updateAllCanvases();
    updatePathInfo();
    updateSelectedPointPanel();
}

// --- Canvas & Spatial Logic (mostly unchanged) ---
const gridCount = 10;
let metersPerGrid = 1;

function updateGridDisplay() {
    const newSize = parseFloat(dom.gridSizeSelect.value);
    if (isNaN(newSize)) return;
    metersPerGrid = newSize;
    const range = (gridCount / 2) * metersPerGrid;
    const currentRangeDisplay = document.getElementById('currentRangeDisplay');
    if (currentRangeDisplay) {
        currentRangeDisplay.textContent = `可视范围: ±${range.toFixed(1)} 米`;
    }
    updateAllCanvases();
}

function drawCanvas(viewId) {
    const canvas = dom[viewId];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const centerX = width / 2;
    const centerY = height / 2;
    const canvasPixelsPerGrid = width / gridCount;
    const pixelsPerMeter = canvasPixelsPerGrid / metersPerGrid;

    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#2d333b';
    ctx.lineWidth = 1;
    for (let i = -gridCount / 2; i <= gridCount / 2; i++) {
        const x = centerX + i * canvasPixelsPerGrid;
        const y = centerY + i * canvasPixelsPerGrid;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, 0); ctx.lineTo(centerX, height);
    ctx.moveTo(0, centerY); ctx.lineTo(width, centerY);
    ctx.stroke();

    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    if (viewId === 'topView') {
        ctx.fillText('前', centerX, 12);
        ctx.fillText('后', centerX, height - 5);
        ctx.textAlign = 'left'; ctx.fillText('左', 5, centerY - 5);
        ctx.textAlign = 'right'; ctx.fillText('右', width - 5, centerY - 5);
    } else {
        ctx.fillText('上', centerX, 12);
        ctx.fillText('下', centerX, height - 5);
        ctx.textAlign = 'left'; ctx.fillText('左', 5, centerY - 5);
        ctx.textAlign = 'right'; ctx.fillText('右', width - 5, centerY - 5);
    }
    
    const { pathPoints, selectedPointIndex } = effectsProcessor;
    if (pathPoints && pathPoints.length > 0) {
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        pathPoints.forEach((point, i) => {
            let canvasX, canvasY;
            if (viewId === 'topView') {
                canvasX = centerX + point.x * pixelsPerMeter;
                canvasY = centerY + point.z * pixelsPerMeter;
            } else {
                canvasX = centerX + point.x * pixelsPerMeter;
                canvasY = centerY - point.y * pixelsPerMeter;
            }
            if (i === 0) ctx.moveTo(canvasX, canvasY);
            else ctx.lineTo(canvasX, canvasY);
        });
        ctx.stroke();

        pathPoints.forEach((point, i) => {
            let canvasX, canvasY;
            if (viewId === 'topView') {
                canvasX = centerX + point.x * pixelsPerMeter;
                canvasY = centerY + point.z * pixelsPerMeter;
            } else {
                canvasX = centerX + point.x * pixelsPerMeter;
                canvasY = centerY - point.y * pixelsPerMeter;
            }
            if (i === selectedPointIndex) {
                ctx.strokeStyle = '#f39c12';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(canvasX, canvasY, 12, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.fillStyle = '#e74c3c';
            ctx.beginPath();
            ctx.arc(canvasX, canvasY, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(i + 1, canvasX, canvasY);
        });
    }

    if (effectsProcessor.isAnimating) {
        let sourceCanvasX, sourceCanvasY;
        if (viewId === 'topView') {
            sourceCanvasX = centerX + effectsProcessor.currentSourcePosition.x * pixelsPerMeter;
            sourceCanvasY = centerY + effectsProcessor.currentSourcePosition.z * pixelsPerMeter;
        } else {
            sourceCanvasX = centerX + effectsProcessor.currentSourcePosition.x * pixelsPerMeter;
            sourceCanvasY = centerY - effectsProcessor.currentSourcePosition.y * pixelsPerMeter;
        }
        const pulseSize = 15 + Math.sin(Date.now() / 100) * 3;
        ctx.fillStyle = 'rgba(46, 204, 113, 0.3)';
        ctx.beginPath();
        ctx.arc(sourceCanvasX, sourceCanvasY, pulseSize + 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2ecc71';
        ctx.beginPath();
        ctx.arc(sourceCanvasX, sourceCanvasY, pulseSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔊', sourceCanvasX, sourceCanvasY);
    }
}

function updateAllCanvases() {
    drawCanvas('topView');
    drawCanvas('frontView');
}

function initCanvases() {
    ['topView', 'frontView'].forEach(viewId => {
        const canvas = dom[viewId];
        if (!canvas) return;
        canvas.addEventListener('mousedown', (e) => onCanvasMouseDown(e, viewId));
        canvas.addEventListener('mousemove', (e) => onCanvasMouseMove(e, viewId));
        canvas.addEventListener('mouseup', onCanvasMouseUp);
        canvas.addEventListener('mouseleave', onCanvasMouseUp);
        canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onCanvasMouseDown(e.touches[0], viewId); }, { passive: false });
        canvas.addEventListener('touchmove', (e) => { e.preventDefault(); onCanvasMouseMove(e.touches[0], viewId); }, { passive: false });
        canvas.addEventListener('touchend', onCanvasMouseUp);
        canvas.addEventListener('touchcancel', onCanvasMouseUp);
    });
    updateAllCanvases();
}

function onCanvasMouseDown(e, viewId) {
    const canvas = dom[viewId];
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const pixelsPerMeter = (canvas.width / gridCount) / metersPerGrid;

    for (let i = 0; i < effectsProcessor.pathPoints.length; i++) {
        const point = effectsProcessor.pathPoints[i];
        let canvasX, canvasY;
        if (viewId === 'topView') {
            canvasX = centerX + point.x * pixelsPerMeter;
            canvasY = centerY + point.z * pixelsPerMeter;
        } else {
            canvasX = centerX + point.x * pixelsPerMeter;
            canvasY = centerY - point.y * pixelsPerMeter;
        }
        if (Math.sqrt(Math.pow(mouseX - canvasX, 2) + Math.pow(mouseY - canvasY, 2)) < 15) {
            effectsProcessor.selectedPointIndex = i;
            effectsProcessor.isDragging = true;
            effectsProcessor.dragView = viewId;
            updateSelectedPointPanel();
            updateAllCanvases();
            return;
        }
    }
    effectsProcessor.selectedPointIndex = -1;
    updateSelectedPointPanel();
    updateAllCanvases();
}

function onCanvasMouseMove(e, viewId) {
    if (!effectsProcessor.isDragging || effectsProcessor.dragView !== viewId || effectsProcessor.selectedPointIndex < 0) return;

    const canvas = dom[viewId];
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const pixelsPerMeter = (canvas.width / gridCount) / metersPerGrid;
    const maxRange = (gridCount / 2) * metersPerGrid;

    const worldX = (mouseX - centerX) / pixelsPerMeter;
    effectsProcessor.pathPoints[effectsProcessor.selectedPointIndex].x = Math.max(-maxRange, Math.min(maxRange, worldX));
    
    if (viewId === 'topView') {
        const worldZ = (mouseY - centerY) / pixelsPerMeter;
        effectsProcessor.pathPoints[effectsProcessor.selectedPointIndex].z = Math.max(-maxRange, Math.min(maxRange, worldZ));
    } else {
        const worldY = -(mouseY - centerY) / pixelsPerMeter;
        effectsProcessor.pathPoints[effectsProcessor.selectedPointIndex].y = Math.max(-maxRange, Math.min(maxRange, worldY));
    }

    updatePathInfo();
    updateSelectedPointPanel();
    updateAllCanvases();
}

function onCanvasMouseUp() {
    effectsProcessor.isDragging = false;
    effectsProcessor.dragView = null;
}

function addPathPoint() {
    const defaultSpeed = parseFloat(dom.defaultSpeed.value) || 1;
    const maxRange = (gridCount / 2) * metersPerGrid;
    effectsProcessor.pathPoints.push({ x: (Math.random() - 0.5) * maxRange, y: 0, z: (Math.random() - 0.5) * maxRange - metersPerGrid, speedToNext: defaultSpeed, dwellTime: 0 });
    effectsProcessor.selectedPointIndex = effectsProcessor.pathPoints.length - 1;
    updatePathInfo();
    updateSelectedPointPanel();
    updateAllCanvases();
}

function deleteSelectedPoint() {
    const { selectedPointIndex, pathPoints } = effectsProcessor;
    if (selectedPointIndex >= 0 && selectedPointIndex < pathPoints.length) {
        pathPoints.splice(selectedPointIndex, 1);
        effectsProcessor.selectedPointIndex = Math.min(selectedPointIndex, pathPoints.length - 1);
        if (pathPoints.length === 0) effectsProcessor.selectedPointIndex = -1;
        updatePathInfo();
        updateSelectedPointPanel();
        updateAllCanvases();
    }
}

function clearAllPoints() {
    if (effectsProcessor.pathPoints.length === 0) return;
    if (!confirm('确定要清空所有路径点吗？')) return;
    effectsProcessor.pathPoints = [];
    effectsProcessor.selectedPointIndex = -1;
    updatePathInfo();
    updateSelectedPointPanel();
    updateAllCanvases();
}

function applyDefaultSpeedToAll() {
    if (effectsProcessor.pathPoints.length === 0) return;
    const defaultSpeed = parseFloat(dom.defaultSpeed.value) || 1;
    effectsProcessor.pathPoints.forEach(p => p.speedToNext = defaultSpeed);
    updatePathInfo();
    updateSelectedPointPanel();
    updateAllCanvases();
}

function updatePathInfo() {
    let totalLength = 0, totalTime = 0;
    const { pathPoints } = effectsProcessor;
    if (!pathPoints) return;
    
    let totalDwellTime = pathPoints.reduce((sum, p) => sum + (p.dwellTime || 0), 0);

    for (let i = 1; i < pathPoints.length; i++) {
        const dx = pathPoints[i].x - pathPoints[i-1].x;
        const dy = pathPoints[i].y - pathPoints[i-1].y;
        const dz = pathPoints[i].z - pathPoints[i-1].z;
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
        totalLength += len;
        const speed = pathPoints[i-1].speedToNext || 1;
        if (speed > 0) totalTime += len / speed;
    }
    
    totalTime += totalDwellTime;

    document.getElementById('pathLength').textContent = totalLength.toFixed(2);
    document.getElementById('pathTime').textContent = totalTime.toFixed(2);
    document.getElementById('pointCount').textContent = pathPoints.length;
}

function updateSelectedPointPanel() {
    const { selectedPointIndex, pathPoints } = effectsProcessor;
    const panel = document.getElementById('selectedPointPanel');
    if (!panel || !pathPoints || selectedPointIndex < 0 || selectedPointIndex >= pathPoints.length) {
        panel?.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');
    
    const point = pathPoints[selectedPointIndex];
    document.getElementById('selectedPointNumber').textContent = selectedPointIndex + 1;
    document.getElementById('selectedPointX').textContent = point.x.toFixed(2);
    document.getElementById('selectedPointY').textContent = point.y.toFixed(2);
    document.getElementById('selectedPointZ').textContent = point.z.toFixed(2);
    
    const speedControl = document.getElementById('segmentSpeedControl');
    const dwellControl = document.getElementById('pointDwellControl');
    const noNextHint = document.getElementById('noNextPointHint');
    
    const dwellTime = point.dwellTime || 0;
    dom.pointDwellTime.value = dwellTime;
    updateSliderValue('pointDwellTime', '秒', dwellTime);

    if (selectedPointIndex < pathPoints.length - 1) {
        speedControl.style.display = 'block';
        noNextHint.style.display = 'none';
        document.getElementById('nextPointNumber').textContent = selectedPointIndex + 2;
        
        const speed = point.speedToNext || 1;
        dom.segmentSpeed.value = speed;
        updateSliderValue('segmentSpeed', '米/秒', speed);
        
        const next = pathPoints[selectedPointIndex + 1];
        const dist = Math.sqrt(Math.pow(next.x - point.x, 2) + Math.pow(next.y - point.y, 2) + Math.pow(next.z - point.z, 2));
        document.getElementById('segmentDistance').textContent = dist.toFixed(2);
        document.getElementById('segmentDuration').textContent = (speed > 0 ? dist / speed : 0).toFixed(2);
    } else {
        speedControl.style.display = 'none';
        noNextHint.style.display = 'block';
    }
}

function updateSegmentSpeed() {
    const { selectedPointIndex, pathPoints } = effectsProcessor;
    if (selectedPointIndex < 0 || selectedPointIndex >= pathPoints.length - 1) return;
    
    const speed = parseFloat(dom.segmentSpeed.value) || 1;
    pathPoints[selectedPointIndex].speedToNext = speed;
    updateSliderValue('segmentSpeed', '米/秒', speed);
    
    updatePathInfo();
    updateSelectedPointPanel();
    updateAllCanvases();
}

function updatePointDwellTime() {
    const { selectedPointIndex, pathPoints } = effectsProcessor;
    if (selectedPointIndex < 0 || selectedPointIndex >= pathPoints.length) return;

    const dwellTime = parseFloat(dom.pointDwellTime.value) || 0;
    pathPoints[selectedPointIndex].dwellTime = dwellTime;
    updateSliderValue('pointDwellTime', '秒', dwellTime);

    updatePathInfo();
    updateSelectedPointPanel();
}

// --- Playback Logic ---

function getCurrentChainSettings() {
    return {
        compressor: {
            enabled: dom.compressorEnabled.checked,
            threshold: parseFloat(dom.threshold.value),
            ratio: parseFloat(dom.ratio.value),
            attack: parseFloat(dom.attack.value),
            release: parseFloat(dom.release.value),
            makeup: parseFloat(dom.makeup.value),
        },
        effects: {
            enabled: dom.effectsEnabled.checked,
            pitch: { enabled: dom.pitchEnabled.checked, shift: parseFloat(dom.pitchShift.value), grainSize: document.querySelector('input[name="grainSize"]:checked').value },
            filter: { enabled: dom.filterEnabled.checked, highpass: { enabled: dom.highpassEnabled.checked, freq: parseFloat(dom.highpassFreq.value), q: parseFloat(dom.highpassQ.value) }, lowpass: { enabled: dom.lowpassEnabled.checked, freq: parseFloat(dom.lowpassFreq.value), q: parseFloat(dom.lowpassQ.value) } },
            distortion: { enabled: dom.distortionEnabled.checked, amount: parseFloat(dom.distortionAmount.value), type: document.querySelector('input[name="distortionType"]:checked').value },
            chorus: { enabled: dom.chorusEnabled.checked, depth: parseFloat(dom.chorusDepth.value), rate: parseFloat(dom.chorusRate.value), wet: parseFloat(dom.chorusWet.value) },
            delay: { enabled: dom.delayEnabled.checked, time: parseFloat(dom.delayTime.value), feedback: parseFloat(dom.delayFeedback.value), wet: parseFloat(dom.delayWet.value) },
            reverb: { enabled: dom.effectReverbEnabled.checked, decay: parseFloat(dom.reverbDecay.value), predelay: parseFloat(dom.reverbPredelay.value), wet: parseFloat(dom.reverbWet.value) },
        },
        ir: {
            enabled: dom.irReverbEnabled.checked,
            wet: parseFloat(dom.irWet.value),
            gain: parseFloat(dom.irGain.value),
            applyToVoiceOnly: dom.irApplyToVoiceOnly.checked,
        },
        spatial: {
            enabled: dom.spatialEnabled.checked,
            points: effectsProcessor.pathPoints,
            params: {
                distanceModel: dom.distanceModel.value,
                refDistance: parseFloat(dom.refDistance.value),
                maxDistance: parseFloat(dom.maxDistance.value),
                rolloffFactor: parseFloat(dom.rolloff.value),
                coneInnerAngle: parseFloat(dom.coneInner.value),
                coneOuterAngle: parseFloat(dom.coneOuter.value),
                coneOuterGain: parseFloat(dom.coneOuterGain.value),
            }
        }
    };
}

async function onExport() {
    if (!effectsProcessor.audioBuffer) {
        alert("请先加载一个音频文件。");
        return;
    }

    const exportBtn = dom.exportBtn;
    const originalBtnText = exportBtn.innerHTML;
    const format = document.getElementById('exportFormat').value;

    try {
        exportBtn.disabled = true;
        exportBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在渲染...';
        toastr.info("正在离线渲染音频，请稍候...", "导出开始", { timeOut: 5000 });

        const chainSettings = getCurrentChainSettings();
        const audioBlob = await effectsProcessor.exportAudio(chainSettings, format);

        const a = document.createElement('a');
        a.href = URL.createObjectURL(audioBlob);
        const originalFileName = dom.audioFileName.textContent.split('.').slice(0, -1).join('.') || 'processed-audio';
        a.download = `${originalFileName}-processed.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        toastr.success("音频导出成功！", "导出完成");

    } catch (error) {
        console.error("导出音频时出错:", error);
        toastr.error(`导出失败: ${error.message}`, "错误");
    } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = originalBtnText;
    }
}

async function onListen(type) {
    if (!effectsProcessor.audioBuffer) {
        alert("请先加载一个音频文件。");
        return;
    }
    
    let chain;
    try {
        const chainSettings = getCurrentChainSettings();
        let buildOptions = {};

        switch (type) {
            case 'compressor':
                chainSettings.effects.enabled = false;
                chainSettings.ir.enabled = false;
                chainSettings.spatial.enabled = false;
                break;
            case 'effects':
                chainSettings.ir.enabled = false;
                chainSettings.spatial.enabled = false;
                break;
            case 'ir':
                const profileName = dom.ep_ir_profile_select.value;
                if (!profileName || profileName.includes('默认')) {
                    alert('不能试听默认预设，请选择一个有效的环境混响预设。');
                    return;
                }
                chainSettings.spatial.enabled = false;
                // Pass the profile name to the build process
                buildOptions.irProfileName = profileName;
                break;
        }
        chain = await effectsProcessor.buildProcessingChain(chainSettings, buildOptions);
        await effectsProcessor.playWithChain(chain, updateAllCanvases);
    } catch (error) {
        console.error(`Error during ${type} playback:`, error);
        alert(`试听 ${type} 效果时出错: ${error.message}`);
    }
}

// --- UI Initialization and Binding ---

function loadAndBindGlobalEnableStates() {
    const processorSettings = getProcessorSettings();
    const enabledStates = processorSettings.effectsEnabled;

    // Map state key to DOM element ID
    const enableMap = {
        compressor: 'compressorEnabled',
        effects: 'effectsEnabled',
        ir: 'irReverbEnabled',
        spatial: 'spatialEnabled'
    };

    // Load initial states and bind change events
    for (const key in enableMap) {
        const domId = enableMap[key];
        const checkbox = dom[domId];
        if (checkbox) {
            // Load initial state
            checkbox.checked = enabledStates[key] === true;

            // Bind change event
            checkbox.addEventListener('change', () => {
                enabledStates[key] = checkbox.checked;
                onSettingsChanged();
            });
        }
    }
}

function loadAndBindIrApplyToVoiceOnly() {
    const processorSettings = getProcessorSettings();
    
    // 调试：检查 DOM 元素是否存在
    console.log('irApplyToVoiceOnly DOM element:', dom.irApplyToVoiceOnly);
    
    if (!dom.irApplyToVoiceOnly) {
        console.error('irApplyToVoiceOnly 元素未找到！');
        return;
    }
    
    // 确保 irApplyToVoiceOnly 存在，如果不存在则设置默认值并保存
    if (processorSettings.irApplyToVoiceOnly === undefined) {
        processorSettings.irApplyToVoiceOnly = defaultSettings.effectsProcessor.irApplyToVoiceOnly ?? false;
        onSettingsChanged();
        console.log('irApplyToVoiceOnly 初始化为默认值:', processorSettings.irApplyToVoiceOnly);
    }
    
    // 加载初始状态到 UI
    dom.irApplyToVoiceOnly.checked = processorSettings.irApplyToVoiceOnly;
    console.log('irApplyToVoiceOnly 加载值:', processorSettings.irApplyToVoiceOnly);
    
    // 绑定 change 事件
    dom.irApplyToVoiceOnly.addEventListener('change', () => {
        // 重新获取设置以确保引用是最新的
        const settings = getProcessorSettings();
        settings.irApplyToVoiceOnly = dom.irApplyToVoiceOnly.checked;
        console.log('irApplyToVoiceOnly 已更新为:', dom.irApplyToVoiceOnly.checked);
        onSettingsChanged();
        console.log('已调用 onSettingsChanged()');
    });
}

export function initEffectsProcessorUI() {
    const ids = [
        'audioFile', 'audioFileName', 'audioInputBox', 'audioDuration', 'audioPreview', 'previewOriginalBtn',
        'irStatus',
        'listenCompressorBtn', 'listenEffectsBtn', 'listenIRBtn', 'listenSpatialBtn',
        'finalPlayBtn', 'epResetAllBtn', 'exportBtn', 'epStopBtn',
        'compressorEnabled', 'threshold', 'ratio', 'attack', 'release', 'makeup',
        'effectsEnabled', 'pitchEnabled', 'pitchShift', 'filterEnabled', 'highpassEnabled', 'highpassFreq', 'highpassQ', 'lowpassEnabled', 'lowpassFreq', 'lowpassQ',
        'distortionEnabled', 'distortionAmount', 'chorusEnabled', 'chorusDepth', 'chorusRate', 'chorusWet',
        'delayEnabled', 'delayTime', 'delayFeedback', 'delayWet', 'effectReverbEnabled', 'reverbDecay', 'reverbPredelay', 'reverbWet',
        'irReverbEnabled', 'irWet', 'irGain', 'irApplyToVoiceOnly',
        'spatialEnabled', 'defaultSpeed', 'addPathPointBtn', 'deleteSelectedPointBtn', 'clearAllPointsBtn', 'applyDefaultSpeedToAllBtn',
        'segmentSpeed', 'pointDwellTime', 'distanceModel', 'refDistance', 'maxDistance', 'rolloff', 'coneInner', 'coneOuter', 'coneOuterGain',
        'gridSizeSelect', 'topView', 'frontView',
        'thresholdValue', 'ratioValue', 'attackValue', 'releaseValue', 'makeupValue', 'pitchShiftValue',
        'highpassFreqValue', 'highpassQValue', 'lowpassFreqValue', 'lowpassQValue', 'distortionAmountValue',
        'chorusDepthValue', 'chorusRateValue', 'chorusWetValue', 'delayTimeValue', 'delayFeedbackValue', 'delayWetValue',
        'reverbDecayValue', 'reverbPredelayValue', 'reverbWetValue', 'irWetValue', 'irGainValue',
        'defaultSpeedValue', 'segmentSpeedValue', 'pointDwellTimeValue',
        // --- FIX: Add missing spatial value IDs ---
        'refDistanceValue', 'maxDistanceValue', 'rolloffValue', 'coneInnerValue', 'coneOuterValue', 'coneOuterGainValue',
        // --- END FIX ---
        // Profile controls
        'ep_compressor_profile_select', 'ep_effects_profile_select', 'ep_ir_profile_select', 'ep_spatial_profile_select',
        // Description Profile controls
        'ep_effects_description_profile_select', 'ep_effects_description_editor',
        'ep_ir_description_profile_select', 'ep_ir_description_editor',
        'ep_spatial_description_profile_select', 'ep_spatial_description_editor'
    ];
    
    dom = getDomElements(ids);
    
    // Init profile managers
    const compressorManager = createProfileManager('compressor');
    const effectsManager = createProfileManager('effects');
    const irManager = createProfileManager('ir');
    const spatialManager = createProfileManager('spatial');
    const effectsDescriptionManager = createDescriptionProfileManager('effects_description');
    const irDescriptionManager = createDescriptionProfileManager('ir_description');
    const spatialDescriptionManager = createDescriptionProfileManager('spatial_description');

    // Bind file inputs
    dom.audioFile.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const buffer = await effectsProcessor.handleAudioFile(file);
        if (buffer) {
            dom.audioFileName.textContent = file.name;
            dom.audioInputBox.classList.add('has-file');
            dom.audioDuration.textContent = buffer.duration.toFixed(2) + 's';
            dom.audioPreview.style.display = 'flex';
            document.querySelectorAll('#st-is-tab-effects-processor .listen-btn, #st-is-tab-effects-processor .final-btn, #st-is-tab-effects-processor .export-btn').forEach(btn => btn.disabled = false);
        }
    });

    // The event listener for the removed irFile element is no longer needed.

    // Bind playback buttons
    dom.previewOriginalBtn.addEventListener('click', (event) => { event.stopPropagation(); effectsProcessor.previewOriginal(); });
    dom.listenCompressorBtn.addEventListener('click', () => onListen('compressor'));
    dom.listenEffectsBtn.addEventListener('click', () => onListen('effects'));
    dom.listenIRBtn.addEventListener('click', () => onListen('ir'));
    dom.listenSpatialBtn.addEventListener('click', () => onListen('spatial'));
    dom.finalPlayBtn.addEventListener('click', () => onListen('final'));
    dom.epStopBtn.addEventListener('click', () => effectsProcessor.stopPlayback());

    // Bind reset and export
    dom.epResetAllBtn.addEventListener('click', () => {
        if (confirm('确定要重置所有效果器预设为默认值吗？')) {
            extension_settings[extensionName].effectsProcessor = JSON.parse(JSON.stringify(defaultSettings.effectsProcessor));
            onSettingsChanged();
            compressorManager.loadProfiles();
            effectsManager.loadProfiles();
            irManager.loadProfiles();
            spatialManager.loadProfiles();
            toastr.success("效果器已重置为默认设置。");
        }
    });
    dom.exportBtn.addEventListener('click', onExport);

    // Bind spatial controls
    dom.addPathPointBtn.addEventListener('click', addPathPoint);
    dom.deleteSelectedPointBtn.addEventListener('click', deleteSelectedPoint);
    dom.clearAllPointsBtn.addEventListener('click', clearAllPoints);
    dom.applyDefaultSpeedToAllBtn.addEventListener('click', applyDefaultSpeedToAll);
    dom.segmentSpeed.addEventListener('input', updateSegmentSpeed);
    dom.pointDwellTime.addEventListener('input', updatePointDwellTime);
    dom.gridSizeSelect.addEventListener('change', updateGridDisplay);
    
    initCanvases();

    // Bind all interactive elements
    const settings = getProcessorSettings();

    // --- Compressor ---
    const compProfileId = 'ep_compressor_profile_select';
    bindSliderEvents('threshold', 'dB', (v) => settings.compressorProfiles[settings.currentCompressorProfile].threshold = v, compProfileId);
    bindSliderEvents('ratio', ':1', (v) => settings.compressorProfiles[settings.currentCompressorProfile].ratio = v, compProfileId);
    bindSliderEvents('attack', 'ms', (v) => settings.compressorProfiles[settings.currentCompressorProfile].attack = v, compProfileId);
    bindSliderEvents('release', 'ms', (v) => settings.compressorProfiles[settings.currentCompressorProfile].release = v, compProfileId);
    bindSliderEvents('makeup', 'dB', (v) => settings.compressorProfiles[settings.currentCompressorProfile].makeup = v, compProfileId);

    // --- Effects ---
    const fxProfileId = 'ep_effects_profile_select';
    
    // Pitch
    bindSwitchAndRadioEvents('pitchEnabled', (v) => settings.effectsProfiles[settings.currentEffectsProfile].pitch.enabled = v, fxProfileId);
    bindSliderEvents('pitchShift', '半音', (v) => settings.effectsProfiles[settings.currentEffectsProfile].pitch.shift = v, fxProfileId);
    bindSwitchAndRadioEvents('grainSize', (v) => settings.effectsProfiles[settings.currentEffectsProfile].pitch.grainSize = v, fxProfileId, true);

    // Filter
    bindSwitchAndRadioEvents('filterEnabled', (v) => settings.effectsProfiles[settings.currentEffectsProfile].filter.enabled = v, fxProfileId);
    bindSwitchAndRadioEvents('highpassEnabled', (v) => settings.effectsProfiles[settings.currentEffectsProfile].filter.highpass.enabled = v, fxProfileId);
    bindSliderEvents('highpassFreq', 'Hz', (v) => settings.effectsProfiles[settings.currentEffectsProfile].filter.highpass.freq = v, fxProfileId);
    bindSliderEvents('highpassQ', '', (v) => settings.effectsProfiles[settings.currentEffectsProfile].filter.highpass.q = v, fxProfileId);
    bindSwitchAndRadioEvents('lowpassEnabled', (v) => settings.effectsProfiles[settings.currentEffectsProfile].filter.lowpass.enabled = v, fxProfileId);
    bindSliderEvents('lowpassFreq', 'Hz', (v) => settings.effectsProfiles[settings.currentEffectsProfile].filter.lowpass.freq = v, fxProfileId);
    bindSliderEvents('lowpassQ', '', (v) => settings.effectsProfiles[settings.currentEffectsProfile].filter.lowpass.q = v, fxProfileId);

    // Distortion
    bindSwitchAndRadioEvents('distortionEnabled', (v) => settings.effectsProfiles[settings.currentEffectsProfile].distortion.enabled = v, fxProfileId);
    bindSliderEvents('distortionAmount', '%', (v) => settings.effectsProfiles[settings.currentEffectsProfile].distortion.amount = v, fxProfileId);
    bindSwitchAndRadioEvents('distortionType', (v) => settings.effectsProfiles[settings.currentEffectsProfile].distortion.type = v, fxProfileId, true);

    // Chorus
    bindSwitchAndRadioEvents('chorusEnabled', (v) => settings.effectsProfiles[settings.currentEffectsProfile].chorus.enabled = v, fxProfileId);
    bindSliderEvents('chorusDepth', '%', (v) => settings.effectsProfiles[settings.currentEffectsProfile].chorus.depth = v, fxProfileId);
    bindSliderEvents('chorusRate', 'Hz', (v) => settings.effectsProfiles[settings.currentEffectsProfile].chorus.rate = v, fxProfileId);
    bindSliderEvents('chorusWet', '%', (v) => settings.effectsProfiles[settings.currentEffectsProfile].chorus.wet = v, fxProfileId);

    // Delay
    bindSwitchAndRadioEvents('delayEnabled', (v) => settings.effectsProfiles[settings.currentEffectsProfile].delay.enabled = v, fxProfileId);
    bindSliderEvents('delayTime', 'ms', (v) => settings.effectsProfiles[settings.currentEffectsProfile].delay.time = v, fxProfileId);
    bindSliderEvents('delayFeedback', '%', (v) => settings.effectsProfiles[settings.currentEffectsProfile].delay.feedback = v, fxProfileId);
    bindSliderEvents('delayWet', '%', (v) => settings.effectsProfiles[settings.currentEffectsProfile].delay.wet = v, fxProfileId);

    // Reverb
    bindSwitchAndRadioEvents('effectReverbEnabled', (v) => settings.effectsProfiles[settings.currentEffectsProfile].reverb.enabled = v, fxProfileId);
    bindSliderEvents('reverbDecay', 's', (v) => settings.effectsProfiles[settings.currentEffectsProfile].reverb.decay = v, fxProfileId);
    bindSliderEvents('reverbPredelay', 'ms', (v) => settings.effectsProfiles[settings.currentEffectsProfile].reverb.predelay = v, fxProfileId);
    bindSliderEvents('reverbWet', '%', (v) => settings.effectsProfiles[settings.currentEffectsProfile].reverb.wet = v, fxProfileId);

    // --- IR Reverb ---
    const irProfileId = 'ep_ir_profile_select';
    bindSliderEvents('irWet', '%', (v) => settings.irProfiles[settings.currentIrProfile].wet = v, irProfileId);
    bindSliderEvents('irGain', 'dB', (v) => settings.irProfiles[settings.currentIrProfile].gain = v, irProfileId);

    // --- Spatial Audio ---
    const spatialProfileId = 'ep_spatial_profile_select';
    bindSliderEvents('defaultSpeed', '米/秒', (v) => { /* This is not saved in profile, just a UI helper */ });
    bindSliderEvents('refDistance', '米', (v) => settings.spatialProfiles[settings.currentSpatialProfile].params.refDistance = v, spatialProfileId);
    bindSliderEvents('maxDistance', '米', (v) => settings.spatialProfiles[settings.currentSpatialProfile].params.maxDistance = v, spatialProfileId);
    bindSliderEvents('rolloff', '', (v) => settings.spatialProfiles[settings.currentSpatialProfile].params.rolloffFactor = v, spatialProfileId);
    bindSliderEvents('coneInner', '°', (v) => settings.spatialProfiles[settings.currentSpatialProfile].params.coneInnerAngle = v, spatialProfileId);
    bindSliderEvents('coneOuter', '°', (v) => settings.spatialProfiles[settings.currentSpatialProfile].params.coneOuterAngle = v, spatialProfileId);
    bindSliderEvents('coneOuterGain', '', (v) => settings.spatialProfiles[settings.currentSpatialProfile].params.coneOuterGain = v, spatialProfileId);
    dom.distanceModel.addEventListener('change', () => {
        settings.spatialProfiles[settings.currentSpatialProfile].params.distanceModel = dom.distanceModel.value;
    });


    // Initial load
    compressorManager.loadProfiles();
    effectsManager.loadProfiles();
    irManager.loadProfiles();
    spatialManager.loadProfiles();
    effectsDescriptionManager.loadProfiles();
    irDescriptionManager.loadProfiles();
    spatialDescriptionManager.loadProfiles();

    // Load and bind global enable states after all profiles are loaded
    loadAndBindGlobalEnableStates();
    
    // Load and bind irApplyToVoiceOnly
    loadAndBindIrApplyToVoiceOnly();
}

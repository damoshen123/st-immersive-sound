/* global toastr */
// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced, eventSource } from "../../../../../script.js";
import { extensionName, eventNames, defaultSettings } from "./config.js";
import { initiateTtsRequest, generateTtsCacheKey } from "./tts-cache.js";


// DOM Elements
let appIdInput, accessKeyInput, apiConfigProfileSelect, apiConfigProfileNameInput, synthesisQuotaInput, cloneQuotaInput;
let speakerProfileSelect, speakerProfileNameInput, speakerIdInput, resourceIdSelect, speakerDescriptionInput;
let testTextInput, contextTextsInput, testButton, testResultAudio;
let ttsCharMatchProfileSelect, ttsCharMatchRulesEditor;
let ttsCloneAudioFileInput, ttsCloneAudioFileButton, ttsCloneAudioFileName, ttsCloneButton;

// TTS API Config Profile Management
export function loadApiConfigProfiles() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigs = ttsProfile.api_configs || {};
    const currentApiConfigName = ttsProfile.current_api_config;

    apiConfigProfileSelect.empty();
    Object.keys(apiConfigs).forEach(name => {
        const option = new Option(name, name, name === currentApiConfigName, name === currentApiConfigName);
        apiConfigProfileSelect.append(option);
    });

    if (apiConfigProfileSelect.val()) {
        apiConfigProfileSelect.trigger('change');
    }
}

function onApiConfigProfileChange() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = $(this).val();

    if (!apiConfigName) return;

    const apiConfig = ttsProfile.api_configs[apiConfigName];

    if (apiConfig) {
        apiConfigProfileNameInput.val(apiConfigName);
        appIdInput.val(apiConfig.app_id || '');
        accessKeyInput.val(apiConfig.access_key || '');
        synthesisQuotaInput.val(apiConfig.synthesis_quota ?? -1);
        cloneQuotaInput.val(apiConfig.clone_quota ?? -1);
        ttsProfile.current_api_config = apiConfigName;
        
        // Trigger speaker profile loading for the selected API config
        loadSpeakerProfiles();
        
        saveSettingsDebounced();
    }
}

function onSaveApiConfigProfileClick() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const originalName = apiConfigProfileSelect.val();
    const newName = apiConfigProfileNameInput.val();

    if (!newName) {
        toastr.warning("API 配置名称不能为空。");
        return;
    }

    // Case 1: Renaming an existing profile
    if (originalName && originalName !== newName) {
        if (ttsProfile.api_configs[newName]) {
            toastr.error(`API 配置 "${newName}" 已存在，无法重命名。`);
            return;
        }

        // Copy data, delete old, and update current selection if needed
        ttsProfile.api_configs[newName] = ttsProfile.api_configs[originalName];
        delete ttsProfile.api_configs[originalName];

        if (ttsProfile.current_api_config === originalName) {
            ttsProfile.current_api_config = newName;
        }
        
        // Update the fields in the new object
        const synthesisQuota = parseInt(synthesisQuotaInput.val(), 10);
        const cloneQuota = parseInt(cloneQuotaInput.val(), 10);
        ttsProfile.api_configs[newName] = {
            ...ttsProfile.api_configs[newName],
            app_id: appIdInput.val(),
            access_key: accessKeyInput.val(),
            synthesis_quota: isNaN(synthesisQuota) ? -1 : synthesisQuota,
            clone_quota: isNaN(cloneQuota) ? -1 : cloneQuota,
        };

        toastr.success(`API 配置已从 "${originalName}" 重命名为 "${newName}" 并保存。`);

    // Case 2: Updating the currently selected profile without changing its name
    } else {
        const configToSave = ttsProfile.api_configs[newName] || {};
        const synthesisQuota = parseInt(synthesisQuotaInput.val(), 10);
        const cloneQuota = parseInt(cloneQuotaInput.val(), 10);
        ttsProfile.api_configs[newName] = {
            ...configToSave,
            app_id: appIdInput.val(),
            access_key: accessKeyInput.val(),
            synthesis_quota: isNaN(synthesisQuota) ? -1 : synthesisQuota,
            clone_quota: isNaN(cloneQuota) ? -1 : cloneQuota,
        };
        toastr.success(`API 配置 "${newName}" 已更新。`);
    }

    saveSettingsDebounced();
    
    // Refresh the list and select the correct item
    loadApiConfigProfiles();
    apiConfigProfileSelect.val(newName);
}

function onNewApiConfigProfileClick() {
    const newName = prompt("请输入新的 API 配置名称：");
    if (!newName || newName.trim() === '') {
        toastr.warning("API 配置名称不能为空。");
        return;
    }

    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];

    if (ttsProfile.api_configs[newName]) {
        toastr.error(`API 配置 "${newName}" 已存在。`);
        return;
    }

    const defaultSpeakers = defaultSettings.tts_profiles.默认.api_configs.默认.speakers;
    const defaultSpeakerProfile = defaultSettings.tts_profiles.默认.api_configs.默认.current_speaker_profile;

    // Create new config with default speakers
    ttsProfile.api_configs[newName] = {
        app_id: '',
        access_key: '',
        synthesis_quota: -1,
        clone_quota: -1,
        speakers: JSON.parse(JSON.stringify(defaultSpeakers)),
        current_speaker_profile: defaultSpeakerProfile,
    };
    ttsProfile.current_api_config = newName;

    saveSettingsDebounced();
    toastr.success(`API 配置 "${newName}" 已创建并选中。`);
    loadApiConfigProfiles();
    apiConfigProfileSelect.val(newName).trigger('change');
}

function onDeleteApiConfigProfileClick() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = apiConfigProfileSelect.val();

    if (!apiConfigName) {
        toastr.warning("没有选中的 API 配置。");
        return;
    }

    if (Object.keys(ttsProfile.api_configs).length <= 1) {
        toastr.error("不能删除最后一个 API 配置。");
        return;
    }

    if (confirm(`你确定要删除 API 配置 "${apiConfigName}" 吗？`)) {
        delete ttsProfile.api_configs[apiConfigName];
        ttsProfile.current_api_config = Object.keys(ttsProfile.api_configs)[0];
        saveSettingsDebounced();
        loadApiConfigProfiles();
        toastr.success(`API 配置 "${apiConfigName}" 已删除。`);
    }
}

function onExportApiConfigProfileClick() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = apiConfigProfileSelect.val();

    if (!apiConfigName) {
        toastr.warning("没有选中的 API 配置可导出。");
        return;
    }

    const config = ttsProfile.api_configs[apiConfigName];
    const speakersArray = Object.keys(config.speakers || {}).map(speakerName => {
        const speaker = config.speakers[speakerName];
        return {
            name: speakerName,
            speakerId: speaker.speaker_id || '',
            resourceId: speaker.resource_id || 'seed-icl-2.0',
            note: speaker.description || '',
            trainHistory: [],
            lastStatus: null,
            lastStatusText: null,
        };
    });

    const exportData = {
        version: 2,
        exportTime: new Date().toISOString(),
        apiConfigs: [{
            name: apiConfigName,
            accessToken: config.access_key || '',
            appId: config.app_id || '',
            speakers: speakersArray,
        }],
        currentApiIndex: 0, // Only one config, so index is 0
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_is_api_config_profile_${apiConfigName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function onExportAllApiConfigProfilesClick() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const allApiConfigs = ttsProfile.api_configs;

    if (!allApiConfigs || Object.keys(allApiConfigs).length === 0) {
        toastr.warning("没有 API 配置可导出。");
        return;
    }

    const apiConfigNames = Object.keys(allApiConfigs);

    const exportData = {
        version: 2,
        exportTime: new Date().toISOString(),
        apiConfigs: apiConfigNames.map(name => {
            const config = allApiConfigs[name];
            const speakersArray = Object.keys(config.speakers || {}).map(speakerName => {
                const speaker = config.speakers[speakerName];
                return {
                    name: speakerName,
                    speakerId: speaker.speaker_id || '',
                    resourceId: speaker.resource_id || 'seed-icl-2.0',
                    note: speaker.description || '',
                    trainHistory: [],
                    lastStatus: null,
                    lastStatusText: null,
                };
            });

            return {
                name: name,
                accessToken: config.access_key || '',
                appId: config.app_id || '',
                speakers: speakersArray,
            };
        }),
        currentApiIndex: apiConfigNames.indexOf(ttsProfile.current_api_config),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_is_all_api_config_profiles_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function onImportApiConfigProfileClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedData = JSON.parse(e.target.result);

                    // V2 format check
                    if (importedData.version === 2 && Array.isArray(importedData.apiConfigs)) {
                        const ttsProfileName = extension_settings[extensionName].current_tts_profile;
                        const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
                        let newConfigsCount = 0;
                        let updatedConfigsCount = 0;

                        importedData.apiConfigs.forEach(importedConfig => {
                            if (!importedConfig.name) return; // Skip configs without a name

                            const configName = importedConfig.name;
                            const existingConfig = ttsProfile.api_configs[configName];

                            const importedSpeakers = {};
                            let firstImportedSpeakerName = null;
                            (importedConfig.speakers || []).forEach(speaker => {
                                if (!speaker.name) return; // Skip speakers without a name
                                if (!firstImportedSpeakerName) firstImportedSpeakerName = speaker.name;
                                importedSpeakers[speaker.name] = {
                                    speaker_id: speaker.speakerId || '',
                                    resource_id: speaker.resourceId || 'seed-icl-2.0',
                                    description: speaker.note || '',
                                };
                            });

                            if (existingConfig) {
                                // --- MERGE LOGIC for existing config ---
                                updatedConfigsCount++;

                                // Update app_id and access_key if provided in the import
                                existingConfig.app_id = importedConfig.appId || existingConfig.app_id;
                                existingConfig.access_key = importedConfig.accessToken || existingConfig.access_key;
                                
                                // Preserve existing quotas
                                
                                // Replace the entire speaker list
                                existingConfig.speakers = importedSpeakers;

                                // Ensure current_speaker_profile is set to a valid speaker from the new list.
                                existingConfig.current_speaker_profile = firstImportedSpeakerName || Object.keys(existingConfig.speakers)[0] || '';
                            } else {
                                // --- CREATE LOGIC for new config ---
                                newConfigsCount++;
                                ttsProfile.api_configs[configName] = {
                                    app_id: importedConfig.appId || '',
                                    access_key: importedConfig.accessToken || '',
                                    synthesis_quota: 20000, // Default for new config
                                    clone_quota: 20000,
                                    speakers: importedSpeakers,
                                    current_speaker_profile: firstImportedSpeakerName || Object.keys(importedSpeakers)[0] || '',
                                };
                            }
                        });

                        // Set the current active API config after import
                        if (importedData.currentApiIndex !== undefined && importedData.apiConfigs[importedData.currentApiIndex]) {
                            const targetConfigName = importedData.apiConfigs[importedData.currentApiIndex].name;
                            if (ttsProfile.api_configs[targetConfigName]) {
                                ttsProfile.current_api_config = targetConfigName;
                            }
                        }

                        saveSettingsDebounced();
                        loadApiConfigProfiles();
                        
                        let message = '';
                        if (newConfigsCount > 0) {
                            message += `成功导入 ${newConfigsCount} 个新 API 配置。`;
                        }
                        if (updatedConfigsCount > 0) {
                            message += `${message.length > 0 ? ' ' : ''}成功更新 ${updatedConfigsCount} 个同名 API 配置 (保留了额度，替换了音色列表)。`;
                        }
                        
                        if (message) {
                            toastr.success(message);
                        } else {
                            toastr.info("导入的文件中没有找到可用的 API 配置。");
                        }

                    } else { // Fallback for old format
                        const importedApiConfigs = importedData;
                        const ttsProfileName = extension_settings[extensionName].current_tts_profile;
                        const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
                        let importedCount = 0;
                        for (const name in importedApiConfigs) {
                            if (Object.prototype.hasOwnProperty.call(importedApiConfigs, name)) {
                                // Basic validation for old format
                                if (typeof importedApiConfigs[name] === 'object' && importedApiConfigs[name] !== null && 'app_id' in importedApiConfigs[name]) {
                                    ttsProfile.api_configs[name] = importedApiConfigs[name];
                                    importedCount++;
                                }
                            }
                        }
                        if (importedCount > 0) {
                            saveSettingsDebounced();
                            loadApiConfigProfiles();
                            toastr.success(`成功从旧格式文件导入 ${importedCount} 个 API 配置。`);
                        } else {
                            throw new Error("无法识别的文件格式或文件内容为空。");
                        }
                    }
                } catch (error) {
                    console.error("Import failed:", error);
                    toastr.error(`导入失败: ${error.message || "文件格式无效。"}`);
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}


/**
 * Loads the main TTS settings (API keys).
 */
function loadTtsSettings() {
    const profileName = extension_settings[extensionName].current_tts_profile;
    const profile = extension_settings[extensionName].tts_profiles[profileName];

    if (profile) {
        loadApiConfigProfiles();
        loadSpeakerProfiles();
    }
}

/**
 * Loads speaker profiles into the dropdown.
 */
function loadSpeakerProfiles() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = ttsProfile.current_api_config;
    const apiConfig = ttsProfile.api_configs[apiConfigName];

    if (!apiConfig) {
        speakerProfileSelect.empty();
        // Clear speaker form fields
        speakerProfileNameInput.val('');
        speakerIdInput.val('');
        resourceIdSelect.val('seed-tts-2.0');
        speakerDescriptionInput.val('');
        return;
    }

    const speakers = apiConfig.speakers || {};
    const currentSpeakerName = apiConfig.current_speaker_profile;

    speakerProfileSelect.empty();
    Object.keys(speakers).forEach(name => {
        const option = new Option(name, name, name === currentSpeakerName, name === currentSpeakerName);
        speakerProfileSelect.append(option);
    });

    if (speakerProfileSelect.val()) {
        speakerProfileSelect.trigger('change');
    } else {
        // If no speaker is selected (e.g., empty speakers object), clear the form
        speakerProfileNameInput.val('');
        speakerIdInput.val('');
        resourceIdSelect.val('seed-tts-2.0');
        speakerDescriptionInput.val('');
    }
}

/**
 * Handles the change event of the speaker profile selection.
 */
function onSpeakerProfileChange() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = ttsProfile.current_api_config;
    const apiConfig = ttsProfile.api_configs[apiConfigName];
    const speakerName = $(this).val();

    if (!apiConfig || !speakerName) return;

    const speaker = apiConfig.speakers[speakerName];

    if (speaker) {
        speakerProfileNameInput.val(speakerName);
        speakerIdInput.val(speaker.speaker_id || '');
        resourceIdSelect.val(speaker.resource_id || 'seed-tts-2.0');
        speakerDescriptionInput.val(speaker.description || '');
        apiConfig.current_speaker_profile = speakerName;
        saveSettingsDebounced();
    }
}

/**
 * Saves the current speaker profile details.
 */
function onSaveSpeakerProfileClick() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = ttsProfile.current_api_config;
    const apiConfig = ttsProfile.api_configs[apiConfigName];
    
    if (!apiConfig) {
        toastr.error("未选择有效的 API 配置。");
        return;
    }

    const originalName = speakerProfileSelect.val();
    const newName = speakerProfileNameInput.val();

    if (!newName) {
        toastr.warning("音色名称不能为空。");
        return;
    }

    // Case 1: Renaming an existing speaker profile
    if (originalName && originalName !== newName) {
        if (apiConfig.speakers[newName]) {
            toastr.error(`音色配置 "${newName}" 在当前 API 配置中已存在，无法重命名。`);
            return;
        }

        // Copy data, delete old, and update current selection if needed
        apiConfig.speakers[newName] = apiConfig.speakers[originalName];
        delete apiConfig.speakers[originalName];

        if (apiConfig.current_speaker_profile === originalName) {
            apiConfig.current_speaker_profile = newName;
        }

        // Update the fields in the new object
        apiConfig.speakers[newName] = {
            ...apiConfig.speakers[newName],
            speaker_id: speakerIdInput.val(),
            resource_id: resourceIdSelect.val(),
            description: speakerDescriptionInput.val()
        };

        toastr.success(`音色配置已从 "${originalName}" 重命名为 "${newName}" 并保存。`);

    // Case 2: Updating the currently selected profile or creating a new one
    } else {
        apiConfig.speakers[newName] = {
            speaker_id: speakerIdInput.val(),
            resource_id: resourceIdSelect.val(),
            description: speakerDescriptionInput.val()
        };
        toastr.success(`音色配置 "${newName}" 已保存到 API "${apiConfigName}"。`);
    }

    saveSettingsDebounced();
    
    // Refresh the list and select the correct item
    loadSpeakerProfiles();
    speakerProfileSelect.val(newName);
}

/**
 * Saves the current speaker details as a new profile.
 */
function onNewSpeakerProfileClick() {
    const newName = prompt("请输入新的音色名称：");
    if (!newName || newName.trim() === '') {
        toastr.warning("音色名称不能为空。");
        return;
    }

    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = ttsProfile.current_api_config;
    const apiConfig = ttsProfile.api_configs[apiConfigName];

    if (!apiConfig) {
        toastr.error("未选择有效的 API 配置。");
        return;
    }

    if (apiConfig.speakers[newName]) {
        toastr.error(`音色配置 "${newName}" 在当前 API 配置中已存在。`);
        return;
    }

    // Create a new empty speaker profile
    apiConfig.speakers[newName] = {
        speaker_id: "",
        resource_id: "seed-icl-2.0",
        description: ""
    };
    apiConfig.current_speaker_profile = newName;

    saveSettingsDebounced();
    toastr.success(`音色配置 "${newName}" 已创建并选中。`);
    loadSpeakerProfiles();
    speakerProfileSelect.val(newName).trigger('change');
}

/**
 * Deletes the currently selected speaker profile.
 */
function onDeleteSpeakerProfileClick() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = ttsProfile.current_api_config;
    const apiConfig = ttsProfile.api_configs[apiConfigName];
    const speakerName = speakerProfileSelect.val();

    if (!apiConfig) {
        toastr.error("未选择有效的 API 配置。");
        return;
    }
    if (!speakerName) {
        toastr.warning("没有选中的音色配置。");
        return;
    }

    if (Object.keys(apiConfig.speakers).length <= 1) {
        toastr.error("不能删除最后一个音色配置。");
        return;
    }

    if (confirm(`你确定要从 API "${apiConfigName}" 删除音色配置 "${speakerName}" 吗？`)) {
        delete apiConfig.speakers[speakerName];
        apiConfig.current_speaker_profile = Object.keys(apiConfig.speakers)[0];
        saveSettingsDebounced();
        loadSpeakerProfiles();
        toastr.success(`音色配置 "${speakerName}" 已删除。`);
    }
}

/**
 * Exports the selected speaker profile.
 */
function onExportSpeakerProfileClick() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = ttsProfile.current_api_config;
    const apiConfig = ttsProfile.api_configs[apiConfigName];
    const speakerName = speakerProfileSelect.val();

    if (!apiConfig || !speakerName) {
        toastr.warning("没有选中的音色配置可导出。");
        return;
    }

    const speakerData = { [speakerName]: apiConfig.speakers[speakerName] };
    const blob = new Blob([JSON.stringify(speakerData, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_is_speaker_profile_${speakerName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Exports all speaker profiles.
 */
function onExportAllSpeakerProfilesClick() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = ttsProfile.current_api_config;
    const apiConfig = ttsProfile.api_configs[apiConfigName];
    const allSpeakers = apiConfig.speakers;

    if (!apiConfig || !allSpeakers || Object.keys(allSpeakers).length === 0) {
        toastr.warning("当前 API 配置下没有音色配置可导出。");
        return;
    }

    const blob = new Blob([JSON.stringify(allSpeakers, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_is_all_speaker_profiles_for_${apiConfigName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Imports speaker profiles from a JSON file.
 */
function onImportSpeakerProfileClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedSpeakers = JSON.parse(e.target.result);
                    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
                    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
                    const apiConfigName = ttsProfile.current_api_config;
                    const apiConfig = ttsProfile.api_configs[apiConfigName];

                    if (!apiConfig) {
                        toastr.error("未选择有效的 API 配置，无法导入。");
                        return;
                    }

                    let importedCount = 0;
                    let overwrittenCount = 0;
                    for (const name in importedSpeakers) {
                        if (Object.prototype.hasOwnProperty.call(importedSpeakers, name)) {
                            if (apiConfig.speakers[name]) {
                                overwrittenCount++;
                            }
                            apiConfig.speakers[name] = importedSpeakers[name];
                            importedCount++;
                        }
                    }
                    saveSettingsDebounced();
                    loadSpeakerProfiles();
                    let message = `成功导入 ${importedCount} 个音色配置到 API "${apiConfigName}"。`;
                    if (overwrittenCount > 0) {
                        message += `（覆盖了 ${overwrittenCount} 个同名配置）`;
                    }
                    toastr.success(message);
                } catch (error) {
                    toastr.error("导入失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

/**
 * Loads character matching profiles into the dropdown.
 */
function loadCharMatchProfiles() {
    const profiles = extension_settings[extensionName].tts_character_matching_profiles || {};
    const currentProfileName = extension_settings[extensionName].current_tts_character_matching_profile;

    ttsCharMatchProfileSelect.empty();
    Object.keys(profiles).forEach(name => {
        const option = new Option(name, name, name === currentProfileName, name === currentProfileName);
        ttsCharMatchProfileSelect.append(option);
    });

    if (ttsCharMatchProfileSelect.val()) {
        ttsCharMatchProfileSelect.trigger('change');
    } else if (Object.keys(profiles).length > 0) {
        const firstName = Object.keys(profiles)[0];
        ttsCharMatchProfileSelect.val(firstName);
        ttsCharMatchProfileSelect.trigger('change');
    }
}

/**
 * Handles the change event of the character matching profile selection.
 */
function onCharMatchProfileChange() {
    const profileName = $(this).val();
    if (!profileName) return;

    const profiles = extension_settings[extensionName].tts_character_matching_profiles;
    const rules = profiles[profileName];

    if (rules !== undefined) {
        ttsCharMatchRulesEditor.val(rules);
        extension_settings[extensionName].current_tts_character_matching_profile = profileName;
        saveSettingsDebounced();
    }
}

/**
 * Saves the current character matching profile.
 */
function onSaveCharMatchProfileClick() {
    const profileName = ttsCharMatchProfileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的匹配设定。");
        return;
    }

    const rules = ttsCharMatchRulesEditor.val();
    extension_settings[extensionName].tts_character_matching_profiles[profileName] = rules;
    saveSettingsDebounced();
    toastr.success(`匹配设定 "${profileName}" 已保存。`);
}

/**
 * Saves the current character matching rules as a new profile.
 */
function onSaveAsCharMatchProfileClick() {
    const newName = prompt("请输入新的匹配设定名称：");
    if (!newName || newName.trim() === '') {
        toastr.warning("名称不能为空。");
        return;
    }

    const profiles = extension_settings[extensionName].tts_character_matching_profiles;
    if (profiles[newName]) {
        toastr.error(`匹配设定 "${newName}" 已存在。`);
        return;
    }

    profiles[newName] = ttsCharMatchRulesEditor.val();
    extension_settings[extensionName].current_tts_character_matching_profile = newName;

    saveSettingsDebounced();
    toastr.success(`匹配设定 "${newName}" 已创建并选中。`);
    loadCharMatchProfiles();
}

/**
 * Deletes the currently selected character matching profile.
 */
function onDeleteCharMatchProfileClick() {
    const profileName = ttsCharMatchProfileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的匹配设定。");
        return;
    }

    const profiles = extension_settings[extensionName].tts_character_matching_profiles;
    if (Object.keys(profiles).length <= 1) {
        toastr.error("不能删除最后一个匹配设定。");
        return;
    }

    if (confirm(`你确定要删除匹配设定 "${profileName}" 吗？`)) {
        delete profiles[profileName];
        extension_settings[extensionName].current_tts_character_matching_profile = Object.keys(profiles)[0];
        saveSettingsDebounced();
        loadCharMatchProfiles();
        toastr.success(`匹配设定 "${profileName}" 已删除。`);
    }
}

/**
 * Exports the selected character matching profile.
 */
function onExportCharMatchProfileClick() {
    const profileName = ttsCharMatchProfileSelect.val();
    if (!profileName) {
        toastr.warning("没有选中的匹配设定可导出。");
        return;
    }

    const profileData = { [profileName]: extension_settings[extensionName].tts_character_matching_profiles[profileName] };
    const blob = new Blob([JSON.stringify(profileData, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_is_char_match_profile_${profileName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Exports all character matching profiles.
 */
function onExportAllCharMatchProfilesClick() {
    const allProfiles = extension_settings[extensionName].tts_character_matching_profiles;

    if (!allProfiles || Object.keys(allProfiles).length === 0) {
        toastr.warning("没有匹配设定可导出。");
        return;
    }

    const blob = new Blob([JSON.stringify(allProfiles, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st_is_all_char_match_profiles.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Imports character matching profiles from a JSON file.
 */
function onImportCharMatchProfileClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedProfiles = JSON.parse(e.target.result);
                    const profiles = extension_settings[extensionName].tts_character_matching_profiles;
                    let importedCount = 0;
                    for (const name in importedProfiles) {
                        if (Object.prototype.hasOwnProperty.call(importedProfiles, name)) {
                            profiles[name] = importedProfiles[name];
                            importedCount++;
                        }
                    }
                    saveSettingsDebounced();
                    loadCharMatchProfiles();
                    toastr.success(`成功导入 ${importedCount} 个匹配设定。`);
                } catch (error) {
                    toastr.error("导入失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

/**
 * Handles the TTS test button click.
 */
async function onTestTtsClick() {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
    const apiConfigName = ttsProfile.current_api_config;
    const apiConfig = ttsProfile.api_configs[apiConfigName];

    if (!apiConfig) {
        toastr.error("未找到当前选中的 API 配置。");
        return;
    }

    const appId = apiConfig.app_id;
    const accessKey = apiConfig.access_key;
    const speakerId = speakerIdInput.val();
    const speakerName = speakerProfileSelect.val();
    const resourceId = resourceIdSelect.val();
    const text = testTextInput.val();
    const contextTexts = contextTextsInput.val();

    if (!appId || !accessKey || !speakerId || !text) {
        toastr.warning("APP_ID, ACCESS_KEY, Speaker ID 和测试文本都不能为空。");
        return;
    }

    if (!speakerName) {
        toastr.warning("请选择一个音色配置。");
        return;
    }

    const textLength = text.length;
    const isSynthesis = resourceId === 'seed-tts-2.0';
    const quota = isSynthesis ? apiConfig.synthesis_quota : apiConfig.clone_quota;
    const quotaType = isSynthesis ? '合成' : '复刻';

    if (quota !== -1 && quota < textLength) {
        toastr.error(`API 配置 "${apiConfigName}" 的${quotaType}额度不足 (需要: ${textLength}, 剩余: ${quota})。`);
        return;
    }

    testButton.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 正在合成...');
    testResultAudio.hide();

    try {
        const cacheKey = generateTtsCacheKey(text, contextTexts, speakerId);
        const requestData = {
            cacheKey,
            appId,
            accessKey,
            speaker: speakerName,
            resourceId,
            text,
            context_texts: contextTexts,
            metadata: {
                speaker: speakerProfileSelect.find('option:selected').text() // Pass speaker name for UI
            },
            _ttsProfileName: ttsProfileName,
            _apiConfigName: apiConfigName,
        };

        // Force regenerate for testing
        const result = await initiateTtsRequest(requestData, true);

        if (result.audioUrl) {
            testResultAudio.attr('src', result.audioUrl);
            testResultAudio.show();
            toastr.success("语音合成成功！");
        } else {
            throw new Error("合成结果中没有找到 audioUrl。");
        }
    } catch (error) {
        console.error("TTS test failed:", error);
        const errorMessage = error.message || String(error);
        toastr.error(`语音合成失败: ${errorMessage}`);
    } finally {
        testButton.prop('disabled', false).html('<i class="fa-solid fa-microphone-lines"></i> 测试当前音色');
    }
}




/**
 * Finds the API config that a specific speaker belongs to.
 * @param {string} speakerId The speaker ID to search for.
 * @returns {object|null} The API config object or null if not found.
 */
export function getApiConfigForSpeaker(speakerId) {
    const ttsProfileName = extension_settings[extensionName].current_tts_profile;
    const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];

    for (const apiConfigName in ttsProfile.api_configs) {
        const apiConfig = ttsProfile.api_configs[apiConfigName];
        for (const speakerName in apiConfig.speakers) {
            if (apiConfig.speakers[speakerName].speaker_id === speakerId) {
                // Return a copy of the config with only necessary keys
                return {
                    app_id: apiConfig.app_id,
                    access_key: apiConfig.access_key,
                };
            }
        }
    }
    return null;
}

/**
 * Initializes the TTS settings tab.
 */
export function initTtsSettings() {
    // Cache DOM elements
    apiConfigProfileSelect = $('#tts_api_config_profile_select');
    apiConfigProfileNameInput = $('#tts_api_config_profile_name');
    appIdInput = $('#tts_app_id');
    accessKeyInput = $('#tts_access_key');
    synthesisQuotaInput = $('#tts_synthesis_quota');
    cloneQuotaInput = $('#tts_clone_quota');
    speakerProfileSelect = $('#tts_speaker_profile_select');
    speakerProfileNameInput = $('#tts_speaker_profile_name');
    speakerIdInput = $('#tts_speaker_id');
    resourceIdSelect = $('#tts_resource_id_select');
    speakerDescriptionInput = $('#tts_speaker_description');
    testTextInput = $('#tts_test_text');
    contextTextsInput = $('#tts_context_texts');
    testButton = $('#tts_test_button');
    testResultAudio = $('#tts_test_result_audio');
    ttsCharMatchProfileSelect = $('#tts_char_match_profile_select');
    ttsCharMatchRulesEditor = $('#tts_char_match_rules_editor');

    // TTS Clone elements
    ttsCloneAudioFileInput = $('#tts_clone_audio_file_input');
    ttsCloneAudioFileButton = $('#tts_clone_audio_file_button');
    ttsCloneAudioFileName = $('#tts_clone_audio_file_name');
    ttsCloneButton = $('#tts_clone_button');

    // Bind API Config management listeners
    apiConfigProfileSelect.on('change', onApiConfigProfileChange);
    $('#save_api_config_profile_button').on('click', onSaveApiConfigProfileClick);
    $('#new_api_config_profile_button').on('click', onNewApiConfigProfileClick); // Changed from save_as
    $('#delete_api_config_profile_button').on('click', onDeleteApiConfigProfileClick);
    $('#import_api_config_profile_button').on('click', onImportApiConfigProfileClick);
    $('#export_api_config_profile_button').on('click', onExportApiConfigProfileClick);
    $('#export_all_api_config_profiles_button').on('click', onExportAllApiConfigProfilesClick);

    // Bind speaker profile management listeners
    speakerProfileSelect.on('change', onSpeakerProfileChange);
    $('#save_speaker_profile_button').on('click', onSaveSpeakerProfileClick);
    $('#new_speaker_profile_button').on('click', onNewSpeakerProfileClick); // Changed from save_as
    $('#delete_speaker_profile_button').on('click', onDeleteSpeakerProfileClick);
    $('#import_speaker_profile_button').on('click', onImportSpeakerProfileClick);
    $('#export_speaker_profile_button').on('click', onExportSpeakerProfileClick);
    $('#export_all_speaker_profiles_button').on('click', onExportAllSpeakerProfilesClick);

    // Bind character matching profile management listeners
    ttsCharMatchProfileSelect.on('change', onCharMatchProfileChange);
    $('#save_char_match_profile_button').on('click', onSaveCharMatchProfileClick);
    $('#save_as_char_match_profile_button').on('click', onSaveAsCharMatchProfileClick);
    $('#delete_char_match_profile_button').on('click', onDeleteCharMatchProfileClick);
    $('#import_char_match_profile_button').on('click', onImportCharMatchProfileClick);
    $('#export_char_match_profile_button').on('click', onExportCharMatchProfileClick);
    $('#export_all_char_match_profiles_button').on('click', onExportAllCharMatchProfilesClick);

    // Bind test button listener
    testButton.on('click', onTestTtsClick);

    // Bind clone button listeners
    ttsCloneAudioFileButton.on('click', () => ttsCloneAudioFileInput.trigger('click'));

    // Listen for external quota updates
    eventSource.on(eventNames.TTS_QUOTA_UPDATED, () => {
        const ttsProfileName = extension_settings[extensionName].current_tts_profile;
        const ttsProfile = extension_settings[extensionName].tts_profiles[ttsProfileName];
        const apiConfigName = apiConfigProfileSelect.val();
        const apiConfig = ttsProfile.api_configs[apiConfigName];

        if (apiConfig) {
            synthesisQuotaInput.val(apiConfig.synthesis_quota ?? -1);
            cloneQuotaInput.val(apiConfig.clone_quota ?? -1);
        }
    });

    // Initial load
    loadTtsSettings();
    loadCharMatchProfiles();
}

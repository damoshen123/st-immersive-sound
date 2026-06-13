// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName, extensionFolderPath, defaultSettings } from "./config.js";
import { masterGainNode, getAudioContext, musicGainNode, ambianceGainNode, sfxGainNode, sfx_waitGainNode, voiceGainNode } from "./audio-context.js";
import { stopAllAudio, playingList } from "./playback.js";
import { extensionName as immersiveSoundExtensionName } from './config.js';
import { initFloatBall, applyFloatBallSettings } from './ui-float-ball.js';
import { initVibrationSettings, loadVibrationProfiles, stopVibrationTest } from './ui-vibration.js';
import { initAudioManagement, onReloadAudioListClick } from './ui-audio-management.js';
import { initAudioResourcesSettings } from './ui-audio-resources.js';
import { initRegexSettings, loadRegexProfiles } from './ui-regex.js';
import { initTtsPreview, stopAllTtsPreview } from './ui-tts-preview.js';
import { initSfxPreview, stopAllSfxPreview } from './ui-sfx-preview.js';
import { initLLMSettings, loadLLMProfiles } from './ui-llm.js';
import { initTtsSettings, loadApiConfigProfiles } from './ui-tts.js';
import { initEdgeTtsSettings } from './ui-edge-tts.js';
import { initMinimaxSettings } from './ui-minimax.js';
import { initNimoSettings } from './ui-nimo.js';
import { initMinimaxMusicSettings } from './ui-minimax-music.js';
import { initThemeSettings, switchTheme, updateThemeToggleButton, loadThemeSettings } from './ui-theme.js';
import { initEffectsProcessorUI } from './ui-effects-processor.js';
import { effectsProcessor } from "./effects-processor.js";
import { initLogTab } from './ui-log.js';
import { showSettingsPanel, hideSettingsPanel } from './ui_common.js';
import { initUpdateCheck, checkUpdateFunction } from './update.js';

function onEnablePluginInput(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[immersiveSoundExtensionName].enable_plugin = value;
    console.log("设置被更改");
    if (!value) {
        stopAllAudio();
    }
    saveSettingsDebounced();
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

function setupPannerControls(type) {
    const settings = extension_settings[immersiveSoundExtensionName];
    const controls = ['refDistance', 'maxDistance', 'rolloffFactor', 'posX', 'posY', 'posZ'];

    const updatePanner = () => {
        const values = {};
        controls.forEach(control => {
            const value = parseFloat($(`#${type}_${control}`).val());
            values[control] = value;
            settings[`${type}_${control}`] = value;
        });

        // Instead of a single pannerNode, update all relevant playing sounds
        for (const key in playingList) {
            if (playingList.hasOwnProperty(key)) {
                const item = playingList[key];
                // Check if the item's type matches and if it has a panner
                if (item.type && item.type.toLowerCase() === type && item.chainWrapper && item.chainWrapper.panner) {
                    const panner = item.chainWrapper.panner;
                    panner.refDistance = values.refDistance;
                    panner.maxDistance = values.maxDistance;
                    panner.rolloffFactor = values.rolloffFactor;
                    // Tone.Panner3D uses signal-like objects for position
                    if (panner.positionX) panner.positionX.value = values.posX;
                    if (panner.positionY) panner.positionY.value = values.posY;
                    if (panner.positionZ) panner.positionZ.value = values.posZ;
                }
            }
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

    const initialValue = settings[settingName] ?? 1;
    slider.val(initialValue);
    valueDisplay.val(parseFloat(initialValue).toFixed(2));
    if (gainNode) gainNode.gain.value = initialValue;

    const updateVolume = () => {
        const newValue = parseFloat(slider.val());

        // Update the global gain node for the type (e.g., musicGainNode, sfxGainNode)
        if (gainNode) {
            gainNode.gain.value = newValue;
        }
        
        // Store the new value in settings
        settings[settingName] = newValue;
        
        // The logic to update individual tracks is no longer needed here.
        // The audio context graph now correctly handles volume changes:
        // Individual Sound's GainNode (base volume) -> Type GainNode -> Master GainNode
        // By updating the Type or Master GainNode above, all relevant sounds are affected automatically.

        saveSettingsDebounced();
    };

    slider.on('input', () => {
        valueDisplay.val(parseFloat(slider.val()).toFixed(2));
        updateVolume();
    });

    valueDisplay.on('input', () => {
        slider.val(valueDisplay.val());
        updateVolume();
    });
}

async function loadSettings(apply = true) {

    // Ensure the settings object exists
    extension_settings[immersiveSoundExtensionName] = extension_settings[immersiveSoundExtensionName] || {};
    const settings = extension_settings[immersiveSoundExtensionName];

    // --- MIGRATION LOGIC START ---
    if (settings.tts_profiles) {
        Object.values(settings.tts_profiles).forEach(profile => {
            // Migration 1: Old top-level api_key to nested api_configs
            if (profile.app_id !== undefined && profile.access_key !== undefined && !profile.api_configs) {
                console.log(`[st-is] Migrating old TTS API keys for profile '${profile.name}'...`);
                profile.api_configs = {
                    "默认": {
                        "app_id": profile.app_id,
                        "access_key": profile.access_key,
                        "synthesis_quota": -1, // Add default quotas
                        "clone_quota": -1
                    }
                };
                profile.current_api_config = "默认";
                delete profile.app_id;
                delete profile.access_key;
            }

            // Migration 2: Move speakers from profile root to inside each api_config
            if (profile.speakers && profile.api_configs) {
                console.log(`[st-is] Migrating speakers to be nested under API configs for profile '${profile.name}'...`);
                const speakersToMove = JSON.parse(JSON.stringify(profile.speakers));
                const currentSpeakerProfile = profile.current_speaker_profile;

                Object.values(profile.api_configs).forEach(apiConfig => {
                    // Only migrate if the api_config doesn't already have speakers
                    if (!apiConfig.speakers) {
                        apiConfig.speakers = JSON.parse(JSON.stringify(speakersToMove));
                        apiConfig.current_speaker_profile = currentSpeakerProfile;
                    }
                });

                // Clean up the old speaker data from the profile root
                delete profile.speakers;
                delete profile.current_speaker_profile;
                console.log(`[st-is] Speaker migration complete for profile '${profile.name}'.`);
            }
        });
        // After migration, it's a good idea to save the updated settings
        saveSettingsDebounced();
    }

    // --- IR MIGRATION LOGIC ---
    // This logic clears out large base64 IR data from settings to improve performance.
    if (settings.effectsProcessor && settings.effectsProcessor.irProfiles) {
        let irMigrated = false;
        for (const profileName in settings.effectsProcessor.irProfiles) {
            const profile = settings.effectsProcessor.irProfiles[profileName];
            if (!profile) continue;
            // 只有"还携带 base64 irData 的旧 profile"才需要迁移；
            // fileName 为空是「无 IR」占位的合法状态（如 "默认 (无)"），不能动。
            if (profile.irData) {
                console.log(`[st-is-migration] Migrating IR profile: "${profileName}".`);
                profile.irData = null;
                if (!profile.fileName) profile.fileName = `${profileName}.wav`;
                irMigrated = true;
            }
        }
        // 一次性修正：旧版迁移逻辑曾把「默认 (无)」的 fileName 写成 "默认 (无).wav"，
        // 导致每次播放都尝试 fetch 不存在的文件。这里恢复为占位状态。
        const noIr = settings.effectsProcessor.irProfiles['默认 (无)'];
        if (noIr && noIr.fileName === '默认 (无).wav') {
            console.log('[st-is-migration] 修正「默认 (无)」profile 的 fileName。');
            noIr.fileName = '';
            irMigrated = true;
        }
        if (irMigrated) {
            console.log('[st-is-migration] IR data migration complete. Settings will be saved.');
            saveSettingsDebounced();
        }
    }
    // --- MIGRATION LOGIC END ---

    for (const key in defaultSettings) {
        if (!Object.prototype.hasOwnProperty.call(settings, key)) {
            settings[key] = JSON.parse(JSON.stringify(defaultSettings[key]));
        }
    }


    console.log("设置被加载", settings);

    $("#enable_plugin").prop("checked", settings.enable_plugin);
    

    const highlightColor = settings.highlightColor || '#007BFF';
    const highlightOpacity = settings.highlightOpacity ?? 0.4;
    const textColor = settings.textColor || '#FFFFFF';
    $("#highlightColor").val(highlightColor);
    $("#textColor").val(textColor);
    $("#highlightOpacity").val(highlightOpacity);
    $("#highlightOpacity_value").val(highlightOpacity);

    const readingSpeed = settings.readingSpeed;
    $("#readingSpeed").val(readingSpeed);
    $("#readingSpeed_value").val(readingSpeed);

    $("#musicStartsWithParagraph").prop("checked", settings.musicStartsWithParagraph);
    $("#seamlessMusic").prop("checked", settings.seamlessMusic);
    $("#compatibility_edge").prop("checked", !!settings.compatibility_edge);
    $("#tts_request_balancing").prop("checked", settings.tts_request_balancing);
    $("#offline_rendering_enabled").prop("checked", settings.offline_rendering_enabled);
    $("#enable_lyrics_player").prop("checked", settings.enable_lyrics_player);
    $("#enable_tts_voice").prop("checked", settings.enable_tts_voice);
    $("#enable_narration_tts").prop("checked", settings.enable_narration_tts);
    $("#voice_tts_provider").val(settings.voice_tts_provider || 'doubao');
    $("#narration_engine").val(settings.narration_engine || 'edge');
    $("#nimoCloneStorage").val(settings.nimoCloneStorage || 'browser');

    $("#enable3dAudio_music").prop("checked", settings.enable3dAudio_music);
    $("#enable3dAudio_ambiance").prop("checked", settings.enable3dAudio_ambiance);

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

    const volumeTypes = ['master', 'music', 'ambiance', 'sfx', 'sfx_wait', 'voice'];
    volumeTypes.forEach(type => {
        const volume = settings[`${type}Volume`];
        $(`#${type}Volume`).val(volume);
        $(`#${type}Volume_value`).val(volume);
    });

    $("#enable_vibration").prop("checked", settings.enable_vibration);
    
    loadVibrationProfiles();

    // Load Float Ball settings
    $("#enable_float_ball").prop("checked", settings.enable_float_ball);
    $("#float_ball_bg_color").val(settings.float_ball_bg_color);
    $("#float_ball_icon_color").val(settings.float_ball_icon_color);
    $("#float_ball_opacity").val(settings.float_ball_opacity);
    $("#float_ball_opacity_value").val(settings.float_ball_opacity);
    $("#float_ball_size").val(settings.float_ball_size);
    $("#float_ball_size_value").val(settings.float_ball_size);

    // Load Voice Ducking settings
    $("#voiceDuckingEnabled").prop("checked", settings.voiceDuckingEnabled);
    $("#voiceDuckingPercentage").val(settings.voiceDuckingPercentage);
    $("#voiceDuckingPercentage_value").val(settings.voiceDuckingPercentage);
    $("#voiceDuckingFadeTime").val(settings.voiceDuckingFadeTime);
    $("#voiceDuckingFadeTime_value").val(settings.voiceDuckingFadeTime);

    if (apply) {
        // Panner settings are now applied dynamically when a sound is created or modified.
        // We only need to set the global gain node values here.
        masterGainNode.gain.value = settings.masterVolume;
        musicGainNode.gain.value = settings.musicVolume;
        ambianceGainNode.gain.value = settings.ambianceVolume;
        sfxGainNode.gain.value = settings.sfxVolume;
        sfx_waitGainNode.gain.value = settings.sfx_waitVolume;
        voiceGainNode.gain.value = settings.voiceVolume;
    }
}

function onRestoreDefaultSettingsClick() {
    if (confirm("你确定要恢复默认设置吗？")) {
        // Use Object.assign to preserve the object reference
      Object.assign(extension_settings[immersiveSoundExtensionName], JSON.parse(JSON.stringify(defaultSettings)));

       saveSettingsDebounced();
       loadSettings(true);
        
        // Explicitly update UI components that depend on settings
        applyFloatBallSettings();
        loadThemeSettings();

        // Explicitly update UI components that depend on settings
        applyFloatBallSettings();
        loadLLMProfiles();
        loadApiConfigProfiles();
        loadRegexProfiles();
        initAudioResourcesSettings();

        const ball = $('#st-is-float-ball');
        if (ball.length) {
            ball.get(0).style.top = '';
            ball.get(0).style.left = '';
        }

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

                    const mode = prompt(
                        "请选择导入模式：\n" +
                        "1. 覆盖全部（初始化，覆盖所有API和设置）\n" +
                        "2. 保留API设置（推荐，仅更新常规配置，会更新上下文预设）\n\n" +
                        "请输入数字 (1 或 2)：", "1"
                    );

                    if (mode !== "1" && mode !== "2") {
                        toastr.info("已取消导入。");
                        return;
                    }

                    if (mode === "1") {
                        if (!confirm("警告：您选择了【覆盖全部】！\n这将覆盖您现有的所有 API Key 和配置！\n二次确认：确定要完全覆盖吗？")) {
                            toastr.info("已取消导入。");
                            return;
                        }
                        Object.assign(extension_settings[immersiveSoundExtensionName], importedSettings);
                    } else if (mode === "2") {
                        if (!confirm("二次确认：即将保留您的关键 API 配置并导入其他设置（会更新上下文预设）。确定要继续吗？")) {
                            toastr.info("已取消导入。");
                            return;
                        }
                        
                        const apiKeys = [
                            "llm_profiles",
                            "current_llm_profile",
                            "tts_profiles",
                            "current_tts_profile",
                            "edge_tts",
                            "minimax",
                            "nimo",
                            "minimax_music",
                            "edge_character_matching_profiles",
                            "current_edge_character_matching_profile",
                            "tts_character_matching_profiles",
                            "current_tts_character_matching_profile",
                            "minimax_character_matching_profiles",
                            "current_minimax_character_matching_profile",
                            "nimo_character_matching_profiles",
                            "current_nimo_character_matching_profile",
                            "voice_tts_provider",
                            "narration_engine"
                        ];

                        const currentSettings = extension_settings[immersiveSoundExtensionName];
                        const backup = {};
                        apiKeys.forEach(key => {
                            if (currentSettings[key] !== undefined) {
                                backup[key] = currentSettings[key];
                            }
                        });

                        Object.assign(currentSettings, importedSettings);

                        apiKeys.forEach(key => {
                            if (backup[key] !== undefined) {
                                currentSettings[key] = backup[key];
                            } else {
                                delete currentSettings[key];
                            }
                        });
                    }

                    saveSettingsDebounced();
                    loadSettings(true);
                    
                    // Explicitly update UI components that depend on settings
                    applyFloatBallSettings();
                    loadThemeSettings();
                    loadLLMProfiles();
                    loadApiConfigProfiles();
                    loadRegexProfiles();
                    initAudioResourcesSettings();
                    
                    toastr.success("设置已导入。");
                } catch (error) {
                    console.error("[ST-IS] Import settings error:", error);
                    toastr.error("导入设置失败，文件格式无效。");
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

// Tab partial files under html/settings/<tabId>.html
// Order is the same as the sidebar nav, so the rendered DOM order matches the nav order.
const SETTINGS_TAB_IDS = [
    'main',
    'sleep-aid',
    'volume',
    'regex',
    'llm',
    'tts',
    'edge-tts',
    'minimax',
    'minimax-music',
    'nimo',
    'tts-preview',
    'sfx-preview',
    'effects-processor',
    '3d-sound',
    'vibration',
    'cache',
    'audio-resources',
    'float-ball',
    'theme',
    'log',
    'about',
];

async function loadSettingsTabPartials(container) {
    const fetches = SETTINGS_TAB_IDS.map(async (tabId) => {
        const res = await fetch(`${extensionFolderPath}/html/settings/${tabId}.html`);
        if (!res.ok) throw new Error(`Failed to fetch html/settings/${tabId}.html: ${res.status}`);
        return res.text();
    });
    const htmlChunks = await Promise.all(fetches);
    container.innerHTML = htmlChunks.join('\n');
}

export async function initUI(callbacks = {}) {
    // 移除可能存在的旧 modal，避免热重载后 DOM 里出现两份相同 id 的元素
    $('#st-immersive-sound-settings-modal').remove();
    const settingsHtml = await $.get(`${extensionFolderPath}/example.html`);
    $("body").append(settingsHtml);

    const tabContentContainer = document.querySelector('#st-immersive-sound-settings-modal .st-is-content');
    if (tabContentContainer) {
        try {
            await loadSettingsTabPartials(tabContentContainer);
        } catch (e) {
            console.error('[ST-IS] Failed to load settings tab partials:', e);
            tabContentContainer.innerHTML = `<p style="color:red;text-align:center;margin-top:20px;">错误：无法加载设置页面分片，请检查浏览器控制台。</p>`;
        }
    } else {
        console.error('[ST-IS] .st-is-content container not found in example.html shell');
    }

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
    $("#toggle_theme_button").on("click", () => {
        const currentTheme = extension_settings[immersiveSoundExtensionName].theme_id;
        const targetTheme = currentTheme === '默认-白天' ? '默认-夜间' : '默认-白天';
        switchTheme(targetTheme);
    });
    $("#update_plugin_button").on("click", checkUpdateFunction);

    const settingsModal = $('#st-immersive-sound-settings-modal');

    window.showYinXiaoSettingsPanel = () => {
        showSettingsPanel();
        if ($('.st-is-nav-link[data-tab="cache"]').hasClass('active')) {
            onReloadAudioListClick();
        }
    };

    $('#st-immersive-sound-settings-modal-close').on('click', () => {
        hideSettingsPanel();
    });

    $('.st-is-nav-link').on('click', function(e) {
        e.preventDefault();
        const tab = $(this).data('tab');
        $('.st-is-nav-link').removeClass('active');
        $(this).addClass('active');
        $('.st-is-tab-content').removeClass('active');
        $(`#st-is-tab-${tab}`).addClass('active');

        extension_settings[immersiveSoundExtensionName].lastTab = tab;
        saveSettingsDebounced();
    });

    initAudioManagement();
    initAudioResourcesSettings();

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

    $('#musicStartsWithParagraph').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].musicStartsWithParagraph = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#seamlessMusic').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].seamlessMusic = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#compatibility_edge').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].compatibility_edge = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#tts_request_balancing').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].tts_request_balancing = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#voiceDuckingEnabled').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].voiceDuckingEnabled = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#voiceDuckingPercentage').on('input', (event) => {
        const value = parseInt($(event.target).val(), 10);
        $('#voiceDuckingPercentage_value').val(value);
        extension_settings[immersiveSoundExtensionName].voiceDuckingPercentage = value;
        saveSettingsDebounced();
    });

    $('#voiceDuckingPercentage_value').on('input', (event) => {
        const value = parseInt($(event.target).val(), 10);
        $('#voiceDuckingPercentage').val(value);
        extension_settings[immersiveSoundExtensionName].voiceDuckingPercentage = value;
        saveSettingsDebounced();
    });

    $('#voiceDuckingFadeTime').on('input', (event) => {
        const value = parseFloat($(event.target).val());
        $('#voiceDuckingFadeTime_value').val(value.toFixed(1));
        extension_settings[immersiveSoundExtensionName].voiceDuckingFadeTime = value;
        saveSettingsDebounced();
    });

    $('#voiceDuckingFadeTime_value').on('input', (event) => {
        const value = parseFloat($(event.target).val());
        $('#voiceDuckingFadeTime').val(value);
        extension_settings[immersiveSoundExtensionName].voiceDuckingFadeTime = value;
        saveSettingsDebounced();
    });

    $('#offline_rendering_enabled').on('change', (event) => {
        const isEnabled = $(event.target).prop('checked');
        extension_settings[immersiveSoundExtensionName].offline_rendering_enabled = isEnabled;
        saveSettingsDebounced();
        if (isEnabled) {
            toastr.info('离线渲染已启用。');
        }
    });

    $('#enable_lyrics_player').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].enable_lyrics_player = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#enable_tts_voice').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].enable_tts_voice = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#enable_narration_tts').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].enable_narration_tts = $(event.target).prop('checked');
        saveSettingsDebounced();
    });

    $('#voice_tts_provider').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].voice_tts_provider = $(event.target).val();
        saveSettingsDebounced();
    });

    $('#narration_engine').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].narration_engine = $(event.target).val() || 'edge';
        saveSettingsDebounced();
    });

    $('#nimoCloneStorage').on('change', (event) => {
        extension_settings[immersiveSoundExtensionName].nimoCloneStorage = $(event.target).val() || 'browser';
        saveSettingsDebounced();
    });


    function setup3dAudioToggle(type) {
        const checkbox = $(`#enable3dAudio_${type}`);
        const settingName = `enable3dAudio_${type}`;

        checkbox.on('change', (event) => {
            const isEnabled = $(event.target).prop('checked');
            extension_settings[immersiveSoundExtensionName][settingName] = isEnabled;
            saveSettingsDebounced();

            // The logic to enable/disable 3D audio is now handled within the 
            // createPlaybackChain function in playback-node-manager.js.
            // When a new sound of this type is played, it will automatically
            // use the updated setting. We no longer need to manually rewire
            // existing audio nodes, which was complex and error-prone.
        });
    }

    setup3dAudioToggle('music');
    setup3dAudioToggle('ambiance');

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

    setupVolumeControl('master', masterGainNode);
    setupVolumeControl('music', musicGainNode);
    setupVolumeControl('ambiance', ambianceGainNode);
    setupVolumeControl('sfx', sfxGainNode);
    setupVolumeControl('sfx_wait', sfx_waitGainNode);
    setupVolumeControl('voice', voiceGainNode);

    setupPannerControls('music');
    setupPannerControls('ambiance');

    // 使用 setTimeout 延迟执行 loadSettings，以确保动态加载的 HTML 元素已经渲染完毕。
    // 这是为了解决在某些移动浏览器上，DOM 渲染速度跟不上 JS 执行速度导致的竞态条件问题。
    setTimeout(() => {
        loadSettings();
    }, 300); // 100毫秒的延迟对于绝大多数设备来说都足够了。

    document.getElementById('stopButton').addEventListener('click', () => {
        let marker = window.marker;
        if (typeof window.cancelImmersiveSoundSession === 'function') {
            window.cancelImmersiveSoundSession();
        } else {
            stopAllAudio(marker);
        }
        effectsProcessor.stopPlayback();
        stopVibrationTest(); // 停止任何正在进行的震动测试
        // 同步停止预览界面（音频预览 / 音效预览）中的播放
        Promise.resolve(stopAllTtsPreview?.()).catch(err => console.warn('stopAllTtsPreview failed:', err));
        Promise.resolve(stopAllSfxPreview?.()).catch(err => console.warn('stopAllSfxPreview failed:', err));

        window.marker = null;
    });

    initVibrationSettings();
    initFloatBall();
    initRegexSettings();
    initLLMSettings();
    initTtsSettings();
    initEdgeTtsSettings();
    initMinimaxSettings();
    initMinimaxMusicSettings();
    initNimoSettings();
    initTtsPreview();
    initSfxPreview();
    initThemeSettings(settingsModal);
    initLogTab();
    initEffectsProcessorUI();
    updateThemeToggleButton(extension_settings[immersiveSoundExtensionName].theme_id);
    initUpdateCheck(settingsModal);
}

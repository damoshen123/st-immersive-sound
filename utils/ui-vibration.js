import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName } from "./config.js";
import { getAudioContext } from "./audio-context.js";

let vibrationInterval = null; // 用于跟踪循环震动测试

/**
 * 停止任何正在进行的震动测试。
 */
export function stopVibrationTest() {
    if (vibrationInterval) {
        clearInterval(vibrationInterval);
        vibrationInterval = null;
        if (navigator.vibrate) {
            navigator.vibrate(0); // 发送一个0值来停止任何当前的震动
        }
    }
}

// 解析震动模式字符串，支持数字或数组格式
export function parseVibrationValue(valueString, defaultValue) {
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
            console.warn(`无法将震动值解析为数组: ${valueString}`, e);
        }
    }
    const num = parseInt(valueString, 10);
    if (!isNaN(num)) {
        return num;
    }
    return defaultValue;
}

// 加载震动配置到下拉菜单
export function loadVibrationProfiles() {
    const settings = extension_settings[extensionName];
    const profiles = settings.vibration_profiles || {};
    const select = $('#vibration_profile_select');
    const currentProfileName = settings.current_vibration_profile || '默认';

    select.empty(); // 清空现有选项

    // 确保“默认”配置存在
    if (!profiles['默认']) {
        profiles['默认'] = [0, 100, 50, 100, 50];
    }

    for (const name in profiles) {
        const option = $('<option></option>').val(name).text(name);
        if (name === currentProfileName) {
            option.prop('selected', true);
        }
        select.append(option);
    }

    // 触发change事件以加载当前配置的模式
    select.trigger('change');
}

// 保存当前选中的震动配置
function saveCurrentVibrationProfile() {
    const settings = extension_settings[extensionName];
    const selectedProfile = $('#vibration_profile_select').val();
    const patternString = $('#vibration_pattern_editor').val().trim();

    if (!selectedProfile) {
        toastr.error("没有选中的震动配置。");
        return;
    }

    try {
        const pattern = JSON.parse(patternString);
        if (Array.isArray(pattern)) {
            settings.vibration_profiles[selectedProfile] = pattern;
            saveSettingsDebounced();
            toastr.success(`震动配置 "${selectedProfile}" 已保存。`);
        } else {
            toastr.error("保存失败：震动模式必须是一个数组。");
        }
    } catch (e) {
        toastr.error(`保存失败：无效的JSON格式。 ${e.message}`);
    }
}

// 初始化震动设置相关的所有UI事件
export function initVibrationSettings() {
    const settings = extension_settings[extensionName];

    // 启用/禁用震动开关
    $('#enable_vibration').on('change', function() {
        settings.enable_vibration = $(this).prop('checked');
        saveSettingsDebounced();
    });

    // 下拉菜单切换事件
    $('#vibration_profile_select').on('change', function() {
        const profileName = $(this).val();
        if (profileName && settings.vibration_profiles[profileName]) {
            settings.current_vibration_profile = profileName;
            const pattern = settings.vibration_profiles[profileName];
            $('#vibration_pattern_editor').val(JSON.stringify(pattern, null, 2));
            saveSettingsDebounced();
        }
    });

    // 新建配置按钮
    $('#new_vibration_profile_button').on('click', function() {
        const newName = prompt("请输入新的震动配置名称:", "新配置");
        if (newName && !settings.vibration_profiles[newName]) {
            settings.vibration_profiles[newName] = [1, 200, 100]; // 默认循环模式
            settings.current_vibration_profile = newName;
            saveSettingsDebounced();
            loadVibrationProfiles(); // 重新加载下拉菜单
            toastr.success(`已创建新配置 "${newName}"。`);
        } else if (newName) {
            toastr.error(`配置名称 "${newName}" 已存在。`);
        }
    });

    // 保存配置按钮
    $('#save_vibration_profile_button').on('click', saveCurrentVibrationProfile);

    // 重命名配置按钮
    $('#rename_vibration_profile_button').on('click', function() {
        const oldName = $('#vibration_profile_select').val();
        if (!oldName || oldName === '默认') {
            toastr.warning("不能重命名“默认”配置。");
            return;
        }
        const newName = prompt(`重命名配置 "${oldName}":`, oldName);
        if (newName && newName !== oldName && !settings.vibration_profiles[newName]) {
            settings.vibration_profiles[newName] = settings.vibration_profiles[oldName];
            delete settings.vibration_profiles[oldName];
            settings.current_vibration_profile = newName;
            saveSettingsDebounced();
            loadVibrationProfiles();
            toastr.success(`配置已重命名为 "${newName}"。`);
        } else if (newName) {
            toastr.error(`无法重命名：新名称 "${newName}" 无效或已存在。`);
        }
    });

    // 删除配置按钮
    $('#delete_vibration_profile_button').on('click', function() {
        const profileName = $('#vibration_profile_select').val();
        if (!profileName || profileName === '默认') {
            toastr.warning("不能删除“默认”配置。");
            return;
        }
        if (confirm(`你确定要删除震动配置 "${profileName}" 吗？`)) {
            delete settings.vibration_profiles[profileName];
            settings.current_vibration_profile = '默认';
            saveSettingsDebounced();
            loadVibrationProfiles();
            toastr.success(`配置 "${profileName}" 已删除。`);
        }
    });

    // 测试震动按钮
    $('#test_vibration_button').on('click', function() {
        // On mobile, user interaction is required to enable audio/vibration.
        // Resuming the audio context here can help enable vibration.
        const context = getAudioContext();
        if (context && context.state === 'suspended') {
            context.resume();
        }

        if (!navigator.vibrate) {
            toastr.warning("您的浏览器不支持震动功能。");
            return;
        }

        // 如果测试已在运行，则停止并返回
        if (vibrationInterval) {
            stopVibrationTest();
            toastr.info("已停止循环震动测试。");
            return;
        }

        const patternString = $('#vibration_pattern_editor').val().trim();
        try {
            const pattern = JSON.parse(patternString);
            if (!Array.isArray(pattern) || pattern.length < 2) {
                 toastr.error("测试失败：震动模式必须是至少包含两个数字的数组 (例如 [0, 100])。");
                 return;
            }
            
            const loop = pattern[0] === 1;
            const vibratePattern = pattern.slice(1);

            if (loop) {
                const cycleDuration = vibratePattern.reduce((sum, duration) => sum + duration, 0);
                const intervalDuration = cycleDuration > 0 ? cycleDuration + 50 : 50; // 加50ms缓冲

                const performVibration = () => {
                    if (navigator.vibrate) {
                        navigator.vibrate(vibratePattern);
                    }
                };
                
                performVibration(); // 立即开始
                vibrationInterval = setInterval(performVibration, intervalDuration);
                
                toastr.info("正在测试循环震动...再次点击“测试震动”或主“停止”按钮可停止。");
            } else {
                navigator.vibrate(vibratePattern);
                toastr.info("正在测试单次震动...");
            }

        } catch (e) {
            toastr.error(`测试失败：无效的JSON格式。 ${e.message}`);
        }
    });

    // 初始加载
    loadVibrationProfiles();
}

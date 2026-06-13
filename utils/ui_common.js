// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName, defaultSettings } from './config.js';

/**
 * Creates a standardized UI for managing profiles (e.g., for regex, vibration, etc.).
 * @param {object} options - Configuration options for the profile UI.
 * @param {string} options.type - The unique identifier for this profile type (e.g., 'regex', 'vibration').
 * @param {object} options.profiles - The object from extension_settings that holds the profiles.
 * @param {string} options.currentProfileKey - The key in extension_settings that stores the current profile name.
 * @param {JQuery} options.profileSelectElement - The jQuery element for the <select> dropdown.
 * @param {JQuery} options.newButtonElement - The jQuery element for the 'New' button.
 * @param {JQuery} options.saveButtonElement - The jQuery element for the 'Save' button.
 * @param {JQuery} options.renameButtonElement - The jQuery element for the 'Rename' button.
 * @param {JQuery} options.deleteButtonElement - The jQuery element for the 'Delete' button.
 * @param {function} options.onProfileLoad - Callback function executed when a profile is loaded.
 * @param {function} options.onProfileSave - Callback function executed when the current profile is saved.
 * @param {function} options.getNewProfileData - Function that returns a new, empty profile object.
 */
export function createProfileManagementUI(options) {
    const {
        type,
        profiles,
        currentProfileKey,
        profileSelectElement,
        newButtonElement,
        saveButtonElement,
        renameButtonElement,
        deleteButtonElement,
        onProfileLoad,
        onProfileSave,
        getNewProfileData
    } = options;

    const settings = extension_settings[extensionName];

    function populateProfileSelect() {
        profileSelectElement.empty();
        for (const profileName in profiles) {
            const option = new Option(profileName, profileName);
            profileSelectElement.append(option);
        }
        profileSelectElement.val(settings[currentProfileKey]);
    }

    function loadProfile(profileName) {
        if (profiles[profileName]) {
            settings[currentProfileKey] = profileName;
            populateProfileSelect();
            onProfileLoad(profiles[profileName]);
            saveSettingsDebounced();
        }
    }

    profileSelectElement.on('change', function() {
        const selectedProfile = $(this).val();
        loadProfile(selectedProfile);
    });

    newButtonElement.on('click', () => {
        const newProfileName = prompt(`输入新的 ${type} 预设名称:`);
        if (newProfileName && !profiles[newProfileName]) {
            profiles[newProfileName] = getNewProfileData();
            settings[currentProfileKey] = newProfileName;
            populateProfileSelect();
            onProfileLoad(profiles[newProfileName]);
            saveSettingsDebounced();
            toastr.success(`预设 "${newProfileName}" 已创建!`);
        } else if (profiles[newProfileName]) {
            toastr.error(`预设名称 "${newProfileName}" 已存在.`);
        }
    });

    saveButtonElement.on('click', () => {
        const currentProfileName = settings[currentProfileKey];
        if (currentProfileName) {
            onProfileSave(currentProfileName);
            // No need to call saveSettingsDebounced() here as onProfileSave should handle it
        }
    });

    renameButtonElement.on('click', () => {
        const oldName = settings[currentProfileKey];
        if (!oldName) return;

        const newName = prompt(`重命名预设 "${oldName}":`, oldName);
        if (newName && newName !== oldName && !profiles[newName]) {
            profiles[newName] = profiles[oldName];
            delete profiles[oldName];
            settings[currentProfileKey] = newName;
            populateProfileSelect();
            saveSettingsDebounced();
            toastr.success(`预设已重命名为 "${newName}"!`);
        } else if (profiles[newName]) {
            toastr.error(`预设名称 "${newName}" 已存在.`);
        }
    });

    deleteButtonElement.on('click', () => {
        const profileNameToDelete = settings[currentProfileKey];
        if (Object.keys(profiles).length <= 1) {
            toastr.warning("不能删除最后一个预设。");
            return;
        }
        if (profileNameToDelete && confirm(`你确定要删除预设 "${profileNameToDelete}" 吗?`)) {
            delete profiles[profileNameToDelete];
            settings[currentProfileKey] = Object.keys(profiles)[0]; // Switch to the first available profile
            populateProfileSelect();
            loadProfile(settings[currentProfileKey]); // Load the new current profile
            saveSettingsDebounced();
            toastr.success(`预设 "${profileNameToDelete}" 已删除.`);
        }
    });

    // Initial load
    populateProfileSelect();
    if (settings[currentProfileKey] && profiles[settings[currentProfileKey]]) {
        loadProfile(settings[currentProfileKey]);
    } else if (Object.keys(profiles).length > 0) {
        // If current profile is invalid, load the first one
        const firstProfile = Object.keys(profiles)[0];
        loadProfile(firstProfile);
    } else {
        // Handle case with no profiles
        console.warn(`No profiles found for type: ${type}`);
    }
}

export function getSuffix(mode) {
    if (mode === 'sd') return '';
    return `_${mode}`;
}

export function isValidUrl(string) {
    if (!string || string.trim() === '') return true;
    const urlRegex = /^(https?:\/\/)?(localhost|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|(\d{1,3}\.){3}\d{1,3})(:\\d+)?(\/.*)*$/;
    return urlRegex.test(string);
}

export function validateUrlInput(inputElement) {
    if (!inputElement) return;
    const parentGroup = inputElement.closest('.st-chatu8-input-group');
    if (!parentGroup) return;

    const isValid = isValidUrl(inputElement.value);
    parentGroup.classList.toggle('invalid', !isValid);
}



export function size_change(prefix) {
    if (prefix=="sd") {
        prefix="sd_c"
    } else {
        prefix=prefix+"_"
    }

    const width = document.getElementById(`${prefix}width`);
    const height = document.getElementById(`${prefix}height`);
    const selectElement = document.getElementById(`${prefix}size`);
    if (width && height && selectElement) {
        const [selectElementwidth, selectElementheight] = selectElement.value.split("x");
        width.value = selectElementwidth;
        height.value = selectElementheight;
        $(width).trigger('input');
        $(height).trigger('input');
    }
}

export function stylInput(message) {
    return new Promise((resolve) => {
        const parent = document.getElementById('st-chatu8-settings') || document.body;

        const backdrop = document.createElement('div');
        backdrop.className = 'st-chatu8-confirm-backdrop';

        const confirmBox = document.createElement('div');
        confirmBox.className = 'st-chatu8-confirm-box';

        const messageText = document.createElement('p');
        messageText.textContent = message;
        messageText.className = 'st-chatu8-confirm-message';
        confirmBox.appendChild(messageText);

        const messageinput = document.createElement('input');
        messageinput.className = 'st-chatu8-text-input';
        confirmBox.appendChild(messageinput);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'st-chatu8-confirm-buttons';
        confirmBox.appendChild(buttonContainer);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = '取消';
        cancelButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(cancelButton);

        const confirmButton = document.createElement('button');
        confirmButton.textContent = '确定';
        confirmButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(confirmButton);

        backdrop.appendChild(confirmBox);
        parent.appendChild(backdrop);

        const close = (value) => {
            parent.removeChild(backdrop);
            resolve(value);
        };

        cancelButton.addEventListener('click', () => close(false));
        confirmButton.addEventListener('click', () => close(messageinput.value));
        messageinput.focus();
    });
}

export function stylishConfirm(message) {
    return new Promise((resolve) => {
        const parent = document.getElementById('st-chatu8-settings') || document.body;

        const backdrop = document.createElement('div');
        backdrop.className = 'st-chatu8-confirm-backdrop';

        const confirmBox = document.createElement('div');
        confirmBox.className = 'st-chatu8-confirm-box';

        const messageText = document.createElement('p');
        messageText.textContent = message;
        messageText.className = 'st-chatu8-confirm-message';
        confirmBox.appendChild(messageText);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'st-chatu8-confirm-buttons';
        confirmBox.appendChild(buttonContainer);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = '取消';
        cancelButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(cancelButton);

        const confirmButton = document.createElement('button');
        confirmButton.textContent = '确定';
        confirmButton.className = 'st-chatu8-btn';
        buttonContainer.appendChild(confirmButton);

        backdrop.appendChild(confirmBox);
        parent.appendChild(backdrop);

        const close = (value) => {
            parent.removeChild(backdrop);
            resolve(value);
        };

        cancelButton.addEventListener('click', () => close(false));
        confirmButton.addEventListener('click', () => close(true));
        confirmButton.focus();
    });
}

export function showSettingsPanel() {
    const settings = extension_settings[extensionName];
    const panel = $('#st-immersive-sound-settings-modal');
    if (!panel.length) {
        console.error("Settings panel not found!");
        return;
    }
    
    const lastTab = settings.lastTab || 'main';
    const lastTabLink = panel.find(`.st-is-nav-link[data-tab="${lastTab}"]`);
    
    if (lastTabLink.length) {
        lastTabLink.click();
    } else {
        panel.find('.st-is-nav-link[data-tab="main"]').click();
    }

    const content = panel.find('.st-is-modal-content');
    if (window.innerWidth <= 768) {
        const buttonHeight = $('#ai-config-button').outerHeight(true) || 0;
        const bottomForm = $('#leftSendForm');
        let newHeight = `calc(90vh - ${buttonHeight}px)`; // Fallback

        if (bottomForm.length > 0) {
            const bottomBoundary = bottomForm.offset().top;
            newHeight = `${bottomBoundary - buttonHeight}px`;
        }

        panel.css({ 'align-items': 'start' });
        content.css({
            'margin-top': `${buttonHeight}px`,
            'height': newHeight
        });
    } else {
        panel.css({ 'align-items': '' });
        content.css({
            'margin-top': '',
            'height': ''
        });
    }
    panel.css('display', 'grid');
    panel.find('.st-is-modal-content').focus();
}

export function hideSettingsPanel() {
    const panel = $('#st-immersive-sound-settings-modal');
    panel.hide();
    panel.css({ 'align-items': '', 'padding-top': '' });
    panel.find('.st-is-modal-content').css({
        'margin-top': '',
        'height': ''
    });
}

export function showToast(message, type = 'info', duration = 3000) {
    if (typeof toastr === 'undefined') {
        console.warn('toastr is not defined, fallback to console.log');
        console.log(`[${type}] ${message}`);
        return;
    }

    toastr.options = {
        ...toastr.options,
        "timeOut": duration,
        "progressBar": true,
        "preventDuplicates": true,
        "newestOnTop": true
    };
    
    if (toastr[type]) {
        toastr[type](message);
    } else {
        toastr.info(message);
    }
}

export function applyFabSettings() {
    const settings = extension_settings[extensionName];
    const fab = $('#st-chatu8-fab');
    if (!fab.length) return;

    if (String(settings.enable_chatu8_fab) === 'true') {
        fab.show();
        fab.css('background-color', settings.chatu8_fab_bg_color || '#ADD8E6');
        fab.find('i').css('color', settings.chatu8_fab_icon_color || '#FFFFFF');
        fab.css('opacity', settings.chatu8_fab_opacity ?? 1);

        const size = settings.chatu8_fab_size ?? 50;
        fab.css('width', `${size}px`);
        fab.css('height', `${size}px`);
        fab.find('i').css('font-size', `${Math.round(size * 0.48)}px`);

        const isMobile = window.innerWidth <= 768;
        const position = isMobile 
            ? (settings.chatu8_fab_position.mobile || defaultSettings.chatu8_fab_position.mobile)
            : (settings.chatu8_fab_position.desktop || defaultSettings.chatu8_fab_position.desktop);

        fab.css('top', position.top);
        fab.css('left', position.left);
    } else {
        fab.hide();
    }
}

export function getDomElements(ids) {
    const elements = {};
    for (const id of ids) {
        const element = document.getElementById(id);
        if (element) {
            elements[id] = element;
        } else {
            console.warn(`Element with ID "${id}" not found.`);
        }
    }
    return elements;
}

export function updateSliderValue(id, unit, value) {
    const valueSpan = document.getElementById(id + 'Value');
    if (!valueSpan) return;

    let displayValue;
    if (unit === ':1') {
        displayValue = value + ':1';
    } else if (unit === '半音') {
        displayValue = (value > 0 ? '+' : '') + value + ' 半音';
    } else if (unit === '') {
        displayValue = parseFloat(value).toFixed(1);
    } else if (unit === 's') {
        displayValue = parseFloat(value).toFixed(1) + ' s';
    } else if (unit === 'Hz' && value >= 1000) {
        displayValue = (value / 1000).toFixed(1) + ' kHz';
    } else if (unit === '米/秒' || unit === '米') {
        displayValue = parseFloat(value).toFixed(1) + ` ${unit}`;
    } else if (unit === '°') {
        displayValue = value + '°';
    } else {
        displayValue = value + ` ${unit}`;
    }
    valueSpan.textContent = displayValue;
}


export function bindSlider(id, unit, settingObject, key, callback) {
    const slider = document.getElementById(id);
    if (!slider) return;

    slider.addEventListener('input', (event) => {
        const value = event.target.type === 'range' ? parseFloat(event.target.value) : event.target.value;
        updateSliderValue(id, unit, value);
        if (settingObject && key) {
            settingObject[key] = value;
        }
        if (callback) {
            callback(value);
        }
    });
}

export function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatTimestamp(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

// @ts-nocheck
import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { defaultThemes, extensionName, colorVarMap, defaultLyricsPlayerThemes } from "./config.js";
import { stylInput, stylishConfirm } from "./ui_common.js";

let settings;
let currentPreviewTheme = {};

function isThemeDark(theme) {
    const bgColor = theme['--st-is-bg-primary'] || '#ffffff';
    const color = bgColor.substring(1); // strip #
    const rgb = parseInt(color, 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = (rgb >> 0) & 0xff;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luma < 128;
}

export function updateThemeToggleButton(themeId) {
    const icon = $("#toggle_theme_button i");
    if (!icon.length) return;

    const theme = settings.themes[themeId] || defaultThemes['默认-白天'];
    if (isThemeDark(theme)) {
        icon.removeClass("fa-sun").addClass("fa-moon");
        icon.parent().attr('title', '切换到白天模式');
    } else {
        icon.removeClass("fa-moon").addClass("fa-sun");
        icon.parent().attr('title', '切换到黑夜模式');
    }
}

export function applyTheme(theme) {
    if (!theme) {
        console.error(`Theme object is invalid.`);
        return;
    }

    // Apply theme to the root element to make variables globally available
    const root = document.documentElement;
    if (root) {
        for (const [key, value] of Object.entries(theme)) {
            root.style.setProperty(key, value);
        }
    }
}

function populateThemeColorPickers(themeId) {
    const container = document.getElementById('st-is-theme-color-pickers');
    if (!container) return;
    container.innerHTML = '';

    const theme = currentPreviewTheme;
    if (!theme) return;

    for (const key in colorVarMap) {
        if (Object.hasOwnProperty.call(colorVarMap, key)) {
            const labelText = colorVarMap[key];
            const color = theme[key] || defaultThemes['默认-白天'][key]; // Fallback to default

            const field = document.createElement('div');
            field.className = 'st-is-field';

            const label = document.createElement('label');
            label.textContent = labelText;
            label.htmlFor = `st-is-theme-color-${key}`;

            const colorPicker = document.createElement('input');
            colorPicker.type = 'color';
            colorPicker.id = `st-is-theme-color-${key}`;
            colorPicker.className = 'st-is-color-picker';
            colorPicker.value = color;
            colorPicker.dataset.var = key;

            colorPicker.addEventListener('input', (event) => {
                const newColor = event.target.value;
                const cssVar = event.target.dataset.var;
                currentPreviewTheme[cssVar] = newColor;
                applyTheme(currentPreviewTheme);
            });

            field.appendChild(label);
            field.appendChild(colorPicker);
            container.appendChild(field);
        }
    }
}

export function loadThemeSettings() {
    const select = document.getElementById('st-is-theme-id');
    if (!select) return;

    const currentThemeId = settings.theme_id;
    select.innerHTML = '';
    for (const key in settings.themes) {
        const option = new Option(key, key);
        option.title = key;
        select.add(option);
    }
    select.value = currentThemeId;

    currentPreviewTheme = JSON.parse(JSON.stringify(settings.themes[currentThemeId]));
    applyTheme(currentPreviewTheme);
    populateThemeColorPickers(currentThemeId);
    updateThemeToggleButton(currentThemeId);
}

export function switchTheme(themeId) {
    if (settings.themes[themeId]) {
        settings.theme_id = themeId;
        saveSettingsDebounced();
        loadThemeSettings();
    }
}

// ========== 歌词播放器主题 ==========

export function loadLyricsThemeSettings() {
    const select = document.getElementById('st-is-lyrics-theme-id');
    if (!select) return;
    select.innerHTML = '';
    const allThemes = { ...defaultLyricsPlayerThemes, ...(settings.lyrics_player_themes || {}) };
    for (const key in allThemes) {
        const option = new Option(key, key);
        select.add(option);
    }
    select.value = settings.lyrics_player_theme || '\u6df1\u9083\u591c\u7a7a';
}

export function switchLyricsTheme(themeId) {
    settings.lyrics_player_theme = themeId;
    saveSettingsDebounced();
    applyLyricsThemeToPlayer(themeId);
}

export function applyLyricsThemeToPlayer(themeId) {
    const allThemes = { ...defaultLyricsPlayerThemes, ...(settings.lyrics_player_themes || {}) };
    const theme = allThemes[themeId];
    if (!theme) return;
    const container = document.querySelector('.st-is-lyrics-player');
    if (container) {
        for (const [key, value] of Object.entries(theme)) {
            container.style.setProperty(key, value);
        }
    }
}

function theme_change() {
    const select = document.getElementById('st-is-theme-id');
    const newThemeId = select.value;
    settings.theme_id = newThemeId;
    currentPreviewTheme = JSON.parse(JSON.stringify(settings.themes[newThemeId]));
    applyTheme(currentPreviewTheme);
    populateThemeColorPickers(newThemeId);
    updateThemeToggleButton(newThemeId);
    saveSettingsDebounced();
}

function theme_save() {
    const currentThemeId = settings.theme_id;

    if (defaultThemes.hasOwnProperty(currentThemeId)) {
        stylInput("正在编辑默认主题。请输入新主题的名称以保存：").then(name => {
            if (name && name.trim() !== '') {
                settings.themes[name] = JSON.parse(JSON.stringify(currentPreviewTheme));
                settings.theme_id = name;
                saveSettingsDebounced();
                loadThemeSettings();
            }
        });
    } else {
        stylishConfirm(`确定要覆盖当前主题 "${currentThemeId}" 吗？`).then(confirmed => {
            if (confirmed) {
                settings.themes[currentThemeId] = JSON.parse(JSON.stringify(currentPreviewTheme));
                saveSettingsDebounced();
                alert(`主题 "${currentThemeId}" 已保存。`);
            }
        });
    }
}

function theme_delete() {
    const select = document.getElementById('st-is-theme-id');
    const themeIdToDelete = select.value;

    if (defaultThemes.hasOwnProperty(themeIdToDelete)) {
        alert("不能删除默认主题。");
        return;
    }

    stylishConfirm(`确定要删除主题 "${themeIdToDelete}" 吗?`).then(confirmed => {
        if (confirmed) {
            delete settings.themes[themeIdToDelete];
            settings.theme_id = '默认-白天';
            saveSettingsDebounced();
            loadThemeSettings();
        }
    });
}

function theme_import() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = readerEvent => {
            try {
                const importedData = JSON.parse(readerEvent.target.result);
                let newThemesCount = 0;
                for (const key in importedData) {
                    if (importedData.hasOwnProperty(key)) {
                        if (!settings.themes.hasOwnProperty(key)) {
                            newThemesCount++;
                        }
                        settings.themes[key] = importedData[key];
                    }
                }
                saveSettingsDebounced();
                loadThemeSettings();
                alert(`成功导入 ${Object.keys(importedData).length} 个主题，其中 ${newThemesCount} 个是全新的。`);
            } catch (err) {
                alert("导入失败，请确保文件是正确的JSON格式。");
                console.error("Error importing themes:", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function theme_export(all = false) {
    const themeId = settings.theme_id;
    if (!all && !settings.themes[themeId]) {
        alert("没有选中的主题可导出。");
        return;
    }

    const dataToExport = all ? settings.themes : { [themeId]: settings.themes[themeId] };
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `st-is-theme${all ? 's-all' : '-' + themeId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function initThemeSettings(settingsModal) {
    settings = extension_settings[extensionName];

    // 将预设主题合并到用户设置中（只补充用户设置里没有的主题，已有的保持不变）
    if (!settings.themes) {
        settings.themes = JSON.parse(JSON.stringify(defaultThemes));
    } else {
        for (const themeId in defaultThemes) {
            if (!Object.prototype.hasOwnProperty.call(settings.themes, themeId)) {
                settings.themes[themeId] = JSON.parse(JSON.stringify(defaultThemes[themeId]));
            }
        }
    }

    // Initial load
    loadThemeSettings();

    // Bind events
    settingsModal.find('#st-is-theme-id').on('change', theme_change);
    settingsModal.find('#st-is-theme-save-style').on('click', theme_save);
    settingsModal.find('#st-is-theme-delete-style').on('click', theme_delete);
    settingsModal.find('#st-is-theme-export-current').on('click', () => theme_export(false));
    settingsModal.find('#st-is-theme-export-all').on('click', () => theme_export(true));
    settingsModal.find('#st-is-theme-import').on('click', theme_import);

    // 歌词播放器主题
    loadLyricsThemeSettings();
    settingsModal.find('#st-is-lyrics-theme-id').on('change', function() {
        switchLyricsTheme(this.value);
    });
}

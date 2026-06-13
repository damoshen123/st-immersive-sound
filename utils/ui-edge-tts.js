// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  Edge TTS 设置面板 UI 控制
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { extensionName } from './config.js';
import {
    EDGE_VOICES,
    EDGE_STYLE_MAP,
    pingEdgeServers,
    requestEdgeTTS,
    loadEdgePingFromSettings,
    getAvailableServers,
    getLastPingResult,
} from './edge-tts.js';

const DEFAULTS = {
    voice: 'zh-CN-XiaoxiaoNeural',
    style: 'general',
    rate: 0,
    pitch: 0,
    volume: 50,
    narrationVoice: 'zh-CN-XiaoxiaoNeural',
};

const CHAR_MATCH_KEY = 'edge_character_matching_profiles';
const CURRENT_CHAR_MATCH_KEY = 'current_edge_character_matching_profile';
const DEFAULT_CHAR_MATCH_RULES = '在这里使用自然语言描述 Edge 音色名称（如 晓晓 / zh-CN-XiaoxiaoNeural）和角色的匹配关系';

function getSettings() {
    if (!extension_settings[extensionName].edge_tts) {
        extension_settings[extensionName].edge_tts = { ...DEFAULTS };
    }
    return extension_settings[extensionName].edge_tts;
}

// ── 填充 select ──────────────────────────────────────────

function populateVoiceSelect(selector = '#edge_tts_voice') {
    const $sel = $(selector);
    $sel.empty();

    // 按 lang 分组（<optgroup>）
    const groups = {};
    for (const v of EDGE_VOICES) {
        if (!groups[v.lang]) groups[v.lang] = [];
        groups[v.lang].push(v);
    }
    for (const lang of Object.keys(groups)) {
        const $g = $(`<optgroup label="${lang}"></optgroup>`);
        for (const v of groups[lang]) {
            const genderTag = v.gender === 'Female' ? '♀' : '♂';
            $g.append(`<option value="${v.id}">${genderTag} ${v.name} (${v.id})</option>`);
        }
        $sel.append($g);
    }
}

function populateStyleSelect(voiceId) {
    const $sel = $('#edge_tts_style');
    $sel.empty();
    const voice = EDGE_VOICES.find(v => v.id === voiceId);
    const styles = voice ? voice.styles : ['general'];
    for (const s of styles) {
        const label = EDGE_STYLE_MAP[s] || s;
        $sel.append(`<option value="${s}">${label} (${s})</option>`);
    }
}

// ── ping 状态 / 服务器列表渲染 ────────────────────────────

function renderServerList() {
    const result = getLastPingResult();
    const $list = $('#edge_tts_server_list');
    const $status = $('#edge_tts_ping_status');
    $list.empty();

    if (!result) {
        $status.text('未检测');
        return;
    }

    const ageMin = Math.round((Date.now() - result.timestamp) / 60000);
    const available = getAvailableServers();
    $status.text(`已检测 ${available.length} 个可用 / ${available.length + (result.failed?.length || 0)} 个总数（${ageMin} 分钟前）`);

    for (const s of available) {
        const color = s.latency < 500 ? '#4caf50' : s.latency < 1500 ? '#ff9800' : '#f44336';
        $list.append(`<li style="padding:4px 8px; display:flex; justify-content:space-between; border-bottom:1px solid rgba(128,128,128,.2);">
            <span><i class="fa-solid fa-circle" style="color:${color}; font-size:.7em; margin-right:6px;"></i>${s.name}</span>
            <span style="opacity:.7;">${s.latency} ms</span>
        </li>`);
    }
    if (result.failed && result.failed.length > 0) {
        for (const name of result.failed) {
            $list.append(`<li style="padding:4px 8px; display:flex; justify-content:space-between; border-bottom:1px solid rgba(128,128,128,.2); opacity:.5;">
                <span><i class="fa-solid fa-xmark" style="color:#f44336; margin-right:6px;"></i>${name}</span>
                <span>失败</span>
            </li>`);
        }
    }
}

// ── 控件 <-> settings 同步 ────────────────────────────────

function loadSettingsToUI() {
    const s = getSettings();
    $('#edge_tts_voice').val(s.voice ?? DEFAULTS.voice);
    populateStyleSelect(s.voice ?? DEFAULTS.voice);
    $('#edge_tts_style').val(s.style ?? DEFAULTS.style);
    $('#edge_tts_rate').val(s.rate ?? 0);
    $('#edge_tts_rate_value').val(s.rate ?? 0);
    $('#edge_tts_pitch').val(s.pitch ?? 0);
    $('#edge_tts_pitch_value').val(s.pitch ?? 0);
    $('#edge_tts_volume').val(s.volume ?? 50);
    $('#edge_tts_volume_value').val(s.volume ?? 50);
    $('#edge_tts_narration_voice').val(s.narrationVoice ?? s.voice ?? DEFAULTS.narrationVoice);
}

function bindRangePair(rangeId, inputId, settingKey) {
    const $range = $(`#${rangeId}`);
    const $input = $(`#${inputId}`);
    const onChange = () => {
        const v = Number($range.val());
        $input.val(v);
        getSettings()[settingKey] = v;
        saveSettingsDebounced();
    };
    $range.on('input', onChange);
    $input.on('input', () => {
        $range.val($input.val());
        onChange();
    });
}

function bindEvents() {
    $('#edge_tts_voice').on('change', function () {
        const voiceId = $(this).val();
        getSettings().voice = voiceId;
        // 重新渲染风格列表，并尽量保持当前风格
        const cur = getSettings().style;
        populateStyleSelect(voiceId);
        const voice = EDGE_VOICES.find(v => v.id === voiceId);
        const validStyles = voice ? voice.styles : ['general'];
        const next = validStyles.includes(cur) ? cur : 'general';
        $('#edge_tts_style').val(next);
        getSettings().style = next;
        saveSettingsDebounced();
    });

    $('#edge_tts_style').on('change', function () {
        getSettings().style = $(this).val();
        saveSettingsDebounced();
    });

    bindRangePair('edge_tts_rate', 'edge_tts_rate_value', 'rate');
    bindRangePair('edge_tts_pitch', 'edge_tts_pitch_value', 'pitch');
    bindRangePair('edge_tts_volume', 'edge_tts_volume_value', 'volume');

    $('#edge_tts_narration_voice').on('change', function () {
        getSettings().narrationVoice = $(this).val();
        saveSettingsDebounced();
    });

    $('#edge_tts_ping_button').on('click', onPingClick);
    $('#edge_tts_test_button').on('click', onTestClick);
}

// ── 角色匹配设定（Edge 专用） ─────────────────────────────

function ensureCharMatchSettings() {
    const s = extension_settings[extensionName];
    if (!s[CHAR_MATCH_KEY] || typeof s[CHAR_MATCH_KEY] !== 'object') {
        s[CHAR_MATCH_KEY] = { '默认': DEFAULT_CHAR_MATCH_RULES };
    }
    if (!s[CURRENT_CHAR_MATCH_KEY] || !s[CHAR_MATCH_KEY][s[CURRENT_CHAR_MATCH_KEY]]) {
        s[CURRENT_CHAR_MATCH_KEY] = Object.keys(s[CHAR_MATCH_KEY])[0] || '默认';
        if (!s[CHAR_MATCH_KEY][s[CURRENT_CHAR_MATCH_KEY]]) {
            s[CHAR_MATCH_KEY][s[CURRENT_CHAR_MATCH_KEY]] = '';
        }
    }
}

function loadCharMatchProfiles() {
    ensureCharMatchSettings();
    const s = extension_settings[extensionName];
    const profiles = s[CHAR_MATCH_KEY];
    const current = s[CURRENT_CHAR_MATCH_KEY];
    const $sel = $('#edge_char_match_profile_select');
    $sel.empty();
    Object.keys(profiles).forEach(name => {
        $sel.append(new Option(name, name, name === current, name === current));
    });
    if ($sel.val()) $sel.trigger('change');
}

function sanitize(s) {
    return String(s || 'profile').replace(/[\\/:*?"<>|]/g, '_').slice(0, 64);
}

function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

function bindCharMatchEvents() {
    $('#edge_char_match_profile_select').on('change', function () {
        const name = $(this).val();
        if (!name) return;
        const s = extension_settings[extensionName];
        const rules = s[CHAR_MATCH_KEY]?.[name];
        if (rules !== undefined) {
            $('#edge_char_match_rules_editor').val(rules);
            s[CURRENT_CHAR_MATCH_KEY] = name;
            saveSettingsDebounced();
        }
    });
    $('#edge_save_char_match_profile_button').on('click', function () {
        const name = $('#edge_char_match_profile_select').val();
        if (!name) { toastr?.warning?.('没有选中的匹配设定。'); return; }
        const rules = $('#edge_char_match_rules_editor').val();
        extension_settings[extensionName][CHAR_MATCH_KEY][name] = rules;
        saveSettingsDebounced();
        toastr?.success?.(`匹配设定 "${name}" 已保存。`);
    });
    $('#edge_save_as_char_match_profile_button').on('click', function () {
        const newName = (prompt('请输入新的匹配设定名称：') || '').trim();
        if (!newName) { toastr?.warning?.('名称不能为空。'); return; }
        const profiles = extension_settings[extensionName][CHAR_MATCH_KEY];
        if (profiles[newName]) { toastr?.error?.(`匹配设定 "${newName}" 已存在。`); return; }
        profiles[newName] = $('#edge_char_match_rules_editor').val();
        extension_settings[extensionName][CURRENT_CHAR_MATCH_KEY] = newName;
        saveSettingsDebounced();
        loadCharMatchProfiles();
        toastr?.success?.(`匹配设定 "${newName}" 已创建并选中。`);
    });
    $('#edge_delete_char_match_profile_button').on('click', function () {
        const name = $('#edge_char_match_profile_select').val();
        if (!name) { toastr?.warning?.('没有选中的匹配设定。'); return; }
        const profiles = extension_settings[extensionName][CHAR_MATCH_KEY];
        if (Object.keys(profiles).length <= 1) { toastr?.error?.('不能删除最后一个匹配设定。'); return; }
        if (!confirm(`确定删除匹配设定 "${name}" 吗？`)) return;
        delete profiles[name];
        extension_settings[extensionName][CURRENT_CHAR_MATCH_KEY] = Object.keys(profiles)[0];
        saveSettingsDebounced();
        loadCharMatchProfiles();
        toastr?.success?.(`匹配设定 "${name}" 已删除。`);
    });
    $('#edge_export_char_match_profile_button').on('click', function () {
        const name = $('#edge_char_match_profile_select').val();
        if (!name) { toastr?.warning?.('没有选中的匹配设定可导出。'); return; }
        const data = { [name]: extension_settings[extensionName][CHAR_MATCH_KEY][name] };
        downloadJson(data, `edge_char_match_${sanitize(name)}.json`);
    });
    $('#edge_export_all_char_match_profiles_button').on('click', function () {
        const all = extension_settings[extensionName][CHAR_MATCH_KEY];
        if (!all || Object.keys(all).length === 0) { toastr?.warning?.('没有匹配设定可导出。'); return; }
        downloadJson(all, `edge_char_match_all.json`);
    });
    $('#edge_import_char_match_profile_button').on('click', function () {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!data || typeof data !== 'object') throw new Error('文件格式无效');
                const profiles = extension_settings[extensionName][CHAR_MATCH_KEY];
                let count = 0;
                for (const k of Object.keys(data)) {
                    if (typeof data[k] === 'string') { profiles[k] = data[k]; count++; }
                }
                if (count === 0) throw new Error('文件中没有可导入的匹配设定');
                saveSettingsDebounced();
                loadCharMatchProfiles();
                toastr?.success?.(`已导入 ${count} 个匹配设定。`);
            } catch (err) {
                toastr?.error?.(`导入失败: ${err?.message || err}`);
            }
        };
        input.click();
    });
}

// ── ping ──────────────────────────────────────────────────

async function onPingClick() {
    const $btn = $('#edge_tts_ping_button');
    const original = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 检测中...');
    $('#edge_tts_ping_status').text('检测中...');
    try {
        await pingEdgeServers(true);
        renderServerList();
        const n = getAvailableServers().length;
        if (n > 0) {
            toastr.success(`检测完成：${n} 个服务器可用`);
        } else {
            toastr.warning('所有代理服务器都不可用');
        }
    } catch (e) {
        console.error('[ST-IS Edge TTS] ping failed:', e);
        toastr.error(`检测失败：${e.message}`);
    } finally {
        $btn.prop('disabled', false).html(original);
    }
}

// ── 测试 ──────────────────────────────────────────────────

let lastTestBlobUrl = null;

async function onTestClick() {
    const text = String($('#edge_tts_test_text').val() || '').trim();
    if (!text) {
        toastr.warning('请输入测试文本');
        return;
    }
    const $btn = $('#edge_tts_test_button');
    const $audio = $('#edge_tts_test_audio');
    const original = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 合成中...');
    $audio.hide();

    try {
        // 释放上一次的 blob
        if (lastTestBlobUrl) {
            try { URL.revokeObjectURL(lastTestBlobUrl); } catch (_) {}
            lastTestBlobUrl = null;
        }

        const s = getSettings();
        const { blobUrl, server } = await requestEdgeTTS(text, {
            voice: s.voice,
            style: s.style,
            rate: s.rate,
            pitch: s.pitch,
            volume: s.volume,
            onServerSwitch: (sv) => {
                $('#edge_tts_ping_status').text(`正在使用：${sv.name}`);
            },
        });
        lastTestBlobUrl = blobUrl;
        $audio.attr('src', blobUrl).show();
        try { $audio[0].play(); } catch (_) {}
        toastr.success(`合成成功（${server.name}）`);
        // 重新渲染（可能有服务器在请求中被摘除）
        renderServerList();
    } catch (e) {
        console.error('[ST-IS Edge TTS] test failed:', e);
        toastr.error(`合成失败：${e.message}`);
    } finally {
        $btn.prop('disabled', false).html(original);
    }
}

// ── 入口 ──────────────────────────────────────────────────

export function initEdgeTtsSettings() {
    // 确保 settings 存在
    if (!extension_settings[extensionName].edge_tts) {
        extension_settings[extensionName].edge_tts = { ...DEFAULTS };
    }

    // 从持久化恢复 ping 缓存
    loadEdgePingFromSettings();

    populateVoiceSelect('#edge_tts_voice');
    populateVoiceSelect('#edge_tts_narration_voice');
    loadSettingsToUI();
    bindEvents();
    bindCharMatchEvents();
    loadCharMatchProfiles();
    renderServerList();

    console.log('[ST-IS Edge TTS] settings panel initialized');
}

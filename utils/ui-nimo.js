// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  Nimo（MiMo-V2.5-TTS）设置面板 UI 控制
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { extensionName } from './config.js';
import {
    requestNimoTTS,
    parseApiKeys,
    pingNimo,
    NimoError,
} from './nimo-tts.js';
import { getKv } from './ai-assistant/configDatabase.js';
import {
    getRoot,
    listPresetVoices,
    listMyVoices,
    findMyVoice,
    addPresetVoice,
    addCloneVoice,
    addDesignVoice,
    addCustomVoice,
    deleteMyVoice,
    getCurrentVoiceId,
    setCurrentVoiceId,
    getNarrationVoiceId,
    setNarrationVoiceId,
    resolveVoicePayload,
} from './nimo-voices.js';

// ── 工具 ─────────────────────────────────────────────────

function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function save() { saveSettingsDebounced(); }

// ── 连接设置 ─────────────────────────────────────────────

function updateApiKeyStatus() {
    const s = getRoot();
    const keys = parseApiKeys(s.apiKey);
    const $st = $('#nimo_api_key_status');
    if (!$st.length) return;
    if (!keys.length) {
        $st.text('未配置').css('color', '');
        return;
    }
    $st.text(`已配置 ${keys.length} 个 Key · 自动轮询`).css('color', '');
}

function loadBasicSettingsToUI() {
    const s = getRoot();
    $('#nimo_api_key').val(s.apiKey || '').css('-webkit-text-security', 'disc');
    updateApiKeyStatus();
    $('#nimo_base_url').val(s.baseUrl || 'https://api.xiaomimimo.com/v1');
    $('#nimo_format').val(s.format || 'wav');
    $('#nimo_style_prefix').val(s.stylePrefix || '');
    $('#nimo_narration_style_prefix').val(s.narrationStylePrefix || '');
    $('#nimo_test_text').val(s.testText || '');
    renderCurrentVoice();
    renderNarrationVoice();
}

function bindBasicEvents() {
    $('#nimo_api_key').on('input', function () {
        getRoot().apiKey = String($(this).val()).replace(/^\s+|\s+$/g, '');
        updateApiKeyStatus();
        save();
    });
    $('#nimo_api_key_toggle').on('click', function () {
        const $t = $('#nimo_api_key');
        const isMasked = $t.css('-webkit-text-security') !== 'none';
        $t.css('-webkit-text-security', isMasked ? 'none' : 'disc');
        $(this).find('i').attr('class', isMasked ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye');
    });
    $('#nimo_base_url').on('change', function () {
        getRoot().baseUrl = String($(this).val()).trim() || 'https://api.xiaomimimo.com/v1';
        save();
    });
    $('#nimo_format').on('change', function () {
        getRoot().format = $(this).val() || 'wav';
        save();
    });
    $('#nimo_style_prefix').on('input', function () {
        getRoot().stylePrefix = String($(this).val());
        save();
    });
    $('#nimo_narration_style_prefix').on('input', function () {
        getRoot().narrationStylePrefix = String($(this).val());
        save();
    });
    $('#nimo_test_text').on('input', function () {
        getRoot().testText = String($(this).val());
        save();
    });

    $('#nimo_health_button').on('click', async () => {
        const $st = $('#nimo_health_status');
        $st.text('检测中...').css('color', '');
        try {
            const s = getRoot();
            const keys = parseApiKeys(s.apiKey);
            if (!keys.length) throw new NimoError('未配置 API Key');
            const r = await pingNimo({ apiKeys: keys, baseUrl: s.baseUrl });
            $st.text(`✅ OK · ${r.bytes} 字节`).css('color', '#4ade80');
        } catch (e) {
            $st.text(`❌ ${e?.message || e}`).css('color', '#f87171');
        }
    });
}

// ── 当前音色 / 旁白音色 显示 ────────────────────────────

function formatVoiceDisplay(id) {
    if (!id) return '';
    const v = findMyVoice(id);
    if (v) return `${v.nickname}（${kindShort(v.kind)}）`;
    // 可能是预置 voice 名
    const preset = listPresetVoices().find(p => p.voice === id);
    if (preset) return `${preset.name}（预置）`;
    return id;
}

function kindShort(kind) {
    return { preset: '预置', clone: '克隆', design: '描述', custom: '自定义' }[kind] || kind;
}

function renderCurrentVoice() {
    $('#nimo_current_voice_display').val(formatVoiceDisplay(getCurrentVoiceId()));
}
function renderNarrationVoice() {
    $('#nimo_narration_voice_display').val(formatVoiceDisplay(getNarrationVoiceId()));
}

// ── 预置音色渲染 ─────────────────────────────────────────

function renderPresetGrid() {
    const $grid = $('#nimo_preset_grid').empty();
    const currentId = getCurrentVoiceId();
    for (const p of listPresetVoices()) {
        const selected = currentId === p.voice;
        const $card = $(`
            <div class="nimo-voice-card ${selected ? 'selected' : ''}" data-voice="${escapeHtml(p.voice)}">
                <div class="vname">${escapeHtml(p.name)}</div>
                <div class="vmeta">${escapeHtml(p.lang)} · voice=<code>${escapeHtml(p.voice)}</code></div>
                <div class="vactions">
                    <button class="nimo-preset-set">设为当前</button>
                    <button class="nimo-preset-narr">设为旁白</button>
                    <button class="nimo-preset-fav">加入我的音色</button>
                </div>
            </div>
        `);
        $card.find('.nimo-preset-set').on('click', (e) => {
            e.stopPropagation();
            setCurrentVoiceId(p.voice);
            renderCurrentVoice();
            renderPresetGrid();
            toastr.success(`已设为当前音色：${p.name}`);
        });
        $card.find('.nimo-preset-narr').on('click', (e) => {
            e.stopPropagation();
            setNarrationVoiceId(p.voice);
            renderNarrationVoice();
            toastr.success(`已设为旁白音色：${p.name}`);
        });
        $card.find('.nimo-preset-fav').on('click', (e) => {
            e.stopPropagation();
            try {
                addPresetVoice({ voice: p.voice, nickname: p.name });
                renderMyVoices();
                toastr.success(`已加入我的音色：${p.name}`);
            } catch (err) {
                toastr.error(err?.message || String(err));
            }
        });
        $grid.append($card);
    }
}

// ── 我的音色渲染 ─────────────────────────────────────────

function renderMyVoices() {
    const $list = $('#nimo_my_voices_list').empty();
    const mine = listMyVoices();
    if (!mine.length) {
        $list.append('<p style="opacity:.6;">尚未保存任何音色。可在"预置 / 音色复刻 / 音色描述 / 自定义"面板添加。</p>');
        return;
    }
    for (const v of mine) {
        const badgeCls = {
            preset: 'blue', clone: 'amber', design: 'green', custom: 'gray',
        }[v.kind] || 'gray';
        let meta = '';
        switch (v.kind) {
            case 'preset': meta = `voice=<code>${escapeHtml(v.voice)}</code>`; break;
            case 'clone':  meta = `参考音频 · ${v.audioMime || ''} · ${Math.round((v.sizeBytes || 0) / 1024)}KB · cfgId=<code>${escapeHtml(v.audioCfgId || '')}</code>`; break;
            case 'design': meta = `描述：${escapeHtml(v.prompt || '')}`; break;
            case 'custom': meta = `voice=<code>${escapeHtml(v.voice)}</code>`; break;
        }
        const isClone = v.kind === 'clone';
        const $item = $(`
            <div class="nimo-mvitem" data-id="${escapeHtml(v.id)}">
                <div>
                    <span class="vname">${escapeHtml(v.nickname)}</span>
                    <span class="nimo-badge ${badgeCls}">${kindShort(v.kind)}</span>
                </div>
                <div class="vmeta">${meta}</div>
                <div class="vactions">
                    <button class="nimo-mv-set">设为当前</button>
                    <button class="nimo-mv-narr">设为旁白</button>
                    <button class="nimo-mv-test">试听</button>
                    ${isClone ? '<button class="nimo-mv-raw">原音</button>' : ''}
                    <button class="nimo-mv-del danger">删除</button>
                </div>
                ${isClone ? '<div class="nimo-mv-raw-row" style="display:none; margin-top:8px;"><audio controls style="width:100%; height:32px;"></audio></div>' : ''}
            </div>
        `);
        $item.find('.nimo-mv-set').on('click', () => {
            setCurrentVoiceId(v.id);
            renderCurrentVoice();
            renderPresetGrid();
            toastr.success(`已设为当前音色：${v.nickname}`);
        });
        $item.find('.nimo-mv-narr').on('click', () => {
            setNarrationVoiceId(v.id);
            renderNarrationVoice();
            toastr.success(`已设为旁白音色：${v.nickname}`);
        });
        $item.find('.nimo-mv-test').on('click', async () => {
            await runTestSynthesis(v.id);
        });
        if (isClone) {
            $item.find('.nimo-mv-raw').on('click', async () => {
                const $row = $item.find('.nimo-mv-raw-row');
                const audioEl = $row.find('audio')[0];
                try {
                    if (!audioEl.dataset.loaded) {
                        let b64 = v.audioB64 || '';
                        let mime = v.audioMime || 'audio/mpeg';
                        if (!b64 && v.audioKvId) {
                            const rec = await getKv(v.audioKvId);
                            b64 = rec?.b64 || '';
                            if (rec?.mime) mime = rec.mime;
                        }
                        if (!b64) throw new Error('参考音频已丢失');
                        const bin = atob(b64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
                        audioEl.src = url;
                        audioEl.dataset.loaded = '1';
                    }
                    $row.show();
                    audioEl.play().catch(() => {});
                } catch (e) {
                    toastr.error(e?.message || String(e));
                }
            });
        }
        $item.find('.nimo-mv-del').on('click', async () => {
            if (!confirm(`确认删除音色 "${v.nickname}"？`)) return;
            try {
                await deleteMyVoice(v.id);
                renderMyVoices();
                renderCurrentVoice();
                renderNarrationVoice();
            } catch (e) {
                toastr.error(e?.message || String(e));
            }
        });
        $list.append($item);
    }
}

// ── 复刻 / 描述 / 自定义 添加 ────────────────────────────

function bindAddEvents() {
    let _clonePreviewUrl = null;
    const clearClonePreview = () => {
        if (_clonePreviewUrl) { URL.revokeObjectURL(_clonePreviewUrl); _clonePreviewUrl = null; }
        const a = document.getElementById('nimo_clone_preview');
        if (a) { try { a.pause(); } catch (_) {} a.removeAttribute('src'); a.load(); }
        $('#nimo_clone_preview_row').hide();
        $('#nimo_clone_preview_meta').text('');
    };

    $('#nimo_clone_file').on('change', function () {
        const f = this.files?.[0];
        $('#nimo_clone_file_label').text(f ? f.name : '选择参考音频');
        clearClonePreview();
        if (f) {
            _clonePreviewUrl = URL.createObjectURL(f);
            $('#nimo_clone_preview').attr('src', _clonePreviewUrl);
            const kb = (f.size / 1024).toFixed(1);
            $('#nimo_clone_preview_meta').text(`${f.type || 'audio'} · ${kb} KB`);
            $('#nimo_clone_preview_row').css('display', 'flex');
        }
    });

    $('#nimo_clone_add').on('click', async () => {
        const nickname = String($('#nimo_clone_nick').val() || '').trim();
        const file = $('#nimo_clone_file')[0]?.files?.[0];
        $('#nimo_clone_status').text('保存中...');
        try {
            await addCloneVoice({ file, nickname });
            $('#nimo_clone_nick').val('');
            $('#nimo_clone_file').val('');
            $('#nimo_clone_file_label').text('选择参考音频');
            clearClonePreview();
            $('#nimo_clone_status').text('✅ 已保存到我的音色');
            renderMyVoices();
            toastr.success(`克隆音色 "${nickname}" 已保存`);
        } catch (e) {
            $('#nimo_clone_status').text(`❌ ${e?.message || e}`);
            toastr.error(e?.message || String(e));
        }
    });

    $('#nimo_design_add').on('click', () => {
        const nickname = String($('#nimo_design_nick').val() || '').trim();
        const prompt = String($('#nimo_design_prompt').val() || '').trim();
        try {
            addDesignVoice({ nickname, prompt });
            $('#nimo_design_nick').val('');
            $('#nimo_design_prompt').val('');
            renderMyVoices();
            toastr.success(`描述音色 "${nickname}" 已保存`);
        } catch (e) {
            toastr.error(e?.message || String(e));
        }
    });

    $('#nimo_custom_add').on('click', () => {
        const nickname = String($('#nimo_custom_nick').val() || '').trim();
        const voice = String($('#nimo_custom_voice').val() || '').trim();
        try {
            addCustomVoice({ nickname, voice });
            $('#nimo_custom_nick').val('');
            $('#nimo_custom_voice').val('');
            renderMyVoices();
            toastr.success(`自定义音色 "${nickname}" 已添加`);
        } catch (e) {
            toastr.error(e?.message || String(e));
        }
    });

    $('#nimo_current_voice_clear').on('click', () => {
        setCurrentVoiceId('');
        renderCurrentVoice();
        renderPresetGrid();
    });
    $('#nimo_narration_voice_clear').on('click', () => {
        setNarrationVoiceId('');
        renderNarrationVoice();
    });
}

// ── 测试合成 ─────────────────────────────────────────────

async function runTestSynthesis(voiceIdOverride = null) {
    const $st = $('#nimo_test_status');
    const $audio = $('#nimo_test_audio');
    const s = getRoot();
    const voiceId = voiceIdOverride || getCurrentVoiceId();
    if (!voiceId) { toastr.error('请先选择当前音色'); return; }
    const text = String($('#nimo_test_text').val() || s.testText || '').trim();
    if (!text) { toastr.error('请输入测试文本'); return; }

    $st.text('合成中...');
    $audio.hide().attr('src', '');

    try {
        const keys = parseApiKeys(s.apiKey);
        if (!keys.length) throw new NimoError('未配置 API Key');
        const payload = await resolveVoicePayload(voiceId);
        const { blob } = await requestNimoTTS(text, {
            apiKeys: keys,
            baseUrl: s.baseUrl,
            model: payload.model,
            voice: payload.voice,
            prompt: payload.prompt,
            format: s.format || 'wav',
            stylePrefix: s.stylePrefix || '',
        });
        const url = URL.createObjectURL(blob);
        $audio.attr('src', url).show()[0].play().catch(() => {});
        $st.text(`✅ 成功 · ${(blob.size / 1024).toFixed(1)} KB · 音色：${payload.displayName}`);
    } catch (e) {
        console.error('[Nimo Test]', e);
        $st.text(`❌ ${e?.message || e}`);
        toastr.error(e?.message || String(e));
    }
}

// ── 风格标签 / 分类切换 ──────────────────────────────────

function bindMiscEvents() {
    $(document).on('click', '.nimo-tag', function () {
        const tag = $(this).data('tag');
        const $ta = $('#nimo_test_text');
        const cur = String($ta.val() || '');
        $ta.val((cur ? cur : '') + tag).trigger('input');
    });

    $(document).on('click', '.nimo-cat-btn', function () {
        const cat = $(this).data('cat');
        $('.nimo-cat-btn').removeClass('active');
        $(this).addClass('active');
        $('.nimo-cat-panel').hide();
        $(`.nimo-cat-panel[data-cat="${cat}"]`).show();
    });

    $('#nimo_test_button').on('click', () => runTestSynthesis());
}

// ── 角色匹配 profile ─────────────────────────────────────

const CHAR_MATCH_PROFILES_KEY = 'nimo_character_matching_profiles';
const CURRENT_PROFILE_KEY = 'current_nimo_character_matching_profile';

function ensureProfiles() {
    const root = extension_settings[extensionName];
    if (!root[CHAR_MATCH_PROFILES_KEY]) {
        root[CHAR_MATCH_PROFILES_KEY] = {
            '默认': '在这里使用自然语言描述音色昵称（MiMo 中已保存的音色名）和角色名的匹配关系',
        };
    }
    if (!root[CURRENT_PROFILE_KEY]) root[CURRENT_PROFILE_KEY] = '默认';
    return root;
}

function loadProfileSelect() {
    const root = ensureProfiles();
    const $sel = $('#nimo_char_match_profile_select').empty();
    for (const name of Object.keys(root[CHAR_MATCH_PROFILES_KEY])) {
        $sel.append(`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
    }
    $sel.val(root[CURRENT_PROFILE_KEY]);
    $('#nimo_char_match_rules_editor').val(root[CHAR_MATCH_PROFILES_KEY][root[CURRENT_PROFILE_KEY]] || '');
}

function bindProfileEvents() {
    $('#nimo_char_match_profile_select').on('change', function () {
        const name = $(this).val();
        const root = ensureProfiles();
        root[CURRENT_PROFILE_KEY] = name;
        $('#nimo_char_match_rules_editor').val(root[CHAR_MATCH_PROFILES_KEY][name] || '');
        save();
    });
    $('#nimo_char_match_rules_editor').on('input', function () {
        const root = ensureProfiles();
        const name = root[CURRENT_PROFILE_KEY];
        root[CHAR_MATCH_PROFILES_KEY][name] = String($(this).val());
        save();
    });
    $('#nimo_save_char_match_profile_button').on('click', () => {
        save();
        toastr.success('已保存');
    });
    $('#nimo_save_as_char_match_profile_button').on('click', () => {
        const name = prompt('输入新的匹配设定名称：');
        if (!name) return;
        const root = ensureProfiles();
        if (root[CHAR_MATCH_PROFILES_KEY][name]) { toastr.error('同名设定已存在'); return; }
        root[CHAR_MATCH_PROFILES_KEY][name] = String($('#nimo_char_match_rules_editor').val() || '');
        root[CURRENT_PROFILE_KEY] = name;
        loadProfileSelect();
        save();
    });
    $('#nimo_delete_char_match_profile_button').on('click', () => {
        const root = ensureProfiles();
        const name = root[CURRENT_PROFILE_KEY];
        if (name === '默认') { toastr.error('不能删除默认设定'); return; }
        if (!confirm(`确认删除匹配设定 "${name}"？`)) return;
        delete root[CHAR_MATCH_PROFILES_KEY][name];
        root[CURRENT_PROFILE_KEY] = '默认';
        loadProfileSelect();
        save();
    });
}

// ── 入口 ─────────────────────────────────────────────────

export function initNimoSettings() {
    getRoot();               // 保证 settings 结构存在
    loadBasicSettingsToUI();
    bindBasicEvents();
    bindAddEvents();
    bindMiscEvents();
    renderPresetGrid();
    renderMyVoices();
    loadProfileSelect();
    bindProfileEvents();
}

// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  MiniMax 设置面板 UI 控制
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { extensionName } from './config.js';
import { MinimaxClient, MinimaxError, hexToBlob, parseApiKeys } from './minimax-tts.js';
import {
    getRoot,
    loadVoiceSamples,
    getSampleUrl,
    refreshCloudVoices,
    getCloudVoices,
    listMyVoices,
    addMyVoiceManual,
    updateMyVoice,
    deleteMyVoice,
    cleanExpiredMyVoices,
    getExpiryStatus,
    listCustomVoices,
    addCustomVoice,
    deleteCustomVoice,
    clearAllCustomVoices,
    getCurrentVoiceId,
    setCurrentVoiceId,
    getNarrationVoiceId,
    setNarrationVoiceId,
    extractLang,
    buildPronDict,
    buildVoiceModify,
    getVoiceAlias,
    setVoiceAlias,
} from './minimax-voices.js';

// ── settings helpers ─────────────────────────────────────

function getSettings() { return getRoot(); }

function buildClient() {
    const s = getSettings();
    const keys = parseApiKeys(s.apiKey);
    if (!keys.length) throw new MinimaxError('请先填入 API Key');
    return new MinimaxClient({
        apiKeys: keys,
        platform: s.platform || 'cn',
        timeout: s.timeout || 60000,
        retry: s.retry ?? 2,
    });
}

function updateApiKeyStatus() {
    const s = getSettings();
    const keys = parseApiKeys(s.apiKey);
    const $st = $('#minimax_api_key_status');
    if (!$st.length) return;
    if (!keys.length) {
        $st.text('未配置').css('color', '');
        return;
    }
    const limit = keys.length * 10;
    $st.text(`已配置 ${keys.length} 个 Key · 总限速 ≈ ${limit} RPM（均衡使用）`).css('color', '');
}

function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

function sanitize(s) {
    return String(s || 'profile').replace(/[\\/:*?"<>|]/g, '_').slice(0, 64);
}

// ── 连接设置 ─────────────────────────────────────────────

function loadBasicSettingsToUI() {
    const s = getSettings();
    $('#minimax_api_key').val(s.apiKey || '').css('-webkit-text-security', 'disc');
    updateApiKeyStatus();
    $('#minimax_platform').val(s.platform || 'cn');
    $('#minimax_model').val(s.model || 'speech-2.8-hd');
    $('#minimax_speed').val(s.speed ?? 1.0);
    $('#minimax_speed_value').val(s.speed ?? 1.0);
    $('#minimax_vol').val(s.vol ?? 1.0);
    $('#minimax_vol_value').val(s.vol ?? 1.0);
    $('#minimax_pitch').val(s.pitch ?? 0);
    $('#minimax_pitch_value').val(s.pitch ?? 0);
    $('#minimax_lang_boost').val(s.languageBoost || 'auto');
    $('#minimax_emotion').val(s.emotion || '');
    $('#minimax_format').val(s.format || 'mp3');
    $('#minimax_sample_rate').val(String(s.sampleRate || 32000));
    $('#minimax_bitrate').val(String(s.bitrate || 128000));
    $('#minimax_channel').val(String(s.channel || 1));
    $('#minimax_test_text').val(s.testText || '');

    const vm = s.vm || {};
    $('#minimax_vm_pitch').val(vm.pitch || 0);
    $('#minimax_vm_pitch_value').val(vm.pitch || 0);
    $('#minimax_vm_intensity').val(vm.intensity || 0);
    $('#minimax_vm_intensity_value').val(vm.intensity || 0);
    $('#minimax_vm_timbre').val(vm.timbre || 0);
    $('#minimax_vm_timbre_value').val(vm.timbre || 0);
    $('#minimax_vm_sound_effect').val(vm.soundEffect || '');

    $('#minimax_current_voice_id').val(s.currentVoiceId || '');
    $('#minimax_narration_voice_id').val(s.narrationVoiceId || '');

    updateUrlPreview();
    refreshBitrateState();
}

function updateUrlPreview() {
    const s = getSettings();
    const cli = (() => {
        try {
            return new MinimaxClient({
                apiKey: 'dummy',  // 仅取 URL，不需要真实 key
                platform: s.platform || 'cn',
            });
        } catch (_) { return null; }
    })();
    $('#minimax_url_preview').text(cli ? cli.getEndpoint('/t2a_v2') : '—');
}

function refreshBitrateState() {
    const fmt = $('#minimax_format').val();
    $('#minimax_bitrate').prop('disabled', fmt !== 'mp3');
}

function bindBasicEvents() {
    const save = () => saveSettingsDebounced();

    $('#minimax_api_key').on('input', function () {
        // 保留换行；脱去首尾空白。多行解析交给 parseApiKeys()
        getSettings().apiKey = String($(this).val()).replace(/^\s+|\s+$/g, '');
        updateApiKeyStatus();
        save();
    });
    $('#minimax_api_key_toggle').on('click', function () {
        const $t = $('#minimax_api_key');
        const isMasked = $t.css('-webkit-text-security') !== 'none';
        $t.css('-webkit-text-security', isMasked ? 'none' : 'disc');
        $(this).find('i').attr('class', isMasked ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye');
    });
    $('#minimax_platform').on('change', function () {
        getSettings().platform = $(this).val() || 'cn';
        updateUrlPreview();
        save();
    });

    // 朗读参数
    const bindNumber = (id, key, parser = parseFloat) => {
        $(`#${id}`).on('input', function () {
            const v = parser($(this).val());
            $(`#${id}_value`).val(v);
            getSettings()[key] = v;
            save();
        });
        $(`#${id}_value`).on('input', function () {
            const v = parser($(this).val());
            $(`#${id}`).val(v);
            getSettings()[key] = v;
            save();
        });
    };
    bindNumber('minimax_speed', 'speed', parseFloat);
    bindNumber('minimax_vol', 'vol', parseFloat);
    bindNumber('minimax_pitch', 'pitch', parseInt);

    $('#minimax_model').on('change', function () { getSettings().model = $(this).val(); save(); });
    $('#minimax_lang_boost').on('change', function () { getSettings().languageBoost = $(this).val(); save(); });
    $('#minimax_emotion').on('change', function () { getSettings().emotion = $(this).val(); save(); });
    $('#minimax_format').on('change', function () {
        getSettings().format = $(this).val();
        refreshBitrateState();
        save();
    });
    $('#minimax_sample_rate').on('change', function () {
        getSettings().sampleRate = parseInt($(this).val()) || 32000; save();
    });
    $('#minimax_bitrate').on('change', function () {
        getSettings().bitrate = parseInt($(this).val()) || 128000; save();
    });
    $('#minimax_channel').on('change', function () {
        getSettings().channel = parseInt($(this).val()) || 1; save();
    });

    $('#minimax_test_text').on('input', function () {
        getSettings().testText = String($(this).val());
        updateCost();
        save();
    });

    // voice_modify
    const bindVm = (id, key) => {
        $(`#${id}`).on('input', function () {
            const v = parseInt($(this).val()) || 0;
            $(`#${id}_value`).val(v);
            getSettings().vm[key] = v;
            save();
        });
        $(`#${id}_value`).on('input', function () {
            const v = parseInt($(this).val()) || 0;
            $(`#${id}`).val(v);
            getSettings().vm[key] = v;
            save();
        });
    };
    bindVm('minimax_vm_pitch', 'pitch');
    bindVm('minimax_vm_intensity', 'intensity');
    bindVm('minimax_vm_timbre', 'timbre');
    $('#minimax_vm_sound_effect').on('change', function () {
        getSettings().vm.soundEffect = $(this).val() || '';
        save();
    });
    $('#minimax_btn_reset_vm').on('click', function () {
        const vm = getSettings().vm;
        vm.pitch = 0; vm.intensity = 0; vm.timbre = 0; vm.soundEffect = '';
        $('#minimax_vm_pitch, #minimax_vm_intensity, #minimax_vm_timbre').val(0);
        $('#minimax_vm_pitch_value, #minimax_vm_intensity_value, #minimax_vm_timbre_value').val(0);
        $('#minimax_vm_sound_effect').val('');
        save();
        toastr?.info?.('已重置 voice_modify');
    });

    // 当前音色清空
    $('#minimax_current_voice_clear').on('click', function () {
        setCurrentVoiceId(null);
        $('#minimax_current_voice_id').val('');
        renderCloudGrid();
    });

    // 旁白音色：用当前 / 清空
    $('#minimax_narration_voice_use_current').on('click', function () {
        const cur = getCurrentVoiceId();
        if (!cur) {
            toastr?.warning?.('当前音色未设置');
            return;
        }
        setNarrationVoiceId(cur);
        $('#minimax_narration_voice_id').val(cur);
        toastr?.success?.(`已设为旁白音色：${cur}`);
    });
    $('#minimax_narration_voice_clear').on('click', function () {
        setNarrationVoiceId(null);
        $('#minimax_narration_voice_id').val('');
    });

    // 测试合成的语气标签
    $(document).on('click', '#st-is-tab-minimax .minimax-tag', function () {
        const ta = $('#minimax_test_text')[0];
        if (!ta) return;
        const ins = String($(this).data('tag') || '');
        const end = $(this).attr('data-tag-end');
        const s = ta.selectionStart, e = ta.selectionEnd;
        if (end != null) {
            // 成对包裹：有选区→包裹选区；无选区→插入空 pair 并把光标放中间
            const selected = ta.value.slice(s, e);
            const pair = ins + selected + end;
            ta.value = ta.value.slice(0, s) + pair + ta.value.slice(e);
            const caret = s + ins.length + selected.length;
            ta.selectionStart = ta.selectionEnd = caret;
        } else {
            ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
            ta.selectionStart = ta.selectionEnd = s + ins.length;
        }
        ta.focus();
        getSettings().testText = ta.value;
        updateCost();
        saveSettingsDebounced();
    });
}

// ── 计费面板 ────────────────────────────────────────────

function analyzeText(text) {
    const tags = (text.match(/\([\w-]+\)|<#[\d.]+#>/g) || []).length;
    const billable = text.replace(/<#[\d.]+#>/g, '').replace(/\([\w-]+\)/g, '');
    let han = 0;
    for (const ch of billable) {
        if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) han++;
    }
    const enChars = (billable.match(/[A-Za-z]/g) || []).length;
    const enWords = (billable.match(/[A-Za-z]+/g) || []).length;
    const billing = han * 2 + (billable.length - han);
    return { han, enChars, enWords, tags, billing };
}

function updateCost() {
    const a = analyzeText($('#minimax_test_text').val() || '');
    $('#minimax_han_count').text(a.han);
    $('#minimax_en_word_count').text(a.enWords);
    $('#minimax_en_char_count').text(a.enChars);
    $('#minimax_tag_count').text(a.tags);
    $('#minimax_char_count').text(a.billing);
}

// ── 健康检查 ───────────────────────────────────────────

async function onHealthClick() {
    const $btn = $('#minimax_health_button');
    const $status = $('#minimax_health_status');
    const original = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 检测中...');
    $status.text('检测中...');
    try {
        const cli = buildClient();
        const info = await cli.health();
        if (info.ok) {
            $status.text(`✅ 已连接 · ${info.latencyMs}ms · 系统音色 ${info.count} 个`);
            toastr?.success?.('MiniMax 连接正常');
        } else {
            $status.text(`❌ ${info.error || '失败'}`);
            toastr?.error?.(`连接失败: ${info.error}`);
        }
    } catch (e) {
        console.error('[MiniMax] health failed:', e);
        $status.text(`❌ ${e?.message || e}`);
        toastr?.error?.(`连接失败: ${e?.message || e}`);
    } finally {
        $btn.prop('disabled', false).html(original);
    }
}

// ── 类型切换 ────────────────────────────────────────────

function bindCategoryTabs() {
    $('#st-is-tab-minimax .minimax-cat-btn').on('click', function () {
        const cat = $(this).data('cat');
        $('#st-is-tab-minimax .minimax-cat-btn').removeClass('active');
        $(this).addClass('active');
        $('#st-is-tab-minimax .minimax-cat-panel').hide();
        $(`#st-is-tab-minimax .minimax-cat-panel[data-cat="${cat}"]`).show();
        if (cat === 'mine') renderMyVoices();
        if (cat === 'custom') renderCustomVoices();
    });
}

// ── 试听单实例 ──────────────────────────────────────────

const previewAudio = new Audio();
let previewBtnCur = null;
previewAudio.addEventListener('ended', () => {
    if (previewBtnCur) {
        previewBtnCur.html('<i class="fa-solid fa-play"></i> 试听');
        previewBtnCur = null;
    }
});
previewAudio.addEventListener('error', () => {
    if (previewBtnCur) {
        previewBtnCur.html('<i class="fa-solid fa-xmark"></i> 失败');
        previewBtnCur = null;
    }
});

function previewVoice($btn, src) {
    if (!src) return;
    if (previewBtnCur && previewBtnCur[0] === $btn[0] && !previewAudio.paused) {
        previewAudio.pause();
        $btn.html('<i class="fa-solid fa-play"></i> 试听');
        previewBtnCur = null;
        return;
    }
    if (previewBtnCur && previewBtnCur[0] !== $btn[0]) {
        previewBtnCur.html('<i class="fa-solid fa-play"></i> 试听');
    }
    previewAudio.src = src;
    previewAudio.play().then(() => {
        $btn.html('<i class="fa-solid fa-pause"></i> 暂停');
        previewBtnCur = $btn;
    }).catch(err => {
        $btn.html('<i class="fa-solid fa-xmark"></i> 失败');
        console.error('[MiniMax] 试听失败:', err);
    });
}

// ── 云端音色 渲染 ─────────────────────────────────────

function buildCloudCombinedList() {
    // 把 cloud system + 我的音色 + custom 都整合给 grid（仅 cloud tab 用）
    // —— 但按设计，cloud tab 只显示 system + cloning + generation
    const c = getCloudVoices();
    const out = [];
    for (const v of (c.system || [])) {
        out.push({ ...v, _type: 'system', _lang: extractLang(v.voice_id) });
    }
    for (const v of (c.cloning || [])) {
        out.push({ ...v, _type: 'cloning', _lang: '复刻音色' });
    }
    for (const v of (c.generation || [])) {
        out.push({ ...v, _type: 'design', _lang: '设计音色' });
    }
    return out;
}

function rebuildLangFilter(list) {
    const $sel = $('#minimax_voice_lang_filter');
    const cur = $sel.val();
    const langs = [...new Set(list.map(v => v._lang).filter(Boolean))].sort();
    $sel.empty().append('<option value="">全部语言</option>');
    for (const l of langs) {
        $sel.append(`<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`);
    }
    if (cur && langs.includes(cur)) $sel.val(cur);
}

function renderCloudGrid() {
    const c = getCloudVoices();
    const total = (c.system || []).length + (c.cloning || []).length + (c.generation || []).length;
    if (total === 0) {
        $('#minimax_voice_grid').html('<div style="opacity:.55; padding:30px; text-align:center;">尚未拉取云端音色，点击上方「拉取云端音色」按钮加载</div>');
        return;
    }
    const list = buildCloudCombinedList();
    rebuildLangFilter(list);

    const search = String($('#minimax_voice_search').val() || '').toLowerCase();
    const lang = $('#minimax_voice_lang_filter').val();
    const filtered = list.filter(v => {
        if (lang && v._lang !== lang) return false;
        if (search) {
            const h = `${v.voice_id} ${v.voice_name || ''} ${(v.description || []).join ? v.description.join(' ') : (v.description || '')} ${v._lang}`.toLowerCase();
            if (!h.includes(search)) return false;
        }
        return true;
    });

    const cur = getCurrentVoiceId();
    const tl = { system: '系统', cloning: '复刻', design: '设计' };

    const html = filtered.map(v => {
        const sa = getSampleUrl(v.voice_id) || '';
        const desc = Array.isArray(v.description) ? v.description.join('; ') : (v.description || '');
        const meta = [v.gender, v.age, v.accent].filter(Boolean).join(' · ');
        const selected = v.voice_id === cur ? 'selected' : '';
        const alias = getVoiceAlias(v.voice_id);
        const playBtn = sa
            ? `<button class="minimax-preview-btn" data-src="${escapeHtml(sa)}"><i class="fa-solid fa-play"></i> 试听</button>`
            : `<button disabled style="opacity:.4;">无试听</button>`;
        const aliasLine = alias
            ? `<div class="vname" style="color:#a78bfa;"><i class="fa-solid fa-tag" style="font-size:10px;"></i> ${escapeHtml(alias)} <span class="minimax-badge blue" style="margin-left:4px;">自定义</span></div>`
            : '';
        return `
        <div class="minimax-voice-card ${selected}" data-vid="${escapeHtml(v.voice_id)}">
            <div class="vid">${escapeHtml(v.voice_id)}</div>
            ${aliasLine}
            ${v.voice_name ? `<div class="vname">${escapeHtml(v.voice_name)}</div>` : ''}
            ${desc ? `<div class="vdesc">${escapeHtml(desc)}</div>` : ''}
            <div class="vmeta">[${tl[v._type] || v._type}] ${escapeHtml(v._lang)}${meta ? ' · ' + escapeHtml(meta) : ''}</div>
            <div class="vactions">
                ${playBtn}
                <button class="minimax-use-btn">使用</button>
                <button class="minimax-rename-btn" title="为该音色起一个自定义名称（用于角色匹配）">${alias ? '✏ 改名' : '✏ 命名'}</button>
            </div>
        </div>`;
    }).join('') || '<div style="opacity:.55; padding:30px; text-align:center;">没有匹配的音色</div>';

    $('#minimax_voice_grid').html(html);
}

function bindCloudGridEvents() {
    const $g = $('#minimax_voice_grid');
    $g.on('click', '.minimax-voice-card', function (e) {
        if ($(e.target).closest('button').length) return; // 点按钮时不触发
        const vid = $(this).data('vid');
        if (!vid) return;
        setCurrentVoiceId(vid);
        $('#minimax_current_voice_id').val(vid);
        $g.find('.minimax-voice-card').removeClass('selected');
        $(this).addClass('selected');
    });
    $g.on('click', '.minimax-use-btn', function (e) {
        e.stopPropagation();
        const vid = $(this).closest('.minimax-voice-card').data('vid');
        if (!vid) return;
        setCurrentVoiceId(vid);
        $('#minimax_current_voice_id').val(vid);
        $g.find('.minimax-voice-card').removeClass('selected');
        $(this).closest('.minimax-voice-card').addClass('selected');
        toastr?.success?.(`已设为当前音色：${vid}`);
    });
    $g.on('click', '.minimax-preview-btn', function (e) {
        e.stopPropagation();
        previewVoice($(this), $(this).data('src'));
    });
    $g.on('click', '.minimax-rename-btn', function (e) {
        e.stopPropagation();
        const vid = $(this).closest('.minimax-voice-card').data('vid');
        if (!vid) return;
        const cur = getVoiceAlias(vid) || '';
        const v = prompt(
            `为音色 "${vid}" 设置自定义名称\n（留空则清除自定义名称，恢复默认）：`,
            cur,
        );
        if (v === null) return;
        setVoiceAlias(vid, v);
        renderCloudGrid();
        if (v.trim()) toastr?.success?.(`已命名："${v.trim()}"`);
        else toastr?.info?.('已清除自定义名称');
    });

    $('#minimax_voice_search').on('input', renderCloudGrid);
    $('#minimax_voice_lang_filter').on('change', renderCloudGrid);

    $('#minimax_btn_get_voices').on('click', async function () {
        const $btn = $(this);
        const orig = $btn.html();
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 拉取中...');
        $('#minimax_voice_status').text('拉取中...');
        try {
            const cli = buildClient();
            const r = await refreshCloudVoices(cli);
            $('#minimax_voice_status').text(
                `✅ 系统 ${r.system} / 复刻 ${r.cloning} / 设计 ${r.generation}` +
                (r.added || r.updated ? ` · 我的音色 +${r.added} ~${r.updated}` : '')
            );
            renderCloudGrid();
        } catch (e) {
            console.error('[MiniMax] getVoiceList failed:', e);
            $('#minimax_voice_status').text(`❌ ${e?.message || e}`);
            toastr?.error?.(`拉取失败: ${e?.message || e}`);
        } finally {
            $btn.prop('disabled', false).html(orig);
        }
    });
}

// ── 我的音色 渲染 ─────────────────────────────────────

function renderMyVoices() {
    const list = listMyVoices();
    const $wrap = $('#minimax_my_voices_list');
    if (!list.length) {
        $wrap.html('<div style="opacity:.55; padding:20px; text-align:center;">本地暂无音色记录，点上方「从云端同步」拉取</div>');
        return;
    }
    const sorted = [...list].sort((a, b) => {
        const sa = getExpiryStatus(a).cls, sb = getExpiryStatus(b).cls;
        const order = { amber: 0, green: 1, red: 2 };
        return (order[sa] ?? 9) - (order[sb] ?? 9);
    });
    const cur = getCurrentVoiceId();
    $wrap.html(sorted.map(v => {
        const isManual = v.source === 'manual';
        const sourceBadge = isManual ? '<span class="minimax-badge blue">手动</span>'
            : v.source === 'clone' ? '<span class="minimax-badge green">复刻</span>'
            : '<span class="minimax-badge gray">同步</span>';
        // 手动条目无 activated/expiry 概念，省略对应徽章
        let badges = sourceBadge;
        if (!isManual) {
            const exp = getExpiryStatus(v);
            const actBadge = v.activated ? '<span class="minimax-badge green">✓已激活</span>'
                                         : '<span class="minimax-badge amber">⚠未激活</span>';
            badges += ` ${actBadge} <span class="minimax-badge ${exp.cls}">${exp.text}</span>`;
        }
        const isCurrent = v.voice_id === cur ? ' style="border-color:#667eea;"' : '';
        const meta = isManual
            ? `备注：${escapeHtml(v.nickname || '(未设置)')} · 模型：${escapeHtml(v.model || '-')}`
            : `备注：${escapeHtml(v.nickname || '(未设置)')} · 模型：${escapeHtml(v.model || '-')} · 最近使用：${escapeHtml(v.lastUsedAt ? new Date(v.lastUsedAt).toLocaleString() : '从未')}`;
        return `
        <div class="minimax-mvitem" data-vid="${escapeHtml(v.voice_id)}"${isCurrent}>
            <div>🎤 <span class="vid">${escapeHtml(v.voice_id)}</span> ${badges}</div>
            <div class="vmeta">${meta}</div>
            ${v.note ? `<div class="vmeta">📝 ${escapeHtml(v.note)}</div>` : ''}
            <div class="vactions">
                <button data-act="use">📤 使用</button>
                <button data-act="edit">📝 编辑备注</button>
                <button data-act="copy">📋 复制 ID</button>
                <button data-act="delete" class="danger">🗑 删除</button>
            </div>
        </div>`;
    }).join(''));
}

function bindMyVoicesEvents() {
    const $wrap = $('#minimax_my_voices_list');

    $wrap.on('click', 'button[data-act]', async function () {
        const act = $(this).data('act');
        const vid = $(this).closest('.minimax-mvitem').data('vid');
        if (!vid) return;

        if (act === 'use') {
            setCurrentVoiceId(vid);
            $('#minimax_current_voice_id').val(vid);
            renderMyVoices();
            toastr?.success?.(`已设为当前音色：${vid}`);
        } else if (act === 'copy') {
            try { await navigator.clipboard.writeText(vid); toastr?.success?.('已复制：' + vid); }
            catch (e) { toastr?.error?.('复制失败：' + e.message); }
        } else if (act === 'edit') {
            const v = listMyVoices().find(x => x.voice_id === vid);
            if (!v) return;
            const nick = prompt('备注（昵称，用于角色匹配）：', v.nickname || '');
            if (nick === null) return;
            const note = prompt('详细备注：', v.note || '');
            if (note === null) return;
            updateMyVoice(vid, { nickname: nick, note });
            renderMyVoices();
        } else if (act === 'delete') {
            if (!confirm(`确定删除「${vid}」？\n会尝试调用云端 /delete_voice（非 voice_cloning 类型可能失败，可选择仅本地删除）。`)) return;
            try {
                let cli = null;
                try { cli = buildClient(); } catch (_) { cli = null; }
                const ok = await deleteMyVoice(cli, vid);
                if (ok) {
                    if (getCurrentVoiceId() === vid) {
                        setCurrentVoiceId(null);
                        $('#minimax_current_voice_id').val('');
                    }
                    renderMyVoices();
                }
            } catch (e) {
                toastr?.error?.('删除失败：' + (e?.message || e));
            }
        }
    });

    $('#minimax_btn_sync_voices').on('click', async function () {
        const $btn = $(this);
        const orig = $btn.html();
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 同步中...');
        try {
            const cli = buildClient();
            const r = await refreshCloudVoices(cli);
            renderMyVoices();
            renderCloudGrid();
            toastr?.success?.(`同步完成：新增 ${r.added}，更新 ${r.updated}`);
        } catch (e) {
            toastr?.error?.('同步失败：' + (e?.message || e));
        } finally {
            $btn.prop('disabled', false).html(orig);
        }
    });

    $('#minimax_btn_clean_expired').on('click', function () {
        const n = cleanExpiredMyVoices();
        renderMyVoices();
        toastr?.info?.(`已清理 ${n} 条过期未激活音色`);
    });
}

// ── 自定义音色 渲染 ───────────────────────────────────

function renderCustomVoices() {
    const list = listCustomVoices();
    const $wrap = $('#minimax_custom_voices_list');
    if (!list.length) {
        $wrap.html('<div style="opacity:.55; padding:20px; text-align:center;">暂无自定义音色</div>');
        return;
    }
    const cur = getCurrentVoiceId();
    $wrap.html(list.map(v => {
        const isCurrent = v.voice_id === cur ? ' style="border-color:#667eea;"' : '';
        const created = new Date(v.createdAt).toLocaleString();
        return `
        <div class="minimax-mvitem" data-vid="${escapeHtml(v.voice_id)}"${isCurrent}>
            <div>✏ <span class="vid">${escapeHtml(v.voice_id)}</span> <span class="minimax-badge blue">自定义</span></div>
            <div class="vmeta">备注：${escapeHtml(v.nickname || '(未设置)')} · 模型：${escapeHtml(v.model || '-')} · 创建：${escapeHtml(created)}</div>
            <div class="vactions">
                <button data-act="use">📤 使用</button>
                <button data-act="copy">📋 复制 ID</button>
                <button data-act="delete" class="danger">🗑 删除</button>
            </div>
        </div>`;
    }).join(''));
}

function bindCustomVoicesEvents() {
    $('#minimax_btn_add_custom').on('click', function () {
        // 用相对 DOM 查询，避免页面里出现重复 id（热重载残留 modal 等）时取错元素
        const $row = $(this).closest('div');
        const $vidInput = $row.find('#minimax_custom_voice_id');
        const $nickInput = $row.find('#minimax_custom_voice_nick');
        const $modelSel = $row.find('#minimax_custom_voice_model');
        const vid = String($vidInput.val() || '').trim();
        const nick = String($nickInput.val() || '').trim();
        const model = $modelSel.val();
        if (!vid) {
            console.warn('[MiniMax] add manual voice: voice_id 为空，已读到的输入值=',
                $vidInput.val(), '| 节点数=', $vidInput.length);
            toastr?.warning?.('请填写 voice_id');
            return;
        }
        try {
            // 直接写入「我的音色」，不再分两个列表
            addMyVoiceManual({ voice_id: vid, nickname: nick, model });
            $vidInput.val('');
            $nickInput.val('');
            renderCustomVoices();
            renderMyVoices();
            toastr?.success?.(`已添加到「我的音色」：${vid}`);
        } catch (e) {
            toastr?.error?.(e?.message || String(e));
        }
    });

    $('#minimax_btn_clear_custom').on('click', function () {
        if (!listCustomVoices().length) return;
        if (!confirm('确定清空所有自定义音色？')) return;
        clearAllCustomVoices();
        renderCustomVoices();
    });

    $('#minimax_custom_voices_list').on('click', 'button[data-act]', async function () {
        const act = $(this).data('act');
        const vid = $(this).closest('.minimax-mvitem').data('vid');
        if (!vid) return;
        if (act === 'use') {
            setCurrentVoiceId(vid);
            $('#minimax_current_voice_id').val(vid);
            renderCustomVoices();
            toastr?.success?.(`已设为当前音色：${vid}`);
        } else if (act === 'copy') {
            try { await navigator.clipboard.writeText(vid); toastr?.success?.('已复制：' + vid); }
            catch (e) { toastr?.error?.('复制失败：' + e.message); }
        } else if (act === 'delete') {
            if (!confirm(`确定删除自定义音色「${vid}」？`)) return;
            deleteCustomVoice(vid);
            if (getCurrentVoiceId() === vid) {
                setCurrentVoiceId(null);
                $('#minimax_current_voice_id').val('');
            }
            renderCustomVoices();
        }
    });
}

// ── 发音字典 ──────────────────────────────────────────

function renderPronTable() {
    const list = getRoot().pronDict || [];
    const $tbl = $('#minimax_pron_table');
    if (!list.length) {
        $tbl.html('<div style="opacity:.55; padding:8px;">尚未添加 — 点 [+ 添加一行] 或 [常用模板]</div>');
        return;
    }
    $tbl.html(list.map((p, i) => `
        <div class="minimax-pron-row">
            <input type="text" placeholder="原词，如 重庆" value="${escapeHtml(p.word || '')}" data-i="${i}" data-k="word">
            <input type="text" placeholder="读音，如 chóng qìng" value="${escapeHtml(p.phonetic || '')}" data-i="${i}" data-k="phonetic">
            <button class="st-is-btn danger" data-del="${i}"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `).join(''));
    $tbl.find('input').on('input', function () {
        const i = +$(this).data('i'), k = $(this).data('k');
        const arr = getRoot().pronDict;
        if (arr[i]) {
            arr[i][k] = $(this).val();
            saveSettingsDebounced();
        }
    });
    $tbl.find('button[data-del]').on('click', function () {
        const i = +$(this).data('del');
        getRoot().pronDict.splice(i, 1);
        saveSettingsDebounced();
        renderPronTable();
    });
}

function bindPronEvents() {
    $('#minimax_btn_add_pron').on('click', function () {
        getRoot().pronDict.push({ word: '', phonetic: '' });
        saveSettingsDebounced();
        renderPronTable();
    });
    $('#minimax_btn_pron_tpl').on('click', function () {
        const tpl = [
            { word: 'AI', phonetic: 'A I' },
            { word: 'GPT', phonetic: 'G P T' },
            { word: 'API', phonetic: 'A P I' },
            { word: 'URL', phonetic: 'U R L' },
            { word: 'MiniMax', phonetic: '迷你麦克斯' },
            { word: '重庆', phonetic: 'chóng qìng' },
            { word: '行长', phonetic: 'háng zhǎng' },
            { word: '银行', phonetic: 'yín háng' },
        ];
        const arr = getRoot().pronDict;
        let added = 0;
        for (const t of tpl) {
            if (!arr.find(p => p.word === t.word)) { arr.push(t); added++; }
        }
        saveSettingsDebounced();
        renderPronTable();
        toastr?.info?.(`已导入 ${added} 条常用读音`);
    });
    $('#minimax_btn_clear_pron').on('click', function () {
        const arr = getRoot().pronDict;
        if (!arr.length) return;
        if (!confirm(`确定清空 ${arr.length} 条发音字典？`)) return;
        getRoot().pronDict = [];
        saveSettingsDebounced();
        renderPronTable();
    });
}

// ── 测试合成 ──────────────────────────────────────────

let lastTestUrl = null;

async function onTestClick() {
    const text = String($('#minimax_test_text').val() || '').trim();
    if (!text) { toastr?.warning?.('请输入测试文本'); return; }
    const vid = getCurrentVoiceId();
    if (!vid) { toastr?.warning?.('请先选择当前音色'); return; }

    const $btn = $('#minimax_test_button');
    const $audio = $('#minimax_test_audio');
    const orig = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 合成中...');
    $audio.hide();
    if (lastTestUrl) { try { URL.revokeObjectURL(lastTestUrl); } catch (_) {} lastTestUrl = null; }

    try {
        const s = getSettings();
        const cli = buildClient();
        const resp = await cli.t2a({
            text,
            voiceId: vid,
            model: s.model || 'speech-2.8-hd',
            speed: s.speed ?? 1.0,
            vol: s.vol ?? 1.0,
            pitch: s.pitch ?? 0,
            emotion: s.emotion || '',
            languageBoost: s.languageBoost || 'auto',
            format: s.format || 'mp3',
            sampleRate: s.sampleRate || 32000,
            bitrate: s.bitrate || 128000,
            channel: s.channel || 1,
            voiceModify: buildVoiceModify(s.vm),
            pronunciationDict: buildPronDict(s.pronDict),
            outputFormat: 'url',
        });

        let src;
        if (resp.audioHex) {
            const blob = hexToBlob(resp.audioHex, `audio/${s.format || 'mp3'}`);
            src = URL.createObjectURL(blob);
            lastTestUrl = src;
        } else if (resp.audioUrl) {
            src = resp.audioUrl;
        } else {
            throw new MinimaxError('返回空音频');
        }
        $audio.attr('src', src).show();
        try { $audio[0].play(); } catch (_) {}
        toastr?.success?.(`合成成功 · ${(resp.audioLength / 1000).toFixed(1)}s · 计费 ${resp.wordCount} 字符`);
    } catch (e) {
        console.error('[MiniMax] test failed:', e);
        toastr?.error?.(`合成失败: ${e?.message || e}`);
    } finally {
        $btn.prop('disabled', false).html(orig);
    }
}

// ── 角色匹配 profile ─────────────────────────────────

const CHAR_MATCH_KEY = 'minimax_character_matching_profiles';
const CURRENT_CHAR_MATCH_KEY = 'current_minimax_character_matching_profile';
const DEFAULT_RULES = '在这里使用自然语言描述音色（MiniMax 配置中已有的音色名称）和角色的匹配关系';

function ensureCharMatchSettings() {
    const s = extension_settings[extensionName];
    if (!s[CHAR_MATCH_KEY] || typeof s[CHAR_MATCH_KEY] !== 'object') {
        s[CHAR_MATCH_KEY] = { '默认': DEFAULT_RULES };
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
    const $sel = $('#minimax_char_match_profile_select');
    $sel.empty();
    Object.keys(profiles).forEach(name => {
        $sel.append(new Option(name, name, name === current, name === current));
    });
    if ($sel.val()) $sel.trigger('change');
}

function bindCharMatchEvents() {
    $('#minimax_char_match_profile_select').on('change', function () {
        const name = $(this).val();
        if (!name) return;
        const s = extension_settings[extensionName];
        const rules = s[CHAR_MATCH_KEY]?.[name];
        if (rules !== undefined) {
            $('#minimax_char_match_rules_editor').val(rules);
            s[CURRENT_CHAR_MATCH_KEY] = name;
            saveSettingsDebounced();
        }
    });
    $('#minimax_save_char_match_profile_button').on('click', function () {
        const name = $('#minimax_char_match_profile_select').val();
        if (!name) { toastr?.warning?.('没有选中的匹配设定。'); return; }
        const rules = $('#minimax_char_match_rules_editor').val();
        extension_settings[extensionName][CHAR_MATCH_KEY][name] = rules;
        saveSettingsDebounced();
        toastr?.success?.(`匹配设定 "${name}" 已保存。`);
    });
    $('#minimax_save_as_char_match_profile_button').on('click', function () {
        const newName = (prompt('请输入新的匹配设定名称：') || '').trim();
        if (!newName) { toastr?.warning?.('名称不能为空。'); return; }
        const profiles = extension_settings[extensionName][CHAR_MATCH_KEY];
        if (profiles[newName]) { toastr?.error?.(`匹配设定 "${newName}" 已存在。`); return; }
        profiles[newName] = $('#minimax_char_match_rules_editor').val();
        extension_settings[extensionName][CURRENT_CHAR_MATCH_KEY] = newName;
        saveSettingsDebounced();
        loadCharMatchProfiles();
        toastr?.success?.(`匹配设定 "${newName}" 已创建并选中。`);
    });
    $('#minimax_delete_char_match_profile_button').on('click', function () {
        const name = $('#minimax_char_match_profile_select').val();
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
    $('#minimax_export_char_match_profile_button').on('click', function () {
        const name = $('#minimax_char_match_profile_select').val();
        if (!name) { toastr?.warning?.('没有选中的匹配设定可导出。'); return; }
        const data = { [name]: extension_settings[extensionName][CHAR_MATCH_KEY][name] };
        downloadJson(data, `minimax_char_match_${sanitize(name)}.json`);
    });
    $('#minimax_export_all_char_match_profiles_button').on('click', function () {
        const all = extension_settings[extensionName][CHAR_MATCH_KEY];
        if (!all || Object.keys(all).length === 0) { toastr?.warning?.('没有匹配设定可导出。'); return; }
        downloadJson(all, `minimax_char_match_all.json`);
    });
    $('#minimax_import_char_match_profile_button').on('click', function () {
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

// ── 入口 ─────────────────────────────────────────────

/**
 * 把历史上写入 customVoices 的条目迁移到 myVoices（一次性）
 * 触发时机：每次 init 都跑，但只对未存在于 myVoices 的条目生效
 */
function migrateCustomToMyVoices() {
    const list = listCustomVoices();
    if (!list.length) return;
    const myList = listMyVoices();
    const seenVids = new Set(myList.map(v => v.voice_id));
    let moved = 0;
    for (const v of list) {
        if (seenVids.has(v.voice_id)) continue;
        try {
            addMyVoiceManual({
                voice_id: v.voice_id,
                nickname: v.nickname || '',
                model: v.model || '',
            });
            moved++;
        } catch (_) { /* 已存在则忽略 */ }
    }
    if (moved > 0) {
        // 全部迁完才清空 customVoices
        clearAllCustomVoices();
        console.log(`[MiniMax] 已将 ${moved} 条自定义音色迁移到「我的音色」`);
    }
}

export function initMinimaxSettings() {
    getSettings();
    migrateCustomToMyVoices();
    loadBasicSettingsToUI();
    bindBasicEvents();
    bindCategoryTabs();
    bindCloudGridEvents();
    bindMyVoicesEvents();
    bindCustomVoicesEvents();
    bindPronEvents();
    bindCharMatchEvents();
    loadCharMatchProfiles();
    renderPronTable();

    // 试听库（异步）→ 加载完后重渲染当前 grid
    loadVoiceSamples().then(() => renderCloudGrid());

    // 初次渲染
    renderCloudGrid();
    updateCost();

    $('#minimax_health_button').on('click', onHealthClick);
    $('#minimax_test_button').on('click', onTestClick);

    console.log('[ST-IS MiniMax] settings panel initialized');
}

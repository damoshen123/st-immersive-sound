// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  MiniMax 音乐生成 UI（stateless）
//  共用「MiniMax」设置页的 apiKey / platform
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { extensionName } from './config.js';
import { MinimaxClient, MinimaxError, hexToBlob, parseApiKeys } from './minimax-tts.js';
import { MUSIC_PRESETS } from './minimax-music-presets.js';

const state = {
    mode: 'song',                 // 'song' | 'instrumental' | 'auto-lyrics' | 'cover'
    coverMode: 'two-step',        // 'one-step' | 'two-step'
    coverInputType: 'url',        // 'url' | 'file' | 'feature_id'
    audioBase64: '',
    audioFileName: '',
    coverFeatureId: '',
    preprocessResult: null,
    preprocessTime: 0,
};

let lastObjectUrl = null;

// 旧版纯字符串 PRESETS 已迁移到 ./minimax-music-presets.js（中文风格库 + 完整歌词）

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 弹出风格示例选择器：
 *   - 卡片网格展示 MUSIC_PRESETS（中文风格名 + 标签 + prompt 摘要）
 *   - 点击「填入风格 + 歌词」=> 同时写入 prompt / lyrics 两个 textarea
 *   - 点击「只填风格」     => 只写 prompt（保留用户已写的歌词）
 *   - 遮罩点击 / Esc / 关闭按钮 => 关闭弹窗
 */
function openMusicPresetModal() {
    // 复用已存在弹窗，避免重复挂载
    document.getElementById('minimax_music_preset_modal')?.remove();

    const cardsHtml = MUSIC_PRESETS.map((p, i) => {
        const tags = (p.tags || []).map(t => `<span class="mm-preset-tag">${escapeHtml(t)}</span>`).join('');
        return `
            <div class="mm-preset-card" data-idx="${i}">
                <div class="mm-preset-card-head">
                    <span class="mm-preset-emoji">${escapeHtml(p.emoji || '🎵')}</span>
                    <span class="mm-preset-name">${escapeHtml(p.name)}</span>
                </div>
                <div class="mm-preset-tags">${tags}</div>
                <div class="mm-preset-prompt" title="${escapeHtml(p.prompt)}">${escapeHtml(p.prompt)}</div>
                <div class="mm-preset-actions">
                    <button class="st-is-btn mm-preset-apply-all" data-idx="${i}">📝 填入风格 + 歌词</button>
                    <button class="st-is-btn mm-preset-apply-prompt" data-idx="${i}" title="只覆盖风格描述，保留你已写的歌词">🎨 只填风格</button>
                </div>
            </div>`;
    }).join('');

    const html = `
        <div id="minimax_music_preset_modal" class="mm-preset-modal-mask">
            <div class="mm-preset-modal" role="dialog" aria-label="风格示例">
                <div class="mm-preset-modal-head">
                    <div>
                        <h3 style="margin:0;">🎵 风格示例库</h3>
                        <div style="opacity:.65; font-size:12px; margin-top:2px;">
                            点击卡片可一键填入对应风格的 prompt 与中文歌词模板，再按需要替换文字即可。
                        </div>
                    </div>
                    <button class="st-is-btn mm-preset-close" title="关闭">✕</button>
                </div>
                <div class="mm-preset-grid">${cardsHtml}</div>
            </div>
        </div>
        <style>
            .mm-preset-modal-mask {
                position: fixed; inset: 0; z-index: 9999;
                background: rgba(0,0,0,.55);
                display: flex; align-items: center; justify-content: center;
                padding: 20px;
            }
            .mm-preset-modal {
                width: min(960px, 100%); max-height: 85vh;
                display: flex; flex-direction: column;
                background: var(--SmartThemeBlurTintColor, #1f1f24);
                color: var(--SmartThemeBodyColor, #eee);
                border: 1px solid rgba(255,255,255,.08);
                border-radius: 10px;
                box-shadow: 0 10px 40px rgba(0,0,0,.5);
                overflow: hidden;
            }
            .mm-preset-modal-head {
                display: flex; align-items: flex-start; justify-content: space-between;
                gap: 10px; padding: 14px 18px;
                border-bottom: 1px solid rgba(255,255,255,.08);
                background: rgba(102,126,234,.10);
            }
            .mm-preset-close {
                font-size: 16px; padding: 4px 10px;
            }
            .mm-preset-grid {
                display: grid; gap: 10px; padding: 14px;
                grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
                overflow: auto;
            }
            .mm-preset-card {
                background: rgba(255,255,255,.04);
                border: 1px solid rgba(255,255,255,.08);
                border-radius: 8px;
                padding: 10px 12px;
                display: flex; flex-direction: column; gap: 6px;
                transition: background .15s, border-color .15s, transform .1s;
            }
            .mm-preset-card:hover {
                background: rgba(102,126,234,.10);
                border-color: rgba(102,126,234,.45);
            }
            .mm-preset-card-head {
                display: flex; align-items: center; gap: 8px;
                font-weight: 600; font-size: 15px;
            }
            .mm-preset-emoji { font-size: 20px; line-height: 1; }
            .mm-preset-tags {
                display: flex; flex-wrap: wrap; gap: 4px;
            }
            .mm-preset-tag {
                font-size: 11px; padding: 1px 7px; border-radius: 10px;
                background: rgba(102,126,234,.18);
                color: #a78bfa;
            }
            .mm-preset-prompt {
                font-size: 12px; opacity: .75; line-height: 1.4;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .mm-preset-actions {
                display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap;
            }
            .mm-preset-actions .st-is-btn {
                font-size: 12px; padding: 4px 8px; flex: 1;
            }
        </style>
    `;

    const $modal = $(html).appendTo('body');

    const close = () => { $modal.remove(); $(document).off('keydown.mmPreset'); };

    // 关闭交互
    $modal.find('.mm-preset-close').on('click', close);
    $modal.on('click', function (e) { if (e.target === this) close(); });
    $(document).on('keydown.mmPreset', (e) => { if (e.key === 'Escape') close(); });

    // 应用：风格 + 歌词
    $modal.on('click', '.mm-preset-apply-all', function (e) {
        e.stopPropagation();
        const idx = parseInt($(this).data('idx'));
        const p = MUSIC_PRESETS[idx];
        if (!p) return;
        $('#minimax_music_prompt').val(p.prompt);
        $('#minimax_music_prompt_count').text(p.prompt.length);
        $('#minimax_music_lyrics').val(p.lyrics);
        $('#minimax_music_lyrics_count').text(p.lyrics.length);
        toastr?.success?.(`已填入「${p.name}」风格 + 歌词模板`);
        close();
    });

    // 应用：仅风格
    $modal.on('click', '.mm-preset-apply-prompt', function (e) {
        e.stopPropagation();
        const idx = parseInt($(this).data('idx'));
        const p = MUSIC_PRESETS[idx];
        if (!p) return;
        $('#minimax_music_prompt').val(p.prompt);
        $('#minimax_music_prompt_count').text(p.prompt.length);
        toastr?.info?.(`已填入「${p.name}」风格描述（歌词未改动）`);
        close();
    });
}

function buildClient() {
    const s = extension_settings[extensionName]?.minimax || {};
    const keys = parseApiKeys(s.apiKey);
    if (!keys.length) throw new MinimaxError('请先到「MiniMax」设置页填入 API Key');
    return new MinimaxClient({
        apiKeys: keys,
        platform: s.platform || 'cn',
        timeout: 300000,  // 音乐生成可能 30~60s
        retry: 1,
    });
}

function fileToBase64(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] || '');
        r.onerror = () => rej(new Error('文件读取失败'));
        r.readAsDataURL(file);
    });
}

function validateCoverAudio(file) {
    return new Promise((res, rej) => {
        if (file.size > 50 * 1024 * 1024) return rej(new Error('文件超过 50MB'));
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (!['mp3', 'wav', 'flac'].includes(ext)) return rej(new Error('仅支持 mp3/wav/flac'));
        const url = URL.createObjectURL(file);
        const a = new Audio();
        a.preload = 'metadata';
        let done = false;
        const finish = (err, dur) => {
            if (done) return; done = true;
            URL.revokeObjectURL(url);
            err ? rej(err) : res(dur || 0);
        };
        a.onloadedmetadata = () => {
            const d = a.duration;
            if (d && isFinite(d)) {
                if (d < 6) return finish(new Error(`音频时长 ${d.toFixed(1)}s,必须 ≥ 6 秒`));
                if (d > 360) return finish(new Error(`音频时长 ${d.toFixed(1)}s,必须 ≤ 6 分钟`));
            }
            finish(null, d);
        };
        a.onerror = () => finish(null, 0);
        a.src = url;
        setTimeout(() => finish(null, 0), 5000);
    });
}

// ── 模式切换 ──────────────────────────────────────────

function updateMode() {
    const isCover = state.mode === 'cover';
    $('#minimax_music_cover_block').toggle(isCover);

    // 歌词框：cover-one-step 隐藏，其它根据子模式
    if (isCover) {
        $('#minimax_music_lyrics_block').toggle(state.coverMode === 'two-step');
    } else {
        $('#minimax_music_lyrics_block').toggle(state.mode === 'song');
    }

    // 自动切模型
    const $model = $('#minimax_music_model');
    if (isCover && !String($model.val()).startsWith('music-cover')) {
        $model.val('music-cover-free');
    }
    if (!isCover && String($model.val()).startsWith('music-cover')) {
        $model.val('music-2.6-free');
    }

    // 限制更新
    $('#minimax_music_prompt_label').text(isCover
        ? '风格描述 prompt（翻唱模式必填，10~300 字符）'
        : '风格描述 prompt（必填，1~2000 字符）');
    $('#minimax_music_prompt_max').text(isCover ? '300' : '2000');
    $('#minimax_music_lyrics_label').text(isCover
        ? '歌词 lyrics（两步翻唱必填，10~1000 字符）'
        : '歌词 lyrics（用 [Verse]/[Chorus] 等标签分段，1~3500 字符）');
    $('#minimax_music_lyrics_max').text(isCover ? '1000' : '3500');

    $('#minimax_btn_gen_music').html(isCover
        ? '<i class="fa-solid fa-microphone"></i> 生成翻唱'
        : '<i class="fa-solid fa-music"></i> 生成音乐');
}

function updateCoverInputType() {
    const t = state.coverInputType;
    $('#minimax_cover_input_url').toggle(t === 'url');
    $('#minimax_cover_input_file').toggle(t === 'file');
    $('#minimax_cover_input_feature_id').toggle(t === 'feature_id');
    const showPp = state.coverMode === 'two-step' && t !== 'feature_id';
    $('#minimax_cover_preprocess_btn_wrap').toggle(showPp);
}

// ── 预处理 ────────────────────────────────────────────

async function onPreprocessClick() {
    const $btn = $('#minimax_btn_cover_preprocess');
    const $status = $('#minimax_cover_preprocess_status');
    const orig = $btn.html();

    const body = { model: 'music-cover' };
    if (state.coverInputType === 'url') {
        const u = String($('#minimax_cover_audio_url').val() || '').trim();
        if (!/^https?:\/\//i.test(u)) { toastr?.warning?.('请填写以 http(s):// 开头的公网音频 URL'); return; }
        body.audio_url = u;
    } else if (state.coverInputType === 'file') {
        if (!state.audioBase64) { toastr?.warning?.('请先选择音频文件'); return; }
        body.audio_base64 = state.audioBase64;
    } else {
        toastr?.warning?.('已使用 cover_feature_id，无需再次预处理'); return;
    }

    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 预处理中...');
    $status.text('预处理中...');
    try {
        const cli = buildClient();
        const data = await cli.musicCoverPreprocess(body);
        state.coverFeatureId = data.cover_feature_id || '';
        state.preprocessResult = data;
        state.preprocessTime = Date.now();
        renderPreprocessResult();
        $status.text('✅ 完成');
        toastr?.success?.('预处理完成');
    } catch (e) {
        $status.text(`❌ ${e?.message || e}`);
        toastr?.error?.(`预处理失败: ${e?.message || e}`);
    } finally {
        $btn.prop('disabled', false).html(orig);
    }
}

function renderPreprocessResult() {
    const r = state.preprocessResult;
    if (!r) { $('#minimax_cover_preprocess_result').hide(); return; }
    $('#minimax_cover_preprocess_result').show();
    $('#minimax_cpr_feature_id').text(r.cover_feature_id || '');
    $('#minimax_cpr_duration').text(r.audio_duration != null ? r.audio_duration : '?');
    let segHtml = '';
    try {
        const s = typeof r.structure_result === 'string' ? JSON.parse(r.structure_result) : r.structure_result;
        const segs = (s && s.segments) || [];
        segHtml = segs.map(seg => {
            const lab = seg.label || '?';
            const st = Number(seg.start || 0).toFixed(1);
            const en = Number(seg.end || 0).toFixed(1);
            return `<span style="display:inline-block; padding:2px 8px; margin:2px; border-radius:8px; font-size:11px; background:rgba(128,128,128,.15);">${lab} (${st}–${en}s)</span>`;
        }).join('');
        if (!segHtml) segHtml = '<i style="opacity:.6;">无段落数据</i>';
    } catch (e) {
        segHtml = '<i style="opacity:.6;">结构解析失败</i>';
    }
    $('#minimax_cpr_segments').html(segHtml);
}

// ── 生成音乐 ──────────────────────────────────────────

async function onGenerateClick() {
    const prompt = String($('#minimax_music_prompt').val() || '').trim();
    if (!prompt) { toastr?.warning?.('请填写 prompt'); return; }

    const isCover = state.mode === 'cover';
    if (isCover) {
        if (prompt.length < 10 || prompt.length > 300) {
            toastr?.warning?.(`翻唱模式 prompt 长度必须 10~300 字符（当前 ${prompt.length}）`); return;
        }
    } else {
        if (prompt.length > 2000) { toastr?.warning?.('prompt 超过 2000 字符'); return; }
    }

    const body = {
        model: $('#minimax_music_model').val(),
        prompt,
        output_format: 'url',
        audio_setting: {
            format: $('#minimax_music_format').val(),
            sample_rate: parseInt($('#minimax_music_sample_rate').val()),
            bitrate: parseInt($('#minimax_music_bitrate').val()),
        },
    };

    if (isCover) {
        if (!String(body.model).startsWith('music-cover')) {
            toastr?.warning?.('翻唱模式必须使用 music-cover / music-cover-free 模型'); return;
        }
        if (state.coverMode === 'two-step') {
            const ly = String($('#minimax_music_lyrics').val() || '').trim();
            if (ly.length < 10 || ly.length > 1000) {
                toastr?.warning?.(`两步翻唱歌词长度必须 10~1000 字符（当前 ${ly.length}）`); return;
            }
            let fid;
            if (state.coverInputType === 'feature_id') {
                fid = String($('#minimax_cover_feature_id_input').val() || '').trim();
                if (!fid) { toastr?.warning?.('请填写 cover_feature_id'); return; }
                state.coverFeatureId = fid;
            } else {
                fid = state.coverFeatureId;
                if (!fid) { toastr?.warning?.('请先点「调用预处理」'); return; }
                if (Date.now() - state.preprocessTime > 24 * 3600 * 1000) {
                    state.coverFeatureId = '';
                    toastr?.warning?.('预处理结果已过期（>24h），请重新调用预处理'); return;
                }
            }
            body.cover_feature_id = fid;
            body.lyrics = ly;
        } else {
            // one-step
            if (state.coverInputType === 'url') {
                const u = String($('#minimax_cover_audio_url').val() || '').trim();
                if (!/^https?:\/\//i.test(u)) { toastr?.warning?.('请填写公网音频 URL'); return; }
                body.audio_url = u;
            } else if (state.coverInputType === 'file') {
                if (!state.audioBase64) { toastr?.warning?.('请先选择参考音频文件'); return; }
                body.audio_base64 = state.audioBase64;
            } else {
                toastr?.warning?.('一步翻唱不支持 cover_feature_id'); return;
            }
        }
    } else if (state.mode === 'song') {
        const ly = String($('#minimax_music_lyrics').val() || '').trim();
        if (!ly) { toastr?.warning?.('歌曲模式必须填写歌词'); return; }
        if (ly.length > 3500) { toastr?.warning?.('歌词超过 3500 字符'); return; }
        body.lyrics = ly;
    } else if (state.mode === 'instrumental') {
        body.is_instrumental = true;
    } else if (state.mode === 'auto-lyrics') {
        body.lyrics_optimizer = true;
    }

    const $btn = $('#minimax_btn_gen_music');
    const orig = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 生成中...');
    $('#minimax_music_status').text('生成中（可能需要 30–60 秒，请耐心等待）...');
    $('#minimax_music_audio').hide();
    $('#minimax_music_download').hide();
    if (lastObjectUrl) { try { URL.revokeObjectURL(lastObjectUrl); } catch (_) {} lastObjectUrl = null; }

    try {
        const cli = buildClient();
        const data = await cli.musicGenerate(body);
        if (!(data?.data?.audio)) {
            throw new MinimaxError('返回空音频');
        }
        let audio = data.data.audio;
        const fmt = $('#minimax_music_format').val();
        if (/^[0-9a-fA-F]+$/.test(audio) && audio.length > 200) {
            const blob = hexToBlob(audio, `audio/${fmt}`);
            audio = URL.createObjectURL(blob);
            lastObjectUrl = audio;
        }
        $('#minimax_music_audio').attr('src', audio).show();
        $('#minimax_music_download').attr({
            href: audio,
            download: `minimax_music_${Date.now()}.${fmt}`,
        }).show();
        const dur = data.extra_info?.audio_length
            ? (data.extra_info.audio_length / 1000).toFixed(1) + '秒' : '?';
        $('#minimax_music_status').text(`✅ 生成成功 · 时长 ${dur}`);
    } catch (e) {
        let msg = e?.message || String(e);
        const code = e?.status;
        if (code === 1024 || /payment|余额|额度|insufficient/i.test(msg)) {
            msg += `\n💡 提示：该模型可能需要付费，请尝试切换到 ${isCover ? 'music-cover-free' : 'music-2.6-free'}`;
        } else if (/feature_id.*expire|expired/i.test(msg)) {
            msg += '\n💡 提示：预处理 ID 已过期，请重新调用预处理';
            state.coverFeatureId = '';
        } else if (/sensitive/i.test(msg)) {
            msg += '\n⚠️ 提示：触发内容安全审核，请检查 prompt / lyrics 是否含敏感词';
        }
        $('#minimax_music_status').text('❌ ' + msg);
        toastr?.error?.('生成失败: ' + (e?.message || e));
    } finally {
        $btn.prop('disabled', false).html(orig);
    }
}

// ── 入口 ─────────────────────────────────────────────

export function initMinimaxMusicSettings() {
    // 模式切换
    $(document).on('change', '#st-is-tab-minimax-music input[name="minimax_music_mode"]', function () {
        state.mode = $(this).val();
        updateMode();
    });
    $(document).on('change', '#st-is-tab-minimax-music input[name="minimax_cover_mode"]', function () {
        state.coverMode = $(this).val();
        // 一步翻唱不支持 feature_id
        if (state.coverMode === 'one-step' && state.coverInputType === 'feature_id') {
            $('#st-is-tab-minimax-music input[name="minimax_cover_input_type"][value="url"]').prop('checked', true);
            state.coverInputType = 'url';
        }
        updateMode();
        updateCoverInputType();
    });
    $(document).on('change', '#st-is-tab-minimax-music input[name="minimax_cover_input_type"]', function () {
        state.coverInputType = $(this).val();
        updateCoverInputType();
    });

    // 模型变更校验
    $('#minimax_music_model').on('change', function () {
        const v = String($(this).val());
        const isCover = state.mode === 'cover';
        if (isCover && !v.startsWith('music-cover')) {
            toastr?.info?.('翻唱模式仅支持 music-cover / music-cover-free，已自动切回 music-cover-free');
            $(this).val('music-cover-free');
        }
        if (!isCover && v.startsWith('music-cover')) {
            toastr?.info?.('music-cover 模型仅用于翻唱模式，已自动切回 music-2.6-free');
            $(this).val('music-2.6-free');
        }
    });

    // 字数计数
    $('#minimax_music_prompt').on('input', function () {
        $('#minimax_music_prompt_count').text(String($(this).val() || '').length);
    });
    $('#minimax_music_lyrics').on('input', function () {
        $('#minimax_music_lyrics_count').text(String($(this).val() || '').length);
    });

    // 风格示例（弹窗版：中文风格库 + 完整歌词模板）
    $('#minimax_btn_music_presets').on('click', openMusicPresetModal);

    // 结构标签插入
    $(document).on('click', '#st-is-tab-minimax-music .minimax-music-tag', function () {
        const ta = $('#minimax_music_lyrics')[0];
        if (!ta) return;
        const ins = String($(this).data('tag') || '').replace(/\\n/g, '\n');
        const s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + ins.length;
        ta.focus();
        $('#minimax_music_lyrics_count').text(ta.value.length);
    });

    // 文件上传
    $('#minimax_cover_file_btn').on('click', () => $('#minimax_cover_file_input').trigger('click'));
    $('#minimax_cover_file_input').on('change', async function (e) {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        $('#minimax_cover_file_status').text('校验中...');
        try {
            const dur = await validateCoverAudio(f);
            $('#minimax_cover_file_status').text(`读取并 Base64 编码中 (${(f.size / 1024 / 1024).toFixed(2)}MB)...`);
            const b64 = await fileToBase64(f);
            state.audioBase64 = b64;
            state.audioFileName = f.name;
            $('#minimax_cover_file_status').text(`✅ ${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB${dur ? ', ' + dur.toFixed(1) + 's' : ''})`);
        } catch (err) {
            state.audioBase64 = '';
            $('#minimax_cover_file_status').text('❌ ' + err.message);
        }
    });

    $('#minimax_cover_feature_id_input').on('input', function () {
        state.coverFeatureId = String($(this).val() || '').trim();
        state.preprocessTime = Date.now();
    });

    $('#minimax_btn_cover_preprocess').on('click', onPreprocessClick);
    $('#minimax_btn_fill_lyrics_tpl').on('click', function () {
        const r = state.preprocessResult;
        if (!r || !r.formatted_lyrics) { toastr?.warning?.('暂无可用的歌词模板'); return; }
        $('#minimax_music_lyrics').val(r.formatted_lyrics);
        $('#minimax_music_lyrics_count').text(r.formatted_lyrics.length);
        $('#minimax_music_lyrics').focus();
    });

    $('#minimax_btn_gen_music').on('click', onGenerateClick);

    // 初始化
    updateMode();
    updateCoverInputType();

    console.log('[ST-IS MiniMax Music] panel initialized');
}

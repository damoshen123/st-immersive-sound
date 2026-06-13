// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  Nimo（MiMo-V2.5-TTS）音色管理
//
//  音色条目类型（kind）：
//    - preset : 官方预置音色（voice = '冰糖' / 'Milo' ...）
//    - clone  : 用户上传参考音频做音色复刻
//               （音频 base64 存在 IndexedDB，仅 audioKvId 留在 voice 条目）
//    - design : 文本描述音色（prompt = '温柔女声...'）
//    - custom : 手动登记的第三方/私有 voice 字符串，直接透传
//
//  所有条目都带一个内部唯一 id（前缀 nv_），speaker 匹配与下拉展示用 nickname。
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { extensionName } from './config.js';
import { saveCloneAudio, getCloneAudio, deleteCloneAudio } from './nimo-clone-storage.js';

// ── 预置音色表（来自 nimo.html + 风格扩展）─────────────────

export const PRESET_VOICES = [
    { voice: 'mimo_default', name: 'MiMo · 默认', lang: '通用' },
    { voice: '冰糖', name: '冰糖', lang: '中文女' },
    { voice: '茉莉', name: '茉莉', lang: '中文女' },
    { voice: '苏打', name: '苏打', lang: '中文男' },
    { voice: '白桦', name: '白桦', lang: '中文男' },
    { voice: 'Mia',  name: 'Mia',  lang: '英文女' },
    { voice: 'Chloe', name: 'Chloe', lang: '英文女' },
    { voice: 'Milo', name: 'Milo', lang: '英文男' },
    { voice: 'Dean', name: 'Dean', lang: '英文男' },
];

// ── settings root ─────────────────────────────────────────

export function getRoot() {
    if (!extension_settings[extensionName].nimo) {
        extension_settings[extensionName].nimo = {};
    }
    const root = extension_settings[extensionName].nimo;
    if (typeof root.apiKey !== 'string') root.apiKey = '';
    if (typeof root.baseUrl !== 'string' || !root.baseUrl) root.baseUrl = 'https://api.xiaomimimo.com/v1';
    if (typeof root.model !== 'string') root.model = 'mimo-v2.5-tts';
    if (typeof root.format !== 'string') root.format = 'wav';
    if (typeof root.stylePrefix !== 'string') root.stylePrefix = '';
    if (typeof root.narrationStylePrefix !== 'string') root.narrationStylePrefix = '';
    if (typeof root.currentVoiceId !== 'string') root.currentVoiceId = '';
    if (typeof root.narrationVoiceId !== 'string') root.narrationVoiceId = '';
    if (typeof root.testText !== 'string') root.testText = '你好，这是 MiMo 语音合成的测试文本。';
    if (!Array.isArray(root.myVoices)) root.myVoices = [];
    return root;
}

function save() { saveSettingsDebounced(); }

// ── ID 工具 ───────────────────────────────────────────────

function genVoiceId() {
    return 'nv_' + (crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
}

// ── CRUD：我的音色 ────────────────────────────────────────

export function listMyVoices() {
    return [...getRoot().myVoices];
}

export function findMyVoice(id) {
    return getRoot().myVoices.find(v => v.id === id) || null;
}

export function listPresetVoices() {
    return [...PRESET_VOICES];
}

/**
 * 添加一个预置音色到"我的音色"（等价于收藏）
 */
export function addPresetVoice({ voice, nickname = '' }) {
    if (!voice) throw new Error('voice 必填');
    const root = getRoot();
    const id = genVoiceId();
    root.myVoices.push({
        id,
        kind: 'preset',
        nickname: nickname || voice,
        voice,
        createdAt: Date.now(),
    });
    save();
    return id;
}

/**
 * 添加克隆音色：把参考音频存进 configDatabase，再登记到 myVoices。
 * @param {File} file
 * @param {string} nickname
 * @returns {Promise<string>} 新建条目的内部 id
 */
export async function addCloneVoice({ file, nickname }) {
    if (!file) throw new Error('请选择参考音频文件');
    if (!nickname || !nickname.trim()) throw new Error('请填写音色昵称');
    if (file.size > 10 * 1024 * 1024) throw new Error('参考音频超过 10 MB');

    const audioMime = inferMime(file);

    // File -> 纯 base64
    const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || '').split(',')[1] || '');
        r.onerror = reject;
        r.readAsDataURL(file);
    });

    const id = genVoiceId();
    const audioKvId = `nimo_audio_${id}`;
    await saveCloneAudio(audioKvId, base64, audioMime);

    const root = getRoot();
    root.myVoices.push({
        id,
        kind: 'clone',
        nickname: nickname.trim(),
        audioKvId,
        audioMime,
        sizeBytes: file.size,
        createdAt: Date.now(),
    });
    save();
    return id;
}

/**
 * 添加描述生成音色（voicedesign）
 */
export function addDesignVoice({ nickname, prompt }) {
    if (!nickname || !nickname.trim()) throw new Error('请填写音色昵称');
    if (!prompt || !prompt.trim()) throw new Error('请填写音色描述');
    const root = getRoot();
    const id = genVoiceId();
    root.myVoices.push({
        id,
        kind: 'design',
        nickname: nickname.trim(),
        prompt: prompt.trim(),
        createdAt: Date.now(),
    });
    save();
    return id;
}

/**
 * 添加自定义 voice 字符串（纯本地透传）
 */
export function addCustomVoice({ nickname, voice }) {
    if (!nickname || !nickname.trim()) throw new Error('请填写音色昵称');
    if (!voice || !String(voice).trim()) throw new Error('请填写 voice 字符串');
    const root = getRoot();
    const id = genVoiceId();
    root.myVoices.push({
        id,
        kind: 'custom',
        nickname: nickname.trim(),
        voice: String(voice).trim(),
        createdAt: Date.now(),
    });
    save();
    return id;
}

export async function deleteMyVoice(id) {
    const root = getRoot();
    const idx = root.myVoices.findIndex(v => v.id === id);
    if (idx < 0) return false;
    const item = root.myVoices[idx];
    if (item.kind === 'clone' && item.audioKvId) {
        try { await deleteCloneAudio(item.audioKvId); }
        catch (e) { console.warn('[Nimo Voices] 删除参考音频失败:', e); }
    }
    root.myVoices.splice(idx, 1);
    // 清理"当前音色"引用
    if (root.currentVoiceId === id) root.currentVoiceId = '';
    if (root.narrationVoiceId === id) root.narrationVoiceId = '';
    save();
    return true;
}

export function updateMyVoice(id, patch) {
    const v = findMyVoice(id);
    if (!v) return false;
    Object.assign(v, patch);
    save();
    return true;
}

// ── 当前音色 ────────────────────────────────────────────

export function getCurrentVoiceId() {
    return getRoot().currentVoiceId || '';
}
export function setCurrentVoiceId(id) {
    getRoot().currentVoiceId = id || '';
    save();
}

export function getNarrationVoiceId() {
    return getRoot().narrationVoiceId || '';
}
export function setNarrationVoiceId(id) {
    getRoot().narrationVoiceId = id || '';
    save();
}

// ── 解析：voiceMeta → 发给 requestNimoTTS 的参数 ──────────

/**
 * 根据内部 id / 预置 voice 名，组装 requestNimoTTS 所需的 { model, voice, prompt }。
 * - 本地 myVoices（含 clone/design/custom）：按 kind 处理
 * - 预置 voice 名：model = mimo-v2.5-tts，voice = 名字
 *
 * @param {string} idOrPresetVoice
 * @returns {Promise<{model:string, voice?:string, prompt?:string, displayName:string, meta:object}>}
 */
export async function resolveVoicePayload(idOrPresetVoice) {
    const root = getRoot();
    if (!idOrPresetVoice) throw new Error('Nimo: 未选择音色');

    // 1) 命中我的音色
    const mine = root.myVoices.find(v => v.id === idOrPresetVoice);
    if (mine) {
        if (mine.kind === 'preset') {
            return {
                model: 'mimo-v2.5-tts',
                voice: mine.voice,
                displayName: mine.nickname || mine.voice,
                meta: mine,
            };
        }
        if (mine.kind === 'custom') {
            return {
                model: 'mimo-v2.5-tts',
                voice: mine.voice,
                displayName: mine.nickname,
                meta: mine,
            };
        }
        if (mine.kind === 'design') {
            return {
                model: 'mimo-v2.5-tts-voicedesign',
                prompt: mine.prompt,
                displayName: mine.nickname,
                meta: mine,
            };
        }
        if (mine.kind === 'clone') {
            // 兼容旧格式：audioB64 直存在条目上
            let b64 = mine.audioB64 || '';
            let mime = mine.audioMime || 'audio/mpeg';
            if (!b64 && mine.audioKvId) {
                const rec = await getCloneAudio(mine.audioKvId);
                b64 = rec?.b64 || '';
                if (rec?.mime) mime = rec.mime;
            }
            if (!b64) throw new Error(`Nimo: 克隆音色 "${mine.nickname}" 的参考音频已丢失`);
            return {
                model: 'mimo-v2.5-tts-voiceclone',
                voice: `data:${mime};base64,${b64}`,
                displayName: mine.nickname,
                meta: mine,
            };
        }
    }

    // 2) 命中预置 voice（兼容直接传入音色名的旧写法）
    const preset = PRESET_VOICES.find(p => p.voice === idOrPresetVoice || p.name === idOrPresetVoice);
    if (preset) {
        return {
            model: 'mimo-v2.5-tts',
            voice: preset.voice,
            displayName: preset.name,
            meta: { kind: 'preset', voice: preset.voice, nickname: preset.name },
        };
    }

    // 3) 最后兜底：当成 custom voice 字符串透传
    return {
        model: 'mimo-v2.5-tts',
        voice: String(idOrPresetVoice),
        displayName: String(idOrPresetVoice),
        meta: { kind: 'custom', voice: String(idOrPresetVoice) },
    };
}

// ── speaker 名 → 音色 id（供 index.js 角色分支使用）──

/**
 * 查找流程：
 *   1) myVoices.nickname 精确 / 忽略大小写
 *   2) myVoices.voice（预置/custom）精确 / 忽略大小写
 *   3) 预置 PRESET_VOICES.voice / name 匹配 → 返回 voice 名本身
 *   4) 找不到 → null
 *
 * @param {string} name speaker 名
 * @returns {{id:string, name:string, source:string}|null}
 */
export function findVoiceByName(name) {
    if (!name) return null;
    const target = String(name).trim();
    if (!target) return null;
    const lower = target.toLowerCase();
    const root = getRoot();

    for (const v of root.myVoices || []) {
        if ((v.nickname && v.nickname.trim() === target)
            || (v.voice && v.voice === target)) {
            return { id: v.id, name: v.nickname || v.voice || v.id, source: 'mine' };
        }
    }
    for (const v of root.myVoices || []) {
        if ((v.nickname && v.nickname.toLowerCase() === lower)
            || (v.voice && String(v.voice).toLowerCase() === lower)) {
            return { id: v.id, name: v.nickname || v.voice || v.id, source: 'mine' };
        }
    }
    for (const p of PRESET_VOICES) {
        if (p.voice === target || p.name === target) {
            return { id: p.voice, name: p.name, source: 'preset' };
        }
    }
    for (const p of PRESET_VOICES) {
        if (p.voice.toLowerCase() === lower || p.name.toLowerCase() === lower) {
            return { id: p.voice, name: p.name, source: 'preset' };
        }
    }
    return null;
}

/**
 * 统一拼 speaker 列表（供 LLM / preview 使用）
 */
export function listAllSpeakers() {
    const out = [];
    const root = getRoot();
    for (const v of root.myVoices || []) {
        out.push({
            name: v.nickname || v.id,
            description: kindDescription(v),
            voice_id: v.id,
            source: 'mine',
        });
    }
    for (const p of PRESET_VOICES) {
        out.push({
            name: p.name,
            description: `MiMo 预置 · ${p.lang} · voice=${p.voice}`,
            voice_id: p.voice,
            source: 'preset',
        });
    }
    const seen = new Set();
    return out.filter(s => {
        if (!s.name || seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
    });
}

function kindDescription(v) {
    switch (v.kind) {
        case 'preset': return `预置 · voice=${v.voice}`;
        case 'clone':  return `音色复刻 · ${v.audioMime || 'audio'} · ${Math.round((v.sizeBytes || 0) / 1024)}KB`;
        case 'design': return `音色描述 · ${(v.prompt || '').slice(0, 30)}`;
        case 'custom': return `自定义 · voice=${v.voice}`;
        default: return '';
    }
}

// ── misc ─────────────────────────────────────────────────

function inferMime(file) {
    const name = String(file?.name || '').toLowerCase();
    if (name.endsWith('.wav')) return 'audio/wav';
    if (name.endsWith('.mp3')) return 'audio/mpeg';
    if (name.endsWith('.m4a')) return 'audio/mp4';
    if (name.endsWith('.ogg')) return 'audio/ogg';
    if (name.endsWith('.flac')) return 'audio/flac';
    return file?.type || 'audio/mpeg';
}

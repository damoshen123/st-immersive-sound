// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  MiniMax 音色管理
//  三类来源:
//    - 云端系统音色 cloudVoicesCache.system   （只读）
//    - 我的音色      myVoices                  （cloning + design + 手动登记）
//    - 自定义音色    customVoices              （纯本地透传 voice_id）
//  试听 URL: minimax_voices.json 静态映射，加载一次后存内存 Map
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { extensionName, extensionFolderPath } from './config.js';

// ── 试听库（静态）──────────────────────────────────────

let _samplesPromise = null;
let _samplesMap = null;  // Map<voice_id, sample_url>

/**
 * 异步加载 minimax_voices.json，返回 Map<voiceId, sampleUrl>
 */
export function loadVoiceSamples() {
    if (_samplesMap) return Promise.resolve(_samplesMap);
    if (_samplesPromise) return _samplesPromise;
    _samplesPromise = fetch(`${extensionFolderPath}/minimax_voices.json`, { cache: 'force-cache' })
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(data => {
            const samples = data?.samples || {};
            _samplesMap = new Map(Object.entries(samples));
            return _samplesMap;
        })
        .catch(e => {
            console.warn('[MiniMax Voices] 加载试听库失败:', e);
            _samplesMap = new Map();
            return _samplesMap;
        });
    return _samplesPromise;
}

/**
 * 同步取试听 URL（需先 await loadVoiceSamples()，否则返回 null）
 */
export function getSampleUrl(voiceId) {
    if (!_samplesMap || !voiceId) return null;
    return _samplesMap.get(voiceId) || null;
}

// ── settings root ──────────────────────────────────────

export function getRoot() {
    if (!extension_settings[extensionName].minimax) {
        extension_settings[extensionName].minimax = {};
    }
    const root = extension_settings[extensionName].minimax;
    if (!Array.isArray(root.customVoices)) root.customVoices = [];
    if (!Array.isArray(root.myVoices)) root.myVoices = [];
    if (!Array.isArray(root.pronDict)) root.pronDict = [];
    if (!root.cloudVoicesCache) {
        root.cloudVoicesCache = { fetchedAt: 0, system: [], cloning: [], generation: [] };
    }
    if (!root.vm) root.vm = { pitch: 0, intensity: 0, timbre: 0, soundEffect: '' };
    if (!root.voiceAliases || typeof root.voiceAliases !== 'object') root.voiceAliases = {};
    return root;
}

// ── 音色自定义昵称（适用于云端/系统音色，refresh 不会清空）────

/**
 * 取 voice_id 的显示名（优先用户自定义昵称）
 * @param {string} voiceId
 * @returns {string|null}
 */
export function getVoiceAlias(voiceId) {
    if (!voiceId) return null;
    const a = getRoot().voiceAliases || {};
    return a[voiceId] || null;
}

/**
 * 设置/清空 voice_id 的自定义昵称
 * @param {string} voiceId
 * @param {string|null} alias 空串/null 表示清空
 */
export function setVoiceAlias(voiceId, alias) {
    if (!voiceId) return;
    const root = getRoot();
    const v = String(alias || '').trim();
    if (v) {
        root.voiceAliases[voiceId] = v;
    } else {
        delete root.voiceAliases[voiceId];
    }
    save();
}

function save() { saveSettingsDebounced(); }

// ── 云端音色 ────────────────────────────────────────────

export async function refreshCloudVoices(client) {
    if (!client) throw new Error('未提供 MinimaxClient');
    const list = await client.getVoiceList('all');
    const root = getRoot();
    root.cloudVoicesCache = {
        fetchedAt: Date.now(),
        system: list.system_voice || [],
        cloning: list.voice_cloning || [],
        generation: list.voice_generation || [],
    };
    save();
    // 顺带把 cloning + generation 合并进 myVoices（标记 activated/source=api）
    const merged = [...(list.voice_cloning || []), ...(list.voice_generation || [])];
    let added = 0, updated = 0;
    for (const v of merged) {
        if (!v.voice_id) continue;
        const existing = root.myVoices.find(x => x.voice_id === v.voice_id);
        if (existing) {
            existing.activated = true;
            if (!existing.nickname && v.voice_name) existing.nickname = v.voice_name;
            updated++;
        } else {
            root.myVoices.push({
                voice_id: v.voice_id,
                nickname: v.voice_name || '',
                note: Array.isArray(v.description) ? v.description.join('; ') : (v.description || ''),
                model: '',
                createdAt: v.created_time && v.created_time !== '1970-01-01'
                    ? new Date(v.created_time).getTime() : Date.now(),
                source: 'api',
                activated: true,
                lastUsedAt: null,
            });
            added++;
        }
    }
    save();
    return {
        system: root.cloudVoicesCache.system.length,
        cloning: root.cloudVoicesCache.cloning.length,
        generation: root.cloudVoicesCache.generation.length,
        added,
        updated,
    };
}

export function getCloudVoices() {
    const c = getRoot().cloudVoicesCache || {};
    return {
        system: c.system || [],
        cloning: c.cloning || [],
        generation: c.generation || [],
        fetchedAt: c.fetchedAt || 0,
    };
}

export function isCloudCacheStale(ttlMs = 24 * 3600 * 1000) {
    const t = getRoot().cloudVoicesCache?.fetchedAt || 0;
    return Date.now() - t > ttlMs;
}

// ── 我的音色 ────────────────────────────────────────────

export function listMyVoices() {
    return [...getRoot().myVoices];
}

export function findMyVoice(voiceId) {
    return getRoot().myVoices.find(v => v.voice_id === voiceId) || null;
}

export function addMyVoiceManual({ voice_id, nickname = '', note = '', model = '' }) {
    if (!voice_id) throw new Error('voice_id 必填');
    const root = getRoot();
    if (root.myVoices.some(v => v.voice_id === voice_id)) {
        throw new Error(`voice_id "${voice_id}" 已存在`);
    }
    root.myVoices.push({
        voice_id, nickname, note, model,
        createdAt: Date.now(),
        source: 'manual',
        // 手动登记的音色不会被 API 回收，永久有效
        activated: true,
        lastUsedAt: null,
    });
    save();
}

export function updateMyVoice(voiceId, patch) {
    const v = findMyVoice(voiceId);
    if (!v) return false;
    Object.assign(v, patch);
    save();
    return true;
}

export function markMyVoiceUsed(voiceId) {
    const v = findMyVoice(voiceId);
    if (!v) return false;
    v.activated = true;
    v.lastUsedAt = Date.now();
    save();
    return true;
}

export async function deleteMyVoice(client, voiceId, { silentCloud = false } = {}) {
    const root = getRoot();
    const idx = root.myVoices.findIndex(v => v.voice_id === voiceId);
    if (idx < 0) return false;
    if (client) {
        try {
            await client.deleteVoice(voiceId, 'voice_cloning');
        } catch (e) {
            if (!silentCloud) {
                if (!confirm(`云端删除失败：${e?.message || e}\n仍要从本地删除吗？`)) {
                    return false;
                }
            }
        }
    }
    root.myVoices.splice(idx, 1);
    save();
    return true;
}

export function cleanExpiredMyVoices() {
    const root = getRoot();
    const before = root.myVoices.length;
    root.myVoices = root.myVoices.filter(v =>
        v.source === 'manual' || v.activated
        || (Date.now() - (v.createdAt || 0) < 7 * 86400000),
    );
    save();
    return before - root.myVoices.length;
}

export function getExpiryStatus(item) {
    // 手动登记的不走 7 天过期机制（不会被 API 回收）
    if (item.source === 'manual' || item.activated) {
        return { text: '永久', cls: 'green' };
    }
    const elapsed = Date.now() - (item.createdAt || Date.now());
    const remain = 7 * 86400000 - elapsed;
    if (remain <= 0) return { text: '已过期', cls: 'red' };
    const days = Math.floor(remain / 86400000);
    const hours = Math.floor((remain % 86400000) / 3600000);
    return { text: `⏰ ${days}天${hours}小时`, cls: 'amber' };
}

// ── 自定义音色（纯本地）───────────────────────────────

export function listCustomVoices() {
    return [...getRoot().customVoices];
}

export function addCustomVoice({ voice_id, nickname = '', model = '' }) {
    if (!voice_id) throw new Error('voice_id 必填');
    const root = getRoot();
    if (root.customVoices.some(v => v.voice_id === voice_id)) {
        throw new Error(`voice_id "${voice_id}" 已存在于自定义音色中`);
    }
    root.customVoices.push({
        voice_id, nickname, model,
        createdAt: Date.now(),
    });
    save();
}

export function deleteCustomVoice(voiceId) {
    const root = getRoot();
    const idx = root.customVoices.findIndex(v => v.voice_id === voiceId);
    if (idx < 0) return false;
    root.customVoices.splice(idx, 1);
    save();
    return true;
}

export function clearAllCustomVoices() {
    getRoot().customVoices = [];
    save();
}

// ── 当前音色 ────────────────────────────────────────────

export function getCurrentVoiceId() {
    return getRoot().currentVoiceId || null;
}

export function setCurrentVoiceId(voiceId) {
    getRoot().currentVoiceId = voiceId || null;
    save();
}

// ── 旁白音色 ───────────────────────────────────────────

export function getNarrationVoiceId() {
    return getRoot().narrationVoiceId || null;
}

export function setNarrationVoiceId(voiceId) {
    getRoot().narrationVoiceId = voiceId || null;
    save();
}

// ── speaker name → voice_id 解析 ───────────────────────

/**
 * 检索顺序：
 *   1. 自定义音色 nickname 精确 → voice_id
 *   2. 我的音色 nickname / voice_id 匹配
 *   3. 云端 system_voice voice_name / voice_id 匹配
 *   4. 直接当 voice_id 透传
 *
 * 全程不区分大小写。
 *
 * @param {string} name
 * @returns {{voice_id, source, name}|null}
 */
export function findVoiceByName(name) {
    if (!name) return null;
    const target = String(name).trim();
    if (!target) return null;
    const lower = target.toLowerCase();
    const root = getRoot();

    // 0. voiceAliases — 用户为云端/系统音色起的自定义昵称（最高优先级）
    const aliases = root.voiceAliases || {};
    for (const [vid, alias] of Object.entries(aliases)) {
        if (alias && alias.trim() === target) {
            return { voice_id: vid, source: 'alias', name: alias };
        }
    }
    for (const [vid, alias] of Object.entries(aliases)) {
        if (alias && alias.toLowerCase() === lower) {
            return { voice_id: vid, source: 'alias', name: alias };
        }
    }

    // 1. customVoices
    for (const v of root.customVoices || []) {
        if (v.nickname && v.nickname.trim() === target) {
            return { voice_id: v.voice_id, source: 'custom', name: v.nickname };
        }
        if (v.voice_id === target) {
            return { voice_id: v.voice_id, source: 'custom', name: v.nickname || v.voice_id };
        }
    }
    for (const v of root.customVoices || []) {
        if (v.nickname && v.nickname.toLowerCase() === lower) {
            return { voice_id: v.voice_id, source: 'custom', name: v.nickname };
        }
        if (v.voice_id.toLowerCase() === lower) {
            return { voice_id: v.voice_id, source: 'custom', name: v.nickname || v.voice_id };
        }
    }

    // 2. myVoices
    for (const v of root.myVoices || []) {
        if (v.nickname && v.nickname.trim() === target) {
            return { voice_id: v.voice_id, source: 'mine', name: v.nickname };
        }
        if (v.voice_id === target) {
            return { voice_id: v.voice_id, source: 'mine', name: v.nickname || v.voice_id };
        }
    }
    for (const v of root.myVoices || []) {
        if (v.nickname && v.nickname.toLowerCase() === lower) {
            return { voice_id: v.voice_id, source: 'mine', name: v.nickname };
        }
        if (v.voice_id.toLowerCase() === lower) {
            return { voice_id: v.voice_id, source: 'mine', name: v.nickname || v.voice_id };
        }
    }

    // 3. cloud system_voice
    const sys = root.cloudVoicesCache?.system || [];
    for (const v of sys) {
        if (v.voice_name === target) {
            return { voice_id: v.voice_id, source: 'cloud', name: v.voice_name };
        }
        if (v.voice_id === target) {
            return { voice_id: v.voice_id, source: 'cloud', name: v.voice_name || v.voice_id };
        }
    }
    for (const v of sys) {
        if (v.voice_name && v.voice_name.toLowerCase() === lower) {
            return { voice_id: v.voice_id, source: 'cloud', name: v.voice_name };
        }
        if (v.voice_id.toLowerCase() === lower) {
            return { voice_id: v.voice_id, source: 'cloud', name: v.voice_name || v.voice_id };
        }
    }

    // 4. 透传（让 minimax 服务端自己判错）
    return null;
}

// ── 语言识别（搬自 minimax语音接口.html:1122-1139）─────

const LANG_MAP = {
    'chinese (mandarin)': '中文（普通话）', 'cantonese': '粤语', 'english': '英语',
    'japanese': '日语', 'korean': '韩语', 'spanish': '西班牙语', 'portuguese': '葡萄牙语',
    'french': '法语', 'russian': '俄语', 'indonesian': '印尼语', 'german': '德语',
    'italian': '意大利语', 'arabic': '阿拉伯语', 'turkish': '土耳其语', 'thai': '泰语',
    'dutch': '荷兰语', 'vietnamese': '越南语', 'ukrainian': '乌克兰语', 'polish': '波兰语',
    'romanian': '罗马尼亚语', 'greek': '希腊语', 'czech': '捷克语', 'finnish': '芬兰语',
    'hindi': '印地语', 'bulgarian': '保加利亚语', 'danish': '丹麦语', 'hebrew': '希伯来语',
    'malay': '马来语', 'persian': '波斯语', 'slovak': '斯洛伐克语', 'swedish': '瑞典语',
    'croatian': '克罗地亚语', 'filipino': '菲律宾语', 'hungarian': '匈牙利语',
    'norwegian': '挪威语', 'slovenian': '斯洛文尼亚语', 'catalan': '加泰罗尼亚语',
    'tamil': '泰米尔语', 'afrikaans': '南非荷兰语',
};

export function extractLang(voiceId) {
    if (!voiceId) return '其他';
    const l = String(voiceId).toLowerCase();
    for (const [k, v] of Object.entries(LANG_MAP)) {
        if (l.startsWith(k)) return v;
    }
    return String(voiceId).split('_')[0] || '其他';
}

// ── speaker 列表（统一供 prompt / preview / external-player 使用）──

/**
 * 把 MiniMax 的 customVoices + myVoices + cloudVoicesCache.system 拼成
 * `[{ name, description }]` 列表，按 custom > mine > cloud 顺序，同名去重。
 *
 * - name: 优先用户自定义昵称（voiceAliases / nickname），其次 voice_name，
 *         最后回退 voice_id；这正是 BGM speaker 字段会写的人声名。
 * - description: 备注 / 描述 / voice_id 等可读信息，用于 LLM 选择与 UI 展示。
 *
 * @returns {Array<{name: string, description: string, voice_id: string, source: string}>}
 */
export function listAllSpeakers() {
    const root = getRoot();
    const out = [];

    for (const v of (root.customVoices || [])) {
        out.push({
            name: v.nickname || v.voice_id,
            description: `自定义音色 voice_id=${v.voice_id}` + (v.model ? ` (model=${v.model})` : ''),
            voice_id: v.voice_id,
            source: 'custom',
        });
    }

    for (const v of (root.myVoices || [])) {
        out.push({
            name: v.nickname || v.voice_id,
            description: (v.note ? v.note + ' · ' : '') + `voice_id=${v.voice_id}`,
            voice_id: v.voice_id,
            source: 'mine',
        });
    }

    const sys = root.cloudVoicesCache?.system || [];
    const aliases = root.voiceAliases || {};
    for (const v of sys) {
        const alias = aliases[v.voice_id];
        const desc = Array.isArray(v.description) ? v.description.join('; ') : (v.description || '');
        out.push({
            name: alias || v.voice_name || v.voice_id,
            description: desc || `voice_id=${v.voice_id}`,
            voice_id: v.voice_id,
            source: 'cloud',
        });
    }

    const seen = new Set();
    return out.filter(s => {
        if (!s.name || seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
    });
}

// ── pronunciation_dict 工具 ───────────────────────────

export function buildPronDict(pronList) {
    const arr = Array.isArray(pronList) ? pronList : (getRoot().pronDict || []);
    const tone = arr
        .filter(p => p && p.word && p.phonetic && p.word.trim() && p.phonetic.trim())
        .map(p => `${p.word.trim()}/${p.phonetic.trim()}`);
    return tone.length ? { tone } : null;
}

export function buildVoiceModify(vm) {
    const v = vm || getRoot().vm || {};
    const p = parseInt(v.pitch) || 0;
    const i = parseInt(v.intensity) || 0;
    const t = parseInt(v.timbre) || 0;
    const se = v.soundEffect || '';
    if (p === 0 && i === 0 && t === 0 && !se) return null;
    const out = {};
    if (p !== 0) out.pitch = p;
    if (i !== 0) out.intensity = i;
    if (t !== 0) out.timbre = t;
    if (se) out.sound_effects = se;
    return out;
}

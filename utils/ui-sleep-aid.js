// @ts-nocheck
// 助眠中心页面交互模块
// 本阶段：仅做表单填写、收集、预览，不触发实际生成

import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName, extensionFolderPath, LLMRequestTypes } from "./config.js";
import { buildPromptForRequestType, executeTypedLLMRequest } from "./llm-service.js";
import { parseBGMContent } from "./helpers.js";
import { get_yin_xiao_world_info, get_yin_xiao_world_setting, search_yin_xiao_zi_yuan } from "./world-info.js";
import { readNarrationVoiceOpts, _expandNimoOpts, getOrFetchEdge } from "./narration-tts.js";
import { audioBufferToWav, downloadAudioBuffer, downloadAudioBufferAsMp3, renderOfflineAudio } from "./offline-renderer.js";
import { listEdgeSpeakers, findEdgeVoiceByName, validateEdgeStyle } from "./edge-tts.js";
import { listAllSpeakers as listMinimaxSpeakers, findVoiceByName as findMinimaxVoiceByName } from "./minimax-voices.js";
import { listAllSpeakers as listNimoSpeakers, findVoiceByName as findNimoVoiceByName } from "./nimo-voices.js";
import { addOrUpdateTtsItem, getTtsItem } from "./tts-cache.js";
import { addOrUpdateRecentSfxItem, applyRecentSfxOverrides, generateRecentSfxCacheKey } from "./recent-sfx-cache.js";

const ROOT_SELECTOR = '#st-is-tab-sleep-aid';
let currentSleepAidController = null;
let currentSleepAidAudioController = null;
let currentSleepAidMusicList = null;
let currentSleepAidRenderedBuffer = null;
let currentSleepAidRenderedUrl = null;
const DEFAULT_SLEEP_AID_CPM = 240;

/**
 * 注入助眠中心专用 CSS
 */
function injectCss() {
    const id = 'st-is-sleep-aid-css';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `${extensionFolderPath}/css/sleep-aid.css`;
    document.head.appendChild(link);
}

/**
 * 文本映射，用于预览显示
 */
const LABEL_MAP = {
    currentState: {
        racing_thoughts: '思绪停不下来', tired_awake: '身体很累但睡不着',
        low_mood: '情绪低落', anxious: '莫名焦虑', just_relax: '单纯想放松',
        irritable: '烦躁易怒', empty: '空虚发呆', tense: '紧绷难松',
    },
    scene: {
        forest: '森林', ocean: '海边', snowy_cabin: '雪夜小屋', space: '宇宙飘浮',
        childhood_room: '童年房间', mountain_stream: '山间溪流', quiet_temple: '安静寺院',
        rainy_window: '雨夜窗边', fireplace: '壁炉旁', clouds: '云端漂浮', custom: '自定义',
    },
    narrator: {
        healer: '疗愈师', therapist: '心理咨询师', meditation_guide: '冥想导师',
        sister: '温柔的姐姐', brother: '可靠的哥哥', mother: '妈妈', father: '爸爸', lover: '爱人',
        friend: '亲近的朋友', inner_voice: '你自己内在的声音',
        custom: '自定义身份',
    },
    address: {
        you: '你', baby: '宝贝', dear: '亲爱的', child: '孩子', cutie: '小可爱',
        little_one: '小家伙', friend: '朋友',
        use_name: '（用我的名字）', none: '（不称呼）', custom: '自定义称呼',
    },
    environment: {
        in_bed: '床上准备入睡', couch: '沙发椅子小憩',
        commute: '通勤路上', work_break: '工作间隙快速放松',
    },
    bodyTension: {
        neck_shoulder: '肩颈', chest: '胸口', stomach: '胃部', jaw: '下颌',
        back: '后背', waist: '腰部', head: '头部', eyes: '眼睛', whole: '全身',
    },
    sensoryPreference: {
        visual: '看到的画面', auditory: '听到的声音',
        kinesthetic: '身体的感受', olfactory: '气味或味道',
    },
    troubles: {
        work_pressure: '工作压力', conflict: '人际冲突', family: '家庭事务',
        relationship: '感情困扰', money: '经济压力', health: '健康担忧',
        unfinished: '未完成的事', future_anxiety: '对未来的焦虑',
        info_overload: '信息过载', body_tired: '身体疲惫',
        low_mood2: '情绪低落', vague: '说不清的烦躁',
    },
    bright: {
        hot_drink: '一杯热饮', good_meal: '一顿好饭', good_weather: '好天气',
        music: '一段音乐', friend_msg: '朋友的消息', alone_moment: '独处的片刻',
        task_done: '完成了一件事', tender_moment: '一个温柔的瞬间',
        body_relaxed: '身体放松了一下', liked_thing: '看到喜欢的东西',
        just_ok: '没什么特别但还行',
    },
    mood: {
        companied: '被陪伴', allowed_to_rest: '被允许什么都不做',
        understood: '被理解', protected: '被保护', witnessed: '被见证',
        quiet: '安静', warm: '温暖', safe: '安全感',
        restart: '重新开始的感觉', blank: '什么都不想', empty_mind: '单纯放空',
    },
    voiceGender: { any: '不限', female: '女声', male: '男声', neutral: '中性' },
    safetyExtras: {
        sound: '一个声音', smell: '一种气味', touch: '一种触感',
        light: '一种光线', distance: '一种距离', warmth: '一种温度',
    },
    forbiddenWords: {
        darkness: '黑暗', pitch_black: '漆黑', falling: '坠落', sinking: '下沉',
        disappear: '消失', vanish: '不见', alone: '一个人', lonely: '孤独',
        mother: '母亲', father: '父亲', home: '家', death: '死亡',
        forever: '永远', end: '结束', leave: '离开', lose: '失去',
        silence: '沉默', empty_room: '空荡',
    },
    endingStyle: {
        sleep: '直接入睡', mindful: '保留清醒做正念',
        wake: '轻轻唤醒', music_only: '只留音乐',
    },
};

/**
 * 第一层必填字段
 */
const LAYER_1_REQUIRED = ['currentState', 'scene', 'narrator', 'address', 'environment'];

/**
 * 绑定 pill / chip 点击行为
 * - mode='single'：单选，同 data-field 内互斥
 * - mode='multi' ：多选，独立切换
 * - data-shared-group：跨多个 group 共享互斥（如讲述人分组场景）
 */
function bindToggleButtons(root) {
    root.addEventListener('click', (e) => {
        const btn = e.target.closest('.sa-pill, .sa-chip');
        if (!btn) return;
        const group = btn.closest('[data-mode]');
        if (!group) return;

        const mode = group.dataset.mode;
        const field = group.dataset.field;
        const sharedGroup = group.dataset.sharedGroup;

        if (mode === 'single') {
            // 清除互斥范围内的所有选中
            const scope = sharedGroup
                ? root.querySelectorAll(`[data-shared-group="${sharedGroup}"] .sa-pill.is-selected, [data-shared-group="${sharedGroup}"] .sa-chip.is-selected`)
                : group.querySelectorAll('.sa-pill.is-selected, .sa-chip.is-selected');
            scope.forEach(el => el.classList.remove('is-selected'));
            btn.classList.add('is-selected');

            // 处理与该 field 关联的所有 sub-input：先全收起
            collapseSubInputsForField(root, field);

            // 处理 data-expand：展开对应子输入
            const expandId = btn.dataset.expand;
            if (expandId) {
                showSubInput(root, expandId);
            }

            // 安全记忆模板：自动填入 textarea
            if (field === 'safeMemoryTemplate') {
                const tpl = btn.dataset.template || '';
                const textarea = root.querySelector('[data-field="safeMemoryText"]');
                if (textarea) {
                    textarea.value = tpl;
                }
            }
        } else if (mode === 'multi') {
            btn.classList.toggle('is-selected');
        }

        updateGenerateButtonState(root);
    });
}

/**
 * 折起当前 field 关联的所有展开子输入
 */
function collapseSubInputsForField(root, field) {
    // 找到当前 field 的 group 内所有有 data-expand 的按钮
    const group = root.querySelector(`[data-field="${field}"]`);
    if (!group) return;
    // 但有些 field 跨多个 group（讲述人），这里收集所有同 field 的 group
    const groups = root.querySelectorAll(`[data-field="${field}"]`);
    const expandIds = new Set();
    groups.forEach(g => {
        g.querySelectorAll('[data-expand]').forEach(b => {
            expandIds.add(b.dataset.expand);
        });
    });
    expandIds.forEach(id => {
        const el = root.querySelector(`#${id}`);
        if (el) el.hidden = true;
    });
}

function showSubInput(root, id) {
    const el = root.querySelector(`#${id}`);
    if (el) {
        el.hidden = false;
        const input = el.querySelector('input, textarea');
        if (input) setTimeout(() => input.focus(), 50);
    }
}

/**
 * 绑定折叠/展开按钮（第二层、第三层）
 */
function bindCollapseButtons(root) {
    root.querySelectorAll('.sa-collapse-btn[data-collapse-target]').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.collapseTarget;
            const target = root.querySelector(`#${targetId}`);
            if (!target) return;
            const collapsed = btn.classList.toggle('is-collapsed');
            target.hidden = collapsed;
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            const icon = btn.querySelector('.sa-collapse-icon');
            if (icon) icon.textContent = collapsed ? '▸' : '▾';
        });
    });
}

/**
 * 绑定 "+ 自定义..." 等展开按钮
 */
function bindExpandButtons(root) {
    root.querySelectorAll('.sa-expand-btn[data-expand]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.expand;
            const el = root.querySelector(`#${id}`);
            if (!el) return;
            el.hidden = !el.hidden;
            if (!el.hidden) {
                const input = el.querySelector('input, textarea');
                if (input) setTimeout(() => input.focus(), 50);
            }
        });
    });
}

/**
 * 收集表单数据
 */
function collectUserInput(root) {
    const getSingle = (field) => {
        const groups = root.querySelectorAll(`[data-field="${field}"]`);
        for (const g of groups) {
            const sel = g.querySelector('.sa-pill.is-selected, .sa-chip.is-selected');
            if (sel) return sel.dataset.value;
        }
        return null;
    };

    const getMulti = (field) => {
        const result = [];
        const groups = root.querySelectorAll(`[data-field="${field}"]`);
        groups.forEach(g => {
            g.querySelectorAll('.sa-chip.is-selected, .sa-pill.is-selected').forEach(el => {
                result.push(el.dataset.value);
            });
        });
        return result;
    };

    const getInput = (field) => {
        const el = root.querySelector(`[data-field="${field}"]`);
        return el ? (el.value || '').trim() : '';
    };

    const sceneType = getSingle('scene');
    const narratorType = getSingle('narrator');
    const addressType = getSingle('address');

    return {
        // 第一层
        currentState: getSingle('currentState'),
        scene: {
            type: sceneType,
            custom: sceneType === 'custom' ? (getInput('sceneCustom') || null) : null,
        },
        narrator: {
            type: narratorType,
            custom: narratorType === 'custom' ? (getInput('narratorCustom') || null) : null,
        },
        address: {
            type: addressType,
            customName: addressType === 'use_name' ? (getInput('addressCustomName') || null) : null,
            customTerm: addressType === 'custom' ? (getInput('addressCustomTerm') || null) : null,
        },
        environment: getSingle('environment'),

        // 第二层
        bodyTension: getMulti('bodyTension'),
        sensoryPreference: getSingle('sensoryPreference'),
        troubles: {
            presets: getMulti('troubles'),
            custom: getInput('troublesCustom'),
        },
        bright: {
            presets: getMulti('bright'),
            custom: getInput('brightCustom'),
        },
        mood: {
            presets: getMulti('mood'),
            custom: getInput('moodCustom'),
        },
        duration: parseInt(getSingle('duration') || '10', 10),
        voiceGender: getSingle('voiceGender') || 'any',

        // 第三层
        safeMemory: {
            templateKey: getSingle('safeMemoryTemplate'),
            text: getInput('safeMemoryText'),
        },
        safetyExtras: getMulti('safetyExtras'),
        forbiddenWords: {
            presets: getMulti('forbiddenWords'),
            custom: getInput('forbiddenCustom')
                .split(/[,，;；]/).map(s => s.trim()).filter(Boolean),
        },
        endingStyle: getSingle('endingStyle'),

        _meta: {
            timestamp: Date.now(),
            version: 1,
        },
    };
}

/**
 * 校验第一层是否完整
 */
function validateLayer1(root) {
    for (const field of LAYER_1_REQUIRED) {
        const groups = root.querySelectorAll(`[data-field="${field}"]`);
        let hasSelected = false;
        groups.forEach(g => {
            if (g.querySelector('.sa-pill.is-selected, .sa-chip.is-selected')) {
                hasSelected = true;
            }
        });
        if (!hasSelected) return false;
    }
    return true;
}

/**
 * 更新生成按钮可用状态
 */
function updateGenerateButtonState(root) {
    const ok = validateLayer1(root);
    const btn = root.querySelector('#sa-generate-btn');
    const hint = root.querySelector('#sa-validation-hint');
    if (btn) btn.disabled = !ok || !!currentSleepAidController;
    if (hint) hint.hidden = ok;
    updateAudioActionState(root);
}

/**
 * 生成自然语言预览
 */
function buildPreviewText(data) {
    const lines = [];

    const stateLabel = LABEL_MAP.currentState[data.currentState] || data.currentState;
    const sceneLabel = data.scene.type === 'custom'
        ? (data.scene.custom || '自定义场景')
        : (LABEL_MAP.scene[data.scene.type] || '');
    const envLabel = LABEL_MAP.environment[data.environment] || '';
    const narratorLabel = data.narrator.type === 'custom'
        ? (data.narrator.custom || '自定义身份')
        : (LABEL_MAP.narrator[data.narrator.type] || '');
    let addressLabel;
    if (data.address.type === 'use_name') {
        addressLabel = data.address.customName ? `用名字"${data.address.customName}"` : '用我的名字';
    } else if (data.address.type === 'custom') {
        addressLabel = data.address.customTerm || '自定义称呼';
    } else if (data.address.type === 'none') {
        addressLabel = '不使用称呼';
    } else {
        addressLabel = `「${LABEL_MAP.address[data.address.type] || ''}」`;
    }

    lines.push(`📍 此刻你在「${envLabel}」，状态是「${stateLabel}」。`);
    lines.push(`🌫️ 想象的场景是「${sceneLabel}」。`);
    lines.push(`🎙️ 由「${narratorLabel}」陪伴你，称呼${addressLabel}。`);

    // 第二层
    const optional = [];
    if (data.bodyTension.length) {
        optional.push(`身体紧张：${data.bodyTension.map(k => LABEL_MAP.bodyTension[k]).join('、')}`);
    }
    if (data.sensoryPreference) {
        optional.push(`感官偏好：${LABEL_MAP.sensoryPreference[data.sensoryPreference]}`);
    }
    const troubleAll = [
        ...data.troubles.presets.map(k => LABEL_MAP.troubles[k]),
        ...(data.troubles.custom ? [data.troubles.custom] : []),
    ];
    if (troubleAll.length) optional.push(`困扰：${troubleAll.join('、')}`);
    const brightAll = [
        ...data.bright.presets.map(k => LABEL_MAP.bright[k]),
        ...(data.bright.custom ? [data.bright.custom] : []),
    ];
    if (brightAll.length) optional.push(`一点点好：${brightAll.join('、')}`);
    const moodAll = [
        ...data.mood.presets.map(k => LABEL_MAP.mood[k]),
        ...(data.mood.custom ? [data.mood.custom] : []),
    ];
    if (moodAll.length) optional.push(`想要的感觉：${moodAll.join('、')}`);
    optional.push(`目标时长：${data.duration} 分钟`);
    optional.push(`声音偏好：${LABEL_MAP.voiceGender[data.voiceGender]}`);

    if (optional.length) {
        lines.push('');
        lines.push('—— 第二层 ——');
        optional.forEach(s => lines.push(`· ${s}`));
    }

    // 第三层
    const deep = [];
    if (data.safeMemory.text) {
        deep.push(`安全记忆：${data.safeMemory.text}`);
    }
    if (data.safetyExtras.length) {
        deep.push(`安全感的细节：${data.safetyExtras.map(k => LABEL_MAP.safetyExtras[k]).join('、')}`);
    }
    const forbiddenAll = [
        ...data.forbiddenWords.presets.map(k => LABEL_MAP.forbiddenWords[k]),
        ...data.forbiddenWords.custom,
    ];
    if (forbiddenAll.length) deep.push(`避开的词：${forbiddenAll.join('、')}`);
    if (data.endingStyle) deep.push(`结尾倾向：${LABEL_MAP.endingStyle[data.endingStyle]}`);

    if (deep.length) {
        lines.push('');
        lines.push('—— 第三层 ——');
        deep.forEach(s => lines.push(`· ${s}`));
    }

    return lines.join('\n');
}

function joinLabels(arr, map, customExtras = []) {
    const labels = (arr || []).map(k => map[k]).filter(Boolean);
    return [...labels, ...(customExtras || []).filter(Boolean)].join('、');
}

function buildSleepAidVars(input) {
    const vars = {};
    vars['当下状态'] = LABEL_MAP.currentState[input.currentState] || '';
    vars['场景'] = input.scene.type === 'custom'
        ? (input.scene.custom || '一个想象中的地方')
        : (LABEL_MAP.scene[input.scene.type] || '');
    vars['讲述人'] = input.narrator.type === 'custom'
        ? (input.narrator.custom || '一个温柔的声音')
        : (LABEL_MAP.narrator[input.narrator.type] || '');
    if (input.address.type === 'use_name') {
        vars['称呼'] = input.address.customName || '你';
    } else if (input.address.type === 'custom') {
        vars['称呼'] = input.address.customTerm || '你';
    } else if (input.address.type === 'none') {
        vars['称呼'] = '（不使用称呼）';
    } else {
        vars['称呼'] = LABEL_MAP.address[input.address.type] || '你';
    }
    vars['当前环境'] = LABEL_MAP.environment[input.environment] || '';
    vars['身体紧张点'] = joinLabels(input.bodyTension, LABEL_MAP.bodyTension) || '（未指定）';
    vars['感官偏好'] = LABEL_MAP.sensoryPreference[input.sensoryPreference] || '（不限）';
    vars['困扰'] = joinLabels(input.troubles.presets, LABEL_MAP.troubles, input.troubles.custom ? [input.troubles.custom] : []) || '（无特别困扰）';
    vars['小确幸'] = joinLabels(input.bright.presets, LABEL_MAP.bright, input.bright.custom ? [input.bright.custom] : []) || '（暂时想不起来）';
    vars['想要的感觉'] = joinLabels(input.mood.presets, LABEL_MAP.mood, input.mood.custom ? [input.mood.custom] : []) || '（开放式）';
    vars['时长'] = String(input.duration || 10);
    vars['声音性别'] = LABEL_MAP.voiceGender[input.voiceGender] || '不限';
    vars['安全记忆'] = input.safeMemory?.text || '（未提供）';
    vars['安心细节'] = joinLabels(input.safetyExtras, LABEL_MAP.safetyExtras) || '（未指定）';
    vars['禁忌词'] = joinLabels(input.forbiddenWords.presets, LABEL_MAP.forbiddenWords, input.forbiddenWords.custom) || '（无）';
    vars['结尾方式'] = LABEL_MAP.endingStyle[input.endingStyle] || '直接入睡';
    vars.userBriefJson = JSON.stringify(input, null, 2);
    return vars;
}

function applyVarsToMessages(messages, vars) {
    return messages.map(msg => ({
        ...msg,
        content: String(msg?.content || '').replace(/\{\{([^{}\s]+)\}\}/g, (raw, key) => (
            Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : raw
        )),
    }));
}

function getSleepAidSettings() {
    if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
    if (!extension_settings[extensionName].sleepAid || typeof extension_settings[extensionName].sleepAid !== 'object') {
        extension_settings[extensionName].sleepAid = {
            lastInput: null,
            lastResult: null,
            audioEngine: 'edge',
            lastAudio: null,
            audioContextOverrideEnabled: false,
            audioContextOverrideText: '',
        };
    }
    const sleepAid = extension_settings[extensionName].sleepAid;
    if (typeof sleepAid.audioContextOverrideEnabled !== 'boolean') {
        sleepAid.audioContextOverrideEnabled = false;
    }
    if (typeof sleepAid.audioContextOverrideText !== 'string') {
        sleepAid.audioContextOverrideText = '';
    }
    return sleepAid;
}

function getSleepAidAudioContextOverride(root) {
    const sleepAid = getSleepAidSettings();
    const enabled = root
        ? !!root.querySelector('#sa-audio-context-override-enabled')?.checked
        : !!sleepAid.audioContextOverrideEnabled;
    const text = root
        ? String(root.querySelector('#sa-audio-context-override-text')?.value || '')
        : String(sleepAid.audioContextOverrideText || '');
    return enabled ? text.trim() : '';
}

function syncSleepAidAudioContextOverrideUI(root) {
    const sleepAid = getSleepAidSettings();
    const enabledEl = root.querySelector('#sa-audio-context-override-enabled');
    const textEl = root.querySelector('#sa-audio-context-override-text');
    if (enabledEl) enabledEl.checked = !!sleepAid.audioContextOverrideEnabled;
    if (textEl) {
        textEl.value = String(sleepAid.audioContextOverrideText || '');
        textEl.disabled = !sleepAid.audioContextOverrideEnabled;
    }
}

function invalidateSleepAidRenderedOutput(root, statusText = '') {
    clearAudioSessionState(root);
    if (statusText) {
        setAudioStatus(root, statusText);
    }
    updateAudioActionState(root);
}

function setResultStatus(root, text) {
    const el = root.querySelector('#sa-result-status');
    if (el) el.textContent = text || '';
}

function showResult(root, text, status = '') {
    const area = root.querySelector('#sa-result-area');
    const textarea = root.querySelector('#sa-result-text');
    if (textarea) textarea.value = text || '';
    if (area) area.hidden = !String(text || '').trim();
    setResultStatus(root, status);
}

function syncSleepAidMusicListFromPreviewCache(musicList) {
    if (!Array.isArray(musicList)) return [];
    return musicList.map(item => {
        if (item?.type !== 'VOICE' || !item.cacheKey) {
            return item;
        }
        const cached = getTtsItem(item.cacheKey);
        if (!cached) {
            return item;
        }
        return {
            ...item,
            url: resolveCachedTtsAudioUrl(cached) || item.url,
            text: String(cached.text || item.text || '').trim() || item.text,
            context: String(cached.text || item.context || item.text || '').trim() || item.context,
            context_texts: cached.context_texts ?? item.context_texts,
            speaker: cached.speaker_name || cached.speaker || cached.metadata?.speaker || item.speaker,
            volume: cached.volume ?? item.volume,
            ir_description: cached.ir_description ?? item.ir_description,
            special_effects: cached.special_effects ?? item.special_effects,
            spatial: cached.spatial ?? item.spatial,
        };
    });
}

function invalidateSleepAidAudio(root, statusText = '未开始') {
    clearAudioSessionState(root);
    const sleepAid = getSleepAidSettings();
    sleepAid.lastAudio = null;
    setAudioResultDisplay(root, '', null);
    setAudioStatus(root, statusText);
    updateAudioActionState(root);
}

function clearResult(root) {
    const area = root.querySelector('#sa-result-area');
    const textarea = root.querySelector('#sa-result-text');
    if (textarea) textarea.value = '';
    if (area) area.hidden = true;
    setResultStatus(root, '');
    invalidateSleepAidAudio(root, '未开始');
}

function updateAudioActionState(root) {
    const sleepAid = getSleepAidSettings();
    const hasText = !!getCurrentSleepAidText(root);
    const isGeneratingAudio = !!currentSleepAidAudioController;
    const genBtn = root.querySelector('#sa-generate-audio-btn');
    const abortBtn = root.querySelector('#sa-audio-abort-btn');
    const reparseBtn = root.querySelector('#sa-audio-reparse-btn');
    const renderBtn = root.querySelector('#sa-render-audio-btn');
    const downloadBtn = root.querySelector('#sa-audio-download-btn');
    const engineSelect = root.querySelector('#sa-audio-engine');
    const hint = root.querySelector('#sa-audio-hint');

    const rawConfigEl = root.querySelector('#sa-audio-raw-config');
    const hasRawText = !!String(rawConfigEl?.value || '').trim();

    if (genBtn) genBtn.disabled = !hasText || isGeneratingAudio;
    if (abortBtn) abortBtn.hidden = !isGeneratingAudio;
    if (reparseBtn) reparseBtn.disabled = !hasRawText || !hasText || isGeneratingAudio;
    if (renderBtn) renderBtn.disabled = !hasRawText || !hasText || isGeneratingAudio;
    if (downloadBtn) downloadBtn.disabled = !currentSleepAidRenderedBuffer;
    if (engineSelect) engineSelect.disabled = isGeneratingAudio;
    if (hint) {
        hint.textContent = !hasText
            ? '请先生成或编辑助眠脚本文本。'
            : hasRawText
                ? '可编辑配置后点击「重新解析」检查摘要；点击「生成音频文件」时会统一请求 TTS 并离线渲染。'
                : '先生成脚本文本，再点击「生成音频」产出配置；真正的 TTS 会在「生成音频文件」时请求。';
    }
}

function hydrateSleepAidAudioUI(root) {
    const sleepAid = getSleepAidSettings();
    const engineSelect = root.querySelector('#sa-audio-engine');
    if (engineSelect) {
        engineSelect.value = normalizeAudioEngine(sleepAid.audioEngine || extension_settings[extensionName]?.narration_engine || 'edge');
    }
    syncSleepAidAudioContextOverrideUI(root);
    if (sleepAid.lastAudio?.rawConfig) {
        setAudioResultDisplay(root, sleepAid.lastAudio.rawConfig, sleepAid.lastAudio.parsed || null);
        setAudioStatus(root, '已恢复上次音频配置');
    } else {
        setAudioResultDisplay(root, '', null);
        setAudioStatus(root, '未开始');
    }
    updateAudioActionState(root);
}

async function downloadSleepAidAudio(root) {
    if (!currentSleepAidRenderedBuffer) {
        toastr.warning('请先生成音频文件。');
        return;
    }
    const sleepAid = getSleepAidSettings();
    const ts = Number(sleepAid.lastAudio?.ts) || Date.now();
    const stamp = new Date(ts).toISOString().replace(/[\:\.]/g, '-');

    const downloadBtn = root.querySelector('#sa-audio-download-btn');
    const originalLabel = downloadBtn?.textContent;
    if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'MP3 编码中...';
    }
    const previousStatus = root.querySelector('#sa-audio-status')?.textContent;
    try {
        await downloadAudioBufferAsMp3(
            currentSleepAidRenderedBuffer,
            `助眠引导-${stamp}.mp3`,
            {
                bitrate: 192,
                mono: false,
                onProgress: (p) => {
                    setAudioStatus(root, `MP3 编码中 ${(p * 100).toFixed(0)}%`);
                },
            },
        );
        setAudioStatus(root, 'MP3 已导出');
    } catch (error) {
        console.error('[Sleep Aid] MP3 导出失败:', error);
        toastr.error('MP3 导出失败：' + (error?.message || error));
        if (previousStatus) setAudioStatus(root, previousStatus);
    } finally {
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = originalLabel || '💾 下载';
        }
        updateAudioActionState(root);
    }
}

async function generateSleepAidAudioConfig(root) {
    const sourceText = getCurrentSleepAidText(root);
    if (!sourceText) {
        toastr.warning('请先生成或填写助眠脚本。');
        setAudioStatus(root, '缺少脚本文本');
        updateAudioActionState(root);
        return;
    }

    const baseMessages = buildPromptForRequestType(LLMRequestTypes.SLEEP_AID_SFX, '');
    if (!baseMessages.length) {
        toastr.warning('未找到「助眠音效生成」绑定的上下文预设，请先在 LLM 设置中检查。');
        setAudioStatus(root, '未找到上下文预设');
        updateAudioActionState(root);
        return;
    }

    const engine = getSelectedSleepAidEngine(root);
    const vars = await buildSleepAidAudioVars(root, sourceText);
    const messages = applyVarsToMessages(baseMessages, vars);
    const controller = new AbortController();
    const sleepAid = getSleepAidSettings();
    sleepAid.audioEngine = engine;
    saveSettingsDebounced();
    currentSleepAidAudioController = controller;
    clearAudioSessionState(root);
    setAudioResultDisplay(root, '', null);
    enterAudioLoadingUI(root, '调用 LLM 中...');

    try {
        const rawConfig = await executeTypedLLMRequest(messages, LLMRequestTypes.SLEEP_AID_SFX, controller.signal);
        throwIfAborted(controller.signal);
        setAudioStatus(root, '解析配置中...');
        const parsed = parseBGMContent(rawConfig);
        throwIfAborted(controller.signal);
        sleepAid.lastAudio = {
            engine,
            rawConfig,
            parsed,
            sourceText,
            cpm: DEFAULT_SLEEP_AID_CPM,
            ts: Date.now(),
        };
        setAudioResultDisplay(root, rawConfig, parsed);
        setAudioStatus(root, '音频配置已生成，待生成音频文件');
        saveSettingsDebounced();
        toastr.success('助眠音频配置已生成。');
    } catch (error) {
        if (error?.name === 'AbortError') {
            setAudioStatus(root, '已中止');
            toastr.info('已中止音频生成。');
        } else {
            clearAudioSessionState(root);
            setAudioStatus(root, '生成失败');
            toastr.error('助眠音频生成失败：' + (error?.message || error));
        }
    } finally {
        currentSleepAidAudioController = null;
        leaveAudioLoadingUI(root);
    }
}

async function reparseSleepAidAudioConfig(root) {
    const rawConfigEl = root.querySelector('#sa-audio-raw-config');
    const rawConfig = String(rawConfigEl?.value || '').trim();
    if (!rawConfig) {
        toastr.warning('音频配置为空，请先生成或填写。');
        return;
    }
    const sleepAid = getSleepAidSettings();
    const sourceText = sleepAid.lastAudio?.sourceText || getCurrentSleepAidText(root);
    if (!sourceText) {
        toastr.warning('缺少脚本文本，无法重新解析配置。');
        setAudioStatus(root, '缺少脚本文本');
        return;
    }
    const engine = normalizeAudioEngine(sleepAid.lastAudio?.engine || getSelectedSleepAidEngine(root));
    const controller = new AbortController();
    currentSleepAidAudioController = controller;
    clearAudioSessionState(root);
    enterAudioLoadingUI(root, '解析配置中...');
    try {
        const parsed = parseBGMContent(rawConfig);
        throwIfAborted(controller.signal);
        sleepAid.lastAudio = {
            engine,
            rawConfig,
            parsed,
            sourceText,
            cpm: sleepAid.lastAudio?.cpm || DEFAULT_SLEEP_AID_CPM,
            ts: Date.now(),
        };
        setAudioResultDisplay(root, rawConfig, parsed);
        setAudioStatus(root, '配置已重新解析，待生成音频文件');
        saveSettingsDebounced();
        toastr.success('音频配置已重新解析。');
    } catch (error) {
        if (error?.name === 'AbortError') {
            setAudioStatus(root, '已中止');
            toastr.info('已中止重新解析。');
        } else {
            console.error('[Sleep Aid] 重新解析失败:', error);
            setAudioStatus(root, '解析失败');
            toastr.error('重新解析失败：' + (error?.message || error));
        }
    } finally {
        currentSleepAidAudioController = null;
        leaveAudioLoadingUI(root);
    }
}

function wireAudioSection(root) {
    root.querySelector('#sa-audio-engine')?.addEventListener('change', (e) => {
        const nextEngine = normalizeAudioEngine(e.target?.value);
        const sleepAid = getSleepAidSettings();
        if (sleepAid.audioEngine !== nextEngine) {
            sleepAid.audioEngine = nextEngine;
            if (sleepAid.lastAudio) {
                invalidateSleepAidAudio(root, '引擎已切换，需重新生成音频');
            } else {
                updateAudioActionState(root);
            }
            saveSettingsDebounced();
        }
    });

    root.querySelector('#sa-audio-context-override-enabled')?.addEventListener('change', (e) => {
        const sleepAid = getSleepAidSettings();
        sleepAid.audioContextOverrideEnabled = !!e.target?.checked;
        syncSleepAidAudioContextOverrideUI(root);
        saveSettingsDebounced();
        if (sleepAid.lastAudio?.rawConfig) {
            invalidateSleepAidRenderedOutput(root, '全局 context_texts 已更新，重新生成音频文件后生效');
        } else {
            updateAudioActionState(root);
        }
    });

    root.querySelector('#sa-audio-context-override-text')?.addEventListener('input', (e) => {
        const sleepAid = getSleepAidSettings();
        sleepAid.audioContextOverrideText = String(e.target?.value || '');
        saveSettingsDebounced();
        if (sleepAid.audioContextOverrideEnabled && sleepAid.lastAudio?.rawConfig) {
            invalidateSleepAidRenderedOutput(root, '全局 context_texts 已更新，重新生成音频文件后生效');
        } else {
            updateAudioActionState(root);
        }
    });

    root.querySelector('#sa-generate-audio-btn')?.addEventListener('click', async () => {
        await generateSleepAidAudioConfig(root);
    });

    root.querySelector('#sa-audio-abort-btn')?.addEventListener('click', () => {
        if (currentSleepAidAudioController) currentSleepAidAudioController.abort();
    });

    root.querySelector('#sa-audio-reparse-btn')?.addEventListener('click', async () => {
        await reparseSleepAidAudioConfig(root);
    });

    root.querySelector('#sa-audio-raw-config')?.addEventListener('input', () => {
        const sleepAid = getSleepAidSettings();
        if (sleepAid.lastAudio) {
            const value = String(root.querySelector('#sa-audio-raw-config')?.value || '');
            if (sleepAid.lastAudio.rawConfig !== value) {
                sleepAid.lastAudio.rawConfig = value;
                sleepAid.lastAudio.parsed = null;
                setAudioResultDisplay(root, value, null);
                invalidateSleepAidRenderedOutput(root, value.trim() ? '音频配置已修改，请重新解析或直接生成音频文件' : '未开始');
                saveSettingsDebounced();
            }
        }
        updateAudioActionState(root);
    });

    root.querySelector('#sa-render-audio-btn')?.addEventListener('click', async () => {
        await renderSleepAidAudioFile(root);
    });

    root.querySelector('#sa-audio-download-btn')?.addEventListener('click', async () => {
        await downloadSleepAidAudio(root);
    });
}

function createAbortError() {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw createAbortError();
}

function normalizeAudioEngine(value) {
    return ['edge', 'minimax', 'nimo'].includes(value) ? value : 'edge';
}

function buildSearchVariants(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const variants = new Set([raw]);
    variants.add(raw.replace(/…/g, '...'));
    variants.add(raw.replace(/\.\.\./g, '…'));
    variants.add(raw.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
    
    const unquoted = raw.replace(/^["“”'‘]+|["“”'’]+$/g, '').trim();
    if (unquoted && unquoted !== raw) {
        variants.add(unquoted);
        variants.add(unquoted.replace(/…/g, '...'));
        variants.add(unquoted.replace(/\.\.\./g, '…'));
    }
    
    return Array.from(variants).filter(Boolean);
}

function findSnippetIndex(fullText, snippet, fromIndex = 0) {
    for (const variant of buildSearchVariants(snippet)) {
        const index = fullText.indexOf(variant, Math.max(0, fromIndex));
        if (index !== -1) {
            return { index, text: variant };
        }
    }
    return null;
}

function locateRangeInText(fullText, startSnippet, endSnippet, searchFrom = 0, fallbackText = '') {
    const startHit = findSnippetIndex(fullText, startSnippet || fallbackText.slice(0, 16), searchFrom);
    if (!startHit) return null;
    const endHit = findSnippetIndex(fullText, endSnippet || fallbackText.slice(-16), startHit.index);
    if (!endHit) {
        const fallbackLength = Math.max(1, String(fallbackText || startHit.text || '').length);
        return { start: startHit.index, end: startHit.index + fallbackLength };
    }
    return { start: startHit.index, end: endHit.index + Math.max(1, endHit.text.length) };
}

function revokeMusicListUrls(list) {
    (list || []).forEach(item => {
        if (item?.cacheKey) {
            return;
        }
        if (item?.type === 'VOICE' && typeof item.url === 'string' && item.url.startsWith('blob:')) {
            try { URL.revokeObjectURL(item.url); } catch (_) { /* noop */ }
        }
    });
}

function setAudioStatus(root, text) {
    const el = root.querySelector('#sa-audio-status');
    if (el) el.textContent = text || '';
}

function clearRenderedAudioPreview(root) {
    if (currentSleepAidRenderedUrl) {
        try { URL.revokeObjectURL(currentSleepAidRenderedUrl); } catch (_) { /* noop */ }
        currentSleepAidRenderedUrl = null;
    }
    const player = root.querySelector('#sa-audio-player');
    if (player) {
        player.pause();
        player.removeAttribute('src');
        player.load();
    }
}

function clearAudioSessionState(root) {
    revokeMusicListUrls(currentSleepAidMusicList);
    currentSleepAidMusicList = null;
    currentSleepAidRenderedBuffer = null;
    clearRenderedAudioPreview(root);
}

function buildParsedSummary(parsed) {
    if (!parsed) return '';
    const lines = [];
    const sections = [
        ['Music', 'Music'],
        ['Ambiance', 'Ambiance'],
        ['VOICE', 'VOICE'],
        ['SFX', 'SFX'],
        ['SFX_WAIT', 'SFX_WAIT'],
    ];
    sections.forEach(([key, label]) => {
        const list = Array.isArray(parsed[key]) ? parsed[key] : [];
        lines.push(`${label}: ${list.length}`);
        list.forEach((item, index) => {
            const head = item.src || item.speaker || item.regex || item.regex_start || `item_${index + 1}`;
            const tail = item.context ? ` | ${String(item.context).replace(/\s+/g, ' ').slice(0, 40)}` : '';
            lines.push(`  ${index + 1}. ${head}${tail}`);
        });
        lines.push('');
    });
    return lines.join('\n').trim();
}

function setAudioResultDisplay(root, rawConfig, parsed) {
    const area = root.querySelector('#sa-audio-result-area');
    const raw = root.querySelector('#sa-audio-raw-config');
    const summary = root.querySelector('#sa-audio-parsed-summary');
    if (raw) raw.value = rawConfig || '';
    if (summary) summary.value = buildParsedSummary(parsed);
    if (area) area.hidden = !rawConfig;
}

function getCurrentSleepAidText(root) {
    const textarea = root.querySelector('#sa-result-text');
    return String(textarea?.value || '').trim();
}

function getSelectedSleepAidEngine(root) {
    const sleepAid = getSleepAidSettings();
    const selected = root.querySelector('#sa-audio-engine')?.value || sleepAid.audioEngine || extension_settings[extensionName]?.narration_engine;
    return normalizeAudioEngine(selected);
}

function getEffectiveSleepAidVoiceContextTexts(entry, overrideContextTexts = '') {
    return String(overrideContextTexts || '').trim() || String(entry?.context_texts || '').trim();
}

function applySleepAidContextTextsToVoiceOpts(voiceOpts, engine, contextTexts) {
    if (!contextTexts) return voiceOpts;
    if (engine === 'nimo') {
        return {
            ...voiceOpts,
            stylePrefix: contextTexts,
        };
    }
    return voiceOpts;
}

function getCharacterMatchingProfileForEngine(engine) {
    const settings = extension_settings[extensionName] || {};
    if (engine === 'minimax') {
        const profileName = settings.current_minimax_character_matching_profile;
        return settings.minimax_character_matching_profiles?.[profileName] || '';
    }
    if (engine === 'nimo') {
        const profileName = settings.current_nimo_character_matching_profile;
        return settings.nimo_character_matching_profiles?.[profileName] || '';
    }
    const profileName = settings.current_edge_character_matching_profile;
    return settings.edge_character_matching_profiles?.[profileName] || '';
}

function buildSpeakerListDescription(engine, characterMatchingProfile) {
    const speakers = engine === 'minimax'
        ? listMinimaxSpeakers()
        : engine === 'nimo'
            ? listNimoSpeakers()
            : listEdgeSpeakers();
    if (!Array.isArray(speakers) || speakers.length === 0) {
        return '（当前未配置可用人声）';
    }
    let output = '可用人声列表如下：\n';
    speakers.forEach(speaker => {
        if (engine !== 'minimax' || !characterMatchingProfile || characterMatchingProfile.includes(speaker.name)) {
            output += `- 配音名称: ${speaker.name}，配音简介: ${speaker.description}\n`;
        }
    });
    return output.trim() || '（当前未配置可用人声）';
}

async function buildSleepAidAudioVars(root, sourceText) {
    const sleepAid = getSleepAidSettings();
    const input = sleepAid.lastInput || collectUserInput(root);
    const vars = buildSleepAidVars(input);
    const engine = getSelectedSleepAidEngine(root);
    const settings = extension_settings[extensionName] || {};
    const effects = settings.effectsProcessor || {};
    const characterMatchingProfile = getCharacterMatchingProfileForEngine(engine);
    const worldSetting = (await get_yin_xiao_world_setting()).filter(Boolean).join('\n');
    return {
        ...vars,
        userText: sourceText,
        '人声列表': buildSpeakerListDescription(engine, characterMatchingProfile),
        '人声和角色匹配设定': characterMatchingProfile || '（未配置）',
        '所有音效列表': worldSetting || '（未配置）',
        '空间音频介绍': effects.spatialDescriptionProfiles?.[effects.currentSpatialDescriptionProfile] || '（未配置）',
        '环境混响介绍': effects.irDescriptionProfiles?.[effects.currentIrDescriptionProfile] || '（未配置）',
        '声音特效介绍': effects.effectsDescriptionProfiles?.[effects.currentEffectsDescriptionProfile] || '（未配置）',
    };
}

function createSleepAidVoiceCacheKey(engine, index, start, end) {
    return `sleep-aid-voice|${engine || 'edge'}|${index}|${start}|${end}`;
}

function resolveCachedTtsAudioUrl(item) {
    if (item?.audioUrl) return item.audioUrl;
    if (item?.audioBlob instanceof Blob) {
        return URL.createObjectURL(item.audioBlob);
    }
    if (item?.audioBuffer instanceof ArrayBuffer) {
        return URL.createObjectURL(new Blob([item.audioBuffer], { type: 'audio/mp3' }));
    }
    return '';
}

function registerSleepAidAssetPreviewItem(item) {
    const cacheKey = item.cacheKey || generateRecentSfxCacheKey(item);
    addOrUpdateRecentSfxItem(cacheKey, {
        ...item,
        cacheKey,
    });
    return applyRecentSfxOverrides({
        ...item,
        cacheKey,
    });
}

function syncSleepAidParsedFromMusicList(parsed, musicList) {
    if (!parsed || !Array.isArray(musicList)) {
        return parsed;
    }

    const grouped = {
        Music: musicList.filter(item => item?.type === 'Music'),
        Ambiance: musicList.filter(item => item?.type === 'Ambiance'),
        VOICE: musicList.filter(item => item?.type === 'VOICE'),
        SFX: musicList.filter(item => item?.type === 'SFX'),
        SFX_WAIT: musicList.filter(item => item?.type === 'SFX_WAIT'),
    };
    const nextParsed = { ...parsed };

    for (const type of Object.keys(grouped)) {
        const sourceList = Array.isArray(parsed[type]) ? parsed[type] : [];
        const items = grouped[type];
        nextParsed[type] = sourceList.map((entry, index) => {
            const item = items[index];
            if (!item) return entry;
            const nextEntry = {
                ...entry,
                volume: item.volume,
                ir_description: item.ir_description,
                special_effects: item.special_effects,
                spatial: item.spatial,
            };
            if (type === 'VOICE') {
                nextEntry.context = item.context;
                nextEntry.context_texts = item.context_texts || '';
                nextEntry.speaker = item.speaker;
            }
            return nextEntry;
        });
    }

    return nextParsed;
}

async function buildSleepAidAssetItems(parsed, sourceText) {
    await get_yin_xiao_world_info();
    const items = [];
    const loopTypes = new Set(['Music', 'Ambiance']);
    const orderedTypes = ['Music', 'Ambiance', 'SFX', 'SFX_WAIT'];
    const cursors = { Music: 0, Ambiance: 0, SFX: 0, SFX_WAIT: 0 };

    for (const type of orderedTypes) {
        const list = Array.isArray(parsed[type]) ? parsed[type] : [];
        for (const entry of list) {
            if (!entry?.src) continue;
            const asset = search_yin_xiao_zi_yuan(entry.src);
            if (!asset?.url) {
                throw new Error(`未找到音频资源：${entry.src}`);
            }
            let range;
            if (type === 'SFX' || type === 'SFX_WAIT') {
                const hit = findSnippetIndex(sourceText, entry.regex || entry.regex_start || entry.context || '', cursors[type]);
                if (!hit) {
                    throw new Error(`未在脚本中定位到 ${type} 触发文本：${entry.src}`);
                }
                range = { start: hit.index, end: hit.index + hit.text.length };
                cursors[type] = range.end;
            } else {
                range = locateRangeInText(sourceText, entry.regex_start, entry.regex_end, cursors[type], entry.context || '');
                if (!range) {
                    throw new Error(`未在脚本中定位到 ${type} 区间：${entry.src}`);
                }
                cursors[type] = range.end;
            }
            items.push(registerSleepAidAssetPreviewItem({
                type,
                src: entry.src,
                url: asset.url,
                text: entry.context || entry.regex || entry.regex_start || '',
                regex: range.start,
                regex_start: range.start,
                regex_end: Math.max(range.start, range.end - 1),
                loop: typeof entry.loop === 'boolean' ? entry.loop : loopTypes.has(type),
                volume: Number(entry.volume) || Number(asset.volume) || 100,
                ir_description: entry.ir_description || '',
                special_effects: entry.special_effects || '',
                spatial: entry.spatial || '',
                context: entry.context || '',
            }));
        }
    }

    return items;
}

function stripProviderPrefix(value, provider) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (provider === 'edge' && /^edge:/i.test(raw)) return raw.replace(/^edge:/i, '').trim();
    if (provider === 'nimo' && /^(?:mimo|nimo):/i.test(raw)) return raw.replace(/^(?:mimo|nimo):/i, '').trim();
    if (provider === 'minimax' && /^minimax:/i.test(raw)) return raw.replace(/^minimax:/i, '').trim();
    return raw;
}

async function resolveSleepAidVoiceOpts(baseVoiceOpts, engine, speaker) {
    const speakerName = String(speaker || '').trim();
    if (!speakerName) return baseVoiceOpts;

    if (engine === 'edge') {
        const candidate = stripProviderPrefix(speakerName, 'edge');
        const resolved = findEdgeVoiceByName(candidate);
        const voice = resolved?.id || (/^[a-z]{2,3}-/i.test(candidate) ? candidate : '');
        if (!voice) {
            throw new Error(`Edge 未匹配到音色 "${speakerName}"`);
        }
        return {
            ...baseVoiceOpts,
            voice,
            style: validateEdgeStyle(baseVoiceOpts.style, voice) || 'general',
            speakerLabel: `Edge:${voice}`,
        };
    }

    if (engine === 'minimax') {
        const candidate = stripProviderPrefix(speakerName, 'minimax');
        const resolved = findMinimaxVoiceByName(candidate);
        const voiceId = resolved?.voice_id || candidate;
        return {
            ...baseVoiceOpts,
            voice: voiceId,
            voiceKey: voiceId,
            minimax: {
                ...(baseVoiceOpts.minimax || {}),
                voiceId,
            },
            speakerLabel: `MiniMax:${resolved?.name || voiceId}`,
        };
    }

    if (engine === 'nimo') {
        const candidate = stripProviderPrefix(speakerName, 'nimo');
        const resolved = findNimoVoiceByName(candidate);
        const voice = resolved?.id || candidate;
        const nextOpts = {
            ...baseVoiceOpts,
            voice,
            voiceKey: voice,
            nimo: {
                ...(baseVoiceOpts.nimo || {}),
            },
            _needsExpand: true,
            speakerLabel: `MiMo:${resolved?.name || candidate}`,
        };
        await _expandNimoOpts(nextOpts);
        return nextOpts;
    }

    return baseVoiceOpts;
}

// 助眠音频 TTS 并发上限：与 narration-tts.js 中各引擎设定保持一致
const SLEEP_AID_VOICE_CONCURRENCY = { nimo: 50, minimax: 20, edge: 8 };

async function buildSleepAidVoiceItems(parsedVoice, sourceText, engine, signal, onProgress, overrideContextTexts = '') {
    const settings = extension_settings[extensionName] || {};
    const originalEngine = settings.narration_engine;
    const createdItems = [];

    try {
        settings.narration_engine = engine;
        const baseVoiceOpts = readNarrationVoiceOpts();
        await _expandNimoOpts(baseVoiceOpts);

        // Phase 1: 顺序定位所有 range（依赖 cursor 单调推进，必须串行；纯本地计算，几乎无耗时）
        const plan = [];
        let cursor = 0;
        for (let i = 0; i < parsedVoice.length; i++) {
            const entry = parsedVoice[i] || {};
            const context = String(entry.context || '').trim();
            if (!context) continue;
            const range = locateRangeInText(sourceText, entry.regex_start, entry.regex_end, cursor, context);
            if (!range) {
                throw new Error(`未在脚本中定位到 VOICE 段落 ${i + 1}`);
            }
            plan.push({ i, entry, context, range });
            cursor = range.end;
        }

        // Phase 2: 并发拉取 TTS（按 engine 设置并发上限；MiniMax/Nimo 客户端内部还会按 key 池/RPM 自动节流）
        const concurrency = SLEEP_AID_VOICE_CONCURRENCY[engine] || SLEEP_AID_VOICE_CONCURRENCY.edge;
        const results = new Array(plan.length);
        let nextSlot = 0;
        let progressDone = 0;
        const workerCount = Math.max(1, Math.min(concurrency, plan.length));
        await Promise.all(new Array(workerCount).fill(0).map(async () => {
            while (true) {
                const slot = nextSlot++;
                if (slot >= plan.length) return;
                throwIfAborted(signal);
                const { entry, context } = plan[slot];
                const effectiveContextTexts = getEffectiveSleepAidVoiceContextTexts(entry, overrideContextTexts);
                let voiceOpts = await resolveSleepAidVoiceOpts(baseVoiceOpts, engine, entry.speaker);
                voiceOpts = applySleepAidContextTextsToVoiceOpts(voiceOpts, engine, effectiveContextTexts);
                const audio = await getOrFetchEdge(context, voiceOpts);
                throwIfAborted(signal);
                results[slot] = { voiceOpts, audio, effectiveContextTexts };
                progressDone += 1;
                if (typeof onProgress === 'function') onProgress(progressDone, plan.length);
            }
        }));

        // Phase 3: 按原顺序组装 createdItems & 写入 TTS 缓存
        for (let s = 0; s < plan.length; s++) {
            const { i, entry, context, range } = plan[s];
            const { voiceOpts, audio, effectiveContextTexts } = results[s];
            const blobUrl = audio.blob ? URL.createObjectURL(audio.blob) : audio.blobUrl;
            const cacheKey = createSleepAidVoiceCacheKey(engine, i, range.start, range.end);
            if (audio.blob) {
                addOrUpdateTtsItem(cacheKey, {
                    cacheKey,
                    status: 'success',
                    text: context,
                    context_texts: effectiveContextTexts,
                    speaker: entry.speaker || voiceOpts.speakerLabel,
                    speaker_name: entry.speaker || voiceOpts.speakerLabel,
                    audioBlob: audio.blob,
                    audioBuffer: await audio.blob.arrayBuffer(),
                    audioUrl: blobUrl,
                    ir_description: entry.ir_description || '默认 (无)',
                    special_effects: entry.special_effects || '默认',
                    spatial: entry.spatial || '正前方站立',
                    isNarration: true,
                    regex: range.start,
                    regex_start: range.start,
                    regex_end: Math.max(range.start, range.end - 1),
                    metadata: {
                        isNarration: true,
                        engine,
                        speaker: entry.speaker || voiceOpts.speakerLabel,
                        text: context,
                        context_texts: effectiveContextTexts,
                        regex_start: range.start,
                        regex_end: Math.max(range.start, range.end - 1),
                    },
                });
            }
            createdItems.push({
                type: 'VOICE',
                src: `SA-VOICE-${i}-${range.start}`,
                url: blobUrl,
                text: context,
                speedTextLen: context.length,
                regex: range.start,
                regex_start: range.start,
                regex_end: Math.max(range.start, range.end - 1),
                volume: Number(entry.volume) || 100,
                ir_description: entry.ir_description || '默认 (无)',
                special_effects: entry.special_effects || '默认',
                spatial: entry.spatial || '正前方站立',
                speaker: entry.speaker || voiceOpts.speakerLabel,
                context_texts: effectiveContextTexts,
                context,
                cacheKey,
            });
        }
        return createdItems;
    } catch (error) {
        revokeMusicListUrls(createdItems);
        throw error;
    } finally {
        settings.narration_engine = originalEngine;
    }
}

async function buildSleepAidMusicList(parsed, sourceText, engine, signal, onProgress, overrideContextTexts = '') {
    const assetItems = await buildSleepAidAssetItems(parsed, sourceText);
    const voiceItems = await buildSleepAidVoiceItems(Array.isArray(parsed.VOICE) ? parsed.VOICE : [], sourceText, engine, signal, onProgress, overrideContextTexts);
    return [
        ...assetItems.filter(item => item.type === 'Music'),
        ...assetItems.filter(item => item.type === 'Ambiance'),
        ...voiceItems,
        ...assetItems.filter(item => item.type === 'SFX'),
        ...assetItems.filter(item => item.type === 'SFX_WAIT'),
    ];
}

async function refreshSleepAidMusicListFromPreviewCache(musicList, engine) {
    const syncedList = syncSleepAidMusicListFromPreviewCache(musicList);
    const settings = extension_settings[extensionName] || {};
    const originalEngine = settings.narration_engine;

    try {
        settings.narration_engine = engine;
        const baseVoiceOpts = readNarrationVoiceOpts();
        await _expandNimoOpts(baseVoiceOpts);

        // Phase 1: 分类——直接通过 vs 需要刷新
        const tasks = syncedList.map((item, idx) => {
            if (item?.type !== 'VOICE' || !item.cacheKey) {
                return { idx, item, kind: 'passthrough' };
            }
            const cached = getTtsItem(item.cacheKey);
            if (!cached?.audioDirty) {
                return { idx, item, kind: 'passthrough' };
            }
            return { idx, item, kind: 'refetch', cached };
        });

        // Phase 2: 并发刷新需要重新合成的项（保留原位置以便后续按顺序组装）
        const refetchTasks = tasks.filter(t => t.kind === 'refetch');
        const concurrency = SLEEP_AID_VOICE_CONCURRENCY[engine] || SLEEP_AID_VOICE_CONCURRENCY.edge;
        const workerCount = Math.max(1, Math.min(concurrency, refetchTasks.length));
        let nextSlot = 0;
        await Promise.all(new Array(workerCount).fill(0).map(async () => {
            while (true) {
                const slot = nextSlot++;
                if (slot >= refetchTasks.length) return;
                const task = refetchTasks[slot];
                const { item, cached } = task;
                const nextText = String(cached.text || item.context || item.text || '').trim() || item.text;
                const nextContextTexts = cached.context_texts ?? item.context_texts;
                const nextSpeaker = cached.speaker_name || cached.metadata?.speaker || item.speaker;
                const voiceOpts = await resolveSleepAidVoiceOpts(baseVoiceOpts, engine, nextSpeaker);
                const audio = await getOrFetchEdge(nextText, voiceOpts);
                task.fetched = { nextText, nextContextTexts, nextSpeaker, voiceOpts, audio };
            }
        }));

        // Phase 3: 按原顺序组装 nextList & 写回缓存
        const nextList = [];
        for (const t of tasks) {
            if (t.kind === 'passthrough') {
                nextList.push(t.item);
                continue;
            }
            const { item, cached, fetched } = t;
            const { nextText, nextContextTexts, nextSpeaker, audio } = fetched;
            const blobUrl = audio.blob ? URL.createObjectURL(audio.blob) : audio.blobUrl;
            const audioBuffer = audio.blob ? await audio.blob.arrayBuffer() : cached.audioBuffer;

            addOrUpdateTtsItem(item.cacheKey, {
                ...cached,
                text: nextText,
                context_texts: nextContextTexts,
                speaker: nextSpeaker,
                speaker_name: nextSpeaker,
                audioBlob: audio.blob || cached.audioBlob,
                audioBuffer,
                audioUrl: blobUrl,
                ir_description: cached.ir_description ?? item.ir_description,
                special_effects: cached.special_effects ?? item.special_effects,
                spatial: cached.spatial ?? item.spatial,
                audioDirty: false,
                metadata: {
                    ...(cached.metadata || {}),
                    engine,
                    speaker: nextSpeaker,
                    text: nextText,
                    context_texts: nextContextTexts,
                },
            });

            nextList.push({
                ...item,
                url: blobUrl,
                text: nextText,
                context: nextText,
                context_texts: nextContextTexts,
                speaker: nextSpeaker,
                volume: cached.volume ?? item.volume,
                ir_description: cached.ir_description ?? item.ir_description,
                special_effects: cached.special_effects ?? item.special_effects,
                spatial: cached.spatial ?? item.spatial,
            });
        }

        return nextList;
    } finally {
        settings.narration_engine = originalEngine;
    }
}

function leaveAudioLoadingUI(root) {
    const btn = root.querySelector('#sa-generate-audio-btn');
    const abortBtn = root.querySelector('#sa-audio-abort-btn');
    if (btn) btn.textContent = btn.dataset.originalText || '🎧 生成音频';
    if (abortBtn) abortBtn.hidden = true;
    updateAudioActionState(root);
}

function enterAudioLoadingUI(root, statusText) {
    const btn = root.querySelector('#sa-generate-audio-btn');
    const abortBtn = root.querySelector('#sa-audio-abort-btn');
    if (btn) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent || '🎧 生成音频';
        btn.textContent = '处理中...';
    }
    if (abortBtn) abortBtn.hidden = false;
    setAudioStatus(root, statusText || '处理中...');
    updateAudioActionState(root);
}

async function renderSleepAidAudioFile(root) {
    const sleepAid = getSleepAidSettings();
    const rawConfig = String(root.querySelector('#sa-audio-raw-config')?.value || sleepAid.lastAudio?.rawConfig || '').trim();
    if (!rawConfig) {
        toastr.warning('请先生成或填写音频配置。');
        setAudioStatus(root, '缺少音频配置');
        updateAudioActionState(root);
        return;
    }
    const sourceText = sleepAid.lastAudio?.sourceText || getCurrentSleepAidText(root);
    if (!sourceText) {
        toastr.warning('请先生成或填写助眠脚本。');
        setAudioStatus(root, '缺少脚本文本');
        return;
    }
    const engine = normalizeAudioEngine(sleepAid.lastAudio?.engine || getSelectedSleepAidEngine(root));
    const cpm = Number(sleepAid.lastAudio?.cpm) || DEFAULT_SLEEP_AID_CPM;
    const overrideContextTexts = getSleepAidAudioContextOverride(root);
    const controller = new AbortController();
    currentSleepAidAudioController = controller;
    clearAudioSessionState(root);
    const renderBtn = root.querySelector('#sa-render-audio-btn');
    if (renderBtn) {
        renderBtn.disabled = true;
        renderBtn.dataset.originalText = renderBtn.textContent || '🎼 生成音频文件';
        renderBtn.textContent = '准备中...';
    }
    updateAudioActionState(root);
    setAudioStatus(root, '解析配置中...');
    try {
        const parsed = parseBGMContent(rawConfig);
        throwIfAborted(controller.signal);
        sleepAid.lastAudio = {
            ...(sleepAid.lastAudio || {}),
            engine,
            rawConfig,
            parsed,
            sourceText,
            cpm,
            ts: Date.now(),
        };
        setAudioResultDisplay(root, rawConfig, parsed);
        const musicList = await buildSleepAidMusicList(parsed, sourceText, engine, controller.signal, (index, total) => {
            setAudioStatus(root, `请求 TTS ${index}/${total}`);
        }, overrideContextTexts);
        throwIfAborted(controller.signal);
        const syncedMusicList = syncSleepAidMusicListFromPreviewCache(musicList);
        currentSleepAidMusicList = syncedMusicList;
        sleepAid.lastAudio.parsed = syncSleepAidParsedFromMusicList(parsed, syncedMusicList);
        setAudioResultDisplay(root, rawConfig, sleepAid.lastAudio.parsed);
        saveSettingsDebounced();
        if (renderBtn) renderBtn.textContent = '离线渲染中...';
        setAudioStatus(root, '准备离线渲染...');
        const result = await renderOfflineAudio(syncedMusicList, sourceText, cpm, [], {
            onProgress: (payload) => {
                setAudioStatus(root, formatSleepAidRenderStatus(payload));
            },
        });
        if (!result?.renderedBuffer) {
            throw new Error('离线渲染未返回可用音频');
        }
        currentSleepAidRenderedBuffer = result.renderedBuffer;
        clearRenderedAudioPreview(root);
        currentSleepAidRenderedUrl = URL.createObjectURL(audioBufferToWav(result.renderedBuffer));
        setAudioStatus(root, '生成播放器中... (98%)');
        const player = root.querySelector('#sa-audio-player');
        if (player) {
            player.src = currentSleepAidRenderedUrl;
            player.load();
        }
        setAudioStatus(root, '渲染完成');
        updateAudioActionState(root);
        toastr.success('助眠音频文件已生成。');
    } catch (error) {
        if (error?.name === 'AbortError') {
            clearAudioSessionState(root);
            setAudioStatus(root, '已中止');
            toastr.info('已中止音频文件生成。');
        } else {
            clearAudioSessionState(root);
            setAudioStatus(root, '渲染失败');
            toastr.error('离线渲染失败：' + (error?.message || error));
        }
    } finally {
        currentSleepAidAudioController = null;
        if (renderBtn) {
            renderBtn.disabled = false;
            renderBtn.textContent = renderBtn.dataset.originalText || '🎼 生成音频文件';
        }
        updateAudioActionState(root);
    }
}

async function ensureSleepAidMusicList(root) {
    if (Array.isArray(currentSleepAidMusicList) && currentSleepAidMusicList.length > 0) {
        return currentSleepAidMusicList;
    }

    const sleepAid = getSleepAidSettings();
    const savedAudio = sleepAid.lastAudio;
    if (!savedAudio?.rawConfig || !savedAudio?.parsed || !savedAudio?.sourceText) {
        return null;
    }

    const engine = normalizeAudioEngine(savedAudio.engine || getSelectedSleepAidEngine(root));
    setAudioStatus(root, '恢复上次音频片段中...');
    const musicList = await buildSleepAidMusicList(savedAudio.parsed, savedAudio.sourceText, engine, null, (index, total) => {
        setAudioStatus(root, `恢复音频片段 ${index}/${total}`);
    }, getSleepAidAudioContextOverride(root));
    clearAudioSessionState(root);
    currentSleepAidMusicList = syncSleepAidMusicListFromPreviewCache(musicList);
    return currentSleepAidMusicList;
}

function formatSleepAidRenderStatus(payload) {
    const progress = Number(payload?.progress);
    const percent = Number.isFinite(progress) ? `${Math.max(0, Math.min(100, Math.round(progress * 100)))}%` : '';
    const message = String(payload?.message || '').trim();
    if (message && percent && !message.includes(percent)) {
        return `${message} (${percent})`;
    }
    if (message) return message;
    if (percent) return `离线渲染中... (${percent})`;
    return '离线渲染中...';
}

function enterLoadingUI(root) {
    const btn = root.querySelector('#sa-generate-btn');
    const abortBtn = root.querySelector('#sa-abort-btn');
    if (btn) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent || '🌙 生成今晚的引导';
        btn.textContent = '生成中...';
    }
    if (abortBtn) abortBtn.hidden = false;
    setResultStatus(root, '生成中...');
}

function leaveLoadingUI(root) {
    const btn = root.querySelector('#sa-generate-btn');
    const abortBtn = root.querySelector('#sa-abort-btn');
    if (btn) {
        btn.textContent = btn.dataset.originalText || '🌙 生成今晚的引导';
    }
    if (abortBtn) abortBtn.hidden = true;
    updateGenerateButtonState(root);
}

async function copyResultText(root) {
    const textarea = root.querySelector('#sa-result-text');
    const text = textarea?.value || '';
    if (!text.trim()) {
        toastr.warning('没有可复制的内容。');
        return;
    }
    try {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            textarea.focus();
            textarea.select();
            document.execCommand('copy');
            textarea.setSelectionRange(text.length, text.length);
        }
        toastr.success('已复制生成结果。');
    } catch (err) {
        toastr.error('复制失败：' + (err?.message || err));
    }
}

function persistResultText(root) {
    const textarea = root.querySelector('#sa-result-text');
    const text = textarea?.value || '';
    const sleepAid = getSleepAidSettings();
    if (!sleepAid.lastResult || typeof sleepAid.lastResult !== 'object') {
        sleepAid.lastResult = { input: sleepAid.lastInput || null, vars: null, text: '', ts: Date.now() };
    }
    sleepAid.lastResult.text = text;
    sleepAid.lastResult.ts = Date.now();
    invalidateSleepAidAudio(root, text.trim() ? '脚本已修改，需重新生成音频' : '未开始');
    saveSettingsDebounced();
}

async function generateSleepAid(root) {
    if (!validateLayer1(root)) {
        updateGenerateButtonState(root);
        return;
    }
    const input = collectUserInput(root);
    extension_settings[extensionName].sleepAid.lastInput = input;
    saveSettingsDebounced();

    const vars = buildSleepAidVars(input);
    const baseMessages = buildPromptForRequestType(LLMRequestTypes.SLEEP_AID_SCRIPT, '');
    if (!baseMessages.length) {
        toastr.warning('未找到「助眠脚本」绑定的上下文预设，请先在 LLM 设置中检查。');
        setResultStatus(root, '未找到上下文预设');
        return;
    }
    const messages = applyVarsToMessages(baseMessages, vars);

    const controller = new AbortController();
    currentSleepAidController = controller;
    enterLoadingUI(root);
    try {
        const text = await executeTypedLLMRequest(messages, LLMRequestTypes.SLEEP_AID_SCRIPT, controller.signal);
        invalidateSleepAidAudio(root, '脚本已更新，待生成音频');
        showResult(root, text, '生成完成');
        getSleepAidSettings().lastResult = {
            input,
            vars,
            text,
            ts: Date.now(),
        };
        saveSettingsDebounced();
        toastr.success('助眠引导已生成。');
    } catch (err) {
        if (err?.name === 'AbortError') {
            setResultStatus(root, '已中止');
            toastr.info('已中止本次生成。');
        } else {
            setResultStatus(root, '生成失败');
            toastr.error('生成失败：' + (err?.message || err));
        }
    } finally {
        currentSleepAidController = null;
        leaveLoadingUI(root);
    }
}

/**
 * 把数据回填到表单（用于打开页面时恢复上次填写）
 */
function restoreInput(root, data) {
    if (!data) return;

    const setSingle = (field, value) => {
        if (!value) return;
        const groups = root.querySelectorAll(`[data-field="${field}"]`);
        groups.forEach(g => {
            const btn = g.querySelector(`[data-value="${value}"]`);
            if (btn) {
                btn.classList.add('is-selected');
                if (btn.dataset.expand) {
                    showSubInput(root, btn.dataset.expand);
                }
            }
        });
    };
    const setMulti = (field, values) => {
        if (!Array.isArray(values)) return;
        values.forEach(v => {
            const groups = root.querySelectorAll(`[data-field="${field}"]`);
            groups.forEach(g => {
                const btn = g.querySelector(`[data-value="${v}"]`);
                if (btn) btn.classList.add('is-selected');
            });
        });
    };
    const setInput = (field, value) => {
        if (value == null) return;
        const el = root.querySelector(`[data-field="${field}"]`);
        if (el) el.value = value;
    };

    // 先清空所有默认 is-selected（避免和保存的数据冲突）
    root.querySelectorAll('.sa-pill.is-selected, .sa-chip.is-selected')
        .forEach(el => el.classList.remove('is-selected'));

    // 第一层
    setSingle('currentState', data.currentState);
    if (data.scene) {
        setSingle('scene', data.scene.type);
        setInput('sceneCustom', data.scene.custom);
    }
    if (data.narrator) {
        setSingle('narrator', data.narrator.type);
        setInput('narratorCustom', data.narrator.custom);
    }
    if (data.address) {
        setSingle('address', data.address.type);
        setInput('addressCustomName', data.address.customName);
        setInput('addressCustomTerm', data.address.customTerm);
    }
    setSingle('environment', data.environment);

    // 第二层
    setMulti('bodyTension', data.bodyTension);
    setSingle('sensoryPreference', data.sensoryPreference);
    if (data.troubles) {
        setMulti('troubles', data.troubles.presets);
        setInput('troublesCustom', data.troubles.custom);
        if (data.troubles.custom) showSubInput(root, 'troubles-custom');
    }
    if (data.bright) {
        setMulti('bright', data.bright.presets);
        setInput('brightCustom', data.bright.custom);
        if (data.bright.custom) showSubInput(root, 'bright-custom');
    }
    if (data.mood) {
        setMulti('mood', data.mood.presets);
        setInput('moodCustom', data.mood.custom);
        if (data.mood.custom) showSubInput(root, 'mood-custom');
    }
    if (data.duration) setSingle('duration', String(data.duration));
    if (data.voiceGender) setSingle('voiceGender', data.voiceGender);

    // 第三层
    if (data.safeMemory) {
        setSingle('safeMemoryTemplate', data.safeMemory.templateKey);
        setInput('safeMemoryText', data.safeMemory.text);
    }
    setMulti('safetyExtras', data.safetyExtras);
    if (data.forbiddenWords) {
        setMulti('forbiddenWords', data.forbiddenWords.presets);
        const customStr = (data.forbiddenWords.custom || []).join(', ');
        setInput('forbiddenCustom', customStr);
        if (customStr) showSubInput(root, 'forbidden-custom');
    }
    setSingle('endingStyle', data.endingStyle);
}

/**
 * 应用环境智能预选（夜间→床上、白天→沙发）
 */
function applyEnvironmentPreselect(root) {
    // 仅当用户从未选过 environment 时才应用
    const group = root.querySelector('[data-field="environment"]');
    if (!group) return;
    if (group.querySelector('.is-selected')) return;
    const hour = new Date().getHours();
    const target = (hour >= 22 || hour < 6) ? 'in_bed' : 'couch';
    const btn = group.querySelector(`[data-value="${target}"]`);
    if (btn) btn.classList.add('is-selected');
}

/**
 * 清空表单
 */
function resetForm(root) {
    root.querySelectorAll('.sa-pill.is-selected, .sa-chip.is-selected')
        .forEach(el => el.classList.remove('is-selected'));
    root.querySelectorAll('input[type="text"], textarea').forEach(el => { el.value = ''; });
    root.querySelectorAll('.sa-sub-input').forEach(el => { el.hidden = true; });

    // 恢复 HTML 中的默认预选（addr=you / duration=10 / voiceGender=any）
    const setDefault = (field, value) => {
        const g = root.querySelector(`[data-field="${field}"]`);
        if (!g) return;
        const btn = g.querySelector(`[data-value="${value}"]`);
        if (btn) btn.classList.add('is-selected');
    };
    setDefault('address', 'you');
    setDefault('duration', '10');
    setDefault('voiceGender', 'any');

    applyEnvironmentPreselect(root);
    updateGenerateButtonState(root);

    // 隐藏预览
    const preview = root.querySelector('#sa-preview-area');
    if (preview) preview.hidden = true;
    clearResult(root);
    const engineSelect = root.querySelector('#sa-audio-engine');
    if (engineSelect) engineSelect.value = normalizeAudioEngine(extension_settings[extensionName]?.narration_engine || 'edge');
}

/**
 * 入口
 */
export function initSleepAidPage() {
    injectCss();

    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) {
        console.warn('[ST-IS][SleepAid] tab root not found');
        return;
    }

    // 确保 settings 节点存在
    if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
    getSleepAidSettings();

    bindToggleButtons(root);
    bindCollapseButtons(root);
    bindExpandButtons(root);
    wireAudioSection(root);

    // 智能预选环境
    applyEnvironmentPreselect(root);

    // 回填上次输入
    const sleepAid = getSleepAidSettings();
    const last = sleepAid.lastInput;
    if (last) {
        try { restoreInput(root, last); } catch (e) {
            console.warn('[ST-IS][SleepAid] restore failed:', e);
        }
    }
    const lastResult = sleepAid.lastResult;
    if (lastResult?.text) {
        showResult(root, lastResult.text, '已恢复上次结果');
    }

    hydrateSleepAidAudioUI(root);

    updateGenerateButtonState(root);

    // 预览按钮
    root.querySelector('#sa-preview-btn')?.addEventListener('click', () => {
        const data = collectUserInput(root);
        const text = buildPreviewText(data);
        const area = root.querySelector('#sa-preview-area');
        const content = root.querySelector('#sa-preview-content');
        if (content) content.textContent = text;
        if (area) area.hidden = false;
    });

    // 重置按钮
    root.querySelector('#sa-reset-btn')?.addEventListener('click', () => {
        if (!confirm('确定要清空当前所有选择吗？')) return;
        resetForm(root);
        const sleepAidState = getSleepAidSettings();
        sleepAidState.lastInput = null;
        sleepAidState.lastResult = null;
        sleepAidState.lastAudio = null;
        saveSettingsDebounced();
    });

    root.querySelector('#sa-generate-btn')?.addEventListener('click', async () => {
        await generateSleepAid(root);
    });

    root.querySelector('#sa-abort-btn')?.addEventListener('click', () => {
        if (currentSleepAidController) currentSleepAidController.abort();
    });

    root.querySelector('#sa-result-copy')?.addEventListener('click', async () => {
        await copyResultText(root);
    });

    root.querySelector('#sa-result-clear')?.addEventListener('click', () => {
        clearResult(root);
        const sleepAidState = getSleepAidSettings();
        sleepAidState.lastResult = null;
        sleepAidState.lastAudio = null;
        saveSettingsDebounced();
    });

    // 输入文本变化时也更新校验状态（不影响第一层但保持响应）
    root.addEventListener('input', (e) => {
        if (e.target.matches('input, textarea')) {
            if (e.target.id === 'sa-result-text') {
                persistResultText(root);
                const area = root.querySelector('#sa-result-area');
                if (area) area.hidden = false;
            }
            updateGenerateButtonState(root);
        }
    });
}

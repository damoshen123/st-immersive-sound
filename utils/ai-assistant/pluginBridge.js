// @ts-nocheck
/**
 * 操作插件桥接：
 *   - buildSystemPrompt(): 构造系统提示词，附带插件介绍 + 关键设置摘要 + 指令格式说明
 *   - parseAndApplyCommands(reply): 解析 AI 回复中的 <UpdateSettings> / <UIAction> / <SystemQuery>
 *   - handleSystemQuery(reply): 提取 <SystemQuery> 并返回查询结果（用于自动续询）
 */

import { extension_settings } from '../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../script.js';
import { extensionName } from '../config.js';
import { removeThinkBlocks } from './utils.js';
import { getModuleSummaries, getModulePrompt, getAvailableModuleKeys } from './aiModules/index.js';
import {
    getRegexStatus, setRegexOriginalText, setRegexEditors,
    createRegexEntry, triggerRegexTest, setRegexTestMode,
    getRegexResultText, clearAllRegexEntries,
} from './configRegexBridge.js';

// ────────────────────────────────────────────────────────
// 1. 关键配置键 + 描述（只覆盖核心，避免 AI 改坏 API Key 等敏感字段）
// ────────────────────────────────────────────────────────

/**
 * 允许 AI 通过 <UpdateSettings> 修改的字段白名单
 * key → { type, desc, [enum] }
 */
export const WRITE_WHITELIST = {
    enable_plugin: { type: 'boolean', desc: '是否启用插件总开关' },
    enable_highlight: { type: 'boolean', desc: '是否启用文本高亮（朗读时）' },
    highlightColor: { type: 'string', desc: '高亮背景色（CSS 颜色，如 #ff0000）' },
    textColor: { type: 'string', desc: '高亮文字颜色' },
    highlightOpacity: { type: 'number', desc: '高亮不透明度 0-1' },
    readingSpeed: { type: 'number', desc: '朗读速度（毫秒/字）' },
    musicStartsWithParagraph: { type: 'boolean', desc: '音乐是否随段落开始' },
    theme_id: { type: 'string', desc: '当前主题 id（如 默认-白天 / 默认-夜间）' },
    lastTab: { type: 'string', desc: '设置面板最后停留的 Tab' },
    current_llm_profile: { type: 'string', desc: 'LLM 当前预设名称' },
};

/**
 * 允许 AI 通过 <SystemQuery> 读取的字段（含写入白名单 + 一些只读项）
 */
export const READ_WHITELIST = new Set([
    ...Object.keys(WRITE_WHITELIST),
    'llm_profiles',  // 可读列表，不可写
    'themes',
]);

/**
 * UIAction 支持的动作
 */
export const UI_ACTIONS = {
    openTab: 'openTab',          // { tab: 'highlight' | 'volume' | ... }
    openSettings: 'openSettings',
    closeSettings: 'closeSettings',
    toggleTheme: 'toggleTheme',
};

// ────────────────────────────────────────────────────────
// 2. 系统提示词
// ────────────────────────────────────────────────────────

function getSummary() {
    const s = extension_settings[extensionName] || {};
    const pick = {};
    for (const k of Object.keys(WRITE_WHITELIST)) {
        if (k in s) pick[k] = s[k];
    }
    let str = '【当前关键配置摘要】\n';
    for (const k in pick) {
        const v = typeof pick[k] === 'object' ? JSON.stringify(pick[k]) : String(pick[k]);
        str += `- ${k}: ${v}  // ${WRITE_WHITELIST[k].desc}\n`;
    }
    // LLM 预设
    const profileName = s.current_llm_profile;
    const profile = s.llm_profiles?.[profileName];
    if (profile) {
        str += `\n【当前 LLM 预设: ${profileName}】\n`;
        str += `- model: ${profile.model || '(未填)'}\n`;
        str += `- api_url: ${profile.api_url || '(未填)'}\n`;
        str += `- api_key: ${profile.api_key ? '(已配置)' : '(未填)'}\n`;
    }
    return str;
}

function getActionsList() {
    return Object.keys(UI_ACTIONS).join(' / ');
}

function getWritableKeysList() {
    return Object.keys(WRITE_WHITELIST).map((k) => `${k} (${WRITE_WHITELIST[k].type})`).join('、');
}

export function buildSystemPrompt() {
    const summary = getSummary();
    const moduleSummaries = getModuleSummaries();
    return `你是「声临其境」（st-immersive-sound）插件的内置 AI 管理助手，使用中文回答。
你的职责：帮助用户理解、查询和操作这个 SillyTavern 扩展（一个集成沉浸式音效/朗读高亮/3D 音效/正则/LLM 配置的插件）。

# 工作原则（必须严格遵守）
1. **先查后改**：修改任何配置之前，必须先用 <SystemQuery> 查清当前值；绝不凭记忆猜测字段名或值。
2. **按需加载模块**：用户的需求涉及专业功能（如正则配置）时，**必须先用 load_module 加载对应模块**，再使用该模块定义的命令。不要凭空写指令。
3. **加载完模块要继续推进**：load_module 不是终点。系统在下一轮会把模块的完整文档（commands / knowledge / workflow / errorGuide）和当前状态发回给你；你必须**接着执行该模块 workflow 描述的下一步**（例如询问用户示例文本、调用 regex_set_original/regex_create_entry/regex_test 等），不要只回一句"模块已加载"就停手。
4. **禁止幻想字段**：白名单之外的键禁止写入；不存在的 type 禁止使用。不确定时先查。
5. **思考再行动**：先在 <think>...</think> 中梳理用户意图、选择合适的指令、评估风险，然后再回答。
6. **结果反馈**：每条 <SystemQuery> 都会被系统执行，结果会在下一轮以 <SystemQueryResult> 的形式发回；收到结果后再决定下一步，不要自言自语提前编结果。
7. **回答风格**：对用户讲人话（中文，简洁），不要把 JSON 念给用户听；指令标签放在回答末尾即可，系统会自动隐藏。

# 你拥有的指令（所有指令必须以 XML 标签形式写入回答）

## 1. <UpdateSettings> —— 修改插件设置
<UpdateSettings>{"key1": value1, "key2": value2}</UpdateSettings>
- 允许修改的字段（白名单）：${getWritableKeysList()}
- 修改后系统会自动 saveSettingsDebounced 并尽量刷新 UI。

## 2. <SystemQuery> —— 查询配置 / 加载模块 / 调用业务指令
查配置（读白名单）：
<SystemQuery>{"type": "keys", "keys": ["enable_plugin", "highlightColor"]}</SystemQuery>
可读字段：${[...READ_WHITELIST].join('、')}

加载知识模块（按需获取该模块的详细命令与业务知识）：
<SystemQuery>{"type": "load_module", "module": "模块名"}</SystemQuery>
模块加载后，下一轮会把该模块的完整命令文档追加到提示词中。在加载之前，**绝对不要**直接发送该模块的业务命令。

业务指令（必须先 load_module 才知道有哪些可用 type，例：regex_status / regex_create_entry 等）。

## 3. <UIAction> —— 触发 UI 操作
<UIAction>{"action": "openTab", "tab": "regex"}</UIAction>
可用 action：${getActionsList()}
openTab 可选 tab：main / highlight / volume / regex / llm / tts / tts-preview / effects-processor / 3d-sound / vibration / cache / audio-resources / float-ball / theme / log / about

# 可加载的知识模块
${moduleSummaries}

# 当前插件状态
${summary}

# 输出格式约定
- 思考写在 <think>…</think>（用户界面会折叠展示）。
- 给用户的人话写在最外层（自然中文，不要含 JSON 指令）。
- 指令标签（<UpdateSettings>/<SystemQuery>/<UIAction>）放在回答末尾即可被系统执行；用户界面会把指令折叠为「执行内部命令」面板。
- 一次回答里可以同时发出多条指令；系统会把所有 SystemQuery 的结果合并后再给你（最多续询 ${MAX_QUERY_ROUNDS_HINT} 轮）。

# 常见误区
- ❌ 在没有 load_module 的情况下直接发送 regex_status / regex_create_entry 等模块业务命令。
- ❌ 把 SystemQueryResult 当成自己的话写出来；它只会出现在「上一轮系统返回」的位置，你只需阅读、不需复述。
- ❌ 修改 api_key 或其他不在白名单中的字段（会被系统拒绝）。`;
}

// 与 llm.js 的 MAX_QUERY_ROUNDS 同步显示用
const MAX_QUERY_ROUNDS_HINT = 5;

/**
 * 尾部提醒（system 角色消息），追加在 messages 数组的最后一条 user 之后。
 * 参考 st-chatu8/utils/aiSettingsBridge.js 的 buildTailReminder。
 * 作用：把"工作原则 + 用户最新需求"再贴脸提醒一次，避免长上下文里被忽略。
 *
 * @param {string} lastUserText - 用户最后一条消息文本（不含 <SystemQueryResult>）
 */
export function buildTailReminder(lastUserText) {
    const safeUser = (lastUserText || '').slice(0, 4000);
    return `提示:你是「声临其境」插件的 AI 管理助手，使用中文回答。
上面是对话历史。请严格遵守 system 提示词里的工作原则，特别是：
- **必须**用 <think>...</think> 进行思考，结束思考必须用 </think>。
- 你能操作和修改插件内的任意内容，只是还没读取到相关模块——比如和正则相关时**必须先 load_module: regex** 再操作！最优先的应当是载入相关知识模块，而不是凭记忆回答或回答"我不行"。
- 加载完模块后**必须按模块 workflow 继续推进**，不要只回一句"已加载"就收尾。
- 已经在历史里看到 <SystemQueryResult> 的，请直接基于结果继续，不要复述、不要重发同一条 SystemQuery。
- 不要做正文以外的多余清理（合并空行、改标点、整理 markdown 等），除非用户明确要求。

用户最新的消息是：${safeUser}`;
}

/**
 * 助手前缀消息：把 LLM 推入 think 模式，避免它忘记包 <think>。
 */
export function buildAssistantPrefill() {
    return '<think>\n好，让我思考一下用户的请求。\n';
}

// ────────────────────────────────────────────────────────
// 3. 解析并执行 <UpdateSettings>
// ────────────────────────────────────────────────────────

function safeParseJson(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
}

function applyUpdate(obj) {
    const root = extension_settings[extensionName] = extension_settings[extensionName] || {};
    let changed = 0;
    const applied = {};
    for (const k in obj) {
        if (!(k in WRITE_WHITELIST)) {
            console.warn('[ST-IS-AI] reject write to non-whitelisted key:', k);
            continue;
        }
        const expectType = WRITE_WHITELIST[k].type;
        const v = obj[k];
        if (expectType === 'boolean' && typeof v !== 'boolean') continue;
        if (expectType === 'number' && typeof v !== 'number') continue;
        if (expectType === 'string' && typeof v !== 'string') continue;
        root[k] = v;
        applied[k] = v;
        changed++;
    }
    if (changed) {
        saveSettingsDebounced();
        // 触发 UI 刷新（让 #enable_plugin 等 input 跟随变化）
        try {
            if (root.enable_plugin !== undefined) $('#enable_plugin').prop('checked', !!root.enable_plugin);
            if (root.highlightColor) $('#highlightColor').val(root.highlightColor);
            if (root.textColor) $('#textColor').val(root.textColor);
            if (typeof root.highlightOpacity === 'number') {
                $('#highlightOpacity').val(root.highlightOpacity);
                $('#highlightOpacity_value').val(root.highlightOpacity.toFixed(1));
            }
            if (typeof root.readingSpeed === 'number') {
                $('#readingSpeed').val(root.readingSpeed);
                $('#readingSpeed_value').val(root.readingSpeed);
            }
        } catch (e) { /* ignore */ }
    }
    return { changed, applied };
}

/**
 * 执行 <UIAction>
 */
function applyUIAction(obj) {
    if (!obj || typeof obj !== 'object') return false;
    switch (obj.action) {
        case 'openTab': {
            const tab = obj.tab;
            if (!tab) return false;
            const $link = $(`.st-is-nav-link[data-tab="${tab}"]`);
            if ($link.length) { $link.trigger('click'); return true; }
            return false;
        }
        case 'openSettings': {
            const $modal = $('#st-immersive-sound-settings-modal');
            if ($modal.length) { $modal.show(); return true; }
            return false;
        }
        case 'closeSettings': {
            const $modal = $('#st-immersive-sound-settings-modal');
            if ($modal.length) { $modal.hide(); return true; }
            return false;
        }
        case 'toggleTheme': {
            $('#toggle_theme_button').trigger('click');
            return true;
        }
        default:
            console.warn('[ST-IS-AI] unknown UIAction:', obj.action);
            return false;
    }
}

/**
 * 解析所有 <UpdateSettings> 和 <UIAction>，并立即执行。
 * 返回执行摘要文本（用于在消息附加一行 toast，可选）
 */
export function parseAndApplyCommands(rawReply) {
    if (!rawReply) return { updates: 0, actions: 0 };
    const cleaned = removeThinkBlocks(rawReply);
    let updates = 0;
    let actions = 0;

    // 严格 pattern：要求标签内是 { ... } 形式 JSON，避免 AI 在思考/解释里写
    // 字面量 <SystemQuery> / <UpdateSettings> 时与后续真指令的闭合标签错配。
    const updRe = /<UpdateSettings>\s*(\{[\s\S]*?\})\s*<\/UpdateSettings>/gi;
    let m;
    while ((m = updRe.exec(cleaned)) !== null) {
        const obj = safeParseJson(m[1].trim());
        if (obj && typeof obj === 'object') {
            const r = applyUpdate(obj);
            updates += r.changed;
        }
    }

    const actRe = /<UIAction>\s*(\{[\s\S]*?\})\s*<\/UIAction>/gi;
    while ((m = actRe.exec(cleaned)) !== null) {
        const obj = safeParseJson(m[1].trim());
        if (applyUIAction(obj)) actions++;
    }

    if (updates && typeof toastr !== 'undefined') toastr.success(`AI 助手已更新 ${updates} 个设置`);
    return { updates, actions };
}

// ─────────────────────────────────────────────────────────
// 4. 解析 <SystemQuery> —— 调度器
// ─────────────────────────────────────────────────────────

/**
 * 处理单个 SystemQuery JSON，返回结果字符串（会被追加到 SystemQueryResult 中）
 * 可能是 Promise。
 */
async function dispatchSystemQuery(obj) {
    if (!obj || typeof obj !== 'object') return '❌ 无效的 SystemQuery';

    // 带 keys 字段（旧格式）
    if (Array.isArray(obj.keys) || typeof obj.key === 'string') {
        const keys = Array.isArray(obj.keys) ? obj.keys : [obj.key];
        const root = extension_settings[extensionName] || {};
        const result = {};
        for (const k of keys) {
            if (READ_WHITELIST.has(k)) result[k] = root[k];
            else result[k] = '(键不可读或不存在)';
        }
        return `【配置查询结果】\n${JSON.stringify(result, null, 2)}`;
    }

    const type = obj.type;
    if (!type) return '❌ SystemQuery 缺少 type 字段';

    switch (type) {
        case 'keys': {
            const keys = Array.isArray(obj.keys) ? obj.keys : [];
            const root = extension_settings[extensionName] || {};
            const result = {};
            for (const k of keys) {
                if (READ_WHITELIST.has(k)) result[k] = root[k];
                else result[k] = '(键不可读或不存在)';
            }
            return `【配置查询结果】\n${JSON.stringify(result, null, 2)}`;
        }

        case 'load_module': {
            const m = obj.module;
            const text = getModulePrompt(m);
            if (!text) return `❌ 未知模块: ${m}（可用: ${getAvailableModuleKeys().join(', ')}）`;

            let extra = '';
            if (m === 'regex') {
                // 自动准备工作流的前置条件，避免 AI 浪费一整轮去发 openTab + regex_test_mode：
                //   1) 切到正则页面（让用户看到测试区域）
                //   2) 开启测试模式（双击消息才会捕获原文）
                const auto = [];
                try {
                    if (applyUIAction({ action: 'openTab', tab: 'regex' })) {
                        auto.push('✅ 已自动切到正则设置页面');
                    }
                } catch (e) { /* ignore */ }
                try {
                    auto.push(setRegexTestMode(true));
                } catch (e) { /* ignore */ }

                let status = '';
                try { status = getRegexStatus(); } catch (e) { /* ignore */ }

                extra = `\n\n【load_module 已自动完成的准备工作】\n${auto.join('\n')}\n\n【当前正则状态】\n${status}`;
            }
            return text + extra;
        }

        // ── 正则模块指令 ──────────────────────────────────────────
        case 'regex_status':
            return getRegexStatus();
        case 'regex_test_mode':
            return setRegexTestMode(!!obj.enabled);
        case 'regex_set_original':
            return setRegexOriginalText(String(obj.text ?? ''));
        case 'regex_set_editors':
            return setRegexEditors(String(obj.beforeAfter ?? ''), String(obj.textRegex ?? ''));
        case 'regex_create_entry':
            return createRegexEntry(obj.data || {});
        case 'regex_test':
            return await triggerRegexTest();
        case 'regex_result':
            return getRegexResultText();
        case 'regex_clear_entries':
            return clearAllRegexEntries();

        default:
            return `❌ 未知 SystemQuery type: ${type}`;
    }
}

/**
 * 静默命令清单：执行成功后**不**进入 SystemQueryResult 反馈给 AI；
 * 仅当本批次还包含其他「需要返回数据」的命令时，它们的结果会被丢弃。
 * 失败（返回 ❌ 开头）仍然反馈，便于 AI 自我修正。
 */
const SILENT_COMMANDS = new Set([
    'regex_test_mode',
    'regex_set_original',
    'regex_set_editors',
    'regex_create_entry',
    'regex_clear_entries',
]);

/**
 * 提取回复中所有 <SystemQuery>，逐个调度。
 * - 静默命令：执行后默认成功，不进入返回文本；失败才反馈。
 * - 非静默命令：结果照常拼回 SystemQueryResult。
 * - 若所有命令都是静默且全部成功 → 返回 null（不触发 AI 续询）。
 */
export async function handleSystemQuery(rawReply) {
    if (!rawReply) return null;
    const cleaned = removeThinkBlocks(rawReply);
    // 严格 pattern：必须 <SystemQuery>{...}</SystemQuery> 才匹配，
    // 避免 AI 在解释/示例里写裸 <SystemQuery> 干扰闭合配对。
    const re = /<SystemQuery>\s*(\{[\s\S]*?\})\s*<\/SystemQuery>/gi;
    const queries = [];
    let m;
    while ((m = re.exec(cleaned)) !== null) {
        const obj = safeParseJson(m[1].trim());
        if (obj) queries.push(obj);
    }
    if (!queries.length) return null;

    const parts = [];
    for (const q of queries) {
        const isSilent = SILENT_COMMANDS.has(q?.type);
        let resultText;
        try {
            resultText = await dispatchSystemQuery(q);
        } catch (e) {
            resultText = `❌ 执行异常: ${e.message}`;
        }
        const failed = typeof resultText === 'string' && resultText.trim().startsWith('❌');
        // 静默 & 成功 → 跳过反馈
        if (isSilent && !failed) continue;
        parts.push(`>>> ${JSON.stringify(q)}\n${resultText}`);
    }

    // 全部静默且成功 → 不要触发 AI 续询
    if (!parts.length) return null;

    return { queries, text: parts.join('\n\n---\n\n') };
}

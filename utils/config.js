export const extensionName = "st-immersive-sound";
export const extensionFolderPath = `scripts/extensions/third-party/st-immersive-sound`;

export const eventNames = {
    REGEX_TEST_MESSAGE: 'st-immersive-sound:regex-test-message',
    REGEX_RESULT_MESSAGE: 'st-immersive-sound:regex-result-message',
    LLM_TEST_START: 'st-immersive-sound:llm-test-start',
    LLM_TEST_RESULT: 'st-immersive-sound:llm-test-result',
    LLM_GET_PROMPT_REQUEST: 'st-immersive-sound:llm-get-prompt-request',
    LLM_GET_PROMPT_RESPONSE: 'st-immersive-sound:llm-get-prompt-response',
    LLM_EXECUTE_REQUEST: 'st-immersive-sound:llm-execute-request',
    LLM_EXECUTE_RESPONSE: 'st-immersive-sound:llm-execute-response',
    MAIN_SFX_CONFIG_UPDATED: 'st-immersive-sound:main-sfx-config-updated',
    MAIN_SFX_REPARSE_REQUEST: 'st-immersive-sound:main-sfx-reparse-request',
    MAIN_SFX_REPARSE_RESPONSE: 'st-immersive-sound:main-sfx-reparse-response',
    PLAY_SOUND: 'st-immersive-sound:play-sound',
    PROCESS_TEXT_FOR_AUDIO: 'st-immersive-sound:process-text-for-audio',
    REQUEST_TTS: 'st-immersive-sound:request-tts',
    TTS_RESULT: 'st-immersive-sound:tts-result',
    TTS_QUOTA_UPDATED: 'st-immersive-sound:tts-quota-updated',
    TTS_CLONE_TASK_ADDED: 'st-immersive-sound:clone-task-added',
    PLAY_EXTERNAL_SOUND: 'st-immersive-sound:play-external',
    STOP_EXTERNAL_SOUND: 'st-immersive-sound:stop-external',
    EXTERNAL_SOUND_PLAYING: 'st-immersive-sound:external-audio-playing',
    EXTERNAL_SOUND_STOPPED: 'st-immersive-sound:external-audio-stopped',
    EXTERNAL_SOUND_FAILED: 'st-immersive-sound:external-audio-failed',
    LLM_PROFILES_CHANGED: 'st-immersive-sound:llm-profiles-changed',
    LLM_CONTEXT_PROFILES_CHANGED: 'st-immersive-sound:context-profiles-changed',
};

/**
 * LLM 请求类型枚举。
 * 每种类型在「大模型设置 → 请求类型配置」卡片区独立绑定一组
 * { api_profile, context_profile }，业务调用时按类型路由。
 *
 * - MAIN_SFX 同时承担「未指定 requestType 的兜底」
 * - 智绘姬助手不在此枚举内，它在自己的设置面板里独立配置
 */
export const LLMRequestTypes = {
    MAIN_SFX: 'main_sfx',
    SLEEP_AID_SCRIPT: 'sleep_aid_script',
    SLEEP_AID_SFX: 'sleep_aid_sfx',
};

export const DEFAULT_REQUEST_TYPE = LLMRequestTypes.MAIN_SFX;

export const REQUEST_TYPE_LABELS = {
    [LLMRequestTypes.MAIN_SFX]: '正文音效生成（默认）',
    [LLMRequestTypes.SLEEP_AID_SCRIPT]: '助眠脚本',
    [LLMRequestTypes.SLEEP_AID_SFX]: '助眠音效生成',
};

export const sleepAidDefaultContextProfileName = '助眠脚本默认';

export const sleepAidDefaultContextProfile = {
    "entries": [
        {
            "id": "entry_sleep_aid_default_1",
            "name": "系统提示",
            "role": "system",
            "content": "你是一名专业的助眠引导脚本作者，擅长 ASMR、冥想、睡前正念与温柔陪伴式文本写作。你每次只输出可被直接朗读的纯文本，不要 Markdown，不要标题，不要列表，不要舞台说明，不要解释你在做什么。语言要自然、口语化、节奏舒缓，段落之间可以空行，句子要适合真人慢速朗读。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        },
        {
            "id": "entry_sleep_aid_default_2",
            "name": "任务说明",
            "role": "user",
            "content": "我们来做一个练习：我会告诉你讲述人身份、对听者的称呼、场景、当下状态、想要的感觉、目标时长、结尾方式、需要避开的词。你需要按这些要求生成一段适合朗读的助眠引导。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        },
        {
            "id": "entry_sleep_aid_default_3",
            "name": "确认接收",
            "role": "assistant",
            "content": "好的。请告诉我具体设定，我会用自然的口语写出一段适合朗读、节奏舒缓、停顿自然的引导文本。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        },
        {
            "id": "entry_sleep_aid_default_4",
            "name": "写作守则",
            "role": "user",
            "content": "写作守则：\n- 用「{{称呼}}」称呼听者；如果是『（不使用称呼）』则使用零称谓句式。\n- 讲述人身份是「{{讲述人}}」，请用对应的语气、距离感与用词。\n- 不要写舞台说明、不要 Markdown、不要分点；只输出可朗读的句子。\n- 段落之间用空行分隔，单段不超过 80 字以便配音断句。\n- 严格避开以下词语：{{禁忌词}}\n- 目标朗读时长约 {{时长}} 分钟。\n- 结尾按「{{结尾方式}}」处理。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        },
        {
            "id": "entry_sleep_aid_default_5",
            "name": "继续设定",
            "role": "assistant",
            "content": "明白。请把今晚的具体内容告诉我。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        },
        {
            "id": "entry_sleep_aid_default_6",
            "name": "今晚的设定",
            "role": "user",
            "content": "今晚的设定：\n- 当前环境：{{当前环境}}\n- 当下状态：{{当下状态}}\n- 想去的场景：{{场景}}\n- 身体最累的地方：{{身体紧张点}}\n- 感官偏好：{{感官偏好}}\n- 困扰我的事：{{困扰}}\n- 一点点好：{{小确幸}}\n- 想要的感觉：{{想要的感觉}}\n- 安全记忆：{{安全记忆}}\n- 安心的细节：{{安心细节}}\n- 声音性别倾向：{{声音性别}}\n- 用户输入 JSON：{{userBriefJson}}\n\n现在请直接开始生成今晚的助眠引导，只输出引导本身，不要任何前言或解释。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        }
    ]
};

export const sleepAidAudioDefaultContextProfileName = '助眠音效默认';

export const sleepAidAudioDefaultContextProfile = {
    "entries": [
        {
            "id": "sleep_aid_sfx_entry_1",
            "name": "系统设定 · 助眠音效师",
            "role": "system",
            "content": "你是一位为睡前、助眠、冥想引导、ASMR 内容服务的后期声学设计师。你的审美是克制、低频优先、缓慢、留白。你只输出严格符合音效后期标记格式的纯文本，不写解释，不写 Markdown 代码块。禁止使用突兀尖锐声、节奏鲜明鼓点、剧情化 SFX、性爱类 SFX、紧张悬疑 BGM。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        },
        {
            "id": "sleep_aid_sfx_entry_2",
            "name": "用户消息 1 · 助眠后期规则",
            "role": "user",
            "content": "我会给你一段已经写好的助眠引导脚本。请为它配置 Music / Ambiance / VOICE / SFX。最终只输出一整段 <BGM>...</BGM>。VOICE 是主角：按段落输出，每段一条 VOICE。每条 VOICE 必须提供 speaker、context_texts、spatial、special_effects、ir_description、regex_start、regex_end、context。regex_start 与 regex_end 必须原样引用脚本中的文字。speaker、src、spatial、ir_description、special_effects 都必须严格命中后续提供的资源列表。助眠场景中 VOICE 的 spatial 优先使用正前方站立或身侧，special_effects 默认无。Music 1 到 2 条、Ambiance 最多 4 条、SFX 可为空且必须克制。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        },
        {
            "id": "sleep_aid_sfx_entry_3",
            "name": "AI回复 1 · 确认规则",
            "role": "assistant",
            "content": "明白。我会严格按段落输出 VOICE，整篇优先使用同一位 speaker，并克制地安排 Music、Ambiance 与 SFX。之后只输出标准标记，不写任何额外说明。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        },
        {
            "id": "sleep_aid_sfx_entry_4",
            "name": "用户消息 2 · 资源清单",
            "role": "user",
            "content": "这是你可以使用的全部资源，任何 src / speaker / spatial / ir_description / special_effects 都必须严格命中现有条目，禁止编造。\n\n人声列表：\n{{人声列表}}\n\n人声和角色匹配设定：\n{{人声和角色匹配设定}}\n\n所有音效列表：\n{{所有音效列表}}\n\n空间音频介绍：\n{{空间音频介绍}}\n\n环境混响介绍：\n{{环境混响介绍}}\n\n声音特效介绍：\n{{声音特效介绍}}",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        },
        {
            "id": "sleep_aid_sfx_entry_5",
            "name": "AI回复 2 · 资源就绪",
            "role": "assistant",
            "content": "资源已记下。我会严格只在这些列表里挑选 speaker、src、spatial、ir_description 与 special_effects。请把今晚的助眠脚本发我。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        },
        {
            "id": "sleep_aid_sfx_entry_6",
            "name": "用户消息 3 · 脚本正文",
            "role": "user",
            "content": "下面是今晚的助眠脚本正文。\n- 讲述人身份：{{讲述人}}\n- 对听者的称呼：{{称呼}}\n- 想去的场景：{{场景}}\n- 当前环境：{{当前环境}}\n- 声音性别倾向：{{声音性别}}\n- 结尾方式：{{结尾方式}}\n- 目标时长：{{时长}} 分钟\n- 禁忌词：{{禁忌词}}\n\n脚本正文如下，请按段落配置 VOICE：\n{{userText}}\n\n现在请只输出一整段 <BGM>...</BGM>，不要任何前言、解释或 Markdown 代码块。",
            "enabled": true,
            "triggerMode": "always",
            "triggerWords": ""
        }
    ]
};

export const defaultThemes = {
    "默认-白天": {
        "--st-is-bg-primary": "#f5f5f5",
        "--st-is-bg-secondary": "#eeeeee",
        "--st-is-bg-tertiary": "#e9e9e9",
        "--st-is-text-primary": "#212529",
        "--st-is-text-secondary": "#6c757d",
        "--st-is-accent-primary": "#007bff",
        "--st-is-accent-secondary": "#0056b3",
        "--st-is-danger-primary": "#dc3545",
        "--st-is-danger-secondary": "#c82333",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#dee2e6",
        "--st-is-dropdown-bg": "#eeeeee",
        "--st-is-dropdown-text": "#212529",
        "--st-is-dropdown-list-bg": "#ffffff",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#ffffff",
        "--st-is-input-text": "#212529",
        "--st-is-input-border": "#ced4da"
    },
    "默认-夜间": {
        "--st-is-bg-primary": "#0a192f",
        "--st-is-bg-secondary": "#172a45",
        "--st-is-bg-tertiary": "#233554",
        "--st-is-text-primary": "#ff8c00",
        "--st-is-text-secondary": "#8892b0",
        "--st-is-accent-primary": "#ff8c00",
        "--st-is-accent-secondary": "#e67e00",
        "--st-is-danger-primary": "#dc3545",
        "--st-is-danger-secondary": "#c82333",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#233554",
        "--st-is-dropdown-bg": "#172a45",
        "--st-is-dropdown-text": "#ff8c00",
        "--st-is-dropdown-list-bg": "#233554",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#172a45",
        "--st-is-input-text": "#ff8c00",
        "--st-is-input-border": "#233554"
    },
    "深海蓝": {
        "--st-is-bg-primary": "#0d1b2a",
        "--st-is-bg-secondary": "#1b263b",
        "--st-is-bg-tertiary": "#415a77",
        "--st-is-text-primary": "#e0e1dd",
        "--st-is-text-secondary": "#778da9",
        "--st-is-accent-primary": "#00b4d8",
        "--st-is-accent-secondary": "#0096c7",
        "--st-is-danger-primary": "#ef476f",
        "--st-is-danger-secondary": "#d63d5e",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#415a77",
        "--st-is-dropdown-bg": "#1b263b",
        "--st-is-dropdown-text": "#e0e1dd",
        "--st-is-dropdown-list-bg": "#415a77",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#1b263b",
        "--st-is-input-text": "#e0e1dd",
        "--st-is-input-border": "#415a77"
    },
    "樱花粉": {
        "--st-is-bg-primary": "#fff5f5",
        "--st-is-bg-secondary": "#ffe4e6",
        "--st-is-bg-tertiary": "#fecdd3",
        "--st-is-text-primary": "#881337",
        "--st-is-text-secondary": "#be185d",
        "--st-is-accent-primary": "#ec4899",
        "--st-is-accent-secondary": "#db2777",
        "--st-is-danger-primary": "#e11d48",
        "--st-is-danger-secondary": "#be123c",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#fda4af",
        "--st-is-dropdown-bg": "#ffe4e6",
        "--st-is-dropdown-text": "#881337",
        "--st-is-dropdown-list-bg": "#fff5f5",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#ffe4e6",
        "--st-is-input-text": "#881337",
        "--st-is-input-border": "#fda4af"
    },
    "森林绿": {
        "--st-is-bg-primary": "#f0fdf4",
        "--st-is-bg-secondary": "#dcfce7",
        "--st-is-bg-tertiary": "#bbf7d0",
        "--st-is-text-primary": "#14532d",
        "--st-is-text-secondary": "#166534",
        "--st-is-accent-primary": "#22c55e",
        "--st-is-accent-secondary": "#16a34a",
        "--st-is-danger-primary": "#dc2626",
        "--st-is-danger-secondary": "#b91c1c",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#86efac",
        "--st-is-dropdown-bg": "#dcfce7",
        "--st-is-dropdown-text": "#14532d",
        "--st-is-dropdown-list-bg": "#f0fdf4",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#dcfce7",
        "--st-is-input-text": "#14532d",
        "--st-is-input-border": "#86efac"
    },
    "薰衣草": {
        "--st-is-bg-primary": "#faf5ff",
        "--st-is-bg-secondary": "#f3e8ff",
        "--st-is-bg-tertiary": "#e9d5ff",
        "--st-is-text-primary": "#581c87",
        "--st-is-text-secondary": "#7c3aed",
        "--st-is-accent-primary": "#a855f7",
        "--st-is-accent-secondary": "#9333ea",
        "--st-is-danger-primary": "#dc2626",
        "--st-is-danger-secondary": "#b91c1c",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#d8b4fe",
        "--st-is-dropdown-bg": "#f3e8ff",
        "--st-is-dropdown-text": "#581c87",
        "--st-is-dropdown-list-bg": "#faf5ff",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#f3e8ff",
        "--st-is-input-text": "#581c87",
        "--st-is-input-border": "#d8b4fe"
    },
    "琥珀橙": {
        "--st-is-bg-primary": "#fffbeb",
        "--st-is-bg-secondary": "#fef3c7",
        "--st-is-bg-tertiary": "#fde68a",
        "--st-is-text-primary": "#78350f",
        "--st-is-text-secondary": "#b45309",
        "--st-is-accent-primary": "#f59e0b",
        "--st-is-accent-secondary": "#d97706",
        "--st-is-danger-primary": "#dc2626",
        "--st-is-danger-secondary": "#b91c1c",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#fcd34d",
        "--st-is-dropdown-bg": "#fef3c7",
        "--st-is-dropdown-text": "#78350f",
        "--st-is-dropdown-list-bg": "#fffbeb",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#fef3c7",
        "--st-is-input-text": "#78350f",
        "--st-is-input-border": "#fcd34d"
    },
    "赛博朋克": {
        "--st-is-bg-primary": "#0f0f23",
        "--st-is-bg-secondary": "#1a1a3e",
        "--st-is-bg-tertiary": "#2d2d5a",
        "--st-is-text-primary": "#00ff9f",
        "--st-is-text-secondary": "#ff00ff",
        "--st-is-accent-primary": "#00ffff",
        "--st-is-accent-secondary": "#00cccc",
        "--st-is-danger-primary": "#ff0055",
        "--st-is-danger-secondary": "#cc0044",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#ff00ff",
        "--st-is-dropdown-bg": "#1a1a3e",
        "--st-is-dropdown-text": "#00ff9f",
        "--st-is-dropdown-list-bg": "#2d2d5a",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#1a1a3e",
        "--st-is-input-text": "#00ff9f",
        "--st-is-input-border": "#ff00ff"
    },
    "莫兰迪": {
        "--st-is-bg-primary": "#e8e4df",
        "--st-is-bg-secondary": "#d4cfc7",
        "--st-is-bg-tertiary": "#c0b9ae",
        "--st-is-text-primary": "#5c574f",
        "--st-is-text-secondary": "#7a746a",
        "--st-is-accent-primary": "#8b9a8b",
        "--st-is-accent-secondary": "#6d7a6d",
        "--st-is-danger-primary": "#c4a4a4",
        "--st-is-danger-secondary": "#a68888",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#ada79d",
        "--st-is-dropdown-bg": "#d4cfc7",
        "--st-is-dropdown-text": "#5c574f",
        "--st-is-dropdown-list-bg": "#e8e4df",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#d4cfc7",
        "--st-is-input-text": "#5c574f",
        "--st-is-input-border": "#ada79d"
    },
    "暗夜紫": {
        "--st-is-bg-primary": "#13111c",
        "--st-is-bg-secondary": "#1e1b2e",
        "--st-is-bg-tertiary": "#2d2844",
        "--st-is-text-primary": "#e2e0f0",
        "--st-is-text-secondary": "#a39ec4",
        "--st-is-accent-primary": "#9d4edd",
        "--st-is-accent-secondary": "#7b2cbf",
        "--st-is-danger-primary": "#ff6b6b",
        "--st-is-danger-secondary": "#ee5a5a",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#3d3764",
        "--st-is-dropdown-bg": "#1e1b2e",
        "--st-is-dropdown-text": "#e2e0f0",
        "--st-is-dropdown-list-bg": "#2d2844",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#1e1b2e",
        "--st-is-input-text": "#e2e0f0",
        "--st-is-input-border": "#3d3764"
    },
    "冰川蓝": {
        "--st-is-bg-primary": "#f0f9ff",
        "--st-is-bg-secondary": "#e0f2fe",
        "--st-is-bg-tertiary": "#bae6fd",
        "--st-is-text-primary": "#0c4a6e",
        "--st-is-text-secondary": "#0369a1",
        "--st-is-accent-primary": "#0ea5e9",
        "--st-is-accent-secondary": "#0284c7",
        "--st-is-danger-primary": "#ef4444",
        "--st-is-danger-secondary": "#dc2626",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#7dd3fc",
        "--st-is-dropdown-bg": "#e0f2fe",
        "--st-is-dropdown-text": "#0c4a6e",
        "--st-is-dropdown-list-bg": "#f0f9ff",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#e0f2fe",
        "--st-is-input-text": "#0c4a6e",
        "--st-is-input-border": "#7dd3fc"
    },
    "暖沙棕": {
        "--st-is-bg-primary": "#fefcfb",
        "--st-is-bg-secondary": "#f5ebe0",
        "--st-is-bg-tertiary": "#e3d5ca",
        "--st-is-text-primary": "#3d2c1e",
        "--st-is-text-secondary": "#6b5344",
        "--st-is-accent-primary": "#b08968",
        "--st-is-accent-secondary": "#9c6644",
        "--st-is-danger-primary": "#cd5c5c",
        "--st-is-danger-secondary": "#b54848",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#d5bdaf",
        "--st-is-dropdown-bg": "#f5ebe0",
        "--st-is-dropdown-text": "#3d2c1e",
        "--st-is-dropdown-list-bg": "#fefcfb",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#f5ebe0",
        "--st-is-input-text": "#3d2c1e",
        "--st-is-input-border": "#d5bdaf"
    },
    "极光绿": {
        "--st-is-bg-primary": "#0a1612",
        "--st-is-bg-secondary": "#132520",
        "--st-is-bg-tertiary": "#1d3830",
        "--st-is-text-primary": "#6ee7b7",
        "--st-is-text-secondary": "#34d399",
        "--st-is-accent-primary": "#10b981",
        "--st-is-accent-secondary": "#059669",
        "--st-is-danger-primary": "#f87171",
        "--st-is-danger-secondary": "#ef4444",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#2d5446",
        "--st-is-dropdown-bg": "#132520",
        "--st-is-dropdown-text": "#6ee7b7",
        "--st-is-dropdown-list-bg": "#1d3830",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#132520",
        "--st-is-input-text": "#6ee7b7",
        "--st-is-input-border": "#2d5446"
    },
    "玫瑰金": {
        "--st-is-bg-primary": "#1a1515",
        "--st-is-bg-secondary": "#2a2020",
        "--st-is-bg-tertiary": "#3a2d2d",
        "--st-is-text-primary": "#f4d4c4",
        "--st-is-text-secondary": "#d4a494",
        "--st-is-accent-primary": "#e8a090",
        "--st-is-accent-secondary": "#d08878",
        "--st-is-danger-primary": "#e07070",
        "--st-is-danger-secondary": "#c85858",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#5a4a4a",
        "--st-is-dropdown-bg": "#2a2020",
        "--st-is-dropdown-text": "#f4d4c4",
        "--st-is-dropdown-list-bg": "#3a2d2d",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#2a2020",
        "--st-is-input-text": "#f4d4c4",
        "--st-is-input-border": "#5a4a4a"
    },
    "纯净白": {
        "--st-is-bg-primary": "#ffffff",
        "--st-is-bg-secondary": "#f8f9fa",
        "--st-is-bg-tertiary": "#e9ecef",
        "--st-is-text-primary": "#212529",
        "--st-is-text-secondary": "#495057",
        "--st-is-accent-primary": "#495057",
        "--st-is-accent-secondary": "#343a40",
        "--st-is-danger-primary": "#dc3545",
        "--st-is-danger-secondary": "#c82333",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#ced4da",
        "--st-is-dropdown-bg": "#f8f9fa",
        "--st-is-dropdown-text": "#212529",
        "--st-is-dropdown-list-bg": "#ffffff",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#ffffff",
        "--st-is-input-text": "#212529",
        "--st-is-input-border": "#ced4da"
    },
    "墨玉黑": {
        "--st-is-bg-primary": "#121212",
        "--st-is-bg-secondary": "#1e1e1e",
        "--st-is-bg-tertiary": "#2d2d2d",
        "--st-is-text-primary": "#e0e0e0",
        "--st-is-text-secondary": "#a0a0a0",
        "--st-is-accent-primary": "#bb86fc",
        "--st-is-accent-secondary": "#9b66dc",
        "--st-is-danger-primary": "#cf6679",
        "--st-is-danger-secondary": "#b54d5f",
        "--st-is-danger-text": "#ffffff",
        "--st-is-border-color": "#3d3d3d",
        "--st-is-dropdown-bg": "#1e1e1e",
        "--st-is-dropdown-text": "#e0e0e0",
        "--st-is-dropdown-list-bg": "#2d2d2d",
        "--st-is-text-highlight": "#ffffff",
        "--st-is-input-bg": "#1e1e1e",
        "--st-is-input-text": "#e0e0e0",
        "--st-is-input-border": "#3d3d3d"
    }
};

export const colorVarMap = {
    "--st-is-bg-primary": "主背景色",
    "--st-is-bg-secondary": "次背景色",
    "--st-is-bg-tertiary": "三级背景色",
    "--st-is-text-primary": "主文本颜色",
    "--st-is-text-secondary": "次文本颜色",
    "--st-is-accent-primary": "主强调色",
    "--st-is-accent-secondary": "次强调色",
    "--st-is-danger-primary": "危险/删除按钮色",
    "--st-is-danger-secondary": "危险/删除按钮悬停色",
    "--st-is-danger-text": "危险/删除按钮文本色",
    "--st-is-border-color": "边框颜色",
    "--st-is-dropdown-bg": "下拉框背景色",
    "--st-is-dropdown-text": "下拉列表文本颜色",
    "--st-is-dropdown-list-bg": "下拉选项背景色",
    "--st-is-text-highlight": "高亮文本颜色",
    "--st-is-input-bg": "输入框背景色",
    "--st-is-input-text": "输入框文本颜色",
    "--st-is-input-border": "输入框边框颜色"
};

export const defaultLyricsPlayerThemes = {
    "深邃夜空": {
        "--lp-bg": "rgba(10, 12, 28, 0.95)",
        "--lp-text": "#8892b0",
        "--lp-text-active": "#e6f1ff",
        "--lp-text-played": "#4a5068",
        "--lp-glow": "rgba(100, 180, 255, 0.4)",
        "--lp-progress-bg": "#1e2140",
        "--lp-progress-fill": "#64b5f6",
        "--lp-progress-thumb": "#90caf9",
        "--lp-titlebar-bg": "rgba(15, 18, 35, 0.9)",
        "--lp-titlebar-text": "#ccd6f6",
        "--lp-border": "rgba(100, 180, 255, 0.15)",
        "--lp-scrollbar-thumb": "rgba(100, 180, 255, 0.25)"
    },
    "温暖暮光": {
        "--lp-bg": "rgba(30, 18, 12, 0.95)",
        "--lp-text": "#a08070",
        "--lp-text-active": "#ffd6a0",
        "--lp-text-played": "#5a4a40",
        "--lp-glow": "rgba(255, 180, 100, 0.35)",
        "--lp-progress-bg": "#2a1e15",
        "--lp-progress-fill": "#ff9a56",
        "--lp-progress-thumb": "#ffb88c",
        "--lp-titlebar-bg": "rgba(35, 22, 15, 0.9)",
        "--lp-titlebar-text": "#e0c0a0",
        "--lp-border": "rgba(255, 180, 100, 0.15)",
        "--lp-scrollbar-thumb": "rgba(255, 180, 100, 0.25)"
    },
    "清新薄荷": {
        "--lp-bg": "rgba(8, 24, 20, 0.95)",
        "--lp-text": "#6aaa9a",
        "--lp-text-active": "#a8f0d8",
        "--lp-text-played": "#3a5a50",
        "--lp-glow": "rgba(100, 240, 200, 0.3)",
        "--lp-progress-bg": "#0e2e25",
        "--lp-progress-fill": "#4dd8a8",
        "--lp-progress-thumb": "#7aecc8",
        "--lp-titlebar-bg": "rgba(10, 28, 24, 0.9)",
        "--lp-titlebar-text": "#b0e0d0",
        "--lp-border": "rgba(100, 240, 200, 0.15)",
        "--lp-scrollbar-thumb": "rgba(100, 240, 200, 0.25)"
    },
    "樱花物语": {
        "--lp-bg": "rgba(28, 12, 20, 0.95)",
        "--lp-text": "#b08898",
        "--lp-text-active": "#ffc0d8",
        "--lp-text-played": "#5a3a48",
        "--lp-glow": "rgba(255, 150, 200, 0.35)",
        "--lp-progress-bg": "#2a1520",
        "--lp-progress-fill": "#f48fb1",
        "--lp-progress-thumb": "#f8bbd0",
        "--lp-titlebar-bg": "rgba(32, 15, 24, 0.9)",
        "--lp-titlebar-text": "#e8c0d0",
        "--lp-border": "rgba(255, 150, 200, 0.15)",
        "--lp-scrollbar-thumb": "rgba(255, 150, 200, 0.25)"
    },
    "极简白": {
        "--lp-bg": "rgba(250, 250, 252, 0.98)",
        "--lp-text": "#888888",
        "--lp-text-active": "#1a1a1a",
        "--lp-text-played": "#c0c0c0",
        "--lp-glow": "rgba(0, 0, 0, 0.08)",
        "--lp-progress-bg": "#e8e8e8",
        "--lp-progress-fill": "#333333",
        "--lp-progress-thumb": "#555555",
        "--lp-titlebar-bg": "rgba(245, 245, 248, 0.95)",
        "--lp-titlebar-text": "#333333",
        "--lp-border": "rgba(0, 0, 0, 0.1)",
        "--lp-scrollbar-thumb": "rgba(0, 0, 0, 0.15)"
    }
};

export const defaultSettings = {
    "themes": defaultThemes,
    "theme_id": "默认-白天",
    "sleepAid": { "lastInput": null, "lastResult": null, "audioEngine": "edge", "lastAudio": null },
    "enable_plugin": true,
    "readingSpeed": 650,
    "highlightColor": "#FFC800",
    "textColor": "#d71d1d",
    "highlightOpacity": 0.4,
    "musicStartsWithParagraph": true,
    "seamlessMusic": true,
    "compatibility_edge": false,
    "masterVolume": 1.44,
    "musicVolume": 0.08,
    "ambianceVolume": 0.61,
    "sfxVolume": 0.23,
    "sfx_waitVolume": 1,
    "musicFadeIn": 1,
    "musicFadeOut": 1,
    "ambianceFadeIn": 1,
    "ambianceFadeOut": 1,
    "sfxFadeIn": 0.1,
    "sfxFadeOut": 0.1,
    "sfx_waitFadeIn": 0.1,
    "sfx_waitFadeOut": 0.1,
    "enable3dAudio_music": true,
    "enable3dAudio_ambiance": true,
    "music_refDistance": 0.6,
    "music_maxDistance": 20,
    "music_rolloffFactor": 0.3,
    "music_posX": 0,
    "music_posY": 0,
    "music_posZ": 1,
    "ambiance_refDistance": 0.6,
    "ambiance_maxDistance": 20,
    "ambiance_rolloffFactor": 0.3,
    "ambiance_posX": 0,
    "ambiance_posY": 0,
    "ambiance_posZ": 4,
    "enable_vibration": true,
    "autoVibrationLowThreshold": 20,
    "autoVibrationLowDuration": 50,
    "autoVibrationHighThreshold": 20,
    "autoVibrationHighDuration": 50,
    "vibration_profiles": {
        "默认": [
            0,
            100,
            50,
            100,
            50
        ]
    },
    "current_vibration_profile": "默认",
    "enable_float_ball": true,
    "float_ball_bg_color": "#ADD8E6",
    "float_ball_icon_color": "#FFFFFF",
    "float_ball_opacity": 1,
    "float_ball_size": 50,
    "voiceVolume": 1,
    "voiceFadeIn": 0.1,
    "voiceFadeOut": 0.1,
    "voiceDuckingEnabled": true,
    "voiceDuckingPercentage": 50,
    "voiceDuckingFadeTime": 0.5,
    "tts_request_balancing": true,
    "offline_rendering_enabled": false,
    "enable_lyrics_player": false,
    "lyrics_player_theme": "深邃夜空",
    "enable_tts_voice": false,
    "enable_narration_tts": false,
    "voice_tts_provider": "doubao",
    "narration_engine": "edge",
    "nimoCloneStorage": "browser",
    "tts_balancing_speaker_next_config": {},
    "regex_profiles": {
        "默认": {
            "beforeAfterRegex": "",
            "textRegex": "",
            "regexEntries": []
        }
    },
    "current_regex_profile": "默认",
    "regexTestMode": false,
    "regexBuiltInFiltersEnabled": true,
    "regexImageStartTag": "image###",
    "regexImageEndTag": "###",
    "llmTestMode": false,
    "llm_profiles": {
        "默认": {
            "api_url": "https://api.openai.com/v1",
            "api_key": "",
            "model": "gpt-3.5-turbo",
            "temperature": 1,
            "top_p": 1,
            "max_tokens": 66666,
            "history": [
                { "user": "", "assistant": "" },
                { "user": "", "assistant": "" },
                { "user": "", "assistant": "" }
            ]
        }
    },
    "current_llm_profile": "默认",
    "test_context_profiles": {
        "默认": {
            "entries": [
                {
                    "id": "entry_default_1",
                    "name": "系统提示",
                    "role": "system",
                    "content": "",
                    "enabled": true,
                    "triggerMode": "always",
                    "triggerWords": ""
                }
            ]
        },
        [sleepAidDefaultContextProfileName]: sleepAidDefaultContextProfile,
        [sleepAidAudioDefaultContextProfileName]: sleepAidAudioDefaultContextProfile
    },
    "current_test_context_profile": "默认",
    "llm_request_type_configs": {
        "main_sfx":         { "api_profile": "默认", "context_profile": "默认" },
        "sleep_aid_script": { "api_profile": "默认", "context_profile": sleepAidDefaultContextProfileName },
        "sleep_aid_sfx":    { "api_profile": "默认", "context_profile": sleepAidAudioDefaultContextProfileName }
    },
    "tts_profiles": {
        "默认": {
            "api_configs": {
                "默认": { 
                    "app_id": "", 
                    "access_key": "", 
                    "synthesis_quota": -1, 
                    "clone_quota": -1,
                    "speakers": {
                        "儿童绘本": { "speaker_id": "zh_female_xueayi_saturn_bigtts", "resource_id": "seed-tts-2.0", "description": "儿童绘本阅读场景" },
                        "vivi": { "speaker_id": "zh_female_vv_uranus_bigtts", "resource_id": "seed-tts-2.0", "description": "温柔女声" },
                        "大壹": { "speaker_id": "zh_male_dayi_saturn_bigtts", "resource_id": "seed-tts-2.0", "description": "浑厚男声" },
                        "黑猫侦探社咪仔": { "speaker_id": "zh_female_mizai_saturn_bigtts", "resource_id": "seed-tts-2.0", "description": "悬疑故事场景" },
                        "鸡汤女": { "speaker_id": "zh_female_jitangnv_saturn_bigtts", "resource_id": "seed-tts-2.0", "description": "情感治愈女声" },
                        "魅力女友": { "speaker_id": "zh_female_meilinvyou_saturn_bigtts", "resource_id": "seed-tts-2.0", "description": "亲密对话场景" },
                        "流畅女声": { "speaker_id": "zh_female_santongyongns_saturn_bigtts", "resource_id": "seed-tts-2.0", "description": "通用流畅女声" },
                        "儒雅逸辰": { "speaker_id": "zh_male_ruyayichen_saturn_bigtts", "resource_id": "seed-tts-2.0", "description": "儒雅男声" },
                        "可爱女生": { "speaker_id": "saturn_zh_female_keainvsheng_tob", "resource_id": "seed-tts-2.0", "description": "可爱活泼女声" },
                        "调皮公主": { "speaker_id": "saturn_zh_female_tiaopigongzhu_tob", "resource_id": "seed-tts-2.0", "description": "调皮可爱公主风" },
                        "爽朗少年": { "speaker_id": "saturn_zh_male_shuanglangshaonian_tob", "resource_id": "seed-tts-2.0", "description": "阳光爽朗少年音" },
                        "天才同桌": { "speaker_id": "saturn_zh_male_tiancaitongzhuo_tob", "resource_id": "seed-tts-2.0", "description": "学霸同桌的感觉" },
                        "知性灿灿": { "speaker_id": "saturn_zh_female_cancan_tob", "resource_id": "seed-tts-2.0", "description": "知性优雅女声" },
                        "小何": { "speaker_id": "zh_female_xiaohe_uranus_bigtts", "resource_id": "seed-tts-2.0", "description": "亲切女声" },
                        "云舟": { "speaker_id": "zh_male_m191_uranus_bigtts", "resource_id": "seed-tts-2.0", "description": "稳重男声" },
                        "小天": { "speaker_id": "zh_male_taocheng_uranus_bigtts", "resource_id": "seed-tts-2.0", "description": "阳光少年音" }
                    },
                    "current_speaker_profile": "默认音色"
                }
            },
            "current_api_config": "默认"
        }
    },
    "current_tts_profile": "默认",
    "edge_tts": {
        "voice": "zh-CN-XiaoxiaoNeural",
        "style": "general",
        "rate": 0,
        "pitch": 0,
        "volume": 50,
        "narrationVoice": "zh-CN-XiaoxiaoNeural",
        "pingCache": null
    },
    "edge_character_matching_profiles": {
        "默认": "在这里使用自然语言描述 Edge 音色名称（如 晓晓 / zh-CN-XiaoxiaoNeural）和角色的匹配关系"
    },
    "current_edge_character_matching_profile": "默认",
    "tts_character_matching_profiles": {
        "默认": "在这里使用自然语言描述音色和角色的匹配关系"
    },
    "current_tts_character_matching_profile": "默认",
    "minimax": {
        "apiKey": "",
        "platform": "cn",
        "timeout": 60000,
        "retry": 2,
        "model": "speech-2.8-hd",
        "speed": 1.0,
        "vol": 1.0,
        "pitch": 0,
        "languageBoost": "auto",
        "emotion": "",
        "format": "mp3",
        "sampleRate": 32000,
        "bitrate": 128000,
        "channel": 1,
        "vm": { "pitch": 0, "intensity": 0, "timbre": 0, "soundEffect": "" },
        "pronDict": [],
        "currentVoiceId": "Chinese (Mandarin)_Warm_Bestie",
        "customVoices": [],
        "myVoices": [],
        "cloudVoicesCache": {
            "fetchedAt": 0,
            "system": [],
            "cloning": [],
            "generation": []
        },
        "testText": "你好，这是 MiniMax 语音合成的测试文本。"
    },
    "minimax_character_matching_profiles": {
        "默认": "在这里使用自然语言描述音色（MiniMax 配置中已有的音色名称）和角色的匹配关系"
    },
    "current_minimax_character_matching_profile": "默认",
    "nimo": {
        "apiKey": "",
        "baseUrl": "https://api.xiaomimimo.com/v1",
        "model": "mimo-v2.5-tts",
        "format": "wav",
        "stylePrefix": "",
        "narrationStylePrefix": "",
        "currentVoiceId": "",
        "narrationVoiceId": "",
        "myVoices": [],
        "testText": "你好，这是 MiMo 语音合成的测试文本。"
    },
    "nimo_character_matching_profiles": {
        "默认": "在这里使用自然语言描述音色昵称（MiMo 配置中已保存的音色名）和角色的匹配关系"
    },
    "current_nimo_character_matching_profile": "默认",
    "tts_clone_tasks": [],
    "audio_resources_profiles": {
        "默认音效设定": {
            "enabled": true,
            "content": ""
        }
    },
    "current_audio_resources_profile": "默认音效设定",
    "audio_asset_profiles": {
        "默认资源列表": {
            "enabled": true,
            "content": ""
        }
    },
    "current_audio_asset_profile": "默认资源列表",
    "effectsProcessor": {
        "effectsEnabled": {
            "compressor": true,
            "effects": true,
            "ir": true,
            "spatial": true
        },
        "irApplyToVoiceOnly": false,
        "compressorProfiles": {
            "默认": { "threshold": -24, "ratio": 4, "attack": 10, "release": 250, "makeup": 6 },
            "轻柔对话": { "threshold": -18, "ratio": 2, "attack": 20, "release": 300, "makeup": 4 },
            "标准人声": { "threshold": -24, "ratio": 4, "attack": 10, "release": 250, "makeup": 6 },
            "广播人声": { "threshold": -30, "ratio": 6, "attack": 5, "release": 200, "makeup": 8 },
            "激烈对话": { "threshold": -36, "ratio": 8, "attack": 2, "release": 150, "makeup": 10 },
            "耳语增强": { "threshold": -48, "ratio": 12, "attack": 50, "release": 400, "makeup": 18 }
        },
        "currentCompressorProfile": "默认",
        "effectsProfiles":{
            "默认": {
                "pitch": { "enabled": false, "shift": 0, "grainSize": "medium" },
                "filter": { "enabled": false, "highpass": { "enabled": true, "freq": 80, "q": 0.7 }, "lowpass": { "enabled": true, "freq": 8000, "q": 0.7 } },
                "distortion": { "enabled": false, "amount": 0, "type": "soft" },
                "chorus": { "enabled": false, "depth": 50, "rate": 1.5, "wet": 50 },
                "delay": { "enabled": false, "time": 200, "feedback": 30, "wet": 30 },
                "reverb": { "enabled": false, "decay": 2, "predelay": 20, "wet": 30 }
            },
            
            "内心OS": {
                "pitch": { "enabled": false, "shift": 0, "grainSize": "medium" },
                "filter": { "enabled": true, "highpass": { "enabled": true, "freq": 150, "q": 0.5 }, "lowpass": { "enabled": true, "freq": 2500, "q": 0.8 } },
                "distortion": { "enabled": false, "amount": 0, "type": "soft" },
                "chorus": { "enabled": true, "depth": 15, "rate": 0.3, "wet": 20 },
                "delay": { "enabled": true, "time": 80, "feedback": 15, "wet": 15 },
                "reverb": { "enabled": true, "decay": 2.5, "predelay": 30, "wet": 55 }
            },
            
            "打电话": {
                "pitch": { "enabled": false, "shift": 0, "grainSize": "medium" },
                "filter": { "enabled": true, "highpass": { "enabled": true, "freq": 400, "q": 1.2 }, "lowpass": { "enabled": true, "freq": 3200, "q": 1.2 } },
                "distortion": { "enabled": true, "amount": 8, "type": "soft" },
                "chorus": { "enabled": false, "depth": 50, "rate": 1.5, "wet": 50 },
                "delay": { "enabled": false, "time": 200, "feedback": 30, "wet": 30 },
                "reverb": { "enabled": false, "decay": 2, "predelay": 20, "wet": 30 }
            },
            
            "大魔王": {
                "pitch": { "enabled": true, "shift": -8, "grainSize": "large" },
                "filter": { "enabled": true, "highpass": { "enabled": true, "freq": 50, "q": 0.5 }, "lowpass": { "enabled": true, "freq": 4000, "q": 0.8 } },
                "distortion": { "enabled": true, "amount": 12, "type": "soft" },
                "chorus": { "enabled": true, "depth": 40, "rate": 0.3, "wet": 25 },
                "delay": { "enabled": true, "time": 80, "feedback": 25, "wet": 15 },
                "reverb": { "enabled": true, "decay": 4, "predelay": 40, "wet": 45 }
            },
            
            "回忆": {
                "pitch": { "enabled": false, "shift": 0, "grainSize": "medium" },
                "filter": { "enabled": true, "highpass": { "enabled": true, "freq": 250, "q": 0.5 }, "lowpass": { "enabled": true, "freq": 3000, "q": 0.6 } },
                "distortion": { "enabled": true, "amount": 5, "type": "soft" },
                "chorus": { "enabled": true, "depth": 25, "rate": 0.2, "wet": 30 },
                "delay": { "enabled": true, "time": 350, "feedback": 35, "wet": 25 },
                "reverb": { "enabled": true, "decay": 5, "predelay": 80, "wet": 60 }
            },
            
            "机器人": {
                "pitch": {
                  "enabled": true,
                  "shift": -2,
                  "grainSize": "small"
                },
                "filter": {
                  "enabled": true,
                  "highpass": {
                    "enabled": true,
                    "freq": 802,
                    "q": 0.7
                  },
                  "lowpass": {
                    "enabled": true,
                    "freq": 8000,
                    "q": 0.7
                  }
                },
                "distortion": {
                  "enabled": true,
                  "amount": 5,
                  "type": "hard"
                },
                "chorus": {
                  "enabled": false,
                  "depth": 10,
                  "rate": 1,
                  "wet": 100
                },
                "delay": {
                  "enabled": false,
                  "time": 200,
                  "feedback": 30,
                  "wet": 30
                },
                "reverb": {
                  "enabled": false,
                  "decay": 2,
                  "predelay": 20,
                  "wet": 30
                }
              },
            
            "幽灵": {
                "pitch": { "enabled": true, "shift": 3, "grainSize": "large" },
                "filter": { "enabled": true, "highpass": { "enabled": true, "freq": 300, "q": 0.5 }, "lowpass": { "enabled": true, "freq": 4000, "q": 0.6 } },
                "distortion": { "enabled": false, "amount": 0, "type": "soft" },
                "chorus": { "enabled": true, "depth": 60, "rate": 0.5, "wet": 40 },
                "delay": { "enabled": true, "time": 500, "feedback": 55, "wet": 50 },
                "reverb": { "enabled": true, "decay": 10, "predelay": 120, "wet": 80 }
            },
            
            "水下": {
                "pitch": { "enabled": false, "shift": 0, "grainSize": "medium" },
                "filter": { "enabled": true, "highpass": { "enabled": false, "freq": 80, "q": 0.7 }, "lowpass": { "enabled": true, "freq": 600, "q": 2 } },
                "distortion": { "enabled": false, "amount": 0, "type": "soft" },
                "chorus": { "enabled": true, "depth": 60, "rate": 0.15, "wet": 70 },
                "delay": { "enabled": true, "time": 150, "feedback": 30, "wet": 25 },
                "reverb": { "enabled": true, "decay": 3, "predelay": 30, "wet": 40 }
            },
            
            "扩音器": {
                "pitch": { "enabled": false, "shift": 0, "grainSize": "medium" },
                "filter": { "enabled": true, "highpass": { "enabled": true, "freq": 500, "q": 1.5 }, "lowpass": { "enabled": true, "freq": 3500, "q": 1.5 } },
                "distortion": { "enabled": true, "amount": 40, "type": "hard" },
                "chorus": { "enabled": false, "depth": 50, "rate": 1.5, "wet": 50 },
                "delay": { "enabled": true, "time": 50, "feedback": 10, "wet": 10 },
                "reverb": { "enabled": true, "decay": 1.5, "predelay": 20, "wet": 25 }
            },
            
            "卡通角色": {
                "pitch": { "enabled": true, "shift": 10, "grainSize": "small" },
                "filter": { "enabled": true, "highpass": { "enabled": true, "freq": 200, "q": 0.7 }, "lowpass": { "enabled": false, "freq": 8000, "q": 0.7 } },
                "distortion": { "enabled": false, "amount": 0, "type": "soft" },
                "chorus": { "enabled": false, "depth": 50, "rate": 1.5, "wet": 50 },
                "delay": { "enabled": false, "time": 200, "feedback": 30, "wet": 30 },
                "reverb": { "enabled": false, "decay": 2, "predelay": 20, "wet": 30 }
            },
            
            "耳边私语": {
                "pitch": { "enabled": false, "shift": 0, "grainSize": "medium" },
                "filter": { "enabled": true, "highpass": { "enabled": true, "freq": 100, "q": 0.5 }, "lowpass": { "enabled": true, "freq": 6000, "q": 0.5 } },
                "distortion": { "enabled": false, "amount": 0, "type": "soft" },
                "chorus": { "enabled": false, "depth": 50, "rate": 1.5, "wet": 50 },
                "delay": { "enabled": false, "time": 200, "feedback": 30, "wet": 30 },
                "reverb": { "enabled": true, "decay": 0.3, "predelay": 3, "wet": 15 }
            }
        },
        "currentEffectsProfile": "默认",
        "effectsDescriptionProfiles": {
            "默认介绍": "此处填写对【声音特效】各个预设的总体介绍或说明。"
        },
        "currentEffectsDescriptionProfile": "默认介绍",
        "irProfiles": {
            "默认 (无)": {
                "wet": 50,
                "gain": 0,
                "irData": null,
                "fileName": ""
            }
        },
        "currentIrProfile": "默认 (无)",
        "irDescriptionProfiles": {
            "默认介绍": "此处填写对【环境混响】各个预设的总体介绍或说明。"
        },
        "currentIrDescriptionProfile": "默认介绍",
        "spatialProfiles": {
            "正前方站立": { "points": [{ "x": 0, "y": 0, "z": -1.5, "speedToNext": 1, "dwellTime": 0 }], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "左侧站立": { "points": [{ "x": -1.5, "y": 0, "z": 0, "speedToNext": 1, "dwellTime": 0 }], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "右侧站立": { "points": [{ "x": 1.5, "y": 0, "z": 0, "speedToNext": 1, "dwellTime": 0 }], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "身后站立": { "points": [{ "x": 0, "y": 0, "z": 1.5, "speedToNext": 1, "dwellTime": 0 }], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "远处走来": { "points": [ { "x": 0, "y": 0, "z": -5, "speedToNext": 1.2, "dwellTime": 0 }, { "x": 0, "y": 0, "z": -1, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "走向远方": { "points": [ { "x": 0, "y": 0, "z": -1, "speedToNext": 1, "dwellTime": 0 }, { "x": 0, "y": 0, "z": -5, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "路过（左→右）": { "points": [ { "x": -3, "y": 0, "z": -1, "speedToNext": 1.5, "dwellTime": 0 }, { "x": 0, "y": 0, "z": -1, "speedToNext": 1.5, "dwellTime": 0 }, { "x": 3, "y": 0, "z": -1, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "路过（右→左）": { "points": [ { "x": 3, "y": 0, "z": -1, "speedToNext": 1.5, "dwellTime": 0 }, { "x": 0, "y": 0, "z": -1, "speedToNext": 1.5, "dwellTime": 0 }, { "x": -3, "y": 0, "z": -1, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "靠近左耳": { "points": [ { "x": 0, "y": 0, "z": -1, "speedToNext": 0.5, "dwellTime": 0 }, { "x": -0.3, "y": 0, "z": 0.15, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "靠近右耳": { "points": [ { "x": 0, "y": 0, "z": -1, "speedToNext": 0.5, "dwellTime": 0 }, { "x": 0.3, "y": 0, "z": 0.15, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "环绕飞行": { "points": [ { "x": 0, "y": 0, "z": -3, "speedToNext": 2, "dwellTime": 0 }, { "x": 3, "y": 0, "z": 0, "speedToNext": 2, "dwellTime": 0 }, { "x": 0, "y": 0, "z": 3, "speedToNext": 2, "dwellTime": 0 }, { "x": -3, "y": 0, "z": 0, "speedToNext": 2, "dwellTime": 0 }, { "x": 0, "y": 0, "z": -3, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "高空飞越": { "points": [ { "x": -4, "y": 0, "z": 2, "speedToNext": 5, "dwellTime": 0 }, { "x": 0, "y": 3, "z": 0, "speedToNext": 5, "dwellTime": 0 }, { "x": 4, "y": 0, "z": -2, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "上下浮动": { "points": [ { "x": 0, "y": -0.5, "z": -2, "speedToNext": 0.8, "dwellTime": 0.5 }, { "x": 0, "y": 1.5, "z": -2, "speedToNext": 0.8, "dwellTime": 0.5 }, { "x": 0, "y": -0.5, "z": -2, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "螺旋靠近": { "points": [ { "x": 5, "y": 0, "z": 0, "speedToNext": 3, "dwellTime": 0 }, { "x": 0, "y": 0, "z": -4, "speedToNext": 3, "dwellTime": 0 }, { "x": -3, "y": 0, "z": 0, "speedToNext": 3, "dwellTime": 0 }, { "x": 0, "y": 0, "z": 2, "speedToNext": 3, "dwellTime": 0 }, { "x": 1, "y": 0, "z": 0, "speedToNext": 3, "dwellTime": 0 }, { "x": 0, "y": 0, "z": -0.5, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } },
            "Z字形穿梭": { "points": [ { "x": -3, "y": 0, "z": -4, "speedToNext": 2.5, "dwellTime": 0 }, { "x": 3, "y": 0, "z": -2, "speedToNext": 2.5, "dwellTime": 0 }, { "x": -3, "y": 0, "z": 0, "speedToNext": 2.5, "dwellTime": 0 }, { "x": 3, "y": 0, "z": 2, "speedToNext": 1, "dwellTime": 0 } ], "params": { "distanceModel": "inverse", "refDistance": 1, "maxDistance": 20, "rolloffFactor": 1, "coneInnerAngle": 360, "coneOuterAngle": 360, "coneOuterGain": 0 } }
        },
        "currentSpatialProfile": "正前方站立",
        "spatialDescriptionProfiles": {
            "默认介绍": "此处填写对【空间音频】各个预设的总体介绍或说明。"
        },
        "currentSpatialDescriptionProfile": "默认介绍"
    }
};

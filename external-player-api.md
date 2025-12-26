# `external-player.js` 接口文档

通过分析 `external-player.js` 的源码和 `external_player_test.html` 中的使用示例，我们可以总结出该模块主要通过 SillyTavern 的 `eventSource` 系统来接收和响应事件，从而实现外部控制音频播放的功能。

## 核心概念

`external-player.js` 允许任何能够访问 SillyTavern `eventSource` 的前端页面（例如，通过 `iframe` 或新标签页打开的 HTML 文件）来请求播放、停止和控制音频。每个播放请求都被视为一个独立的“播放实例”，并通过一个唯一的 `id` 来进行管理。

## 接口事件（由外部调用）

外部页面可以通过 `eventEmit` 函数触发以下事件来与播放器交互。

### 1. 播放音频 (`st-immersive-sound:play-external`)

这是最核心的接口，用于请求播放一个音频。

**事件名:** `st-immersive-sound:play-external`

**数据包 (data):** `object`

#### 通用参数

所有类型的音频请求都包含以下通用参数：

| 参数 | 类型 | 是否必须 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **是** | 播放实例的唯一标识符。用于后续的停止或控制操作。 |
| `type` | `string` | **是** | 音频类型。决定了音频的来源和处理方式。可选值为：`Music`, `Ambiance`, `SFX`, `VOICE`。 |
| `volume` | `number` | 否 | 音量大小，范围 `0` 到 `100`。默认为 `100` 或在资源文件中定义的值。 |
| `time` | `number` | 否 | 播放时长（秒）。如果设置此值，音频会循环播放，直到达到指定时长后自动淡出停止。如果为 `0` 或未定义，则音频仅播放一次。 |

---

#### 特定类型参数

根据 `type` 值的不同，需要提供不同的参数：

**A) 当 `type` 为 `Music`, `Ambiance`, `SFX` 时:**

这些类型通常用于播放预设的音效文件。

| 参数 | 类型 | 是否必须 | 描述 |
| :--- | :--- | :--- | :--- |
| `src` | `string` | **是** | 要播放的音频资源名称。该名称必须是在插件“音效资源”配置中定义好的 `key`。 |
| `vibration` | `string` | 否 | 震动效果。可以是“震动管理”中预设的名称，也可以是 `auto-[low_threshold]-[low_duration]-[high_threshold]-[high_duration]` 格式的自动震动配置。 |

**B) 当 `type` 为 `VOICE` 时:**

此类型用于实时请求 TTS（文本转语音）并播放。

| 参数 | 类型 | 是否必须 | 描述 |
| :--- | :--- | :--- | :--- |
| `speaker` | `string` | **是** | TTS 音色名称。该名称必须存在于当前 TTS 配置的 `speakers` 列表中。 |
| `context` | `string` | **是** | 需要合成为语音的文本内容。 |
| `context_texts`| `string` | 否 | （可选）用于提供 TTS 情感/语气参考的上下文文本。 |

> **注意:** 此功能依赖于在 `st-immersive-sound` 插件设置中正确配置的 TTS Profile，包括有效的 API 凭据和音色列表。

---

#### 音效处理参数 (仅用于 `SFX` 和 `VOICE` 类型)

当 `type` 为 `SFX` 或 `VOICE` 时，可以附加以下可选参数来应用高级音效处理：

| 参数 | 类型 | 是否必须 | 描述 |
| :--- | :--- | :--- | :--- |
| `ir_description` | `string` | 否 | **环境混响**预设名称。例如 "教堂"、"山洞" 等。 |
| `spatial` | `string` | 否 | **空间音频**预设名称。例如 "远处走来"、"路过（左→右）" 等。 |
| `special_effects`| `string` | 否 | **声音特效**预设名称。例如 "机器人"、"打电话"、"内心OS" 等。 |

---

### 2. 停止音频 (`st-immersive-sound:stop-external`)

用于立即停止一个正在播放的音频实例。

**事件名:** `st-immersive-sound:stop-external`

**数据包 (data):** `object`

| 参数 | 类型 | 是否必须 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **是** | 要停止的播放实例的唯一标识符。 |

---

### 3. 控制音频 (`st-immersive-sound:external-audio-control`)

在音频播放期间，可以动态调整其参数，如音量和播放进度。

**事件名:** `st-immersive-sound:external-audio-control`

**数据包 (data):** `object`

| 参数 | 类型 | 是否必须 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **是** | 要控制的播放实例的唯一标识符。 |
| `command` | `string` | **是** | 要执行的命令。目前支持 `set_volume` 和 `seek`。 |
| `value` | `any` | **是** | 命令对应的值。 |

#### `command` 详解:

-   **`set_volume`**: 设置音量。
    -   `value`: `number`，范围 `0` 到 `100`。
-   **`seek`**: 跳转到指定播放时间。
    -   `value`: `number`，要跳转到的时间点（秒）。

---

### 4. 获取配置 (`st-immersive-sound:get-config-data`)

用于从插件后端请求当前可用的配置信息，方便外部 UI 动态生成选项列表。

**事件名:** `st-immersive-sound:get-config-data`

**数据包 (data):** `object` (可以是一个空对象 `{}`)

调用此事件后，插件会通过 `st-immersive-sound:config-data` 事件响应请求，返回一个包含可用音效、音色、特效等列表的 JSON 对象。

---

## 响应事件 (由播放器发出)

当外部页面发出请求后，`external-player.js` 会通过 `eventOn` 监听器可以捕获的事件来反馈其状态。

### 1. 音频开始播放 (`st-immersive-sound:external-audio-playing`)

当音频成功加载并开始播放时触发。

**事件名:** `st-immersive-sound:external-audio-playing`

**数据包 (data):** `object`

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | `string` | 正在播放的实例的唯一标识符。 |
| `duration` | `number` | 音频的总时长（秒）。 |
| `volume` | `number` | 当前应用的音量（`0`-`100`）。 |
| `url` | `string` | 音频的实际资源地址。 |
| `is_preview` | `boolean` | 是否为预览播放。 |
| `type` | `string` | （非预览时）音频的类型。 |
| `context` | `string` | （`VOICE`类型时）合成的文本。 |

### 2. 播放进度更新 (`st-immersive-sound:external-audio-progress`)

在音频跳转（seek）操作完成后触发，用于同步播放进度。

**事件名:** `st-immersive-sound:external-audio-progress`

**数据包 (data):** `object`

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | `string` | 播放实例的唯一标识符。 |
| `currentTime`| `number` | 当前的播放时间（秒）。 |
| `duration` | `number` | 音频的总时长（秒）。 |

> **注意:** 此事件主要用于 seek 操作后的状态同步，而不是连续的进度报告，以避免不必要的性能开销。

### 3. 音频停止 (`st-immersive-sound:external-audio-stopped`)

当音频播放完成、被手动停止或因错误中断后触发。

**事件名:** `st-immersive-sound:external-audio-stopped`

**数据包 (data):** `object`

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | `string` | 已停止的播放实例的唯一标识符。 |
| `url` | `string` | 已停止的音频的资源地址。 |

### 4. 音频播放失败 (`st-immersive-sound:external-audio-failed`)

当音频在加载或播放过程中遇到无法恢复的错误时触发。

**事件名:** `st-immersive-sound:external-audio-failed`

**数据包 (data):** `object`

| 参数 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | `string` | 尝试播放但失败的实例的唯一标识符。 |
| `error` | `string` | 描述失败原因的错误信息。 |

### 5. 配置数据响应 (`st-immersive-sound:config-data`)

响应 `st-immersive-sound:get-config-data` 请求，返回插件的当前配置。

**事件名:** `st-immersive-sound:config-data`

**数据包 (data):** `object`，包含以下字段：
- `effectsProfiles`: `string[]` - 可用的声音特效名称列表。
- `irProfiles`: `string[]` - 可用的环境混响名称列表。
- `spatialProfiles`: `string[]` - 可用的空间音频名称列表。
- `parsedAudioAssets`: `object[]` - 音效资源列表，每个对象包含 `key`, `uploader`, `volume`, `vibration`。
- `ttsSpeakers`: `string[]` - 当前TTS配置下可用的音色名称列表。

## 总结

`external-player.js` 提供了一个功能强大且灵活的接口，允许开发者通过简单的事件机制，将沉浸式音频体验集成到任何自定义的前端界面中。通过组合不同的参数，可以实现从简单的背景音乐播放到复杂的、带有动态空间效果和特效的角色语音等多种功能。`external_player_test.html` 是一个非常好的起点，展示了如何使用这些接口。

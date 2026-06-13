// @ts-nocheck
/**
 * 正则配置助手模块（st-immersive-sound 适配版）
 * 适配 utils/ui-regex.js 中暴露的 window.stIsRegexAIBridge
 *   - getStatus / setOriginalText / setEditors
 *   - createEntry / triggerTest / setTestMode / getResultText / clearAllEntries
 * （st-is 未实现 chatu8 的手势/点击触发，已去除相关命令）
 */

export const regexModule = {
    name: '正则配置助手',
    summary: '帮助用户配置文本匹配和替换的正则规则（前后正则、文字正则、正则条目），含测试工具与「双击正文 → 从头播放」捕获原文的能力。当用户提到正则、文本替换、文本提取、去除思维链/状态栏等需求时加载此模块。',

    commands: `
【正则模块可用命令】（必须先 load_module: regex 才能使用以下命令）

1) 查看正则测试区域当前状态（测试模式、当前预设、原文/结果框、所有条目等）：
<SystemQuery>{"type": "regex_status"}</SystemQuery>

2) 开/关「正则测试模式」（**开启=只在测试区域预览，不会作用到酒馆实际消息**；关闭=正则会作用到酒馆消息）：
<SystemQuery>{"type": "regex_test_mode", "enabled": true}</SystemQuery>

3) 设置「原文」框内容（把要处理的文本写入测试区域）：
<SystemQuery>{"type": "regex_set_original", "text": "..."}</SystemQuery>

4) 设置「前后正则」+「文字正则」两个编辑器的内容：
<SystemQuery>{"type": "regex_set_editors", "beforeAfter": "/.../g", "textRegex": "/.../g"}</SystemQuery>

5) 在「正则预设编辑器」里新建一条 find/replace 条目：
<SystemQuery>{"type": "regex_create_entry", "data": {"scriptName": "规则名", "findRegex": "/正则/gi", "replaceString": "替换内容"}}</SystemQuery>

6) 立即在测试区域执行一次正则测试（结果写入「正则后文本」框）：
<SystemQuery>{"type": "regex_test"}</SystemQuery>

7) 读取「正则后文本」框的当前内容：
<SystemQuery>{"type": "regex_result"}</SystemQuery>

8) 清空所有正则条目（重新开始时用）：
<SystemQuery>{"type": "regex_clear_entries"}</SystemQuery>

9) 切到正则页面，让用户能直接看到测试区域：
<UIAction>{"action": "openTab", "tab": "regex"}</UIAction>
`.trim(),

    knowledge: `
【正则页面功能说明】

- 「正则页面」有三个区域：①「前后正则 / 文字正则」两个编辑器（一次性裁剪/替换）、②「正则预设编辑器」条目列表（可多条按顺序执行 find→replace）、③「测试区域」（原文框 + 正则后文本框 + 测试按钮）。
- 「前后正则」用于在文本最外层裁掉开头/结尾；「文字正则」用于替换文本内部内容。
- 「正则预设编辑器」每条包含 findRegex + replaceString，按顺序逐条对文本应用替换。
- **测试模式（regexTestMode）的语义**：开启后用户在酒馆里**双击消息正文 → 弹出菜单 → 选「从头播放」**时，本插件会把这条消息原文自动灌进「原文」框并立刻跑一次正则、把结果写入「正则后文本」框；同时**该次播放会被拦截**（不发起 LLM/TTS 请求），仅用于调试。每次双击触发后测试模式会自动关闭一次（一次性消耗），需要再次捕获请重新打开。
- 测试模式关闭时，正则会按配置真正作用到聊天消息（落地生效）。
- 配置可以保存为「正则预设」（profile），不同场景可切换。
`.trim(),

    workflow: `
【正则引导流程】（用户请求帮配置正则时按此顺序执行）

⚠️ 加载本模块时，系统会自动把一次「当前正则状态」附在本回复末尾返回。请直接阅读，**不要重复发送 regex_status**。

🔴🔴🔴【最高优先级 · 正则的最终目标】🔴🔴🔴
本插件做的是「沉浸式音效/朗读」，正则的**唯一目的**是：让正则后的文本**只剩纯正文故事**——也就是会被朗读出来的那段对白/旁白。
所有非正文的东西必须被去掉，包括但不限于：
- 思维链（<think>/<thinking>/<reasoning> 等，含未闭合的尾部）
- 状态栏 / status / 状态 / 角色面板 / 数值更新块
- summary / 总结 / 概述 块
- JSON / 数据更新 / <details>...</details> / <plot>...</plot> 等元数据
- image### ... ### 形式的图片触发标签（这一段在 LLM 流程里另有用，不要被朗读到）
- 任何 markdown 标题 / 分隔符 / system 注释

✅ 优先策略（与 st-chatu8 一致）：**"正向框选"优于"反向去除"**。
如果正文外层有明确包裹（例如 <content>正文</content>、<story>...</story>、「第N章」之间等），**直接用一条捕获组正则把正文抓出来整体替换**，比一项一项删杂项稳得多。
例如把  /[\s\S]*<content>([\s\S]*?)<\/content>[\s\S]*/  替换为 $1，一步到位。

获取「示例原文」的标准方式（与 st-chatu8 一致）：
👉 让用户在酒馆消息列表里**双击**他想处理的那条消息正文，等弹出菜单后选「**从头播放**」，原文就会被自动灌进正则页面的「原文」框并跑一次测试。**不要让用户手动复制粘贴**，也不要自己用 regex_set_original 凭空写假数据，除非用户明确给了文本。

⚙️ 关于"静默命令"（很重要，影响你的回复节奏）：
以下命令是 **fire-and-forget**，执行成功后系统**不会**给你 SystemQueryResult，也**不会**触发新一轮续询：
  - regex_test_mode / regex_set_original / regex_set_editors / regex_create_entry / regex_clear_entries
所以当你**只发**这些命令时，你这一轮的人话回复就是最终回复，**不会**有"系统返回的指令执行结果"再回来给你。
当你需要"做完操作再立刻看结果"，请在同一轮里把这些静默命令和 regex_test / regex_result / regex_status 一起发出——
后面三个**会**返回结果触发续询，你下一轮就能基于结果继续优化。

⚙️ 关于 load_module 自动行为：
你发出 load_module: regex 后，系统**已经替你自动**：
  ① 切到正则设置页面（不必再单独发 openTab）；
  ② 开启了正则测试模式（不必再单独发 regex_test_mode true）。
返回结果末尾的「load_module 已自动完成的准备工作」会列出已做的事，直接基于它继续工作流。
**注意**：用户每次双击消息触发后，测试模式会被一次性消耗关闭；下次需要再次捕获原文时**才**需要你发 regex_test_mode true 重新打开。

执行步骤：

1. 阅读附带的「load_module 已自动完成的准备工作」+「当前正则状态」：tab 已切、测试模式已开，再看有无条目、原文框是否已有内容、当前预设。
2. 如果「原文」框为空或不是用户想处理的文本：
   - 用一句话告诉用户:"请到酒馆消息区双击你想处理的那条消息正文，在弹出菜单里选「从头播放」，我就能拿到原文并自动跑一次正则。"
   - **然后停下来等用户操作**，不要再发任何 regex_set_original / regex_test 等命令。下一轮你发 regex_status 即可看到捕获到的原文。
   - 注意：双击触发会一次性关闭测试模式；如果用户后面又要再次捕获，记得发 regex_test_mode true 重新打开（这是静默命令，不会触发续询）。
3. 拿到原文后，先扫一眼判断结构：**正文外层有没有明确标签 / 锚点？**
   - 有锚点（推荐）：用一条「正向框选」正则一次性抽出正文，例如 findRegex = /[\s\S]*<content>([\s\S]*?)<\/content>[\s\S]*/，replaceString = $1。
   - 无明确锚点：再用「反向去除」逐项删 thinking / 状态栏 / summary / JSON 块等。
4. 用 regex_create_entry 创建条目。原则：**条目越少越好，能一条搞定就不开两条**。
5. 在**同一轮**里把所有 regex_create_entry（静默）+ 一条 regex_test（非静默）一起发出 → 下一轮系统会回测试结果给你。
6. 用 regex_result 取出结果（也可以直接看 regex_test 返回里的结果文本），逐字检查：**结果里有没有任何非正文的残留？**——如果还有思维链/状态栏/JSON 残渣，就回到 3 继续调整，直到结果**仅是正文**为止。
7. 不理想就调正则再测；改动多了先 regex_clear_entries 清空再重来，避免条目互相污染（同一轮里 clear + 创建新条目 + regex_test 一次性发出最快）。
8. 用户确认结果是纯正文后，提醒用户可在正则页面把配置「另存为预设」，并按需关闭测试模式让规则真正生效。

⚠️ 验收标准（不达到不算完成）：
- regex_result 输出**只能包含正文故事文字**（保留正文里的标点和段落分隔）。
- 任何 <thinking>、<status>、<summary>、JSON 块、image### 标签都不能出现在结果里。
- 如果发现还残留，**继续优化**，不要满足于"差不多就行"。

🚫 不要做"多余的事情"（极其重要）：
- **不要**为了"排版更整洁"而合并连续换行（比如把多个 \\n 替换成单个 \\n）。
- **不要**裁掉行首/行尾空格、不要去除全角空格、不要删空行、不要折行。
- **不要**做大小写转换、不要替换标点（中英文标点保留原样）、不要删除引号/破折号。
- **不要**整理 markdown 标题/列表/缩进；正文里就该长这样。
- 唯一目标是**去掉非正文块**（思维链/状态栏/JSON/标签等），其余原文一字不动。
- 如果用户**显式要求**清理空行/格式，再做；否则保持原样。

设计正则的关键经验：
- 思维链不一定有完整的 <thinking>…</thinking>，常见是只有 </thinking> 结尾，需要写「从开头贪婪到第一个 </thinking>」的正则。
- 优先用 [\\s\\S] 而不是 . （后者默认不匹配换行）；多行内容务必带 g 标志。
- 顺序：先用一条大正则"框选正文"；不要再追加"清理空白""合并换行"之类的收尾条目（除非用户明确要求）。
`.trim(),

    errorGuide: `
【正则常见问题】

- regex_xxx 命令报「未知 SystemQuery type」：本模块还没加载完成；先发送 <SystemQuery>{"type":"load_module","module":"regex"}</SystemQuery>。
- regex_xxx 命令报「正则模块未加载，请先打开正则设置页面」：先 <UIAction>{"action":"openTab","tab":"regex"}</UIAction> 切到正则页面。
- 用户说"我双击了但没反应"：检查测试模式是否处于开启状态（用 regex_status 看 testMode）。测试模式是一次性的，每触发一次会自动关闭，需要再次开启。也要确认用户双击的是消息正文（mes_text）而不是别的元素。
- 正则不匹配：检查语法/转义；用 regex_test 反复试错。
- 条目顺序很重要：前面替换会影响后面的匹配，必要时 regex_clear_entries 清空重排。
- 「测试模式开启=不作用到真实消息（仅调试预览）」与直觉相反，记住这一点；最终落地配置完成后**记得关闭**测试模式，否则真实消息不会被处理。
`.trim()
};

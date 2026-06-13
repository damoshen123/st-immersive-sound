// @ts-nocheck
/**
 * AI 助手知识模块注册中心
 *
 * 每个模块定义：
 *   { name, summary, commands, knowledge, workflow, errorGuide }
 *
 * 主提示词只注入 summary 列表，AI 通过
 *   <SystemQuery>{"type":"load_module","module":"<key>"}</SystemQuery>
 * 按需加载完整模块文本。
 */

import { regexModule } from './regexModule.js';

export const promptModules = {
    regex: regexModule,
};

/**
 * 获取所有模块的摘要列表（注入主提示词）
 */
export function getModuleSummaries() {
    const lines = ['【可加载的知识模块】（用 load_module 命令获取详细信息）'];
    for (const [key, mod] of Object.entries(promptModules)) {
        lines.push(`- ${key}: ${mod.name} — ${mod.summary}`);
    }
    lines.push('');
    lines.push('当用户的需求涉及对应模块时，先加载模块再进行操作：');
    lines.push('<SystemQuery>{"type": "load_module", "module": "模块名"}</SystemQuery>');
    return lines.join('\n');
}

/**
 * 获取指定模块的完整提示词
 */
export function getModulePrompt(moduleName) {
    const mod = promptModules[moduleName];
    if (!mod) return null;
    const sections = [];
    sections.push(`===== ${mod.name} 模块详细知识 =====`);
    sections.push('');
    if (mod.commands)   { sections.push(mod.commands);   sections.push(''); }
    if (mod.knowledge)  { sections.push(mod.knowledge);  sections.push(''); }
    if (mod.workflow)   { sections.push(mod.workflow);   sections.push(''); }
    if (mod.errorGuide) { sections.push(mod.errorGuide); sections.push(''); }
    sections.push(`===== ${mod.name} 模块结束 =====`);
    return sections.join('\n');
}

export function getAvailableModuleKeys() {
    return Object.keys(promptModules);
}

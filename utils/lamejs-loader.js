import { extensionFolderPath } from './config.js';
import { getEnvironmentDiagnostics, getScopedLibrary, loadScopedGlobalLibrary } from './scoped-lib-loader.js';

// 与 tone-loader.js 同样的“隔离加载”策略：把 lame.min.js 在屏蔽掉 define/module/exports/require
// 的环境里执行，避免页面被其它插件（如 @monaco-editor/loader）带入 AMD 环境后，UMD 库走 AMD
// 分支导致 window.lamejs === undefined。
const scopedLamejsKey = 'stImmersiveSoundLamejs';

function isValidLamejs(lib) {
    return Boolean(lib && typeof lib.Mp3Encoder === 'function');
}

export function getLamejs() {
    const lamejs = getScopedLibrary(scopedLamejsKey, 'lamejs');
    if (!isValidLamejs(lamejs)) {
        throw new Error('lamejs is not available for st-immersive-sound.');
    }
    return lamejs;
}

export function getLamejsDiagnostics() {
    return {
        ...getEnvironmentDiagnostics(),
        hasWindowLamejs: isValidLamejs(typeof window !== 'undefined' ? window.lamejs : undefined),
        hasPluginScopedLamejs: isValidLamejs(typeof window !== 'undefined' ? window[scopedLamejsKey] : undefined),
    };
}

export async function ensureLamejsLoaded() {
    const lamejs = await loadScopedGlobalLibrary({
        url: `${extensionFolderPath}/lame.min.js`,
        globalName: 'lamejs',
        scopeKey: scopedLamejsKey,
        validate: isValidLamejs,
    });

    if (!isValidLamejs(lamejs)) {
        throw new Error('lamejs failed validation for st-immersive-sound.');
    }

    return lamejs;
}

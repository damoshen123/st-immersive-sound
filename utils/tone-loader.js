import { extensionFolderPath } from './config.js';
import { getEnvironmentDiagnostics, getScopedLibrary, loadScopedGlobalLibrary } from './scoped-lib-loader.js';

const scopedToneKey = 'stImmersiveSoundTone';

function isValidTone(Tone) {
    return Boolean(Tone && typeof Tone.start === 'function' && typeof Tone.Player === 'function');
}

export function getTone() {
    const Tone = getScopedLibrary(scopedToneKey, 'Tone');
    if (!isValidTone(Tone)) {
        throw new Error('Tone.js is not available for st-immersive-sound.');
    }
    return Tone;
}

export function getToneDiagnostics() {
    return {
        ...getEnvironmentDiagnostics(),
        hasWindowTone: isValidTone(typeof window !== 'undefined' ? window.Tone : undefined),
        hasPluginScopedTone: isValidTone(typeof window !== 'undefined' ? window[scopedToneKey] : undefined),
    };
}

export async function ensureToneLoaded() {
    const Tone = await loadScopedGlobalLibrary({
        url: `${extensionFolderPath}/Tone.js`,
        globalName: 'Tone',
        scopeKey: scopedToneKey,
        validate: isValidTone,
    });

    if (!isValidTone(Tone)) {
        throw new Error('Tone.js failed validation for st-immersive-sound.');
    }

    return Tone;
}

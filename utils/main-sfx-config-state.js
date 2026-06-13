// @ts-nocheck

const defaultState = {
    requestType: 'main_sfx',
    rawConfigText: '',
    editedConfigText: '',
    fullMesText: '',
    rawMesText: '',
    cleanedMesText: '',
    removedRanges: [],
    parseIssues: [],
    mesTextElement: null,
    updatedAt: 0,
    isReparsing: false,
    lastError: '',
};

let mainSfxConfigState = { ...defaultState };

export const MainSfxConfigEmitter = new EventTarget();

function cloneState(state) {
    return {
        ...state,
        removedRanges: Array.isArray(state.removedRanges) ? [...state.removedRanges] : [],
        parseIssues: Array.isArray(state.parseIssues) ? state.parseIssues.map(issue => ({ ...issue })) : [],
    };
}

function emitUpdate() {
    MainSfxConfigEmitter.dispatchEvent(new CustomEvent('update', {
        detail: {
            state: cloneState(mainSfxConfigState),
        },
    }));
}

export function getMainSfxConfigState() {
    return cloneState(mainSfxConfigState);
}

export function setMainSfxConfigState(patch = {}) {
    const nextState = {
        ...mainSfxConfigState,
        ...patch,
    };

    if (Object.prototype.hasOwnProperty.call(patch, 'removedRanges')) {
        nextState.removedRanges = Array.isArray(patch.removedRanges) ? [...patch.removedRanges] : [];
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'parseIssues')) {
        nextState.parseIssues = Array.isArray(patch.parseIssues) ? patch.parseIssues.map(issue => ({ ...issue })) : [];
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'updatedAt')) {
        nextState.updatedAt = patch.updatedAt || 0;
    }

    mainSfxConfigState = nextState;
    emitUpdate();
    return getMainSfxConfigState();
}

export function saveMainSfxConfigSession({ configText, fullMesText, rawMesText, cleanedMesText, removedRanges, mesTextElement }) {
    const text = typeof configText === 'string' ? configText : '';
    mainSfxConfigState = {
        ...mainSfxConfigState,
        requestType: 'main_sfx',
        rawConfigText: text,
        editedConfigText: text,
        fullMesText: typeof fullMesText === 'string' ? fullMesText : '',
        rawMesText: typeof rawMesText === 'string' ? rawMesText : '',
        cleanedMesText: typeof cleanedMesText === 'string' ? cleanedMesText : '',
        removedRanges: Array.isArray(removedRanges) ? [...removedRanges] : [],
        parseIssues: [],
        mesTextElement: mesTextElement || null,
        updatedAt: Date.now(),
        isReparsing: false,
        lastError: '',
    };
    emitUpdate();
    return getMainSfxConfigState();
}

export function resetMainSfxConfigState() {
    mainSfxConfigState = { ...defaultState };
    emitUpdate();
    return getMainSfxConfigState();
}

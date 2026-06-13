const loadingPromises = new Map();

export function getScopedLibrary(scopeKey, globalName) {
    if (typeof window === 'undefined') return undefined;
    return window[scopeKey] ?? (globalName ? window[globalName] : undefined);
}

export function getEnvironmentDiagnostics() {
    if (typeof window === 'undefined') {
        return {
            hasDefine: false,
            hasDefineAmd: false,
            defineType: 'undefined',
            hasRequire: false,
            requireType: 'undefined',
            hasModule: false,
            moduleType: 'undefined',
            hasExports: false,
            exportsType: 'undefined',
        };
    }

    return {
        hasDefine: typeof window.define !== 'undefined',
        hasDefineAmd: Boolean(window.define?.amd),
        defineType: typeof window.define,
        hasRequire: typeof window.require !== 'undefined',
        requireType: typeof window.require,
        hasModule: typeof window.module !== 'undefined',
        moduleType: typeof window.module,
        hasExports: typeof window.exports !== 'undefined',
        exportsType: typeof window.exports,
    };
}

export async function loadScopedGlobalLibrary({ url, globalName, scopeKey, validate, preferExistingGlobal = false }) {
    if (typeof window === 'undefined') {
        throw new Error(`Cannot load ${globalName} outside browser environment.`);
    }

    const existingScoped = getScopedLibrary(scopeKey);
    if (existingScoped) {
        return existingScoped;
    }

    const existingGlobal = window[globalName];
    if (preferExistingGlobal && existingGlobal) {
        window[scopeKey] = existingGlobal;
        return existingGlobal;
    }

    if (loadingPromises.has(scopeKey)) {
        return loadingPromises.get(scopeKey);
    }

    const promise = (async () => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${globalName} from ${url}: ${response.status} ${response.statusText}`);
        }

        const source = await response.text();
        const executor = new Function(
            'window',
            'self',
            'globalThis',
            'global',
            'define',
            'module',
            'exports',
            'require',
            'requestedGlobalName',
            `${source}\nlet scopedExport;\ntry {\n    scopedExport = eval(requestedGlobalName);\n} catch (_) {\n    scopedExport = undefined;\n}\nreturn window[requestedGlobalName] ?? globalThis[requestedGlobalName] ?? self[requestedGlobalName] ?? global?.[requestedGlobalName] ?? scopedExport;`
        );

        const library = executor(window, window, window, window, undefined, undefined, undefined, undefined, globalName);
        const resolved = library ?? window[globalName];

        if (!resolved) {
            throw new Error(`${globalName} loaded from ${url} but did not expose a global.`);
        }

        if (typeof validate === 'function' && !validate(resolved)) {
            throw new Error(`${globalName} loaded from ${url} but failed validation.`);
        }

        window[scopeKey] = resolved;
        return resolved;
    })().catch((error) => {
        loadingPromises.delete(scopeKey);
        throw error;
    });

    loadingPromises.set(scopeKey, promise);
    return promise;
}

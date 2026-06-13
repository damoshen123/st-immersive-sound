// @ts-nocheck
/**
 * A generic in-memory cache for request-response pairs.
 * This is used to cache results from expensive operations like LLM calls.
 * The cache is session-based and will be cleared on page reload.
 */

const requestCache = new Map();

/**
 * Retrieves a value from the cache.
 * @param {string} key - The key to look up.
 * @returns {any | undefined} The cached value, or undefined if not found.
 */
export function get(key) {
    return requestCache.get(key);
}

/**
 * Stores a value in the cache.
 * @param {string} key - The key to store the value under.
 * @param {any} value - The value to store.
 */
export function set(key, value) {
    requestCache.set(key, value);
}

/**
 * Checks if a key exists in the cache.
 * @param {string} key - The key to check.
 * @returns {boolean} True if the key exists, false otherwise.
 */
export function has(key) {
    return requestCache.has(key);
}

/**
 * Clears the entire cache.
 */
export function clear() {
    requestCache.clear();
}

/**
 * Deletes a specific entry from the cache.
 * @param {string} key - The key to delete.
 * @returns {boolean} True if an element in the Map existed and has been removed, or false if the element does not exist.
 */
export function del(key) {
    return requestCache.delete(key);
}

console.log("Generic request cache module initialized.");

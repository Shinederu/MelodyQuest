export const createMemoryStorage = () => {
    const cache = new Map();
    return {
        getItem: (key) => cache.get(key) ?? null,
        setItem: (key, value) => {
            cache.set(key, value);
        },
        removeItem: (key) => {
            cache.delete(key);
        },
    };
};
export const createBrowserStorage = () => {
    if (typeof window === "undefined" || !window.localStorage) {
        return createMemoryStorage();
    }
    return {
        getItem: (key) => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value),
        removeItem: (key) => window.localStorage.removeItem(key),
    };
};
//# sourceMappingURL=storage.js.map
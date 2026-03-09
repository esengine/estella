import { getPlatform } from './platform/base';

const KEY_PREFIX = 'esengine:';

export const Storage = {
    getString(key: string, defaultValue?: string): string | undefined {
        const raw = getPlatform().getStorageItem(KEY_PREFIX + key);
        return raw !== null ? raw : defaultValue;
    },

    setString(key: string, value: string): void {
        getPlatform().setStorageItem(KEY_PREFIX + key, value);
    },

    getNumber(key: string, defaultValue?: number): number | undefined {
        const raw = getPlatform().getStorageItem(KEY_PREFIX + key);
        if (raw === null) return defaultValue;
        const num = Number(raw);
        return Number.isNaN(num) ? defaultValue : num;
    },

    setNumber(key: string, value: number): void {
        getPlatform().setStorageItem(KEY_PREFIX + key, String(value));
    },

    getBoolean(key: string, defaultValue?: boolean): boolean | undefined {
        const raw = getPlatform().getStorageItem(KEY_PREFIX + key);
        if (raw === null) return defaultValue;
        return raw === 'true';
    },

    setBoolean(key: string, value: boolean): void {
        getPlatform().setStorageItem(KEY_PREFIX + key, String(value));
    },

    getJSON<T>(key: string, defaultValue?: T): T | undefined {
        const raw = getPlatform().getStorageItem(KEY_PREFIX + key);
        if (raw === null) return defaultValue;
        try {
            return JSON.parse(raw) as T;
        } catch (e) {
            console.warn(`[Storage] Failed to parse JSON for key "${key}"`, e);
            return defaultValue;
        }
    },

    setJSON<T>(key: string, value: T): void {
        getPlatform().setStorageItem(KEY_PREFIX + key, JSON.stringify(value));
    },

    remove(key: string): void {
        getPlatform().removeStorageItem(KEY_PREFIX + key);
    },

    has(key: string): boolean {
        return getPlatform().getStorageItem(KEY_PREFIX + key) !== null;
    },

    clear(): void {
        getPlatform().clearStorage(KEY_PREFIX);
    },
};

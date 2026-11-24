// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { PlatformAdapter } from 'esengine';

interface SerializedStorage {
    load(): Promise<string>;
    save(data: string): Promise<void>;
}
interface AsyncStorageOptions {
    maxBytes: number;
    /** Best-effort milestone writes; callers await flushStorage for a result. */
    autoSave?: boolean;
    warn?(error: unknown): void;
}
type StorageAdapter = Pick<PlatformAdapter, 'getStorageItem' | 'setStorageItem' | 'removeStorageItem' | 'clearStorage' | 'flushStorage'>;

/** Loaded state remains local to this realm; only the host owns persistence. */
export function createAsyncStorage(source: SerializedStorage, options: AsyncStorageOptions) {
    let loaded = false;
    let loading: Promise<void> | null = null;
    let values: Record<string, string> = Object.create(null);
    let revision = 0, savedRevision = 0;
    let inFlight: Promise<void> | null = null;
    let autoSaving = false;
    const requireLoaded = () => { if (!loaded) throw new Error('Async storage unavailable: load must succeed before reading or writing'); };
    const encode = (items: Record<string, string>) => {
        const data = JSON.stringify({ version: 1, items });
        if (new TextEncoder().encode(data).byteLength > options.maxBytes) throw new Error('Async storage exceeds the host byte limit');
        return data;
    };
    async function flush(): Promise<void> {
        requireLoaded();
        const target = revision;
        while (savedRevision < target) {
            if (!inFlight) {
                const writingRevision = revision, data = encode(values);
                // Defer the host call until the shared promise is installed, even if it throws synchronously.
                inFlight = Promise.resolve().then(() => source.save(data)).then(() => {
                    savedRevision = writingRevision;
                }).finally(() => { inFlight = null; });
            }
            await inFlight;
        }
    }
    function schedule(): void {
        if (!options.autoSave || autoSaving) return;
        autoSaving = true;
        let succeeded = false;
        void Promise.resolve().then(flush).then(() => { succeeded = true; }, error => {
            try { options.warn?.(error); } catch { /* diagnostics cannot create unhandled save rejections */ }
        }).finally(() => {
            autoSaving = false;
            // Never spin on a failed save; a later mutation or explicit flush retries it.
            if (succeeded && revision > savedRevision) schedule();
        });
    }
    function mutate(change: (next: Record<string, string>) => boolean): void {
        requireLoaded();
        const next: Record<string, string> = Object.assign(Object.create(null), values);
        if (!change(next)) return;
        encode(next); values = next; revision++; schedule();
    }
    const adapter: StorageAdapter = {
        getStorageItem(key) { requireLoaded(); return values[key] ?? null; },
        setStorageItem(key, value) {
            if (typeof value !== 'string') throw new Error('Storage values must be strings');
            mutate(next => { if (next[key] === value) return false; next[key] = value; return true; });
        },
        removeStorageItem(key) {
            mutate(next => {
                if (!Object.hasOwn(next, key)) return false;
                delete next[key];
                return true;
            });
        },
        clearStorage(prefix) { mutate(next => {
            let changed = false;
            for (const key of Object.keys(next)) if (key.startsWith(prefix)) { delete next[key]; changed = true; }
            return changed;
        }); },
        flushStorage: flush,
    };
    return {
        adapter,
        get dirty(): boolean { return revision > savedRevision; },
        load(): Promise<void> {
            if (loaded) return Promise.resolve();
            if (loading) return loading;
            loading = Promise.resolve().then(() => source.load()).then(raw => {
                const parsed: unknown = raw === '' ? { version: 1, items: {} } : JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1
                    || Object.keys(parsed).some(key => key !== 'version' && key !== 'items')
                    || !('items' in parsed) || !parsed.items || typeof parsed.items !== 'object' || Array.isArray(parsed.items)
                    || Object.values(parsed.items).some(value => typeof value !== 'string')) {
                    throw new Error('Unsupported async storage envelope; existing host data was preserved');
                }
                const next: Record<string, string> = Object.assign(Object.create(null), parsed.items);
                encode(next); values = next; loaded = true;
            }).finally(() => { loading = null; });
            return loading;
        },
    };
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { RuntimeConfig } from '../defaults';
import { log } from '../util/logger';

interface PendingEntry<T> {
    promise: Promise<T>;
    aborted: boolean;
}

interface FailedEntry {
    error: Error;
    expiry: number;
}

export class AsyncCache<T> {
    private cache_ = new Map<string, T>();
    private pending_ = new Map<string, PendingEntry<T>>();
    private failed_ = new Map<string, FailedEntry>();

    /**
     * @param dispose_ Optional releaser for a value whose load finishes AFTER
     *   its getOrLoad already timed out — the caller got the timeout rejection,
     *   so that late value has no owner and would otherwise leak (e.g. a GL
     *   texture created past the deadline). NOT called for
     *   invalidate()/clearAll(), whose in-flight results still reach the caller.
     */
    constructor(private dispose_?: (value: T) => void) {}

    async getOrLoad(key: string, loader: () => Promise<T>, timeout = RuntimeConfig.assetLoadTimeout): Promise<T> {
        const cached = this.cache_.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const failed = this.failed_.get(key);
        if (failed && Date.now() < failed.expiry) {
            throw failed.error;
        }
        this.failed_.delete(key);

        const existing = this.pending_.get(key);
        if (existing && !existing.aborted) {
            return existing.promise;
        }

        const entry: PendingEntry<T> = { promise: null!, aborted: false };

        entry.promise = (async () => {
            const loaderPromise = loader();

            if (timeout <= 0) {
                const result = await loaderPromise;
                if (!entry.aborted) this.cache_.set(key, result);
                this.clearPendingIfCurrent_(key, entry);
                return result;
            }

            let timedOut = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            // The loader keeps running even when the deadline wins the race. If
            // it produces a value after timing out, that value has no owner —
            // release it so it doesn't leak.
            void loaderPromise.then(
                (late) => { if (timedOut) this.disposeAbandoned_(key, late); },
                () => { /* loader rejected — nothing to release */ },
            );

            const result = await Promise.race([
                loaderPromise,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        timedOut = true;
                        entry.aborted = true;
                        reject(new Error(`AsyncCache timeout: ${key} (${timeout}ms)`));
                    }, timeout);
                }),
            ]);

            // Loader won the race: cancel the deadline so it can't abort after
            // the fact, then cache (unless invalidate() aborted it in-flight).
            clearTimeout(timer);
            if (!entry.aborted) this.cache_.set(key, result);
            this.clearPendingIfCurrent_(key, entry);
            return result;
        })();

        this.pending_.set(key, entry);

        try {
            return await entry.promise;
        } catch (err) {
            // Only the request the map still points at may write the shared
            // records: if a newer load owns the key now, this failure is about
            // bytes nobody asked for any more.
            const current = this.pending_.get(key) === entry;
            if (current) {
                this.pending_.delete(key);
                if (err instanceof Error) {
                    this.failed_.set(key, { error: err, expiry: Date.now() + RuntimeConfig.assetFailureCooldown });
                }
            }
            if (err instanceof Error && err.message.startsWith('AsyncCache timeout:')) {
                log.warn('asset', err.message);
            }
            throw err;
        }
    }

    /**
     * Drop this key's pending record only if it is still THIS request's. A load
     * that finishes after invalidate() replaced it would otherwise delete its
     * successor's record, and the next getOrLoad would start a third load of the
     * same asset instead of joining the second.
     */
    private clearPendingIfCurrent_(key: string, entry: PendingEntry<T>): void {
        if (this.pending_.get(key) === entry) this.pending_.delete(key);
    }

    /** Release a value that was abandoned by a timeout; never throws upward. */
    private disposeAbandoned_(key: string, value: T): void {
        if (!this.dispose_) return;
        try {
            this.dispose_(value);
        } catch (e) {
            log.warn('asset', `AsyncCache: releasing abandoned "${key}" threw`, e);
        }
    }

    get(key: string): T | undefined {
        return this.cache_.get(key);
    }

    has(key: string): boolean {
        return this.cache_.has(key);
    }

    delete(key: string): boolean {
        return this.cache_.delete(key);
    }

    /**
     * Drop every record of `key` — resolved value, failure cooldown, and
     * any in-flight loader. Used by hot-reload when the underlying bytes
     * changed on disk and the next `getOrLoad` must fetch fresh.
     *
     * Returns true if any record was removed. Doesn't release whatever
     * resource the cached value points to — that's the caller's concern
     * (see `Assets.invalidate` for the resource-aware variant).
     */
    invalidate(key: string): boolean {
        const hadCached = this.cache_.delete(key);
        const hadFailed = this.failed_.delete(key);
        const pending = this.pending_.get(key);
        if (pending) {
            pending.aborted = true;
            this.pending_.delete(key);
        }
        return hadCached || hadFailed || pending !== undefined;
    }

    clear(): void {
        this.cache_.clear();
    }

    clearAll(): void {
        this.cache_.clear();
        this.failed_.clear();
        for (const entry of this.pending_.values()) {
            entry.aborted = true;
        }
        this.pending_.clear();
    }

    /** Re-file a value under `key`, for a sweep that removed it to force a reload. */
    set(key: string, value: T): void {
        this.cache_.set(key, value);
    }

    /**
     * Key/value pairs of what is resolved. `values()` is not enough for a sweep
     * that has to RELOAD each entry: the key is what names the asset.
     */
    entries(): IterableIterator<[string, T]> {
        return this.cache_.entries();
    }

    values(): IterableIterator<T> {
        return this.cache_.values();
    }

    /**
     * @internal Entry counts for the resource census.
     *
     * `pending` is the one to watch: it should be empty at rest, so a non-zero
     * value between cycles means a load never settled — and a load that never
     * settles holds its callbacks, its buffers and whatever closed over them.
     */
    sizes(): { cached: number; pending: number; failed: number } {
        return { cached: this.cache_.size, pending: this.pending_.size, failed: this.failed_.size };
    }
}

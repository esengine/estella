// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { RuntimeConfig } from '../defaults';
import { log } from '../logger';

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
                this.pending_.delete(key);
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
            this.pending_.delete(key);
            return result;
        })();

        this.pending_.set(key, entry);

        try {
            return await entry.promise;
        } catch (err) {
            this.pending_.delete(key);
            if (err instanceof Error) {
                this.failed_.set(key, { error: err, expiry: Date.now() + RuntimeConfig.assetFailureCooldown });
                if (err.message.startsWith('AsyncCache timeout:')) {
                    log.warn('asset', err.message);
                }
            }
            throw err;
        }
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

    values(): IterableIterator<T> {
        return this.cache_.values();
    }
}

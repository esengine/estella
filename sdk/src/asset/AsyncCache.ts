// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { RuntimeConfig } from '../defaults';
import { log } from '../util/logger';
import { reservePromise } from '../util/reservePromise';
import { preparationFailureReason } from './dependencies';

export { reservePromise as reserveLoad };

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

    /** Current cooldown rejections; expired records retain no failure metadata. */
    /** @internal Failed preparation provenance for source invalidation. */
    *failures(): Generator<[string, Error]> {
        const now = Date.now();
        for (const [key, failure] of this.failed_) {
            if (failure.expiry <= now) { this.failed_.delete(key); continue; }
            yield [key, failure.error];
        }
    }

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

        const existing = this.pendingRequest(key);
        if (existing) return existing;

        const pending = reservePromise<T>();
        const entry: PendingEntry<T> = { promise: pending.promise, aborted: false };
        this.pending_.set(key, entry);
        pending.resolve(this.load_(key, loader, timeout, entry));
        return pending.promise;
    }

    /** The request another caller can join, including during synchronous loader setup. */
    protected pendingRequest(key: string): Promise<T> | undefined {
        const entry = this.pending_.get(key);
        return entry && !entry.aborted ? entry.promise : undefined;
    }

    private async load_(key: string, loader: () => Promise<T>, timeout: number, entry: PendingEntry<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const loading = loader();
            let result: T;
            if (timeout <= 0) {
                result = await loading;
            } else {
                let timedOut = false;
                // A loader can produce a resource after the deadline has rejected all its callers.
                void loading.then(
                    value => { if (timedOut) this.disposeAbandoned_(key, value); },
                    () => { /* A rejected loader has no resource to release. */ },
                );
                const deadline = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        timedOut = true;
                        entry.aborted = true;
                        reject(new Error(`AsyncCache timeout: ${key} (${timeout}ms)`));
                    }, timeout);
                });
                result = await Promise.race([loading, deadline]);
            }
            if (!entry.aborted) this.cache_.set(key, result);
            return result;
        } catch (err) {
            if (this.pending_.get(key) === entry && err instanceof Error && preparationFailureReason(err) instanceof Error) {
                this.failed_.set(key, { error: err, expiry: Date.now() + RuntimeConfig.assetFailureCooldown });
            }
            if (err instanceof Error && err.message.startsWith('AsyncCache timeout:')) {
                log.warn('asset', err.message);
            }
            throw err;
        } finally {
            if (timer !== undefined) clearTimeout(timer);
            // A load superseded during setup or an await cannot retire its successor.
            if (this.pending_.get(key) === entry) this.pending_.delete(key);
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

import { RuntimeConfig } from '../defaults';

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

            const result = await (timeout > 0
                ? Promise.race([
                    loaderPromise,
                    new Promise<never>((_, reject) =>
                        setTimeout(() => {
                            entry.aborted = true;
                            reject(new Error(`AsyncCache timeout: ${key} (${timeout}ms)`));
                        }, timeout)
                    ),
                ])
                : loaderPromise);

            if (!entry.aborted) {
                this.cache_.set(key, result);
            }
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
                    console.warn(`[AsyncCache] ${err.message}`);
                }
            }
            throw err;
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

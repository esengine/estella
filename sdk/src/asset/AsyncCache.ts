export class AsyncCache<T> {
    private cache_ = new Map<string, T>();
    private pending_ = new Map<string, Promise<T>>();

    async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
        const cached = this.cache_.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const pending = this.pending_.get(key);
        if (pending) {
            return pending;
        }

        const promise = loader();
        this.pending_.set(key, promise);

        try {
            const result = await promise;
            this.cache_.set(key, result);
            return result;
        } finally {
            this.pending_.delete(key);
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

    values(): IterableIterator<T> {
        return this.cache_.values();
    }
}

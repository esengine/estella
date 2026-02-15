import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsyncCache } from '../src/asset/AsyncCache';

describe('AsyncCache', () => {
    let cache: AsyncCache<string>;

    beforeEach(() => {
        cache = new AsyncCache<string>();
    });

    describe('basic caching', () => {
        it('should cache successful results', async () => {
            const loader = vi.fn().mockResolvedValue('value');

            const result1 = await cache.getOrLoad('key', loader);
            const result2 = await cache.getOrLoad('key', loader);

            expect(result1).toBe('value');
            expect(result2).toBe('value');
            expect(loader).toHaveBeenCalledTimes(1);
        });

        it('should return cached value immediately', async () => {
            await cache.getOrLoad('key', async () => 'value');

            const loader = vi.fn();
            const result = await cache.getOrLoad('key', loader);

            expect(result).toBe('value');
            expect(loader).not.toHaveBeenCalled();
        });

        it('should cache multiple different keys', async () => {
            await cache.getOrLoad('key1', async () => 'value1');
            await cache.getOrLoad('key2', async () => 'value2');

            expect(await cache.getOrLoad('key1', async () => 'wrong')).toBe('value1');
            expect(await cache.getOrLoad('key2', async () => 'wrong')).toBe('value2');
        });
    });

    describe('pending promise deduplication', () => {
        it('should deduplicate concurrent requests', async () => {
            const loader = vi.fn().mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'value';
            });

            const [result1, result2, result3] = await Promise.all([
                cache.getOrLoad('key', loader),
                cache.getOrLoad('key', loader),
                cache.getOrLoad('key', loader),
            ]);

            expect(result1).toBe('value');
            expect(result2).toBe('value');
            expect(result3).toBe('value');
            expect(loader).toHaveBeenCalledTimes(1);
        });

        it('should handle concurrent requests for different keys', async () => {
            const loader1 = vi.fn().mockResolvedValue('value1');
            const loader2 = vi.fn().mockResolvedValue('value2');

            const [result1, result2] = await Promise.all([
                cache.getOrLoad('key1', loader1),
                cache.getOrLoad('key2', loader2),
            ]);

            expect(result1).toBe('value1');
            expect(result2).toBe('value2');
            expect(loader1).toHaveBeenCalledTimes(1);
            expect(loader2).toHaveBeenCalledTimes(1);
        });
    });

    describe('error handling', () => {
        it('should propagate errors from loader', async () => {
            const error = new Error('load failed');
            const loader = vi.fn().mockRejectedValue(error);

            await expect(cache.getOrLoad('key', loader)).rejects.toThrow('load failed');
        });

        it('should NOT cache failed promises', async () => {
            const loader = vi.fn()
                .mockRejectedValueOnce(new Error('first failure'))
                .mockResolvedValueOnce('success');

            await expect(cache.getOrLoad('key', loader)).rejects.toThrow('first failure');

            const result = await cache.getOrLoad('key', loader);
            expect(result).toBe('success');
            expect(loader).toHaveBeenCalledTimes(2);
        });

        it('should remove from pending on failure', async () => {
            const loader = vi.fn().mockRejectedValue(new Error('failed'));

            await expect(cache.getOrLoad('key', loader)).rejects.toThrow('failed');

            const newLoader = vi.fn().mockResolvedValue('success');
            await cache.getOrLoad('key', newLoader);

            expect(newLoader).toHaveBeenCalled();
        });

        it('should handle concurrent failures correctly', async () => {
            const error = new Error('concurrent failure');
            const loader = vi.fn().mockRejectedValue(error);

            const promises = [
                cache.getOrLoad('key', loader),
                cache.getOrLoad('key', loader),
                cache.getOrLoad('key', loader),
            ];

            for (const promise of promises) {
                await expect(promise).rejects.toThrow('concurrent failure');
            }

            expect(loader).toHaveBeenCalledTimes(1);
        });

        it('should handle timeout', async () => {
            const loader = vi.fn().mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return 'value';
            });

            await expect(cache.getOrLoad('key', loader, 10)).rejects.toThrow('AsyncCache timeout');
        });
    });

    describe('has', () => {
        it('should return false for uncached keys', () => {
            expect(cache.has('key')).toBe(false);
        });

        it('should return true for cached keys', async () => {
            await cache.getOrLoad('key', async () => 'value');
            expect(cache.has('key')).toBe(true);
        });

        it('should return false for pending keys', () => {
            cache.getOrLoad('key', async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return 'value';
            });

            expect(cache.has('key')).toBe(false);
        });

        it('should return false for failed keys', async () => {
            await expect(
                cache.getOrLoad('key', async () => { throw new Error('fail'); })
            ).rejects.toThrow();

            expect(cache.has('key')).toBe(false);
        });
    });

    describe('get', () => {
        it('should return undefined for uncached keys', () => {
            expect(cache.get('key')).toBeUndefined();
        });

        it('should return cached value', async () => {
            await cache.getOrLoad('key', async () => 'value');
            expect(cache.get('key')).toBe('value');
        });
    });

    describe('delete', () => {
        it('should remove cached entries', async () => {
            await cache.getOrLoad('key', async () => 'value');
            cache.delete('key');

            const loader = vi.fn().mockResolvedValue('new value');
            await cache.getOrLoad('key', loader);

            expect(loader).toHaveBeenCalled();
        });

        it('should handle deleting non-existent keys', () => {
            expect(cache.delete('nonexistent')).toBe(false);
        });

        it('should not affect pending promises', async () => {
            const loader = vi.fn().mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'value';
            });

            const promise = cache.getOrLoad('key', loader);
            cache.delete('key');

            const result = await promise;
            expect(result).toBe('value');
        });
    });

    describe('clear', () => {
        it('should remove all cached entries', async () => {
            await cache.getOrLoad('key1', async () => 'value1');
            await cache.getOrLoad('key2', async () => 'value2');

            cache.clear();

            expect(cache.has('key1')).toBe(false);
            expect(cache.has('key2')).toBe(false);
        });

        it('should not affect pending promises', async () => {
            const loader = vi.fn().mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'value';
            });

            const promise = cache.getOrLoad('key', loader);
            cache.clear();

            const result = await promise;
            expect(result).toBe('value');
        });
    });

    describe('clearAll', () => {
        it('should abort pending promises', async () => {
            const loader = vi.fn().mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return 'value';
            });

            const promise = cache.getOrLoad('key', loader);
            cache.clearAll();

            await expect(promise).resolves.toBe('value');
            expect(cache.has('key')).toBe(false);
        });
    });

    describe('complex scenarios', () => {
        it('should handle mixed success and failure', async () => {
            await cache.getOrLoad('success', async () => 'ok');
            await expect(
                cache.getOrLoad('failure', async () => { throw new Error('bad'); })
            ).rejects.toThrow();

            expect(cache.has('success')).toBe(true);
            expect(cache.has('failure')).toBe(false);
        });

        it('should handle retry after failure', async () => {
            const loader = vi.fn()
                .mockRejectedValueOnce(new Error('temp failure'))
                .mockResolvedValueOnce('success');

            await expect(cache.getOrLoad('key', loader)).rejects.toThrow('temp failure');
            const result = await cache.getOrLoad('key', loader);

            expect(result).toBe('success');
            expect(cache.has('key')).toBe(true);
        });
    });
});

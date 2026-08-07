// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AsyncCache-race.test.ts
 * @brief   A load that finishes after it stopped being the current one must not
 *          write the shared records.
 *
 *          invalidate() aborts the in-flight load and drops its pending record,
 *          and hot reload immediately asks for the same key again — so a second
 *          load is registered under it. The first one then finished and deleted
 *          `pending[key]` without checking whose record that now was, evicting
 *          the second load's; the next request saw no pending entry and started a
 *          THIRD load of the same asset. On the failure path it also wrote the
 *          cooldown, so a dead request's error rejected callers waiting on bytes
 *          that had already been replaced. A timeout leaves the same window.
 *
 *          Every case here drives the interleaving by hand — no real timers on
 *          the load path, no sleeps — so the ordering is the test, not the luck.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsyncCache } from '../src/asset/AsyncCache';
import { RuntimeConfig } from '../src/defaults';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** Let every already-queued microtask run before asserting. */
const settle = () => new Promise<void>(r => setTimeout(r, 0));

describe('a superseded load does not write the current one\'s records', () => {
    let cache: AsyncCache<string>;

    beforeEach(() => {
        cache = new AsyncCache<string>();
    });

    it('finishing after invalidate() leaves the newer load joinable', async () => {
        const first = deferred<string>();
        const second = deferred<string>();

        const a = cache.getOrLoad('k', () => first.promise);
        cache.invalidate('k');

        const loaderB = vi.fn(() => second.promise);
        const b = cache.getOrLoad('k', loaderB);

        first.resolve('old bytes');
        await expect(a).resolves.toBe('old bytes');   // the caller still gets its value
        await settle();

        // If the stale load evicted B's pending record, this starts a third load.
        const loaderC = vi.fn(() => deferred<string>().promise);
        const c = cache.getOrLoad('k', loaderC);
        expect(loaderC).not.toHaveBeenCalled();

        second.resolve('new bytes');
        await expect(b).resolves.toBe('new bytes');
        await expect(c).resolves.toBe('new bytes');
        expect(loaderB).toHaveBeenCalledTimes(1);
    });

    it('a superseded load does not cache its value', async () => {
        const first = deferred<string>();
        const a = cache.getOrLoad('k', () => first.promise);
        cache.invalidate('k');

        first.resolve('old bytes');
        await a;
        await settle();

        expect(cache.get('k')).toBeUndefined();
    });

    it('failing after invalidate() does not put the key in cooldown', async () => {
        const first = deferred<string>();
        const second = deferred<string>();

        const a = cache.getOrLoad('k', () => first.promise);
        cache.invalidate('k');
        const b = cache.getOrLoad('k', () => second.promise);

        first.reject(new Error('stale failure'));
        await expect(a).rejects.toThrow('stale failure');
        await settle();

        // The replacement must still be able to succeed, and a later request must
        // not be rejected with the dead load's error.
        const c = cache.getOrLoad('k', () => deferred<string>().promise);
        second.resolve('new bytes');
        await expect(b).resolves.toBe('new bytes');
        await expect(c).resolves.toBe('new bytes');
        expect(cache.get('k')).toBe('new bytes');
    });

    it('failing after invalidate() with no replacement leaves no cooldown', async () => {
        const first = deferred<string>();
        const a = cache.getOrLoad('k', () => first.promise);
        cache.invalidate('k');

        first.reject(new Error('stale failure'));
        await expect(a).rejects.toThrow('stale failure');
        await settle();

        // invalidate() cleared the failure record; the dead load must not restore it.
        const retry = deferred<string>();
        const b = cache.getOrLoad('k', () => retry.promise);
        retry.resolve('fresh');
        await expect(b).resolves.toBe('fresh');
    });

    it('the same window opens on timeout, not only on invalidate', async () => {
        vi.useFakeTimers();
        // The timeout's own cooldown would refuse the retry before it could reach
        // the window this is about; the window outlives the cooldown in real use.
        const original = RuntimeConfig.assetFailureCooldown;
        RuntimeConfig.assetFailureCooldown = 0;
        try {
            const first = deferred<string>();
            const a = cache.getOrLoad('k', () => first.promise, 10);
            const rejected = expect(a).rejects.toThrow('AsyncCache timeout');

            // Synchronous: fires the deadline without flushing microtasks, so the
            // request has aborted but its catch has not run. That is the window —
            // a retry registers under the key before the dead one cleans up.
            vi.advanceTimersByTime(20);

            const second = deferred<string>();
            const loaderB = vi.fn(() => second.promise);
            const b = cache.getOrLoad('k', loaderB, 0);
            expect(loaderB).toHaveBeenCalledTimes(1);

            await rejected;              // now the dead request's catch runs
            first.resolve('late bytes'); // and its loader lands even later
            await vi.advanceTimersByTimeAsync(0);  // settle() would hang on fake timers

            const loaderC = vi.fn(() => deferred<string>().promise);
            const c = cache.getOrLoad('k', loaderC, 0);
            expect(loaderC).not.toHaveBeenCalled();

            second.resolve('new bytes');
            await expect(b).resolves.toBe('new bytes');
            await expect(c).resolves.toBe('new bytes');
        } finally {
            RuntimeConfig.assetFailureCooldown = original;
            vi.useRealTimers();
        }
    });

    it('a timeout that was never superseded still writes the cooldown', async () => {
        vi.useFakeTimers();
        const original = RuntimeConfig.assetFailureCooldown;
        RuntimeConfig.assetFailureCooldown = 5000;
        try {
            const first = deferred<string>();
            const a = cache.getOrLoad('k', () => first.promise, 10);
            const rejected = expect(a).rejects.toThrow('AsyncCache timeout');
            await vi.advanceTimersByTimeAsync(20);
            await rejected;

            // Still inside the cooldown: the next request is refused without
            // touching the loader.
            const loader = vi.fn(() => deferred<string>().promise);
            await expect(cache.getOrLoad('k', loader, 0)).rejects.toThrow('AsyncCache timeout');
            expect(loader).not.toHaveBeenCalled();
        } finally {
            RuntimeConfig.assetFailureCooldown = original;
            vi.useRealTimers();
        }
    });

    it('a value abandoned by timeout is still released', async () => {
        vi.useFakeTimers();
        try {
            const dispose = vi.fn();
            const disposing = new AsyncCache<string>(dispose);
            const first = deferred<string>();

            const a = disposing.getOrLoad('k', () => first.promise, 10);
            const rejected = expect(a).rejects.toThrow('AsyncCache timeout');
            await vi.advanceTimersByTimeAsync(20);
            await rejected;

            first.resolve('late bytes');
            await vi.advanceTimersByTimeAsync(0);
            expect(dispose).toHaveBeenCalledWith('late bytes');
        } finally {
            vi.useRealTimers();
        }
    });
});

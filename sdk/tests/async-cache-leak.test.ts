// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    async-cache-leak.test.ts
 * @brief   When a load times out, the loader
 *          keeps running; its late result used to be dropped on the floor (the
 *          caller already got the timeout rejection), leaking whatever it had
 *          allocated (e.g. a GL texture = VRAM). AsyncCache now releases such
 *          abandoned values via an optional disposer.
 */
import { describe, expect, it } from 'vitest';
import { AsyncCache } from '../src/asset/AsyncCache';

const after = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AsyncCache abandoned-load disposal', () => {
    it('disposes a value whose load finishes AFTER the timeout', async () => {
        const disposed: number[] = [];
        const cache = new AsyncCache<number>((v) => disposed.push(v));
        const LATE = 42;
        const loader = () => new Promise<number>((res) => setTimeout(() => res(LATE), 40));

        await expect(cache.getOrLoad('k', loader, 10)).rejects.toThrow(/AsyncCache timeout/);
        expect(disposed).toEqual([]); // loader still in flight

        await after(60); // let the loader resolve past its (abandoned) deadline
        expect(disposed).toEqual([LATE]); // released, not leaked
        expect(cache.has('k')).toBe(false); // and never cached
    });

    it('caches and does NOT dispose when the load beats the timeout', async () => {
        const disposed: number[] = [];
        const cache = new AsyncCache<number>((v) => disposed.push(v));

        const result = await cache.getOrLoad('k', () => Promise.resolve(7), 1000);

        expect(result).toBe(7);
        expect(cache.get('k')).toBe(7);
        await after(5);
        expect(disposed).toEqual([]);
    });

    it('does not dispose (or surface an unhandled rejection) when the loader fails late', async () => {
        const disposed: number[] = [];
        const cache = new AsyncCache<number>((v) => disposed.push(v));
        const loader = () => new Promise<number>((_, rej) => setTimeout(() => rej(new Error('late fail')), 40));

        await expect(cache.getOrLoad('k', loader, 10)).rejects.toThrow(/AsyncCache timeout/);
        await after(60); // the late loader rejection must be swallowed, nothing released
        expect(disposed).toEqual([]);
    });

    it('works without a disposer (no-op release, still no caching of the abandoned value)', async () => {
        const cache = new AsyncCache<number>(); // no disposer
        const loader = () => new Promise<number>((res) => setTimeout(() => res(1), 40));

        await expect(cache.getOrLoad('k', loader, 10)).rejects.toThrow(/AsyncCache timeout/);
        await after(60);
        expect(cache.has('k')).toBe(false);
    });
});

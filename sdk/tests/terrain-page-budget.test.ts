// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { makePage, makePageJob, PAGE_SIDE, type PageImage } from '../src/terrain/pages';
import { noiseProvider, ProviderSource } from '../src/terrain/provider';
import type { TerrainSource } from '../src/terrain/source';

describe('incremental terrain pages', () => {
    it('pauses during both height sampling and biome painting, not only between whole pages', () => {
        let heights = 0, paints = 0;
        const source: TerrainSource = { infinite: true, bounds: null, minHeight: 0, maxHeight: 100,
            height: (x, z) => { heights++; return 20 + x * 0.1 + z * 0.05; },
            normal: () => [0, 1, 0], paint: () => [1, 0, 0, 0] };
        const job = makePageJob(source, 0, 0, 64, (_x, _z, _h, _up, w) => { paints++; return w; });
        expect(heights).toBe(0);
        let lastHeight = 0, lastPaint = 0, progress = 0, turns = 0;
        for (;;) {
            const next = job.next(); turns++;
            expect(heights - lastHeight).toBeLessThanOrEqual(32);
            expect(paints - lastPaint).toBeLessThanOrEqual(32);
            lastHeight = heights; lastPaint = paints;
            if (next.done) { expect(next.value.min).toBeGreaterThan(19); break; }
            expect(next.value).toBeGreaterThanOrEqual(progress); progress = next.value;
        }
        expect(heights).toBe(PAGE_SIDE ** 2);
        expect(paints).toBe(PAGE_SIDE ** 2);
        expect(turns).toBeGreaterThan(250);
    });

    it('matches the built-in provider region path byte for byte, including repaint and edge normals', () => {
        const provider = noiseProvider(() => ({ seed: 4, frequency: 3, octaves: 5, persistence: 0.5, ridged: 0.3,
            warp: 0.35, erosion: 1, sizeX: 4200, height: 520, rockSlope: 0.34, dirtHeight: 0.74, snowHeight: 0.95 }));
        const source = new ProviderSource(provider, 'demo', 4, 1, 120, -30, 4, (_h, up) => [up, 1 - up, 0, 0]);
        const repaint = (x: number, z: number, _h: number, _up: number, w: readonly number[]) => [w[0]!, w[1]!, (Math.sin(x + z) + 1) / 2, 0];
        const expected = makePage(source, -32, 64, 128, repaint) as PageImage;
        const job = makePageJob(source, -32, 64, 128, repaint);
        for (;;) {
            const next = job.next();
            if (next.done) { expect(next.value).toEqual(expected); break; }
        }
    });

    it('abandoning an obsolete page performs no further source queries', () => {
        let calls = 0;
        const source: TerrainSource = { infinite: true, bounds: null, minHeight: 0, maxHeight: 10,
            height: () => { calls++; return 5; }, normal: () => [0, 1, 0], paint: () => [1, 0, 0, 0] };
        const job = makePageJob(source, 0, 0, 64);
        job.next(); const before = calls;
        job.return(undefined as never);
        expect(job.next().done).toBe(true);
        expect(calls).toBe(before);
    });
});

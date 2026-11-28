// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { FACES, direction, facePlace, faceOf } from '../src/terrain/sphere';
import { tileOf } from '../src/terrain/planetCollision';
import { buildPatchMesh } from '../src/terrain/patch';
import { PATCH_CELLS } from '../src/terrain/pages';
import type { PlanetPageSource } from '../src/terrain/planetPages';

const radius = 4000;
/** Ground that is a function of the direction alone: a gentle swell, so a shared edge can only agree if it samples the same directions. */
const src = {
    provider: {
        id: 't', versions: [1], range: () => [-10, 10],
        sample: (r: { directions: Float32Array; count: number }) => {
            const heights = new Float32Array(r.count);
            for (let i = 0; i < r.count; i++) heights[i] = 8 * Math.sin(r.directions[i * 3]! * 9) * Math.cos(r.directions[i * 3 + 1]! * 7 + r.directions[i * 3 + 2]! * 5);
            return { heights };
        },
    },
    world: 'w', seed: 1, version: 1, radius, levels: 8, minHeight: -10, maxHeight: 10,
} as unknown as PlanetPageSource;

describe('a planet\'s collision tiles', () => {
    it('are wound to face out on every face', () => {
        const patch = buildPatchMesh(PATCH_CELLS, true);
        for (let face = 0; face < 6; face++) {
            const tile = tileOf(src, { face, level: 0, ix: 3, iz: 5 }, 'k') as Awaited<ReturnType<typeof tileOf>>;
            expect(tile.indices).toEqual(patch.indices);
            const p = tile.positions, i = tile.indices;
            let facing = 0;
            for (let t = 0; t < i.length; t += 3) {
                const a = i[t]! * 3, b = i[t + 1]! * 3, c = i[t + 2]! * 3;
                const e1 = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!], e2 = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
                const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
                const out = [tile.origin[0] + p[a]!, tile.origin[1] + p[a + 1]!, tile.origin[2] + p[a + 2]!];
                if (n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]! > 0) facing++;
            }
            expect(facing).toBe(i.length / 3);
        }
    });

    it('put every point at the radius plus the ground\'s height', () => {
        const tile = tileOf(src, { face: 2, level: 0, ix: 10, iz: 20 }, 'k') as Awaited<ReturnType<typeof tileOf>>;
        for (let q = 0; q < tile.positions.length / 3; q++) {
            const r = Math.hypot(tile.origin[0] + tile.positions[q * 3]!, tile.origin[1] + tile.positions[q * 3 + 1]!, tile.origin[2] + tile.positions[q * 3 + 2]!);
            expect(Math.abs(r - radius)).toBeLessThanOrEqual(10.01);
        }
    });

    it('share the edge two neighbours meet at', () => {
        const a = tileOf(src, { face: 4, level: 0, ix: 3, iz: 5 }, 'a') as Awaited<ReturnType<typeof tileOf>>;
        const b = tileOf(src, { face: 4, level: 0, ix: 4, iz: 5 }, 'b') as Awaited<ReturnType<typeof tileOf>>;
        const n = 33;
        for (let j = 0; j < n; j++) {
            for (let c = 0; c < 3; c++) {
                const left = a.origin[c]! + a.positions[(j * n + n - 1) * 3 + c]!, right = b.origin[c]! + b.positions[(j * n) * 3 + c]!;
                expect(Math.abs(left - right)).toBeLessThan(2e-3);
            }
        }
    });
});

describe('where a direction falls on a face', () => {
    it('is faceOf for the face it is on, and nothing for a face turned away', () => {
        const d = direction(3, 0.3, -0.4);
        const on = faceOf(d[0], d[1], d[2]);
        const place = facePlace(on.face, d[0], d[1], d[2])!;
        expect(place.u).toBeCloseTo(on.u, 9);
        expect(place.v).toBeCloseTo(on.v, 9);
        const back = FACES[on.face]!.normal;
        expect(facePlace(on.face, -back[0], -back[1], -back[2])).toBeNull();
    });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The tree the baker traverses answers what testing every triangle answers.
 *
 * A traversal that walks into the wrong subtree still returns hits, just the
 * wrong ones — a shadow that leaks, a bounce that never arrives. So it is held
 * against BRUTE FORCE, on scenes deep enough for a wrong child index to matter.
 */
import { describe, expect, it } from 'vitest';
import { Bvh, type TriangleSoup } from '../src/lightmap/bvh';

/** A deterministic pseudo-random source: a failing case has to be reproducible. */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** `count` random triangles inside a box, as the soup the baker builds. */
function soup(count: number, seed: number): TriangleSoup {
    const next = rng(seed);
    const positions = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
        const cx = next() * 600 - 300, cy = next() * 600 - 300, cz = next() * 600 - 300;
        for (let v = 0; v < 3; v++) {
            positions[i * 9 + v * 3] = cx + (next() - 0.5) * 120;
            positions[i * 9 + v * 3 + 1] = cy + (next() - 0.5) * 120;
            positions[i * 9 + v * 3 + 2] = cz + (next() - 0.5) * 120;
        }
    }
    return { positions, count };
}

/** Möller–Trumbore against every triangle: the answer the tree has to reproduce. */
function brute(tris: TriangleSoup, o: number[], d: number[], far: number): number {
    let best = -1;
    let bestT = far;
    for (let i = 0; i < tris.count; i++) {
        const p = tris.positions;
        const a = i * 9;
        const e1 = [p[a + 3] - p[a], p[a + 4] - p[a + 1], p[a + 5] - p[a + 2]];
        const e2 = [p[a + 6] - p[a], p[a + 7] - p[a + 1], p[a + 8] - p[a + 2]];
        const h = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!,
                   d[0]! * e2[1]! - d[1]! * e2[0]!];
        const det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det;
        const s = [o[0]! - p[a], o[1]! - p[a + 1], o[2]! - p[a + 2]];
        const u = inv * (s[0]! * h[0]! + s[1]! * h[1]! + s[2]! * h[2]!);
        if (u < 0 || u > 1) continue;
        const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!,
                   s[0]! * e1[1]! - s[1]! * e1[0]!];
        const v = inv * (d[0]! * q[0]! + d[1]! * q[1]! + d[2]! * q[2]!);
        if (v < 0 || u + v > 1) continue;
        const t = inv * (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!);
        if (t <= 0 || t >= bestT) continue;
        bestT = t;
        best = i;
    }
    return best;
}

describe('the bake\'s ray tree', () => {
    it('finds what testing every triangle finds', () => {
        const tris = soup(400, 7);
        const bvh = new Bvh(tris);
        const next = rng(99);
        let asked = 0;
        let agreed = 0;
        const missed: string[] = [];
        for (let i = 0; i < 600; i++) {
            const o = [next() * 800 - 400, next() * 800 - 400, next() * 800 - 400];
            // Uniform over the sphere, so no axis is under-asked — a traversal can
            // be wrong in one direction and right in the others.
            const z = next() * 2 - 1;
            const a = next() * Math.PI * 2;
            const r = Math.sqrt(Math.max(0, 1 - z * z));
            const d = [r * Math.cos(a), z, r * Math.sin(a)];
            const want = brute(tris, o, d, 1e7);
            const got = bvh.hit(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, 1e7, 0);
            asked++;
            if (want === got) agreed++;
            else if (missed.length < 4) {
                missed.push(`from ${o.map((v) => v.toFixed(0))} along ${d.map((v) => v.toFixed(2))}`
                    + `: brute force says ${want}, the tree says ${got}`);
            }
        }
        expect(`${agreed}/${asked} agree${missed.length ? `\n  ${missed.join('\n  ')}` : ''}`)
            .toBe(`${asked}/${asked} agree`);
    });

    it('blocks a segment exactly where a triangle is in it', () => {
        const tris = soup(200, 3);
        const bvh = new Bvh(tris);
        const next = rng(5);
        for (let i = 0; i < 300; i++) {
            const o = [next() * 800 - 400, next() * 800 - 400, next() * 800 - 400];
            const z = next() * 2 - 1;
            const a = next() * Math.PI * 2;
            const r = Math.sqrt(Math.max(0, 1 - z * z));
            const d = [r * Math.cos(a), z, r * Math.sin(a)];
            const want = brute(tris, o, d, 500) >= 0;
            expect(bvh.occluded(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, 500, 0)).toBe(want);
        }
    });
});

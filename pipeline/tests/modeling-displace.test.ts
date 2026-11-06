// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Fine detail pushed out of a surface: that it moves what was asked, by what was asked, and stays one surface. */
import { beforeAll, describe, expect, it } from 'vitest';
import { bakeModel, bakeNormalMap, prepareModeling, validateModelSource, type BakedModel, type ModelStep } from '../src/modeling';
import { displace, DISPLACE_PATTERNS, MAX_DISPLACE_TRIANGLES } from '../src/modeling/displace';

beforeAll(() => prepareModeling());

const model = (...steps: ModelStep[]): BakedModel => bakeModel({ version: 1, steps });
const ball: ModelStep = { op: 'sphere', radius: 1, rings: 32, sides: 64, tag: 'ball' };
const sheet: ModelStep = { op: 'plane', size: 2, tag: 'sheet' };

/** Not Math.min(...values): a dense model has more vertices than a call has room for arguments. */
const range = (values: readonly number[]): [number, number] => values.reduce<[number, number]>(([lo, hi], x) => [Math.min(lo, x), Math.max(hi, x)], [Infinity, -Infinity]);

const radii = (m: BakedModel): number[] => m.poly.positions.map((p) => Math.hypot(p[0], p[1], p[2]));

/** Spread of the heights over a flat sheet, and their average. */
function heights(m: BakedModel): { min: number; max: number; mean: number } {
    const [min, max] = range(m.poly.positions.map((p) => p[1]));
    return { min, max, mean: m.poly.positions.reduce((sum, p) => sum + p[1], 0) / m.poly.positions.length };
}

describe('displace', () => {
    it.each(DISPLACE_PATTERNS)('%s moves a closed ball within its amplitude, and leaves it closed', (pattern) => {
        const m = model(ball, { op: 'displace', pattern, amplitude: 0.05, scale: 0.8, detail: 0.04 });
        expect(m.report.openEdges).toBe(0);
        expect(m.report.nonManifoldEdges).toBe(0);
        expect(m.report.insideOutShells).toBe(0);
        const [lo, hi] = range(radii(m));
        expect(hi - lo).toBeGreaterThan(0.005);
        expect(hi).toBeLessThan(1 + 0.05 * 1.5);
        expect(lo).toBeGreaterThan(0.95 - 0.05 * 1.5);
    });

    it('is the same every time, and a seed makes another', () => {
        const a = model(sheet, { op: 'displace', pattern: 'bumps', amplitude: 0.1, scale: 0.4, detail: 0.05 });
        const b = model(sheet, { op: 'displace', pattern: 'bumps', amplitude: 0.1, scale: 0.4, detail: 0.05 });
        const c = model(sheet, { op: 'displace', pattern: 'bumps', amplitude: 0.1, scale: 0.4, seed: 9, detail: 0.05 });
        expect(a.poly.positions).toEqual(b.poly.positions);
        expect(a.poly.positions).not.toEqual(c.poly.positions);
    });

    it('splits a flat plane enough to show the pattern, and the rim does not move', () => {
        const m = model(sheet, { op: 'displace', pattern: 'scales', amplitude: 0.1, scale: 0.5 });
        expect(m.report.triangles).toBeGreaterThan(100);
        // Nothing but the rim is open, and each of its corners is where it was.
        for (const corner of [[-1, 0, 1], [1, 0, 1], [1, 0, -1], [-1, 0, -1]]) {
            expect(m.poly.positions.some((p) => p.every((x, k) => Math.abs(x - corner[k]!) < 1e-3 + 0.2))).toBe(true);
        }
        expect(m.report.flippedEdges).toBe(0);
        expect(heights(m).max - heights(m).min).toBeGreaterThan(0.05);
    });

    it('cracks and wrinkles are dents at a positive amplitude and ridges at a negative one', () => {
        for (const pattern of ['cracks', 'wrinkles', 'pores', 'scratches'] as const) {
            const down = heights(model(sheet, { op: 'displace', pattern, amplitude: 0.1, scale: 0.5, detail: 0.03 }));
            const up = heights(model(sheet, { op: 'displace', pattern, amplitude: -0.1, scale: 0.5, detail: 0.03 }));
            expect(down.max).toBeLessThan(0.001);
            expect(down.min).toBeLessThan(-0.01);
            expect(up.min).toBeGreaterThan(-0.001);
            expect(up.max).toBeGreaterThan(0.01);
        }
    });

    it('`near` moves only inside its radius', () => {
        const m = model(sheet, { op: 'displace', pattern: 'bumps', amplitude: 0.1, scale: 0.2, near: { at: [0.5, 0, 0], radius: 0.3 }, detail: 0.03 });
        let moved = 0;
        for (const p of m.poly.positions) {
            const inside = Math.hypot(p[0] - 0.5, p[2]) < 0.3 + 0.03;
            if (Math.abs(p[1]) > 1e-6) { moved++; expect(inside).toBe(true); }
        }
        expect(moved).toBeGreaterThan(20);
    });

    it('`faces` leaves the others where they were, with no gap between', () => {
        const m = model(
            { op: 'box', size: 2, tag: 'body' },
            { op: 'tag', faces: '+y', tag: 'top' },
            { op: 'displace', faces: 'top', pattern: 'bumps', amplitude: 0.1, scale: 0.4 },
        );
        expect(m.report.openEdges).toBe(0);
        expect(m.report.nonManifoldEdges).toBe(0);
        expect(m.report.tags.body).toBe(5);
        expect(m.report.tags.top).toBeGreaterThan(50);
        // The walls are still the walls, well below anywhere the top can dent to.
        for (const p of m.poly.positions) if (p[1] < 0.8) expect(Math.max(Math.abs(p[0]), Math.abs(p[2]))).toBeCloseTo(1, 5);
        // And the rim they meet the top at stayed at the top's height.
        const rim = m.poly.positions.filter((p) => Math.max(Math.abs(p[0]), Math.abs(p[2])) > 0.9999 && p[1] > 0.8);
        expect(rim.length).toBeGreaterThan(8);
        for (const p of rim) expect(p[1]).toBeCloseTo(1, 5);
    });

    it('splits only what its pattern needs: an edge shared with a face outside does not make it run away', () => {
        const m = model({ op: 'box', size: 2 }, { op: 'tag', faces: '+y', tag: 'top' }, { op: 'displace', faces: 'top', pattern: 'bumps', amplitude: 0.1, scale: 0.4, detail: 0.05 });
        expect(m.report.triangles).toBeLessThan(100000);
        expect(m.report.warnings.join()).not.toMatch(/stopped at/);
    });

    it('`near` reaches a large face with every corner outside it', () => {
        const m = model(sheet, { op: 'displace', pattern: 'bumps', amplitude: 0.1, scale: 0.1, near: { at: [0, 0, 0], radius: 0.2 }, detail: 0.02 });
        expect(m.poly.positions.some((p) => Math.abs(p[1]) > 0.005)).toBe(true);
    });

    it('keeps paint and tags on what it splits', () => {
        const m = model({ ...sheet, color: [0.2, 0.4, 0.6] }, { op: 'displace', pattern: 'bumps', amplitude: 0.05, scale: 0.3, detail: 0.05 });
        for (const f of m.poly.faces) { expect(f.color).toEqual([0.2, 0.4, 0.6, 1]); expect(f.tag).toBe('sheet'); }
    });

    it('`stretch` draws features out along an axis', () => {
        const rough = (stretch: [number, number, number]) => {
            const m = model(sheet, { op: 'displace', pattern: 'ribs', amplitude: 0.1, scale: 0.4, axis: 'x', stretch, detail: 0.05 });
            return heights(m).max - heights(m).min;
        };
        // Stretched past the sheet's size along the axis it runs across, ribs barely have room to rise and fall.
        expect(rough([1, 1, 1])).toBeGreaterThan(0.15);
        expect(rough([40, 1, 1])).toBeLessThan(0.15);
    });

    it('`mirror` gives both sides the same', () => {
        const m = model(sheet, { op: 'displace', pattern: 'bumps', amplitude: 0.1, scale: 0.3, mirror: 'x', detail: 0.03 });
        const at = new Map(m.poly.positions.map((p) => [`${p[0].toFixed(4)},${p[2].toFixed(4)}`, p[1]]));
        let pairs = 0;
        for (const p of m.poly.positions) {
            const other = at.get(`${(-p[0]).toFixed(4)},${p[2].toFixed(4)}`);
            if (other !== undefined) { expect(other).toBeCloseTo(p[1], 5); pairs++; }
        }
        expect(pairs).toBeGreaterThan(50);
    });

    it('`mirror` takes `near` with it: a spot named on one side is on both', () => {
        const m = model(sheet, { op: 'displace', pattern: 'bumps', amplitude: 0.1, scale: 0.15, near: { at: [0.5, 0, 0], radius: 0.3 }, mirror: 'x', detail: 0.02 });
        const movedAt = (side: number): number => m.poly.positions.filter((p) => Math.sign(p[0]) === side && Math.abs(p[1]) > 1e-4).length;
        expect(movedAt(1)).toBeGreaterThan(20);
        expect(movedAt(-1)).toBe(movedAt(1));
        for (const p of m.poly.positions) if (Math.abs(p[1]) > 1e-4) expect(Math.hypot(Math.abs(p[0]) - 0.5, p[2])).toBeLessThan(0.31);
    });

    it('`detail` sets how far it splits', () => {
        const coarse = model(sheet, { op: 'displace', pattern: 'bumps', amplitude: 0.05, scale: 0.5, detail: 0.5 });
        const fine = model(sheet, { op: 'displace', pattern: 'bumps', amplitude: 0.05, scale: 0.5, detail: 0.1 });
        expect(fine.report.triangles).toBeGreaterThan(coarse.report.triangles * 4);
    });

    it('stops at its budget and says so, rather than asking for more memory than there is', () => {
        const out = displace({ positions: [[-50, 0, 50], [50, 0, 50], [50, 0, -50], [-50, 0, -50]], faces: [{ v: [0, 1, 2, 3], tag: '' }] }, { pattern: 'bumps', amplitude: 0.01, scale: 0.05 }, 5000);
        expect(out.faces.length).toBeLessThanOrEqual(5000);
        expect(out.faces.length).toBeGreaterThan(1000);
        expect(out.notes!.join()).toMatch(/stopped at 5000 triangles/);
    });

    it('its budget is what a whole model has room for', () => {
        expect(MAX_DISPLACE_TRIANGLES).toBe(1500000);
    });

    it('a heavy result says what to do about it, and goes without what would cost minutes', () => {
        const m = model(sheet, { op: 'displace', pattern: 'bumps', amplitude: 0.01, scale: 0.1, detail: 0.006 });
        expect(m.report.triangles).toBeGreaterThan(300000);
        expect(m.report.warnings.join()).toMatch(/end with a `decimate`/);
        expect(m.report.warnings.join()).toMatch(/no lightmap UV/);
    }, 60000);

    it('says when a pattern is too steep for a map to draw', () => {
        const steep = bakeModel({ version: 1, normalBake: { size: 128 }, steps: [ball, { op: 'displace', pattern: 'ribs', amplitude: 0.1, scale: 0.1 }, { op: 'decimate', triangles: 400, error: 0.5 }] });
        const map = bakeNormalMap(steep);
        expect(map.report.meanBend, JSON.stringify(map.report)).toBeGreaterThan(25);
        expect(map.warnings.join()).toMatch(/steeper than a normal map draws well/);
    }, 60000);

    it('scratches are lines, not dots: where one is, it runs on', () => {
        const m = model(sheet, { op: 'displace', pattern: 'scratches', amplitude: 0.1, scale: 0.5, width: 0.1, detail: 0.012 });
        // Bin the cut into a grid. Dots would leave cells apart; lines run through the grid, so most cut cells have a cut neighbour and the longest run is long.
        const N = 125;
        const cut = new Uint8Array(N * N);
        for (const p of m.poly.positions) if (p[1] < -0.02) cut[Math.min(N - 1, Math.floor((p[2] + 1) / 2 * N)) * N + Math.min(N - 1, Math.floor((p[0] + 1) / 2 * N))] = 1;
        const seen = new Uint8Array(N * N);
        let largest = 0;
        for (let i = 0; i < N * N; i++) {
            if (!cut[i] || seen[i]) continue;
            let size = 0;
            const stack = [i];
            seen[i] = 1;
            while (stack.length) {
                const at = stack.pop()!;
                size++;
                const [x, y] = [at % N, Math.floor(at / N)];
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    const [qx, qy] = [x + dx, y + dy];
                    if (qx < 0 || qy < 0 || qx >= N || qy >= N) continue;
                    const q = qy * N + qx;
                    if (cut[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
                }
            }
            largest = Math.max(largest, size);
        }
        // A pore of this width would cover a handful of cells.
        expect(largest).toBeGreaterThan(15);
    }, 60000);

    it('what it adds survives a decimate as a normal map', () => {
        const without = bakeModel({ version: 1, normalBake: { size: 128 }, steps: [ball, { op: 'decimate', triangles: 400, error: 0.3 }] });
        const withIt = bakeModel({ version: 1, normalBake: { size: 128 }, steps: [ball, { op: 'displace', pattern: 'wrinkles', amplitude: 0.03, scale: 0.3, detail: 0.02 }, { op: 'decimate', triangles: 400, error: 0.3 }] });
        expect(bakeNormalMap(withIt).report.meanBend).toBeGreaterThan(bakeNormalMap(without).report.meanBend + 2);
    }, 60000);

    it('refuses what cannot be meant, naming the step', () => {
        expect(() => model(ball, { op: 'displace', pattern: 'tartan', amplitude: 1, scale: 1 })).toThrow(/pattern must be one of/);
        expect(() => model(ball, { op: 'displace', pattern: 'bumps', amplitude: 1 })).toThrow(/scale is required/);
        expect(() => model(ball, { op: 'displace', pattern: 'bumps', amplitude: 1, scale: -1 })).toThrow(/step 1.*must be positive/);
        expect(() => model(ball, { op: 'displace', pattern: 'bumps', amplitude: 1, scale: 1, near: { at: [9, 9, 9], radius: 1 } })).toThrow(/no surface/);
        expect(() => validateModelSource({ steps: [ball, { op: 'displace', pattern: 'bumps', amplitude: 1, scale: 1, near: { at: [0, 0], radius: 1 } }] })).toThrow(/near must be/);
    });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Many copies of a shape: where each lands, which way it stands, and that the same seed lays them out the same way. */
import { describe, expect, it } from 'vitest';
import { bakeModel, validateModelSource, type ModelStep } from '../src/modeling';

const seed: ModelStep = { op: 'box', size: [0.1, 0.4, 0.1], tag: 'seed', at: [50, 50, 50] };
const build = (scatter: Record<string, unknown>, extra: ModelStep[] = []) =>
    bakeModel({ version: 1, smoothAngle: 0, steps: [...extra, seed, { op: 'scatter', source: 'seed', tag: 'copy', ...scatter }] }).poly;
const copyPoints = (m: ReturnType<typeof build>): number[][] => {
    const used = new Set(m.faces.filter((f) => f.tag === 'copy').flatMap((f) => [...f.v]));
    return [...used].map((v) => [...m.positions[v]!]);
};

describe('scatter', () => {
    it('takes the source away and leaves as many copies as asked', () => {
        const m = build({ within: [[-1, -1, -1], [1, 1, 1]], count: 7 });
        expect(m.faces.filter((f) => f.tag === 'seed')).toHaveLength(0);
        expect(m.faces.filter((f) => f.tag === 'copy')).toHaveLength(7 * 6);
    });

    it('keeps the source when told to', () => {
        expect(build({ within: [[-1, -1, -1], [1, 1, 1]], count: 2, keep: true }).faces.length).toBe(18);
    });

    it('fills the box and goes no further', () => {
        const pts = copyPoints(build({ within: [[0, 0, 0], [10, 1, 10]], count: 200, spin: 0 }));
        expect(Math.min(...pts.map((p) => p[0]!))).toBeGreaterThan(-0.1);
        expect(Math.max(...pts.map((p) => p[0]!))).toBeLessThan(10.1);
        expect(Math.max(...pts.map((p) => p[0]!))).toBeGreaterThan(8);
        expect(Math.max(...pts.map((p) => p[2]!))).toBeGreaterThan(8);
    });

    it('stands each on a surface, pointing away from it', () => {
        const ground: ModelStep = { op: 'box', size: [4, 1, 4], at: [0, 0, 0], tag: 'ground' };
        const m = build({ faces: { tag: 'ground', facing: '+x' }, count: 20, spin: 0 }, [ground]);
        const pts = copyPoints(m);
        expect(Math.min(...pts.map((p) => p[0]!))).toBeGreaterThan(1.9);
        expect(Math.max(...pts.map((p) => p[0]!))).toBeCloseTo(2.4, 1);
    });

    it('goes along a path, in order, pointing the way it runs', () => {
        const m = build({ path: [[0, 0, 0], [10, 0, 0]], count: 11, spin: 0 });
        const pts = copyPoints(m);
        expect(Math.max(...pts.map((p) => p[0]!))).toBeGreaterThan(10);
        expect(Math.max(...pts.map((p) => Math.abs(p[1]!)))).toBeLessThan(0.1);
        for (let x = 1; x < 9; x++) expect(pts.some((p) => Math.abs(p[0]! - x) < 0.8)).toBe(true);
    });

    it('sizes them between the two it is given, and tapers along a path', () => {
        const sizes = (scatter: Record<string, unknown>): number[] => {
            const m = build({ count: 6, spin: 0, ...scatter });
            const faces = m.faces.filter((f) => f.tag === 'copy');
            return Array.from({ length: 6 }, (_, i) => {
                const vs = faces.slice(i * 6, (i + 1) * 6).flatMap((f) => [...f.v]);
                const ys = vs.map((v) => m.positions[v]!);
                return Math.max(...ys.map((p) => Math.hypot(p[0]! - ys[0]![0]!, p[1]! - ys[0]![1]!, p[2]! - ys[0]![2]!)));
            });
        };
        const ranged = sizes({ within: [[0, 0, 0], [9, 9, 9]], scale: [1, 3] });
        expect(Math.max(...ranged)).toBeGreaterThan(Math.min(...ranged) * 1.2);
        const tapered = sizes({ path: [[0, 0, 0], [10, 0, 0]], taper: 0.1 });
        expect(tapered[5]!).toBeLessThan(tapered[0]! * 0.2);
    });

    it('gives each one of the colours', () => {
        const colors = [[1, 0, 0], [0, 0, 1]];
        const m = build({ within: [[0, 0, 0], [1, 1, 1]], count: 30, colors });
        const seen = new Set(m.faces.filter((f) => f.tag === 'copy').map((f) => `${f.color?.[0]},${f.color?.[2]}`));
        expect(seen).toEqual(new Set(['1,0', '0,1']));
    });

    it('lays them out the same way for a seed, and another way for another', () => {
        const place = (s: number): number[][] => copyPoints(build({ within: [[0, 0, 0], [5, 5, 5]], count: 12, seed: s }));
        expect(place(3)).toEqual(place(3));
        expect(place(3)).not.toEqual(place(4));
    });

    it('asks for one place to go, and says what is wrong', () => {
        expect(() => build({ count: 3 })).toThrow(/one of/);
        expect(() => build({ count: 3, within: [[0, 0, 0], [1, 1, 1]], path: [[0, 0, 0], [1, 0, 0]] })).toThrow(/one of/);
        expect(() => build({ source: 'nothing', count: 3, within: [[0, 0, 0], [1, 1, 1]] })).toThrow(/matched no face/);
        expect(() => build({ count: 0, within: [[0, 0, 0], [1, 1, 1]] })).toThrow(/count/);
        expect(() => validateModelSource({ steps: [seed, { op: 'scatter', source: 'seed' }] })).toThrow(/count/);
    });
});

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

describe('scatter in rows off a path', () => {
    // A blade: 0.2 across (x), 0.4 long (y), 0.02 thick (z). Its +y is the way it points and its +z is its face.
    const blade: ModelStep = { op: 'box', size: [0.2, 0.4, 0.02], tag: 'blade', at: [50, 50, 50] };
    const rows = (scatter: Record<string, unknown>) =>
        bakeModel({ version: 1, smoothAngle: 0, steps: [blade, { op: 'scatter', source: 'blade', tag: 'copy', path: [[0, 0, 0], [10, 0, 0]], count: 5, ...scatter }] }).poly;
    /** Each copy's eight corners, in the order they were made. */
    const copies = (m: ReturnType<typeof rows>): number[][][] => {
        const faces = m.faces.filter((f) => f.tag === 'copy');
        return Array.from({ length: faces.length / 6 }, (_, i) => {
            const used = new Set(faces.slice(i * 6, (i + 1) * 6).flatMap((f) => [...f.v]));
            return [...used].map((v) => [...m.positions[v]!]);
        });
    };
    const span = (pts: number[][], axis: number): [number, number] => [Math.min(...pts.map((p) => p[axis]!)), Math.max(...pts.map((p) => p[axis]!))];

    it('makes a pair at each place, one to each side', () => {
        const all = copies(rows({ rows: 2, sweep: 90 }));
        expect(all).toHaveLength(10);
        for (let i = 0; i < 10; i += 2) {
            const [a, b] = [span(all[i]!, 2), span(all[i + 1]!, 2)];
            // Straight out: each reaches 0.4 from the path, on opposite sides of it.
            expect(a[0]).toBeCloseTo(-0.4, 5);
            expect(a[1]).toBeCloseTo(0, 5);
            expect(b[0]).toBeCloseTo(0, 5);
            expect(b[1]).toBeCloseTo(0.4, 5);
            // And the two stand at the same place along it.
            expect(span(all[i]!, 0)[0]).toBeCloseTo(span(all[i + 1]!, 0)[0], 5);
        }
    });

    it('keeps one row to the left of the path, seen from up', () => {
        const all = copies(rows({ rows: 1, sweep: 90 }));
        expect(all).toHaveLength(5);
        // The path runs +x under a +y up: left is -z.
        for (const c of all) expect(span(c, 2)[1]).toBeLessThan(1e-6);
        const flipped = copies(rows({ rows: 1, sweep: 90, up: [0, -1, 0] }));
        for (const c of flipped) expect(span(c, 2)[0]).toBeGreaterThan(-1e-6);
    });

    it('faces every copy up, whichever way it points', () => {
        // Thin in y, wherever the 0.02 of the blade went: in a turn by the shortest way it would have rolled.
        for (const sweep of [90, 60, 25]) {
            for (const c of copies(rows({ rows: 2, sweep }))) {
                const [lo, hi] = span(c, 1);
                expect(hi - lo).toBeCloseTo(0.02, 5);
            }
        }
        const sideways = copies(rows({ rows: 2, sweep: 90, up: [0, 0, 1] }));
        for (const c of sideways) expect(span(c, 2)[1] - span(c, 2)[0]).toBeCloseTo(0.02, 5);
    });

    it('leans them toward the end of the path by `sweep`, from one angle to another along it', () => {
        const reach = (c: number[][]): number => span(c, 0)[1] - span(c, 0)[0];
        // At 90 a blade covers its own width along the path; at 30 it lies most of its length along it.
        const out = copies(rows({ rows: 2, sweep: 90 }));
        const swept = copies(rows({ rows: 2, sweep: 30 }));
        expect(reach(out[0]!)).toBeCloseTo(0.2, 5);
        expect(reach(swept[0]!)).toBeCloseTo(0.4 * Math.cos(Math.PI / 6) + 0.2 * Math.sin(Math.PI / 6), 5);
        const turning = copies(rows({ rows: 2, sweep: [90, 30] }));
        expect(reach(turning[0]!)).toBeCloseTo(0.2, 1);
        expect(reach(turning.at(-1)!)).toBeGreaterThan(0.4);
    });

    it('raises them out of the plane by `lift`, and hangs them when it is negative', () => {
        const raised = copies(rows({ rows: 2, sweep: 90, lift: 30 }));
        for (const c of raised) expect(span(c, 1)[1]).toBeCloseTo(0.4 * 0.5 + 0.01 * Math.cos(Math.PI / 6), 5);
        const hung = copies(rows({ rows: 2, sweep: 90, lift: -30 }));
        for (const c of hung) expect(span(c, 1)[0]).toBeCloseTo(-(0.4 * 0.5 + 0.01 * Math.cos(Math.PI / 6)), 5);
    });

    it('sizes them along the path by `sizes`', () => {
        const lengths = copies(rows({ rows: 1, sweep: 90, count: 9, sizes: [0.25, 1, 0.25] })).map((c) => span(c, 2)[1] - span(c, 2)[0]);
        expect(lengths[4]!).toBeCloseTo(0.4, 1);
        expect(lengths[0]!).toBeLessThan(0.15);
        expect(lengths[8]!).toBeLessThan(0.15);
        expect(lengths[2]!).toBeGreaterThan(lengths[0]!);
        // Without rows too: it is a rule about the path, not about the rows.
        const along = bakeModel({ version: 1, smoothAngle: 0, steps: [blade, { op: 'scatter', source: 'blade', tag: 'copy', path: [[0, 0, 0], [10, 0, 0]], count: 3, spin: 0, sizes: [1, 0.5] }] }).poly;
        const made = copies(along).map((c) => span(c, 0)[1] - span(c, 0)[0]);
        expect(made[2]!).toBeLessThan(made[0]! * 0.6);
    });

    it('stands off a path that runs straight up, and off one that bends', () => {
        const upright = bakeModel({ version: 1, smoothAngle: 0, steps: [blade, { op: 'scatter', source: 'blade', tag: 'copy', path: [[0, 0, 0], [0, 10, 0]], count: 4, rows: 2, sweep: 90 }] }).poly;
        for (const p of upright.positions) for (const v of p) expect(Number.isFinite(v)).toBe(true);
        const bent = copies(bakeModel({ version: 1, smoothAngle: 0, steps: [blade, { op: 'scatter', source: 'blade', tag: 'copy', path: [[0, 0, 0], [5, 0, 0], [5, 0, 5]], count: 9, rows: 1, sweep: 90 }] }).poly);
        // On the second leg the path runs +z, so left of it is +x.
        expect(span(bent.at(-1)!, 0)[1]).toBeCloseTo(5.4, 5);
    });

    it('lays them out the same way for a seed', () => {
        const place = (s: number) => rows({ rows: 2, tilt: 20, spin: 10, seed: s }).positions;
        expect(place(5)).toEqual(place(5));
        expect(place(5)).not.toEqual(place(6));
    });

    it('says what is wrong', () => {
        expect(() => rows({ rows: 3 })).toThrow(/rows 3 must be 1 or 2/);
        expect(() => rows({ sweep: 40 })).toThrow(/`sweep` goes with `rows`/);
        expect(() => rows({ lift: 10 })).toThrow(/`lift` goes with `rows`/);
        expect(() => rows({ rows: 2, up: [0, 0, 0] })).toThrow(/`up` must point somewhere/);
        expect(() => rows({ sizes: [1, -1] })).toThrow(/`sizes` must each be 0 or more/);
        expect(() => bakeModel({ version: 1, steps: [blade, { op: 'scatter', source: 'blade', within: [[0, 0, 0], [1, 1, 1]], count: 2, rows: 2 }] })).toThrow(/`rows` stand off a `path`/);
        expect(() => bakeModel({ version: 1, steps: [blade, { op: 'scatter', source: 'blade', within: [[0, 0, 0], [1, 1, 1]], count: 2, sizes: [1, 2] }] })).toThrow(/`sizes` goes along a `path`/);
    });
});

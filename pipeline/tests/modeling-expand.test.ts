// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A model source's names, sums and repeats: what a sum comes to, what a repeat makes, that the result is the same
 * model as the steps written out, and that what is saved is the source as written.
 */
import { describe, expect, it } from 'vitest';
import { applyModelEdits, bakeModel, expandModelSource, validateModelSource, type ModelSource, type ModelStep } from '../src/modeling';
import { evaluate } from '../src/modeling/modelExpr';

const scope = new Map<string, number | number[]>([['length', 2], ['tip', [0, 2, 0]]]);
const sum = (text: string) => evaluate(text, scope);

describe('a sum in a model source', () => {
    it('does arithmetic in the usual order', () => {
        expect(sum('1 + 2 * 3')).toBe(7);
        expect(sum('(1 + 2) * 3')).toBe(9);
        expect(sum('-2 ^ 2')).toBe(-4);
        expect(sum('2 ^ -1')).toBe(0.5);
        expect(sum('7 % 3')).toBe(1);
        expect(sum('-1 % 3')).toBe(2);
        expect(sum('1.5e1 - .5')).toBe(14.5);
    });

    it('reads the names it is given', () => {
        expect(sum('length * 0.4')).toBeCloseTo(0.8);
        expect(sum('tip[1] + 1')).toBe(3);
    });

    it('works in degrees', () => {
        expect(sum('sin(30)')).toBeCloseTo(0.5);
        expect(sum('atan2(1, 1)')).toBeCloseTo(45);
        expect(sum('cos(pi * 0)')).toBe(1);
    });

    it('adds points and scales them', () => {
        expect(sum('tip + [1, 0, 0]')).toEqual([1, 2, 0]);
        expect(sum('tip * 0.5')).toEqual([0, 1, 0]);
        expect(sum('2 * tip - tip')).toEqual([0, 2, 0]);
        expect(sum('mix([0, 0, 0], tip, 0.25)')).toEqual([0, 0.5, 0]);
        expect(sum('len(tip)')).toBe(2);
        expect(sum('cross([1, 0, 0], [0, 1, 0])')).toEqual([0, 0, 1]);
    });

    it('puts a point round the upright axis, from +z toward +x', () => {
        const p = sum('polar(90, 2, 1)') as number[];
        expect(p[0]).toBeCloseTo(2);
        expect(p[1]).toBe(1);
        expect(p[2]).toBeCloseTo(0);
    });

    it('bends a line from one lean to another, as long as it was asked', () => {
        const line = sum('arc([0, 0, 0], [1, 0, 0], 2, 0, 90, 1, 20)') as number[][];
        expect(line).toHaveLength(21);
        let walked = 0;
        for (let i = 1; i < line.length; i++) walked += Math.hypot(...line[i]!.map((v, k) => v - line[i - 1]![k]!));
        expect(walked).toBeCloseTo(2, 5);
        // It leaves going up and arrives going out, never leaving the plane it leans in.
        expect(line[1]![1]! - line[0]![1]!).toBeGreaterThan(0.09);
        expect(line[20]![0]! - line[19]![0]!).toBeGreaterThan(0.09);
        for (const p of line) expect(p[2]).toBeCloseTo(0);
    });

    it('takes a part of a line, and says where a line is and which way it runs', () => {
        expect(sum('part([[0, 0, 0], [1, 0, 0], [2, 0, 0], [4, 0, 0]], 0.5, 1)')).toEqual([[2, 0, 0], [4, 0, 0]]);
        expect(sum('part([[0, 0, 0], [4, 0, 0]], 0.25, 0.5)')).toEqual([[1, 0, 0], [2, 0, 0]]);
        expect(sum('along([[0, 0, 0], [0, 4, 0]], 0.25)')).toEqual([0, 1, 0]);
        expect(sum('heading([[0, 0, 0], [0, 4, 0]], 0.5)')).toEqual([0, 1, 0]);
    });

    it('gives the same number for the same key', () => {
        expect(sum('rand(3)')).toBe(sum('rand(3)'));
        expect(sum('rand(3)')).not.toBe(sum('rand(4)'));
        const r = sum('rand(7, 10, 20)') as number;
        expect(r).toBeGreaterThanOrEqual(10);
        expect(r).toBeLessThanOrEqual(20);
    });

    it('says what is wrong with one', () => {
        expect(() => sum('width * 2')).toThrow(/"width" is not a name here; there are length, tip/);
        expect(() => sum('spin(3)')).toThrow(/there is no spin\(\)/);
        expect(() => sum('1 +')).toThrow(/stops short/);
        expect(() => sum('(1 + 2')).toThrow(/expected "\)"/);
        expect(() => sum('1 2')).toThrow(/left over/);
        expect(() => sum('tip * tip')).toThrow(/two lists do not multiply/);
        expect(() => sum('tip + [1, 2]')).toThrow(/lists of 3 and 2/);
        expect(() => sum('1 / 0')).toThrow(/division by zero/);
        expect(() => sum('tip[5]')).toThrow(/item 5 of a list of 3/);
        expect(() => sum('sqrt(-1)')).toThrow(/not a number/);
        expect(() => sum('length; 1')).toThrow(/";" at 6 is not part of a sum/);
    });
});

const facesOf = (source: unknown): number => bakeModel(source).poly.faces.length;
const positionsOf = (source: unknown): number[][] => bakeModel(source).poly.positions.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6));

describe('names and repeats in a model source', () => {
    it('builds the same model as the steps written out', () => {
        const written = {
            version: 1,
            params: { size: 0.5, gap: 2 },
            steps: [{ op: 'repeat', count: 3, steps: [{ op: 'box', size: '=size', at: ['=i * gap', 0, 0] }] }],
        };
        const plain = { version: 1, steps: [0, 2, 4].map((x) => ({ op: 'box', size: 0.5, at: [x, 0, 0] })) };
        expect(positionsOf(written)).toEqual(positionsOf(plain));
    });

    it('runs its steps once for each row, the row naming what differs', () => {
        const source = {
            version: 1,
            steps: [{
                op: 'repeat',
                over: [{ angle: 0, height: 1 }, { angle: 90, height: 2 }, { angle: 180, height: 3 }],
                steps: [{ op: 'cylinder', radius: 0.1, height: '=height', sides: 6, at: '=polar(angle, 2, height / 2)' }],
            }],
        };
        const m = bakeModel(source);
        expect(m.report.shells).toBe(3);
        expect(m.report.bounds.max[1]).toBeCloseTo(3);
        expect(m.report.bounds.min[2]).toBeCloseTo(-2.1, 1);
    });

    it('gives a repeat its place in the run: i, t from 0 to 1, and n', () => {
        const plain = expandModelSource(validateModelSource({
            version: 1,
            steps: [{ op: 'repeat', count: 3, steps: [{ op: 'box', size: 1, at: ['=i', '=t', '=n'] }] }],
        }));
        expect(plain.steps.map((s) => s.at)).toEqual([[0, 0, 3], [1, 0.5, 3], [2, 1, 3]]);
    });

    it('names a value for the steps that follow, and not for those outside the repeat it is in', () => {
        const plain = expandModelSource(validateModelSource({
            version: 1,
            params: { base: 2 },
            steps: [
                { op: 'let', twice: '=base * 2' },
                { op: 'repeat', count: 2, steps: [{ op: 'let', here: '=twice + i' }, { op: 'box', size: '=here' }] },
                { op: 'box', size: '=twice' },
            ],
        }));
        expect(plain.steps.map((s) => s.size)).toEqual([4, 5, 4]);
        expect(() => bakeModel({
            version: 1,
            steps: [{ op: 'repeat', count: 2, steps: [{ op: 'let', here: 1 }, { op: 'box', size: '=here' }] }, { op: 'box', size: '=here' }],
        })).toThrow(/step 1 \(box\): `size` "=here": "here" is not a name here/);
    });

    it('repeats inside a repeat', () => {
        expect(facesOf({
            version: 1,
            steps: [{ op: 'repeat', count: 3, steps: [{ op: 'let', x: '=i' }, { op: 'repeat', count: 2, steps: [{ op: 'box', size: 0.2, at: ['=x', '=i', 0] }] }] }],
        })).toBe(3 * 2 * 6);
    });

    it('lets a later param use an earlier one', () => {
        const plain = expandModelSource(validateModelSource({ version: 1, params: { a: 2, b: '=a * 3', c: '=[a, b, 0]' }, steps: [{ op: 'box', size: 1, at: '=c' }] }));
        expect(plain.steps[0]!.at).toEqual([2, 6, 0]);
    });

    it('hands back the source as written, which is what is saved', () => {
        const written = { version: 1, params: { size: 2 }, steps: [{ op: 'box', size: '=size' }] };
        const checked = validateModelSource(structuredClone(written));
        expect(checked.steps).toEqual(written.steps);
        expect(checked.params).toEqual(written.params);
        // And an edit changes the name once, where ten steps would have been ten edits.
        const edited = applyModelEdits(checked, [{ op: 'settings', fields: { params: { size: 4 } } }]);
        expect(edited.params).toEqual({ size: 4 });
        expect(bakeModel(edited).report.bounds.size[0]).toBeCloseTo(4);
    });

    it('leaves a source without any of it exactly as it was', () => {
        const source: ModelSource = { version: 1, steps: [{ op: 'box', size: 1 }] };
        expect(expandModelSource(source)).toBe(source);
    });

    it('names a failing step by where it was written, and the step an edit would change', () => {
        const source = {
            version: 1,
            steps: [{ op: 'box', size: 1 }, { op: 'repeat', over: [{ w: 1 }, { w: -1 }], steps: [{ op: 'box', size: '=w' }] }],
        };
        let caught: { message: string; stepIndex: number | null } | null = null;
        try { bakeModel(source); } catch (e) { caught = e as never; }
        expect(caught!.message).toMatch(/^step 1 \(repeat\) row 1 > step 0 \(box\): /);
        expect(caught!.stepIndex).toBe(1);
        expect(() => validateModelSource({ version: 1, steps: [{ op: 'repeat', count: 2, steps: [{ op: 'box', size: 1, nope: 3 }] }] }))
            .toThrow(/step 0 \(repeat\) row 0 > step 0 \(box\): unknown field "nope"/);
    });

    it('refuses what it cannot make sense of', () => {
        const repeat = (fields: Record<string, unknown>) => () => validateModelSource({ version: 1, steps: [{ op: 'repeat', steps: [{ op: 'box', size: 1 }], ...fields }] });
        expect(repeat({})).toThrow(/one of `count` or `over`/);
        expect(repeat({ count: 2, over: [{}] })).toThrow(/one of `count` or `over`/);
        expect(repeat({ count: 0 })).toThrow(/count 0 must be a whole number of 1 or more/);
        expect(repeat({ count: 2, times: 3 })).toThrow(/unknown field "times"/);
        expect(repeat({ over: [1, 2] })).toThrow(/`over` must be a list of rows/);
        expect(repeat({ count: 2, steps: [] })).toThrow(/`steps` is what it repeats/);
        expect(repeat({ count: 2, steps: [{ op: 'box', size: 1, id: 'a' }] })).toThrow(/a step inside a repeat is made once for each row, so it cannot have an id/);
        expect(repeat({ count: 6000 })).toThrow(/more than 5000 steps/);
        expect(() => validateModelSource({ version: 1, params: { i: 1 }, steps: [] })).toThrow(/"i" is taken/);
        expect(() => validateModelSource({ version: 1, params: { '2x': 1 }, steps: [] })).toThrow(/"2x" is not a name/);
        expect(() => validateModelSource({ version: 1, params: { a: 'big' }, steps: [] })).toThrow(/params\.a must be a number/);
        expect(() => validateModelSource({ version: 1, steps: [{ op: 'let', x: '=nope' }] })).toThrow(/step 0 \(let\): x "=nope"/);
    });
});

describe('strip', () => {
    const strip = (fields: Record<string, unknown> = {}): ModelStep => ({ op: 'strip', path: [[0, 0, 0], [0, 0, 1], [0, 0, 2]], width: 0.4, ...fields });
    const built = (fields?: Record<string, unknown>) => bakeModel({ version: 1, smoothAngle: 0, steps: [strip(fields)] }).poly;

    it('is a band of no thickness, as wide as asked, facing up', () => {
        const m = built();
        expect(m.faces).toHaveLength(2);
        const xs = m.positions.map((p) => p[0]!), ys = m.positions.map((p) => p[1]!);
        expect(Math.min(...xs)).toBeCloseTo(-0.2);
        expect(Math.max(...xs)).toBeCloseTo(0.2);
        expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(0);
    });

    it('is shaped along its length by `widths`, and never quite to nothing', () => {
        const m = built({ widths: [0.5, 1, 0] });
        const widthAt = (z: number): number => {
            const row = m.positions.filter((p) => Math.abs(p[2]! - z) < 1e-6).map((p) => p[0]!);
            return Math.max(...row) - Math.min(...row);
        };
        expect(widthAt(0)).toBeCloseTo(0.2);
        expect(widthAt(1)).toBeCloseTo(0.4);
        expect(widthAt(2)).toBeGreaterThan(0);
        expect(widthAt(2)).toBeLessThan(0.001);
    });

    it('folds along its middle by `cup`', () => {
        const m = built({ cup: 0.5 });
        expect(m.faces).toHaveLength(4);
        expect(Math.max(...m.positions.map((p) => p[1]!))).toBeCloseTo(0.5 * 0.2);
        expect(Math.min(...m.positions.map((p) => p[1]!))).toBeCloseTo(0);
    });

    it('faces the way `up` says', () => {
        const m = built({ up: [1, 0, 0] });
        // Its width now runs along y, and it has no extent along x.
        expect(Math.max(...m.positions.map((p) => Math.abs(p[0]!)))).toBeCloseTo(0);
        expect(Math.max(...m.positions.map((p) => p[1]!))).toBeCloseTo(0.2);
        expect(() => built({ up: [0, 0, 1] })).toThrow(/`up` runs along the path/);
    });

    it('lays a picture along it from root to tip, or one part of a sheet', () => {
        const uvs = (m: ReturnType<typeof built>): number[][] => m.faces.flatMap((f) => f.cornerUvs!.map((uv) => [...uv]));
        const whole = uvs(built());
        expect(Math.min(...whole.map((u) => u[1]!))).toBe(0);
        expect(Math.max(...whole.map((u) => u[1]!))).toBe(1);
        expect(new Set(whole.map((u) => u[0]))).toEqual(new Set([0, 1]));
        const part = uvs(built({ region: [0.5, 0, 1, 0.25] }));
        expect(Math.min(...part.map((u) => u[0]!))).toBe(0.5);
        expect(Math.max(...part.map((u) => u[1]!))).toBe(0.25);
    });

    it('keeps its picture when it is scattered', () => {
        const m = bakeModel({ version: 1, steps: [{ ...strip(), tag: 'leaf' }, { op: 'scatter', source: 'leaf', path: [[0, 0, 0], [5, 0, 0]], count: 3, rows: 2, tag: 'copy' }] }).poly;
        expect(m.faces.filter((f) => f.tag === 'copy')).toHaveLength(12);
        for (const f of m.faces) expect(f.cornerUvs).toHaveLength(4);
    });

    it('says what is wrong', () => {
        expect(() => built({ width: 0 })).toThrow(/width 0 must be positive/);
        expect(() => built({ path: [[0, 0, 0]] })).toThrow(/at least 2 points/);
        expect(() => built({ path: [[0, 0, 0], [0, 0, 0]] })).toThrow(/same place/);
        expect(() => built({ region: [0, 0, 2, 1] })).toThrow(/`region` must be/);
        expect(() => built({ widths: [1, -1] })).toThrow(/`widths` must each be 0 or more/);
    });
});

describe('loft with an `up`', () => {
    const loft = (up?: number[]) => bakeModel({
        version: 1, smoothAngle: 0,
        steps: [{ op: 'loft', path: [[0, 0, 0], [0, 0, 2]], section: { size: [1, 0.1] }, ...(up ? { up } : {}) }],
    }).poly;
    const extent = (m: ReturnType<typeof loft>, axis: number): number => Math.max(...m.positions.map((p) => p[axis]!)) - Math.min(...m.positions.map((p) => p[axis]!));

    it('stands its section the way it is told, where it stood upright before', () => {
        // Across 1 and up 0.1: by default the thin way is y.
        expect(extent(loft(), 1)).toBeCloseTo(0.1);
        expect(extent(loft(), 0)).toBeCloseTo(1);
        // With up along x, the thin way is x.
        expect(extent(loft([1, 0, 0]), 0)).toBeCloseTo(0.1);
        expect(extent(loft([1, 0, 0]), 1)).toBeCloseTo(1);
    });

    it('refuses an up that runs along the path', () => {
        expect(() => loft([0, 0, 1])).toThrow(/`up` runs along the path/);
    });
});

describe('a material with a picture', () => {
    it('takes a project path to one, and nothing else', () => {
        const source = (texture: unknown) => ({ version: 1, material: { alpha: 'cutout', texture }, steps: [{ op: 'box', size: 1 }] });
        expect(validateModelSource(source('art/leaf.png')).material?.texture).toBe('art/leaf.png');
        expect(() => validateModelSource(source('art/leaf.txt'))).toThrow(/material\.texture must be a project path to a picture/);
        expect(() => validateModelSource(source(3))).toThrow(/material\.texture must be a project path to a picture/);
    });
});

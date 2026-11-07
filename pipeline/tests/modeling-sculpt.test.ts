// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** What is read off a picture goes into a model: a drawing stands up as a solid, a stroke moves the surface where it says and nowhere else, and a view lands on what it sees. */
import { describe, expect, it } from 'vitest';
import { bakeModel, validateModelSource, type ModelStep } from '../src/modeling';
import { seenFrom, viewOf } from '../src/modeling/surfaceLine';

type Mesh = ReturnType<typeof bakeModel>['poly'];
const build = (steps: ModelStep[]): Mesh => bakeModel({ version: 1, steps }).poly;
const bounds = (m: Mesh): { min: number[]; max: number[] } => ({
    min: [0, 1, 2].map((k) => Math.min(...m.positions.map((p) => p[k]!))),
    max: [0, 1, 2].map((k) => Math.max(...m.positions.map((p) => p[k]!))),
});
/** The surface's height toward +z or -z over a place in x, y, or null if nothing is there. */
const heightAt = (m: Mesh, x: number, y: number, sign: 1 | -1, within = 0.012): number | null => {
    let best: number | null = null;
    for (const p of m.positions) {
        if (Math.hypot(p[0] - x, p[1] - y) > within || p[2] * sign < 0) continue;
        if (best === null || p[2] * sign > best) best = p[2] * sign;
    }
    return best;
};

// A plate 1 across, thick enough to have a front and a back, with an edge well away from every stroke.
const plate: ModelStep = { id: 'form', op: 'box', size: [1, 1, 0.2], tag: 'plate' };

describe('organic outline', () => {
    const notch = [[0, 0], [1, 0], [1, 1], [0.6, 1], [0.5, 0.4], [0.4, 1], [0, 1]];
    const drawn = (extra: Record<string, unknown> = {}): Mesh => build([{ op: 'organic', resolution: 90, parts: [{ shape: 'outline', points: notch, depth: 0.1, round: 0.05, ...extra }] }]);

    it('stands where it is drawn, to its depth, and spends the grid on the drawing and not on the distance from the origin', () => {
        const m = build([{ op: 'organic', resolution: 80, parts: [{ shape: 'outline', points: notch.map(([x, y]) => [x! + 40, y! + 40]), depth: 0.1, round: 0.05 }] }]);
        const b = bounds(m);
        expect(b.min[0]).toBeCloseTo(40, 1);
        expect(b.max[0]).toBeCloseTo(41, 1);
        expect(b.max[1]).toBeCloseTo(41, 1);
        expect(b.max[2]).toBeCloseTo(0.1, 1);
        expect(m.faces.length).toBeGreaterThan(5000);
    });

    it('follows a concave drawing: the notch is empty', () => {
        const m = drawn();
        expect(heightAt(m, 0.5, 0.9, 1)).toBeNull();
        expect(heightAt(m, 0.5, 0.2, 1)).toBeCloseTo(0.1, 1);
        expect(heightAt(m, 0.2, 0.9, 1)).toBeCloseTo(0.1, 1);
    });

    it('is rounded across its edge by `round`, and full over its middle', () => {
        const wide = build([{ op: 'organic', resolution: 120, parts: [{ shape: 'outline', points: [[0, 0], [1, 0], [1, 1], [0, 1]], depth: 0.1, round: 0.2 }] }]);
        expect(heightAt(wide, 0.5, 0.5, 1)).toBeCloseTo(0.1, 2);
        // A tenth in from the edge of an ellipse 0.2 wide: 0.1 * sqrt(1 - 0.5²).
        expect(heightAt(wide, 0.1, 0.5, 1, 0.01)!).toBeCloseTo(0.0866, 1);
        expect(heightAt(wide, 0.1, 0.5, 1, 0.01)!).toBeLessThan(0.095);
    });

    it('is a dome by default: no flat on it, and no ridge down its middle where the nearest edge changes', () => {
        const dome = build([{ op: 'organic', resolution: 150, parts: [{ shape: 'outline', points: [[0, 0], [1, 0], [1, 0.6], [0, 0.6]], depth: 0.1 }] }]);
        const along = [0.1, 0.2, 0.3, 0.4, 0.5].map((x) => heightAt(dome, x, 0.3, 1, 0.012)!);
        for (let i = 1; i < along.length; i++) expect(along[i]!, `rises to the middle: ${along}`).toBeGreaterThan(along[i - 1]!);
        expect(bounds(dome).max[2]).toBeCloseTo(0.1, 1);
        // Across where a distance-to-the-nearest-edge dome would crease: on the long axis, y 0.3. The slope changes gently there and does not flip at a line.
        const across = [0.24, 0.27, 0.3, 0.33, 0.36].map((y) => heightAt(dome, 0.5, y, 1, 0.01)!);
        const bend = Math.abs(across[0]! - 2 * across[2]! + across[4]!);
        expect(bend).toBeLessThan(0.004);
    });

    it('turns with `rotate`, and its bounds go with it', () => {
        const m = build([{ op: 'organic', resolution: 60, parts: [{ shape: 'outline', points: [[0, 0], [1, 0], [1, 1], [0, 1]], depth: 0.05, rotate: [0, 90, 0] }] }]);
        const b = bounds(m);
        // Y 90 takes +x to -z: the drawing now stands across z and y.
        expect(b.min[2]).toBeCloseTo(-1, 1);
        expect(b.max[2]).toBeCloseTo(0, 1);
        expect(b.max[0]! - b.min[0]!).toBeLessThan(0.15);
    });

    it('rounds a drawing through its points with `curve`, and keeps a corner given twice', () => {
        const curved = build([{ op: 'organic', resolution: 80, parts: [{ shape: 'outline', curve: 6, depth: 0.05, points: [[0, 0], [1, 0], [1, 1], [0, 1]] }] }]);
        // A square drawn with a curve bows out past its sides.
        expect(bounds(curved).max[0]).toBeGreaterThan(1.02);
        const cornered = build([{ op: 'organic', resolution: 80, parts: [{ shape: 'outline', curve: 6, depth: 0.05, points: [[0, 0], [0, 0], [1, 0], [1, 0], [1, 1], [1, 1], [0, 1], [0, 1]] }] }]);
        expect(bounds(cornered).max[0]).toBeLessThan(1.02);
    });

    it('carves, as any part does', () => {
        const m = build([{ op: 'organic', resolution: 80, parts: [
            { shape: 'box', size: [1, 1, 0.2] },
            { shape: 'outline', subtract: true, points: [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]], depth: 0.3, round: 0.01 },
        ] }]);
        expect(heightAt(m, 0, 0, 1, 0.02)).toBeNull();
    });

    it('refuses what cannot be drawn', () => {
        expect(() => build([{ op: 'organic', parts: [{ shape: 'outline', points: [[0, 0], [1, 0]], depth: 0.1 }] }])).toThrow(/at least 3/);
        expect(() => build([{ op: 'organic', parts: [{ shape: 'outline', points: notch }] }])).toThrow(/depth/);
        expect(() => build([{ op: 'organic', parts: [{ shape: 'outline', points: notch, depth: -1 }] }])).toThrow(/positive/);
        expect(() => build([{ op: 'organic', parts: [{ shape: 'outline', points: notch, depth: 0.1, round: 0 }] }])).toThrow(/positive/);
        expect(() => validateModelSource({ steps: [{ op: 'organic', parts: [{ shape: 'outline', points: notch, depth: 0.1, curve: 99 }] }] })).toThrow(/curve/);
    });

    it('a chain still takes four numbers a point', () => {
        expect(() => build([{ op: 'organic', parts: [{ shape: 'chain', points: [[0, 0], [1, 0]] }] }])).toThrow(/x, y, z, radius/);
    });
});

describe('sculpt', () => {
    const stroke = (s: Record<string, unknown>, extra: Record<string, unknown> = {}): Mesh => build([plate, { op: 'sculpt', from: '+z', strokes: [s], ...extra }]);
    const press = { brush: 'press', points: [[-0.3, 0], [0.3, 0]], width: 0.08, depth: 0.03 };

    it('presses along a line, deepest down its middle and nothing past its width', () => {
        const m = stroke(press);
        expect(heightAt(m, 0, 0, 1)!).toBeLessThan(0.1 - 0.02);
        expect(heightAt(m, 0, 0.06, 1)!).toBeGreaterThan(heightAt(m, 0, 0, 1)!);
        expect(heightAt(m, 0, 0.15, 1)).toBeCloseTo(0.1, 5);
    });

    it('raises with a negative depth', () => {
        expect(heightAt(stroke({ ...press, depth: -0.03 }), 0, 0, 1)!).toBeGreaterThan(0.1 + 0.02);
    });

    it('fades toward its ends, or with taper 0 stops dead', () => {
        const faded = stroke(press), dead = stroke({ ...press, taper: 0 });
        expect(heightAt(faded, -0.29, 0, 1, 0.01)!).toBeGreaterThan(0.095);
        expect(heightAt(dead, -0.29, 0, 1, 0.01)!).toBeLessThan(0.08);
    });

    it('leans: wider on one side of the line, by the way it runs', () => {
        const m = stroke({ ...press, lean: 0.6 });
        // Running along +x, left of it is +y.
        expect(heightAt(m, 0, 0.09, 1)!).toBeLessThan(0.1 - 1e-3);
        expect(heightAt(m, 0, -0.09, 1)).toBeCloseTo(0.1, 5);
        const other = stroke({ ...press, lean: -0.6 });
        expect(heightAt(other, 0, 0.09, 1)).toBeCloseTo(0.1, 5);
        expect(heightAt(other, 0, -0.09, 1)!).toBeLessThan(0.1 - 1e-3);
    });

    it('from a view, lands on the near side and not on the far one', () => {
        const m = stroke(press);
        expect(heightAt(m, 0, 0, -1)).toBeCloseTo(0.1, 5);
        const back = build([plate, { op: 'sculpt', from: '-z', strokes: [press] }]);
        expect(heightAt(back, 0, 0, -1)!).toBeLessThan(0.1 - 0.02);
        expect(heightAt(back, 0, 0, 1)).toBeCloseTo(0.1, 5);
    });

    it('from a view, lands on what is in front: a thing behind another is not touched', () => {
        const stacked = build([
            { op: 'box', size: [1, 1, 0.2], tag: 'far' },
            { op: 'box', size: [1, 1, 0.2], at: [0, 0, 1], tag: 'near' },
            { op: 'sculpt', from: '+z', strokes: [press] },
        ]);
        expect(heightAt(stacked, 0, 0, 1)!).toBeLessThan(1.1 - 0.02);
        const farFront = stacked.positions.filter((p) => Math.hypot(p[0], p[1]) < 0.05 && p[2] > 0 && p[2] < 0.5).map((p) => p[2]);
        expect(Math.min(...farFront)).toBeCloseTo(0.1, 5);
    });

    it('in three dimensions, takes [x, y, z] and reaches only what is that near', () => {
        const m = build([plate, { op: 'sculpt', strokes: [{ brush: 'press', points: [[-0.3, 0, 0.1], [0.3, 0, 0.1]], width: 0.08, depth: 0.03 }] }]);
        expect(heightAt(m, 0, 0, 1)!).toBeLessThan(0.08);
        // The back has the box's corners and nothing else: it was not reached, so not even split.
        expect(m.positions.filter((p) => p[2] < 0).every((p) => Math.abs(p[2] + 0.1) < 1e-9)).toBe(true);
    });

    it('moves what is round a place, the middle by all of it', () => {
        const m = stroke({ brush: 'move', at: [0, 0], radius: 0.2, by: [0, 0, 0.05] });
        expect(heightAt(m, 0, 0, 1, 0.02)!).toBeGreaterThan(0.145);
        expect(heightAt(m, 0.35, 0, 1)).toBeCloseTo(0.1, 5);
    });

    it('inflates along the way the surface faces, and hollows', () => {
        expect(heightAt(stroke({ brush: 'inflate', at: [0, 0], radius: 0.2, by: 0.04 }), 0, 0, 1, 0.02)!).toBeGreaterThan(0.135);
        expect(heightAt(stroke({ brush: 'inflate', at: [0, 0], radius: 0.2, by: -0.04 }), 0, 0, 1, 0.02)!).toBeLessThan(0.065);
    });

    it('smooths what is rough, and only there', () => {
        const rough = build([plate, { op: 'sculpt', from: '+z', strokes: [{ ...press, taper: 0 }, { brush: 'smooth', at: [0, 0], radius: 0.12, passes: 12 }] }]);
        const sharp = stroke({ ...press, taper: 0 });
        expect(heightAt(rough, 0, 0, 1)!).toBeGreaterThan(heightAt(sharp, 0, 0, 1)! + 0.005);
        expect(heightAt(rough, 0.2, 0, 1)!).toBeLessThan(0.1 - 0.01);
    });

    it('moves only the faces it is given, and the surface does not open where they meet others', () => {
        const m = build([
            { op: 'box', size: [1, 1, 0.2] },
            { op: 'slice', axis: 'x', at: 0 },
            { op: 'tag', faces: { within: { min: [0, null, null] } }, tag: 'right' },
            { op: 'sculpt', faces: { tag: 'right' }, from: '+z', strokes: [{ brush: 'inflate', at: [0, 0], radius: 0.4, by: 0.05 }] },
        ]);
        expect(m.positions.filter((p) => p[0] < -1e-6 && p[2] > 0).every((p) => Math.abs(p[2] - 0.1) < 1e-9)).toBe(true);
        expect(heightAt(m, 0.1, 0, 1, 0.05)!).toBeGreaterThan(0.11);
        // Where the two meet, the vertices both use stay put, or the surface would open.
        const seam = m.positions.filter((p) => Math.abs(p[0]) < 1e-6 && p[2] > 0).map((p) => p[2]);
        expect(seam.length).toBeGreaterThan(1);
        expect(Math.max(...seam)).toBeCloseTo(0.1, 9);
    });

    it('keeps what a face is: its tag and its colour', () => {
        const m = build([{ ...plate, color: [0.2, 0.4, 0.6] }, { op: 'sculpt', from: '+z', strokes: [press] }]);
        expect(m.faces.every((f) => f.tag === 'plate')).toBe(true);
        expect(m.faces[m.faces.length - 1]!.color?.[1]).toBeCloseTo(0.4, 5);
    });

    it('fades out toward a rim, and leaves no fold or torn edge on a round form', () => {
        const ball = build([
            { op: 'organic', resolution: 60, parts: [{ shape: 'sphere', radius: 0.5 }] },
            { op: 'sculpt', from: '+z', strokes: [{ brush: 'press', points: [[-0.6, 0], [0.6, 0]], width: 0.1, depth: 0.04, taper: 0 }] },
        ]);
        // On the rim the surface faces across the view: it stays where the sphere has it.
        const rim = ball.positions.filter((p) => Math.abs(p[1]) < 0.01 && Math.abs(p[2]) < 0.02);
        expect(rim.length).toBeGreaterThan(0);
        for (const p of rim) expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(0.5, 2);
        // Straight on, it moves in full.
        expect(heightAt(ball, 0, 0, 1, 0.02)!).toBeLessThan(0.5 - 0.025);
    });

    it('from a view, fades with depth behind what is in front: neighbours split into one moved and one not would dent the surface', () => {
        const cell = 0.1;
        // A column of points along the line of sight, all facing the eye.
        const depths = [0, -0.1, -0.25, -0.35, -0.45, -0.6];
        const mesh = { positions: depths.map((z) => [0, 0, z] as [number, number, number]), faces: [] };
        const normals = new Float64Array(depths.flatMap(() => [0, 0, 1]));
        const seen = seenFrom(mesh, normals, viewOf('+z'), depths.map((_, v) => v), cell);
        expect(seen[0]).toBe(1);
        expect(seen[1]).toBe(1);
        expect(seen[2]).toBeGreaterThan(0.5);
        expect(seen[2]).toBeLessThan(1);
        expect(seen[3]).toBeGreaterThan(0);
        expect(seen[3]).toBeLessThan(seen[2]!);
        expect(seen[5]).toBe(0);
        // What faces away is not seen, however near.
        normals[2] = -1; normals[5] = -1;
        expect(seenFrom(mesh, normals, viewOf('+z'), [0, 1], cell)[1]).toBe(0);
    });

    it('bends with `curve` where a line would kink', () => {
        const kink = { brush: 'press', points: [[-0.3, 0], [0, 0.2], [0.3, 0]], width: 0.03, depth: 0.03, taper: 0 };
        // A straight run from the first point to the corner leaves this point out of reach, and a curve through the same points bows out over it.
        const place: [number, number] = [-0.16, 0.135];
        expect(heightAt(stroke(kink), place[0], place[1], 1, 0.004)!).toBeGreaterThan(0.095);
        expect(heightAt(stroke({ ...kink, curve: 8 }), place[0], place[1], 1, 0.004)!).toBeLessThan(0.095);
    });

    it('does the same every time', () => {
        expect(stroke(press).positions).toEqual(stroke(press).positions);
    });

    it('says what is wrong with a stroke, naming it', () => {
        const refused = (s: Record<string, unknown>, from: string | null = '+z'): (() => void) => () => build([plate, { op: 'sculpt', ...(from ? { from } : {}), strokes: [{ brush: 'smooth', at: from ? [0, 0] : [0, 0, 0], radius: 0.1 }, s] } as ModelStep]);
        expect(refused({ brush: 'chisel', at: [0, 0], radius: 1 })).toThrow(/stroke 1.*chisel.*press, move, inflate, smooth/);
        expect(refused({ ...press, width: 0 })).toThrow(/stroke 1.*width/);
        expect(refused({ ...press, depth: undefined })).toThrow(/stroke 1.*depth/);
        expect(refused({ ...press, lean: 1 })).toThrow(/stroke 1.*lean/);
        expect(refused({ ...press, taper: 0.8 })).toThrow(/stroke 1.*taper/);
        expect(refused({ ...press, points: [[0, 0]] })).toThrow(/stroke 1.*points/);
        expect(refused({ ...press, points: [[0, 0, 0], [1, 0, 0]] })).toThrow(/stroke 1.*two numbers/);
        expect(refused({ ...press, points: [[0, 0], [1, 0]] }, null)).toThrow(/stroke 1.*\[x, y, z\]/);
        expect(refused({ brush: 'move', at: [50, 50], radius: 0.1, by: [0, 0, 1] })).toThrow(/stroke 1.*reaches no surface/);
        expect(() => build([plate, { op: 'sculpt', faces: 'nothing', from: '+z', strokes: [press] } as ModelStep])).toThrow(/matched no face/);
        expect(() => validateModelSource({ steps: [plate, { op: 'sculpt', from: 'z', strokes: [press] }] })).toThrow(/from must be one of/);
        expect(() => validateModelSource({ steps: [plate, { op: 'sculpt', strokes: [] }] })).toThrow(/strokes/);
    });
});

describe('a stain seen from a view', () => {
    const coloured: ModelStep = { ...plate, color: [1, 1, 1] };
    const line = { points: [[-0.3, 0], [0.3, 0]], width: 0.05, from: '+z' };
    const darkAt = (m: Mesh, sign: 1 | -1): number => m.faces.filter((f) => {
        const [a, b, c] = f.v.map((v) => m.positions[v]!);
        return (a![2] + b![2] + c![2]) * sign > 0.25 && (f.color?.[0] ?? 1) < 0.5;
    }).length;

    it('lands on the side it is seen from, along the line', () => {
        const m = build([coloured, { op: 'stain', color: [0, 0, 0], line, detail: 0.01 }]);
        expect(darkAt(m, 1)).toBeGreaterThan(100);
        expect(darkAt(m, -1)).toBe(0);
    });

    it('takes two numbers a point from a view and three without', () => {
        expect(() => validateModelSource({ steps: [plate, { op: 'stain', color: [0, 0, 0], line: { points: [[0, 0, 0], [1, 0, 0]], width: 0.1, from: '+z' } }] })).toThrow(/two axes/);
        expect(() => validateModelSource({ steps: [plate, { op: 'stain', color: [0, 0, 0], line: { points: [[0, 0], [1, 0]], width: 0.1 } }] })).toThrow(/x, y, z/);
        expect(() => validateModelSource({ steps: [plate, { op: 'stain', color: [0, 0, 0], line: { points: [[0, 0], [1, 0]], width: 0.1, from: 'up' } }] })).toThrow(/from must be/);
    });

    it('says when nothing is there', () => {
        expect(() => build([coloured, { op: 'stain', color: [0, 0, 0], line: { points: [[50, 50], [51, 50]], width: 0.1, from: '+z' } }])).toThrow(/within 0.1 of the line, seen from \+z/);
    });
});

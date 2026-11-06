// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Weights put right by hand, shapes a face can make, and the goals a controller's IK reaches for. */
import { describe, expect, it } from 'vitest';
import { decodeMesh, encodeMesh } from 'esengine';
import { bakeModel, controllerOf, morphedPositions, posedPositions, prefabOf, renderRigSheet, timelineOf, validateModelSource, type AnimationSource, type BakedModel, type ModelStep, type RigSource } from '../src/modeling';

const limb: ModelStep = { op: 'organic', resolution: 48, tag: 'limb', parts: [{ shape: 'chain', points: [[0, 0, 0, 0.2], [0, 2, 0, 0.2]], tag: 'limb' }, { shape: 'sphere', radius: 0.25, at: [0, 2.2, 0], tag: 'knob', blend: 0.05 }] };
const joints: RigSource['joints'] = [
    { name: 'base', at: [0, 0, 0] },
    { name: 'mid', at: [0, 1, 0], parent: 'base' },
    { name: 'tip', at: [0, 2, 0], parent: 'mid' },
];
const rigged = (adjust?: unknown, extra: Record<string, unknown> = {}): BakedModel => bakeModel({ version: 1, rig: { joints, ...(adjust ? { adjust } : {}) }, steps: [limb], ...extra });
const held = (m: BakedModel, name: string, v: number): number => {
    const j = m.rig!.joints.findIndex((x) => x.name === name);
    let w = 0;
    for (let k = 0; k < 4; k++) if (m.rig!.skin.joints[v * 4 + k] === j) w += m.rig!.skin.weights[v * 4 + k]!;
    return w;
};
const sums = (m: BakedModel): void => {
    for (let v = 0; v < m.poly.positions.length; v++) {
        expect([...m.rig!.skin.weights.subarray(v * 4, v * 4 + 4)].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    }
};

describe('rig.adjust', () => {
    it('binds faces wholly to a joint, and leaves the rest alone', () => {
        const before = rigged();
        const m = rigged([{ joint: 'base', weight: 1, faces: 'knob' }]);
        sums(m);
        const knob = new Set(m.poly.faces.filter((f) => f.tag === 'knob').flatMap((f) => f.v));
        expect(knob.size).toBeGreaterThan(50);
        for (const v of knob) expect(held(m, 'base', v)).toBeCloseTo(1, 5);
        m.poly.positions.forEach((_, v) => {
            if (!knob.has(v)) expect(held(m, 'mid', v)).toBeCloseTo(held(before, 'mid', v), 5);
        });
    });

    it('frees faces of a joint, sharing what it held among the others', () => {
        const m = rigged([{ joint: 'mid', weight: 0, faces: 'knob' }]);
        sums(m);
        const knob = new Set(m.poly.faces.filter((f) => f.tag === 'knob').flatMap((f) => f.v));
        for (const v of knob) expect(held(m, 'mid', v)).toBeCloseTo(0, 5);
    });

    it('a sole holder freed passes its weight up the chain instead of leaving the vertex to nothing', () => {
        const m = rigged([{ joint: 'mid', weight: 1, faces: 'knob' }, { joint: 'mid', weight: 0, faces: 'knob' }]);
        sums(m);
        const v = m.poly.faces.find((f) => f.tag === 'knob')!.v[0]!;
        expect(held(m, 'base', v)).toBeCloseTo(1, 5);
    });

    it('`near` fades to its edge', () => {
        const m = rigged([{ joint: 'tip', weight: 1, near: { at: [0, 0.5, 0.2], radius: 0.6 } }]);
        sums(m);
        const dist = (v: number): number => Math.hypot(...m.poly.positions[v]!.map((c, k) => c - [0, 0.5, 0.2][k]!));
        const count = m.poly.positions.length;
        const close = Array.from({ length: count }, (_, v) => v).filter((v) => dist(v) < 0.1);
        const edge = Array.from({ length: count }, (_, v) => v).filter((v) => dist(v) > 0.45 && dist(v) < 0.55);
        expect(close.length).toBeGreaterThan(0);
        for (const v of close) expect(held(m, 'tip', v)).toBeGreaterThan(0.9);
        for (const v of edge) expect(held(m, 'tip', v)).toBeLessThan(0.3);
    });

    it('moves the surface accordingly in a pose, and the report counts it', () => {
        const a: AnimationSource = { name: 'turn', duration: 1, loop: false, tracks: [{ joint: 'mid', rotate: [[0, 0, 0, 90]] }] };
        const free = rigged([{ joint: 'base', weight: 1, faces: 'knob' }], { animations: [a] });
        const stuck = free.poly.faces.find((f) => f.tag === 'knob')!.v[0]!;
        const after = posedPositions(free.poly, free.rig!.joints, free.rig!.skin, a, 0)[stuck]!;
        expect(after).toEqual(free.poly.positions[stuck]);
        expect(free.report.joints!.base!).toBeGreaterThan(rigged().report.joints!.base!);
    });

    it('refuses what it cannot apply', () => {
        expect(() => rigged([{ joint: 'mid', weight: 1, faces: 'nope' }])).toThrow(/matched no face/);
        expect(() => rigged([{ joint: 'mid', weight: 1, near: { at: [50, 0, 0], radius: 1 } }])).toThrow(/no surface within 1/);
        const check = (adjust: unknown) => validateModelSource({ version: 1, rig: { joints, adjust }, steps: [limb] });
        expect(() => check([{ joint: 'nope', weight: 1, faces: 'knob' }])).toThrow(/no joint "nope"; there are base, mid, tip/);
        expect(() => check([{ joint: 'mid', weight: 2, faces: 'knob' }])).toThrow(/weight must be 0..1/);
        expect(() => check([{ joint: 'mid', weight: 1 }])).toThrow(/exactly one of faces, near/);
        expect(() => check([{ joint: 'mid', weight: 1, faces: 'knob', near: { at: [0, 0, 0], radius: 1 } }])).toThrow(/exactly one of faces, near/);
    });
});

const ball: ModelStep = { op: 'organic', resolution: 40, tag: 'ball', parts: [{ shape: 'sphere', radius: 1, tag: 'ball' }] };
const faced = (shapes: unknown, extra: Record<string, unknown> = {}): BakedModel => bakeModel({ version: 1, shapes, steps: [ball], ...extra });

describe('shapes', () => {
    it('a whole-face move carries every vertex by that much at weight 1, and half at half', () => {
        const m = faced([{ name: 'up', moves: [{ faces: 'all', translate: [0, 1, 0] }] }]);
        const full = morphedPositions(m.poly, m.shapes!.deltas, [1]);
        const half = morphedPositions(m.poly, m.shapes!.deltas, [0.5]);
        m.poly.positions.forEach((p, v) => {
            expect(full[v]![1]).toBeCloseTo(p[1] + 1, 5);
            expect(half[v]![1]).toBeCloseTo(p[1] + 0.5, 5);
            expect(full[v]![0]).toBeCloseTo(p[0], 5);
        });
    });

    it('`near` moves its ball and fades, leaving the far side', () => {
        const m = faced([{ name: 'bump', moves: [{ near: { at: [0, 0, 1], radius: 0.5 }, translate: [0, 0, 0.3] }] }]);
        const after = morphedPositions(m.poly, m.shapes!.deltas, [1]);
        const front = m.poly.positions.findIndex((p) => p[2] > 0.99);
        expect(after[front]![2] - m.poly.positions[front]![2]).toBeGreaterThan(0.25);
        m.poly.positions.forEach((p, v) => {
            if (p[2] < 0) expect(after[v]).toEqual(p);
        });
    });

    it('`push` moves along the surface: a ball swells evenly', () => {
        const m = faced([{ name: 'fat', moves: [{ faces: 'all', push: 0.2 }] }]);
        const after = morphedPositions(m.poly, m.shapes!.deltas, [1]);
        const radii = after.map((p) => Math.hypot(...p));
        expect(Math.min(...radii)).toBeGreaterThan(1.17);
        expect(Math.max(...radii)).toBeLessThan(1.23);
    });

    it('`scale` closes toward the middle of what is chosen', () => {
        const m = faced([{ name: 'small', moves: [{ faces: 'all', scale: 0.5 }] }]);
        const after = morphedPositions(m.poly, m.shapes!.deltas, [1]);
        expect(Math.max(...after.map((p) => Math.hypot(...p)))).toBeLessThan(0.55);
    });

    it('reaches the file, per baked vertex, with normals, and takes no lightmap', () => {
        const m = faced([{ name: 'a', moves: [{ faces: 'all', translate: [1, 0, 0] }] }, { name: 'b', moves: [{ faces: 'all', push: 0.1 }] }]);
        const back = decodeMesh(encodeMesh(m.data));
        expect(back.morph!.names).toEqual(['a', 'b']);
        expect(back.morph!.hasNormals).toBe(true);
        expect(back.morph!.deltas.length).toBe(2 * back.vertexCount * 6);
        expect(back.morph!.deltas[0]).toBeCloseTo(1, 5);
        // Moving a whole ball sideways turns no surface.
        expect(Math.abs(back.morph!.deltas[3]!)).toBeLessThan(1e-5);
    });

    it('moves in a clip, by index, on the mesh\'s root', () => {
        const a: AnimationSource = { name: 'blink', duration: 1, shapes: [{ name: 'b', value: [[0, 0], [0.5, 1]] }] };
        const doc = timelineOf(a, [], ['a', 'b']) as { tracks: { childPath: string; component: string; channels: { property: string; keyframes: { value: number }[] }[] }[] };
        expect(doc.tracks[0]).toMatchObject({ childPath: '', component: 'MeshMorph' });
        expect(doc.tracks[0]!.channels[0]!.property).toBe('weights.1');
        const values = doc.tracks[0]!.channels[0]!.keyframes.map((k) => k.value);
        expect(Math.max(...values)).toBeCloseTo(1, 2);
    });

    it('works beside a rig: both reach the prefab, and bones carry the shape', () => {
        const a: AnimationSource = { name: 'turn', duration: 1, loop: false, tracks: [{ joint: 'mid', rotate: [[0, 0, 0, 90]] }], shapes: [{ name: 'up', value: [[0, 1]] }] };
        const m = bakeModel({ version: 1, rig: { joints }, shapes: [{ name: 'up', moves: [{ faces: 'knob', translate: [0, 0.5, 0] }] }], animations: [a], steps: [limb] });
        const doc = prefabOf('X', 'x.esmesh', m.rig!.joints, true, null, null, { shapes: 1 }) as { entities: { components: { type: string; data: Record<string, unknown> }[] }[] };
        const root = doc.entities[0]!.components;
        expect(root.find((c) => c.type === 'MeshMorph')!.data.weights).toEqual([0]);
        expect(root.find((c) => c.type === 'MeshSkin')).toBeDefined();
        const decoded = decodeMesh(encodeMesh(m.data));
        expect(decoded.morph).toBeDefined();
        expect(decoded.inverseBindMatrices).toBeDefined();
    });

    it('stands without a rig: a prefab with no skin', () => {
        const doc = prefabOf('X', 'x.esmesh', [], true, 'c.estimeline', null, { shapes: 2 }) as { entities: { components: { type: string; data: Record<string, unknown> }[] }[] };
        expect(doc.entities.length).toBe(1);
        const root = doc.entities[0]!.components;
        expect(root.find((c) => c.type === 'MeshSkin')).toBeUndefined();
        expect(root.find((c) => c.type === 'MeshMorph')!.data.weights).toEqual([0, 0]);
        expect(root.find((c) => c.type === 'TimelinePlayer')).toBeDefined();
    });

    it('can be looked at, at full weight and through a clip', () => {
        const a: AnimationSource = { name: 'pulse', duration: 1, shapes: [{ name: 'fat', value: [[0, 0], [0.5, 1]] }] };
        const m = faced([{ name: 'fat', moves: [{ faces: 'all', push: 0.5 }] }], { animations: [a] });
        const dark = (s: { width: number; rgba: Uint8Array }, col: number, panel: number): number => {
            let n = 0;
            for (let y = 0; y < panel; y++) for (let x = 0; x < panel; x++) if (s.rgba[((panel + 1 + y) * s.width + col * (panel + 1) + x) * 4]! < 60) n++;
            return n;
        };
        const still = renderRigSheet(m, [a], { views: ['front'], panel: 64 });
        expect(still.width).toBe(64);
        const strip = renderRigSheet(m, [a], { animation: 'pulse', times: [0, 0.5], views: ['front'], panel: 64 });
        expect(dark(strip, 1, 64)).toBeGreaterThan(dark(strip, 0, 64) * 1.5); // same frame, so the swollen one is bigger
        expect(() => renderRigSheet(m, [a], { shape: 'nope' })).toThrow(/no shape "nope"; there are fat/);
    });

    it('refuses what it cannot make', () => {
        const check = (shapes: unknown, extra = {}) => validateModelSource({ version: 1, shapes, steps: [ball], ...extra });
        expect(() => check([{ name: 'a', moves: [] }])).toThrow(/needs moves/);
        expect(() => check([{ name: 'a', moves: [{ faces: 'all' }] }])).toThrow(/one of translate, push, scale/);
        expect(() => check([{ name: 'a', moves: [{ translate: [1, 0, 0] }] }])).toThrow(/exactly one of faces, near/);
        expect(() => check([{ name: 'a', moves: [{ faces: 'all', push: 1, shove: 1 }] }])).toThrow(/unknown field "shove"/);
        expect(() => check([{ name: 'a', moves: [{ faces: 'all', push: 1 }] }, { name: 'a', moves: [{ faces: 'all', push: 1 }] }])).toThrow(/two shapes called "a"/);
        expect(() => check([{ name: 'a', moves: [{ faces: 'all', push: 1 }] }], { uvAtlas: true })).toThrow(/Use uv steps/);
        expect(() => check([{ name: 'a', moves: [{ faces: 'all', push: 1 }] }], { animations: [{ name: 'c', duration: 1, shapes: [{ name: 'b', value: [[0, 1]] }] }] })).toThrow(/no shape "b"; there are a/);
        expect(() => check([{ name: 'a', moves: [{ faces: 'all', push: 1 }] }], { animations: [{ name: 'c', duration: 1 }] })).toThrow(/needs tracks or shapes/);
        expect(() => faced([{ name: 'a', moves: [{ faces: 'nope', push: 1 }] }])).toThrow(/shape "a".*matched no face/);
    });
});

describe('goals and ik', () => {
    const rig: RigSource = { joints, goals: [{ name: 'aim', at: [1, 3, 0] }, { name: 'hold', at: [0.5, 1, 0], parent: 'mid' }] };
    const clip: AnimationSource = { name: 'c', duration: 1, tracks: [{ joint: 'mid', rotate: [[0, 0, 0, 5]] }] };
    const controller = { initial: 's', states: [{ name: 's', clip: 'c' }], parameters: [{ name: 'fade', type: 'float', default: 1 }], ik: [
        { kind: 'look-at', tip: 'tip', target: 'aim', axis: 'y' },
        { kind: 'two-bone', tip: 'tip', target: 'hold', pole: 'aim', parameter: 'fade' },
    ] };

    it('goals become entities that bend nothing: under the root, or under a joint', () => {
        const m = rigged();
        const doc = prefabOf('X', 'x.esmesh', m.rig!.joints, true, null, null, { goals: rig.goals! }) as { entities: { prefabEntityId: string; name: string; parent: string; children: string[]; components: { type: string; data: Record<string, unknown> }[] }[] };
        const aim = doc.entities.find((e) => e.name === 'aim')!;
        const hold = doc.entities.find((e) => e.name === 'hold')!;
        expect(aim.parent).toBe('root');
        expect(aim.components[0]!.data.position).toEqual({ x: 1, y: 3, z: 0 });
        expect(doc.entities.find((e) => e.prefabEntityId === hold.parent)!.name).toBe('mid');
        expect(hold.components[0]!.data.position).toEqual({ x: 0.5, y: 0, z: 0 }); // relative to mid
        expect(doc.entities.find((e) => e.name === 'mid')!.children).toContain(hold.prefabEntityId);
        const skin = doc.entities[0]!.components.find((c) => c.type === 'MeshSkin')!.data.joints as string[];
        expect(skin).not.toContain(aim.prefabEntityId);
    });

    it('a controller\'s ik names joints by their path, as the engine looks them up', () => {
        validateModelSource({ version: 1, rig, animations: [clip], controller, steps: [limb] });
        const doc = controllerOf(controller as never, [clip], (n) => `${n}.estimeline`, rig) as { ik: Record<string, unknown>[] };
        expect(doc.ik[0]).toEqual({ kind: 'look-at', tip: 'base/mid/tip', target: 'aim', axis: 'y' });
        expect(doc.ik[1]).toEqual({ kind: 'two-bone', tip: 'base/mid/tip', target: 'base/mid/hold', pole: 'aim', parameter: 'fade' });
    });

    it('refuses constraints that name what is not there', () => {
        const check = (ik: unknown, r: RigSource = rig) => validateModelSource({ version: 1, rig: r, animations: [clip], controller: { ...controller, ik }, steps: [limb] });
        expect(() => check([{ kind: 'look-at', tip: 'aim', target: 'aim' }])).toThrow(/tip "aim" is not a joint/);
        expect(() => check([{ kind: 'look-at', tip: 'tip', target: 'nope' }])).toThrow(/target "nope" is not a joint or a goal; there are base, mid, tip, aim, hold/);
        expect(() => check([{ kind: 'spin', tip: 'tip', target: 'aim' }])).toThrow(/must be two-bone, look-at or foot-plant/);
        expect(() => check([{ kind: 'two-bone', tip: 'mid', target: 'aim' }])).toThrow(/two bones above "mid"/);
        expect(() => check([{ kind: 'look-at', tip: 'tip', target: 'aim', parameter: 'nope' }])).toThrow(/must be a float parameter/);
        const dup = { joints, goals: [{ name: 'mid', at: [0, 0, 0] }] };
        expect(() => validateModelSource({ version: 1, rig: dup, steps: [limb] })).toThrow(/"mid" is already taken/);
        const badParent = { joints, goals: [{ name: 'g', at: [0, 0, 0], parent: 'nope' }] };
        expect(() => validateModelSource({ version: 1, rig: badParent, steps: [limb] })).toThrow(/parent must be a joint/);
    });
});

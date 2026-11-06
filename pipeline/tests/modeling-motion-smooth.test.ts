// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Feet that land where they are told, the controller that picks a clip, and surfaces rounded off. */
import { describe, expect, it } from 'vitest';
import { bakeModel, controllerOf, jointPositions, timelineOf, validateModelSource, type AnimationSource, type BakedModel, type ModelStep, type RigSource } from '../src/modeling';

const leg: ModelStep = { op: 'organic', resolution: 48, tag: 'leg', parts: [{ shape: 'chain', points: [[0, 2, 0, 0.15], [0, 0, 0, 0.12]] }] };
/** A hip, a knee slightly forward, a foot: the chain a reach solves. */
const rig: RigSource = { joints: [
    { name: 'hips', at: [0, 2.2, 0] },
    { name: 'thigh', at: [0, 2, 0], parent: 'hips' },
    { name: 'shin', at: [0, 1, 0.02], parent: 'thigh' },
    { name: 'foot', at: [0, 0, 0], parent: 'shin' },
] };
const bake = (animations: AnimationSource[]): BakedModel => bakeModel({ version: 1, rig, animations, steps: [leg] });
const reach = (target: [number, number, number], extra: Record<string, unknown> = {}): AnimationSource => ({
    name: 'r', duration: 1, loop: false, tracks: [{ joint: 'foot', reach: [[0, ...target]], ...extra }],
});

const gap = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const lengths = (p: Record<string, readonly number[]>): [number, number] => [gap(p.thigh!, p.shin!), gap(p.shin!, p.foot!)];

describe('reach', () => {
    it('puts the foot exactly where it was told, and the bones keep their lengths', () => {
        const a = reach([0.3, 0.4, 0.5]);
        const m = bake([a]);
        const p = jointPositions(m.rig!.joints, a, 0);
        expect(gap(p.foot!, [0.3, 0.4, 0.5])).toBeLessThan(1e-6);
        const [rest1, rest2] = lengths(jointPositions(m.rig!.joints, null, 0));
        const [now1, now2] = lengths(p);
        expect(now1).toBeCloseTo(rest1, 5);
        expect(now2).toBeCloseTo(rest2, 5);
        expect(gap(p.thigh!, [0, 2, 0])).toBeLessThan(1e-6); // the hip did not move
    });

    it('the knee bends the way `pole` says', () => {
        const forward = reach([0, 0.5, 0], { pole: [0, 0, 1] });
        const back = { ...reach([0, 0.5, 0], { pole: [0, 0, -1] }), name: 'back' };
        const m = bake([forward, back]);
        expect(jointPositions(m.rig!.joints, forward, 0).shin![2]).toBeGreaterThan(0.3);
        expect(jointPositions(m.rig!.joints, back, 0).shin![2]).toBeLessThan(-0.3);
    });

    it('without a pole it keeps bending the way it already leaned', () => {
        const a = reach([0, 0.5, 0]);
        const m = bake([a]);
        expect(jointPositions(m.rig!.joints, a, 0).shin![2]).toBeGreaterThan(0.3);
    });

    it('out of reach it stretches straight toward the target and no further', () => {
        const a = reach([0, -5, 0]);
        const m = bake([a]);
        const p = jointPositions(m.rig!.joints, a, 0);
        expect(p.foot![1]).toBeCloseTo(0, 2);
        expect(Math.abs(p.shin![2])).toBeLessThan(0.1);
    });

    it('a planted foot stays put while the hips sink, and the knee takes it up', () => {
        const a: AnimationSource = { name: 'squat', duration: 1, loop: false, tracks: [
            { joint: 'hips', move: [[0, 0, 0, 0], [1, 0, -0.5, 0]] },
            { joint: 'foot', reach: [[0, 0, 0, 0], [1, 0, 0, 0]], pole: [0, 0, 1] },
        ] };
        const m = bake([a]);
        for (const t of [0, 0.25, 0.5, 1]) {
            const p = jointPositions(m.rig!.joints, a, t);
            expect(gap(p.foot!, [0, 0, 0])).toBeLessThan(1e-5);
        }
        expect(jointPositions(m.rig!.joints, a, 1).shin![2]).toBeGreaterThan(jointPositions(m.rig!.joints, a, 0).shin![2]);
        expect(jointPositions(m.rig!.joints, a, 1).thigh![1]).toBeCloseTo(1.5, 5);
    });

    it('linear slides straight between keys, where a curve would dip through the ground', () => {
        const keys = [[0, 0, 0, 0.5], [0.5, 0, 0, -0.5], [0.75, 0, 0.3, 0]];
        const straight: AnimationSource = { name: 'a', duration: 1, tracks: [{ joint: 'foot', reach: keys, linear: true }] };
        const curved: AnimationSource = { name: 'b', duration: 1, tracks: [{ joint: 'foot', reach: keys }] };
        const m = bake([straight, curved]);
        const lowest = (a: AnimationSource): number => Math.min(...Array.from({ length: 21 }, (_, i) => jointPositions(m.rig!.joints, a, (i / 20) * 0.5).foot![1]));
        expect(Math.abs(lowest(straight))).toBeLessThan(1e-9);
        expect(lowest(curved)).toBeLessThan(-1e-4);
    });

    it('the clip written out lands the foot in the same place: what the preview shows is what plays', () => {
        const a = reach([0.3, 0.4, 0.5], { pole: [0, 0, 1] });
        const m = bake([a]);
        const doc = timelineOf(a, m.rig!.joints) as { tracks: { name: string; channels: { property: string; keyframes: { value: number }[] }[] }[] };
        expect(doc.tracks.map((t) => t.name)).toEqual(['thigh', 'shin', 'foot']);
        // Recompose from the file alone: the rest offsets and the keyed rotations.
        const q = (name: string): number[] => ['x', 'y', 'z', 'w'].map((c) => doc.tracks.find((t) => t.name === name)!.channels.find((k) => k.property === `rotation.${c}`)!.keyframes[0]!.value);
        const rotate = (r: number[], v: number[]): number[] => {
            const [x, y, z, w] = r as [number, number, number, number];
            const t = [2 * (y * v[2]! - z * v[1]!), 2 * (z * v[0]! - x * v[2]!), 2 * (x * v[1]! - y * v[0]!)];
            return [v[0]! + w * t[0]! + y * t[2]! - z * t[1]!, v[1]! + w * t[1]! + z * t[0]! - x * t[2]!, v[2]! + w * t[2]! + x * t[1]! - y * t[0]!];
        };
        const mul = (a: number[], b: number[]): number[] => [
            a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
            a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
            a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
            a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
        ];
        const hip = [0, 2, 0];
        const knee = rotate(q('thigh'), [0, -1, 0.02]).map((v, i) => v + hip[i]!);
        const foot = rotate(mul(q('thigh'), q('shin')), [0, -1, -0.02]).map((v, i) => v + knee[i]!);
        expect(gap(foot, [0.3, 0.4, 0.5])).toBeLessThan(1e-4);
    });

    it('refuses a limb it cannot solve, and a rotation it would throw away', () => {
        const anim = (tracks: unknown[]) => ({ version: 1, rig, steps: [leg], animations: [{ name: 'a', duration: 1, tracks }] });
        expect(() => validateModelSource(anim([{ joint: 'thigh', reach: [[0, 0, 0, 0]] }]))).toThrow(/two bones above/);
        expect(() => validateModelSource(anim([{ joint: 'foot', reach: [[0, 0, 0, 0]], move: [[0, 0, 0, 0]] }]))).toThrow(/both reach and move/);
        expect(() => validateModelSource(anim([{ joint: 'foot', reach: [[0, 0, 0, 0]] }, { joint: 'shin', rotate: [[0, 0, 0, 0]] }]))).toThrow(/"shin" has rotate keys, but the reach on "foot" decides/);
        expect(() => validateModelSource(anim([{ joint: 'shin', rotate: [[0, 0, 0, 0]], pole: [0, 0, 1] }]))).toThrow(/goes with reach/);
    });
});

describe('controller', () => {
    const clip = (name: string): AnimationSource => ({ name, duration: 1, tracks: [{ joint: 'shin', rotate: [[0, 0, 0, 10]] }] });
    const animations = [clip('idle'), clip('walk'), { ...clip('hit'), loop: false }];
    const controller = {
        parameters: [{ name: 'speed', type: 'float', default: 0 }, { name: 'hurt', type: 'trigger' }, { name: 'down', type: 'bool' }],
        initial: 'move',
        states: [
            { name: 'move', blend: { parameter: 'speed', stops: [{ value: 0, clip: 'idle' }, { value: 0.5, clip: 'walk' }] } },
            { name: 'flinch', clip: 'hit', speed: 2, transitions: [{ to: 'move', afterClip: true, blend: 0.2 }] },
        ],
        any: [{ to: 'flinch', when: [{ param: 'hurt', op: 'trigger' }], blend: 0.1 }],
    } as const;
    const source = (c: unknown, a: unknown = animations) => ({ version: 1, rig, animations: a, controller: c, steps: [leg] });

    it('accepts one that hangs together and writes what the engine reads', () => {
        validateModelSource(source(controller));
        const doc = controllerOf(controller as never, animations, (n) => `F_${n}.estimeline`) as { version: number; initialState: string; anyStateTransitions: { conditions: unknown[]; duration: number }[]; states: { motion: Record<string, unknown>; transitions: Record<string, unknown>[] }[] };
        expect(doc.version).toBe(2);
        expect(doc.initialState).toBe('move');
        expect(doc.states[0]!.motion).toMatchObject({ kind: 'blend1d', parameter: 'speed' });
        expect((doc.states[0]!.motion.thresholds as { motion: { clip: string } }[])[1]!.motion.clip).toBe('F_walk.estimeline');
        expect(doc.states[1]!.motion).toEqual({ kind: 'timeline', clip: 'F_hit.estimeline', loop: false, speed: 2 });
        expect(doc.states[1]!.transitions[0]).toEqual({ to: 'move', conditions: [], duration: 0.2, hasExitTime: true });
        expect(doc.anyStateTransitions[0]).toEqual({ to: 'flinch', conditions: [{ param: 'hurt', op: 'trigger' }], duration: 0.1 });
    });

    it('refuses what would not run, naming it', () => {
        const state = (s: unknown) => ({ initial: 'a', parameters: [{ name: 'speed', type: 'float' }, { name: 'go', type: 'bool' }], states: [s] });
        expect(() => validateModelSource(source(controller, []))).toThrow(/this source has none/);
        expect(() => validateModelSource(source({ ...controller, initial: 'nope' }))).toThrow(/initial "nope" is not a state/);
        expect(() => validateModelSource(source(state({ name: 'a', clip: 'fly' })))).toThrow(/plays "fly", which is not an animation; there are idle, walk, hit/);
        expect(() => validateModelSource(source(state({ name: 'a' })))).toThrow(/exactly one of clip, blend/);
        expect(() => validateModelSource(source(state({ name: 'a', clip: 'idle', transitions: [{ to: 'b' }] })))).toThrow(/goes to "b", which is not a state/);
        expect(() => validateModelSource(source(state({ name: 'a', clip: 'idle', transitions: [{ to: 'a', when: [{ param: 'nope', op: 'true' }] }] })))).toThrow(/reads "nope", which is not a parameter/);
        expect(() => validateModelSource(source(state({ name: 'a', clip: 'idle', transitions: [{ to: 'a', when: [{ param: 'speed', op: 'true' }] }] })))).toThrow(/true reads a bool/);
        expect(() => validateModelSource(source(state({ name: 'a', clip: 'idle', transitions: [{ to: 'a', when: [{ param: 'go', op: 'gt', value: 1 }] }] })))).toThrow(/gt compares a float/);
        expect(() => validateModelSource(source(state({ name: 'a', blend: { parameter: 'go', stops: [{ value: 0, clip: 'idle' }] } })))).toThrow(/chosen by a float parameter/);
    });
});

const closed = (m: BakedModel): void => {
    expect(m.report.openEdges).toBe(0);
    expect(m.report.nonManifoldEdges).toBe(0);
    expect(m.report.flippedEdges).toBe(0);
    expect(m.report.insideOutShells).toBe(0);
};
function volume(m: BakedModel): number {
    let v = 0;
    for (const { v: [a, b, c] } of m.triangles) {
        const [p, q, r] = [m.poly.positions[a]!, m.poly.positions[b]!, m.poly.positions[c]!];
        v += p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
    }
    return v / 6;
}
const model = (...steps: ModelStep[]): BakedModel => bakeModel({ version: 1, steps });

describe('subdivide', () => {
    it('rounds a cube toward its limit: inside the cage, closed, and getting there', () => {
        const levels = [1, 2, 3].map((n) => model({ op: 'box', size: 2 }, { op: 'subdivide', levels: n }));
        for (const m of levels) closed(m);
        expect(levels[0]!.report.faces).toBe(24);
        expect(levels[1]!.report.faces).toBe(96);
        const v = levels.map(volume);
        expect(v[0]!).toBeLessThan(8);
        expect(v[1]!).toBeLessThan(v[0]!);
        expect(v[0]! - v[1]!).toBeGreaterThan(v[1]! - v[2]!);
        const radii = levels[2]!.poly.positions.map((p) => Math.hypot(p[0], p[1], p[2]));
        expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(1.25); // nearly a ball
        expect(Math.max(...radii)).toBeLessThan(Math.sqrt(3));
    });

    it('is shaded smooth', () => {
        const m = model({ op: 'box', size: 2 }, { op: 'subdivide', levels: 2 });
        expect(m.poly.faces.every((f) => f.smooth)).toBe(true);
        expect(m.data.vertexCount).toBeLessThan(m.report.faces * 2.6);
    });

    it('crease keeps sharp edges on their line', () => {
        const m = model({ op: 'box', size: 2 }, { op: 'subdivide', levels: 2, crease: 45 });
        closed(m);
        expect(volume(m)).toBeCloseTo(8, 5); // every cube edge is sharper than 45, so nothing moves
    });

    it('acts on whole shells, leaving the rest', () => {
        const m = model({ op: 'box', size: 1, tag: 'a' }, { op: 'box', size: 1, at: [5, 0, 0], tag: 'b' }, { op: 'subdivide', faces: { tag: 'a', facing: '+y' }, levels: 1 });
        closed(m);
        expect(m.report.tags.a).toBe(24);
        expect(m.report.tags.b).toBe(6);
    });

    it('keeps tags and colour', () => {
        const m = model({ op: 'box', size: 1, tag: 'a', color: [1, 0, 0] }, { op: 'subdivide', levels: 1 });
        expect(m.poly.faces.every((f) => f.tag === 'a' && f.color![0] === 1)).toBe(true);
    });

    it('holds on a prism and after an extrude', () => {
        closed(model({ op: 'box', size: 1 }, { op: 'extrude', faces: '+y', distance: 1 }, { op: 'subdivide', levels: 2 }));
        closed(model({ op: 'prism', points: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], height: 1 }, { op: 'subdivide', levels: 1 }));
    });

    it('refuses what it cannot do', () => {
        expect(() => model({ op: 'box', size: 1 }, { op: 'subdivide', levels: 9 })).toThrow(/levels 9/);
        expect(() => model({ op: 'box', size: 1 }, { op: 'subdivide', crease: 200 })).toThrow(/crease 200/);
        expect(() => model({ op: 'box', size: 1 }, { op: 'subdivide', faces: 'nope' })).toThrow(/matched no face/);
    });
});

describe('a rounded bevel', () => {
    const chamfered = volume(model({ op: 'box', size: 2 }, { op: 'bevel', edges: 'all', width: 0.3 }));
    const rounded = (round: number): BakedModel => model({ op: 'box', size: 2 }, { op: 'bevel', edges: 'all', width: 0.3, round });

    it('stays closed at every level', () => {
        for (const n of [1, 2, 3]) closed(rounded(n));
    });

    it('takes less off than a chamfer does, each pass adding faces', () => {
        expect(rounded(1).report.faces).toBeGreaterThan(26);
        expect(rounded(2).report.faces).toBeGreaterThan(rounded(1).report.faces);
        // Corners cut again come off a chamfered body, so each pass is a little smaller, and all stay within the cube.
        expect(volume(rounded(1))).toBeLessThan(chamfered);
        expect(volume(rounded(2))).toBeLessThan(volume(rounded(1)));
        expect(volume(rounded(3))).toBeGreaterThan(8 * 0.8);
    });

    it('rounds one edge, and leaves the box flat elsewhere', () => {
        const m = model({ op: 'box', size: 2 }, { op: 'bevel', edges: { between: ['+y', '+z'] }, width: 0.3, round: 2 });
        closed(m);
        expect(m.report.bounds.size).toEqual([2, 2, 2]);
    });

    it('refuses a level past what it can do', () => {
        expect(() => model({ op: 'box', size: 2 }, { op: 'bevel', edges: 'all', width: 0.3, round: 9 })).toThrow(/round 9/);
    });
});

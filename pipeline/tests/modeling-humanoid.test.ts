// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** A person from a few numbers: whole from every side, on bones that fit, wearing clothes that move with them, and able to be held in a pose. */
import { describe, expect, it } from 'vitest';
import { bakeModel, buildPolyMesh, validateModelSource, type ModelStep } from '../src/modeling';
import { garment } from '../src/modeling/garment';
import { HUMANOID_TAGS, humanoidFrame, humanoidJoints } from '../src/modeling/humanoid';
import { organic, shapeField } from '../src/modeling/organic';
import { computeWornWeights, posedPositions, resolveJoints } from '../src/modeling/rig';
import type { PolyMesh, Vec3 } from '../src/modeling/polyMesh';

const build = (steps: ModelStep[]): PolyMesh => buildPolyMesh(validateModelSource({ version: 1, steps })).mesh;
const bounds = (m: PolyMesh, tag?: string): { min: number[]; max: number[] } => {
    const v = tag ? [...new Set(m.faces.filter((f) => f.tag === tag).flatMap((f) => [...f.v]))].map((i) => m.positions[i]!) : m.positions;
    return { min: [0, 1, 2].map((k) => Math.min(...v.map((p) => p[k]!))), max: [0, 1, 2].map((k) => Math.max(...v.map((p) => p[k]!))) };
};

/** Measured: 4e-5 as it is, 7e-4 with the rounded ends of neighbours left in, 6.6e-4 with no spline over the rows. */
const STRIPE_LIMIT = 1.5e-4;

describe('organic limb', () => {
    const limb = (extra: Record<string, unknown> = {}): PolyMesh => organic({ positions: [], faces: [] }, { resolution: 90, parts: [{
        shape: 'limb', curve: 4, sections: [{ at: [0, 0, 0], across: 0.2, front: 0.1, back: 0.3 }, { at: [0, 1, 0], across: 0.2, front: 0.1, back: 0.3 }], ...extra,
    }] as never });

    it('is an oval across, deeper behind than in front where it is told to be', () => {
        const b = bounds(limb());
        expect(b.max[0]).toBeCloseTo(0.2, 1);
        expect(b.min[0]).toBeCloseTo(-0.2, 1);
        expect(b.max[2]).toBeCloseTo(0.1, 1);
        expect(b.min[2]).toBeCloseTo(-0.3, 1);
    });

    it('rounds off past its ends, and passes through each section', () => {
        const b = bounds(limb());
        expect(b.max[1]).toBeGreaterThan(1.05);
        expect(b.max[1]).toBeLessThan(1.15);
        const taper = organic({ positions: [], faces: [] }, { resolution: 90, parts: [{ shape: 'limb', curve: 6, sections: [{ at: [0, 0, 0], across: 0.3, front: 0.3 }, { at: [0, 0.5, 0], across: 0.1, front: 0.1 }, { at: [0, 1, 0], across: 0.3, front: 0.3 }] }] });
        const waist = taper.positions.filter((p) => Math.abs(p[1] - 0.5) < 0.02).map((p) => Math.hypot(p[0], p[2]));
        expect(Math.max(...waist)).toBeLessThan(0.17);
        expect(Math.max(...waist)).toBeGreaterThan(0.08);
    });

    it('follows a path that is not straight, and `side` turns its width', () => {
        const flat = organic({ positions: [], faces: [] }, { resolution: 90, parts: [{ shape: 'limb', side: [0, 0, 1], sections: [{ at: [0, 0, 0], across: 0.3, front: 0.05 }, { at: [1, 0, 0], across: 0.3, front: 0.05 }] }] });
        const b = bounds(flat);
        expect(b.max[2]).toBeCloseTo(0.3, 1);
        expect(b.max[1]).toBeCloseTo(0.05, 1);
    });

    it('squares up with `power`', () => {
        const corner = (m: PolyMesh): number => Math.max(...m.positions.filter((p) => Math.abs(p[1] - 0.5) < 0.03).map((p) => Math.hypot(p[0], p[2])));
        const round = organic({ positions: [], faces: [] }, { resolution: 80, parts: [{ shape: 'limb', sections: [{ at: [0, 0, 0], across: 0.2, front: 0.2 }, { at: [0, 1, 0], across: 0.2, front: 0.2 }] }] });
        const square = organic({ positions: [], faces: [] }, { resolution: 80, parts: [{ shape: 'limb', power: 6, sections: [{ at: [0, 0, 0], across: 0.2, front: 0.2 }, { at: [0, 1, 0], across: 0.2, front: 0.2 }] }] });
        expect(corner(square)).toBeGreaterThan(corner(round) * 1.1);
    });

    it('has no stripe across it: the slope does not jump from one row of its table to the next', () => {
        // On the field itself: a mesh's grid is coarser than what is being asked. How far out the surface is, found by halving, at closely spaced heights.
        const { field } = shapeField({ shape: 'limb', curve: 4, sections: [{ at: [0, 0, 0], across: 0.3, front: 0.3 }, { at: [0, 0.4, 0], across: 0.2, front: 0.2 }, { at: [0, 0.8, 0], across: 0.32, front: 0.32 }, { at: [0, 1.2, 0], across: 0.2, front: 0.2 }] });
        const radiusAt = (y: number): number => {
            let [lo, hi] = [0, 1];
            for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (field(mid, y, 0) < 0) lo = mid; else hi = mid; }
            return lo;
        };
        const profile: number[] = [];
        for (let y = 0.1; y < 1.1; y += 0.002) profile.push(radiusAt(y));
        let worst = 0;
        for (let i = 1; i + 1 < profile.length; i++) worst = Math.max(worst, Math.abs(profile[i - 1]! - 2 * profile[i]! + profile[i + 1]!));
        expect(worst).toBeLessThan(STRIPE_LIMIT);
    });

    it('refuses what cannot be drawn', () => {
        expect(() => organic({ positions: [], faces: [] }, { parts: [{ shape: 'limb', sections: [{ at: [0, 0, 0], across: 1, front: 1 }] }] })).toThrow(/at least 2 sections/);
        expect(() => organic({ positions: [], faces: [] }, { parts: [{ shape: 'limb', sections: [{ at: [0, 0, 0], across: 0, front: 1 }, { at: [0, 1, 0], across: 1, front: 1 }] }] })).toThrow(/positive/);
        expect(() => organic({ positions: [], faces: [] }, { parts: [{ shape: 'limb', power: 0.5, sections: [{ at: [0, 0, 0], across: 1, front: 1 }, { at: [0, 1, 0], across: 1, front: 1 }] }] })).toThrow(/power/);
    });
});

describe('organic fine', () => {
    const parts = [{ shape: 'sphere' as const, radius: 1 }];
    it('splits only where it is asked, and what it splits still lies on the surface, in one skin', () => {
        const plain = organic({ positions: [], faces: [] }, { resolution: 30, parts });
        const fine = organic({ positions: [], faces: [] }, { resolution: 30, parts, fine: [{ at: [0, 0, 1], radius: 0.5, longest: 0.02 }] });
        expect(fine.positions.length).toBeGreaterThan(plain.positions.length * 2);
        for (const p of fine.positions) expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 1);
        const edges = new Map<string, number>();
        for (const f of fine.faces) f.v.forEach((a, i) => { const b = f.v[(i + 1) % f.v.length]!; const k = a < b ? `${a}:${b}` : `${b}:${a}`; edges.set(k, (edges.get(k) ?? 0) + 1); });
        expect([...edges.values()].filter((n) => n !== 2).length).toBeLessThan(fine.faces.length * 0.01);
        const far = fine.positions.filter((p) => p[2] < -0.5).length, farPlain = plain.positions.filter((p) => p[2] < -0.5).length;
        expect(far).toBe(farPlain);
    });

    it('finds there what the grid was too coarse to see', () => {
        const bump = organic({ positions: [], faces: [] }, { resolution: 24, blend: 0.01, parts: [{ shape: 'sphere', radius: 1 }, { shape: 'sphere', radius: 0.05, at: [0, 0, 1] }], fine: [{ at: [0, 0, 1], radius: 0.3, longest: 0.01 }] });
        expect(bounds(bump).max[2]).toBeGreaterThan(1.03);
    });
});

describe('humanoid', () => {
    const body = build([{ op: 'humanoid', resolution: 120 } as ModelStep]);

    it('stands where it says: feet on the floor, crown at its height, facing +z', () => {
        const b = bounds(body);
        expect(b.max[1]).toBeCloseTo(1.6, 1);
        expect(b.min[1]).toBeLessThan(0.02);
        expect(b.min[1]).toBeGreaterThan(-0.02);
        // Toes forward of heels, and a nose ahead of a skull's middle.
        const foot = bounds(body, 'foot');
        expect(foot.max[2]).toBeGreaterThan(0.15);
        expect(foot.min[2]).toBeGreaterThan(-0.12);
        expect(bounds(body, 'face').max[2]).toBeGreaterThan(0.06);
    });

    it('is a whole body from every side: the same on both sides of it, deep as well as wide', () => {
        const b = bounds(body);
        expect(b.min[0]).toBeCloseTo(-b.max[0]!, 1);
        // A chest has a front and a back.
        const chest = body.positions.filter((p) => Math.abs(p[1] - 1.15) < 0.02 && Math.abs(p[0]) < 0.1);
        expect(Math.max(...chest.map((p) => p[2]))).toBeGreaterThan(0.06);
        expect(Math.min(...chest.map((p) => p[2]))).toBeLessThan(-0.06);
    });

    it('has a person\'s parts, each tagged', () => {
        const tags = new Set(body.faces.map((f) => f.tag));
        for (const t of ['torso', 'arm', 'hand', 'leg', 'foot', 'face', 'scalp', 'ear', 'lips', 'lid', 'eye', 'iris']) expect(tags.has(t), t).toBe(true);
        for (const t of tags) expect(HUMANOID_TAGS.includes(t), t).toBe(true);
    });

    it('takes a build: taller is taller, and wider hips are wider', () => {
        const tall = build([{ op: 'humanoid', resolution: 120, height: 1.9 } as ModelStep]);
        expect(bounds(tall).max[1]).toBeCloseTo(1.9, 1);
        const wide = build([{ op: 'humanoid', resolution: 120, hips: 1.4 } as ModelStep]);
        const hips = (m: PolyMesh): number => Math.max(...m.positions.filter((p) => Math.abs(p[1] - 0.86) < 0.02 && Math.abs(p[0]) < 0.35).map((p) => p[0]));
        expect(hips(wide)).toBeGreaterThan(hips(build([{ op: 'humanoid', resolution: 120 } as ModelStep])) * 1.15);
    });

    it('closes its eyes', () => {
        const shut = build([{ op: 'humanoid', resolution: 120, eyes: 'closed' } as ModelStep]);
        expect(shut.faces.some((f) => f.tag === 'eye')).toBe(false);
        expect(shut.faces.some((f) => f.tag === 'lid')).toBe(true);
    });

    it('says what is wrong', () => {
        expect(() => build([{ op: 'humanoid', resolution: 10 } as ModelStep])).toThrow(/resolution/);
        expect(() => build([{ op: 'humanoid', height: -1 } as ModelStep])).toThrow(/height/);
        expect(() => build([{ op: 'humanoid', eyes: 'shut' } as ModelStep])).toThrow(/eyes/);
    });
});

describe('a humanoid\'s bones', () => {
    it('are laid in the body they are for, one root, both sides', () => {
        const joints = resolveJoints({ joints: humanoidJoints() });
        expect(joints.filter((j) => j.parent < 0).map((j) => j.name)).toEqual(['hips']);
        const names = joints.map((j) => j.name);
        for (const n of ['head', 'upperArm.L', 'upperArm.R', 'hand.L', 'index3.R', 'thumb2.L', 'thigh.R', 'foot.L', 'toes.R']) expect(names).toContain(n);
        const at = (n: string): Vec3 => joints.find((j) => j.name === n)!.at;
        expect(at('upperArm.L')[0]).toBeGreaterThan(0);
        expect(at('upperArm.R')[0]).toBeCloseTo(-at('upperArm.L')[0], 6);
        expect(at('head')[1]).toBeGreaterThan(at('neck')[1]);
    });

    it('scale with the build', () => {
        const short = humanoidFrame({ height: 0.8 });
        expect(short.crown[1]).toBeCloseTo(0.8, 5);
        expect(humanoidFrame({ shoulders: 1.2 }).shoulder[0]).toBeGreaterThan(humanoidFrame().shoulder[0]);
    });

    it('come from `rig.humanoid`, and bend her: a raised arm goes up and a foot stays put', () => {
        const source = validateModelSource({
            version: 1, rig: { humanoid: true },
            animations: [{ name: 'wave', duration: 1, tracks: [{ joint: 'upperArm.L', rotate: [[0, 0, 0, 70]] }] }],
            steps: [{ op: 'humanoid', resolution: 120 }],
        });
        const baked = bakeModel(source);
        const rig = baked.rig!;
        expect(rig.joints.length).toBeGreaterThan(40);
        const moved = posedPositions(baked.poly, rig.joints, rig.skin, source.animations![0]!, 0);
        const hand = baked.poly.faces.filter((f) => f.tag === 'hand').flatMap((f) => [...f.v]).filter((v) => baked.poly.positions[v]![0] > 0.3);
        const wasUp = Math.max(...hand.map((v) => baked.poly.positions[v]![1]));
        expect(Math.max(...hand.map((v) => moved[v]![1]))).toBeGreaterThan(wasUp + 0.2);
        const foot = baked.poly.faces.filter((f) => f.tag === 'foot').flatMap((f) => [...f.v]);
        for (const v of foot.slice(0, 50)) expect(moved[v]![1]).toBeCloseTo(baked.poly.positions[v]![1], 3);
    });

    it('add to any given', () => {
        const source = validateModelSource({ version: 1, rig: { humanoid: true, joints: [{ name: 'bow', at: [0.6, 1, 0], parent: 'hand.L' }] }, steps: [{ op: 'box', size: 1 }] });
        expect(source.rig!.joints.some((j) => j.name === 'bow')).toBe(true);
        expect(source.rig!.joints.some((j) => j.name === 'hips')).toBe(true);
    });
});

describe('garment', () => {
    const ball: ModelStep = { op: 'sphere', radius: 1, rings: 24, sides: 32, tag: 'body' };

    it('stands off the surface by its ease, and keeps what it was made from', () => {
        const m = build([ball, { op: 'garment', faces: 'body', ease: 0.1, relax: 0, tag: 'coat' } as ModelStep]);
        expect(m.faces.some((f) => f.tag === 'body')).toBe(true);
        const coat = m.faces.filter((f) => f.tag === 'coat').flatMap((f) => [...f.v]);
        for (const v of coat.slice(0, 100)) expect(Math.hypot(...m.positions[v]!)).toBeCloseTo(1.1, 1);
    });

    it('relaxes across a hollow it would otherwise follow', () => {
        const dented = (relax: number): number => {
            const body: PolyMesh = organic({ positions: [], faces: [] }, { resolution: 60, tag: 'body', blend: 0.02, parts: [{ shape: 'sphere', radius: 1 }, { shape: 'sphere', radius: 0.3, at: [0, 0, 1], subtract: true }] });
            const m = garment(body, { faces: 'body', ease: 0.02, relax, tag: 'coat' });
            const near = m.faces.filter((f) => f.tag === 'coat').flatMap((f) => [...f.v]).map((v) => m.positions[v]!).filter((p) => Math.hypot(p[0], p[1]) < 0.05 && p[2] > 0);
            return Math.max(...near.map((p) => p[2]));
        };
        expect(dented(30)).toBeGreaterThan(dented(0) + 0.02);
    });

    it('is cut clean at a plane: the hem is a level line and nothing goes past it', () => {
        const m = build([ball, { op: 'garment', faces: 'body', ease: 0.05, relax: 0, tag: 'coat', cut: [{ at: [0, 0.2, 0], keep: [0, 1, 0] }] } as ModelStep]);
        const coat = m.faces.filter((f) => f.tag === 'coat').flatMap((f) => [...f.v]).map((v) => m.positions[v]!);
        expect(Math.min(...coat.map((p) => p[1]))).toBeCloseTo(0.2, 6);
        expect(coat.filter((p) => Math.abs(p[1] - 0.2) < 1e-6).length).toBeGreaterThan(8);
    });

    it('cuts both sides of a mirror', () => {
        const m = build([ball, { op: 'garment', faces: 'body', ease: 0.05, relax: 0, tag: 'coat', cut: [{ at: [0.5, 0, 0], keep: [-1, 0, 0], mirror: 'x' }] } as ModelStep]);
        const b = bounds(m, 'coat');
        expect(b.max[0]).toBeCloseTo(0.5, 6);
        expect(b.min[0]).toBeCloseTo(-0.5, 6);
    });

    it('has a thickness at its hem, and no inside a long way from one', () => {
        const m = build([ball, { op: 'garment', faces: 'body', ease: 0.05, relax: 0, tag: 'coat', thickness: 0.02, cut: [{ at: [0, 0.8, 0], keep: [0, -1, 0] }] } as ModelStep]);
        expect(m.faces.some((f) => f.tag === 'coatInside')).toBe(true);
        const outer = m.faces.filter((f) => f.tag === 'coat').length, inner = m.faces.filter((f) => f.tag === 'coatInside').length;
        expect(inner).toBeLessThan(outer);
        // A cloth with an edge is closed all the way round it.
        const edges = new Map<string, number>();
        for (const f of m.faces.filter((q) => q.tag === 'coat' || q.tag === 'coatInside')) f.v.forEach((a, i) => { const b = f.v[(i + 1) % f.v.length]!; const k = a < b ? `${a}:${b}` : `${b}:${a}`; edges.set(k, (edges.get(k) ?? 0) + 1); });
        const hem = [...edges.keys()].filter((k) => edges.get(k) === 1).map((k) => k.split(':').map(Number)).filter(([a]) => Math.abs(m.positions[a!]![1] - 0.8) < 1e-6);
        expect(hem).toHaveLength(0);
    });

    it('grows along a line with `loose`, more at the end asked, on both sides with a mirror', () => {
        const m = build([{ op: 'box', size: [4, 0.4, 0.4], tag: 'body' }, { op: 'subdivide', levels: 3 } as ModelStep, { op: 'garment', faces: { tag: 'body' }, ease: 0, relax: 0, tag: 'sleeve', loose: [{ from: [0, 0, 0], to: [2, 0, 0], ease: [0, 0.5], mirror: 'x' }] } as ModelStep]);
        const sleeve = m.faces.filter((f) => f.tag === 'sleeve').flatMap((f) => [...f.v]).map((v) => m.positions[v]!);
        const radius = (x: number): number => Math.max(...sleeve.filter((p) => Math.abs(p[0] - x) < 0.25).map((p) => Math.hypot(p[1], p[2])));
        expect(radius(1.4)).toBeGreaterThan(radius(0.4) + 0.1);
        expect(radius(-1.4)).toBeCloseTo(radius(1.4), 3);
    });

    it('hangs with `hang`, the underside the most', () => {
        const m = build([{ op: 'box', size: [2, 0.4, 0.4], tag: 'body', at: [1, 0, 0] }, { op: 'subdivide', levels: 3 } as ModelStep, { op: 'garment', faces: { tag: 'body' }, ease: 0, relax: 0, tag: 'sleeve', loose: [{ from: [0, 0, 0], to: [2, 0, 0], hang: [0, 0.3] }] } as ModelStep]);
        const low = (tag: string, x: number): number => Math.min(...m.faces.filter((f) => f.tag === tag).flatMap((f) => [...f.v]).map((v) => m.positions[v]!).filter((p) => Math.abs(p[0] - x) < 0.2).map((p) => p[1]));
        expect(low('sleeve', 1.7)).toBeLessThan(low('body', 1.7) - 0.1);
        expect(low('sleeve', 0.2)).toBeGreaterThan(low('sleeve', 1.7));
    });

    it('takes away what it covers when told to, and leaves a margin at its hem', () => {
        const before = build([ball]);
        const m = build([ball, { op: 'garment', faces: 'body', ease: 0.05, relax: 0, tag: 'coat', hide: true, cut: [{ at: [0, 0, 0], keep: [0, 1, 0] }] } as ModelStep]);
        const body = m.faces.filter((f) => f.tag === 'body');
        expect(body.length).toBeLessThan(before.faces.length);
        // The body past the hem is there, and a little way under it too.
        const lowest = Math.max(...body.flatMap((f) => [...f.v]).map((v) => m.positions[v]![1]));
        expect(lowest).toBeGreaterThan(0.05);
    });

    it('says what is wrong', () => {
        expect(() => build([ball, { op: 'garment', faces: 'nothing' } as ModelStep])).toThrow(/matched no face/);
        expect(() => build([ball, { op: 'garment', faces: 'body', thickness: 0 } as ModelStep])).toThrow(/thickness/);
        expect(() => build([ball, { op: 'garment', faces: 'body', cut: [{ at: [0, 5, 0], keep: [0, 1, 0] }] } as ModelStep])).toThrow(/leaves nothing/);
        expect(() => validateModelSource({ steps: [ball, { op: 'garment', faces: 'body', cut: [{ at: [0, 0] }] }] })).toThrow(/cut/);
    });
});

describe('what a body wears moves with it', () => {
    it('takes its weights from the nearest skin: arm and sleeve turn together, and the arm stays inside', () => {
        const mesh = build([
            { op: 'humanoid', resolution: 120 } as ModelStep,
            { op: 'garment', faces: { tag: 'arm' }, ease: 0.012, relax: 4, tag: 'sleeve' } as ModelStep,
        ]);
        const joints = resolveJoints({ joints: humanoidJoints() });
        const skin = computeWornWeights(mesh, joints, new Set(HUMANOID_TAGS));
        const moved = posedPositions(mesh, joints, skin, { name: 'p', duration: 1, tracks: [{ joint: 'forearm.L', rotate: [[0, 0, -90, 0]] }] }, 0);
        const verts = (tag: string): number[] => [...new Set(mesh.faces.filter((f) => f.tag === tag).flatMap((f) => [...f.v]))].filter((v) => mesh.positions[v]![0] > 0.3);
        const arm = verts('arm'), sleeve = verts('sleeve');
        // Each point of the sleeve keeps its distance from the arm it was around.
        const sample = sleeve.filter((_, i) => i % 7 === 0);
        let worst = 0;
        for (const s of sample) {
            let near = Infinity;
            for (const a of arm) {
                const [p, q] = [moved[s]!, moved[a]!];
                near = Math.min(near, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
            }
            worst = Math.max(worst, near);
        }
        expect(worst).toBeLessThan(0.07);
    }, 60000);

    it('falls back to finding them when nothing is a body', () => {
        const mesh = build([{ op: 'box', size: 1, tag: 'block' }]);
        const joints = resolveJoints({ joints: [{ name: 'a', at: [0, 0, 0] }, { name: 'b', at: [0, 1, 0], parent: 'a' }] });
        expect(computeWornWeights(mesh, joints, new Set(['torso'])).joints.length).toBe(mesh.positions.length * 4);
    });
});

describe('pose', () => {
    const steps = (pose: Record<string, unknown>): ModelStep[] => [{ op: 'humanoid', resolution: 120 } as ModelStep, { op: 'pose', humanoid: true, ...pose } as ModelStep];

    it('holds a body in a pose by angles: a thigh raised, the other foot where it was', () => {
        const m = build(steps({ rotate: { 'thigh.L': [-90, 0, 0] } }));
        const leftFoot = m.faces.filter((f) => f.tag === 'foot').flatMap((f) => [...f.v]).map((v) => m.positions[v]!);
        expect(Math.max(...leftFoot.filter((p) => p[0] > 0).map((p) => p[2]))).toBeGreaterThan(0.5);
        expect(Math.min(...leftFoot.filter((p) => p[0] < 0).map((p) => p[1]))).toBeLessThan(0.03);
    });

    it('puts a hand where it is told, with `reach`', () => {
        const target: Vec3 = [0.25, 1.1, 0.4];
        const m = build(steps({ reach: { 'hand.L': { at: target, pole: [1, -1, -0.5] } } }));
        const wrist = humanoidFrame().wrist;
        const near = m.faces.filter((f) => f.tag === 'hand').flatMap((f) => [...f.v]).map((v) => m.positions[v]!).filter((p) => p[0] > 0);
        const best = Math.min(...near.map((p) => Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2])));
        expect(best).toBeLessThan(0.05);
        expect(Math.max(...near.map((p) => p[2]))).toBeGreaterThan(wrist[2] + 0.3);
    });

    it('carries a whole mesh on one joint with `rigid`', () => {
        const before = build([{ op: 'box', size: 0.1, at: [0, 1.5, 0], tag: 'prop' }]);
        const m = build([{ op: 'box', size: 0.1, at: [0, 1.5, 0], tag: 'prop' }, { op: 'pose', humanoid: true, rigid: 'head', rotate: { head: [90, 0, 0] } } as ModelStep]);
        // Turned about the head's joint as one thing: every length in it is the same.
        const span = (q: PolyMesh): number => Math.hypot(q.positions[0]![0] - q.positions[6]![0], q.positions[0]![1] - q.positions[6]![1], q.positions[0]![2] - q.positions[6]![2]);
        expect(span(m)).toBeCloseTo(span(before), 5);
        expect(m.positions[0]).not.toEqual(before.positions[0]);
    });

    it('says what is wrong', () => {
        expect(() => build(steps({ rotate: { wing: [0, 0, 0] } }))).toThrow(/no joint "wing"/);
        expect(() => build(steps({ rigid: 'tail' }))).toThrow(/no joint "tail"/);
        expect(() => validateModelSource({ steps: [{ op: 'box', size: 1 }, { op: 'pose', humanoid: true, rotate: { head: [1] } }] })).toThrow(/rotate/);
        expect(() => validateModelSource({ steps: [{ op: 'box', size: 1 }, { op: 'pose', humanoid: true, reach: { 'hand.L': {} } }] })).toThrow(/reach/);
        expect(() => validateModelSource({ steps: [{ op: 'box', size: 1 }, { op: 'pose' }] })).toThrow(/humanoid/);
    });
});

describe('folds', () => {
    /** How much the height differs, on average, between two places this far apart on the sheet. */
    const difference = (m: PolyMesh, [dx, dz]: readonly [number, number]): number => {
        const cell = 0.03;
        const grid = new Map<string, number>();
        for (const p of m.positions) grid.set(`${Math.round(p[0] / cell)},${Math.round(p[2] / cell)}`, p[1]);
        let sum = 0, n = 0;
        for (let x = -0.8; x <= 0.7; x += 0.06) {
            for (let z = -0.8; z <= 0.7; z += 0.06) {
                const a = grid.get(`${Math.round(x / cell)},${Math.round(z / cell)}`);
                const b = grid.get(`${Math.round((x + dx) / cell)},${Math.round((z + dz) / cell)}`);
                if (a !== undefined && b !== undefined) { sum += Math.abs(a - b); n++; }
            }
        }
        return sum / Math.max(1, n);
    };
    const sheet = (along?: Vec3): PolyMesh => build([{ op: 'plane', size: 2, tag: 'cloth' }, { op: 'displace', faces: 'cloth', pattern: 'folds', scale: 0.2, amplitude: 0.05, long: 5, octaves: 1, detail: 0.02, ...(along ? { along } : { along: [1, 0, 0] }) } as ModelStep]);

    it('runs along the way it is told: smooth that way, and rising and falling across it', () => {
        const m = sheet([1, 0, 0]);
        expect(difference(m, [0, 0.1])).toBeGreaterThan(difference(m, [0.1, 0]) * 1.5);
        // Told the other way, the other way.
        const turned = sheet([0, 0, 1]);
        expect(difference(turned, [0.1, 0])).toBeGreaterThan(difference(turned, [0, 0.1]) * 1.5);
    });

    it('is the same every time', () => {
        expect(sheet().positions).toEqual(sheet().positions);
    });
});

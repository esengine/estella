// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a foot stands on the ground the probe reports, measured as a distance,
 * while a foot the clip lifted stays that far off it.
 */
import { describe, it, expect } from 'vitest';
import { Pose, solveAnimatorIK, type AnimatorIK, type GroundProbe } from '../src/animation';
import { Parent, Children, Name, Transform } from '../src/ecs/component';
import { q } from '../src/math/quat';

interface Vec3 { x: number; y: number; z: number }

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        insert(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
        set(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        tryGet(e: number, c: unknown) { return mapOf(c).get(e) ?? null; },
    } as any;
}

const RIG = 1, PELVIS = 2, THIGH = 3, SHIN = 4, FOOT = 5;
const identity = () => ({ w: 1, x: 0, y: 0, z: 0 });

/** Rig on the floor; pelvis at height 2; thigh, shin and foot straight down with a slight knee, so the foot rests at 0. */
function leg(world: any, footAt = 0, rig: Partial<{ position: Vec3; rotation: any; scale: Vec3 }> = {}) {
    const node = (id: number, parent: number | null, name: string, at: Vec3) => {
        world.insert(id, Name, { value: name });
        world.insert(id, Transform, { position: at, rotation: identity(), scale: { x: 1, y: 1, z: 1 } });
        if (parent !== null) {
            world.insert(id, Parent, { entity: parent });
            const held = world.tryGet(parent, Children) as { entities: number[] } | null;
            world.insert(parent, Children, { entities: [...(held?.entities ?? []), id] });
        }
    };
    node(RIG, null, 'Rig', { x: 0, y: 0, z: 0 });
    world.set(RIG, Transform, { ...world.get(RIG, Transform), ...rig });
    node(PELVIS, RIG, 'Pelvis', { x: 0, y: 2, z: 0 });
    node(THIGH, PELVIS, 'Thigh', { x: 0, y: 0, z: 0 });
    node(SHIN, THIGH, 'Shin', { x: 0, y: -1, z: 0.05 });
    node(FOOT, SHIN, 'Foot', { x: 0, y: -1 + footAt, z: -0.05 });
}

const resolve = (_root: number, path: string): number | null => ({ 'Pelvis/Thigh/Shin/Foot': FOOT, Pelvis: PELVIS } as Record<string, number>)[path] ?? null;
const plant: AnimatorIK = { kind: 'foot-plant', tip: 'Pelvis/Thigh/Shin/Foot', target: '', smooth: 0 };

function rigSpace(world: any, entity: number): { p: Vec3; r: any } {
    const chain: number[] = [];
    for (let at = entity; at !== RIG; at = world.get(at, Parent).entity) chain.unshift(at);
    let p: Vec3 = { x: 0, y: 0, z: 0 };
    let r: any = identity();
    for (const e of chain) {
        const t = world.get(e, Transform);
        const d = q.rotate(r, t.position);
        p = { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z };
        r = q.mul(r, t.rotation);
    }
    return { p, r };
}

const flat = (y: number, normal: Vec3 = { x: 0, y: 1, z: 0 }): GroundProbe => (origin, drop) => (origin.y - drop <= y && origin.y >= y ? { y, normal } : null);

/** The rest of the context a rig keeps between frames, per memory map. */
const rests = new WeakMap<object, Map<any, any>>();
function solve(world: any, ik: AnimatorIK, probe: GroundProbe | null, memory = new Map(), dt = 1 / 60): void {
    const pose = new Pose();
    pose.reset();
    if (!rests.has(memory)) rests.set(memory, new Map());
    solveAnimatorIK(world, RIG, pose, [ik], {}, resolve, { probe, dt, memory, rest: rests.get(memory)! });
    pose.applyTo(world);
}

describe('foot-plant', () => {
    it('with no probe leaves the clip alone: a game with no physics is not broken by one', () => {
        const world = makeWorld();
        leg(world);
        const before = world.get(SHIN, Transform).rotation;
        solve(world, plant, null);
        expect(world.get(SHIN, Transform).rotation).toEqual(before);
    });

    it('stands on raised ground: the foot rises to it and the knee bends', () => {
        const world = makeWorld();
        leg(world);
        solve(world, plant, flat(0.4));
        const { p } = rigSpace(world, FOOT);
        expect(p.y).toBeCloseTo(0.4, 4);
        expect(p.x).toBeCloseTo(0, 4);
        expect(rigSpace(world, SHIN).p.z).toBeGreaterThan(0.2);
    });

    it('is left where it is on the ground it was already on', () => {
        const world = makeWorld();
        leg(world);
        solve(world, plant, flat(0));
        expect(rigSpace(world, FOOT).p.y).toBeCloseTo(0, 4);
    });

    it('a foot the clip lifted stays that far off the ground', () => {
        const world = makeWorld();
        leg(world, 0.2);
        solve(world, plant, flat(0.4));
        expect(rigSpace(world, FOOT).p.y).toBeCloseTo(0.6, 4);
    });

    it('below the leg it stretches as far as it can, and with a pelvis reaches', () => {
        const alone = makeWorld();
        leg(alone);
        solve(alone, plant, flat(-0.5));
        expect(rigSpace(alone, FOOT).p.y).toBeGreaterThan(-0.05);
        const world = makeWorld();
        leg(world);
        solve(world, { ...plant, pelvis: 'Pelvis' }, flat(-0.5));
        expect(rigSpace(world, FOOT).p.y).toBeCloseTo(-0.5, 3);
        expect(rigSpace(world, PELVIS).p.y).toBeCloseTo(1.5, 4);
    });

    it('rising ground leaves the pelvis where it is: the knees take it', () => {
        const world = makeWorld();
        leg(world);
        solve(world, { ...plant, pelvis: 'Pelvis' }, flat(0.4));
        expect(rigSpace(world, PELVIS).p.y).toBeCloseTo(2, 5);
    });

    it('lies along the slope under it, and no steeper than a foot can', () => {
        const up = (w: any) => q.rotate(rigSpace(w, FOOT).r, { x: 0, y: 1, z: 0 });
        const n = { x: 0, y: Math.cos(0.3), z: Math.sin(0.3) };
        const world = makeWorld();
        leg(world);
        solve(world, plant, flat(0, n));
        expect(up(world).z).toBeCloseTo(n.z, 3);
        expect(up(world).y).toBeCloseTo(n.y, 3);
        const wall = makeWorld();
        leg(wall);
        solve(wall, plant, flat(0, { x: 0, y: 0, z: 1 }));
        expect(Math.acos(up(wall).y)).toBeCloseTo(Math.PI / 4, 3);
        const off = makeWorld();
        leg(off);
        solve(off, { ...plant, align: false }, flat(0, n));
        expect(up(off).z).toBeLessThan(0.2); // bent only as far as the leg bends it
    });

    it('with nothing under it goes back to the clip', () => {
        const world = makeWorld();
        leg(world);
        const memory = new Map();
        solve(world, plant, flat(0.4), memory);
        expect(rigSpace(world, FOOT).p.y).toBeCloseTo(0.4, 4);
        solve(world, plant, () => null, memory);
        expect(rigSpace(world, FOOT).p.y).toBeCloseTo(0, 4);
    });

    it('eases onto a new height rather than jumping', () => {
        const world = makeWorld();
        leg(world);
        const memory = new Map();
        const eased = { ...plant, smooth: 0.1 };
        solve(world, eased, flat(0), memory);
        const key = `${RIG}/${plant.tip}`;
        expect(memory.get(key).lift).toBeCloseTo(0, 5);
        solve(world, eased, flat(0.4), memory, 1 / 60);
        const first = memory.get(key).lift;
        expect(first).toBeGreaterThan(0.01);
        expect(first).toBeLessThan(0.2);
        for (let i = 0; i < 120; i++) solve(world, eased, flat(0.4), memory, 1 / 60);
        expect(memory.get(key).lift).toBeCloseTo(0.4, 3);
        expect(rigSpace(world, FOOT).p.y).toBeCloseTo(0.4, 3);
    });

    it('reads a rig scaled and moved in the world', () => {
        const world = makeWorld();
        leg(world, 0, { position: { x: 5, y: 10, z: 0 }, scale: { x: 3, y: 3, z: 3 } });
        const seen: Vec3[] = [];
        solve(world, plant, (o, d) => { seen.push(o); return { y: 10.6, normal: { x: 0, y: 1, z: 0 } }; });
        expect(seen[0]!.x).toBeCloseTo(5, 5);
        // Up by the leg's 2 units, scaled by 3, from where the foot stands at world height 10.
        expect(seen[0]!.y).toBeCloseTo(16, 1);
        expect(rigSpace(world, FOOT).p.y).toBeCloseTo(0.2, 3); // 0.6 in the world is 0.2 in the rig
    });

    it('asks for the layers it was told, and half weight goes half way', () => {
        const world = makeWorld();
        leg(world);
        let layers = -1;
        solve(world, { ...plant, layers: 4 }, (o, d, l) => { layers = l; return { y: 0, normal: { x: 0, y: 1, z: 0 } }; });
        expect(layers).toBe(4);
        const half = makeWorld();
        leg(half);
        solve(half, { ...plant, weight: 0.5, align: false }, flat(0.4));
        const y = rigSpace(half, FOOT).p.y;
        expect(y).toBeGreaterThan(0.05);
        expect(y).toBeLessThan(0.35);
    });

    it('does not feed on itself: a joint no clip keys is measured from its rest, not the solve of the last frame', () => {
        const world = makeWorld();
        leg(world);
        const memory = new Map();
        const heights: number[] = [];
        for (let i = 0; i < 6; i++) {
            solve(world, plant, flat(0.4), memory);
            heights.push(rigSpace(world, FOOT).p.y);
        }
        for (const h of heights) expect(h).toBeCloseTo(0.4, 4);
    });

    it('runs before the others: a look-at reads a body already standing', () => {
        const world = makeWorld();
        leg(world);
        world.insert(9, Name, { value: 'Goal' });
        const pose = new Pose();
        pose.reset();
        const look: AnimatorIK = { kind: 'look-at', tip: 'Pelvis/Thigh/Shin/Foot', target: 'nope' };
        solveAnimatorIK(world, RIG, pose, [look, plant], {}, resolve, { probe: flat(0.4), dt: 1 / 60, memory: new Map() });
        pose.applyTo(world);
        expect(rigSpace(world, FOOT).p.y).toBeCloseTo(0.4, 4);
    });
});

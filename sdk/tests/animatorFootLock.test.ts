// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a foot the clip has down stays on the ground point it landed on while the rig turns and moves over it, takes
 * a step when the rig has gone too far, and is let go the moment the clip lifts it.
 */
import { describe, it, expect } from 'vitest';
import { Pose, solveAnimatorIK, type AnimatorIK, type GroundContext } from '../src/animation';
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

/** The leg as the clip states it this frame: down from a pelvis at 2 with the knee bent forward, the foot `lifted` off the floor and `side` out from under it. */
function clip(world: any, lifted = 0, side = 0.3): void {
    const node = (id: number, parent: number | null, name: string, at: Vec3) => {
        world.insert(id, Name, { value: name });
        world.insert(id, Transform, { position: at, rotation: identity(), scale: { x: 1, y: 1, z: 1 } });
        if (parent !== null && !world.has(id, Parent)) {
            world.insert(id, Parent, { entity: parent });
            const held = world.tryGet(parent, Children) as { entities: number[] } | null;
            world.insert(parent, Children, { entities: [...(held?.entities ?? []), id] });
        }
    };
    if (!world.has(RIG, Transform)) node(RIG, null, 'Rig', { x: 0, y: 0, z: 0 });
    node(PELVIS, RIG, 'Pelvis', { x: 0, y: 2, z: 0 });
    node(THIGH, PELVIS, 'Thigh', { x: side, y: 0, z: 0 });
    node(SHIN, THIGH, 'Shin', { x: 0, y: -1, z: 0.4 });
    node(FOOT, SHIN, 'Foot', { x: 0, y: -1 + lifted, z: -0.4 });
}

const resolve = (_root: number, path: string): number | null =>
    ({ 'Pelvis/Thigh/Shin/Foot': FOOT, Pelvis: PELVIS } as Record<string, number>)[path] ?? null;
const lock: AnimatorIK = { kind: 'foot-lock', tip: 'Pelvis/Thigh/Shin/Foot', target: '' };

/** Where the foot is in the world, and the heading its own Z points along. */
function footInWorld(world: any): { at: Vec3; yaw: number } {
    let p: Vec3 = { x: 0, y: 0, z: 0 };
    let r: any = identity();
    for (const e of [PELVIS, THIGH, SHIN, FOOT]) {
        const t = world.get(e, Transform);
        const d = q.rotate(r, t.position);
        p = { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z };
        r = q.mul(r, t.rotation);
    }
    const rig = world.get(RIG, Transform);
    const moved = q.rotate(rig.rotation, p);
    const along = q.rotate(q.mul(rig.rotation, r), { x: 0, y: 0, z: 1 });
    return {
        at: { x: rig.position.x + moved.x, y: rig.position.y + moved.y, z: rig.position.z + moved.z },
        yaw: Math.atan2(along.x, along.z) * 180 / Math.PI,
    };
}

function rigAt(world: any, yawDeg: number, x = 0): void {
    const t = world.get(RIG, Transform);
    world.set(RIG, Transform, { ...t, position: { x, y: 0, z: 0 }, rotation: q.axis('y', yawDeg * Math.PI / 180) });
}

/** One frame: the clip states the leg, the constraint bends it. */
function frame(world: any, ground: GroundContext, ik: AnimatorIK = lock, lifted = 0): void {
    clip(world, lifted);
    const pose = new Pose();
    pose.reset();
    solveAnimatorIK(world, RIG, pose, [ik], {}, resolve, ground);
    pose.applyTo(world);
}

const context = (dt = 1 / 60): GroundContext => ({ probe: null, dt, memory: new Map() });

describe('a foot the clip has down', () => {
    it('stays on its ground point while the rig turns over it', () => {
        const world = makeWorld();
        const ground = context();
        frame(world, ground);
        const stood = footInWorld(world);

        rigAt(world, 25);
        frame(world, ground);
        const now = footInWorld(world);
        expect(now.at.x).toBeCloseTo(stood.at.x, 3);
        expect(now.at.z).toBeCloseTo(stood.at.z, 3);
        expect(now.yaw).toBeCloseTo(stood.yaw, 2);
    });

    it('and while the rig is carried a little way off it', () => {
        const world = makeWorld();
        const ground = context();
        frame(world, ground);
        const stood = footInWorld(world);

        rigAt(world, 0, 0.3);
        frame(world, ground);
        expect(footInWorld(world).at.x).toBeCloseTo(stood.at.x, 3);
    });

    it('keeps the height the clip gave it: over the ground only', () => {
        const world = makeWorld();
        const ground = context();
        frame(world, ground);
        rigAt(world, 25);
        frame(world, ground);
        expect(footInWorld(world).at.y).toBeCloseTo(0, 3);
    });
});

describe('a rig that has turned too far over a standing foot', () => {
    it('has the foot take a step to where the clip now puts it', () => {
        const world = makeWorld();
        const ground = context();
        frame(world, ground);
        const stood = footInWorld(world);

        rigAt(world, 60);
        // The step takes 0.18 s: it is in the air on the way, and down again where the clip has it by the end.
        let highest = 0;
        for (let i = 0; i < 20; i++) {
            frame(world, ground);
            highest = Math.max(highest, footInWorld(world).at.y);
        }
        const landed = footInWorld(world);
        expect(highest).toBeGreaterThan(0.05);
        expect(landed.at.y).toBeCloseTo(0, 3);
        expect(Math.hypot(landed.at.x - stood.at.x, landed.at.z - stood.at.z)).toBeGreaterThan(0.2);
        expect(landed.yaw).toBeCloseTo(60, 1);
    });

    it('and holds it there afterwards', () => {
        const world = makeWorld();
        const ground = context();
        frame(world, ground);
        rigAt(world, 60);
        for (let i = 0; i < 20; i++) frame(world, ground);
        const landed = footInWorld(world);

        rigAt(world, 75);
        frame(world, ground);
        expect(footInWorld(world).at.x).toBeCloseTo(landed.at.x, 3);
        expect(footInWorld(world).at.z).toBeCloseTo(landed.at.z, 3);
    });
});

describe('a foot the clip lifts', () => {
    it('is let go: it goes where the clip swings it', () => {
        const world = makeWorld();
        const ground = context();
        frame(world, ground);
        rigAt(world, 25);
        frame(world, ground);

        // Half a second in the air is many times what letting go takes.
        for (let i = 0; i < 30; i++) frame(world, ground, lock, 0.4);
        const swung = footInWorld(world);
        const clipOnly = makeWorld();
        clip(clipOnly, 0.4);
        rigAt(clipOnly, 25);
        const stated = footInWorld(clipOnly);
        expect(swung.at.x).toBeCloseTo(stated.at.x, 3);
        expect(swung.at.z).toBeCloseTo(stated.at.z, 3);
    });

    it('and is held again where it comes down', () => {
        const world = makeWorld();
        const ground = context();
        frame(world, ground);
        for (let i = 0; i < 30; i++) frame(world, ground, lock, 0.4);
        rigAt(world, 25);
        frame(world, ground);
        const landed = footInWorld(world);

        rigAt(world, 40);
        frame(world, ground);
        expect(footInWorld(world).at.x).toBeCloseTo(landed.at.x, 3);
        expect(footInWorld(world).at.z).toBeCloseTo(landed.at.z, 3);
    });
});

describe('a foot with a toe', () => {
    const TOE = 6;
    /** The same leg with the ball of the foot ahead of the ankle, and the ankle `raised` as a heel coming up over it. */
    const withToe = (world: any, ground: GroundContext, raised = 0): void => {
        clip(world);
        const foot = world.get(FOOT, Transform);
        world.set(FOOT, Transform, { ...foot, position: { x: 0, y: -1 + raised, z: -0.4 + raised * 0.5 } });
        world.insert(TOE, Name, { value: 'Toe' });
        world.insert(TOE, Transform, { position: { x: 0, y: -raised, z: 0.3 - raised * 0.5 }, rotation: identity(), scale: { x: 1, y: 1, z: 1 } });
        world.insert(TOE, Parent, { entity: FOOT });
        world.insert(FOOT, Children, { entities: [TOE] });
        const pose = new Pose();
        pose.reset();
        solveAnimatorIK(world, RIG, pose, [lock], {}, resolve, ground);
        pose.applyTo(world);
    };
    const toeInWorld = (world: any): Vec3 => {
        let p: Vec3 = { x: 0, y: 0, z: 0 };
        let r: any = identity();
        for (const e of [PELVIS, THIGH, SHIN, FOOT, TOE]) {
            const t = world.get(e, Transform);
            const d = q.rotate(r, t.position);
            p = { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z };
            r = q.mul(r, t.rotation);
        }
        const rig = world.get(RIG, Transform);
        const moved = q.rotate(rig.rotation, p);
        return { x: rig.position.x + moved.x, y: rig.position.y + moved.y, z: rig.position.z + moved.z };
    };

    it('is held by the ball of the foot: the ankle is free to come up over it', () => {
        const world = makeWorld();
        const ground = context();
        withToe(world, ground);
        const ankle = footInWorld(world).at;

        // The heel comes up: the ankle rises and goes forward while the ball of the foot stays where it is in the clip.
        withToe(world, ground, 0.2);
        const now = footInWorld(world).at;
        expect(now.y).toBeCloseTo(ankle.y + 0.2, 3);
        expect(now.z).toBeCloseTo(ankle.z + 0.1, 3);
    });

    it('and that is the point that stays put when the rig turns', () => {
        const world = makeWorld();
        const ground = context();
        withToe(world, ground);
        const stood = toeInWorld(world);

        rigAt(world, 25);
        withToe(world, ground);
        const now = toeInWorld(world);
        expect(now.x).toBeCloseTo(stood.x, 2);
        expect(now.z).toBeCloseTo(stood.z, 2);
    });
});

describe('a constraint weighted to nothing', () => {
    it('leaves the clip alone', () => {
        const world = makeWorld();
        const ground = context();
        frame(world, ground, { ...lock, weight: 0 });
        rigAt(world, 25);
        frame(world, ground, { ...lock, weight: 0 });
        expect(world.get(SHIN, Transform).rotation).toEqual(identity());
    });
});

describe('a lock taken up again', () => {
    it('holds where the foot is now, not where it held the last time', () => {
        const world = makeWorld();
        const ground = context();
        frame(world, ground);
        // Let go of, and the rig carried a long way off while it was.
        frame(world, ground, { ...lock, weight: 0 });
        rigAt(world, 0, 3);
        frame(world, ground, { ...lock, weight: 0 });
        const free = footInWorld(world).at;

        frame(world, ground);
        expect(footInWorld(world).at.x).toBeCloseTo(free.x, 3);
    });
});

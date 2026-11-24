// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a stride warp moves a foot along the way the character is going, about the hip, by how its speed compares
 * with the clip's, and leaves its height, its sideways place and the way it faces alone.
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

/** A leg striding forward: the foot `ahead` in front of the hip along +Z, the knee bent forward. */
function leg(world: any, ahead: number): void {
    const node = (id: number, parent: number | null, name: string, at: Vec3, rotation = identity()) => {
        world.insert(id, Name, { value: name });
        world.insert(id, Transform, { position: at, rotation, scale: { x: 1, y: 1, z: 1 } });
        if (parent !== null) {
            world.insert(id, Parent, { entity: parent });
            const held = world.tryGet(parent, Children) as { entities: number[] } | null;
            world.insert(parent, Children, { entities: [...(held?.entities ?? []), id] });
        }
    };
    node(RIG, null, 'Rig', { x: 0, y: 0, z: 0 });
    node(PELVIS, RIG, 'Pelvis', { x: 0, y: 1.8, z: 0 });
    node(THIGH, PELVIS, 'Thigh', { x: 0.2, y: 0, z: 0 });
    node(SHIN, THIGH, 'Shin', { x: 0, y: -0.9, z: ahead / 2 + 0.2 });
    node(FOOT, SHIN, 'Foot', { x: 0, y: -0.9, z: ahead / 2 - 0.2 }, q.axis('x', 0.3));
}

const resolve = (_root: number, path: string): number | null =>
    ({ 'Pelvis/Thigh/Shin/Foot': FOOT } as Record<string, number>)[path] ?? null;
const warp: AnimatorIK = { kind: 'stride-warp', tip: 'Pelvis/Thigh/Shin/Foot', target: '' };

function placed(world: any, entity: number): { p: Vec3; r: any } {
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

function solve(world: any, ratio: number, direction: Vec3 = { x: 0, y: 0, z: 1 }, ik: AnimatorIK = warp): void {
    const ground: GroundContext = { probe: null, dt: 1 / 60, memory: new Map(), stride: { ratio, direction } };
    const pose = new Pose();
    pose.reset();
    solveAnimatorIK(world, RIG, pose, [ik], {}, resolve, ground);
    pose.applyTo(world);
}

describe('a stride warp', () => {
    it('lets a foot out by the ratio when the character goes faster than the clip', () => {
        const world = makeWorld();
        leg(world, 0.4);
        const before = placed(world, FOOT).p;
        solve(world, 1.5);
        const after = placed(world, FOOT).p;
        // 0.4 ahead of the hip becomes 0.6.
        expect(after.z).toBeCloseTo(0.6, 2);
        expect(after.y).toBeCloseTo(before.y, 1);
        expect(after.x).toBeCloseTo(before.x, 1);
    });

    it('draws a foot behind the hip in too', () => {
        const world = makeWorld();
        leg(world, -0.4);
        solve(world, 0.5);
        expect(placed(world, FOOT).p.z).toBeCloseTo(-0.2, 3);
    });

    it('keeps the way the foot faces', () => {
        const world = makeWorld();
        leg(world, 0.4);
        const before = placed(world, FOOT).r;
        solve(world, 1.5);
        const after = placed(world, FOOT).r;
        expect(Math.abs(q.mul(q.conjugate(before), after).w)).toBeCloseTo(1, 4);
    });

    it('scales along the way the character goes, not the way the rig faces', () => {
        const world = makeWorld();
        leg(world, 0.4);
        // Going sideways: the forward reach is not along it, and stays.
        solve(world, 1.5, { x: 1, y: 0, z: 0 });
        expect(placed(world, FOOT).p.z).toBeCloseTo(0.4, 3);
    });

    it('holds within its limits', () => {
        const world = makeWorld();
        leg(world, 0.4);
        solve(world, 5, undefined, { ...warp, maxStride: 1.25 });
        expect(placed(world, FOOT).p.z).toBeCloseTo(0.5, 3);
    });
});

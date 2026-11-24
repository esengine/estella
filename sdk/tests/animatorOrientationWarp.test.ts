// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: an orientation warp turns the hips by the angle between the way the character goes and the way its motion
 * goes, within its limit, and turns the spine back by as much, so the chest still faces where it did.
 */
import { describe, it, expect } from 'vitest';
import { Pose, solveAnimatorIK, type AnimatorIK, type GroundContext } from '../src/animation';
import { Parent, Children, Name, Transform } from '../src/ecs/component';
import { q } from '../src/math/quat';

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

const RIG = 1, HIPS = 2, SPINE = 3, CHEST = 4, THIGH = 5;
const identity = () => ({ w: 1, x: 0, y: 0, z: 0 });

function rig(world: any): void {
    const node = (id: number, parent: number | null, name: string, y: number) => {
        world.insert(id, Name, { value: name });
        world.insert(id, Transform, { position: { x: 0, y, z: 0 }, rotation: identity(), scale: { x: 1, y: 1, z: 1 } });
        if (parent !== null) {
            world.insert(id, Parent, { entity: parent });
            const held = world.tryGet(parent, Children) as { entities: number[] } | null;
            world.insert(parent, Children, { entities: [...(held?.entities ?? []), id] });
        }
    };
    node(RIG, null, 'Rig', 0);
    node(HIPS, RIG, 'Hips', 1);
    node(SPINE, HIPS, 'Spine', 0.2);
    node(CHEST, SPINE, 'Chest', 0.2);
    node(THIGH, HIPS, 'Thigh', -0.1);
}

const paths: Record<string, number> = { Hips: HIPS, 'Hips/Spine': SPINE, 'Hips/Spine/Chest': CHEST };
const resolve = (_root: number, path: string): number | null => paths[path] ?? null;
const warp: AnimatorIK = { kind: 'orientation-warp', tip: 'Hips', target: '', spine: ['Hips/Spine', 'Hips/Spine/Chest'] };

/** The yaw a joint ends up at in the rig, degrees. */
function yawOf(world: any, entity: number): number {
    let r: any = identity();
    const chain: number[] = [];
    for (let at = entity; at !== RIG; at = world.get(at, Parent).entity) chain.unshift(at);
    for (const e of chain) r = q.mul(r, world.get(e, Transform).rotation);
    const z = q.rotate(r, { x: 0, y: 0, z: 1 });
    return Math.atan2(z.x, z.z) * 180 / Math.PI;
}

function solve(world: any, angleDeg: number, ik: AnimatorIK = warp): void {
    const ground: GroundContext = {
        probe: null, dt: 1 / 60, memory: new Map(),
        stride: { ratio: 1, direction: { x: 0, y: 0, z: 1 }, angle: angleDeg * Math.PI / 180 },
    };
    const pose = new Pose();
    pose.reset();
    solveAnimatorIK(world, RIG, pose, [ik], {}, resolve, ground);
    pose.applyTo(world);
}

describe('an orientation warp', () => {
    it('turns the hips, and the legs under them, by the angle', () => {
        const world = makeWorld();
        rig(world);
        solve(world, 30);
        expect(yawOf(world, HIPS)).toBeCloseTo(30, 3);
        expect(yawOf(world, THIGH)).toBeCloseTo(30, 3);
    });

    it('turns the spine back by as much, so the chest faces where it did', () => {
        const world = makeWorld();
        rig(world);
        solve(world, 30);
        expect(yawOf(world, SPINE)).toBeCloseTo(15, 3);
        expect(yawOf(world, CHEST)).toBeCloseTo(0, 3);
    });

    it('holds within its limit', () => {
        const world = makeWorld();
        rig(world);
        solve(world, 170, { ...warp, maxAngle: 60 });
        expect(yawOf(world, HIPS)).toBeCloseTo(60, 3);
        expect(yawOf(world, CHEST)).toBeCloseTo(0, 3);
    });

    it('does nothing weighted to nothing, or with nothing to turn by', () => {
        const world = makeWorld();
        rig(world);
        solve(world, 30, { ...warp, weight: 0 });
        expect(yawOf(world, HIPS)).toBeCloseTo(0, 6);
        solve(world, 0);
        expect(yawOf(world, HIPS)).toBeCloseTo(0, 6);
    });
});

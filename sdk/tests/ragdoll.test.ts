// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, Parent, getComponent, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { Ragdoll, planRagdoll, installRagdolls, type RagdollBone, type RagdollData } from '../src/physics3d/ragdoll';
import { RigidBody3D, BoxCollider3D } from '../src/physics3d/Physics3DComponents';
import { SwingTwistJoint3D } from '../src/physics3d/AdvancedJoint3D';
import { HAS_WASM, WASM_DIR, loadWasmModule } from './helpers/loadWasm';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPhysics3DModule, type Physics3DModuleFactory } from '../src/physics3d/Physics3DModule';
import { stepPhysics3D, DEFAULT_PHYSICS3D_CONFIG } from '../src/physics3d/Physics3DSystem';

const bone = (id: number, parent: number | null, x: number, y: number, z = 0, rotation = { w: 1, x: 0, y: 0, z: 0 }): RagdollBone =>
    ({ id, parent, position: { x, y, z }, rotation });
const options = { thickness: 0.25, minBoneLength: 0.05 };

describe('planRagdoll', () => {
    it('gives each bone a box along the line to its child, joined to the bone above', () => {
        const limbs = planRagdoll([bone(1, null, 0, 0), bone(2, 1, 0, 1), bone(3, 2, 0, 2)], options);
        expect(limbs.map((l) => [l.entity, l.connected])).toEqual([[1, null], [2, 1], [3, 2]]);
        const [pelvis] = limbs;
        // 1 long, along y: half 0.5 along it and a quarter of the length across.
        expect(pelvis!.halfExtents).toEqual({ x: 0.25, y: 0.5, z: 0.25 });
        expect(pelvis!.center).toEqual({ x: 0, y: 0.5, z: 0 });
        expect(pelvis!.axis).toEqual({ x: 0, y: 1, z: 0 });
    });

    it('takes the line and half the length of the bone above for one with no child', () => {
        const limbs = planRagdoll([bone(1, null, 0, 0), bone(2, 1, 0, 2)], options);
        const hand = limbs.find((l) => l.entity === 2)!;
        expect(hand.halfExtents.y).toBeCloseTo(0.5);
        expect(hand.center.y).toBeCloseTo(0.5);
    });

    it('puts the long side along whichever of the bone\'s own axes the line follows', () => {
        // Turned a quarter about z, so the bone\'s local x is the world\'s y.
        const s = Math.SQRT1_2;
        const limbs = planRagdoll([bone(1, null, 0, 0, 0, { w: s, x: 0, y: 0, z: s }), bone(2, 1, 0, 2)], options);
        const first = limbs[0]!;
        expect(first.halfExtents.x).toBeCloseTo(1);
        expect(first.halfExtents.y).toBeCloseTo(0.5);
        expect(first.axis.x).toBeCloseTo(1);
        expect(first.center.x).toBeCloseTo(1);
    });

    it('leaves a short bone without a limb, and the bone above carries it', () => {
        // A fingertip 0.01 past the wrist: neither it nor the nub beyond it is long enough for a body.
        const limbs = planRagdoll([bone(1, null, 0, 0), bone(2, 1, 0, 1), bone(3, 2, 0, 2), bone(4, 3, 0, 2.01)], options);
        expect(limbs.map((l) => l.entity)).toEqual([1, 2]);
        expect(limbs.find((l) => l.entity === 2)!.connected).toBe(1);
    });

    it('joins what hangs from a bone with no limb to the limb above it', () => {
        // Bone 2 is 0.01 long (to its only child), so it has none; bone 3 is joined straight to bone 1.
        const limbs = planRagdoll([bone(1, null, 0, 0), bone(2, 1, 0, 1), bone(3, 2, 0, 1.01), bone(4, 3, 0, 2)], options);
        expect(limbs.some((l) => l.entity === 2)).toBe(false);
        expect(limbs.find((l) => l.entity === 3)!.connected).toBe(1);
    });

    it('gives a twist reference that is perpendicular to the twist axis', () => {
        for (const l of planRagdoll([bone(1, null, 0, 0), bone(2, 1, 1, 1, 0.5), bone(3, 2, 2, 1, 1)], options)) {
            expect(l.axis.x * l.normalAxis.x + l.axis.y * l.normalAxis.y + l.axis.z * l.normalAxis.z).toBeCloseTo(0, 6);
        }
    });

    it('is nothing from nothing, or from a single bone', () => {
        expect(planRagdoll([], options)).toEqual([]);
        expect(planRagdoll([bone(1, null, 0, 0)], options)).toEqual([]);
    });
});

describe.skipIf(!HAS_WASM)('the Ragdoll system', () => {
    let engine: ESEngineModule, registry: CppRegistry, world: World;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => { ensureBuiltinComponentsRegistered(); registry = new engine.Registry(); world = new World(); world.connectCpp(registry, engine); });
    afterEach(() => { for (const e of world.getAllEntities()) world.despawn(e); world.disconnectCpp(); registry.delete(); });

    /** A character: a root with a Ragdoll, and a skin whose three joints hang one from the next. */
    function character(over: Partial<RagdollData> = {}) {
        const systems: Array<{ _fn: (...a: unknown[]) => void }> = [];
        const app = { world, addSystemToSchedule: (_s: unknown, def: { _fn: () => void }) => { systems.push(def); } };
        installRagdolls(app as never);
        const root = world.spawn();
        world.insert(root, Transform);
        const joints: number[] = [];
        let parent: number = root as number;
        for (let i = 0; i < 3; i++) {
            const j = world.spawn();
            world.insert(j, Transform, { position: { x: 0, y: i === 0 ? 0 : 1, z: 0 } });
            world.insert(j, Parent, { entity: parent });
            joints.push(j as number);
            parent = j as number;
        }
        const skin = getComponent('MeshSkin')!;
        world.insert(root, skin, { joints });
        world.insert(root, Ragdoll, { active: false, skin: 0, swing: 45, twist: 30, thickness: 0.25, minBoneLength: 0.05, friction: 0.5, recoverTime: 0, ...over });
        return { root, joints, run: () => { for (const s of systems) s._fn({ delta: 0.016 }); } };
    }

    it('gives the bones bodies and joints when it goes limp', () => {
        const { root, joints, run } = character();
        run();
        expect(world.has(joints[0] as never, RigidBody3D)).toBe(false);
        world.insert(root, Ragdoll, { ...(world.get(root, Ragdoll) as RagdollData), active: true });
        run();
        for (const j of joints) {
            expect(world.has(j as never, RigidBody3D)).toBe(true);
            expect(world.has(j as never, BoxCollider3D)).toBe(true);
        }
        // The topmost hangs from nothing; the others from the one above.
        expect(world.has(joints[0] as never, SwingTwistJoint3D)).toBe(false);
        expect((world.get(joints[1] as never, SwingTwistJoint3D) as { connectedEntity: number }).connectedEntity).toBe(joints[0]);
    });

    it('takes the bodies away when it stands up', () => {
        const { root, joints, run } = character();
        world.insert(root, Ragdoll, { ...(world.get(root, Ragdoll) as RagdollData), active: true });
        run();
        world.insert(root, Ragdoll, { ...(world.get(root, Ragdoll) as RagdollData), active: false });
        run();
        for (const j of joints) {
            expect(world.has(j as never, RigidBody3D)).toBe(false);
            expect(world.has(j as never, SwingTwistJoint3D)).toBe(false);
        }
    });
});

const HAS_SOLVER = HAS_WASM && existsSync(resolve(WASM_DIR, 'physics3d.wasm'));

/** The real solver: a character dropped on a floor falls, comes to rest on it, and stays in one piece. */
describe.skipIf(!HAS_SOLVER)('a ragdoll under the real solver', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });

    it('falls onto the floor with its bones still joined', async () => {
        const raw = (await import(/* @vite-ignore */ pathToFileURL(resolve(WASM_DIR, 'physics3d.js')).href)) as { default: (o: object) => Promise<never> };
        const wasmBinary = readFileSync(resolve(WASM_DIR, 'physics3d.wasm'));
        const factory = (() => raw.default({ wasmBinary })) as unknown as Physics3DModuleFactory;
        const module = await loadPhysics3DModule('', factory);
        const config = { ...DEFAULT_PHYSICS3D_CONFIG, pixelsPerUnit: 1 };
        module._physics3d_init(0, -9.81, 0, 256);

        ensureBuiltinComponentsRegistered();
        const registry = new engine.Registry();
        const world = new World();
        world.connectCpp(registry, engine);
        try {
            // A floor, its top at y = 0.
            const floor = world.spawn();
            world.insert(floor, Transform, { position: { x: 0, y: -1, z: 0 } });
            world.insert(floor, RigidBody3D, { bodyType: 0, enabled: true });
            world.insert(floor, BoxCollider3D, { halfExtents: { x: 50, y: 1, z: 50 }, center: { x: 0, y: 0, z: 0 }, friction: 0.5, restitution: 0, isSensor: false, enabled: true });

            // Three bones one above the next, a metre apart, the lowest at y = 3.
            const systems: Array<{ _fn: (...a: unknown[]) => void }> = [];
            const app = { world, addSystemToSchedule: (_s: unknown, def: { _fn: () => void }) => { systems.push(def); } };
            installRagdolls(app as never);
            const root = world.spawn();
            world.insert(root, Transform);
            const joints: Entity[] = [];
            let parent: Entity = root;
            for (let i = 0; i < 4; i++) {
                const j = world.spawn();
                world.insert(j, Transform, { position: { x: 0, y: i === 0 ? 3 : 1, z: 0 } });
                world.insert(j, Parent, { entity: parent });
                joints.push(j);
                parent = j;
            }
            world.insert(root, getComponent('MeshSkin')!, { joints });
            world.insert(root, Ragdoll, { active: true, skin: 0, swing: 45, twist: 30, thickness: 0.2, minBoneLength: 0.05, friction: 0.5, recoverTime: 0 });
            for (const s of systems) s._fn({ delta: 1 / 60 });

            const bodies = new Map<Entity, number>(), joint3 = new Map<never, never>();
            const at = (e: Entity): { x: number; y: number; z: number } => (world.get(e, Transform) as { worldPosition: { x: number; y: number; z: number } }).worldPosition;
            for (let i = 0; i < 240; i++) {
                stepPhysics3D({ world } as never, module, bodies, config, new Map(), undefined, joint3 as never, new Map(), null);
            }
            world.ensureTransformsComposed();

            for (const j of joints) {
                const p = at(j);
                expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
                // Fell from 3 to 6, and is lying on or above the floor.
                expect(p.y).toBeLessThan(6);
                expect(p.y).toBeGreaterThan(-0.1);
            }
            // The topmost bone has come down from where it was.
            expect(at(joints[0]!).y).toBeLessThan(2.5);
            // Still one body: each bone about its length from the one above (the joint holds them there).
            for (let i = 1; i < joints.length; i++) {
                const a = at(joints[i - 1]!), b = at(joints[i]!);
                expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(0.7);
                expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1.3);
            }
        } finally {
            for (const e of world.getAllEntities()) world.despawn(e);
            world.disconnectCpp();
            registry.delete();
            module._physics3d_shutdown();
        }
    });
});

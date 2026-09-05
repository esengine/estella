// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which SPACE the 3D solver's answer arrives in.
 *
 * A body is handed to the solver at its composed WORLD pose, so what comes back
 * is a world pose too. `Transform.position` is the local input the composer
 * builds that world pose FROM — writing one into the other adds the parent's
 * transform a second time. These run against the real composer, so the
 * round-trip is a checked claim rather than a reading of the arithmetic.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { Transform } from '../src/ecs/component';
import type { TransformData } from '../src/ecs/component.generated';
import {
    RigidBody3D, BoxCollider3D, CharacterController3D,
} from '../src/physics3d/Physics3DComponents';
import { stepPhysics3D, DEFAULT_PHYSICS3D_CONFIG } from '../src/physics3d/Physics3DSystem';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import type { Entity } from '../src/types';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const PPU = DEFAULT_PHYSICS3D_CONFIG.pixelsPerUnit;

/** The solver, reduced to what it publishes: body poses and a character result. */
function poseSource() {
    const heap = new Float32Array(4096);
    const query = heap.subarray(1024);
    let bodyBytes = 0;
    let queryBytes = 0;
    const id = (() => { let n = 0; return () => ++n; })();
    return {
        publishBodies(records: number[]) { heap.set(records, 0); bodyBytes = records.length * 4; },
        publishCharacter(records: number[]) { query.set(records, 0); queryBytes = records.length * 4; },
        module: {
            HEAPF32: heap,
            HEAPU32: new Uint32Array(heap.buffer),
            _physics3d_isReady: () => 1,
            _physics3d_step: () => 0,
            _physics3d_addBox: () => id(),
            _physics3d_addCharacter: () => id(),
            _physics3d_moveCharacter: () => 0,
            _physics3d_removeBody: () => 0,
            _physics3d_removeCharacter: () => 0,
            _physics3d_setTransform: () => 0,
            _physics3d_transforms: () => 0,
            _physics3d_transformsBytes: () => bodyBytes,
            _physics3d_queryResult: () => 1024 * 4,
            _physics3d_queryResultBytes: () => queryBytes,
            _physics3d_contactEntersBytes: () => 0,
            _physics3d_contactExitsBytes: () => 0,
            _physics3d_sensorEntersBytes: () => 0,
            _physics3d_sensorExitsBytes: () => 0,
            _malloc: () => 0,
            _free: () => {},
        } as unknown as Physics3DWasmModule,
    };
}

describe.skipIf(!HAS_WASM)('the 3D solver answers in world space', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });

    function scene() {
        const app = App.new();
        app.connectCpp(new engine.Registry() as unknown as CppRegistry, engine);
        return { app, world: app.world };
    }
    const local = (app: App, e: Entity) => (app.world.get(e, Transform) as TransformData).position;
    const composed = (app: App, e: Entity) => {
        app.world.ensureTransformsComposed();
        return (app.world.get(e, Transform) as TransformData).worldPosition;
    };
    const composedRotation = (app: App, e: Entity) => {
        app.world.ensureTransformsComposed();
        return (app.world.get(e, Transform) as TransformData).worldRotation;
    };

    function body(app: App, e: Entity) {
        app.world.insert(e, RigidBody3D, { bodyType: 2 });
        app.world.insert(e, BoxCollider3D, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
    }

    it('a parented body: the solver pose is world, and the local input is solved for', () => {
        const { app, world } = scene();
        const parent = world.spawn('parent');
        world.insert(parent, Transform, { position: { x: 100, y: 0, z: 0 } });
        const child = world.spawn('child');
        world.insert(child, Transform, { position: { x: 5, y: 0, z: 0 } });
        world.setParent(child, parent);
        body(app, child);
        world.ensureTransformsComposed();

        const src = poseSource();
        src.publishBodies([child as number, 130 / PPU, 0, 0, 0, 0, 0, 1]);
        stepPhysics3D(app, src.module, new Map(), DEFAULT_PHYSICS3D_CONFIG);

        expect(local(app, child).x).toBeCloseTo(30, 3);
        expect(composed(app, child).x).toBeCloseTo(130, 3);
        world.disconnectCpp();
    });

    it('a parented body under a rotated parent round-trips position and rotation', () => {
        const { app, world } = scene();
        const h = Math.PI / 4;   // a quarter turn about Z
        const parent = world.spawn('parent');
        world.insert(parent, Transform, {
            position: { x: 100, y: 0, z: 0 },
            rotation: { w: Math.cos(h), x: 0, y: 0, z: Math.sin(h) },
        });
        const child = world.spawn('child');
        world.insert(child, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.setParent(child, parent);
        body(app, child);
        world.ensureTransformsComposed();

        const src = poseSource();
        // World (130, 0, 0), unrotated: the parent's turn has to come out of both.
        src.publishBodies([child as number, 130 / PPU, 0, 0, 0, 0, 0, 1]);
        stepPhysics3D(app, src.module, new Map(), DEFAULT_PHYSICS3D_CONFIG);

        expect(local(app, child).x).toBeCloseTo(0, 3);
        expect(local(app, child).y).toBeCloseTo(-30, 3);
        expect(composed(app, child).x).toBeCloseTo(130, 3);
        expect(composed(app, child).y).toBeCloseTo(0, 3);
        // Identity in world, so the local rotation is the parent's turn undone.
        const r = composedRotation(app, child);
        expect(r.z).toBeCloseTo(0, 3);
        expect(Math.abs(r.w)).toBeCloseTo(1, 3);
        world.disconnectCpp();
    });

    it('a root body is unchanged: its local pose IS its world pose', () => {
        const { app, world } = scene();
        const e = world.spawn('root');
        world.insert(e, Transform, { position: { x: 7, y: 0, z: 0 } });
        body(app, e);
        world.ensureTransformsComposed();

        const src = poseSource();
        src.publishBodies([e as number, 250 / PPU, 3 / PPU, 0, 0, 0, 0, 1]);
        stepPhysics3D(app, src.module, new Map(), DEFAULT_PHYSICS3D_CONFIG);

        expect(local(app, e).x).toBeCloseTo(250, 3);
        expect(local(app, e).y).toBeCloseTo(3, 3);
        expect(composed(app, e).x).toBeCloseTo(250, 3);
        world.disconnectCpp();
    });

    it('a body handed to the solver and handed back unchanged has not moved', () => {
        const { app, world } = scene();
        const h = Math.PI / 6;
        const parent = world.spawn('parent');
        world.insert(parent, Transform, {
            position: { x: 40, y: -12, z: 7 },
            rotation: { w: Math.cos(h), x: 0, y: Math.sin(h), z: 0 },
        });
        const child = world.spawn('child');
        world.insert(child, Transform, {
            position: { x: 9, y: 4, z: -3 },
            rotation: { w: Math.cos(h), x: 0, y: 0, z: Math.sin(h) },
        });
        world.setParent(child, parent);
        body(app, child);
        world.ensureTransformsComposed();

        const before = { ...composed(app, child) };
        const beforeR = { ...composedRotation(app, child) };
        // What `createBody` sends is the composed world pose; the solver is asked
        // for nothing, so what it publishes back is the same pose.
        const src = poseSource();
        src.publishBodies([child as number, before.x / PPU, before.y / PPU, before.z / PPU,
            beforeR.x, beforeR.y, beforeR.z, beforeR.w]);
        stepPhysics3D(app, src.module, new Map(), DEFAULT_PHYSICS3D_CONFIG);

        const after = composed(app, child);
        expect(after.x).toBeCloseTo(before.x, 3);
        expect(after.y).toBeCloseTo(before.y, 3);
        expect(after.z).toBeCloseTo(before.z, 3);
        world.disconnectCpp();
    });

    it('a uniformly scaled parent scales the offset back out', () => {
        const { app, world } = scene();
        const parent = world.spawn('parent');
        world.insert(parent, Transform, {
            position: { x: 100, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 },
        });
        const child = world.spawn('child');
        world.insert(child, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.setParent(child, parent);
        body(app, child);
        world.ensureTransformsComposed();

        const src = poseSource();
        src.publishBodies([child as number, 130 / PPU, 0, 0, 0, 0, 0, 1]);
        stepPhysics3D(app, src.module, new Map(), DEFAULT_PHYSICS3D_CONFIG);

        // Thirty world units under a parent twice life size is fifteen local ones.
        expect(local(app, child).x).toBeCloseTo(15, 3);
        expect(composed(app, child).x).toBeCloseTo(130, 3);
        world.disconnectCpp();
    });

    it('non-uniform parent scale still puts the body where the solver said', () => {
        // The known limit is the skew between rotation and scale, which the
        // Transforms doc already names. WHERE the body is has an exact answer
        // under any scale, and it is the one this returns.
        const { app, world } = scene();
        const parent = world.spawn('parent');
        world.insert(parent, Transform, {
            position: { x: 10, y: -4, z: 2 }, scale: { x: 3, y: 0.5, z: 2 },
        });
        const child = world.spawn('child');
        world.insert(child, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.setParent(child, parent);
        body(app, child);
        world.ensureTransformsComposed();

        const src = poseSource();
        src.publishBodies([child as number, 130 / PPU, 20 / PPU, -6 / PPU, 0, 0, 0, 1]);
        stepPhysics3D(app, src.module, new Map(), DEFAULT_PHYSICS3D_CONFIG);

        const at = composed(app, child);
        expect(at.x).toBeCloseTo(130, 3);
        expect(at.y).toBeCloseTo(20, 3);
        expect(at.z).toBeCloseTo(-6, 3);
        world.disconnectCpp();
    });

    it('a parented character controller lands where the solver put it', () => {
        const { app, world } = scene();
        const parent = world.spawn('parent');
        world.insert(parent, Transform, { position: { x: 100, y: 0, z: 0 } });
        const child = world.spawn('walker');
        world.insert(child, Transform, { position: { x: 5, y: 0, z: 0 } });
        world.setParent(child, parent);
        world.insert(child, CharacterController3D, { enabled: true });
        world.ensureTransformsComposed();

        const src = poseSource();
        // [x, y, z, onGround, normal…, velocity…] in the module's layout.
        src.publishCharacter([130 / PPU, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
        stepPhysics3D(app, src.module, new Map(), DEFAULT_PHYSICS3D_CONFIG, new Map());

        expect(local(app, child).x).toBeCloseTo(30, 3);
        expect(composed(app, child).x).toBeCloseTo(130, 3);
        world.disconnectCpp();
    });
});

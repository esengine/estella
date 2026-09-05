// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Who authors a physics body's composed world transform.
 *
 * `position`/`rotation`/`scale` are the composition's input and `worldPosition`
 * and friends are its output, which one system authors. So these run against the
 * real composer and check that physics moves the world fields only through it —
 * including under a parent, where the solver's answer is not the local one.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform } from '../src/ecs/component';
import type { TransformData } from '../src/ecs/component';
import type { Entity } from '../src/types';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { applyPhysics2DTransforms } from '../src/physics/PhysicsSystem';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const PPU = 100;

/** The solver's answer, in the layout the module hands over: [entity, x, y, angle]. */
function poseBuffer(bodies: Array<{ entity: number; x: number; y: number; angle: number }>) {
    const ptr = 256;
    const buffer = new ArrayBuffer(ptr + bodies.length * 16);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    bodies.forEach((b, i) => {
        const base = (ptr >> 2) + i * 4;
        u32[base] = b.entity;
        f32[base + 1] = b.x;
        f32[base + 2] = b.y;
        f32[base + 3] = b.angle;
    });
    return { ptr, count: bodies.length, f32, u32, buffer };
}

function mockPhysics(buf: ReturnType<typeof poseBuffer>): PhysicsWasmModule {
    return {
        _physics_capturePoses: vi.fn(),
        _physics_getInterpolatedCount: () => buf.count,
        _physics_getInterpolatedTransforms: () => buf.ptr,
        HEAPF32: buf.f32,
        HEAPU32: buf.u32,
        HEAPU8: new Uint8Array(buf.buffer),
        _malloc: vi.fn(),
        _free: vi.fn(),
    } as unknown as PhysicsWasmModule;
}

describe.skipIf(!HAS_WASM)('physics writes transform inputs, not composed outputs', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    function scene() {
        const app = App.new();
        app.connectCpp(new module.Registry() as unknown as CppRegistry, module);
        const world = app.world;
        return { app, world };
    }
    const local = (world: App['world'], e: Entity) =>
        (world.get(e, Transform) as TransformData).position;
    const composed = (world: App['world'], e: Entity) =>
        (world.get(e, Transform) as TransformData).worldPosition;

    it('a root body: the solver pose becomes the local input, the composer the output', () => {
        const { app, world } = scene();
        const body = world.spawn('body');
        world.insert(body, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.ensureTransformsComposed();

        applyPhysics2DTransforms(app, PPU, new Set(),
            mockPhysics(poseBuffer([{ entity: body as number, x: 2.5, y: 0, angle: 0 }])), 1);

        expect(local(world, body).x).toBeCloseTo(250);
        world.ensureTransformsComposed();
        expect(composed(world, body).x).toBeCloseTo(250);
        world.disconnectCpp();
    });

    it('a parented body: the solver pose is world, and the local input is solved for', () => {
        const { app, world } = scene();
        const parent = world.spawn('parent');
        world.insert(parent, Transform, { position: { x: 100, y: 0, z: 0 } });
        const child = world.spawn('child');
        world.insert(child, Transform, { position: { x: 5, y: 0, z: 0 } });
        world.setParent(child, parent);
        world.ensureTransformsComposed();
        expect(composed(world, child).x).toBeCloseTo(105);

        // The solver knows only world space: this body is at 130, whoever its
        // parent is. What has to reach the Transform is 30.
        applyPhysics2DTransforms(app, PPU, new Set([child]),
            mockPhysics(poseBuffer([{ entity: child as number, x: 1.3, y: 0, angle: 0 }])), 1);

        expect(local(world, child).x).toBeCloseTo(30);
        world.ensureTransformsComposed();
        expect(composed(world, child).x).toBeCloseTo(130);
        world.disconnectCpp();
    });

    it('a parented body under a rotated parent round-trips through the composer', () => {
        const { app, world } = scene();
        const parent = world.spawn('parent');
        // A quarter turn about Z, at world (100, 0).
        const h = Math.PI / 4;
        world.insert(parent, Transform, {
            position: { x: 100, y: 0, z: 0 },
            rotation: { w: Math.cos(h), x: 0, y: 0, z: Math.sin(h) },
        });
        const child = world.spawn('child');
        world.insert(child, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.setParent(child, parent);
        world.ensureTransformsComposed();

        applyPhysics2DTransforms(app, PPU, new Set([child]),
            mockPhysics(poseBuffer([{ entity: child as number, x: 1.3, y: 0, angle: 0 }])), 1);

        // Rotating the offset back through the parent puts it on the parent's
        // local -Y, and composing turns it into world +X again.
        expect(local(world, child).x).toBeCloseTo(0);
        expect(local(world, child).y).toBeCloseTo(-30);
        world.ensureTransformsComposed();
        expect(composed(world, child).x).toBeCloseTo(130);
        expect(composed(world, child).y).toBeCloseTo(0, 3);
        world.disconnectCpp();
    });

    it('a physics step says the composition is stale, on either write path', () => {
        for (const parented of [false, true]) {
            const { app, world } = scene();
            const body = world.spawn('body');
            world.insert(body, Transform, { position: { x: 0, y: 0, z: 0 } });
            world.ensureTransformsComposed();

            const before = world.transformEpoch();
            applyPhysics2DTransforms(app, PPU, parented ? new Set([body]) : new Set(),
                mockPhysics(poseBuffer([{ entity: body as number, x: 1, y: 0, angle: 0 }])), 1);
            expect(world.transformEpoch(), parented ? 'per-body path' : 'batch path')
                .not.toBe(before);
            world.disconnectCpp();
        }
    });

    // Both paths, because one parented body sends EVERY body down the per-body
    // loop — so a scene without one never reaches the batched C++ write at all,
    // and a criterion that only builds parented scenes cannot see it author.
    it.each(['batch', 'per-body'] as const)(
        'the world fields do not move until the composer moves them (%s)', (path) => {
            const { app, world } = scene();
            const root = world.spawn('root');
            world.insert(root, Transform, { position: { x: 7, y: 0, z: 0 } });
            const parent = world.spawn('parent');
            world.insert(parent, Transform, { position: { x: 100, y: 0, z: 0 } });
            const child = world.spawn('child');
            world.insert(child, Transform, { position: { x: 5, y: 0, z: 0 } });
            world.setParent(child, parent);
            world.ensureTransformsComposed();

            const perBody = path === 'per-body';
            const bodies = [{ entity: root as number, x: 9, y: 0, angle: 0 }];
            if (perBody) bodies.push({ entity: child as number, x: 1.3, y: 0, angle: 0 });
            applyPhysics2DTransforms(app, PPU, perBody ? new Set([child]) : new Set(),
                mockPhysics(poseBuffer(bodies)), 1);

            // Physics has written its inputs and nothing else, so a reader that
            // has not composed still gets the answer from before the step.
            expect(composed(world, root).x).toBeCloseTo(7);
            if (perBody) expect(composed(world, child).x).toBeCloseTo(105);
            world.ensureTransformsComposed();
            expect(composed(world, root).x).toBeCloseTo(900);
            if (perBody) expect(composed(world, child).x).toBeCloseTo(130);
            world.disconnectCpp();
        });
});

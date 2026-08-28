// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The render system's frame order: the world's transforms resolve BEFORE
 *        the cameras are read.
 *
 * A camera's view matrix is built from its Transform's worldPosition, and the
 * transform pass is what writes it. With the pass behind the read (its old home,
 * inside submitScene) every camera was placed at the PREVIOUS frame's position
 * while the sprites drew at this frame's — so a camera moved in Update trailed
 * the world by exactly one frame, and the two only agreed while nothing moved.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';
import { cameraPlugin } from '../src/camera/CameraPlugin';
import { RenderPipeline } from '../src/render/renderPipeline';
import { setRendererBackend, type RendererBackend } from '../src/render/renderer';
import { defineSystem, Schedule } from '../src/ecs/system';
import { Camera, Transform, ProjectionType } from '../src/ecs/component';
import { Query, Mut } from '../src/ecs/query';
import type { Entity } from '../src/types';
import type { CppRegistry } from '../src/wasm';

/** Where a world point lands in clip space under a view-projection. */
const ndcX = (vp: Float32Array, x: number, y: number): number =>
    vp[0] * x + vp[4] * y + vp[12];

describe('render order: transforms resolve before cameras are read', () => {
    const calls: string[] = [];
    let lastViewProjection: Float32Array | null = null;
    let beginFrames = 0;

    /**
     * Stands in for the C++ renderer: `beginFrame` clears the transform pass's
     * once-per-frame memo (EngineState.transforms_updated) and the pass itself
     * does what TransformSystem does to a root — world TRS := local TRS.
     */
    function fakeBackend(registry: CppRegistry, roots: Entity[]): RendererBackend {
        let transformsUpdated = false;
        return {
            init: () => {}, resize: () => {},
            beginFrame: () => { transformsUpdated = false; beginFrames++; calls.push('beginFrame'); },
            updateTransforms: () => {
                calls.push('updateTransforms');
                if (transformsUpdated) return;
                transformsUpdated = true;
                for (const e of roots) {
                    const t = registry.getTransform(e) as unknown as
                        { position: { x: number; y: number; z: number } } | undefined;
                    if (!t) continue;
                    (registry as unknown as { addTransform(e: Entity, d: unknown): void })
                        .addTransform(e, { ...t, worldPosition: { ...t.position } });
                }
            },
            begin: (viewProjection) => { calls.push('begin'); lastViewProjection = viewProjection; },
            submitAll: () => { calls.push('submitAll'); },
            flush: () => {}, end: () => {},
            setStage: () => {}, setViewport: () => {},
            setYSortLayers: () => {}, setDepthLayers: () => {}, setCullingMask: () => {},
            getStats: () => ({ drawCalls: 0, triangles: 0, sprites: 0, text: 0, skeletal: 0, meshes: 0, culled: 0 }),
        };
    }

    beforeEach(() => {
        calls.length = 0; lastViewProjection = null; beginFrames = 0;
        // The plugin reads the clock at build time; nothing here needs a real one.
        setPlatform({ now: () => 0, devicePixelRatio: () => 1 } as unknown as PlatformAdapter);
    });
    afterEach(() => { setRendererBackend(null); });

    it('a camera moved in Update is looked through at THIS frame’s position', async () => {
        const { app, module } = bootMockApp();
        const registry = module.getRegistry() as unknown as Record<string, unknown> & CppRegistry;

        const cam = app.world.spawn('camera') as Entity;
        app.world.insert(cam, Transform, { position: { x: 0, y: 0, z: 0 } });
        app.world.insert(cam, Camera, {
            isActive: true, projectionType: ProjectionType.Orthographic, orthoSize: 300,
        });

        // The mock registry answers scene queries the C++ registry owns.
        registry.getCameraEntities = () => [cam];
        registry.getCanvasEntities = () => [];

        app.setPipeline(new RenderPipeline());
        setRendererBackend(fakeBackend(registry, [cam]));
        app.addPlugin(cameraPlugin(() => ({ width: 800, height: 600 })));

        // The user's cameraMoveSystem, in the shape the report came in.
        const SPEED = 300;
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Query(Mut(Transform), Camera)],
            (query) => { query.forEach((_e, t) => { t.position.x += SPEED * (1 / 60); }); },
            { name: 'cameraMove' },
        ));

        await app.tick(1 / 60);

        // The order itself: the pass that writes worldPosition leads the read.
        expect(calls.indexOf('updateTransforms')).toBeGreaterThanOrEqual(0);
        expect(calls.indexOf('updateTransforms')).toBeLessThan(calls.indexOf('begin'));
        // And it is opened exactly once — a second beginFrame ages the target pool twice.
        expect(beginFrames).toBe(1);

        // What it buys: the camera's own position maps to the centre of the view.
        // A frame-late camera would put x = 0 there instead.
        const moved = SPEED / 60;
        expect(app.world.get(cam, Transform).position.x).toBeCloseTo(moved);
        expect(lastViewProjection).not.toBeNull();
        expect(ndcX(lastViewProjection!, moved, 0)).toBeCloseTo(0, 5);
        expect(Math.abs(ndcX(lastViewProjection!, 0, 0))).toBeGreaterThan(1e-3); // not still at the origin
    });
});

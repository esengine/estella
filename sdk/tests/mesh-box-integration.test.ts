// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mesh's world box, against the real engine.
 *
 * The extent of a Mesh2D lives in its vertices — and for GPU-resident geometry
 * not in the component at all — so the engine is what answers. An editor that
 * boxes a mesh by its component alone gets nothing to click.
 *
 * Requires pre-built WASM at desktop/public/wasm/esengine.wasm.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { Transform, Mesh2D } from '../src/ecs/component';
import { Mesh2DAPI } from '../src/render/mesh2d';
import { meshWorldBox } from '../src/ecs/entityBox';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

// The world triple is written directly: what a box reads is the RESOLVED
// transform, and this test is about the geometry rather than the hierarchy.
const transform = (x = 0, y = 0, sx = 1, sy = 1) => ({
    position: { x, y, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: sx, y: sy, z: 1 },
    worldPosition: { x, y, z: 0 },
    worldRotation: { x: 0, y: 0, z: 0, w: 1 },
    worldScale: { x: sx, y: sy, z: 1 },
});

describe.skipIf(!HAS_WASM)('a mesh world box (WASM integration)', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createApp(): { app: App; registry: CppRegistry } {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        return { app, registry };
    }

    function dispose(app: App, registry: CppRegistry): void {
        for (const e of app.world.getAllEntities()) {
            try { app.world.despawn(e); } catch { /* already gone */ }
        }
        app.world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    }

    it('is the uploaded geometry, taken through the world scale', () => {
        const { app, registry } = createApp();
        try {
            const mesh = new Mesh2DAPI(module as never, registry);
            const e = app.world.spawn();
            app.world.insert(e, Transform, transform(10, 20, 2, 3));
            app.world.insert(e, Mesh2D, {});
            mesh.setGeometry(e, {
                positions: [-50, -10, 50, -10, 50, 10, -50, 10],
                indices: [0, 1, 2, 0, 2, 3],
            });
            app.tick(1 / 60);

            expect(meshWorldBox(app.world, e))
                .toEqual({ cx: 10, cy: 20, cz: 0, hw: 100, hh: 30, hd: 0, rot: { x: 0, y: 0, z: 0, w: 1 } });
        } finally {
            dispose(app, registry);
        }
    });

    it('has no box before geometry is uploaded', () => {
        const { app, registry } = createApp();
        try {
            const e = app.world.spawn();
            app.world.insert(e, Transform, transform());
            app.world.insert(e, Mesh2D, {});
            app.tick(1 / 60);
            expect(meshWorldBox(app.world, e)).toBeNull();
        } finally {
            dispose(app, registry);
        }
    });
});

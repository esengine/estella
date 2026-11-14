// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A ground whose drawing material cannot be made (a shader that does not compile) has failed, like one whose heights could
 *        not be read: it asks once, says why, and asks again only when the Terrain changes. It used to ask every frame.
 */
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Transform } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import { Terrain, TerrainPlugin, TerrainsRes } from '../src/terrain/terrainPlugin';
import { Assets } from '../src/asset/AssetPlugin';
import type { Entity } from '../src/types';

function boot(load: () => Promise<never>): App {
    setDefaultContext(new AppContext());
    setEditorMode(false);
    setPlayMode(false);
    const app = App.new();
    const module = createMockModule();
    app.connectCpp(module.getRegistry(), module);
    // The asset layer is what says a renderer is there; its only use before the ground is drawn is loading the material's shader.
    app.insertResource(Assets, { load } as never);
    app.addPlugin(new TerrainPlugin());
    return app;
}
const tick = async (app: App, n: number): Promise<void> => { for (let i = 0; i < n; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); } };
function spawn(app: App, over: Record<string, unknown> = {}): Entity {
    const e = app.world.spawn();
    app.world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } });
    app.world.insert(e, Terrain, { sizeX: 64, sizeZ: 64, height: 8, cellSize: 1, resolution: 33, collision: false, ...over });
    return e;
}

describe('a terrain whose material cannot be made', () => {
    it('asks for it once, fails with the reason, and stops', async () => {
        const load = vi.fn(async () => { throw new Error('Failed to compile material shader: builtin:terrain'); });
        const app = boot(load);
        const terrain = spawn(app);
        await tick(app, 30);
        expect(load).toHaveBeenCalledTimes(1);
        expect(app.getResource(TerrainsRes).status(terrain)).toEqual({ state: 'failed', reason: 'Failed to compile material shader: builtin:terrain' });
    });

    it('asks again when the Terrain changes', async () => {
        const load = vi.fn(async () => { throw new Error('no shader'); });
        const app = boot(load);
        const terrain = spawn(app);
        await tick(app, 20);
        expect(load).toHaveBeenCalledTimes(1);
        app.world.insert(terrain, Terrain, { ...(app.world.get(terrain, Terrain) as object), height: 9 });
        await tick(app, 20);
        expect(load).toHaveBeenCalledTimes(2);
    });
});

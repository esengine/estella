// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { foliageCellsAcross } from '../src/foliage/foliagePlugin';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Transform, MeshRenderer } from '../src/ecs/component';
import { Assets } from '../src/asset/AssetPlugin';
import { Foliage, FoliagePlugin } from '../src/foliage/foliagePlugin';
import { WorldGens, WorldGenRes } from '../src/worldgen/worldgenPlugin';
import { WorldStreamingSource } from '../src/residency/components';
import { createMockModule } from './mocks/wasm';

const tick = async (app: App) => { for (let i = 0; i < 16; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); } };
const boot = () => {
    setDefaultContext(new AppContext()); setEditorMode(false); setPlayMode(false);
    const app = App.new(), module = createMockModule(); app.connectCpp(module.getRegistry(), module);
    let handle = 1;
    app.insertResource(Assets, { createMesh: () => handle++, releaseBuiltMesh: () => {} } as any);
    app.addPlugin(new FoliagePlugin());
    const source = app.world.spawn();
    app.world.insert(source, Transform); app.world.insert(source, WorldStreamingSource, { ...WorldStreamingSource._default });
    const entity = app.world.spawn(); app.world.insert(entity, Transform);
    app.world.insert(entity, Foliage, { ...Foliage._default, sizeX: 40, sizeZ: 40, cellSize: 20, count: 12, drawDistance: 100,
        castShadows: false, zoneWorld: 'parcel' });
    return { app, entity };
};
const cells = (app: App) => app.world.getEntitiesWithComponents([MeshRenderer]);

describe('the cells of a Foliage area', () => {
    it('are never wider than the cell size, over a field of any size', () => {
        expect(foliageCellsAcross(400, 400, 40)).toEqual({ x: 10, z: 10 });
        // An island of six kilometres on 12 m cells: 512 of them, not the 200 a cap once left 31 m wide with plants in 12 m of each.
        const island = foliageCellsAcross(6144, 6144, 12);
        expect(island).toEqual({ x: 512, z: 512 });
        expect(6144 / island.x).toBeLessThanOrEqual(12);
        expect(foliageCellsAcross(5, 5, 40)).toEqual({ x: 1, z: 1 });
    });
});

describe('grass reservations and shadows', () => {
    it('grows without worldgen and applies the authored shadow policy to generated cells', async () => {
        const { app, entity } = boot(); await tick(app);
        expect(cells(app)).toHaveLength(4);
        for (const e of cells(app)) expect(app.world.get(e, MeshRenderer).castShadows).toBe(false);
        app.world.insert(entity, Foliage, { ...app.world.get(entity, Foliage), castShadows: true }); await tick(app);
        for (const e of cells(app)) expect(app.world.get(e, MeshRenderer).castShadows).toBe(true);
    });
    it('regenerates when a building exclusion is added or removed, with unrelated tags left alone', async () => {
        const { app } = boot(); const gens = new WorldGens(); app.insertResource(WorldGenRes, gens);
        const zones = gens.zones('parcel'); await tick(app); expect(cells(app)).toHaveLength(4);
        const building = { id: 'house', kind: 'building', shape: { type: 'rect' as const, x: 0, z: 0, halfX: 50, halfZ: 50, yaw: 0.3 }, falloff: 0, priority: 10, excludes: ['tree'] };
        zones.set(building); await tick(app); expect(cells(app)).toHaveLength(4);
        zones.set({ ...building, excludes: ['grass'] }); await tick(app); expect(cells(app)).toHaveLength(0);
        zones.delete('house'); await tick(app); expect(cells(app)).toHaveLength(4);
        zones.set({ ...building, excludes: ['*'] }); await tick(app); expect(cells(app)).toHaveLength(0);
    });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform, TilemapLayer, Parent } from '../src/ecs/component';
import { Schedule, defineSystem } from '../src/ecs/system';
import { TilemapPlugin, TilemapRuntimeState } from '../src/tilemap/tilemapPlugin';
import { Tilemaps } from '../src/tilemap/tilemapAPI';
import { tileCellCenter } from '../src/tilemap/tileGeometry';
import { Physics2DPlugin, Physics2DEvents } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import { Physics2D } from '../src/physics/Physics2D';
import { RigidBody2D, BoxCollider2D, BodyType } from '../src/physics/PhysicsComponents';
import type { ESEngineModule } from '../src/wasm';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); vi.restoreAllMocks(); });

async function scene(orientation = 0, physicsFirst = false, gravity = 0) {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app); app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
    const module = await loadSideModule<PhysicsWasmModule>('physics');
    const physics = new Physics2DPlugin('', { gravity: { x: 0, y: gravity }, fixedTimestep: 1 / 60 }, async () => module);
    if (physicsFirst) { app.addPlugin(physics); await app.getResource(Physics2DRuntime).initPromise; }
    app.addPlugin(new TilemapPlugin());
    if (!physicsFirst) { app.addPlugin(physics); await app.getResource(Physics2DRuntime).initPromise; }
    const world = app.world, layer = world.spawn(), tiles = app.getResource(Tilemaps);
    world.insert(layer, Transform); world.insert(layer, TilemapLayer, { cellSize: { x: 16, y: 24 }, orientation, hexSideLength: 6 });
    app.getResource(TilemapRuntimeState).setLayerTilesets(layer, ['builtin:collision']); tiles.initInfiniteLayer(layer, 16, 24);
    const bodies = () => world.getEntitiesWithComponents([RigidBody2D, Parent]).filter(id => world.get(id, Parent).entity === layer);
    const at = (x: number, y: number) => tileCellCenter({ orientation, tileWidth: 16, tileHeight: 24, hexSideLength: 6 }, x, y);
    const hits = (x: number, y: number) => {
        const point = at(x, y);
        return app.getResource(Physics2D).raycast({ x: point.x, y: point.y + 20 }, { x: 0, y: -1 }, 40);
    };
    return { app, world, layer, tiles, module, bodies, at, hits };
}

describe.skipIf(!HAS_WASM || !hasSideModule('physics'))('incremental tile collision before simulation', () => {
    beforeAll(async () => { core = await loadWasmModule(); });

    it.each([0, 1, 2, 3])('replaces only the edited chunk and keeps other physics bodies alive (layout=%s)', async orientation => {
        vi.spyOn(core, 'tilemap_readChunkTilesInWorld');
        const copies = vi.mocked(core.tilemap_readChunkTilesInWorld!);
        const { app, world, layer, tiles, module, bodies, at, hits } = await scene(orientation);
        for (const [x, y] of [[3, 2], [20, 2], [-17, -3]]) tiles.setTile(layer, x, y, 1);
        await app.tick(1 / 60); expect(module._physics_getBodyCount()).toBe(3);
        const original = bodies(), target = at(3, 2);
        const changed = original.find(id => Math.hypot(world.get(id, Transform).position.x - target.x, world.get(id, Transform).position.y - target.y) < .001)!;
        const stable = original.filter(id => id !== changed), exports = vi.spyOn(tiles, 'exportChunks');
        copies.mockClear();
        tiles.setTile(layer, 3, 2, 0); await app.tick(1 / 60);
        expect(world.valid(changed)).toBe(false);
        expect(bodies()).toEqual(stable); expect(module._physics_getBodyCount()).toBe(2);
        for (const id of stable) expect(module._physics_hasBody(id)).toBe(1);
        expect(copies).toHaveBeenCalledOnce(); expect(exports).not.toHaveBeenCalled();
        expect(hits(3, 2)).toHaveLength(0);
        tiles.setTile(layer, 3, 2, 8); await app.tick(1 / 60);
        expect(bodies()).toHaveLength(3); expect(hits(3, 2)).toHaveLength(1);
        for (const id of stable) expect(module._physics_hasBody(id)).toBe(1);
    });

    it.each(['missing-stamps', 'failed-readback'] as const)('retains unchanged bodies through %s fallback', async mode => {
        vi.spyOn(core, 'tilemap_readChunkTilesInWorld');
        const read = vi.mocked(core.tilemap_readChunkTilesInWorld!);
        if (mode === 'missing-stamps') {
            vi.spyOn(core, 'tilemap_getGenerationInWorld');
            vi.mocked(core.tilemap_getGenerationInWorld!).mockReturnValue(undefined as never);
            vi.spyOn(core, 'tilemap_getEditRevisionInWorld');
            vi.mocked(core.tilemap_getEditRevisionInWorld!).mockReturnValue(undefined as never);
        }
        const { app, world, layer, tiles, bodies } = await scene();
        tiles.setTile(layer, 0, 0, 1); tiles.setTile(layer, 20, 0, 1); await app.tick(1 / 60);
        const stable = bodies().find(id => world.get(id, Transform).position.x > 100)!;
        read.mockClear();
        if (mode === 'failed-readback') read.mockReturnValue(false);
        tiles.setTile(layer, 0, 0, 2); await app.tick(1 / 60);
        expect(read).toHaveBeenCalled();
        expect(world.valid(stable)).toBe(true); expect(bodies()).toHaveLength(2);
        const current = bodies(); await app.stepFrames(3, 1 / 60); expect(bodies()).toEqual(current);
    });

    it.each([false, true])('sees fixed-step edits in the same physics step regardless of plugin order (physics first=%s)', async physicsFirst => {
        const { app, layer, tiles, hits } = await scene(0, physicsFirst);
        await app.tick(1 / 60);
        let solid = false; const observed: boolean[] = [];
        app.addSystemToSchedule(Schedule.FixedPreUpdate, defineSystem([], () => { solid = !solid; tiles.setTile(layer, 0, 0, solid ? 1 : 0); }, { name: 'PaintTile' }));
        app.addSystemToSchedule(Schedule.FixedPostUpdate, defineSystem([], () => { observed.push(hits(0, 0).length > 0); expect(observed.at(-1)).toBe(solid); }, { name: 'ProbeTile' }));
        vi.spyOn(performance, 'now').mockReturnValue(0);
        await app.tick(1 / 30); expect(observed).toEqual([true, false]);
    });

    it('keeps a resting contact when a distant chunk changes', async () => {
        const { app, world, layer, tiles, bodies } = await scene(0, false, -9.81);
        tiles.setTile(layer, 0, 0, 1); tiles.setTile(layer, 20, 0, 1); await app.tick(1 / 60);
        const floor = bodies().find(id => world.get(id, Transform).position.x > 100)!;
        const actor = world.spawn(); world.insert(actor, Transform, { position: { x: 328, y: 40, z: 0 } });
        world.insert(actor, RigidBody2D, { bodyType: BodyType.Dynamic }); world.insert(actor, BoxCollider2D, { halfExtents: { x: .03, y: .03 } });
        await app.stepFrames(120, 1 / 60);
        const resting = world.get(actor, Transform).worldPosition.y; expect(resting).toBeGreaterThan(0); expect(resting).toBeLessThan(10);
        for (let i = 0; i < 8; i++) {
            tiles.setTile(layer, 0, 0, i % 2); await app.tick(1 / 60);
            expect(world.valid(floor)).toBe(true);
            expect(app.getResource(Physics2DEvents).collisionExits.some(event => event.entityA === floor && event.entityB === actor || event.entityA === actor && event.entityB === floor)).toBe(false);
        }
        expect(world.get(actor, Transform).worldPosition.y).toBeCloseTo(resting, 2);
    });

    it('advances native tile animation once while two fixed steps run', async () => {
        vi.spyOn(core, 'tilemap_advanceAnimationsInWorld');
        const advance = vi.mocked(core.tilemap_advanceAnimationsInWorld!);
        const { app, layer, tiles } = await scene(); await app.tick(1 / 60);
        advance.mockClear();
        tiles.setTileAnimation(layer, 1, [{ tileId: 1, duration: 100 }, { tileId: 2, duration: 100 }]);
        (app.getResource(TilemapRuntimeState) as unknown as { animatedLayers_: Set<number> }).animatedLayers_.add(layer);
        vi.spyOn(performance, 'now').mockReturnValue(0);
        await app.tick(1 / 30);
        expect(advance).toHaveBeenCalledOnce();
        const [registry, entity, dt] = advance.mock.calls[0];
        expect(registry).toBe(app.world.getCppRegistry());
        expect(entity).toBe(layer);
        expect(dt).toBeCloseTo(1000 / 30, 5);
    });
});

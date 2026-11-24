// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { App } from '../src/app/app';
import { Transform, TilemapLayer, Disabled, RuntimeOnly, Parent } from '../src/ecs/component';
import { serializeScene } from '../src/scene/scene';
import { TilemapPlugin, TilemapRuntimeState } from '../src/tilemap/tilemapPlugin';
import { Tilemaps } from '../src/tilemap/tilemapAPI';

let engine: import('../src/wasm').ESEngineModule;
const registries: Array<{ delete(): void }> = [];
const apps: App[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const app of apps.splice(0)) app.quit();
    for (const registry of registries.splice(0)) registry.delete();
});

describe.skipIf(!HAS_WASM)('live native tile collision', () => {
    beforeAll(async () => {
        engine = await loadWasmModule();
        engine.setActiveContext(null);
        expect(typeof engine.tilemap_getEditRevision).toBe('function');
    });
    async function scene() {
        const registry = new engine.Registry(); registries.push(registry as unknown as { delete(): void });
        const app = App.new(); app.connectCpp(registry, engine); app.addPlugin(new TilemapPlugin()); apps.push(app);
        const entity = app.world.spawn();
        app.world.insert(entity, Transform);
        app.world.insert(entity, TilemapLayer, { cellSize: { x: 16, y: 16 } });
        const tiles = app.getResource(Tilemaps);
        app.getResource(TilemapRuntimeState).setLayerTilesets(entity, ['builtin:collision']);
        tiles.initInfiniteLayer(entity, 16, 16);
        const emptyBlob = tiles.exportChunks(entity);
        tiles.setTile(entity, 0, 0, 1);
        await app.tick(1 / 60);
        const colliders = () => [...((app.getResource(TilemapRuntimeState) as unknown as { collisionEntities_: Map<number, Set<import('../src/types').Entity>> }).collisionEntities_.get(entity) ?? [])];
        return { app, entity, tiles, colliders, emptyBlob };
    }
    it('retains unchanged colliders and removes them after erasing their tile', async () => {
        const { app, entity, tiles, colliders } = await scene();
        const original = [...colliders()]; expect(original.length).toBeGreaterThan(0);
        const exports = vi.spyOn(tiles, 'exportChunks');
        for (let i = 0; i < 20; i++) { tiles.setTile(entity, 0, 0, 1); await app.tick(1 / 60); }
        expect(colliders()).toEqual(original);
        expect(exports).not.toHaveBeenCalled();
        tiles.setTile(entity, 0, 0, 0); await app.tick(1 / 60);
        expect(colliders()).toHaveLength(0);
        expect(exports).not.toHaveBeenCalled();
        for (const id of original) expect(app.world.valid(id)).toBe(false);
        tiles.setTile(entity, -1, -1, 1); await app.tick(1 / 60);
        expect(colliders().length).toBeGreaterThan(0);
    });
    it('inherits layer movement without rebuilding and removes collision with its palette', async () => {
        const { app, entity, colliders } = await scene();
        const original = [...colliders()];
        app.world.update(entity, Transform, value => { value.position.x = 32; });
        await app.tick(1 / 60);
        expect(colliders()).toEqual(original);
        for (const id of original) expect(app.world.get(id, Parent).entity).toBe(entity);
        app.getResource(TilemapRuntimeState).setLayerTilesets(entity, []);
        await app.tick(1 / 60);
        expect(colliders() ?? []).toHaveLength(0);
    });
    it.each(['incomplete payload', 'unrepresentable tile'] as const)(
        'preserves painted tiles, stamps and colliders after an import with an %s', async reason => {
            const { app, entity, tiles, colliders, emptyBlob } = await scene();
            const fresh = app.world.spawn();
            const saved = tiles.exportChunks(entity);
            const original = Buffer.from(saved, 'base64');
            let partial = original.subarray(0, -1);
            if (reason === 'unrepresentable tile') {
                // A wider saved id mask. The first tile fits and the last one cannot migrate.
                original.writeUInt16LE(0x3fff, 6);
                original.writeUInt16LE(0x4000, 8);
                original.writeUInt16LE(0x8000, 10);
                original.writeUInt16LE(0, 12);
                original.writeUInt16LE(0x2001, original.length - 2);
                partial = original;
            }
            const bad = partial.toString('base64');
            const revision = tiles.getEditRevision(entity);
            const generation = tiles.getGeneration(entity);
            const bodies = colliders();

            expect(tiles.importChunks(entity, bad)).toBe(false);
            expect(tiles.importChunks(fresh, bad)).toBe(false);
            expect.soft(tiles.hasLayer(fresh)).toBe(false);
            expect.soft(tiles.exportChunks(entity)).toBe(saved);
            expect.soft(tiles.getEditRevision(entity)).toBe(revision);
            expect(tiles.getGeneration(entity)).toBe(generation);
            await app.tick(1 / 60);
            expect.soft(colliders()).toEqual(bodies);

            expect(tiles.importChunks(fresh, saved)).toBe(true);
            expect(tiles.getTile(fresh, 0, 0)).toBe(1);
            expect(tiles.importChunks(entity, emptyBlob)).toBe(true);
            await app.tick(1 / 60);
            expect(colliders()).toHaveLength(0);
        },
    );
    it('removes old collision when importing an empty map', async () => {
        const { app, entity, tiles, colliders, emptyBlob } = await scene();
        expect(colliders().length).toBeGreaterThan(0);
        expect(tiles.importChunks(entity, emptyBlob)).toBe(true);
        await app.tick(1 / 60);
        expect(colliders()).toHaveLength(0);
    });
    it.each(['reinitialize', 'recreate'])('replaces collision after layer %s with the same edit count', async mode => {
        const { app, entity, tiles, colliders } = await scene();
        const original = [...colliders()];
        if (mode === 'recreate') tiles.destroyLayer(entity);
        tiles.initLayer(entity, 2, 2, 16, 16);
        tiles.setTile(entity, 1, 0, 1);
        await app.tick(1 / 60);
        expect(colliders()).not.toEqual(original);
        expect(app.world.get(colliders()[0], Transform).position.x).toBe(24);
        for (const id of original) expect(app.world.valid(id)).toBe(false);
    });
    it('preserves tiles and collider identity while disabling and reenabling a layer', async () => {
        const { app, entity, tiles, colliders } = await scene();
        const original = [...colliders()];
        app.world.insert(entity, Disabled);
        await app.tick(1 / 60);
        expect(tiles.getTile(entity, 0, 0)).toBe(1);
        for (const collider of original) expect(app.world.isEntityActive(collider)).toBe(false);
        app.world.remove(entity, Disabled); await app.tick(1 / 60);
        expect(colliders()).toEqual(original);
        for (const collider of original) expect(app.world.isEntityActive(collider)).toBe(true);
    });
    it('keeps generated collision out of serialized scenes', async () => {
        const { app, entity, colliders } = await scene();
        for (const collider of colliders()) {
            expect(app.world.has(collider, RuntimeOnly)).toBe(true);
            expect(app.world.get(collider, Parent).entity).toBe(entity);
        }
        expect(serializeScene(app.world).entities).toHaveLength(1);
    });
    it('inherits a disabled ancestor without losing painted tiles', async () => {
        const { app, entity, tiles, colliders } = await scene();
        const parent = app.world.spawn(); app.world.insert(parent, Transform);
        app.world.setParent(entity, parent);
        const original = [...colliders()];
        app.world.insert(parent, Disabled); await app.tick(1 / 60);
        expect(tiles.getTile(entity, 0, 0)).toBe(1);
        for (const collider of original) expect(app.world.isEntityActive(collider)).toBe(false);
        app.world.remove(parent, Disabled); await app.tick(1 / 60);
        expect(colliders()).toEqual(original);
    });
});

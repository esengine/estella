// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import { Parent, SceneOwner } from '../src/ecs/component';
import { instantiatePrefab, type PrefabData } from '../src/prefab';
import { PrefabServer } from '../src/prefab/prefabServer';
import { SceneManagerState } from '../src/scene/sceneManager';
import { reservePromise } from '../src/util/reservePromise';
import type { ESEngineModule } from '../src/wasm';
import { INVALID_ENTITY } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const prefab: PrefabData = { version: '2', name: 'parented', rootEntityId: 'root', entities: [
    { prefabEntityId: 'root', name: 'root', parent: null, children: ['child'], visible: true, components: [] },
    { prefabEntityId: 'child', name: 'child', parent: 'root', children: [], visible: true, components: [] },
] };

describe.skipIf(!HAS_WASM)('async prefab parenting on real WASM', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });
    const delayedAssets = () => {
        const read = reservePromise<void>();
        const assets = Assets.create({ catalog: Catalog.empty(), module: engine, backend: {
            resolveUrl: path => path, fetchBinary: async () => new ArrayBuffer(0),
            fetchText: async () => { await read.promise; return JSON.stringify(prefab); },
        } });
        return { assets, read };
    };

    it('follows the originating entity at landing, independently of the active scene and attachment parent', async () => {
        const app = App.new().connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        const { assets, read } = delayedAssets();
        const scenes = new SceneManagerState(app), server = new PrefabServer(app.world, () => assets, () => scenes);
        try {
            for (const name of ['hud', 'world']) scenes.register({ name });
            const hud = await scenes.load('hud'), world = await scenes.loadAdditive('world');
            const owner = hud.spawn(), parent = hud.spawn(), global = app.world.spawn();
            const loading = server.instantiate('effect.esprefab', { parent, owner });
            world.adopt(owner);
            read.resolve();
            const cold = await loading, prepared = await server.prepare('effect.esprefab');
            try {
                const warm = prepared.spawn({ owner }), unowned = prepared.spawn({ owner: global });
                expect(app.world.get(cold.root, Parent).entity).toBe(parent);
                for (const entity of [...cold.entities.values(), ...warm.entities.values()]) {
                    expect(app.world.get(entity, SceneOwner).scene).toBe('world');
                    expect(world.entities.has(entity)).toBe(true);
                }
                await scenes.unload('hud');
                expect(app.world.valid(cold.root)).toBe(true);
                expect(app.world.has(cold.root, Parent)).toBe(false);
                await scenes.unload('world');
                for (const entity of [...cold.entities.values(), ...warm.entities.values()]) expect(app.world.valid(entity)).toBe(false);
                for (const entity of unowned.entities.values()) {
                    expect(app.world.valid(entity)).toBe(true);
                    expect(app.world.has(entity, SceneOwner)).toBe(false);
                }
                expect(() => prepared.spawn({ owner })).toThrow(/destroyed owner/);
            } finally { prepared.release(); }
        } finally { read.resolve(); app.quit(); assets.releaseAll(); }
    });

    it.each(['despawn', 'replace world'])('cancels a pending explicit owner on %s', async change => {
        const old = new engine.Registry(), next = new engine.Registry();
        const app = App.new().connectCpp(old, engine);
        const { assets, read } = delayedAssets();
        try {
            const server = new PrefabServer(app.world, () => assets, () => null);
            const owner = app.world.spawn(), pending = server.instantiate('effect.esprefab', { owner });
            if (change === 'despawn') app.world.despawn(owner);
            else app.connectCpp(next, engine);
            const survivor = app.world.spawn();
            if (change === 'replace world') expect(survivor).toBe(owner);
            read.resolve();
            await expect(pending).rejects.toThrow(/destroyed owner|cancelled/);
            expect(app.world.getAllEntities()).toEqual([survivor]);
            expect(assets.sizes().refRows).toBe(0);
        } finally { read.resolve(); app.quit(); assets.releaseAll(); old.delete(); next.delete(); }
    });
    it('rolls back the spawned hierarchy when its requested parent disappears', async () => {
        const app = App.new(); app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        try {
            const parent = app.world.spawn();
            const pending = instantiatePrefab(app.world, prefab, { parent });
            app.world.despawn(parent);
            await expect(pending).rejects.toThrow(/parent/);
            expect(app.world.getAllEntities()).toHaveLength(0);
        } finally { app.quit(); }
    });
    it('attaches the hierarchy to a live parent and releases it with that parent', async () => {
        const app = App.new(); app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        try {
            const parent = app.world.spawn();
            const result = await instantiatePrefab(app.world, prefab, { parent });
            expect(app.world.get(result.root, Parent).entity).toBe(parent);
            expect(app.world.getAllEntities()).toHaveLength(3);
            app.world.despawn(parent);
            expect(app.world.getAllEntities()).toHaveLength(0);
        } finally { app.quit(); }
    });
    it('accepts the explicit no-parent sentinel', async () => {
        const app = App.new(); app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        try {
            const result = await instantiatePrefab(app.world, prefab, { parent: INVALID_ENTITY });
            expect(app.world.valid(result.root)).toBe(true);
            expect(app.world.has(result.root, Parent)).toBe(false);
            expect(app.world.getAllEntities()).toHaveLength(2);
        } finally { app.quit(); }
    });
});

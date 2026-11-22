// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bench, describe } from 'vitest';
import { Animator } from '../src/animation/Animator';
import { App } from '../src/app/app';
import { AssetScope } from '../src/asset/AssetLease';
import { AssetRegistry, makeUuidRef } from '../src/asset/AssetRegistry';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { Assets } from '../src/asset/Assets';
import { AvatarAssetLoader } from '../src/asset/loaders/AvatarAssetLoader';
import { TilemapAssetLoader } from '../src/asset/loaders/TilemapAssetLoader';
import { SceneManagerState } from '../src/scene/sceneManager';
import { Tilemap } from '../src/tilemap/components';
import type { Entity } from '../src/types';
import type { CppRegistry, CppResourceManager, ESEngineModule } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';
import { HAS_WASM, loadWasmModule } from '../tests/helpers/loadWasm';

const map = JSON.stringify({ width: 1, height: 1, tilewidth: 4, tileheight: 4, tilesets: [],
    layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [0] }] });
const avatar = JSON.stringify({ joints: { hips: 'Root/Hips', head: 'Root/Hips/Head' } });

function createScene(pairs: number, engine?: ESEngineModule) {
    const registry = new AssetRegistry();
    const files: { type: string; ref: string }[] = [];
    for (let i = 0; i < pairs; i++) {
        for (const [type, path] of [['tilemap', `assets/map-${i}.tmj`], ['avatar', `assets/rig-${i}.esavatar`]]) {
            const uuid = '00000000-0000-4000-8000-' + files.length.toString(16).padStart(12, '0');
            registry.addEntry({ uuid, type, path });
            files.push({ type, ref: makeUuidRef(uuid) });
        }
    }
    const assets = Assets.create({ module: engine ?? null, backend: {
        fetchText: async path => path.endsWith('.tmj') ? map : avatar,
        fetchBinary: async () => new ArrayBuffer(0),
        resolveUrl: path => path,
    } });
    assets.register(new TilemapAssetLoader());
    assets.register(new AvatarAssetLoader());
    assets.setAssetRefResolver(ref => registry.resolveRef(ref) ?? ref);
    const app = App.new();
    if (engine) app.connectCpp(new engine.Registry() as CppRegistry, engine, { ownedRegistry: true });
    app.insertResource(AssetsResource, assets);
    const scenes = new SceneManagerState(app), entities: Entity[] = [];
    scenes.register({ name: 'sector', setup: async ctx => {
        const scope = new AssetScope();
        for (const { type, ref } of files) scope.add(await assets.acquireTyped(type, ref));
        ctx.trackAssetScope(scope);
        if (!engine) return;
        for (const { type, ref } of files) {
            const entity = ctx.spawn();
            if (type === 'tilemap') app.world.insert(entity, Tilemap, { source: ref });
            else app.world.insert(entity, Animator, { avatar: ref });
            ctx.setPersistent(entity, true);
            entities.push(entity);
        }
    } });
    return { app, assets, files, scenes, entities };
}

type Fixture = ReturnType<typeof createScene>;

describe('Scene unload - named tilemaps and skeletal avatars', () => {
    for (const pairs of [500, 2000]) {
        let fixture: Fixture;
        const persistent = new AssetScope();
        bench(`load and unload ${pairs * 2} assets`, async () => {
            const { scenes, assets, files } = fixture;
            await scenes.load('sector');
            if (assets.sizes().registrySlots !== pairs * 2) throw Error('Scene did not acquire its assets');
            await scenes.unload('sector');
            if (assets.sizes().registrySlots !== 1 || !assets.resolveRegistryAsset('avatar', files[1].ref)) {
                throw Error('Scene unload did not retain exactly the shared avatar');
            }
        }, {
            setup: async () => {
                initResourceManager({} as CppResourceManager);
                fixture = createScene(pairs);
                persistent.add(await fixture.assets.acquireTyped('avatar', 'assets/rig-0.esavatar'));
            },
            teardown: () => { persistent.releaseAll(); fixture.assets.releaseAll(); fixture.app.quit(); shutdownResourceManager(); },
            time: 100, iterations: 5, warmupTime: 50, warmupIterations: 1,
        });
    }
});

describe.skipIf(!HAS_WASM)('Scene unload - persistent tilemaps and skeletal avatars', () => {
    const samples = 5;
    for (const pairs of [500, 1000]) {
        let fixtures: Fixture[], next: number;
        bench(`promote ${pairs * 2} entities during unload`, async () => {
            await fixtures[next++].scenes.unload('sector');
        }, {
            time: 0, iterations: samples, warmupTime: 0, warmupIterations: 1,
            setup: async (_, mode) => {
                const engine = await loadWasmModule();
                initResourceManager({} as CppResourceManager);
                fixtures = [];
                next = 0;
                // Each timed call unloads a freshly populated scene with its own world and ownership scope.
                const count = mode === 'run' ? samples : 1;
                for (let i = 0; i < count; i++) {
                    const fixture = createScene(pairs, engine);
                    fixtures.push(fixture);
                    await fixture.scenes.load('sector');
                }
            },
            teardown: () => {
                for (const { assets, app, scenes, entities, files } of fixtures) {
                    if (scenes.isLoaded('sector') || assets.entityScopes.size !== pairs * 2) {
                        throw Error('Scene did not promote all of its entities');
                    }
                    for (const [i, entity] of entities.entries()) {
                        const { type, ref } = files[i];
                        if (!assets.resolveRegistryAsset(type, ref)) throw Error('A promoted entity lost its asset');
                        app.world.despawn(entity);
                    }
                    if (assets.sizes().registrySlots !== 0) throw Error('Despawn left assets behind');
                    assets.releaseAll();
                    app.quit();
                }
                shutdownResourceManager();
            },
        });
    }
});

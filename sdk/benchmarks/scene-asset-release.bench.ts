// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bench, describe } from 'vitest';
import { App } from '../src/app/app';
import { AssetScope } from '../src/asset/AssetLease';
import { AssetRegistry, makeUuidRef } from '../src/asset/AssetRegistry';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { Assets } from '../src/asset/Assets';
import { AvatarAssetLoader } from '../src/asset/loaders/AvatarAssetLoader';
import { TilemapAssetLoader } from '../src/asset/loaders/TilemapAssetLoader';
import { SceneManagerState } from '../src/scene/sceneManager';
import type { CppResourceManager } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';

const map = JSON.stringify({ width: 1, height: 1, tilewidth: 4, tileheight: 4, tilesets: [],
    layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [0] }] });
const avatar = JSON.stringify({ joints: { hips: 'Root/Hips', head: 'Root/Hips/Head' } });

describe('Scene unload - named tilemaps and skeletal avatars', () => {
    for (const pairs of [500, 2000]) {
        let assets: Assets, scenes: SceneManagerState;
        const persistent = new AssetScope();
        const registry = new AssetRegistry();
        const files: { type: string; ref: string }[] = [];
        for (let i = 0; i < pairs; i++) {
            for (const [type, path] of [['tilemap', `assets/map-${i}.tmj`], ['avatar', `assets/rig-${i}.esavatar`]]) {
                const uuid = '00000000-0000-4000-8000-' + files.length.toString(16).padStart(12, '0');
                registry.addEntry({ uuid, type, path });
                files.push({ type, ref: makeUuidRef(uuid) });
            }
        }
        const setup = async () => {
            initResourceManager({} as CppResourceManager);
            assets = Assets.create({ module: null, backend: {
                fetchText: async path => path.endsWith('.tmj') ? map : avatar,
                fetchBinary: async () => new ArrayBuffer(0),
                resolveUrl: path => path,
            } });
            assets.register(new TilemapAssetLoader());
            assets.register(new AvatarAssetLoader());
            assets.setAssetRefResolver(ref => registry.resolveRef(ref) ?? ref);
            persistent.add(await assets.acquireTyped('avatar', 'assets/rig-0.esavatar'));
            const app = App.new();
            app.insertResource(AssetsResource, assets);
            scenes = new SceneManagerState(app);
            scenes.register({ name: 'sector', setup: async ctx => {
                const scope = new AssetScope();
                for (const { type, ref } of files) scope.add(await assets.acquireTyped(type, ref));
                ctx.trackAssetScope(scope);
            } });
        };
        bench(`load and unload ${pairs * 2} assets`, async () => {
            await scenes.load('sector');
            if (assets.sizes().registrySlots !== pairs * 2) throw Error('Scene did not acquire its assets');
            await scenes.unload('sector');
            if (assets.sizes().registrySlots !== 1 || !assets.resolveRegistryAsset('avatar', files[1].ref)) {
                throw Error('Scene unload did not retain exactly the shared avatar');
            }
        }, {
            setup,
            teardown: () => { persistent.releaseAll(); assets.releaseAll(); shutdownResourceManager(); },
            time: 100, iterations: 5, warmupTime: 50, warmupIterations: 1,
        });
    }
});

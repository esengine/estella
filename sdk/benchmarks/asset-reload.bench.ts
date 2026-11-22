// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bench, describe } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { AssetScope } from '../src/asset/AssetLease';
import { TilemapAssetLoader } from '../src/asset/loaders/TilemapAssetLoader';
import type { CppResourceManager } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';

const map = JSON.stringify({
    width: 1, height: 1, tilewidth: 4, tileheight: 4, tilesets: [{ firstgid: 1, source: 'shared.tsj' }],
    layers: [{ type: 'tilelayer', name: 'ground', width: 1, height: 1, data: [1] }],
});
const tileset = JSON.stringify({ name: 'terrain', image: 'common.png', columns: 1, tilecount: 1, tilewidth: 4, tileheight: 4 });
const material = JSON.stringify({ type: 'material', shader: 'builtin:sprite-unlit', properties: { mainTex: 'common.png' } });
const instance = JSON.stringify({ type: 'material', shader: '', instanceOf: 'parent.esmaterial', properties: {} });

describe('Asset reload planning - 400 tilemaps and 400 material instances', () => {
    let assets: Assets;
    let scope: AssetScope;
    const acquireAll = async () => {
        const leases = new AssetScope();
        for (let i = 0; i < 400; i++) {
            leases.add(await assets.acquireTyped('material', `shared/material-${i}.esmaterial`));
            leases.add(await assets.acquireTyped('tilemap', `shared/map-${i}.tmj`));
        }
        return leases;
    };
    const setup = async () => {
        // Keep the real loaders and their ownership receipts. Rendering is outside the timed operation.
        let handle = 0;
        initResourceManager({ createTextureFromBytes: () => ++handle, releaseTexture: () => {} } as CppResourceManager);
        assets = Assets.create({ module: null, backend: {
            resolveUrl: path => path,
            fetchBinary: async () => new ArrayBuffer(8),
            fetchText: async path => {
                if (path.endsWith('.tmj')) return map;
                if (path.endsWith('.tsj')) return tileset;
                if (path.endsWith('parent.esmaterial')) return material;
                return instance;
            },
        } });
        assets.register(new TilemapAssetLoader());
        assets.register({ type: 'material-shader', extensions: [], load: async () => ({ compile: () => 1 }) });
        assets.getTextureLoader().setPixelDecoder(async () => ({ width: 4, height: 4, pixels: new Uint8Array(64) }));
        scope = await acquireAll();
    };
    const teardown = () => {
        scope.releaseAll();
        assets.releaseAll();
        shutdownResourceManager();
    };
    for (const [file, groups] of [
        ['shared.tsj', 400], ['parent.esmaterial', 400], ['common.png', 801], ['unused.png', 0],
    ] as const) {
        const path = `shared/${file}`;
        bench(file, () => {
            const plan = assets['rebuildPlan_'](path);
            if (plan.length !== groups) throw new Error(`${file}: expected ${groups} groups, got ${plan.length}`);
        }, { setup, teardown, time: 400, warmupTime: 100 });
    }
    bench('invalidate shared texture and reacquire all assets', async () => {
        assets.invalidate('shared/common.png');
        await assets.assetGraphSettled();
        const previous = scope;
        scope = await acquireAll();
        previous.releaseAll();
    }, { setup, teardown, time: 400, warmupTime: 100 });
});

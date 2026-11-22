// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bench, describe } from 'vitest';
import { App } from '../src/app/app';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { AssetScope } from '../src/asset/AssetLease';
import { Assets } from '../src/asset/Assets';
import { ensureBuiltinComponentsRegistered, MeshRenderer, Sprite } from '../src/ecs/component';
import { installHotUpdateRebind } from '../src/hotUpdateRebind';
import { SceneManager, SceneManagerState } from '../src/scene/sceneManager';
import type { Entity } from '../src/types';
import type { CppResourceManager } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';
import { HAS_WASM, loadWasmModule } from '../tests/helpers/loadWasm';

const path = 'assets/shared.png';

async function createScene(count: number, independent: boolean) {
    const engine = await loadWasmModule();
    ensureBuiltinComponentsRegistered();
    const app = App.new();
    app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
    // The real world and texture ledger participate; GPU upload has a fixed cost.
    let handle = 0;
    const textures: Partial<CppResourceManager> = { createTextureFromBytes: () => ++handle, releaseTexture: () => {} };
    initResourceManager(textures as CppResourceManager);
    const assets = Assets.create({ module: null, backend: {
        resolveUrl: value => value, fetchText: async () => '', fetchBinary: async () => new ArrayBuffer(0),
    } });
    assets.getTextureLoader().setPixelDecoder(async () => ({ width: 4, height: 4, pixels: new Uint8Array(64) }));
    app.insertResource(AssetsResource, assets);
    const scenes = new SceneManagerState(app);
    app.insertResource(SceneManager, scenes);
    const bindings = installHotUpdateRebind(app, assets), entities: Entity[] = [];
    scenes.register({ name: 'level', setup: async ctx => {
        const scope = new AssetScope();
        const texture = scope.add(await assets.acquireTexture(path));
        ctx.trackAssetScope(scope);
        for (let i = 0; i < count; i++) {
            const entity = ctx.spawn();
            app.world.insert(entity, i % 2 ? MeshRenderer : Sprite, { texture: texture.value.handle });
            if (independent) ctx.setPersistent(entity, true);
            entities.push(entity);
        }
    } });
    await scenes.load('level');
    if (independent) await scenes.unload('level');
    const initial = assets.getTexture(path)!.handle;
    return {
        reload: async () => {
            if (!assets.invalidate(path)) throw Error('Texture was not resident');
            let done = false;
            void bindings.settled().then(() => { done = true; });
            for (let i = 0; !done && i < 30; i++) await app.tick(1 / 60);
            if (!done) throw Error('Live bindings did not settle');
        },
        close: async () => {
            try {
                const latest = assets.getTexture(path)?.handle;
                if (!latest || latest === initial) throw Error('No new texture was published');
                if (assets.sizes().refRows !== (independent ? count : 1)) throw Error('Incorrect owner count');
                for (const [i, entity] of entities.entries()) {
                    if (app.world.get(entity, i % 2 ? MeshRenderer : Sprite).texture !== latest) throw Error('Stale binding');
                    if (independent) app.world.despawn(entity);
                }
                if (!independent) await scenes.unload('level');
                if (assets.sizes().refRows || assets.entityScopes.size) throw Error('Despawn stranded a receipt');
            } finally {
                assets.releaseAll();
                app.quit();
                shutdownResourceManager();
            }
        },
    };
}

describe.skipIf(!HAS_WASM)('Hot reload - sprites and meshes sharing a texture', () => {
    for (const [count, independent] of [[256, false], [64, true], [256, true], [512, true]] as const) {
        let scene: Awaited<ReturnType<typeof createScene>>;
        const name = independent ? `${count} independent owners` : `${count} entities in one scene`;
        bench(name, () => scene.reload(), {
            setup: async () => { scene = await createScene(count, independent); },
            teardown: () => scene.close(),
            time: 150, iterations: 7, warmupTime: 50, warmupIterations: 2,
        });
    }
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene-asset-receipts.test.ts
 * @brief   A scene load hands its owner the receipts the preload produced.
 *
 * @details Deliberately does NOT mock loadSceneWithAssets: every other scene
 *          test does, so the one line that carries ownership from the preload
 *          to the scene had no coverage at all — removing it left the suite
 *          green while unload silently stopped releasing anything.
 */
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { loadSceneWithAssets } from '../src/scene/scene';
import { Assets } from '../src/asset/Assets';
import { AssetScope } from '../src/asset/AssetLease';
import type { Backend } from '../src/asset/Backend';
import type { SceneData } from '../src/scene/scene';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn(), invalidateTexturePath: vi.fn(() => false) }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

describe('a scene owns the receipts its preload produced', () => {
    it('carries them to collectAssets, and they release the real asset', async () => {
        const unloaded: string[] = [];
        let n = 0;
        const assets = Assets.create({
            backend: {
                fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
                fetchText: vi.fn(async () => '{}'),
                resolveUrl: (p: string) => `http://test/${p}`,
            } as unknown as Backend,
            module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(16), GL: null, FS: null } as never,
        });
        assets.register<{ handle: number; id: string }>({
            type: 'mesh',
            load: async () => ({ handle: 70 + (++n), id: `mesh${n}` }),
            unload: (v: { id: string }) => { unloaded.push(v.id); },
        } as never);

        const scene = {
            version: '1.0', name: 's',
            entities: [{
                id: 1, name: 'ship', parent: null, children: [],
                components: [{ type: 'MeshRenderer', data: { mesh: 'ship.esmesh' } }],
            }],
        } as unknown as SceneData;

        const scope = new AssetScope();
        await loadSceneWithAssets(new World(), scene, {
            assets,
            collectAssets: {
                scope,
                texturePaths: new Set(), materialHandles: new Set(),
                fontPaths: new Set(), spineKeys: new Set(),
            },
        });

        expect(scope.size, 'the preload acquired a mesh but the scene got no receipt').toBe(1);
        scope.releaseAll();
        expect(unloaded).toEqual(['mesh1']);
    });
});

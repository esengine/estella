// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import type { ESEngineModule } from '../src/wasm';
import type { SceneAssetResult } from '../src/asset/Assets';
import type { SceneData } from '../src/scene/scene';
import { discoverSceneAssets } from '../src/asset/discoverAssets';
import { markEngineComponentBaseline, seedEngineComponents } from '../src/ecs/component';
import { Terrain } from '../src/terrain/terrainPlugin';
import { Foliage } from '../src/foliage/foliagePlugin';
import { ImageRevisions } from '../src/terrain/layerArrays';
import { App } from '../src/app/app';
import { Assets as AssetsRes } from '../src/asset/AssetPlugin';

void Terrain;
void Foliage;
markEngineComponentBaseline();

const UUIDS: Record<string, string> = { '@uuid:hm': 'ground/height.png', '@uuid:splat': 'ground/splat.png' };

function buildAssets(): Assets {
    const backend = { resolveUrl: (p: string) => p, fetchText: async () => '', fetchBinary: async () => new ArrayBuffer(0) } as unknown as Backend;
    const assets = Assets.create({ backend, module: { _malloc: () => 0, _free: () => {} } as unknown as ESEngineModule });
    assets.setAssetRefResolver((ref: string) => (ref.startsWith('@uuid:') ? UUIDS[ref] ?? null : ref));
    return assets;
}

function scene(): SceneData {
    return {
        version: 1, name: 's',
        entities: [{ id: 1, name: 'ground', parent: null, children: [], components: [
            { type: 'Terrain', data: { heightmap: '@uuid:hm', splatmap: '@uuid:splat', splatmap2: '@uuid:gone', colorMap: 'ground/color.png' } },
        ] }],
    } as unknown as SceneData;
}

function emptyResult(): SceneAssetResult {
    return {
        textureHandles: new Map(), materialHandles: new Map(), fontHandles: new Map(), meshHandles: new Map(),
        environmentHandles: new Map(), probeVolumeHandles: new Map(),
    } as unknown as SceneAssetResult;
}

describe('an image field', () => {
    beforeEach(() => { seedEngineComponents(); });

    it('is discovered as an image, not as a texture to upload', () => {
        const found = discoverSceneAssets(scene(), (ref) => (ref.startsWith('@uuid:') ? UUIDS[ref] ?? null : ref));
        expect([...(found.byType.get('image') ?? [])].sort()).toEqual(['ground/height.png', 'ground/splat.png']);
        expect([...(found.byType.get('texture') ?? [])]).toEqual(['ground/color.png']);
    });

    it('holds the path it names once the scene is resolved, and nothing where the ref names nothing', () => {
        const data = scene();
        buildAssets().resolveSceneAssetPaths(data, emptyResult());
        const terrain = data.entities[0]!.components[0]!.data as Record<string, unknown>;
        expect(terrain.heightmap).toBe('ground/height.png');
        expect(terrain.splatmap).toBe('ground/splat.png');
        expect(terrain.splatmap2).toBe('');
        expect(terrain.colorMap).toBe(0);
    });
});

describe('a changed image file', () => {
    it('is told to whoever reads it, though nothing had loaded it', () => {
        const assets = buildAssets();
        const told = vi.fn();
        assets.onSourceChanged(told);
        expect(assets.invalidate('@uuid:hm')).toBe(false);
        expect(told).toHaveBeenCalledWith('ground/height.png');
    });

    it('moves the revision of the paths that name it, by uuid or by path, and no other', () => {
        const app = App.new();
        const assets = buildAssets();
        app.insertResource(AssetsRes, assets);
        const revisions = new ImageRevisions();
        const before = revisions.of(app, ['@uuid:hm', 'ground/splat.png', '']);
        assets.invalidate('ground/height.png');
        const after = revisions.of(app, ['@uuid:hm', 'ground/splat.png', '']);
        expect(after).not.toBe(before);
        expect(after.split(',')[1]).toBe(before.split(',')[1]);
        revisions.stop();
        assets.invalidate('ground/height.png');
        expect(revisions.of(app, ['@uuid:hm'])).toBe('0');
    });
});

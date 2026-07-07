// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Per-App runtime Assets: loadRuntimeScene must create the runtime
 *        Assets ONCE and reuse it across scene loads — replacing the default
 *        AssetPlugin resource, keeping the addressable manifest (loadGroup)
 *        and accumulating per-scene texture import settings. The old
 *        instance-per-scene behavior silently dropped the manifest and all
 *        caches/refcounts on every scene switch.
 */
import { describe, it, expect } from 'vitest';
import { loadRuntimeScene } from '../src/runtimeLoader';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { Assets as AssetsClass } from '../src/asset/Assets';
import { ManifestModel } from '../src/asset/AddressableManifest';
import { World } from '../src/world';
import type { App } from '../src/app';
import type { Backend } from '../src/asset/Backend';
import type { ESEngineModule } from '../src/wasm';
import type { SceneData } from '../src/scene';

const fakeModule = { _malloc: () => 0, _free: () => {} } as unknown as ESEngineModule;

const fakeBackend: Backend = {
    resolveUrl: (p: string) => p,
    fetchText: async () => '',
    fetchBinary: async () => new ArrayBuffer(0),
} as unknown as Backend;

function makeFakeApp(): App {
    const resources = new Map<unknown, unknown>();
    return {
        world: new World(),
        hasResource: (r: unknown) => resources.has(r),
        getResource: (r: unknown) => resources.get(r),
        insertResource: (r: unknown, v: unknown) => { resources.set(r, v); },
        getPlugin: () => null,
        sideModules: undefined,
    } as unknown as App;
}

function makeScene(
    name: string,
    textureImporterSettings?: Record<string, { filterMode: string; wrapMode: string }>,
): SceneData {
    const scene: SceneData = { version: '1.0', name, entities: [] };
    if (textureImporterSettings) {
        (scene as SceneData & { textureImporterSettings: unknown }).textureImporterSettings =
            textureImporterSettings;
    }
    return scene;
}

function loadScene(app: App, sceneData: SceneData): Promise<void> {
    return loadRuntimeScene({
        app,
        module: fakeModule,
        sceneData,
        source: {
            backend: fakeBackend,
            decodePixels: () => Promise.reject(new Error('no textures in this test')),
        },
        spineManager: null,
    });
}

describe('per-App runtime Assets persistence', () => {
    it('replaces a pre-existing (AssetPlugin) Assets resource once, then reuses its own', async () => {
        const app = makeFakeApp();
        const pluginAssets = AssetsClass.create({ backend: fakeBackend, module: fakeModule });
        app.insertResource(AssetsResource, pluginAssets);

        await loadScene(app, makeScene('a'));
        const first = app.getResource(AssetsResource);
        expect(first).not.toBe(pluginAssets);

        await loadScene(app, makeScene('b'));
        expect(app.getResource(AssetsResource)).toBe(first);
    });

    it('keeps the addressable manifest across scene loads (loadGroup stays armed)', async () => {
        const app = makeFakeApp();
        await loadScene(app, makeScene('a'));

        const assets = app.getResource(AssetsResource);
        assets.setManifest(ManifestModel.empty());
        expect(assets.getManifest()).not.toBeNull();

        await loadScene(app, makeScene('b'));
        expect(app.getResource(AssetsResource)).toBe(assets);
        expect(assets.getManifest()).not.toBeNull();
    });

    it('accumulates texture import settings across scenes instead of replacing them', async () => {
        const app = makeFakeApp();
        await loadScene(app, makeScene('a', {
            'assets/a.png': { filterMode: 'nearest', wrapMode: 'repeat' },
        }));
        await loadScene(app, makeScene('b', {
            'assets/b.png': { filterMode: 'linear', wrapMode: 'clamp' },
        }));

        const assets = app.getResource(AssetsResource) as unknown as {
            textureImportResolver_: ((ref: string) => { filter?: string; wrap?: string } | undefined) | null;
        };
        expect(assets.textureImportResolver_?.('assets/a.png')).toEqual({ filter: 'nearest', wrap: 'repeat' });
        expect(assets.textureImportResolver_?.('assets/b.png')).toEqual({ filter: 'linear', wrap: 'clamp' });
    });
});

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
import { describe, it, expect, vi } from 'vitest';
import { loadRuntimeScene } from '../src/runtime/runtimeLoader';
import { createPackagedAssetSource, indexPackagedManifest } from '../src/runtime/packagedRuntime';
import { Audio, AudioAPI } from '../src/audio/Audio';
import '../src/audio/AudioComponents';
import { MiniGameAudioBackend } from '../src/audio/MiniGameAudioBackend';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { Assets as AssetsClass } from '../src/asset/Assets';
import { ManifestModel } from '../src/asset/AddressableManifest';
import { World } from '../src/ecs/world';
import type { App } from '../src/app/app';
import type { Backend } from '../src/asset/Backend';
import type { CppResourceManager, ESEngineModule } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';
import type { SceneData } from '../src/scene/scene';

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
    it('preloads UUID audio components with their authored settings when the cook deduplicates the file', async ({ onTestFinished }) => {
        const app = makeFakeApp();
        const audio = new AudioAPI(new MiniGameAudioBackend({} as never));
        app.insertResource(Audio, audio);
        initResourceManager({} as CppResourceManager);
        onTestFinished(() => { audio.dispose(); shutdownResourceManager(); });

        const effect = '11111111-1111-4111-8111-111111111111';
        const music = '22222222-2222-4222-8222-222222222222';
        const file = { type: 'audio' as const, path: 'assets/shared.mp3', labels: [], size: 16 };
        const index = indexPackagedManifest({
            version: '2.0', groups: { main: { bundleMode: 'local', labels: [], assets: {
                [effect]: { ...file, address: 'effect.wav' }, [music]: { ...file, address: 'music.wav' },
            } } },
        });
        audio.setEncodedClips({
            'effect.wav': { lead: 0.012, seconds: 1.97 }, 'music.wav': { lead: 0.025, seconds: 1.955 },
        });
        const refs = [`@uuid:${effect}`, `@uuid:${music}`];
        const scene = makeScene('Audio');
        scene.entities = refs.map((ref, i) => ({
            id: i + 1, name: ref, parent: null, children: [], visible: true,
            components: [{ type: 'AudioSource', data: { clip: ref } }],
        }));
        await loadRuntimeScene({
            app, module: fakeModule, sceneData: scene, spineManager: null,
            source: createPackagedAssetSource(index, { backend: fakeBackend }),
        });
        expect(refs.map(ref => audio.getBufferHandle(ref)?.duration)).toEqual([1.97, 1.955]);
        await audio.preload('music.wav');
        expect(audio.getBufferHandle('music.wav')).toBe(audio.getBufferHandle(refs[1]));
        expect(audio.invalidateBuffer('effect.wav')).toBe(true);
        expect(audio.getBufferStats().bufferCount).toBe(0);
    });

    it('replaces a pre-existing (AssetPlugin) Assets resource once, then reuses its own', async () => {
        const app = makeFakeApp();
        const pluginAssets = AssetsClass.create({ backend: fakeBackend, module: fakeModule });
        app.insertResource(AssetsResource, pluginAssets);

        await loadScene(app, makeScene('a'));
        const first = app.getResource(AssetsResource);
        expect(first).not.toBe(pluginAssets);
        expect(first.getRefCounter()).not.toBeNull();

        await loadScene(app, makeScene('b'));
        expect(app.getResource(AssetsResource)).toBe(first);
        expect(app.world.getStorageSizes().despawnCallbacks).toBe(1);
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

    it('leaves the scene document it loads from as authored, so a restart acquires its assets again', async () => {
        // The document a registered scene is loaded from every time. Resolution wrote
        // handles over its refs, so a restart found nothing to acquire and spawned the
        // handles the outgoing scene had just released: its images drew white.
        const app = makeFakeApp();
        const scene = makeScene('menu');
        scene.entities.push({
            id: 1, name: 'backdrop', parent: null, children: [], visible: true,
            components: [{ type: 'UIVisual', data: { visualType: 2, texture: 'assets/bg_menu.png' } }],
        } as SceneData['entities'][number]);
        const authored = JSON.parse(JSON.stringify(scene));

        await loadScene(app, scene);
        expect(scene).toEqual(authored);
        await loadScene(app, scene);
        expect(scene).toEqual(authored);
    });

    it('uses the importer settings of both published scenes for subsequent texture uploads', async ({ onTestFinished }) => {
        const app = makeFakeApp();
        await loadScene(app, makeScene('a', {
            'assets/a.png': { filterMode: 'nearest', wrapMode: 'repeat' },
        }));
        await loadScene(app, makeScene('b', {
            'assets/b.png': { filterMode: 'linear', wrapMode: 'clamp' },
        }));

        const assets = app.getResource(AssetsResource);
        const manager: Pick<CppResourceManager, 'releaseTexture'> = { releaseTexture() {} };
        initResourceManager(manager as CppResourceManager);
        onTestFinished(() => { assets.releaseAll(); shutdownResourceManager(); });
        let handle = 0;
        const upload = vi.spyOn(assets.getTextureLoader(), 'load').mockImplementation(async () => ({ handle: ++handle, width: 2, height: 2 }));
        await assets.acquireTexture('assets/a.png');
        await assets.acquireTexture('assets/b.png');
        expect(upload.mock.calls.map(([, , options]) => options?.settings)).toMatchObject([
            { filter: 'nearest', wrap: 'repeat' }, { filter: 'linear', wrap: 'clamp' },
        ]);
    });
});

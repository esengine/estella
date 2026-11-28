// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Assets as AssetsResource, assetPlugin } from '../src/asset/AssetPlugin';
import { Assets } from '../src/asset/Assets';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import { HttpBackend } from '../src/asset/Backend';
import { indexPackagedManifest } from '../src/runtime/packagedRuntime';
import { setLinearColorSpace } from '../src/ecs/env';
import { defineComponent, MeshRenderer, TilemapLayer } from '../src/ecs/component';
import { installHotUpdateRebind } from '../src/hotUpdateRebind';
import { connectFakeCpp } from './helpers/fakeEngine';
import { SCENE_FORMAT_VERSION, type SceneData } from '../src/scene/scene';
import { QualityController } from '../src/render/quality';
import { Quality } from '../src/render/qualityRuntime';
import { textureStreamingPlugin } from '../src/render/textureStreaming';
import { textureRefill } from '../src/wasm/textureRefill';
import type { ESEngineModule } from '../src/wasm';

const uploads: { width: number; format: number; flip: boolean; filter: number; wrap: number }[] = [];
const manager = {
    adoptTextureContent: vi.fn(() => true),
    createTextureFromBytes(width: number, _height: number, _bytes: Uint8Array, format: number, flip: boolean,
        _content: number, filter: number, wrap: number): number {
        return uploads.push({ width, format, flip, filter, wrap });
    },
    releaseTexture: vi.fn(),
};
vi.mock('../src/wasm/resourceManager', async (load) => ({
    ...await load<typeof import('../src/wasm/resourceManager')>(),
    requireResourceManager: () => manager,
}));

function installDecoder(assets: Assets): Assets {
    assets.getTextureLoader().setPixelDecoder(async (_path, _flip, edge) => {
        const width = edge || 512;
        return { width, height: 1, pixels: new Uint8Array(width * 4) };
    });
    return assets;
}

function assetsWithPixels(): Assets {
    return installDecoder(Assets.create({ backend: new HttpBackend({ baseUrl: '' }), module: null }));
}

function surfaceScene(...components: SceneData['entities'][number]['components']): SceneData {
    return { version: SCENE_FORMAT_VERSION, name: 'Surfaces',
        entities: components.map((component, id) => ({ id, name: component.type, parent: null, children: [], components: [component] })) };
}

describe('the import settings of one texture request', () => {
    afterEach(() => { uploads.length = 0; setLinearColorSpace(false); });

    it('keeps compatible legacy atlas frames on one upload when another frame changes sampler', async () => {
        const assets = assetsWithPixels();
        const path = 'cache/page%3A1.png', metadata = { atlasFrame: { x: 0, y: 0, width: 2, height: 1 } };
        const image = { path, size: 16, contentHash: 'abc1', type: 'texture' as const, labels: [], metadata };
        const manifest = (filter: 'linear' | 'nearest'): AddressableManifest => ({ version: '2.0', groups: { main: {
            bundleMode: 'local', labels: [], assets: {
                a: { ...image, address: 'sprites/a.png', textureImport: { filter } },
                b: { ...image, address: 'sprites/b.png', textureImport: { filter: 'nearest' } },
                c: { ...image, address: 'sprites/c.png', textureImport: { filter: 'nearest', mipmaps: true } },
            },
        } } });
        const decode = vi.fn(async () => ({ width: 8, height: 1, pixels: new Uint8Array(32) }));
        assets.getTextureLoader().setPixelDecoder(decode);
        assets.setManifest(manifest('linear'));
        try {
            const [a, b, c] = await Promise.all(['a', 'sprites/b.png', '@uuid:c'].map(ref => assets.acquireTexture(ref)));
            expect(decode).toHaveBeenCalledTimes(1);
            expect(uploads).toHaveLength(2);
            expect(uploads[a.value.handle - 1].filter).not.toBe(uploads[b.value.handle - 1].filter);
            expect(b.value).toBe(c.value);
            expect(assets.pathForHandle('texture', b.value.handle)).toBe(path);
            vi.spyOn(assets.backend, 'fetchText').mockResolvedValue(JSON.stringify(manifest('nearest')));
            const plan = await assets.checkForUpdate({ manifestUrl: 'next.json' });
            expect(plan.downloadFiles).toHaveLength(0);
            expect((await assets.applyUpdate()).ok).toBe(true);
            const changed = await assets.acquireTexture('sprites/a.png');
            expect(changed.value).toBe(b.value);
            expect(assets.getTexture('c')).toBe(c.value);
            expect(uploads).toHaveLength(2);
            for (const receipt of [a, b, c, changed]) receipt.release();
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); }
    });

    it('reloads every sampler variant when the physical atlas page is edited', async () => {
        const assets = assetsWithPixels(), path = 'art/page.png';
        const page = { path, type: 'texture' as const, size: 32, labels: [], metadata: { atlasFrame: { x: 0, y: 0, width: 2, height: 2 } } };
        assets.setManifest({ version: '2.0', groups: { main: { bundleMode: 'local', labels: [], assets: {
            smooth: { ...page, address: 'smooth.png' },
            pixel: { ...page, address: 'pixel.png', textureImport: { filter: 'nearest' } },
        } } } });
        try {
            const acquire = () => Promise.all(['smooth', 'pixel'].map(ref => assets.acquireTexture(ref)));
            const before = await acquire();
            expect(assets.invalidate('/' + path)).toBe(true);
            const after = await acquire();
            expect(uploads).toHaveLength(4);
            for (let i = 0; i < 2; i++) {
                expect(after[i].value.handle).not.toBe(before[i].value.handle);
                before[i].release();
                after[i].release();
            }
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); }
    });

    it('retains imported size on the exact generation and orientation that owns it', async () => {
        const assets = assetsWithPixels(), path = 'atlas.png';
        assets.noteMeshSurface({ texture: path });
        assets.setTextureStreamingStart(64);
        try {
            const atlas = await assets.acquireTexture(path, false, 'imported');
            expect(uploads.map(upload => upload.width)).toEqual([512]);
            const mesh = await assets.acquireTexture(path, false);
            const flipped = await assets.acquireTexture(path);
            expect(mesh.value).toBe(atlas.value);
            expect(flipped.value.width).toBe(64);
            const retained = atlas.retain()!;
            atlas.release(); atlas.release();
            expect(await assets.resizeTexture(mesh.value.handle, 32)).toBeNull();
            expect(await assets.resizeTexture(mesh.value.handle, 1024)).toEqual({ width: 512, height: 1 });
            assets.invalidate(path);
            const newMesh = await assets.acquireTexture(path, false);
            expect(newMesh.generation).not.toBe(atlas.generation);
            expect(newMesh.value.width).toBe(64);
            expect(await assets.resizeTexture(newMesh.value.handle, 32)).toEqual({ width: 32, height: 1 });
            const replacement = await assets.acquireTexture(path, false, 'imported');
            retained.release();
            expect(mesh.value.width).toBe(512);
            expect(await assets.resizeTexture(newMesh.value.handle, 32)).toBeNull();
            expect(atlas.retain()).toBeNull();
            replacement.release();
            expect(await assets.resizeTexture(newMesh.value.handle, 32)).toEqual({ width: 32, height: 1 });
            mesh.release(); flipped.release(); newMesh.release();
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); }
    });

    it('uploads imported atlas pixels on the first read while the compressed file is pending', async () => {
        const assets = assetsWithPixels(), path = 'large-page.png';
        const loader = assets.getTextureLoader();
        loader.setCompressedSource(async () => 'pending');
        loader.setPixelDecoder(async () => ({ width: 2048, height: 2, pixels: new Uint8Array(2048 * 2 * 4) }));
        try {
            const atlas = await assets.acquireTexture(path, false, 'imported');
            const scene = await assets.preloadSceneAssets(surfaceScene(
                { type: 'MeshRenderer', data: { texture: path } }, { type: 'Sprite', data: { texture: path } }));
            expect(scene.missing).toEqual([]);
            expect([atlas.value.width, assets.getTexture(path)?.width]).toEqual([2048, 2048]);
            expect(uploads.map(u => u.width)).toEqual([2048, 2048]);
            scene.scope.releaseAll(); atlas.release();
        } finally { assets.releaseAll(); }
    });

    it.each([true, false])('promotes a pending mesh preview on its existing handle with source dimensions %s', async dimensions => {
        const assets = assetsWithPixels(), path = 'pending-mesh.png', loader = assets.getTextureLoader();
        assets.noteMeshSurface({ texture: path });
        let entered!: () => void, resume!: () => void;
        const reading = new Promise<void>(resolve => { entered = resolve; });
        const ready = new Promise<void>(resolve => { resume = resolve; });
        loader.setCompressedSource(async () => 'pending');
        loader.setPixelDecoder(async (_path, _flip, edge) => {
            const width = Math.min(edge || 2048, 2048);
            if (width === 1024) { entered(); await ready; }
            return { width, height: 1, pixels: new Uint8Array(width * 4),
                ...(dimensions && width < 2048 ? { sourceWidth: 2048, sourceHeight: 1 } : {}) };
        });
        try {
            const loading = assets.acquireTexture(path);
            await reading;
            const joining = assets.acquireTexture(path, true, 'imported');
            resume();
            const [mesh, atlas] = await Promise.all([loading, joining]);
            expect(mesh.value).toBe(atlas.value);
            expect(uploads.map(u => u.width)).toEqual([1024, 2048]);
            expect(loader.startedSmall).toBe(0);
            const handle = mesh.value.handle;
            expect(await textureRefill(handle)!()).toBe(true);
            expect(uploads.at(-1)?.width).toBe(2048);
            expect(await assets.resizeTexture(handle, 512)).toBeNull();
            atlas.release();
            expect(await assets.resizeTexture(handle, 1536)).toEqual({ width: 1536, height: 1 });
            expect(assets.textureFullSize(handle)).toEqual({ width: 2048, height: 1 });
            expect(await textureRefill(handle)!()).toBe(true);
            expect(uploads.at(-1)?.width).toBe(1536);
            expect(mesh.value.fullWidth).toBe(2048);
            expect(await assets.resizeTexture(handle, 0)).toEqual({ width: 2048, height: 1 });
            mesh.release();
            expect(assets.sizes().refRows).toBe(0);
        } finally { resume(); assets.releaseAll(); }
    });

    it('supersedes a pending shrink before returning an imported-size receipt', async () => {
        const assets = assetsWithPixels(), path = 'racing-atlas.png';
        let started!: () => void, finish!: () => void;
        const shrinking = new Promise<void>(resolve => { started = resolve; });
        const resume = new Promise<void>(resolve => { finish = resolve; });
        assets.getTextureLoader().setPixelDecoder(async (_path, _flip, edge) => {
            if (edge === 32) { started(); await resume; }
            const width = edge || 512;
            return { width, height: 1, pixels: new Uint8Array(width * 4) };
        });
        try {
            const mesh = await assets.acquireTexture(path);
            const shrink = assets.resizeTexture(mesh.value.handle, 32);
            await shrinking;
            const [first, second] = await Promise.all([assets.acquireTexture(path, true, 'imported'),
                assets.acquireTexture(path, true, 'imported')]);
            finish();
            expect(await shrink).toBeNull();
            expect(first.value).toBe(mesh.value);
            expect(first.value.width).toBe(512);
            first.release();
            expect(await assets.resizeTexture(second.value.handle, 32)).toBeNull();
            second.release();
            expect(await assets.resizeTexture(mesh.value.handle, 32)).toEqual({ width: 32, height: 1 });
            mesh.release();
        } finally { finish(); assets.releaseAll(); }
    });

    it('gives back the imported-size claim when promotion fails', async () => {
        const assets = assetsWithPixels(), path = 'retry-atlas.png';
        assets.noteMeshSurface({ texture: path });
        assets.setTextureStreamingStart(64);
        try {
            const mesh = await assets.acquireTexture(path);
            manager.adoptTextureContent.mockReturnValueOnce(false);
            await expect(assets.acquireTexture(path, true, 'imported')).rejects.toThrow('imported size');
            expect(await assets.resizeTexture(mesh.value.handle, 32)).toEqual({ width: 32, height: 1 });
            const atlas = await assets.acquireTexture(path, true, 'imported');
            expect(atlas.value).toBe(mesh.value);
            expect(atlas.value.width).toBe(512);
            atlas.release(); mesh.release();
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); }
    });

    it('ignores an old size receipt when a reset reuses the numeric handle', async () => {
        const assets = assetsWithPixels();
        try {
            const previous = await assets.acquireTexture('old.png', true, 'imported');
            assets.releaseAll();
            uploads.length = 0;
            const atlas = await assets.acquireTexture('new.png', true, 'imported');
            const mesh = await assets.acquireTexture('new.png');
            expect(atlas.value.handle).toBe(previous.value.handle);
            previous.release();
            expect(await assets.resizeTexture(mesh.value.handle, 64)).toBeNull();
            atlas.release();
            expect(await assets.resizeTexture(mesh.value.handle, 64)).toEqual({ width: 64, height: 1 });
            mesh.release();
        } finally { assets.releaseAll(); }
    });

    it('keeps the reflection atlas and sky panorama full until the environment releases them', async () => {
        const heap = new ArrayBuffer(256);
        const core = { HEAPU8: new Uint8Array(heap), HEAPF32: new Float32Array(heap), _malloc: () => 4, _free: vi.fn(),
            environment_create: vi.fn(() => 42), environment_setSky: vi.fn(), environment_release: vi.fn() };
        const assets = installDecoder(Assets.create({ backend: new HttpBackend({ baseUrl: '' }), module: core as unknown as ESEngineModule }));
        vi.spyOn(assets.backend, 'fetchText').mockResolvedValue(JSON.stringify({
            irradiance: Array(27).fill(0), specular: 'specular.png', sky: 'sky.png', faceSize: 64, mipCount: 4,
        }));
        assets.setTextureStreamingStart(64);
        try {
            const textures = await Promise.all(['art/specular.png', 'art/sky.png'].map(path => {
                assets.noteMeshSurface({ texture: path });
                return assets.acquireTexture(path, false);
            }));
            const [atlas, sky] = textures.map(texture => texture.value);
            expect([atlas.width, sky.width]).toEqual([64, 64]);
            const environment = await assets.acquireTyped('environment', 'art/studio.esenv');
            expect(core.environment_create).toHaveBeenCalledWith(4, atlas.handle, 64, 4, 0, 1);
            expect(core.environment_setSky).toHaveBeenCalledWith(42, sky.handle);
            expect([atlas.width, sky.width]).toEqual([512, 512]);
            for (const texture of textures) expect(await assets.resizeTexture(texture.value.handle, 64)).toBeNull();
            environment.release();
            expect(core.environment_release).toHaveBeenCalledWith(42);
            for (const texture of textures) {
                expect(await assets.resizeTexture(texture.value.handle, 64)).toEqual({ width: 64, height: 1 });
                texture.release();
            }
        } finally { assets.releaseAll(); }
    });

    it('reads a mesh preview from the full image’s CDN and can promote it to the full file', async () => {
        const tail = { path: 'art/small.png', size: 8, width: 2, height: 2, fullWidth: 8, fullHeight: 8 };
        const index = indexPackagedManifest({ version: '2.0', groups: { art: {
            bundleMode: 'remote', labels: [], assets: { wall: {
                path: 'art/full.png', type: 'texture', labels: [], size: 64, streamTail: tail,
            } },
        } } });
        const assets = Assets.create({ module: null, backend: new HttpBackend({ baseUrl: '' }), catalog: index.catalog, manifest: index.model });
        assets.setAssetRefResolver(index.resolvePath);
        assets.setRemoteRoot('https://cdn.test/game');
        assets.setTextureStreamingStart(2);
        const paths: string[] = [];
        assets.getTextureLoader().setPixelDecoder(async path => {
            paths.push(path);
            const size = path.endsWith('small.png') ? 2 : 8;
            return { width: size, height: size, pixels: new Uint8Array(size * size * 4) };
        });
        try {
            const scene = await assets.preloadSceneAssets({
                version: '1.0', name: 'Remote mesh', entities: [
                    { id: 1, name: 'Wall', parent: null, children: [], visible: true,
                        components: [{ type: 'MeshRenderer', data: { texture: 'art/full.png' } }] },
                ],
            });
            expect(scene.missing).toEqual([]);
            const first = assets.getTexture('wall')!;
            expect(first).toMatchObject({ width: 2, fullWidth: 8 });
            expect(await assets.resizeTexture(first.handle, 0)).toEqual({ width: 8, height: 8 });
            expect(paths).toEqual(['https://cdn.test/game/art/small.png', 'https://cdn.test/game/art/full.png']);
            assets.setRemoteRoot('https://mirror.test/game');
            const mirrored = await assets.acquireTexture('wall');
            expect(mirrored.value).toMatchObject({ width: 2, fullWidth: 8 });
            expect(paths.at(-1)).toBe('https://mirror.test/game/art/small.png');
            mirrored.release();
            scene.scope.releaseAll();
        } finally { assets.releaseAll(); }
    });

    it.each([true, false])('keeps its sampler when the streaming policy starts a nested load (flip %s)', async flip => {
        setLinearColorSpace(true);
        const assets = assetsWithPixels();
        assets.noteMeshSurface({ texture: 'normal.png' });
        assets.setTextureImportSettingsResolver(ref => ref === 'normal.png'
            ? { srgb: false, filter: 'nearest', wrap: 'repeat', mipmaps: false }
            : { srgb: true, filter: 'linear', wrap: 'mirror' });
        let nested: Promise<unknown> | undefined;
        assets.setTextureStreamingStart(vi.fn(() => 128).mockImplementationOnce(() => {
            nested = assets.loadTexture('panel.png');
            return 64;
        }));
        try {
            await (flip ? assets.loadTexture('normal.png') : assets.loadTextureRaw('normal.png'));
            await nested;
            expect(uploads).toContainEqual({ width: 64, format: 1, flip, filter: 0, wrap: 0 });
            expect(uploads).toContainEqual({ width: 512, format: 2, flip: true, filter: 3, wrap: 2 });
        } finally { assets.releaseAll(); }
    });

    it.each(['typed first', 'texture first', 'concurrent'] as const)('shares one configured upload and generation (%s)', async order => {
        setLinearColorSpace(true);
        const assets = assetsWithPixels();
        assets.setAssetRefResolver(() => 'tex/normal.png');
        assets.setTextureImportSettingsResolver(ref => ref === 'authored'
            ? { srgb: false, filter: 'nearest', wrap: 'repeat', mipmaps: false } : undefined);
        assets.noteMeshSurface({ texture: 'authored' });
        assets.setTextureStreamingStart(64);
        const viaType = () => assets.acquireTyped<{ handle: number }>('texture', 'authored');
        const viaTexture = () => assets.acquireTexture('authored');
        try {
            const pending = order === 'texture first' ? undefined : viaType();
            if (order === 'typed first') await pending;
            const texture = await viaTexture();
            const typed = await (pending ?? viaType());
            expect(uploads).toEqual([{ width: 64, format: 1, flip: true, filter: 0, wrap: 0 }]);
            expect(typed.value).toBe(texture.value);
            expect(typed.key).toBe('texture:tex/normal.png');
            expect(typed.generation).toBe(texture.generation);
            const extra = typed.retain()!;
            typed.release(); texture.release();
            expect(extra.key).toBe(typed.key);
            expect(assets.getTexture('authored')).toBe(extra.value);
            extra.release();
            expect(assets.getTexture('authored')).toBeUndefined();
        } finally { assets.releaseAll(); }
    });

    it('releases the default typed orientation by path and still honors a custom texture loader', async () => {
        const assets = assetsWithPixels();
        try {
            const raw = await assets.loadTextureRaw('dual.png');
            const normal = await assets.acquireTyped<{ handle: number }>('texture', 'dual.png');
            expect(assets.getTexture('dual.png')).toBe(normal.value);
            assets.releaseTyped('texture', 'dual.png');
            expect(assets.getTexture('dual.png')).toBeUndefined();
            expect(assets.textureResizable(raw.handle)).toBe(true);
            const unload = vi.fn();
            assets.register({ type: 'texture', extensions: [], load: async () => 'custom', unload });
            const custom = await assets.acquireTyped<string>('texture', 'dual.png');
            expect(custom.value).toBe('custom');
            assets.releaseTyped('texture', 'dual.png');
            expect(unload).toHaveBeenCalledWith('custom');
            expect(assets.textureResizable(raw.handle)).toBe(true);
        } finally { assets.releaseAll(); }
    });

    it('keeps a typed receipt on its original upload across a file edit', async () => {
        const assets = assetsWithPixels();
        try {
            const old = await assets.acquireTyped<{ handle: number }>('texture', 'edited.png');
            assets.invalidate('edited.png');
            const current = await assets.acquireTexture('edited.png');
            const oldChild = old.retain()!;
            expect(current.generation).not.toBe(old.generation);
            expect(current.value.handle).not.toBe(old.value.handle);
            expect(oldChild.value).toBe(old.value);
            old.release(); oldChild.release();
            expect(assets.getTexture('edited.png')).toBe(current.value);
            current.release();
        } finally { assets.releaseAll(); }
    });
});

function appWithQuality(edge: 64 | 128 | 256): App {
    const app = App.new();
    vi.spyOn(app, 'wasmModule', 'get').mockReturnValue({ renderer_takeTextureWants: () => '' } as ESEngineModule);
    app.insertResource(Quality, new QualityController({
        mode: 'high', profiles: { high: { textureStreaming: true, textureStreamingStartEdge: edge } },
    }));
    return app;
}

async function firstWidth(assets: Assets, path: string, mesh = true): Promise<number> {
    if (mesh) assets.noteMeshSurface({ texture: path });
    const image = await assets.acquireTexture(path);
    try { return image.value.width; } finally { image.release(); }
}

describe('mesh texture size before the first frame', () => {
    afterEach(() => { uploads.length = 0; vi.restoreAllMocks(); });

    it.each(['released', 'reset', 'active', 'mixed'] as const)('loads the imported image for a sprite after a %s mesh acquisition', async mode => {
        const assets = assetsWithPixels();
        assets.setTextureStreamingStart(64);
        assets.getTextureLoader().setPixelDecoder(async (_path, _flip, edge) => {
            const width = edge || 512;
            return { width, height: 1, sourceWidth: 512, sourceHeight: 1, pixels: new Uint8Array(width * 4) };
        });
        const path = 'shared.png', mesh = { type: 'MeshRenderer', data: { texture: path } }, sprite = { type: 'Sprite', data: { texture: path } };
        try {
            const meshLoad = mode === 'mixed' ? undefined : await assets.preloadSceneAssets(surfaceScene(mesh));
            if (meshLoad) expect(assets.getTexture(path)?.width).toBe(64);
            if (mode === 'released') meshLoad!.scope.releaseAll();
            if (mode === 'reset') assets.releaseAll();
            const drawing = await assets.preloadSceneAssets(mode === 'mixed' ? surfaceScene(mesh, sprite) : surfaceScene(sprite));
            expect(drawing.missing).toEqual([]);
            expect(assets.getTexture(path)?.width).toBe(512);
            expect(uploads.map(u => u.width)).toEqual(mode === 'mixed' ? [512] : [64, 512]);
            if (mode === 'active') expect(drawing.textureHandles.get(path)).toBe(meshLoad!.textureHandles.get(path));
            drawing.scope.releaseAll();
            meshLoad?.scope.releaseAll();
            expect(await firstWidth(assets, path, false)).toBe(512);
            const nextMesh = await assets.preloadSceneAssets(surfaceScene(mesh));
            expect(assets.getTexture(path)?.width).toBe(64);
            nextMesh.scope.releaseAll();
        } finally { assets.releaseAll(); }
    });

    it('uses the declared texture fields of tilemaps and project components when a mesh normal map shares their file', async () => {
        const assets = assetsWithPixels();
        assets.setTextureStreamingStart(64);
        const custom = defineComponent('StreamedProjectPanel', { atlas: 0 }, { assetFields: [{ field: 'atlas', type: 'texture' }] });
        try {
            for (const [type, field] of [['TilemapLayer', 'tileset'], [custom._name, 'atlas']]) {
                const path = type + '.png';
                const scene = await assets.preloadSceneAssets(surfaceScene(
                    { type, data: { [field]: path } }, { type: 'MeshRenderer', data: { normalMap: path } }));
                expect(assets.getTexture(path)?.width).toBe(512);
                scene.scope.releaseAll();
            }
        } finally { assets.releaseAll(); }
    });

    it('reuses the first upload when a bounded decode already returned the imported dimensions', async () => {
        const assets = assetsWithPixels(), file = 'small.png';
        assets.setTextureStreamingStart(64);
        assets.getTextureLoader().setPixelDecoder(async () => ({
            width: 32, height: 1, sourceWidth: 32, sourceHeight: 1, pixels: new Uint8Array(32 * 4),
        }));
        try {
            const mesh = await assets.preloadSceneAssets(surfaceScene({ type: 'MeshRenderer', data: { texture: file } }));
            const sprite = await assets.preloadSceneAssets(surfaceScene({ type: 'Sprite', data: { texture: file } }));
            expect(sprite.missing).toEqual([]);
            expect(sprite.textureHandles.get(file)).toBe(mesh.textureHandles.get(file));
            expect(uploads.map(upload => upload.width)).toEqual([32]);
            mesh.scope.releaseAll(); sprite.scope.releaseAll();
        } finally { assets.releaseAll(); }
    });

    it('reads measured and unmeasured fields independently on the same renderer', async () => {
        const assets = assetsWithPixels();
        assets.setTextureStreamingStart(64);
        const surface = defineComponent('StreamedTwoTextures', { surface: 0, overlay: 0 }, { assetFields: [
            { field: 'surface', type: 'texture', measuresTextureDensity: true }, { field: 'overlay', type: 'texture' },
        ] });
        try {
            const data = surfaceScene({ type: surface._name, data: { surface: 'albedo.png', overlay: 'overlay.png' } });
            const scene = await assets.preloadSceneAssets(data);
            expect(assets.getTexture('albedo.png')?.width).toBe(64);
            expect(assets.getTexture('overlay.png')?.width).toBe(512);
            scene.scope.releaseAll();
        } finally { assets.releaseAll(); }
    });

    it('rechecks the live readers on each file update, including a tileset added between two updates', async () => {
        const app = App.new(), assets = assetsWithPixels(), world = app.world, path = 'dynamic.png';
        connectFakeCpp(world);
        assets.setTextureStreamingStart(64);
        app.insertResource(AssetsResource, assets);
        installHotUpdateRebind(app, assets);
        const update = async () => {
            assets.invalidate(path);
            for (let i = 0; i < 4; i++) {
                await app.tick(1 / 60);
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            return assets.getTexture(path)!;
        };
        try {
            const mesh = world.spawn(), first = await assets.acquireTexture(path);
            world.insert(mesh, MeshRenderer, { texture: first.value.handle });
            const small = await update();
            expect(small.width).toBe(64);
            const tiles = world.spawn();
            world.insert(tiles, TilemapLayer, { tileset: small.handle });
            const shared = await update();
            expect(shared.width).toBe(512);
            expect(world.get(tiles, TilemapLayer).tileset).toBe(shared.handle);
            expect(world.get(mesh, MeshRenderer).texture).toBe(shared.handle);
            world.despawn(tiles);
            expect((await update()).width).toBe(64);
            first.release(); world.despawn(mesh);
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); app.quit(); }
    });

    it('keeps a parent material texture full for a sprite that joins a mesh material instance', async () => {
        const assets = assetsWithPixels();
        assets.setTextureStreamingStart(64);
        assets.register({ type: 'material-shader', extensions: [], load: async () => ({ compile: () => 1, compileDocument: () => 1 }) });
        vi.spyOn(assets.backend, 'fetchText').mockImplementation(async url => JSON.stringify(url.endsWith('child.esmaterial')
            ? { type: 'material', instanceOf: 'parent.esmaterial', properties: {} }
            : { type: 'material', shader: 'builtin:test', properties: { u_map: 'map.png' } }));
        const ref = 'art/child.esmaterial', file = 'art/map.png';
        try {
            const mesh = await assets.preloadSceneAssets(surfaceScene({ type: 'MeshRenderer', data: { material: ref } }));
            expect(mesh.missing).toEqual([]);
            const texture = assets.getTexture(file)!;
            expect(texture.width).toBe(64);
            const sprite = await assets.preloadSceneAssets(surfaceScene({ type: 'Sprite', data: { material: ref } }));
            expect(sprite.missing).toEqual([]);
            expect(sprite.materialHandles.get(ref)).toBe(mesh.materialHandles.get(ref));
            expect(assets.getTexture(file)).toMatchObject({ handle: texture.handle, width: 512 });
            mesh.scope.releaseAll(); sprite.scope.releaseAll();
            expect(await firstWidth(assets, file, false)).toBe(512);
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); }
    });

    it('retries a refused full-size upload without dropping the mesh reader, and shares a concurrent retry', async () => {
        const assets = assetsWithPixels();
        assets.setTextureStreamingStart(64);
        const file = 'racing.png', sheet = surfaceScene({ type: 'TilemapLayer', data: { tileset: file } });
        try {
            const mesh = await assets.preloadSceneAssets(surfaceScene({ type: 'MeshRenderer', data: { normalMap: file } }));
            const handle = mesh.textureHandles.get(file);
            manager.adoptTextureContent.mockReturnValueOnce(false);
            const failed = await assets.preloadSceneAssets(sheet);
            expect(failed.missing).toHaveLength(1);
            expect(assets.sizes().refRows).toBe(1);
            expect(assets.getTexture(file)).toMatchObject({ handle, width: 64 });
            const [a, b] = await Promise.all([assets.preloadSceneAssets(sheet), assets.preloadSceneAssets(sheet)]);
            expect([...a.missing, ...b.missing]).toEqual([]);
            expect(uploads.map(u => u.width)).toEqual([64, 512, 512]);
            expect(assets.getTexture(file)).toMatchObject({ handle, width: 512 });
            mesh.scope.releaseAll(); a.scope.releaseAll(); b.scope.releaseAll();
            expect(assets.sizes().refRows).toBe(0);
        } finally { assets.releaseAll(); }
    });

    it('reads the owning App in either plugin order and after another App quits', async () => {
        const first = appWithQuality(64), second = appWithQuality(256);
        first.addPlugin(assetPlugin).addPlugin(textureStreamingPlugin);
        second.addPlugin(textureStreamingPlugin).addPlugin(assetPlugin);
        const a = installDecoder(first.getResource(AssetsResource)), b = installDecoder(second.getResource(AssetsResource));
        try {
            expect(await firstWidth(a, 'first.png')).toBe(64);
            expect(await firstWidth(b, 'second.png')).toBe(256);
            expect(await firstWidth(a, 'sprite.png', false)).toBe(512);
            second.quit();
            expect(await firstWidth(a, 'survivor.png')).toBe(64);
            expect(await firstWidth(b, 'retired.png')).toBe(512);
        } finally { first.quit(); second.quit(); }
    });

    it('follows a replaced Assets and late quality changes before any frame runs', async () => {
        const app = appWithQuality(128);
        const initial = assetsWithPixels(), replacement = assetsWithPixels(), standalone = assetsWithPixels();
        app.insertResource(AssetsResource, initial).addPlugin(textureStreamingPlugin);
        try {
            expect(await firstWidth(initial, 'first.png')).toBe(128);
            app.insertResource(AssetsResource, replacement);
            expect(await firstWidth(replacement, 'new.png')).toBe(128);
            expect(await firstWidth(initial, 'detached.png')).toBe(512);
            expect(await firstWidth(standalone, 'unbound.png')).toBe(512);
            app.getResource(Quality)!.setMode('off');
            expect(await firstWidth(replacement, 'quality-off.png')).toBe(512);
            app.insertResource(Quality, null);
            expect(await firstWidth(replacement, 'no-quality.png')).toBe(512);
        } finally { app.quit(); }
    });
});

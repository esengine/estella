// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    native-assets.test.ts
 * @brief   The native asset channel (Stage B): the SAME `Assets` class + loaders
 *          the web build uses, over the native core. A mock host scope stands in
 *          for the QuickJS globals (es_rm_createTextureEx / es_rm_releaseTexture /
 *          es_getTextureDimensions) and a mock NativeBridge decodes images, so
 *          `Assets.loadTexture` flows end-to-end — TextureLoader -> pixel decode ->
 *          native ResourceManager createTextureFromBytes — with no wasm module,
 *          headless.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeApp } from '../src/ecs/bridge/nativeRuntime';
import { addPlugin, captureProjectRegistrations } from '../src/app/app';
import { initNativeGame } from '../src/runtime/nativeGameRuntime';
import { loadPackagedScenes, type PackagedGameConfig } from '../src/runtime/packagedRuntime';
import { SceneManager } from '../src/scene/sceneManager';
import { WorldStreaming } from '../src/residency/WorldStreamer';
import { worldCellDocumentPath } from '../src/residency/report';
import { setNativeEngineApi } from '../src/ecs/bridge/engineApi';
import { builtinMeshTemplate } from '../src/asset/builtinMeshes';
import { createNativeResourceManager } from '../src/ecs/bridge/nativeResourceManager';
import { Assets } from '../src/asset/AssetPlugin';
import { RuntimeConfig } from '../src/defaults';
import { shutdownResourceManager } from '../src/wasm/resourceManager';
import { TextureContent } from '../src/wasm';
import { setPlatform } from '../src/platform/base';
import type { NativeBridge } from '../src/platform/native/bridge';
import { withRegistryOps } from './helpers/nativeRegistryOps';

/** A mock native ResourceManager scope: a Map-backed texture pool addressed by
 *  handle, exposed through the es_* host globals the SDK's native RM binds to. */
function makeTextureScope() {
    const textures = new Map<number, { width: number; height: number; pixels: Uint8Array; format: number; flip: boolean }>();
    let nextHandle = 1;
    // The engine's own rm_createTextureEx, as its generated QuickJS wrapper binds
    // it: a byte COUNT beside the buffer (a heap offset on the web), and explicit
    // filter/wrap codes.
    const createSpy = vi.fn(
        (width: number, height: number, pixels: Uint8Array, pixelsLen: number,
         format: number, flip: boolean, filter: number, wrap: number) => {
            const handle = nextHandle++;
            textures.set(handle, { width, height, pixels, format, flip });
            void pixelsLen; void filter; void wrap;
            return handle;
        },
    );
    const releaseSpy = vi.fn((handle: number) => { textures.delete(handle); });
    const scope: Record<string, unknown> = {
        es_rm_createTextureEx: createSpy,
        es_rm_releaseTexture: releaseSpy,
        es_getTextureDimensions: (handle: number) => {
            const t = textures.get(handle);
            return t ? { width: t.width, height: t.height } : null;
        },
    };
    return { scope, textures, createSpy, releaseSpy };
}

/** RGBA pixels for a solid w×h image (top-first), matching loadImagePixels. */
function solidImage(width: number, height: number, r = 255, g = 128, b = 64) {
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }
    return { width, height, pixels };
}

/** A NativeBridge that decodes a known image path; other calls are stubs. */
function makeBridge(images: Record<string, { width: number; height: number; pixels: Uint8Array }>) {
    const bridge: NativeBridge = {
        readFile: async () => new ArrayBuffer(0),
        fileExists: async (p) => p in images,
        fetch: async () => ({ ok: false, status: 404 }),
        loadImagePixels: async (path) => {
            const img = images[path];
            if (!img) throw new Error(`no image: ${path}`);
            return img;
        },
        getStorageItem: () => null,
        setStorageItem: () => {},
        removeStorageItem: () => {},
        storageKeys: () => [],
        registerInput: () => () => {},
        devicePixelRatio: () => 1,
    };
    return bridge;
}

afterEach(() => {
    shutdownResourceManager();
    // Drop the native platform this suite installed so it can't leak into others.
    setPlatform(null as never);
});

describe('packaged scene files', () => {
    it.each(['live', 'restored', 'entry', 'entry-hash', 'reload'] as const)('uses the updated scene document on %s', async timing => {
        const ref = 'levels/Room.esscene';
        const uuid = 'afbace01-1111-4111-8111-111111111111';
        const shippedPath = 'cooked/room-v1.json';
        const updatedPath = timing === 'entry-hash' ? shippedPath : 'cooked/room-v2.json';
        const updateRoot = 'https://cdn.invalid/v2';
        const persistKey = 'hotupdate:scene';
        const manifest = (revision: string, path: string, bundleMode: 'local' | 'remote') => ({
            version: '2.0' as const, revision, groups: { main: { bundleMode, labels: [], assets: {
                [uuid]: { address: ref, path, type: 'scene' as const, size: 32, labels: [], contentHash: revision === 'v1' ? 'a'.repeat(32) : 'b'.repeat(32) },
            } } },
        });
        const shipped = manifest('v1', shippedPath, 'local');
        const updated = manifest('v2', updatedPath, 'remote');
        const restoredEntry = timing === 'entry' || timing === 'entry-hash';
        const entry = restoredEntry || timing === 'reload';
        const config = {
            entryScene: entry ? ref : 'menu.json',
            scenes: [{ name: 'menu', path: 'menu.json' }, { name: 'room', path: ref }],
            hotUpdate: { persistUpdateKey: persistKey },
        };
        const encode = (data: unknown) => new TextEncoder().encode(JSON.stringify(data)).buffer;
        const document = (name: string) => ({ version: 4, name, entities: [] });
        const files = new Map<string, unknown>([
            ['game.config.json', config], ['asset-manifest.json', shipped],
            ['menu.json', document('menu')], [shippedPath, document('old room')],
        ]);
        const bridge = makeBridge({});
        const read = vi.fn(async (path: string) => {
            if (!files.has(path)) throw new Error(`missing ${path}`);
            return encode(files.get(path));
        });
        const fetch = vi.fn(async (url: string) => ({
            ok: url === `${updateRoot}/${updatedPath}`, status: url === `${updateRoot}/${updatedPath}` ? 200 : 404,
            text: JSON.stringify(document('updated room')),
        }));
        bridge.readFile = read;
        bridge.fetch = fetch;
        bridge.getStorageItem = key => (timing === 'restored' || restoredEntry) && key === persistKey
            ? JSON.stringify({ base: 'v1', manifest: updated, remoteRoot: updateRoot }) : null;
        const scope = withRegistryOps({ es_Camera_buffer: () => null, es_Camera_has: () => false, es_Camera_remove: () => {} });
        const { app } = await initNativeGame({ bridge, scope, width: 32, height: 32 });
        try {
            const assets = app.getResource(Assets);
            const manager = app.getResource(SceneManager);
            if (timing === 'live' || timing === 'reload') {
                assets.setManifest(updated);
                assets.setRemoteRoot(updateRoot);
            }
            expect(assets.getManifest()?.revision()).toBe('v2');
            if (!restoredEntry) {
                expect(fetch).not.toHaveBeenCalled();
                if (timing === 'reload') await manager.reload();
                else await manager.switchTo('room');
            }
            expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${updateRoot}/${updatedPath}`]);
            expect(read.mock.calls.filter(([path]) => path === shippedPath)).toHaveLength(entry ? 1 : 0);
            expect(manager.getActive()).toBe('room');
        } finally { app.quit(); }
    });

    it('starts the captured project repeatedly and leaves the next project queued', async () => {
        const bridge = makeBridge({});
        bridge.readFile = async path => {
            const document = path === 'game.config.json' ? { entryScene: 'menu.json' }
                : path === 'asset-manifest.json' ? { version: '2.0', groups: {} }
                : { version: '1.0', entities: [] };
            return new TextEncoder().encode(JSON.stringify(document)).buffer;
        };
        const build = vi.fn(), nextBuild = vi.fn();
        addPlugin({ build });
        const project = captureProjectRegistrations();
        addPlugin({ build: nextBuild });
        try {
            for (const projectPlugin of [project, project, undefined]) {
                const scope = withRegistryOps({ es_Camera_buffer: () => null, es_Camera_has: () => false, es_Camera_remove: () => {} });
                const { app } = await initNativeGame({ bridge, scope, width: 32, height: 32, projectPlugin });
                try { expect(nextBuild).toHaveBeenCalledTimes(projectPlugin ? 0 : 1); }
                finally { app.quit(); }
            }
            expect(build).toHaveBeenCalledTimes(2);
        } finally { captureProjectRegistrations(); }
    });

    it('releases the native game when the entry scene cannot be read', async () => {
        const bridge = makeBridge({});
        const releaseInput = vi.fn();
        const releaseShow = vi.fn();
        bridge.registerInput = () => releaseInput;
        bridge.onShow = () => releaseShow;
        const failure = new Error('entry scene unavailable');
        bridge.readFile = async path => {
            if (path === 'menu.json') throw failure;
            const json = path === 'game.config.json' ? { entryScene: 'menu.json' } : { version: '2.0', groups: {} };
            return new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer;
        };
        await expect(initNativeGame({ bridge, scope: withRegistryOps({}), width: 32, height: 32 })).rejects.toThrow('entry scene unavailable');
        expect(releaseInput).toHaveBeenCalledOnce();
        expect(releaseShow).toHaveBeenCalledOnce();
    });

    it('resolves the streamed world through the active package manifest when revisiting a scene', async () => {
        const worldRef = 'world/room.world.json';
        const key = 'afbace01-5555-4555-8555-555555555555';
        const shipped = 'staged/room-world-v1.json', updated = 'staged/room-world-v2.json';
        const cdn = 'https://cdn.invalid/v2';
        const scene = (name: string) => ({ version: 4, name, entities: [] });
        const world = (path: string) => ({
            version: 1, scene: 'room', persistentRefs: [], cellSize: 100,
            cells: [{ name: 'room-cell', path, x: 0, z: 0, minX: 0, minZ: 0, maxX: 100, maxZ: 100, entityCount: 0 }],
        });
        const manifest = (path: string, bundleMode: 'local' | 'remote') => ({
            version: '2.0' as const, groups: { main: { bundleMode, labels: [], assets: {
                [key]: { path, address: worldRef, type: 'json' as const, size: 100, labels: [] },
            } } },
        });
        const config: PackagedGameConfig = {
            entryScene: 'menu.json',
            scenes: [{ name: 'menu', path: 'menu.json' }, { name: 'room', path: 'room.json' }],
            worlds: [{ scene: 'room', manifest: worldRef }],
        };
        const files = new Map<string, unknown>([
            ['game.config.json', config], ['asset-manifest.json', manifest(shipped, 'local')],
            ['menu.json', scene('menu')], ['room.json', scene('room')], [shipped, world('world/cell-v1.json')],
        ]);
        const bridge = makeBridge({});
        const read = vi.fn(async (path: string) => {
            if (!files.has(path)) throw new Error(`missing ${path}`);
            return new TextEncoder().encode(JSON.stringify(files.get(path))).buffer;
        });
        const fetch = vi.fn(async (url: string) => ({
            ok: url === `${cdn}/${updated}`, status: url === `${cdn}/${updated}` ? 200 : 404,
            text: JSON.stringify(world('world/cell-v2.json')),
        }));
        bridge.readFile = read;
        bridge.fetch = fetch;
        const scope = withRegistryOps({ es_Camera_buffer: () => null, es_Camera_has: () => false, es_Camera_remove: () => {} });
        const { app } = await initNativeGame({ bridge, scope, width: 32, height: 32 });
        try {
            const manager = app.getResource(SceneManager), assets = app.getResource(Assets);
            expect(read).not.toHaveBeenCalledWith(shipped);
            await manager.switchTo('room');
            expect(worldCellDocumentPath(app, 'room-cell')).toBe('world/cell-v1.json');
            await manager.switchTo('menu');
            await manager.switchTo('room');
            expect(read.mock.calls.filter(([path]) => path === shipped)).toHaveLength(1);
            await manager.switchTo('menu');
            assets.setManifest(manifest(updated, 'remote'));
            assets.setRemoteRoot(cdn);
            await manager.switchTo('room');
            expect(worldCellDocumentPath(app, 'room-cell')).toBe('world/cell-v2.json');
            expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${cdn}/${updated}`]);
        } finally { app.quit(); }
    });

    it('reads a world on first use, retries a bad manifest, and gives residency only to the active scene', async () => {
        const scenes = ['menu', 'levels/a', 'levels/b'].map(name => ({ name, path: name + '.json' }));
        const worlds = scenes.slice(1).map(({ name }) => ({ scene: name, manifest: name + '.world.json' }));
        const config: PackagedGameConfig = { entryScene: 'menu.json', scenes, worlds };
        const files = new Map<string, unknown>([
            ['game.config.json', config], ['asset-manifest.json', { version: '2.0', groups: {} }],
        ]);
        for (const scene of scenes) files.set(scene.path, { version: 4, name: scene.name, entities: [] });
        const manifest = (scene: string) => ({
            version: 1, scene, persistentRefs: [], cellSize: 100,
            cells: [{ name: 'shared', path: `${scene}/shared.json`, x: 0, z: 0,
                minX: 0, minZ: 0, maxX: 100, maxZ: 100, entityCount: 0 }],
        });
        files.set(worlds[0]!.manifest, manifest('levels/a'));
        const bridge = makeBridge({});
        const read = vi.fn(async (path: string) => {
            if (!files.has(path)) throw new Error(path);
            return new TextEncoder().encode(JSON.stringify(files.get(path))).buffer;
        });
        bridge.readFile = read;
        const scope = withRegistryOps({ es_Camera_buffer: () => null, es_Camera_has: () => false, es_Camera_remove: () => {} });
        const { app } = await initNativeGame({ bridge, scope, width: 640, height: 360 });
        try {
            const manager = app.getResource(SceneManager), streamer = app.getResource(WorldStreaming);
            expect(manager.getActive()).toBe('menu');
            expect(streamer.manifest).toBeNull();
            expect(read.mock.calls.flat()).not.toContain(worlds[0]!.manifest);
            await manager.loadAdditive('levels/a');
            expect(streamer.manifest).toBeNull();
            expect(worldCellDocumentPath(app, 'shared')).toBeUndefined();
            await manager.load('levels/a');
            expect(streamer.manifest?.scene).toBe('levels/a');
            expect(worldCellDocumentPath(app, 'shared')).toBe('levels/a/shared.json');
            expect(read.mock.calls.flat()).not.toContain(worlds[1]!.manifest);
            const original = manager.getScene('levels/a');
            const target = manifest('levels/b');
            for (const [bad, diagnostic] of [
                [manifest('wrong'), /Invalid world manifest/],
                [{ ...target, cells: [{ ...target.cells[0], maxX: null }] }, /shared.*bounds/],
                [{ ...target, cells: [{ ...target.cells[0], name: 'menu' }] }, /menu.*already used/],
            ] as const) {
                files.set(worlds[1]!.manifest, bad);
                await expect(manager.switchTo('levels/b')).rejects.toThrow(diagnostic);
                expect(manager.getActive()).toBe('levels/a');
                expect(manager.getScene('levels/a')).toBe(original);
                expect(worldCellDocumentPath(app, 'shared')).toBe('levels/a/shared.json');
                expect(manager.isLoaded('levels/b')).toBe(false);
            }
            files.set(worlds[1]!.manifest, manifest('levels/b'));
            await manager.switchTo('levels/b');
            expect(streamer.manifest?.scene).toBe('levels/b');
            expect(worldCellDocumentPath(app, 'shared')).toBe('levels/b/shared.json');
            expect(worldCellDocumentPath(app, 'absent')).toBeUndefined();
            await manager.loadAdditive('levels/a');
            expect(streamer.sourceSceneAllowed?.('levels/a')).toBe(false);
            expect(streamer.sourceSceneAllowed?.('levels/b')).toBe(true);
            expect(streamer.sourceSceneAllowed?.('menu')).toBe(true);
            await manager.reload();
            expect(read.mock.calls.flat().filter(path => path === worlds[1]!.manifest)).toHaveLength(4);
            await manager.switchTo('menu');
            expect(streamer.manifest).toBeNull();
            expect(worldCellDocumentPath(app, 'shared')).toBeUndefined();

            const index = { resolvePath: (path: string) => path };
            const selected = await loadPackagedScenes(config, index, '__play', 'levels/a');
            expect(selected.firstScene).toBe('levels/a');
            expect(selected.scenes.find(scene => scene.name === 'menu')).toEqual({ name: 'menu', path: 'menu.json' });
            expect(selected.scenes.find(scene => scene.name === 'levels/a')?.data?.name).toBe('levels/a');
            await expect(loadPackagedScenes(config, index, '__play', 'absent')).rejects.toThrow(/no scene named/);
            expect((await loadPackagedScenes({ entryScene: 'menu.json' }, index, 'main')).firstScene).toBe('main');
        } finally { app.quit(); }
    });
});

describe('createNativeResourceManager', () => {
    it('uses the generated cache budget and trim bindings when present', () => {
        const budget = vi.fn(), legacy = vi.fn(), trim = vi.fn(() => 3);
        const rm = createNativeResourceManager({ es_rm_setTextureBudget: budget, es_setTextureBudget: legacy,
            es_rm_trimTextureCache: trim });
        rm.setTextureBudget(512);
        expect(budget).toHaveBeenCalledWith(512);
        expect(legacy).not.toHaveBeenCalled();
        expect(rm.trimTextureCache!()).toBe(3);
        createNativeResourceManager({ es_setTextureBudget: legacy }).setTextureBudget(256);
        expect(legacy).toHaveBeenCalledWith(256);
    });

    it.each(['es_rm_acquireTextureByPath', 'es_rm_invalidateTexturePath'])(
        'keeps a host with only %s on the decode path', name => {
            const rm = createNativeResourceManager({ [name]: vi.fn() });
            expect(rm.acquireTextureByPath).toBeUndefined();
            expect(rm.invalidateTexturePath).toBeUndefined();
        });

    it('uploads bytes through es_rm_createTextureEx and reads dims / releases', () => {
        const { scope, createSpy, releaseSpy } = makeTextureScope();
        const rm = createNativeResourceManager(scope);

        const px = new Uint8Array([1, 2, 3, 4]);
        const handle = rm.createTextureFromBytes!(1, 1, px, 1, true, TextureContent.Asset);
        expect(handle).toBe(1);
        // Byte count beside the buffer, and the plain path's defaults where the
        // caller gave no import settings (filter Linear, wrap ClampToEdge).
        expect(createSpy).toHaveBeenCalledWith(1, 1, px, px.length, 1, true, 1, 1, TextureContent.Asset);
        expect(rm.getTextureDimensions(handle)).toEqual({ width: 1, height: 1 });

        rm.releaseTexture(handle);
        expect(releaseSpy).toHaveBeenCalledWith(handle);
        expect(rm.getTextureDimensions(handle)).toBeNull();
    });

    it('makes a texture array from its layers as bytes, without a wasm heap', async () => {
        const calls: unknown[][] = [];
        const rm = createNativeResourceManager({
            es_rm_createTextureArray: (...args: unknown[]) => { calls.push(args); return 7; },
        });
        const { createTextureArrayFromPixels } = await import('../src/runtime/runtimeAssets');
        const a = new Uint8Array(16).fill(1);
        const b = new Uint8Array(16).fill(2);
        // No module, no heap: the device has neither, and used to refuse the terrain's layer arrays for it.
        const handle = createTextureArrayFromPixels(null, { width: 2, height: 2, layers: [a, b] }, TextureContent.Asset, undefined, rm);
        expect(handle).toBe(7);
        const [w, h, layers, bytes, len] = calls[0] as [number, number, number, Uint8Array, number];
        expect([w, h, layers, len]).toEqual([2, 2, 2, 32]);
        expect([...bytes]).toEqual([...a, ...b]);
    });

    it('fails loud on the wasm/GL-only surface (no heap or GL on native)', () => {
        const rm = createNativeResourceManager({});
        expect(() => rm.createTexture(1, 1, 0, 4, 1, true, TextureContent.Asset)).toThrow(/not supported/);
        expect(() => rm.registerExternalTexture(0, 1, 1, TextureContent.Asset)).toThrow(/not supported/);
    });
});

describe('native Assets.loadTexture', () => {
    it('applies startup budgets and trims this pool on memory pressure until the App quits', () => {
        const { scope } = makeTextureScope();
        const budget = vi.fn(), retained = vi.fn(), trim = vi.fn(() => 1);
        Object.assign(scope, { es_rm_setTextureBudget: budget, es_rm_setRetainedBudget: retained, es_rm_trimTextureCache: trim });
        const subscribers = new Set<() => void>();
        const bridge = makeBridge({});
        bridge.onMemoryWarning = fn => { subscribers.add(fn); return () => { subscribers.delete(fn); }; };
        const app = createNativeApp(bridge, withRegistryOps(scope));
        expect(budget).toHaveBeenCalledWith(RuntimeConfig.textureCacheBudget);
        expect(retained).toHaveBeenCalledWith(RuntimeConfig.retainedBudget);
        for (const warn of subscribers) warn();
        expect(trim).toHaveBeenCalledTimes(1);
        app.quit({ keepRenderer: true });
        for (const warn of subscribers) warn();
        expect(trim).toHaveBeenCalledTimes(1);
    });

    it('revives a raw page by its native path and decodes its replacement after an edit', async () => {
        const { scope, createSpy } = makeTextureScope();
        const paths = new Map<string, number>();
        Object.assign(scope, {
            es_rm_registerTextureWithPath: (h: number, p: string) => paths.set(p, h),
            es_rm_acquireTextureByPath: (p: string) => paths.get(p) ?? 0,
            es_rm_invalidateTexturePath: (p: string) => paths.delete(p),
            es_rm_releaseTexture: vi.fn(), // The native budget keeps the released image warm.
        });
        const images = { 'page.png': solidImage(4, 2) };
        const app = createNativeApp(makeBridge(images), withRegistryOps(scope));
        await app.tick(0);
        const assets = app.getResource(Assets);
        const first = await assets.acquireTexture('page.png', false);
        first.release();
        const warm = await assets.acquireTexture('page.png', false);
        expect(warm.value.handle).toBe(first.value.handle);
        expect(createSpy).toHaveBeenCalledTimes(1);
        images['page.png'] = solidImage(8, 2);
        assets.invalidate('page.png');
        const fresh = await assets.acquireTexture('page.png', false);
        expect(fresh.value.handle).not.toBe(first.value.handle);
        expect([warm.value.width, fresh.value.width]).toEqual([4, 8]);
        expect(createSpy).toHaveBeenCalledTimes(2);
        warm.release(); fresh.release();
    });

    it('streams a whole-image bridge through the native pool and restores the same texture handle', async () => {
        const { scope, textures, createSpy } = makeTextureScope();
        const adopt = vi.fn((target: number, source: number) => {
            const replacement = textures.get(source);
            if (!textures.has(target) || !replacement) return false;
            textures.set(target, replacement);
            return true;
        });
        scope.es_rm_adoptTextureContent = adopt;
        const bridge = makeBridge({ 'mesh.png': solidImage(9, 5), 'sprite.png': solidImage(9, 5) });
        const app = createNativeApp(bridge, withRegistryOps(scope));
        await app.tick(0);
        const assets = app.getResource(Assets);
        assets.noteMeshSurface({ texture: 'mesh.png' });
        assets.setTextureStreamingStart(4);
        const mesh = await assets.acquireTexture('mesh.png');
        const sprite = await assets.acquireTexture('sprite.png');
        try {
            const handle = mesh.value.handle;
            expect(assets.textureResizable(handle)).toBe(true);
            expect(assets.textureFullSize(handle)).toEqual({ width: 9, height: 5 });
            expect(createSpy.mock.calls.map(([w, h, , bytes]) => [w, h, bytes])).toEqual([[4, 2, 32], [9, 5, 180]]);
            expect(await assets.resizeTexture(handle, 2)).toEqual({ width: 2, height: 1 });
            expect(await assets.resizeTexture(handle, 0)).toEqual({ width: 9, height: 5 });
            expect(textures.get(handle)).toMatchObject({ width: 9, height: 5 });
            expect(adopt.mock.calls.map(([target]) => target)).toEqual([handle, handle]);
            expect([...textures.keys()]).toEqual([handle, sprite.value.handle]);
        } finally { mesh.release(); sprite.release(); }
    });

    it('loads the full image on older hosts that cannot replace the contents of a texture handle', async () => {
        const { scope, createSpy } = makeTextureScope();
        const app = createNativeApp(makeBridge({ 'mesh.png': solidImage(2048, 5) }), withRegistryOps(scope));
        await app.tick(0);
        const assets = app.getResource(Assets);
        assets.getTextureLoader().setCompressedSource(async () => 'pending');
        assets.noteMeshSurface({ texture: 'mesh.png' });
        assets.setTextureStreamingStart(4);
        const mesh = await assets.acquireTexture('mesh.png');
        try {
            expect(createSpy.mock.calls.map(([w, h]) => [w, h])).toEqual([[2048, 5]]);
            expect(assets.textureResizable(mesh.value.handle)).toBe(false);
            expect(assets.getTextureLoader().askedSmall).toBe(1);
            expect(assets.getTextureLoader().startedSmall).toBe(0);
            expect([...assets.getTextureLoader().resizableHandles()]).toEqual([]);
            expect(await assets.resizeTexture(mesh.value.handle, 2)).toBeNull();
        } finally { mesh.release(); }
    });

    it('decodes through the bridge and uploads via the native ResourceManager', async () => {
        const { scope, createSpy, releaseSpy } = makeTextureScope();
        const bridge = makeBridge({ 'logo.png': solidImage(4, 2) });
        const app = createNativeApp(bridge, withRegistryOps(scope));
        await app.tick(0);   // finish plugin builds + install platform

        const assets = app.getResource(Assets);
        const tex = await assets.loadTexture('logo.png');

        // A real handle from the native pool, with the decoded dimensions.
        expect(tex.handle).toBe(1);
        expect(tex.width).toBe(4);
        expect(tex.height).toBe(2);

        // The bytes reached the engine entry point: 4×2 RGBA, format 1 (gamma),
        // flip=true, and — with no import settings on this texture — Linear with a
        // mip chain (code 1|2), as the WebGL upload gives an asset, and ClampToEdge.
        expect(createSpy).toHaveBeenCalledTimes(1);
        const [w, h, pixels, pixelsLen, format, flip, filter, wrap] = createSpy.mock.calls[0];
        expect([w, h, format, flip, filter, wrap]).toEqual([4, 2, 1, true, 3, 1]);
        expect((pixels as Uint8Array).length).toBe(4 * 2 * 4);
        expect(pixelsLen).toBe(4 * 2 * 4);

        // A second load hits the cache — no second upload.
        const again = await assets.loadTexture('logo.png');
        expect(again.handle).toBe(1);
        expect(createSpy).toHaveBeenCalledTimes(1);

        // Releasing both references frees the native texture (no residency budget).
        assets.releaseTexture('logo.png');
        expect(releaseSpy).not.toHaveBeenCalled();   // still one reference
        assets.releaseTexture('logo.png');
        expect(releaseSpy).toHaveBeenCalledWith(1);
    });
});

// A device's core is the host's bindings, not a wasm module. The two loaders that
// marshal bulk data took only the module, so no native package ever loaded a mesh.
describe('native Assets mesh loading', () => {
    it('marshals built-in geometry through the native core, with no wasm module', async () => {
        const { scope } = makeTextureScope();
        const heap = new Uint8Array(1 << 20);
        let brk = 16;
        const created: Array<{ channels: number; stride: number; indices: number }> = [];
        Object.assign(scope, {
            es_heap: () => heap,
            es_malloc: (n: number) => { const p = brk; brk += n + (8 - (n % 8)); return p; },
            es_free: () => {},
            es_mesh_createFromChannels: (
                _table: number, channelCount: number, stride: number,
                _verts: number, _vertBytes: number, _idx: number, indexCount: number,
            ) => {
                created.push({ channels: channelCount, stride, indices: indexCount });
                return 7;
            },
        });
        setNativeEngineApi({
            HEAPU8: heap,
            HEAPU16: new Uint16Array(heap.buffer),
            HEAPU32: new Uint32Array(heap.buffer),
            HEAPI32: new Int32Array(heap.buffer),
            HEAPF32: new Float32Array(heap.buffer),
            HEAPF64: new Float64Array(heap.buffer),
            _malloc: (n: number) => (scope.es_malloc as (n: number) => number)(n),
            _free: () => {},
            mesh_createFromChannels: scope.es_mesh_createFromChannels as never,
        });
        try {
            const app = createNativeApp(makeBridge({}), withRegistryOps(scope));
            await app.tick(0);
            const assets = app.getResource(Assets);

            const scene = {
                version: '1.0', name: 'Main',
                entities: [{
                    id: 0, name: 'Block', parent: null, children: [], visible: true,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { mesh: 'builtin:cube' } },
                    ],
                }],
            };
            const result = await assets.preloadSceneAssets(scene as never);

            expect(result.missing).toEqual([]);
            expect(created).toHaveLength(1);
            // The geometry that crossed is the cube's own, not an empty upload.
            const cube = builtinMeshTemplate('builtin:cube')!.build();
            expect(created[0]!.indices).toBe(cube.indices.length);
            expect(created[0]!.channels).toBe(cube.channels.length);
        } finally {
            setNativeEngineApi(null);
        }
    });
});

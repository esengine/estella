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
import { setNativeEngineApi } from '../src/ecs/bridge/engineApi';
import { builtinMeshTemplate } from '../src/asset/builtinMeshes';
import { createNativeResourceManager } from '../src/ecs/bridge/nativeResourceManager';
import { Assets } from '../src/asset/AssetPlugin';
import { shutdownResourceManager } from '../src/wasm/resourceManager';
import { setPlatform } from '../src/platform/base';
import type { NativeBridge } from '../src/platform/native/bridge';

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

describe('createNativeResourceManager', () => {
    it('uploads bytes through es_rm_createTextureEx and reads dims / releases', () => {
        const { scope, createSpy, releaseSpy } = makeTextureScope();
        const rm = createNativeResourceManager(scope);

        const px = new Uint8Array([1, 2, 3, 4]);
        const handle = rm.createTextureFromBytes!(1, 1, px, 1, true);
        expect(handle).toBe(1);
        // Byte count beside the buffer, and the plain path's defaults where the
        // caller gave no import settings (filter Linear, wrap ClampToEdge).
        expect(createSpy).toHaveBeenCalledWith(1, 1, px, px.length, 1, true, 1, 1);
        expect(rm.getTextureDimensions(handle)).toEqual({ width: 1, height: 1 });

        rm.releaseTexture(handle);
        expect(releaseSpy).toHaveBeenCalledWith(handle);
        expect(rm.getTextureDimensions(handle)).toBeNull();
    });

    it('fails loud on the wasm/GL-only surface (no heap or GL on native)', () => {
        const rm = createNativeResourceManager({});
        expect(() => rm.createTexture(1, 1, 0, 4, 1, true)).toThrow(/not supported/);
        expect(() => rm.registerExternalTexture(0, 1, 1)).toThrow(/not supported/);
    });
});

describe('native Assets.loadTexture', () => {
    it('decodes through the bridge and uploads via the native ResourceManager', async () => {
        const { scope, createSpy, releaseSpy } = makeTextureScope();
        const bridge = makeBridge({ 'logo.png': solidImage(4, 2) });
        const app = createNativeApp(bridge, scope);
        await app.tick(0);   // finish plugin builds + install platform

        const assets = app.getResource(Assets);
        const tex = await assets.loadTexture('logo.png');

        // A real handle from the native pool, with the decoded dimensions.
        expect(tex.handle).toBe(1);
        expect(tex.width).toBe(4);
        expect(tex.height).toBe(2);

        // The bytes reached the engine entry point: 4×2 RGBA, format 1 (gamma),
        // flip=true, and — with no import settings on this texture — the defaults
        // the plain rm_createTexture path applies (Linear filter, ClampToEdge wrap).
        expect(createSpy).toHaveBeenCalledTimes(1);
        const [w, h, pixels, pixelsLen, format, flip, filter, wrap] = createSpy.mock.calls[0];
        expect([w, h, format, flip, filter, wrap]).toEqual([4, 2, 1, true, 1, 1]);
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
            const app = createNativeApp(makeBridge({}), scope);
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

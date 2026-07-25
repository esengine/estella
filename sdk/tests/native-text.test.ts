// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    native-text.test.ts
 * @brief   A frame on the native core: the SAME camera plugin, render pipeline,
 *          glyph atlas and layout the web build runs, over a mock host scope.
 *
 * Two things a device cannot share — a glyph source (no 2D canvas) and the
 * batch submit (no wasm heap) — cross to the host; everything else is the SDK's
 * one implementation. `app.tick` therefore has to produce a whole frame here:
 * resolve the scene's camera, open the pass, collect, draw the text between
 * collect and flush, close it. That order IS the contract with the host, which
 * only presents afterwards.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeApp } from '../src/ecs/nativeRuntime';
import { shutdownResourceManager } from '../src/resourceManager';
import { setPlatform } from '../src/platform/base';
import { setRendererBackend } from '../src/renderer';
import { setNativeTextSubmit, TEXT_VERTEX_FLOATS } from '../src/ui/text/submit';
import { Camera, Canvas, Transform } from '../src/component';
import { Text, TextRenderMode } from '../src/ui/core/text';
import { PTR_ACCESSORS } from '../src/ecs/ptrAccessors.generated';
import type { PlatformGlyphRequest } from '../src/platform/types';
import type { NativeBridge } from '../src/platform/native/bridge';

/** The host's ECS half: entity allocation + per-component storage, enough for a
 *  World to spawn a Text entity (see native-world.test.ts for the full surface). */
function installMockEcs(scope: Record<string, unknown>): void {
    let nextId = 1;
    const comps = new Map<string, Map<number, ArrayBuffer>>();
    const store = (cpp: string) => {
        let m = comps.get(cpp);
        if (!m) { m = new Map(); comps.set(cpp, m); }
        return m;
    };
    scope.es_createEntity = () => nextId++;
    scope.es_destroyEntity = (e: number) => { for (const m of comps.values()) m.delete(e); };
    scope.es_hasParent = () => false;
    scope.es_setParent = () => {};
    scope.es_removeParent = () => {};
    scope.es_hasChildren = () => false;
    scope.es_getChildren = () => [];
    for (const cppName of Object.keys(PTR_ACCESSORS)) {
        scope[`es_${cppName}_buffer`] = (e: number) => {
            const m = store(cppName);
            let b = m.get(e);
            if (!b) { b = new ArrayBuffer(256); m.set(e, b); }
            return b;
        };
        scope[`es_${cppName}_has`] = (e: number) => store(cppName).has(e);
        scope[`es_${cppName}_remove`] = (e: number) => { store(cppName).delete(e); };
    }
}

/** A host scope with the full native surface: textures, the glyph rasterizer and
 *  the text submit. Every glyph is a solid 8×8 tile, which is all the atlas and
 *  the layout need to produce real geometry. */
function makeHostScope() {
    const textures = new Map<number, { width: number; height: number }>();
    const uploads: { handle: number; x: number; y: number; w: number; h: number; bytes: number }[] = [];
    // What the host was asked to do this frame, in order.
    const calls: string[] = [];
    const beginSpy = vi.fn();
    let canvasEntity = -1;
    let cameraEntities: number[] = [];
    let nextHandle = 1;
    const rasterizeSpy = vi.fn((request: PlatformGlyphRequest) => ({
        pixels: new Uint8Array(8 * 8 * 4).fill(255),
        width: 8,
        height: 8,
        advance: request.pixelSize * 0.5,
        bearingX: 0,
        bearingY: 8,
    }));
    const submitSpy = vi.fn();
    const scope: Record<string, unknown> = {
        es_createTexture: (width: number, height: number) => {
            const handle = nextHandle++;
            textures.set(handle, { width, height });
            return handle;
        },
        es_releaseTexture: (handle: number) => { textures.delete(handle); },
        es_getTextureDimensions: (handle: number) => textures.get(handle) ?? null,
        // The atlas page id: the host answers with the engine's render id for the
        // handle. A distinct number here proves the id that reaches the batch is
        // this one, not the ResourceManager handle.
        es_getTextureRenderId: (handle: number) => handle + 100,
        es_updateTextureSubregion: (handle: number, x: number, y: number, w: number, h: number, pixels: Uint8Array) => {
            uploads.push({ handle, x, y, w, h, bytes: pixels.length });
        },
        es_rasterizeGlyph: rasterizeSpy,
        es_submitTextBatch: (...args: unknown[]) => { calls.push('text'); submitSpy(...args); },
        // The frame surface: the SDK's camera plugin + pipeline drive these, and
        // the order they arrive in is what the host's frame depends on.
        es_renderer_resize: () => { calls.push('resize'); },
        es_renderer_beginFrame: () => { calls.push('beginFrame'); },
        es_renderer_updateTransforms: () => { calls.push('updateTransforms'); },
        es_renderer_begin: (...args: unknown[]) => { calls.push('begin'); beginSpy(...args); },
        es_renderer_submitAll: () => { calls.push('submitAll'); },
        es_renderer_flush: () => { calls.push('flush'); },
        es_renderer_end: () => { calls.push('end'); },
        es_renderer_setStage: () => {},
        es_renderer_setViewport: () => {},
        es_renderer_setYSortLayers: () => {},
        es_renderer_stats: () => ({ drawCalls: 1, triangles: 2, sprites: 1, text: 1, spine: 0, meshes: 0, culled: 0 }),
        es_renderer_surfaceSize: () => ({ width: 800, height: 600 }),
        es_registry_getCanvasEntity: () => canvasEntity,
        es_registry_getCameraEntities: () => cameraEntities,
    };
    installMockEcs(scope);
    return {
        scope, uploads, calls, rasterizeSpy, submitSpy, beginSpy,
        setScene: (canvas: number, cameras: number[]) => { canvasEntity = canvas; cameraEntities = cameras; },
    };
}

/** The bridge half of the same host: the glyph rasterizer reaches the SDK through
 *  the platform adapter, so it is declared here as well as on the scope. */
function makeBridge(scope: Record<string, unknown>): NativeBridge {
    return {
        readFile: async () => new ArrayBuffer(0),
        fileExists: async () => false,
        fetch: async () => ({ ok: false, status: 404 }),
        loadImagePixels: async () => { throw new Error('no images in this test'); },
        rasterizeGlyph: (request) => (scope.es_rasterizeGlyph as (r: PlatformGlyphRequest) => never)(request),
        getStorageItem: () => null,
        setStorageItem: () => {},
        removeStorageItem: () => {},
        storageKeys: () => [],
        registerInput: () => () => {},
        devicePixelRatio: () => 1,
    };
}

afterEach(() => {
    shutdownResourceManager();
    setNativeTextSubmit(null);
    setRendererBackend(null);
    setPlatform(null as never);
});

/** Author the scene the frame renders: a Canvas (clear colour), a Camera, and a
 *  Text label. Returns the label, whose glyphs the assertions follow. */
function buildScene(app: ReturnType<typeof createNativeApp>, setScene: (canvas: number, cameras: number[]) => void) {
    const world = app.world;
    const canvas = world.spawn();
    world.insert(canvas, Canvas, { backgroundColor: { r: 0.1, g: 0.2, b: 0.3, a: 1 } });
    const camera = world.spawn();
    world.insert(camera, Transform, {});
    world.insert(camera, Camera, { projectionType: 1, orthoSize: 300, isActive: true, clearFlags: 3 });
    setScene(canvas, [camera]);

    const label = world.spawn();
    world.insert(label, Transform, {});
    // Pin the SDF pipeline: Auto reads the entity's world scale, which the C++
    // TransformSystem computes on a device and this mock leaves at zero.
    world.insert(label, Text, { content: 'Hi', fontSize: 32, renderMode: TextRenderMode.Sdf });
    return label;
}

describe('a frame on the native core', () => {
    it('renders the scene through the SDK pipeline, text and all', async () => {
        const { scope, uploads, calls, rasterizeSpy, submitSpy, beginSpy, setScene } = makeHostScope();
        const app = createNativeApp(makeBridge(scope), scope);
        await app.tick(0);

        const entity = buildScene(app, setScene);
        calls.length = 0;   // watch one frame, with the scene in place
        await app.tick(1 / 60);

        // The SDK drove a whole frame: the camera's pass opened, the scene was
        // collected, the text drew before the flush, and the pass closed. The host
        // adds only the present after this.
        expect(calls.filter((c) => c === 'begin' || c === 'submitAll' || c === 'text' || c === 'flush' || c === 'end'))
            .toEqual(['begin', 'submitAll', 'text', 'flush', 'end']);

        // The pass cleared to the Canvas' background colour — the scene's, not a
        // colour the host picked.
        const [, , clearFlags, r, g, b] = beginSpy.mock.calls[beginSpy.mock.calls.length - 1];
        expect(clearFlags).toBe(3);
        expect(r).toBeCloseTo(0.1, 5);   // f32 round-trip through the component
        expect(g).toBeCloseTo(0.2, 5);
        expect(b).toBeCloseTo(0.3, 5);

        // One rasterize per distinct codepoint, asking for the SDF encoding.
        expect(rasterizeSpy).toHaveBeenCalledTimes(2);
        const request = rasterizeSpy.mock.calls[0][0];
        expect(String.fromCodePoint(request.codepoint)).toBe('H');
        expect(request.sdf).toBe(true);
        expect(request.padding).toBeGreaterThan(0);

        // Each glyph landed in the atlas page as an 8×8 RGBA sub-region upload.
        expect(uploads).toHaveLength(2);
        expect(uploads[0]).toMatchObject({ handle: 1, w: 8, h: 8, bytes: 8 * 8 * 4 });

        // One batch for the one page, bound by the host's render id (handle + 100),
        // carrying two quads: 4 vertices and 6 indices each.
        expect(submitSpy).toHaveBeenCalledTimes(1);
        const [vertices, vertexCount, indices, textureId, transform, ent, , , sdf] = submitSpy.mock.calls[0];
        expect(textureId).toBe(101);
        expect(ent).toBe(entity);
        expect(sdf).toBe(true);
        expect(vertexCount).toBe(8);
        expect((vertices as Float32Array).length).toBe(8 * TEXT_VERTEX_FLOATS);
        expect((indices as Uint16Array).length).toBe(12);
        expect((transform as Float32Array).length).toBe(16);
    });

    it('still renders the scene on a host with no font stack — just no text', async () => {
        const { scope, calls, submitSpy, setScene } = makeHostScope();
        delete scope.es_rasterizeGlyph;
        const bridge = makeBridge(scope);
        delete (bridge as { rasterizeGlyph?: unknown }).rasterizeGlyph;

        const app = createNativeApp(bridge, scope);
        await app.tick(0);
        buildScene(app, setScene);
        await app.tick(1 / 60);

        expect(calls).toContain('begin');
        expect(calls).toContain('flush');
        expect(submitSpy).not.toHaveBeenCalled();
    });

    it('leaves the frame to the host when it bound no renderer', async () => {
        const { scope, calls, setScene } = makeHostScope();
        for (const name of Object.keys(scope).filter((n) => n.startsWith('es_renderer_'))) delete scope[name];

        const app = createNativeApp(makeBridge(scope), scope);
        await app.tick(0);
        buildScene(app, setScene);
        await app.tick(1 / 60);

        // No pipeline, no camera plugin — the app still runs its gameplay stack,
        // and a host that drives its own frame keeps working.
        expect(calls).toEqual([]);
        expect(app.pipeline).toBeNull();
    });
});

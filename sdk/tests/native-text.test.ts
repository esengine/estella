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
import { CameraView, CameraViewAPI, PresentedCameraView } from '../src/camera/Camera';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeApp } from '../src/ecs/bridge/nativeRuntime';
import { shutdownResourceManager } from '../src/wasm/resourceManager';
import { setPlatform } from '../src/platform/base';
import { setRendererBackend } from '../src/render/renderer';
import { setNativeTextSubmit, TEXT_VERTEX_FLOATS } from '../src/ui/text/submit';
import { Camera, Canvas, Transform } from '../src/ecs/component';
import { SdfTextRenderer } from '../src/ui/text/text-renderer';
import { Text, TextRenderMode } from '../src/ui/core/text';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { PTR_ACCESSORS } from '../src/ecs/bridge/ptrAccessors.generated';
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
        es_rm_createTextureEx: (width: number, height: number) => {
            const handle = nextHandle++;
            textures.set(handle, { width, height });
            return handle;
        },
        es_rm_releaseTexture: (handle: number) => { textures.delete(handle); },
        es_getTextureDimensions: (handle: number) => textures.get(handle) ?? null,
        // The atlas page id: the host answers with the engine's render id for the
        // handle. A distinct number here proves the id that reaches the batch is
        // this one, not the ResourceManager handle.
        es_rm_getTextureGLId: (handle: number) => handle + 100,
        es_rm_updateTextureSubregion: (handle: number, x: number, y: number, w: number, h: number,
                                       pixels: Uint8Array, pixelsLen: number) => {
            uploads.push({ handle, x, y, w, h, bytes: pixels.length, len: pixelsLen });
        },
        es_rasterizeGlyph: rasterizeSpy,
        es_renderer_submitTextBatch: (...args: unknown[]) => { calls.push('text'); submitSpy(...args); },
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
        es_renderer_getDrawCalls: () => 1,
        es_renderer_getTriangles: () => 2,
        es_renderer_getSprites: () => 1,
        es_renderer_getText: () => 1,
        es_renderer_getMeshes: () => 0,
        es_renderer_getCulled: () => 0,
        es_renderer_surfaceSize: () => ({ width: 800, height: 600 }),
        // The UI entry points, generated on a device from the same declarations
        // embind registers; here they just record that the SDK drove them.
        es_uiLayout_update: () => { calls.push('uiLayout'); },
        es_transform_update: () => { calls.push('transformUpdate'); },
        es_uiRenderOrder_update: () => { calls.push('uiRenderOrder'); },
        es_ui_getRenderOrder: () => -1,
        es_getUINodeHiddenInTree: () => false,
        es_getUINodeComputedWidth: () => 0,
        es_getUINodeComputedHeight: () => 0,
        es_uiHitTest_update: () => {},
        es_uiHitTest_getHitEntity: () => 0xffffffff,
        es_registry_getCanvasEntity: () => canvasEntity,
        es_registry_getCameraEntities: () => cameraEntities,
    };
    installMockEcs(scope);
    return {
        scope, uploads, calls, rasterizeSpy, submitSpy, beginSpy, textures,
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
    it('publishes the camera queries the web publishes', async () => {
        const host = makeHostScope();
        const app = createNativeApp(makeBridge(host.scope), host.scope);
        await app.tick(0);
        // A game reads these the same way on both cores; null on a device was a
        // per-frame throw the editor's Play never showed.
        expect(app.getResource(CameraView)).toBeInstanceOf(CameraViewAPI);
        expect(app.getResource(PresentedCameraView)).toBeInstanceOf(CameraViewAPI);
        app.quit({ keepRenderer: true });
    });

    it('keeps bitmap geometry aligned with the native viewport after DPR changes', async () => {
        const host = makeHostScope();
        let density = 1;
        const bridge = makeBridge(host.scope);
        bridge.devicePixelRatio = () => density;
        host.scope.es_renderer_surfaceSize = () => ({ width: 800 * density, height: 600 * density });
        const app = createNativeApp(bridge, host.scope);
        await app.tick(0);
        const label = buildScene(app, host.setScene);
        app.world.insert(label, Text, { content: 'A', fontSize: 32, renderMode: TextRenderMode.Bitmap });
        for (const next of [1, 2, 3, 1]) {
            density = next;
            host.rasterizeSpy.mockClear();
            host.submitSpy.mockClear();
            await app.tick(1 / 60);
            const camera = app.getResource(UICameraInfo);
            const expected = Math.round(32 * Math.abs(camera.viewProjection[0]) * camera.vpW / 2);
            expect(expected).toBeGreaterThan(0);
            const request = host.rasterizeSpy.mock.calls.at(-1)?.[0];
            if (request) expect(request.pixelSize).toBe(expected);
            expect(host.submitSpy).toHaveBeenCalled();
            const vertices = host.submitSpy.mock.calls[0][0] as Float32Array;
            expect(Math.abs(vertices[TEXT_VERTEX_FLOATS] - vertices[0])).toBeCloseTo(8 * 32 / expected);
            expect(host.textures.size).toBeLessThanOrEqual(2);
            host.rasterizeSpy.mockClear();
            await app.tick(1 / 60);
            expect(host.rasterizeSpy).not.toHaveBeenCalled();
            expect(host.textures.size).toBe(1);
        }
        app.quit({ keepRenderer: true });
        expect(host.textures.size).toBe(0);
    });

    it('reclaims obsolete glyph pages at frame boundaries without rerasterizing live text', async () => {
        const host = makeHostScope();
        const app = createNativeApp(makeBridge(host.scope), host.scope);
        await app.tick(0);
        const renderer = new SdfTextRenderer(null, { sdf: false, pageSize: 16 });
        const matrix = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
        const parameters = { text: 'A', fontFamily: 'Arial', fontSizePx: 32, color: [1,1,1,1] as const };
        renderer.beginFrame();
        renderer.drawText(parameters, matrix, 1, 0, 0);
        renderer.beginFrame();
        renderer.drawText({ ...parameters, fontFamily: 'Other' }, matrix, 1, 0, 0);
        expect(host.textures.size).toBe(2);
        renderer.beginFrame();
        expect(host.textures.size).toBe(1);
        const requests = host.rasterizeSpy.mock.calls.length;
        renderer.drawText({ ...parameters, fontFamily: 'Other' }, matrix, 1, 0, 0);
        expect(host.rasterizeSpy).toHaveBeenCalledTimes(requests);
        renderer.beginFrame();
        expect(host.textures.size).toBe(1);
        // No label drew this frame: the following boundary reclaims its layout.
        renderer.beginFrame();
        expect(host.textures.size).toBe(0);
        renderer.drawText(parameters, matrix, 1, 0, 0);
        expect(host.textures.size).toBe(1);
        renderer.dispose(); app.quit({keepRenderer:true});
    });

    it.each([true, false])('culls long cached glyphs and restores the complete layout (sdf=%s)', async sdf => {
        const host = makeHostScope();
        const app = createNativeApp(makeBridge(host.scope), host.scope);
        await app.tick(0);
        const renderer = new SdfTextRenderer(null, { sdf });
        const parameters = { text: 'A'.repeat(65535) + 'Z', fontFamily: 'Arial', fontSizePx: 32, color: [1, 1, 1, 1] as const };
        const matrix = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
        const projection = matrix.slice(); projection[0] = 1 / 32; projection[5] = 1 / 64;
        renderer.drawText(parameters, matrix, 1, 0, 0, 0, projection);
        expect(host.submitSpy).toHaveBeenCalledOnce();
        expect(host.submitSpy.mock.calls[0][1]).toBeLessThanOrEqual(20);
        const rasterizations = host.rasterizeSpy.mock.calls.length;
        host.submitSpy.mockClear(); matrix[12] = 1e7;
        renderer.drawText(parameters, matrix, 1, 0, 0, 0, projection);
        expect(host.submitSpy).not.toHaveBeenCalled();
        matrix[12] = -65535 * 16;
        renderer.drawText({ ...parameters, opacity: 0.25 }, matrix, 1, 0, 0, 0, projection);
        expect(host.submitSpy).toHaveBeenCalledOnce();
        const tail = host.submitSpy.mock.calls[0];
        expect(tail[1]).toBeLessThanOrEqual(20);
        const vertices = tail[0] as Float32Array, indices = tail[2] as Uint16Array;
        expect(vertices[vertices.length - 4 * TEXT_VERTEX_FLOATS]).toBe(65535 * 16);
        expect(vertices[7]).toBe(0.25);
        expect(Math.max(...indices)).toBeLessThan(tail[1] as number);
        host.submitSpy.mockClear(); matrix[12] = 0; projection[0] = 1 / (65536 * 16);
        renderer.drawText(parameters, matrix, 1, 0, 0, 0, projection);
        expect(host.submitSpy.mock.calls.reduce((sum, args) => sum + (args[1] as number), 0)).toBe(65536 * 4);
        expect(host.submitSpy.mock.calls.reduce((sum, args) => sum + (args[2] as Uint16Array).length, 0)).toBe(65536 * 6);
        expect((host.submitSpy.mock.calls[0][0] as Float32Array)[7]).toBe(1);
        expect(host.rasterizeSpy).toHaveBeenCalledTimes(rasterizations);
        renderer.dispose(); app.quit({ keepRenderer: true });
    });

    it('measures native glyphs without allocating or uploading texture pages', async () => {
        const host = makeHostScope();
        const app = createNativeApp(makeBridge(host.scope), host.scope);
        await app.tick(0);
        const renderer = new SdfTextRenderer(null, { metricsOnly: true });
        const glyph = renderer.atlas.getGlyph('Ω'.codePointAt(0)!, 'Arial');
        expect(glyph).not.toBeNull();
        expect(host.rasterizeSpy).toHaveBeenCalled();
        expect(host.textures.size).toBe(0);
        expect(host.uploads).toEqual([]);
        expect(renderer.atlas.pageCount).toBe(0);
        expect(() => renderer.drawText({
            text: 'Ω', fontFamily: 'Arial', fontSizePx: 32, color: [1, 1, 1, 1],
        }, new Float32Array(16), 1, 0, 0)).toThrow('Measurement atlases cannot submit text');
        renderer.dispose();
        app.quit({ keepRenderer: true });
    });

    it('isolates glyph pages between apps and releases only the quitting owner', async () => {
        const first = makeHostScope();
        const appA = createNativeApp(makeBridge(first.scope), first.scope);
        await appA.tick(0);
        const labelA = buildScene(appA, first.setScene);
        appA.world.insert(labelA, Text, { content: 'Ω', fontSize: 32, renderMode: TextRenderMode.Sdf });
        await appA.tick(1 / 60);
        expect(first.rasterizeSpy).toHaveBeenCalled();
        expect(first.textures.size).toBe(1);
        const second = makeHostScope();
        const appB = createNativeApp(makeBridge(second.scope), second.scope);
        await appB.tick(0);
        const labelB = buildScene(appB, second.setScene);
        appB.world.insert(labelB, Text, { content: 'Ω', fontSize: 32, renderMode: TextRenderMode.Sdf });
        await appB.tick(1 / 60);
        expect(second.rasterizeSpy).toHaveBeenCalled();
        expect(second.textures.size).toBe(1);
        appA.quit({ keepRenderer: true });
        expect(first.textures.size).toBe(0);
        expect(second.textures.size).toBe(1);
        appB.quit({ keepRenderer: true });
        expect(second.textures.size).toBe(0);
    });

    it('copies the full text basis and skips collapsed labels before rasterization', async () => {
        const { scope, submitSpy, rasterizeSpy, setScene } = makeHostScope();
        const heap = new ArrayBuffer(65536), frees = vi.fn();
        let cursor = 64, drawable = false;
        const matrix = [2, 1, 0, 0, 3, 4, 0, 0, 0, 0, 1, 0, 13, 17, 0, 1];
        scope.es_heap = () => heap;
        scope.es_malloc = (bytes: number) => { const offset = cursor; cursor += Math.ceil(bytes / 8) * 8; return offset; };
        scope.es_free = frees;
        scope.es_transform_copyFlatRenderMatrix = (_entity: number, pointer: number) => {
            if (!drawable) return false;
            new Float32Array(heap, pointer, 16).set(matrix);
            return true;
        };
        const app = createNativeApp(makeBridge(scope), scope);
        await app.tick(0);
        const label = buildScene(app, setScene);
        app.world.insert(label, Text, { content: 'Z', fontSize: 32, renderMode: TextRenderMode.Sdf });
        await app.tick(1 / 60);
        expect(rasterizeSpy).not.toHaveBeenCalled();
        expect(submitSpy).not.toHaveBeenCalled();
        expect(frees).toHaveBeenCalled();
        drawable = true;
        await app.tick(1 / 60);
        expect(submitSpy).toHaveBeenCalled();
        expect(Array.from(submitSpy.mock.calls[0][5] as Float32Array)).toEqual(matrix);
        rasterizeSpy.mockClear(); submitSpy.mockClear();
        drawable = false;
        await app.tick(1 / 60);
        expect(rasterizeSpy).not.toHaveBeenCalled();
        expect(submitSpy).not.toHaveBeenCalled();
    });

    it('fades text fill, shadow and outline together and skips transparent subtrees', async () => {
        const { scope, submitSpy, setScene } = makeHostScope();
        let alpha = 0.5;
        scope.es_getUINodeAlphaInTree = () => alpha;
        const app = createNativeApp(makeBridge(scope), scope);
        await app.tick(0);
        const label = buildScene(app, setScene);
        app.world.insert(label, Text, {
            content: 'Fade', fontSize: 32, renderMode: TextRenderMode.Sdf,
            color: { r: 1, g: 1, b: 1, a: 0.8 },
            shadowOffsetX: 1, shadowColor: { r: 0, g: 0, b: 0, a: 0.6 },
            strokeWidth: 1, strokeColor: { r: 0, g: 0, b: 0, a: 0.4 },
        });
        await app.tick(1 / 60);
        expect(submitSpy).toHaveBeenCalledTimes(3);
        // Shadow and outline fade with the fill's own alpha (0.8) as well as the subtree's (0.5).
        expect((submitSpy.mock.calls[0][0] as Float32Array)[7]).toBeCloseTo(0.24);
        expect((submitSpy.mock.calls[1][0] as Float32Array)[7]).toBeCloseTo(0.16);
        expect((submitSpy.mock.calls[2][0] as Float32Array)[7]).toBeCloseTo(0.4);
        alpha = 0;
        submitSpy.mockClear();
        await app.tick(1 / 60);
        expect(submitSpy).not.toHaveBeenCalled();
        alpha = 1;
        await app.tick(1 / 60);
        expect(submitSpy).toHaveBeenCalledTimes(3);
        expect((submitSpy.mock.calls[2][0] as Float32Array)[7]).toBeCloseTo(0.8);
    });

    it('renders the scene through the SDK pipeline, text and all', async () => {
        const { scope, uploads, calls, rasterizeSpy, submitSpy, beginSpy, setScene } = makeHostScope();
        const app = createNativeApp(makeBridge(scope), scope);
        await app.tick(0);

        const entity = buildScene(app, setScene);
        calls.length = 0;   // watch one frame, with the scene in place
        await app.tick(1 / 60);

        // The UI ran: the same layout and render-order passes the web build makes,
        // reaching the native core through the generated engine API.
        expect(calls).toContain('uiLayout');
        expect(calls).toContain('uiRenderOrder');

        // The host is told to stop drawing its own fallback frame — both would mean
        // its pass clearing over this one.
        expect(scope.es_jsOwnsFrame).toBe(true);

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
        expect(uploads[0]).toMatchObject({ handle: 1, w: 8, h: 8, bytes: 8 * 8 * 4, len: 8 * 8 * 4 });

        // One batch for the one page, bound by the host's render id (handle + 100),
        // carrying two quads: 4 vertices and 6 indices each.
        expect(submitSpy).toHaveBeenCalledTimes(1);
        // The argument list is the engine entry point's, not a host-shaped one:
        // renderer_submitTextBatch(vertices, vertexCount, indices, indexCount,
        // textureId, transform, entity, layer, depth, sdf).
        const [vertices, vertexCount, indices, indexCount, textureId, transform, ent, , , sdf] =
            submitSpy.mock.calls[0];
        expect(textureId).toBe(101);
        expect(ent).toBe(entity);
        expect(sdf).toBe(1);
        expect(vertexCount).toBe(8);
        expect((vertices as Float32Array).length).toBe(8 * TEXT_VERTEX_FLOATS);
        expect((indices as Uint16Array).length).toBe(12);
        expect(indexCount).toBe(12);
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

        // No pipeline, no camera plugin — nothing opens or closes a pass, so a host
        // that drives its own frame keeps working (it is never told otherwise). The
        // UI passes still run: they belong to the simulation, not to the frame.
        expect(calls.filter((c) => ['begin', 'submitAll', 'flush', 'end', 'text'].includes(c))).toEqual([]);
        expect(app.pipeline).toBeNull();
        expect(scope.es_jsOwnsFrame).toBeUndefined();
    });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A texture whose content is a live canvas, over a fake WebGL2 context:
 *        the conventions it shares with a file texture (orientation, color
 *        space) and the ones it deliberately does not (no mipmaps, clamped),
 *        plus the property the whole thing exists for — the handle survives
 *        every re-take, because a component is holding it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';
import { setLinearColorSpace } from '../src/ecs/env';
import { createCanvasTexture } from '../src/asset/canvasTexture';
import type { ESEngineModule } from '../src/wasm';
import type { App } from '../src/app/app';

const SRGB8_ALPHA8 = 0x8c43;
const RGBA = 0x1908;
const UNPACK_FLIP_Y_WEBGL = 0x9240;
const CLAMP_TO_EDGE = 0x812f;
const TEXTURE_MIN_FILTER = 0x2801;
const LINEAR = 0x2601;
const LINEAR_MIPMAP_LINEAR = 0x2703;

function makeGl() {
    return {
        TEXTURE_2D: 0x0de1, RGBA, UNSIGNED_BYTE: 0x1401, SRGB8_ALPHA8,
        NEAREST: 0x2600, LINEAR, LINEAR_MIPMAP_LINEAR, NEAREST_MIPMAP_NEAREST: 0x2700,
        CLAMP_TO_EDGE, MIRRORED_REPEAT: 0x8370, REPEAT: 0x2901,
        TEXTURE_MIN_FILTER, TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
        UNPACK_FLIP_Y_WEBGL, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
        // isWebGL2's duck test.
        texStorage2D: vi.fn(),
        createTexture: vi.fn(() => ({}) as WebGLTexture),
        deleteTexture: vi.fn(),
        bindTexture: vi.fn(),
        texImage2D: vi.fn(),
        texParameteri: vi.fn(),
        pixelStorei: vi.fn(),
        generateMipmap: vi.fn(),
    };
}

/** An App whose module's GL registry hands out ids, with `gl` as the live
 *  context — the App is what a caller has, so it is what this takes. */
function makeApp(gl: ReturnType<typeof makeGl>): App {
    const module = {
        GL: {
            currentContext: { GLctx: gl },
            contexts: [],
            getNewId: vi.fn(() => 7),
            textures: {} as Record<number, WebGLTexture>,
        },
    } as unknown as ESEngineModule;
    return { wasmModule: module } as unknown as App;
}

/** A stand-in for the shared canvas: something with a size that can change. */
function makeSource(width: number, height: number) {
    return { width, height, getContext: () => ({}) } as never;
}

let registerExternalTexture: ReturnType<typeof vi.fn>;
beforeEach(() => {
    registerExternalTexture = vi.fn(() => 42);
    initResourceManager({ registerExternalTexture } as never);
});
afterEach(() => {
    shutdownResourceManager();
    setLinearColorSpace(false);
});

describe('createCanvasTexture', () => {
    it('takes the source once and registers it as an engine texture', () => {
        const gl = makeGl();
        const tex = createCanvasTexture(makeApp(gl), makeSource(256, 128))!;
        expect(tex.handle).toBe(42);
        expect(tex.width).toBe(256);
        expect(tex.height).toBe(128);
        expect(gl.texImage2D).toHaveBeenCalledTimes(1);
        expect(registerExternalTexture).toHaveBeenCalledWith(7, 256, 128);
    });

    it('keeps the handle across a re-take — a component is holding it', () => {
        const gl = makeGl();
        const tex = createCanvasTexture(makeApp(gl), makeSource(64, 64))!;
        const before = tex.handle;
        tex.update();
        tex.update();
        expect(tex.handle).toBe(before);
        expect(gl.texImage2D).toHaveBeenCalledTimes(3);   // create + two updates
        expect(registerExternalTexture).toHaveBeenCalledTimes(1);
    });

    it('follows the source when it is resized', () => {
        const gl = makeGl();
        const source = makeSource(64, 64) as { width: number; height: number };
        const tex = createCanvasTexture(makeApp(gl), source as never)!;
        source.width = 320;
        source.height = 200;
        tex.update();
        expect(tex.width).toBe(320);
        expect(tex.height).toBe(200);
    });

    it('uploads in the engine\'s orientation, un-premultiplied, and leaves the flag off', () => {
        const gl = makeGl();
        createCanvasTexture(makeApp(gl), makeSource(8, 8));
        const flips = gl.pixelStorei.mock.calls.filter((c) => c[0] === UNPACK_FLIP_Y_WEBGL);
        // Set for the upload, then restored — every other uploader shares this
        // context and none of them asks for a flip they did not set.
        expect(flips.map((c) => c[1])).toEqual([1, 0]);
    });

    it('is sRGB-encoded in the linear pipeline and plain RGBA in gamma', () => {
        const gamma = makeGl();
        createCanvasTexture(makeApp(gamma), makeSource(8, 8));
        expect(gamma.texImage2D.mock.calls[0][2]).toBe(RGBA);

        setLinearColorSpace(true);
        const linear = makeGl();
        createCanvasTexture(makeApp(linear), makeSource(8, 8));
        expect(linear.texImage2D.mock.calls[0][2]).toBe(SRGB8_ALPHA8);
    });

    it('has no mipmaps and does not tile — a chain per frame is waste, and nothing tiles a panel', () => {
        const gl = makeGl();
        createCanvasTexture(makeApp(gl), makeSource(8, 8));
        expect(gl.generateMipmap).not.toHaveBeenCalled();
        const minFilter = gl.texParameteri.mock.calls.find((c) => c[1] === TEXTURE_MIN_FILTER);
        expect(minFilter?.[2]).toBe(LINEAR);
        expect(minFilter?.[2]).not.toBe(LINEAR_MIPMAP_LINEAR);
        const wraps = gl.texParameteri.mock.calls.filter((c) => c[2] === CLAMP_TO_EDGE);
        expect(wraps).toHaveLength(2);
    });

    it('sets sampler state once, not on every re-take', () => {
        const gl = makeGl();
        const tex = createCanvasTexture(makeApp(gl), makeSource(8, 8))!;
        const afterCreate = gl.texParameteri.mock.calls.length;
        tex.update();
        expect(gl.texParameteri.mock.calls.length).toBe(afterCreate);
    });

    it('answers null where there is no WebGL2 to upload through', () => {
        expect(createCanvasTexture(null, makeSource(8, 8))).toBeNull();
        expect(createCanvasTexture(undefined, makeSource(8, 8))).toBeNull();
    });

    it('releases the GL texture on destroy, and a re-take afterwards is a no-op', () => {
        const gl = makeGl();
        const app = makeApp(gl);
        const tex = createCanvasTexture(app, makeSource(8, 8))!;
        tex.destroy();
        expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
        const gpu = app.wasmModule!.GL as unknown as { textures: Record<number, unknown> };
        expect(gpu.textures[7]).toBeUndefined();
        const uploads = gl.texImage2D.mock.calls.length;
        tex.update();
        tex.destroy();
        expect(gl.texImage2D.mock.calls.length).toBe(uploads);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    });
});

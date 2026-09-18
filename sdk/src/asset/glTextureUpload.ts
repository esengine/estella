// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    glTextureUpload.ts
 * @brief   The bridge between a JS image source and the device's texture: the
 *          engine's upload conventions (orientation, color-space encoding,
 *          sampler state), and the only place a GL texture is created here and
 *          handed to the device.
 *
 * Extracted for the same reason {@link ./glTexParams} was — a second uploader
 * arrived (the open data context's shared canvas, re-uploaded every frame it is
 * on screen) and these three conventions are exactly the ones that go wrong
 * silently when they are written twice. A texture uploaded with the wrong
 * `UNPACK_FLIP_Y_WEBGL` is upside down; with the wrong internal format it is
 * subtly washed out in linear mode; with the wrong wrap it bleeds at the edge.
 * None of the three throws.
 *
 * Everything here acts on the CURRENTLY BOUND `TEXTURE_2D`, which is what lets
 * one function serve both a first upload and a re-upload into a live texture.
 */
import { linearColorSpace } from '../ecs/env';
import { glWrapMode, type TextureWrap } from './glTexParams';
import type { PlatformCanvas, PlatformImage } from '../platform/types';
import { requireResourceManager } from '../wasm/resourceManager';
import type { ESEngineModule, TextureContent } from '../wasm';

/** Anything WebGL will take directly as texture content. */
export type GlImageSource = PlatformImage | PlatformCanvas | ImageBitmap;

/** How a source should be sampled once it is on the GPU. */
export interface TextureSampling {
    readonly filter?: 'linear' | 'nearest';
    readonly wrap?: TextureWrap;
    readonly mipmaps?: boolean;
}

/**
 * Upload `source` into the bound texture.
 *
 * `flip` is for element and pixel sources only: an `ImageBitmap` bakes its
 * orientation at decode (Chromium/ANGLE ignore the pixel-store flag for
 * bitmaps), so its caller passes false — see `TextureLoader.createTextureFromImage`.
 *
 * `srgb` is the AUTHORED flag — whether the source stores sRGB-encoded color
 * (default) or authored-linear data such as a normal map. Whether that becomes
 * an sRGB internal format is this function's decision, not the caller's, so the
 * linear-pipeline rule lives in one place.
 */
export function uploadBoundTextureImage(
    gl: WebGL2RenderingContext,
    source: GlImageSource,
    flip: boolean,
    srgb?: boolean,
): void {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip ? 1 : 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    // Linear pipeline: color textures store sRGB-encoded — the sampler
    // linearizes in hardware. Data textures (normal maps) opt out.
    const internalFormat = linearColorSpace() && (srgb ?? true) ? gl.SRGB8_ALPHA8 : gl.RGBA;
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    // Left where every other upload expects it, not where this one wanted it.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
}

/**
 * Give the bound texture its sampler state, generating mipmaps when it is to
 * have them — one call, because "has mipmaps" and "uses a mipmap min-filter"
 * are the same decision and a texture that disagrees with itself samples black.
 */
export function applyBoundTextureSampling(gl: WebGL2RenderingContext, sampling?: TextureSampling): void {
    const filter = sampling?.filter ?? 'linear';
    const useMipmaps = sampling?.mipmaps ?? true;
    const glMinFilter = filter === 'nearest'
        ? (useMipmaps ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST)
        : (useMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glMinFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === 'nearest' ? gl.NEAREST : gl.LINEAR);
    const glWrap = glWrapMode(gl, sampling?.wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, glWrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, glWrap);
    if (useMipmaps) gl.generateMipmap(gl.TEXTURE_2D);
}

// =============================================================================
// The device's texture
// =============================================================================

function isWebGL2(ctx: unknown): ctx is WebGL2RenderingContext {
    return !!ctx && typeof (ctx as WebGL2RenderingContext).texStorage2D === 'function';
}

/**
 * The engine's WebGL2 context, looked up through emscripten's GL bookkeeping.
 * Duck-typed on `texStorage2D`: WeChat MiniGames have no `WebGL2RenderingContext`
 * global, where an `instanceof` check THREW and read as "no context", refusing
 * every KTX2 texture. Falls back to any registered context when none is current.
 */
export function findWebGL2Context(glObj: ESEngineModule['GL'] | undefined): WebGL2RenderingContext | null {
    try {
        const current = glObj?.currentContext?.GLctx;
        if (isWebGL2(current)) return current;
        for (const rec of glObj?.contexts ?? []) {
            if (rec && isWebGL2(rec.GLctx)) return rec.GLctx;
        }
    } catch {
        // fall through — treated as "no WebGL2 context"
    }
    return null;
}

/** What a texture handed to the device is, beyond its pixels. */
export interface HandOverDesc {
    width: number;
    height: number;
    /** Who refills it after a device loss (see {@link TextureContent}). */
    content: TextureContent;
    /** On-GPU bytes for the residency budget, when they are not width*height*4. */
    gpuBytes?: number;
}

/**
 * Create a GL texture, let `write` fill the bound texture, and hand it to the
 * device; returns the engine handle. The device owns it from here — it deletes the
 * object with the handle and builds a replacement after a loss, so nothing outside
 * this file may keep the WebGLTexture.
 */
export function handOverNewTexture(
    module: ESEngineModule,
    gl: WebGL2RenderingContext,
    write: (gl: WebGL2RenderingContext) => void,
    desc: HandOverDesc,
): number {
    const texture = gl.createTexture();
    if (!texture) throw new Error('the GL context gave no texture (is it lost?)');
    try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        write(gl);
    } catch (err) {
        gl.deleteTexture(texture);
        throw err;
    }
    const glObj = module.GL;
    const id = glObj.getNewId(glObj.textures);
    glObj.textures[id] = texture;
    const rm = requireResourceManager();
    return desc.gpuBytes !== undefined && rm.registerExternalTextureSized
        ? rm.registerExternalTextureSized(id, desc.width, desc.height, desc.gpuBytes, desc.content)
        : rm.registerExternalTexture(id, desc.width, desc.height, desc.content);
}

/**
 * Write into the texture the device has behind `handle` RIGHT NOW.
 *
 * After a device loss that is a different native object, so a caller that kept
 * its own would be uploading into a dead one — which is exactly how a video came
 * back blank. False when there is no context or the handle has no texture yet.
 */
export function writeDeviceTexture(
    module: ESEngineModule | null | undefined,
    handle: number,
    write: (gl: WebGL2RenderingContext) => void,
): boolean {
    const gl = findWebGL2Context(module?.GL);
    if (!gl || !module || !handle) return false;
    // The backend's own name, asked for at every write: the id a handle resolves
    // to is a different object after every device loss.
    const id = requireResourceManager().getTextureNativeId?.(handle) ?? 0;
    const texture = id ? module.GL.textures[id] : null;
    if (!texture) return false;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    write(gl);
    return true;
}

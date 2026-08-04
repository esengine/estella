// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    glTextureUpload.ts
 * @brief   The one place an image-like source becomes GL texture content in the
 *          engine's conventions: vertical orientation, color-space encoding and
 *          sampler state.
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

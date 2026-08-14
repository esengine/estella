// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    canvasTexture.ts
 * @brief   A texture whose content is a live canvas, re-uploaded on demand.
 *
 * Every other texture in the engine is uploaded once from a file. This one is
 * drawn by something else while the game runs — today the open data context's
 * shared canvas, which is a second JS runtime the main domain cannot read any
 * other way — so its content has to be re-taken, and the handle it is behind
 * must not change when it is (a component holding the handle keeps holding it).
 *
 * It rides the same seam a file texture does: a JS-created GL texture handed to
 * the ResourceManager with {@link registerExternalTexture}, and the SAME upload
 * conventions (orientation, color space, sampling) as `TextureLoader` — see
 * {@link ./glTextureUpload}. What differs is only what a moving image needs:
 * no mipmaps (a chain regenerated every frame is pure waste), clamped wrap
 * (nothing tiles a leaderboard), and `update()`.
 */
import { requireResourceManager } from '../wasm/resourceManager';
import type { App } from '../app/app';
import { findWebGL2Context } from './loaders/TextureLoader';
import { uploadBoundTextureImage, applyBoundTextureSampling, type GlImageSource } from './glTextureUpload';

/** A texture backed by a canvas someone else draws on. */
export interface CanvasTexture {
    /** The engine texture handle — stable across every {@link update}. */
    readonly handle: number;
    /** Size of the last upload. Follows the source when it is resized. */
    readonly width: number;
    readonly height: number;
    /** Re-take the source's current content. Cheap to call, not free: one
     *  `texImage2D` of the whole surface. Callers gate on visibility. */
    update(): void;
    /** Release the GL texture. The handle is dead afterwards. */
    destroy(): void;
}

/**
 * Wrap `source` in an engine texture and take its content once.
 *
 * Null where there is no WebGL2 context to upload through (the native backend,
 * a host still booting) — an answer, not a failure. Takes the App because the
 * module behind it is engine-internal, and a service that samples someone
 * else's canvas has an App and should need nothing more.
 */
export function createCanvasTexture(
    app: App | null | undefined,
    source: GlImageSource,
): CanvasTexture | null {
    const module = app?.wasmModule;
    const gl = findWebGL2Context(module?.GL);
    if (!gl || !module) return null;

    const texture = gl.createTexture();
    if (!texture) return null;

    // A canvas is an element source, so orientation is the pixel-store flag's
    // to apply — the same `flip` a raw <img> upload takes, and for the same
    // reason: the engine's texture space is bottom-up and the source is not.
    const take = (): { width: number; height: number } => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        uploadBoundTextureImage(gl, source, true);
        return { width: source.width, height: source.height };
    };

    let size: { width: number; height: number };
    try {
        size = take();
        applyBoundTextureSampling(gl, { filter: 'linear', wrap: 'clamp', mipmaps: false });
    } catch (err) {
        gl.deleteTexture(texture);
        throw err;
    }

    const glObj = module.GL;
    const glTextureId = glObj.getNewId(glObj.textures);
    glObj.textures[glTextureId] = texture;
    const rm = requireResourceManager();
    const handle = rm.registerExternalTexture(glTextureId, size.width, size.height);

    let alive = true;
    return {
        handle,
        get width() { return size.width; },
        get height() { return size.height; },
        update() {
            if (!alive) return;
            size = take();
        },
        destroy() {
            if (!alive) return;
            alive = false;
            gl.deleteTexture(texture);
            delete glObj.textures[glTextureId];
        },
    };
}

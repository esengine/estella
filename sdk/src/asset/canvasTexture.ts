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
 * It rides the same seam a file texture does: the upload bridge hands a GL
 * texture to the device and every take writes into whatever texture the device
 * holds, with the SAME conventions (orientation, color space, sampling) as
 * `TextureLoader` — see {@link ./glTextureUpload}. What differs is only what a
 * moving image needs:
 * no mipmaps (a chain regenerated every frame is pure waste), clamped wrap
 * (nothing tiles a leaderboard), and `update()`.
 */
import { TextureContent } from '../wasm';
import {
    provideTextureContent, requireResourceManager, withdrawTextureContent,
} from '../wasm/resourceManager';
import type { App } from '../app/app';
import {
    uploadBoundTextureImage, applyBoundTextureSampling, findWebGL2Context, handOverNewTexture,
    writeDeviceTexture, type GlImageSource,
} from './glTextureUpload';

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
    /** End it: the device frees the texture and the handle is dead afterwards. */
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

    let size = { width: source.width, height: source.height };
    // A canvas is an element source, so orientation is the pixel-store flag's
    // to apply — the same `flip` a raw <img> upload takes, and for the same
    // reason: the engine's texture space is bottom-up and the source is not.
    const take = (ctx: WebGL2RenderingContext): void => {
        uploadBoundTextureImage(ctx, source, true);
        size = { width: source.width, height: source.height };
    };

    const handle = handOverNewTexture(module, gl, (ctx) => {
        take(ctx);
        applyBoundTextureSampling(ctx, { filter: 'linear', wrap: 'clamp', mipmaps: false });
    }, { width: size.width, height: size.height, content: TextureContent.Canvas });

    // After a device loss the canvas itself is untouched, so the content comes
    // back by taking it again — into whatever texture the device rebuilt.
    provideTextureContent(handle, () => {
        if (!writeDeviceTexture(module, handle, take)) return false;
        requireResourceManager().restoreTextureContent?.(handle);
        return true;
    });

    let alive = true;
    return {
        handle,
        get width() { return size.width; },
        get height() { return size.height; },
        update() {
            if (!alive) return;
            writeDeviceTexture(module, handle, take);
        },
        destroy() {
            if (!alive) return;
            alive = false;
            withdrawTextureContent(handle);
            requireResourceManager().releaseTexture(handle);
        },
    };
}

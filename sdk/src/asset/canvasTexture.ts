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
import { TextureContent, type ESEngineModule } from '../wasm';
import { withMalloc } from '../wasm/wasmScratch';
import { samplesAsSrgb } from '../ecs/env';
import {
    provideTextureContent, requireResourceManager, withdrawTextureContent,
} from '../wasm/resourceManager';
import type { App } from '../app/app';
import {
    uploadBoundTextureImage, applyBoundTextureSampling, findWebGL2Context, handOverNewTexture,
    writeDeviceTexture, readBitmapTexels, type GlImageSource,
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
    if (!module || (!gl && !module.renderThread_enabled?.())) return null;
    let size = { width: source.width, height: source.height };
    const take = (ctx: WebGL2RenderingContext): void => {
        uploadBoundTextureImage(ctx, source, true);
        size = { width: source.width, height: source.height };
    };
    const handle = gl ? handOverNewTexture(module, gl, (ctx) => {
        take(ctx);
        applyBoundTextureSampling(ctx, { filter: 'linear', wrap: 'clamp', mipmaps: false });
    }, { width: size.width, height: size.height, content: TextureContent.Canvas })
        : uploadCanvasBytes(module, source, 0, true);
    if (!handle) return null;
    const update = (restore: boolean): boolean => {
        if (gl) return writeDeviceTexture(module, handle, take);
        if (!uploadCanvasBytes(module, source, handle, restore || size.width !== source.width || size.height !== source.height)) return false;
        size = { width: source.width, height: source.height };
        return true;
    };

    // After a device loss the canvas itself is untouched, so the content comes
    // back by taking it again — into whatever texture the device rebuilt.
    provideTextureContent(handle, () => {
        if (!update(true)) return false;
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
            update(false);
        },
        destroy() {
            if (!alive) return;
            alive = false;
            withdrawTextureContent(handle);
            requireResourceManager().releaseTexture(handle);
        },
    };
}

// The source is a page object. Copy texels across the wasm boundary and keep
// the worker-owned texture handle stable through resize and device recovery.
function uploadCanvasBytes(module: ESEngineModule, source: GlImageSource, handle: number, replace: boolean): number {
    const { width, height } = source;
    if (!width || !height) return 0;
    const pixels = readBitmapTexels(source, width, height, true);
    if (!pixels) return 0;
    const rm = requireResourceManager();
    return withMalloc(module, pixels.length, ptr => {
        module.HEAPU8.set(pixels, ptr);
        if (!replace) {
            rm.updateTextureSubregion(handle, 0, 0, width, height, ptr, pixels.length);
            return handle;
        }
        const fresh = rm.createTextureEx(width, height, ptr, pixels.length, samplesAsSrgb() ? 2 : 1,
            false, 1, 1, TextureContent.Canvas);
        if (!handle || !fresh) return fresh;
        const moved = rm.adoptTextureContent?.(handle, fresh);
        rm.releaseTexture(fresh);
        return moved ? handle : 0;
    });
}

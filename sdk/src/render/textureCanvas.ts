// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  textureCanvas.ts
 * @brief A blank texture you paste other textures into at pixel positions — compose a picture at run time, then show it on a Sprite.
 */
import { Draw } from './draw';
import { BlendMode } from './blend';
import { Renderer, onDeviceRestored } from './renderer';
import { RenderTexture, type RenderTextureHandle } from './renderTexture';
import { getResourceManager, getTextureDimensions } from '../wasm/resourceManager';
import { log } from '../util/logger';

/** Options of {@link TextureCanvas.create}. @experimental */
export interface TextureCanvasOptions {
    /** Sampling filter when the canvas is shown. Default `'linear'`; `'nearest'` for pixel art. */
    filter?: 'nearest' | 'linear';
}

/** A canvas you can paste textures into. @experimental */
export interface TextureCanvasHandle {
    /** Resource-table handle of the canvas — what `Sprite.texture` takes. Show it with no `flipY`. */
    readonly texture: number;
    readonly width: number;
    readonly height: number;
    /**
     * Pastes `source` (a texture handle) with its top-left corner at (`x`, `y`), counted in pixels from the
     * canvas's top-left. It is drawn at its own size unless `width` and `height` are given. Pictures blend over
     * what is already there, in the order they are pasted.
     */
    draw(source: number, x: number, y: number, width?: number, height?: number): void;
    /** Back to transparent, forgetting everything pasted. */
    clear(): void;
    /** Frees the canvas. The pasted textures are not touched. */
    release(): void;
}

interface Paste {
    source: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Column-major orthographic projection with pixel units, origin at the bottom-left. */
function pixelProjection(width: number, height: number): Float32Array {
    const m = new Float32Array(16);
    m[0] = 2 / width;
    m[5] = 2 / height;
    m[10] = -1;
    m[12] = -1;
    m[13] = -1;
    m[15] = 1;
    return m;
}

export const TextureCanvas = {
    /**
     * A transparent canvas `width` × `height` pixels. Call it, and `draw`, from a `Schedule.Update` system, not a
     * draw callback: each paste is a pass of its own. Null while the renderer is not up yet. Keep the pasted
     * textures alive: a device loss pastes them again.
     * @experimental
     */
    create(width: number, height: number, options: TextureCanvasOptions = {}): TextureCanvasHandle | null {
        if (!(width > 0) || !(height > 0)) throw new Error(`a canvas needs a size, got ${width}×${height}`);
        const rt: RenderTextureHandle = RenderTexture.create({ width, height, depth: false, filter: options.filter ?? 'linear' });
        if (rt.texture === 0) {
            RenderTexture.release(rt);
            return null;
        }

        const pastes: Paste[] = [];
        const projection = pixelProjection(width, height);

        const paint = (draws: (rm: ReturnType<typeof getResourceManager>) => void): void => {
            RenderTexture.begin(rt, projection);
            Draw.begin(projection);
            Renderer.setViewport(0, 0, width, height);
            draws(getResourceManager());
            Draw.end();
            RenderTexture.end();
            RenderTexture.contentDrawn(rt);
        };
        const blank = (): void => {
            Draw.setBlendMode(BlendMode.None);
            Draw.rect({ x: width / 2, y: height / 2 }, { x: width, y: height }, { r: 1, g: 1, b: 1, a: 0 });
        };
        // Pixels count from the top of the canvas, the projection from its bottom; the device id is asked afresh
        // each time because a device loss renumbers it.
        const paste = (rm: ReturnType<typeof getResourceManager>, p: Paste): void => {
            const deviceId = rm?.getTextureGLId(p.source) ?? 0;
            if (deviceId === 0) return;
            Draw.setBlendMode(BlendMode.Normal);
            Draw.texture({ x: p.x + p.width / 2, y: height - p.y - p.height / 2 }, { x: p.width, y: p.height }, deviceId);
        };

        paint(blank);
        const unsubscribe = onDeviceRestored(() => {
            try {
                paint((rm) => {
                    blank();
                    for (const p of pastes) paste(rm, p);
                });
            } catch (error) {
                log.warn('textureCanvas', `the canvas cannot be drawn again after the device came back: ${String(error)}`);
            }
        });

        return {
            texture: rt.texture,
            width,
            height,
            draw(source, x, y, w, h) {
                let drawnWidth = w;
                let drawnHeight = h;
                if (drawnWidth === undefined || drawnHeight === undefined) {
                    const dims = getTextureDimensions(source);
                    if (!dims || dims.width <= 0 || dims.height <= 0) throw new Error(`texture handle ${source} has no size to draw`);
                    drawnWidth ??= dims.width;
                    drawnHeight ??= dims.height;
                }
                const p: Paste = { source, x, y, width: drawnWidth, height: drawnHeight };
                pastes.push(p);
                paint((rm) => paste(rm, p));
            },
            clear() {
                pastes.length = 0;
                paint(blank);
            },
            release() {
                unsubscribe();
                RenderTexture.release(rt);
            },
        };
    },
};

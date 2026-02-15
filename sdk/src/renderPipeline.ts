/**
 * @file    renderPipeline.ts
 * @brief   Unified render pipeline for runtime and editor
 */

import type { CppRegistry } from './wasm';
import { Renderer } from './renderer';
import { PostProcess } from './postprocess';
import { Draw } from './draw';
import { getDrawCallbacks, unregisterDrawCallback } from './customDraw';

export interface RenderParams {
    registry: { _cpp: CppRegistry };
    viewProjection: Float32Array;
    width: number;
    height: number;
    elapsed: number;
}

export interface CameraRenderParams {
    registry: { _cpp: CppRegistry };
    viewProjection: Float32Array;
    viewportPixels: { x: number; y: number; w: number; h: number };
    clearFlags: number;
    elapsed: number;
}

export type SpineRendererFn = (registry: { _cpp: CppRegistry }, elapsed: number) => void;

export type MaskProcessorFn = (
    registry: CppRegistry,
    vp: Float32Array,
    viewportX: number, viewportY: number,
    viewportW: number, viewportH: number
) => void;

export class RenderPipeline {
    private spineRenderer_: SpineRendererFn | null = null;
    private maskProcessor_: MaskProcessorFn | null = null;
    private lastWidth_ = 0;
    private lastHeight_ = 0;
    private activeScenes_: Set<string> | null = null;

    get spineRenderer(): SpineRendererFn | null {
        return this.spineRenderer_;
    }

    setSpineRenderer(fn: SpineRendererFn | null): void {
        this.spineRenderer_ = fn;
    }

    get maskProcessor(): MaskProcessorFn | null {
        return this.maskProcessor_;
    }

    setMaskProcessor(fn: MaskProcessorFn | null): void {
        this.maskProcessor_ = fn;
    }

    setActiveScenes(scenes: Set<string> | null): void {
        this.activeScenes_ = scenes;
    }

    render(params: RenderParams): void {
        const { registry, viewProjection, width, height, elapsed } = params;

        if (width !== this.lastWidth_ || height !== this.lastHeight_) {
            Renderer.resize(width, height);
            if (PostProcess.isInitialized() && PostProcess.getPassCount() > 0) {
                PostProcess.resize(width, height);
            }
            this.lastWidth_ = width;
            this.lastHeight_ = height;
        }

        Renderer.setViewport(0, 0, width, height);
        Renderer.clearBuffers(3);
        Renderer.begin(viewProjection);
        if (this.maskProcessor_) {
            this.maskProcessor_(registry._cpp, viewProjection, 0, 0, width, height);
        }
        Renderer.submitSprites(registry);
        Renderer.submitBitmapText(registry);
        if (this.spineRenderer_) {
            this.spineRenderer_(registry, elapsed);
        } else {
            Renderer.submitSpine(registry);
        }
        Renderer.flush();

        this.executeDrawCallbacks(viewProjection, elapsed);

        Renderer.end();
    }

    renderCamera(params: CameraRenderParams): void {
        const { registry, viewProjection, viewportPixels: vp, clearFlags, elapsed } = params;

        Renderer.setViewport(vp.x, vp.y, vp.w, vp.h);
        Renderer.setScissor(vp.x, vp.y, vp.w, vp.h, true);
        Renderer.clearBuffers(clearFlags);
        Renderer.setScissor(0, 0, 0, 0, false);

        Renderer.begin(viewProjection);
        if (this.maskProcessor_) {
            this.maskProcessor_(registry._cpp, viewProjection, vp.x, vp.y, vp.w, vp.h);
        }
        Renderer.submitSprites(registry);
        Renderer.submitBitmapText(registry);
        if (this.spineRenderer_) {
            this.spineRenderer_(registry, elapsed);
        } else {
            Renderer.submitSpine(registry);
        }
        Renderer.flush();

        this.executeDrawCallbacks(viewProjection, elapsed);

        Renderer.end();
    }

    private executeDrawCallbacks(viewProjection: Float32Array, elapsed: number): void {
        const cbs = getDrawCallbacks();
        if (cbs.size > 0) {
            Draw.begin(viewProjection);
            const failed: string[] = [];
            for (const [id, entry] of cbs.entries()) {
                if (entry.scene && this.activeScenes_ && !this.activeScenes_.has(entry.scene)) continue;
                try {
                    entry.fn(elapsed);
                } catch (e) {
                    console.error(`[CustomDraw] callback '${id}' error:`, e);
                    failed.push(id);
                }
            }
            Draw.end();
            for (const id of failed) {
                unregisterDrawCallback(id);
            }
        }
    }
}

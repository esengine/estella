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

export class RenderPipeline {
    private spineRenderer_: SpineRendererFn | null = null;

    setSpineRenderer(fn: SpineRendererFn | null): void {
        this.spineRenderer_ = fn;
    }

    render(params: RenderParams): void {
        const { registry, viewProjection, width, height, elapsed } = params;

        Renderer.resize(width, height);

        if (PostProcess.isInitialized() && PostProcess.getPassCount() > 0 && !PostProcess.isBypassed()) {
            PostProcess.resize(width, height);
        }

        Renderer.setViewport(0, 0, width, height);
        Renderer.clearBuffers(3);
        Renderer.begin(viewProjection);
        Renderer.submitSprites(registry);
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
        Renderer.submitSprites(registry);
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
            for (const [id, fn] of cbs.entries()) {
                try {
                    fn(elapsed);
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

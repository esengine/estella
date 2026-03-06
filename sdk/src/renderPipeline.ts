/**
 * @file    renderPipeline.ts
 * @brief   Unified render pipeline for runtime and editor
 */

import type { CppRegistry } from './wasm';
import type { Entity } from './types';
import { Renderer, SubmitSkipFlags } from './renderer';
import { PostProcess } from './postprocess';
import { Draw } from './draw';
import { getDrawCallbacks, unregisterDrawCallback } from './customDraw';

export interface Viewport {
    x: number;
    y: number;
    w: number;
    h: number;
}

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
    viewportPixels: Viewport;
    clearFlags: number;
    elapsed: number;
    cameraEntity?: Entity;
}

export type SpineRendererFn = (registry: { _cpp: CppRegistry }, elapsed: number) => void;

export type TilemapRendererFn = () => void;

export class RenderPipeline {
    private spineRenderer_: SpineRendererFn | null = null;
    private tilemapRenderer_: TilemapRendererFn | null = null;
    private lastWidth_ = 0;
    private lastHeight_ = 0;
    private activeScenes_: Set<string> | null = null;

    get spineRenderer(): SpineRendererFn | null {
        return this.spineRenderer_;
    }

    setSpineRenderer(fn: SpineRendererFn | null): void {
        this.spineRenderer_ = fn;
    }

    setTilemapRenderer(fn: TilemapRendererFn | null): void {
        this.tilemapRenderer_ = fn;
    }

    setActiveScenes(scenes: Set<string> | null): void {
        this.activeScenes_ = scenes;
    }

    beginScreenCapture(): void {
        if (PostProcess.screenStack && PostProcess.screenStack.enabledPassCount > 0) {
            if (!PostProcess.isInitialized()) {
                PostProcess.init(1, 1);
            }
            PostProcess._applyScreenStack();
            PostProcess._beginScreenCapture();
        }
    }

    endScreenCapture(): void {
        if (PostProcess.screenStack && PostProcess.screenStack.enabledPassCount > 0) {
            PostProcess._endScreenCapture();
            PostProcess._executeScreenPasses();
        }
    }

    submitScene(
        registry: { _cpp: CppRegistry },
        viewProjection: Float32Array,
        viewport: Viewport,
        elapsed: number,
    ): void {
        if (this.tilemapRenderer_) {
            this.tilemapRenderer_();
        }

        const skipFlags = this.spineRenderer_ ? SubmitSkipFlags.Spine : SubmitSkipFlags.None;
        Renderer.submitAll(registry, skipFlags, viewport.x, viewport.y, viewport.w, viewport.h);

        if (this.spineRenderer_) {
            this.spineRenderer_(registry, elapsed);
        }
        Renderer.flush();

        this.executeDrawCallbacks(viewProjection, elapsed);
    }

    render(params: RenderParams): void {
        const { registry, viewProjection, width, height, elapsed } = params;

        if (width !== this.lastWidth_ || height !== this.lastHeight_) {
            Renderer.resize(width, height);
            this.lastWidth_ = width;
            this.lastHeight_ = height;
        }

        Renderer.setViewport(0, 0, width, height);
        Renderer.clearBuffers(3);
        Renderer.begin(viewProjection);
        this.submitScene(registry, viewProjection, { x: 0, y: 0, w: width, h: height }, elapsed);
        Renderer.end();
    }

    renderCamera(params: CameraRenderParams): void {
        const { registry, viewProjection, viewportPixels: vp, clearFlags, elapsed, cameraEntity } = params;

        const hasPostProcess = cameraEntity !== undefined && PostProcess.getStack(cameraEntity) !== null;

        if (hasPostProcess) {
            PostProcess._applyForCamera(cameraEntity!);
            PostProcess.resize(vp.w, vp.h);
            PostProcess.setOutputViewport(vp.x, vp.y, vp.w, vp.h);
            PostProcess.begin();
        }

        Renderer.setViewport(vp.x, vp.y, vp.w, vp.h);
        Renderer.setScissor(vp.x, vp.y, vp.w, vp.h, true);
        Renderer.clearBuffers(clearFlags);
        Renderer.setScissor(0, 0, 0, 0, false);

        Renderer.begin(viewProjection);
        this.submitScene(registry, viewProjection, vp, elapsed);
        Renderer.end();

        if (hasPostProcess) {
            PostProcess.end();
            PostProcess._resetAfterCamera();
        }
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

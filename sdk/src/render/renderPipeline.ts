// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    renderPipeline.ts
 * @brief   Unified render pipeline for runtime and editor
 */

import type { CppRegistry } from '../wasm';
import type { Entity } from '../types';
import { Renderer } from './renderer';
import type { PostProcessAPI } from '../postprocess';
import { Draw, isDrawAPIReady } from './draw';
import {
    getDrawCallbacks,
    unregisterDrawCallback,
    getPreSceneDrawCallbacks,
    unregisterPreSceneDrawCallback,
} from './customDraw';
import { log } from '../util/logger';

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
    /** Background for the pass's load-op clear (default opaque black). */
    clearColor?: { x: number; y: number; z: number; w: number };
}

export interface CameraRenderParams {
    registry: { _cpp: CppRegistry };
    viewProjection: Float32Array;
    viewportPixels: Viewport;
    clearFlags: number;
    elapsed: number;
    cameraEntity?: Entity;
    /** Background for the camera's load-op clear (default opaque black). */
    clearColor?: { x: number; y: number; z: number; w: number };
    /** Sorting layers this camera draws (`Camera.cullingMask`); omitted = all. */
    cullingMask?: number;
}

export class RenderPipeline {
    private lastWidth_ = 0;
    private lastHeight_ = 0;
    private activeScenes_: Set<string> | null = null;
    private preFlushCallbacks_: ((registry: { _cpp: CppRegistry }) => void)[] = [];
    private postProcess_: PostProcessAPI | null = null;

    setActiveScenes(scenes: Set<string> | null): void {
        this.activeScenes_ = scenes;
    }

    /**
     * Inject this App's post-process API (by PostProcessPlugin). When null, the
     * pipeline does no post-processing — it has no hard dependency on the
     * post-process subsystem.
     */
    setPostProcess(pp: PostProcessAPI | null): void {
        this.postProcess_ = pp;
    }

    addPreFlushCallback(cb: (registry: { _cpp: CppRegistry }) => void): void {
        this.preFlushCallbacks_.push(cb);
    }

    /**
     * Run what plugins registered to draw just before the frame flushes (glyph
     * quads, today). {@link submitScene} calls this in the middle of its own
     * sequence; a host that owns its render loop in C++ — the native one — calls
     * it directly at the same point, between collecting the scene and flushing,
     * so text lands in the same frame either way.
     */
    runPreFlushCallbacks(registry: { _cpp: CppRegistry }): void {
        for (const cb of this.preFlushCallbacks_) cb(registry);
    }

    beginFrame(elapsedSec = 0): void {
        Renderer.beginFrame(elapsedSec);
    }

    beginScreenCapture(): void {
        const pp = this.postProcess_;
        if (pp && pp.screenStack && pp.screenStack.enabledPassCount > 0) {
            if (!pp.isInitialized()) {
                pp.init(1, 1);
            }
            pp._applyScreenStack();
            pp._beginScreenCapture();
        }
    }

    endScreenCapture(): void {
        const pp = this.postProcess_;
        if (pp && pp.screenStack && pp.screenStack.enabledPassCount > 0) {
            pp._endScreenCapture();
            pp._executeScreenPasses();
        }
    }

    submitScene(
        registry: { _cpp: CppRegistry },
        viewProjection: Float32Array,
        viewport: Viewport,
        _elapsed: number,
    ): void {
        // Underlays (editor grid / world-space guides) draw first so the scene's
        // sprites, flushed below, occlude them.
        this.executePreSceneDrawCallbacks(viewProjection, viewport, _elapsed);

        Renderer.updateTransforms(registry);
        Renderer.submitAll(registry, viewport.x, viewport.y, viewport.w, viewport.h);
        this.runPreFlushCallbacks(registry);
        Renderer.flush();

        this.executeDrawCallbacks(viewProjection, _elapsed);
    }

    render(params: RenderParams): void {
        const { registry, viewProjection, width, height, elapsed } = params;

        if (width !== this.lastWidth_ || height !== this.lastHeight_) {
            Renderer.resize(width, height);
            this.lastWidth_ = width;
            this.lastHeight_ = height;
        }

        Renderer.beginFrame(elapsed);
        Renderer.setViewport(0, 0, width, height);
        Renderer.begin(viewProjection, 0, /*clear color+depth*/ 3, params.clearColor);
        // The mask is sticky in the draw list; this path has no camera to own one.
        Renderer.setCullingMask(0xFFFFFFFF);
        this.submitScene(registry, viewProjection, { x: 0, y: 0, w: width, h: height }, elapsed);
        Renderer.end();
    }

    renderCamera(params: CameraRenderParams): void {
        const { registry, viewProjection, viewportPixels: vp, clearFlags, elapsed, cameraEntity } = params;

        const pp = this.postProcess_;
        const hasPostProcess = pp !== null && cameraEntity !== undefined && pp.getStack(cameraEntity) !== null;

        if (hasPostProcess) {
            pp!._applyForCamera(cameraEntity!);
            pp!.resize(vp.w, vp.h);
            pp!.setOutputViewport(vp.x, vp.y, vp.w, vp.h);
            pp!.begin();
        }

        Renderer.setViewport(vp.x, vp.y, vp.w, vp.h);
        // The camera's clear rides begin as a region-scoped load-op — no scissor
        // dance, no sticky clear state at the boundary.
        Renderer.begin(viewProjection, 0, clearFlags, params.clearColor, vp);
        // Set after begin (which clears the draw list) and before the collect it gates.
        Renderer.setCullingMask(params.cullingMask ?? 0xFFFFFFFF);
        this.submitScene(registry, viewProjection, vp, elapsed);
        Renderer.end();

        if (hasPostProcess) {
            pp!.end();
            pp!._resetAfterCamera();
        }
    }

    private executePreSceneDrawCallbacks(
        viewProjection: Float32Array,
        viewport: Viewport,
        elapsed: number,
    ): void {
        const cbs = getPreSceneDrawCallbacks();
        // Same bargain as the post-scene pass: a core with no Draw API has no
        // batch to open, and the callbacks would have nowhere to draw.
        if (cbs.size === 0 || !isDrawAPIReady()) return;
        Draw.begin(viewProjection);
        const failed: string[] = [];
        for (const [id, fn] of cbs.entries()) {
            try {
                fn({ width: viewport.w, height: viewport.h, elapsed });
            } catch (e) {
                log.error('render', `pre-scene callback '${id}' error`, e);
                failed.push(id);
            }
        }
        Draw.end();
        for (const id of failed) {
            unregisterPreSceneDrawCallback(id);
        }
    }

    private executeDrawCallbacks(viewProjection: Float32Array, elapsed: number): void {
        const cbs = getDrawCallbacks();
        // Plugins register overlays at build time whether one is ever turned on,
        // and a core with no Draw API has no batch to open — opening one throws
        // the frame away for a callback that would have drawn nothing.
        if (cbs.size > 0 && isDrawAPIReady()) {
            Draw.begin(viewProjection);
            const failed: string[] = [];
            for (const [id, entry] of cbs.entries()) {
                if (entry.scene && this.activeScenes_ && !this.activeScenes_.has(entry.scene)) continue;
                try {
                    entry.fn(elapsed);
                } catch (e) {
                    log.error('render', `callback '${id}' error`, e);
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

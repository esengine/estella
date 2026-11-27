// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    renderPipeline.ts
 * @brief   Unified render pipeline for runtime and editor
 */

import type { CppRegistry } from '../wasm';
import type { App } from '../app/app';
import type { World } from '../ecs/world';
import type { Entity, Vec3 } from '../types';
import { Renderer } from './renderer';
import type { PostProcessAPI } from '../postprocess';
import { screenOverlayPasses, type ScreenOverlayData } from '../ui/core/screen-overlay';
import { Draw, beginPresentedDraw, endPresentedDraw, isDrawAPIReady } from './draw';
import { sceneDrawCallbacks, preSceneCallbacks, overScreenCallbacks, type DrawFrameInfo } from './customDraw';
import { log } from '../util/logger';
import { planPresent, RenderResolution, type PresentPlan } from '../camera/presentPlan';
import type { QualityController } from './quality';
import { RenderDemand } from './renderDemand';

type PassCallback = (registry: { _cpp: CppRegistry }, viewProjection?: Float32Array) => void;
type PassStill = (registry: { _cpp: CppRegistry }) => boolean;

interface PassRegistration {
    draw: PassCallback;
    still?: PassStill;
    world?: World;
    active: boolean;
    lastOverlay: number;
}

function drawsIn(entry: PassRegistration, registry: CppRegistry): boolean {
    return entry.active && (!entry.world || entry.world.getCppRegistry() === registry);
}

class PassCallbacks {
    entries: readonly PassRegistration[] = [];

    add(draw: PassCallback, still?: PassStill, owner?: App): () => void {
        const life = owner?.signal;
        if (life?.aborted) return () => {};
        const entry = { draw, still, world: owner?.world, active: true, lastOverlay: -1 };
        // The pass in progress keeps its list. Removal takes effect immediately, additions on the next pass.
        this.entries = [...this.entries, entry];
        const release = () => {
            if (!entry.active) return;
            entry.active = false;
            this.entries = this.entries.filter(candidate => candidate !== entry);
            life?.removeEventListener('abort', release);
        };
        life?.addEventListener('abort', release, { once: true });
        return release;
    }
}

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
    /**
     * The caller already opened the frame (`beginFrame`) — as the render system
     * does, so the transform pass can run before the cameras are read. Opening a
     * frame twice ages the render-target pool twice, so it must happen once.
     */
    frameAlreadyBegun?: boolean;
}

export interface CameraRenderParams {
    registry: { _cpp: CppRegistry };
    viewProjection: Float32Array;
    /** The view-projection for the render origin, which the renderer is begun with; absent, `viewProjection` (the origin is zero). */
    renderViewProjection?: Float32Array;
    /** The world origin of `renderViewProjection`, for render-space over-screen callbacks. */
    renderOrigin?: Readonly<Vec3>;
    /** Editor parallax center in render space, for callbacks that align to a layer. */
    parallaxCenter?: DrawFrameInfo['parallaxCenter'];
    viewportPixels: Viewport;
    clearFlags: number;
    elapsed: number;
    cameraEntity?: Entity;
    /** Background for the camera's load-op clear (default opaque black). */
    clearColor?: { x: number; y: number; z: number; w: number };
    /** Sorting layers this camera draws (`Camera.cullingMask`); omitted = all. */
    cullingMask?: number;
    /** Offscreen target to draw into; 0 (default) is the screen. */
    renderTarget?: number;
    /** World units the camera shows vertically (`2 * halfH`); drives the render size. */
    worldHeight?: number;
    /** How the render resolution is chosen for the frame output; intermediate targets use their own resolution. */
    renderPolicy?: RenderResolution;
    /**
     * Draw the scene the previous camera collected, from this view, rather than collecting it again: a headset's second eye,
     * after a first collected for a view covering both (Renderer.setCollectView). Collects as usual when there is none.
     */
    replay?: boolean;
}

export class RenderPipeline {
    private frameElapsed_ = 0;
    get frameElapsed(): number { return this.frameElapsed_; }
    private renderingEnabled_ = true;
    /** Which frames are drawn, when the game has asked for only those that can look different. */
    readonly demand = new RenderDemand();
    private lastWidth_ = 0;
    private lastHeight_ = 0;
    private activeScenes_: Set<string> | null = null;
    private readonly preFlushCallbacks_ = new PassCallbacks();
    private readonly screenOverlayCallbacks_ = new PassCallbacks();
    private overlayPass_ = 0;
    private overlayCallbackCount_ = 0;
    private postProcess_: PostProcessAPI | null = null;
    private postProcessInitFailed_ = false;
    private quality_: QualityController | null = null;
    private applyQuality_: (() => void) | null = null;
    private warnedMissingPresent_ = false;
    private presentationTarget_ = 0;
    /** The last camera that drew to this frame's output surface. */
    private overScreenView_: {
        viewProjection: Float32Array;
        relative?: { viewProjection: Float32Array; origin: Vec3 };
        parallaxCenter?: DrawFrameInfo['parallaxCenter'];
        viewport: Viewport;
        registry: CppRegistry;
        activeScenes: ReadonlySet<string> | null;
    } | null = null;

    /** @experimental */
    get renderingEnabled(): boolean { return this.renderingEnabled_; }

    /** @experimental */
    setRenderingEnabled(enabled: boolean): void { this.renderingEnabled_ = enabled; }

    setQuality(quality: QualityController, apply?: () => void): void {
        this.quality_ = quality;
        this.applyQuality_ = apply ?? null;
    }

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
        this.postProcessInitFailed_ = false;
    }

    /** An owner scopes the callback to its current registry and releases it when the app quits. */
    addPreFlushCallback(cb: PassCallback, owner?: App): () => void {
        return this.preFlushCallbacks_.add(cb, undefined, owner);
    }

    /**
     * Register geometry a plugin draws into the SCREEN overlay rather than into a
     * camera — the sibling of {@link addPreFlushCallback}, separate for the same
     * reason the two collects are: a callback that ran in both would put the same
     * glyph in each list. Runs between the overlay's collect and its pass.
     * An owner scopes both drawing and retention to its current registry for the lifetime of the app.
     */
    addScreenOverlayCallback(
        cb: PassCallback,
        still?: PassStill,
        owner?: App,
    ): () => void {
        return this.screenOverlayCallbacks_.add(cb, still, owner);
    }

    /**
     * Run what plugins registered to draw just before the frame flushes (glyph
     * quads, today). {@link submitScene} calls this in the middle of its own
     * sequence; a host that owns its render loop in C++ — the native one — calls
     * it directly at the same point, between collecting the scene and flushing,
     * so text lands in the same frame either way.
     */
    runPreFlushCallbacks(registry: { _cpp: CppRegistry }, viewProjection?: Float32Array): void {
        for (const entry of this.preFlushCallbacks_.entries) {
            if (drawsIn(entry, registry._cpp)) entry.draw(registry, viewProjection);
        }
    }

    /** `presentationTarget` is the frame's output, even when intermediate cameras draw into other targets. */
    beginFrame(elapsedSec = 0, presentationTarget = 0): void {
        this.frameElapsed_ = elapsedSec;
        this.presentationTarget_ = presentationTarget;
        this.overScreenView_ = null;
        this.postProcessInitFailed_ = false;
        this.applyQuality_?.();
        this.quality_?.setLimitation('fixed-render-resolution', false);
        this.quality_?.setLimitation('resolution-present-unavailable', false);
        this.postProcess_?.setQualityFilter(this.quality_?.enabled ? this.quality_.profile : null);
        Renderer.beginFrame(elapsedSec);
    }

    /**
     * Closes the frame. The pair of {@link beginFrame}, and the last thing a
     * frame does: a backend that borrows the swapchain image for a frame gives it
     * back here, so everything drawn after the first camera — a second camera,
     * the screen post stack, the overlay — still has somewhere to land.
     */
    endFrame(): void {
        Renderer.endFrame();
    }

    /**
     * The frame's screen-space overlay: one pass, after every camera and after
     * post. It takes a projection and a rect and no camera, which is what makes a
     * HUD hold still while the view moves. Silent when the core has no overlay
     * pass, which has not partitioned the domains either.
     */
    renderScreenOverlay(
        registry: { _cpp: CppRegistry },
        overlay: ScreenOverlayData,
        target = 0,
    ): void {
        if (!overlay.active || overlay.vpW === 0 || overlay.vpH === 0) return;
        if (!Renderer.hasScreenOverlay()) return;

        if (overlay.effects.length === 0 || !Renderer.hasScreenOverlayEffect()) {
            this.drawScreenOverlay(registry, overlay, overlay.layerMask, 0, target);
            return;
        }
        for (const pass of screenOverlayPasses(overlay.layerMask, overlay.effects)) {
            this.drawScreenOverlay(registry, overlay, pass.layers, pass.effect, target);
        }
    }

    private drawScreenOverlay(
        registry: { _cpp: CppRegistry },
        overlay: ScreenOverlayData,
        layers: number,
        effect: number,
        target: number,
    ): void {
        Renderer.beginScreenOverlay(overlay.projection,
                                    overlay.vpX, overlay.vpY, overlay.vpW, overlay.vpH);
        Renderer.setCullingMask(layers);
        if (effect !== 0) Renderer.setScreenOverlayEffect(effect);
        // A pass nothing it draws has changed since is the one the engine holds: it draws that, and nothing is submitted.
        const entries = this.screenOverlayCallbacks_.entries;
        const pass = ++this.overlayPass_;
        let hostStill = true, count = 0;
        for (const entry of entries) {
            if (!drawsIn(entry, registry._cpp)) continue;
            ++count;
            if (pass > 1 && entry.lastOverlay !== pass - 1) hostStill = false;
            entry.lastOverlay = pass;
            if (hostStill && !entry.still?.(registry)) hostStill = false;
        }
        // A retired contributor can have left geometry in the held list. An unrelated world's registrations cannot.
        if (pass > 1 && count !== this.overlayCallbackCount_) hostStill = false;
        this.overlayCallbackCount_ = count;
        if (!Renderer.keepScreenOverlay(registry, hostStill)) {
            Renderer.submitScreenOverlay(registry);
            for (const entry of entries) {
                if (entry.lastOverlay === pass && drawsIn(entry, registry._cpp)) entry.draw(registry, overlay.projection);
            }
        }
        Renderer.endScreenOverlay(target);
    }

    /**
     * Draw the over-screen callbacks over everything the frame shows: after the
     * screen overlay and before the frame ends, through the view of the last
     * camera drawn to the output surface. A frame with no such camera draws none of them.
     */
    renderOverScreen(target = this.presentationTarget_): void {
        if (target !== this.presentationTarget_) return;
        const view = this.overScreenView_;
        this.overScreenView_ = null;
        if (!view || overScreenCallbacks.entries.size === 0 || !isDrawAPIReady() || !Renderer.hasDrawOverScreen()) return;
        const { viewProjection, viewport, relative, parallaxCenter } = view;
        const info = { width: viewport.w, height: viewport.h, parallaxCenter };
        const draw = (frame: DrawFrameInfo, renderSpace?: boolean) => {
            const drew = overScreenCallbacks.dispatch(view.registry, view.activeScenes,
                () => beginPresentedDraw(frame.viewProjection, frame.width, frame.height),
                fn => fn(this.frameElapsed_, frame), renderSpace);
            if (drew) {
                endPresentedDraw();
                Renderer.drawOverScreen(viewport.x, viewport.y, viewport.w, viewport.h, target);
            }
        };
        draw({ viewProjection, ...info }, relative ? false : undefined);
        if (relative) draw({ ...relative, ...info }, true);
    }

    /** Whether a screen-level effect stack is on: it draws the whole screen, so a frame meant for a render target cannot hold it. */
    get screenEffectsActive(): boolean {
        const pp = this.postProcess_;
        return !!(pp && pp.screenStack && pp.screenStack.enabledPassCount > 0);
    }

    beginScreenCapture(): void {
        const pp = this.postProcess_;
        if (pp?.screenStack && pp.screenStack.enabledPassCount > 0 && this.ensurePostProcess()) {
            pp._applyScreenStack();
            pp._beginScreenCapture();
        }
    }

    endScreenCapture(): void {
        const pp = this.postProcess_;
        if (pp?.screenStack && pp.screenStack.enabledPassCount > 0 && pp.isInitialized()) {
            pp._endScreenCapture();
            pp._executeScreenPasses();
        }
    }

    submitScene(
        registry: { _cpp: CppRegistry },
        viewProjection: Float32Array,
        viewport: Viewport,
        _elapsed: number,
        replay = false,
        presentsFrame = true,
        parallaxCenter?: DrawFrameInfo['parallaxCenter'],
    ): void {
        // Underlays (editor grid / world-space guides) draw first so the scene's
        // sprites, flushed below, occlude them.
        this.executePreSceneDrawCallbacks(viewProjection, viewport, _elapsed, registry._cpp);

        Renderer.updateTransforms(registry);
        if (replay) {
            // The list is the previous camera's, glyphs and all: what the pre-flush callbacks add is in it already.
            Renderer.submitReplay(registry, viewport.x, viewport.y, viewport.w, viewport.h);
        } else {
            Renderer.submitAll(registry, viewport.x, viewport.y, viewport.w, viewport.h);
            this.runPreFlushCallbacks(registry, viewProjection);
        }
        Renderer.flush();

        this.executeDrawCallbacks(viewProjection, viewport, _elapsed, registry._cpp, presentsFrame, parallaxCenter);
    }

    render(params: RenderParams): void {
        const { registry, viewProjection, width, height, elapsed } = params;

        if (width !== this.lastWidth_ || height !== this.lastHeight_) {
            Renderer.resize(width, height);
            this.lastWidth_ = width;
            this.lastHeight_ = height;
        }

        if (!params.frameAlreadyBegun) Renderer.beginFrame(elapsed);
        Renderer.setViewport(0, 0, width, height);
        Renderer.begin(viewProjection, 0, /*clear color+depth*/ 3, params.clearColor);
        // The mask is sticky in the draw list; this path has no camera to own one.
        Renderer.setCullingMask(0xFFFFFFFF);
        Renderer.setViewId(0);
        this.submitScene(registry, viewProjection, { x: 0, y: 0, w: width, h: height }, elapsed);
        Renderer.end();
    }

    private ensurePostProcess(): boolean {
        const pp = this.postProcess_;
        if (!pp) return false;
        if (pp.isInitialized()) return true;
        // Picking and submission must use the same fallback within a frame.
        if (this.postProcessInitFailed_) return false;
        const initialized = pp.init(1, 1);
        this.postProcessInitFailed_ = !initialized;
        return initialized;
    }

    /** @internal Resolve the project's display policy against the active backend for drawing and picking. */
    cameraPresentPlan(vp: Viewport, worldHeight: number, policy = RenderResolution.Surface): PresentPlan {
        const plan = planPresent(policy, worldHeight, vp.w, vp.h);
        if (plan.oneToOne || this.ensurePostProcess()) return plan;
        if (!this.warnedMissingPresent_) {
            log.warn('render', 'Resolution policy needs post-processing; using surface resolution');
            this.warnedMissingPresent_ = true;
        }
        return planPresent(RenderResolution.Surface, 0, vp.w, vp.h);
    }

    renderCamera(params: CameraRenderParams): void {
        const { registry, viewProjection, viewportPixels: vp, clearFlags, elapsed, cameraEntity } = params;
        const target = params.renderTarget ?? 0;
        const presentsFrame = target === this.presentationTarget_;
        const policy = (presentsFrame ? params.renderPolicy : undefined) ?? RenderResolution.Surface;

        // Where the scene is drawn and where it lands are two rects. A sprite that
        // scales itself can only clamp at its own texture's edge, so every boundary
        // breaks; scaling one whole image has no interior boundary to break.
        let plan = this.cameraPresentPlan(vp, params.worldHeight ?? 0, policy);
        const quality = this.quality_;
        const scale = quality?.renderScale ?? 1;
        const fixedResolution = policy !== RenderResolution.Surface;
        const scaling = scale < 1 && !fixedResolution && presentsFrame && target === 0;
        if (scale < 1 && fixedResolution) quality?.setLimitation('fixed-render-resolution', true);
        if (scaling) {
            if (this.ensurePostProcess()) {
                plan = { ...plan, renderWidth: Math.max(1, Math.round(vp.w * scale)),
                    renderHeight: Math.max(1, Math.round(vp.h * scale)), oneToOne: false };
            } else {
                quality?.setLimitation('resolution-present-unavailable', true);
            }
        }
        const scene: Viewport = plan.oneToOne
            ? vp
            : { x: 0, y: 0, w: plan.renderWidth, h: plan.renderHeight };
        const present: Viewport = plan.oneToOne
            ? vp
            : { x: vp.x + plan.x, y: vp.y + plan.y, w: plan.width, h: plan.height };

        const pp = this.postProcess_;
        pp?.setQualityFilter(quality?.enabled ? quality.profile : null);
        const useStack = pp !== null && cameraEntity !== undefined && pp.getStack(cameraEntity) !== null
            && (!plan.oneToOne || this.ensurePostProcess());
        const usePostProcess = useStack || !plan.oneToOne;

        if (useStack) pp._applyForCamera(cameraEntity);
        if (pp && (usePostProcess || pp.isInitialized())) {
            pp.resize(scene.w, scene.h);
            pp.setOutputViewport(present.x, present.y, present.w, present.h);
            // A letterbox at 1x is the same size as its chain and merely offset, so
            // the engine cannot read the need for it off the rects.
            pp.setPresentRequired(!plan.oneToOne);
        }
        if (usePostProcess) pp!.begin();

        Renderer.setViewport(scene.x, scene.y, scene.w, scene.h);
        // The camera's clear rides begin as a region-scoped load-op — no scissor
        // dance, no sticky clear state at the boundary.
        const beginView = params.renderViewProjection ?? viewProjection;
        const replayed = params.replay === true
            && Renderer.beginReplay(beginView, target, clearFlags, params.clearColor, scene);
        if (!replayed) Renderer.begin(beginView, target, clearFlags, params.clearColor, scene);
        // Set after begin (which clears the draw list) and before the collect it gates.
        Renderer.setCullingMask(params.cullingMask ?? 0xFFFFFFFF);
        // The camera IS the view: a level picked from how big something looks is
        // this camera's answer, and the next camera must be free to disagree.
        Renderer.setViewId(cameraEntity ?? 0);
        this.submitScene(registry, viewProjection, scene, elapsed, replayed, presentsFrame, params.parallaxCenter);
        Renderer.end();
        if (presentsFrame && overScreenCallbacks.entries.size > 0) {
            const origin = params.renderOrigin;
            this.overScreenView_ = {
                viewProjection: Float32Array.from(viewProjection), viewport: { ...present }, registry: registry._cpp,
                parallaxCenter: params.parallaxCenter && { ...params.parallaxCenter },
                relative: params.renderViewProjection && origin && (origin.x !== 0 || origin.y !== 0 || origin.z !== 0)
                    ? { viewProjection: Float32Array.from(params.renderViewProjection), origin: { x: origin.x, y: origin.y, z: origin.z } }
                    : undefined,
                activeScenes: this.activeScenes_ && new Set(this.activeScenes_),
            };
        }

        if (usePostProcess) {
            pp!.end();
            if (useStack) pp!._resetAfterCamera();
        }
    }

    private executePreSceneDrawCallbacks(
        viewProjection: Float32Array,
        viewport: Viewport,
        elapsed: number,
        registry: CppRegistry,
    ): void {
        if (preSceneCallbacks.entries.size === 0 || !isDrawAPIReady()) return;
        const info = { width: viewport.w, height: viewport.h, elapsed };
        const drew = preSceneCallbacks.dispatch(registry, this.activeScenes_,
            () => Draw.begin(viewProjection, viewport.w, viewport.h), fn => fn(info));
        if (drew) Draw.end();
    }

    private executeDrawCallbacks(viewProjection: Float32Array, viewport: Viewport, elapsed: number, registry: CppRegistry,
                                 presentsFrame: boolean, parallaxCenter?: DrawFrameInfo['parallaxCenter']): void {
        const lateHere = presentsFrame && overScreenCallbacks.entries.size > 0 && !Renderer.hasDrawOverScreen();
        if ((!sceneDrawCallbacks.entries.size && !lateHere) || !isDrawAPIReady()) return;
        const frame = { viewProjection, width: viewport.w, height: viewport.h, parallaxCenter };
        let started = false;
        const begin = () => {
            if (!started) { beginPresentedDraw(viewProjection, viewport.w, viewport.h); started = true; }
        };
        sceneDrawCallbacks.dispatch(registry, this.activeScenes_, begin, fn => fn(elapsed, frame));
        // A core without a separate screen pass draws its handles in the scene's batch.
        if (lateHere) overScreenCallbacks.dispatch(registry, this.activeScenes_, begin, fn => fn(this.frameElapsed_, frame));
        if (started) endPresentedDraw();
    }
}

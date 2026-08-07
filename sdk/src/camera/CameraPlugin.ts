// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraPlugin.ts
 * @brief   Camera system plugin — collects cameras, computes view-projection, drives rendering
 */

import type { App, Plugin } from '../app/app';
import type { SystemDef } from '../ecs/system';
import { Schedule, defineSystem } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { playModeOnly } from '../ecs/env';
import { followUpdate } from './FollowTarget';
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { UICameraInfo } from '../ui/core/ui-camera-info';
import { ProjectionType, SceneOwner, ClearFlags } from '../ecs/component';
import { uiLayoutRect, computeEffectiveOrthoSize, EDITOR_VIEW_ENTITY, type CanvasScale } from './uiLayoutRect';
import { EditorView, DEFAULT_EDITOR_VIEW, type EditorViewData } from './EditorView';
import { ScreenScaling, DEFAULT_SCREEN_SCALING, SCREEN_FIT_OFF } from './ScreenScaling';
import { CameraDirector, createDirectorState, resolveMainPOV } from './CameraDirector';
import { RenderPipeline } from '../render/renderPipeline';
import { Renderer } from '../render/renderer';
import { platformNow, platformDevicePixelRatio } from '../platform';
import { SceneManager } from '../scene/sceneManager';
import { ortho, perspective, invertViewZ, multiply, IDENTITY } from '../math/mat4';

// =============================================================================
// Camera Info
// =============================================================================

interface CameraInfo {
    entity: number;
    viewProjection: Float32Array;
    viewportRect: { x: number; y: number; w: number; h: number };
    clearFlags: number;
    priority: number;
    halfW: number;
    halfH: number;
    cameraX: number;
    cameraY: number;
    cullingMask: number;
}

function acquireCameraInfo(pool: CameraInfo[], index: number): CameraInfo {
    if (index < pool.length) {
        return pool[index];
    }
    const info: CameraInfo = {
        entity: 0,
        viewProjection: new Float32Array(16),
        viewportRect: { x: 0, y: 0, w: 0, h: 0 },
        clearFlags: 0,
        priority: 0,
        halfW: 0,
        halfH: 0,
        cameraX: 0,
        cameraY: 0,
        cullingMask: 0xFFFFFFFF,
    };
    pool.push(info);
    return info;
}

// =============================================================================
// Canvas / Ortho Helpers
// =============================================================================

/**
 * The two scene queries this plugin makes of the engine. On web they are module
 * functions over the embind registry; a native registry answers them itself (it
 * has no module to route them through — see createNativeRegistry), so ask the
 * registry first and fall through unchanged everywhere else.
 */
interface SceneQueryRegistry {
    getCanvasEntity?(): number;
    getCanvasEntities?(): number[];
    getCameraEntities?(): number[];
}

/**
 * The Canvas whose fit and background the frame uses: the first owned by a RUNNING
 * scene, else the first at all. Scene membership (SceneOwner) is an SDK component
 * the engine cannot see, so it enumerates and this chooses.
 */
function canvasEntityOf(
    module: ESEngineModule | null,
    registry: CppRegistry,
    world?: World,
    activeScenes?: Set<string>,
): number {
    const reg = registry as CppRegistry & SceneQueryRegistry;
    const all = reg.getCanvasEntities
        ? reg.getCanvasEntities.call(registry)
        : module?.registry_getCanvasEntities?.(registry);
    if (all && all.length > 0) {
        if (world && activeScenes) {
            for (const e of all) {
                const owner = world.tryGet(e as Entity, SceneOwner);
                if (!owner || owner.scene === '' || activeScenes.has(owner.scene)) return e;
            }
        }
        return all[0];
    }
    // A core built before the enumeration answers only the single-Canvas question.
    const own = reg.getCanvasEntity;
    if (own) return own.call(registry);
    return module?.registry_getCanvasEntity(registry) ?? -1;
}

function cameraEntitiesOf(module: ESEngineModule | null, registry: CppRegistry): number[] {
    const own = (registry as CppRegistry & SceneQueryRegistry).getCameraEntities;
    if (own) return own.call(registry);
    return module?.registry_getCameraEntities(registry) ?? [];
}

function findCanvasData(
    module: ESEngineModule | null,
    registry: CppRegistry,
    world?: World,
    activeScenes?: Set<string>,
) {
    const entity = canvasEntityOf(module, registry, world, activeScenes);
    if (entity < 0) return null;
    return registry.getCanvas(entity);
}

// computeEffectiveOrthoSize + the UI layout box math live in ./uiLayoutRect
// (pure, unit-tested). buildCameraInfo applies the former for design-resolution
// scaling; syncUICameraInfo uses the latter for the UI layout rect.

// =============================================================================
// Camera POV (authored view parameters, decoupled from the baked matrix)
// =============================================================================

/**
 * A camera's authored point-of-view — the view *parameters*, separate from the
 * computed view-projection matrix. This is the seam a camera director will blend
 * over (interpolating x / y / rotation / orthoSize between two POVs) before one
 * view is built and handed to the renderer. The POV holds only authored values;
 * `buildCameraInfo` applies presentation (canvas design-resolution scaling, the
 * projection, the rotation) when turning a POV into the renderer-facing CameraInfo.
 */
export interface CameraPOV {
    entity: number; // source entity, or -1 for a synthetic POV (e.g. the editor view)
    isActive: boolean; // the authoritative "this is the main camera" flag (director input)
    x: number;
    y: number;
    z: number;
    rotation: number; // Z rotation, radians
    projection: number; // ProjectionType
    orthoSize: number; // authored ortho half-height
    fov: number;
    near: number;
    far: number;
    viewport: { x: number; y: number; z: number; w: number };
    clearFlags: number;
    priority: number;
    pixelPerfect: boolean;
    /** Sorting layers this camera renders; bit i = layer i. */
    cullingMask: number;
}

/**
 * Snap a world coordinate to the camera's pixel grid (one cell = one rendered pixel,
 * in world units). Rounding the camera position to this grid is what makes pixel-perfect
 * rendering stable — static sprites land on the same texels every frame instead of
 * shimmering as the camera drifts by sub-pixel amounts. worldPerPixel <= 0 is a no-op.
 */
export function snapToPixelGrid(value: number, worldPerPixel: number): number {
    return worldPerPixel > 0 ? Math.round(value / worldPerPixel) * worldPerPixel : value;
}

function readCameraPOV(
    entity: number,
    camera: ReturnType<CppRegistry['getCamera']>,
    transform: ReturnType<CppRegistry['getTransform']>,
): CameraPOV {
    const q = transform.rotation;
    return {
        entity,
        isActive: camera.isActive,
        x: transform.position.x,
        y: transform.position.y,
        z: transform.position.z,
        rotation: 2 * Math.atan2(q.z, q.w), // quaternion → Z angle (2D convention)
        projection: camera.projectionType,
        orthoSize: camera.orthoSize,
        fov: camera.fov,
        near: camera.nearPlane,
        far: camera.farPlane,
        viewport: { x: camera.viewport.x, y: camera.viewport.y, z: camera.viewport.z, w: camera.viewport.w },
        clearFlags: camera.clearFlags,
        priority: camera.priority,
        pixelPerfect: camera.pixelPerfect,
        // A core built before the field answers undefined; that camera drew everything.
        cullingMask: camera.cullingMask ?? 0xFFFFFFFF,
    };
}

/**
 * Build the renderer-facing CameraInfo from a POV. `canvas` (when given) applies
 * the design-resolution ortho scaling for scene cameras; pass null to use the raw
 * orthoSize (the editor view does this, for predictable zoom). Rotation is applied
 * here via invertViewZ.
 */
export function buildCameraInfo(
    pov: CameraPOV,
    width: number,
    height: number,
    canvas: CanvasScale | null,
    pool: CameraInfo[],
    index: number,
): CameraInfo {
    const aspect = (pov.viewport.z * width) / (pov.viewport.w * height);
    let projection: Float32Array;
    let halfW = 0;
    let halfH = 0;

    if (pov.projection === ProjectionType.Orthographic) {
        halfH = pov.orthoSize;
        if (canvas) {
            const baseOrthoSize = canvas.designResolution.y / 2;
            const designAspect = canvas.designResolution.x / canvas.designResolution.y;
            halfH = computeEffectiveOrthoSize(
                baseOrthoSize, designAspect, aspect,
                canvas.scaleMode, canvas.matchWidthOrHeight,
            );
        }
        halfW = halfH * aspect;
        projection = ortho(-halfW, halfW, -halfH, halfH, -pov.far, pov.far);
    } else {
        projection = perspective(pov.fov * Math.PI / 180, aspect, pov.near, pov.far);
    }

    // Pixel-perfect: snap the camera onto the world-space pixel grid before building
    // the view, so static pixel art doesn't shimmer. Orthographic only (a perspective
    // pixel grid is ill-defined); snapped in world space, which is exact for the common
    // unrotated 2D case. The snapped position also drives cameraX/Y so screen↔world stays
    // consistent with what's rendered.
    let camX = pov.x;
    let camY = pov.y;
    if (pov.pixelPerfect && pov.projection === ProjectionType.Orthographic) {
        const worldPerPixel = (2 * halfH) / Math.max(pov.viewport.w * height, 1);
        camX = snapToPixelGrid(pov.x, worldPerPixel);
        camY = snapToPixelGrid(pov.y, worldPerPixel);
    }

    const view = invertViewZ(camX, camY, pov.z, Math.cos(pov.rotation), Math.sin(pov.rotation));
    const cam = acquireCameraInfo(pool, index);
    cam.entity = pov.entity;
    cam.viewProjection.set(multiply(projection, view));
    cam.viewportRect.x = pov.viewport.x;
    cam.viewportRect.y = pov.viewport.y;
    cam.viewportRect.w = pov.viewport.z;
    cam.viewportRect.h = pov.viewport.w;
    cam.clearFlags = pov.clearFlags;
    cam.priority = pov.priority;
    cam.halfW = halfW;
    cam.halfH = halfH;
    cam.cameraX = camX;
    cam.cameraY = camY;
    cam.cullingMask = pov.cullingMask;
    return cam;
}

// =============================================================================
// Camera Collection
// =============================================================================

/** Authored POVs of the scene's cameras (scene-filtered), no matrices built yet. */
function collectCameraPOVs(
    module: ESEngineModule | null,
    registry: CppRegistry,
    width: number,
    height: number,
    world?: World,
    activeScenes?: Set<string>,
): CameraPOV[] {
    if (width === 0 || height === 0) return [];
    const cameraEntities = cameraEntitiesOf(module, registry);
    if (cameraEntities.length === 0) return [];

    const filtered = activeScenes && world
        ? cameraEntities.filter((e: number) => {
            const owner = world.tryGet(e as Entity, SceneOwner);
            if (!owner || owner.scene === '') return true;
            return activeScenes.has(owner.scene);
        })
        : cameraEntities;

    const out: CameraPOV[] = [];
    for (const e of filtered) {
        out.push(readCameraPOV(e, registry.getCamera(e), registry.getTransform(e)));
    }
    return out;
}

export function collectCameras(
    module: ESEngineModule | null,
    registry: CppRegistry,
    width: number,
    height: number,
    world?: World,
    activeScenes?: Set<string>,
    pool: CameraInfo[] = [],
): CameraInfo[] {
    const povs = collectCameraPOVs(module, registry, width, height, world, activeScenes);
    if (povs.length === 0) return [];
    const canvas = findCanvasData(module, registry);
    const cameras = povs.map((pov, i) => buildCameraInfo(pov, width, height, canvas, pool, i));
    cameras.sort((a, b) => a.priority - b.priority);
    return cameras;
}

const isFullFrame = (v: { x: number; y: number; z: number; w: number }): boolean =>
    v.x === 0 && v.y === 0 && v.z === 1 && v.w === 1;

// =============================================================================
// Editor View (dedicated editor camera — overrides scene cameras when active)
// =============================================================================

/**
 * Build a full-frame CameraInfo from the editor view, reusing the SAME VP math
 * primitives (ortho / invertTranslation / multiply) as scene cameras — only the
 * camera *configuration* differs (full-frame viewport, raw orthoSize, no canvas
 * design-resolution scaling). This is what makes the editor view a first-class
 * peer of scene cameras rather than a separate view-math implementation.
 */
export function editorCameraInfo(
    view: EditorViewData,
    width: number,
    height: number,
    pool: CameraInfo[],
): CameraInfo {
    // The editor view is just another POV (synthetic entity, full-frame).
    // null canvas → raw orthoSize (no design-resolution scaling) for predictable
    // world-zoom; UI layout gets the fixed design box separately (see uiLayoutRect).
    const pov: CameraPOV = {
        entity: EDITOR_VIEW_ENTITY,
        isActive: true,
        x: view.x,
        y: view.y,
        // Perspective needs the camera to stand somewhere: it is the distance that
        // makes content near or far, where orthographically nothing depends on z.
        z: view.perspective ? view.distance : 0,
        rotation: 0,
        projection: view.perspective ? ProjectionType.Perspective : ProjectionType.Orthographic,
        orthoSize: view.orthoSize,
        fov: view.fov,
        // A perspective projection divides by z, so near must be > 0 — the
        // orthographic path builds a symmetric [-far, far] box and ignores it.
        near: view.perspective ? 0.1 : 0,
        far: 100000,
        viewport: { x: 0, y: 0, z: 1, w: 1 },
        clearFlags: ClearFlags.ColorAndDepth,
        priority: 0,
        pixelPerfect: false, // editor navigation pans/zooms freely — no pixel snapping
        // The editor's own eye is not a game camera: it shows every layer, so a
        // culled scene camera never hides content from authoring.
        cullingMask: 0xFFFFFFFF,
    };
    return buildCameraInfo(pov, width, height, null, pool, 0);
}

/**
 * The cameras to render + sync this frame, as ONE shared decision (so what's
 * drawn and what screen<->world resolves to can't diverge):
 *  1. the editor view, if active (a single full-frame camera); else
 *  2. the camera director's resolved MAIN view (the active full-frame camera,
 *     or a view-target blend) at index 0, plus any sub-viewport overlay cameras.
 * `advance` ticks the director's blend; the early UICameraInfo sync peeks (false)
 * so it doesn't double-advance the same frame's blend.
 */
/**
 * The design-resolution fit: the project screen fit (ScreenScaling) when it opts in
 * (scaleMode ≥ 0), else the scene's UI Canvas, else null (raw orthoSize). The project
 * fit works WITHOUT a Canvas and, when set, is authoritative.
 *
 * The camera and UI layout both resolve their fit here — one screen, one answer. They
 * used to disagree: the camera preferred ScreenScaling while the editor's UI box read
 * the Canvas alone, so a project fit whose design resolution differed from the scene's
 * Canvas laid UI out in one box while authoring and another once it shipped.
 */
function resolveFitSource(app: App, canvas: CanvasScale | null): CanvasScale | null {
    if (app.hasResource(ScreenScaling)) {
        const s = app.getResource(ScreenScaling);
        if (s.scaleMode > SCREEN_FIT_OFF) {
            return {
                designResolution: { x: s.designWidth, y: s.designHeight },
                scaleMode: s.scaleMode,
                matchWidthOrHeight: s.matchWidthOrHeight,
            };
        }
    }
    return canvas;
}

function resolveCameras(
    app: App,
    module: ESEngineModule | null,
    cppRegistry: CppRegistry,
    width: number,
    height: number,
    world: World | undefined,
    activeScenes: Set<string> | undefined,
    pool: CameraInfo[],
    now: number,
    advance: boolean,
): CameraInfo[] {
    if (app.hasResource(EditorView)) {
        const view = app.getResource(EditorView);
        if (view.active && width > 0 && height > 0) {
            return [editorCameraInfo(view, width, height, pool)];
        }
    }

    const povs = collectCameraPOVs(module, cppRegistry, width, height, world, activeScenes);
    if (povs.length === 0) return [];
    const canvas = resolveFitSource(app, findCanvasData(module, cppRegistry, world, activeScenes));
    const fullFrame = povs.filter((p) => isFullFrame(p.viewport));
    const overlays = povs.filter((p) => !isFullFrame(p.viewport)).sort((a, b) => a.priority - b.priority);

    const out: CameraInfo[] = [];
    // The director resolves ONE main view from the full-frame candidates (active
    // camera + view-target blending); index 0 → it also drives screen<->world.
    if (fullFrame.length > 0 && app.hasResource(CameraDirector)) {
        const main = resolveMainPOV(app.getResource(CameraDirector), fullFrame, now, advance);
        if (main) out.push(buildCameraInfo(main, width, height, canvas, pool, out.length));
    } else {
        for (const p of fullFrame.slice().sort((a, b) => a.priority - b.priority)) {
            out.push(buildCameraInfo(p, width, height, canvas, pool, out.length));
        }
    }
    // Sub-viewport cameras render on top (minimaps, picture-in-picture).
    for (const p of overlays) {
        out.push(buildCameraInfo(p, width, height, canvas, pool, out.length));
    }
    return out;
}

// =============================================================================
// UICameraInfo Sync
// =============================================================================

function syncUICameraInfo(
    app: App,
    module: ESEngineModule | null,
    cppRegistry: CppRegistry,
    width: number,
    height: number,
    cameras?: CameraInfo[],
    pool?: CameraInfo[],
): void {
    if (!cameras) {
        cameras = collectCameras(module, cppRegistry, width, height, undefined, undefined, pool);
    }
    const uiCam = app.getResource(UICameraInfo);
    if (cameras.length > 0) {
        const cam = cameras[0];
        const vr = cam.viewportRect;
        uiCam.viewProjection.set(cam.viewProjection);
        uiCam.vpX = Math.round(vr.x * width);
        uiCam.vpY = Math.round((1 - vr.y - vr.h) * height);
        uiCam.vpW = Math.round(vr.w * width);
        uiCam.vpH = Math.round(vr.h * height);
        uiCam.screenW = width;
        uiCam.screenH = height;
        // The box UI lays out within. Scene cameras carry design-scaled extents;
        // the free-zoom editor view gets the fixed design box from the fit so UI
        // doesn't reflow with the zoom (see uiLayoutRect). In the editor a selected
        // device preset overrides the box aspect (uiPreviewAspect) so UI previews how it
        // adapts on that device; 0 (default / shipped games) keeps the design aspect.
        // The fit is resolved the SAME way the camera resolves it, so edit mode, play
        // and a shipped build lay UI out in one box.
        const previewAspect = app.hasResource(EditorView) ? app.getResource(EditorView).uiPreviewAspect : 0;
        const fit = resolveFitSource(app, findCanvasData(module, cppRegistry));
        const rect = uiLayoutRect(cam, fit, width, height, previewAspect);
        uiCam.worldLeft = rect.left;
        uiCam.worldRight = rect.right;
        uiCam.worldBottom = rect.bottom;
        uiCam.worldTop = rect.top;
        uiCam.valid = true;
    } else {
        uiCam.valid = false;
    }
}

// =============================================================================
// Camera Plugin
// =============================================================================

export function cameraPlugin(
    getViewportSize?: () => { width: number; height: number },
): Plugin {
    return {
        name: 'camera',
        build(app: App) {
            // Null on the native core: the two engine queries this plugin makes are
            // answered by the registry there (see canvasEntityOf / cameraEntitiesOf),
            // and the frame itself goes through the Renderer's backend.
            const module = app.wasmModule;
            const cppRegistry = app.world.getCppRegistry()!;
            const pipeline = app.pipeline!;
            const startTime = platformNow();
            // Per-App scratch pool for collectCameras — one per plugin instance,
            // so two Apps running at once never clobber each other's CameraInfo.
            const cameraInfoPool: CameraInfo[] = [];
            // Last size pushed to the renderer — resize only when it actually
            // changes (the C++ viewport state persists across frames), so a stable
            // viewport pays no per-frame WASM crossing. Mirrors RenderPipeline.render.
            let lastResizeW = 0;
            let lastResizeH = 0;

            // The editor view is inactive by default — shipped games never touch
            // it; the editor activates it in edit mode (see desktop EngineHost).
            app.insertResource(EditorView, { ...DEFAULT_EDITOR_VIEW });
            // The camera director: by default it just tracks the active camera;
            // games call setViewTarget(app, entity, {time, curve}) to blend, or
            // shakeCamera(app, {...}) to shake. Fresh state (own arrays) per App.
            app.insertResource(CameraDirector, createDirectorState());

            const viewport = getViewportSize ?? (() => {
                const dpr = platformDevicePixelRatio();
                return {
                    width: window.innerWidth * dpr,
                    height: window.innerHeight * dpr,
                };
            });

            const uiCameraSyncSystem: SystemDef = {
                _id: Symbol('UICameraSyncSystem'),
                _name: 'UICameraSyncSystem',
                _params: [],
                _fn: () => {
                    const { width, height } = viewport();
                    const now = (platformNow() - startTime) / 1000;
                    // Peek (advance=false): this early sync must not tick the director's
                    // blend — the render system (end of frame) is the authoritative tick.
                    const cameras = resolveCameras(app, module, cppRegistry, width, height, undefined, undefined, cameraInfoPool, now, false);
                    syncUICameraInfo(app, module, cppRegistry, width, height, cameras);
                },
            };

            const renderSystem: SystemDef = {
                _id: Symbol('RenderSystem'),
                _name: 'RenderSystem',
                _params: [],
                _fn: () => {
                    const { width, height } = viewport();
                    if (width === 0 || height === 0) return;
                    const canvasEntity = canvasEntityOf(module, cppRegistry);
                    let clearColor: { x: number; y: number; z: number; w: number } | undefined;
                    if (canvasEntity >= 0) {
                        const canvas = cppRegistry.getCanvas(canvasEntity);
                        clearColor = canvas.backgroundColor;
                    }
                    const elapsed = (platformNow() - startTime) / 1000;

                    if (width !== lastResizeW || height !== lastResizeH) {
                        app.measureFrameScope('render.resize', () => Renderer.resize(width, height));
                        lastResizeW = width;
                        lastResizeH = height;
                    }

                    let activeScenes: Set<string> | undefined;
                    if (app.hasResource(SceneManager)) {
                        const mgr = app.getResource(SceneManager);
                        const running = mgr.getActiveScenes();
                        if (running.length > 0) {
                            activeScenes = new Set(running);
                        }
                    }

                    pipeline.setActiveScenes(activeScenes ?? null);
                    // Authoritative tick (advance=true): ticks the director's blend.
                    const cameras = app.measureFrameScope('render.resolveCameras', () =>
                        resolveCameras(app, module, cppRegistry, width, height, app.world, activeScenes, cameraInfoPool, elapsed, true));

                    app.measureFrameScope('render.uiCameraSync', () =>
                        syncUICameraInfo(app, module, cppRegistry, width, height, cameras));

                    // The JS-side dispatch of the frame — pairs with the engine's
                    // cpp.render.* scopes (submit/finalize) and gpu.* to separate the
                    // orchestration cost from the actual draw-list + GPU cost.
                    app.measureFrameScope('render.submit', () => {
                        if (cameras.length === 0) {
                            pipeline.render({
                                registry: { _cpp: cppRegistry },
                                viewProjection: IDENTITY,
                                width, height, elapsed,
                                clearColor,
                            });
                        } else {
                            pipeline.beginFrame(elapsed);
                            pipeline.beginScreenCapture();
                            for (const cam of cameras) {
                                const vp = cam.viewportRect;
                                const px = Math.round(vp.x * width);
                                const py = Math.round((1 - vp.y - vp.h) * height);
                                const pw = Math.round(vp.w * width);
                                const ph = Math.round(vp.h * height);
                                pipeline.renderCamera({
                                    registry: { _cpp: cppRegistry },
                                    viewProjection: cam.viewProjection,
                                    viewportPixels: { x: px, y: py, w: pw, h: ph },
                                    clearFlags: cam.clearFlags,
                                    elapsed,
                                    cameraEntity: cam.entity,
                                    clearColor,
                                    cullingMask: cam.cullingMask,
                                });
                            }
                            pipeline.endScreenCapture();
                            Renderer.setViewport(0, 0, width, height);
                        }
                    });
                },
            };

            // Per-camera follow (Cinemachine vcam Body): damp FollowTarget cameras
            // toward their target each frame, BEFORE camera collection, so the
            // director blends already-followed POVs. Play mode only (gameplay).
            app.addSystemToSchedule(Schedule.Update, defineSystem(
                [Res(Time)],
                (time: TimeData) => followUpdate(app.world, time.delta),
                { name: 'CameraFollowSystem' },
            ), { runIf: playModeOnly });

            app.addSystemToSchedule(Schedule.First, uiCameraSyncSystem);
            app.addSystemToSchedule(Schedule.Last, renderSystem);
        },
    };
}

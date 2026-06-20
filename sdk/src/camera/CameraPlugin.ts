/**
 * @file    CameraPlugin.ts
 * @brief   Camera system plugin — collects cameras, computes view-projection, drives rendering
 */

import type { App, Plugin } from '../app';
import type { SystemDef } from '../system';
import { Schedule } from '../system';
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { World } from '../world';
import type { Entity } from '../types';
import { UICameraInfo } from '../ui/UICameraInfo';
import { ProjectionType, ScaleMode, SceneOwner, ClearFlags } from '../component';
import { EditorView, DEFAULT_EDITOR_VIEW, type EditorViewData } from './EditorView';
import { CameraDirector, DEFAULT_DIRECTOR, resolveMainPOV } from './CameraDirector';
import { RenderPipeline } from '../renderPipeline';
import { Renderer } from '../renderer';
import { platformNow } from '../platform';
import { SceneManager } from '../sceneManager';
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
    };
    pool.push(info);
    return info;
}

// =============================================================================
// Canvas / Ortho Helpers
// =============================================================================

function findCanvasData(module: ESEngineModule, registry: CppRegistry) {
    const entity = module.registry_getCanvasEntity(registry);
    if (entity < 0) return null;
    return registry.getCanvas(entity);
}

function computeEffectiveOrthoSize(
    baseOrthoSize: number,
    designAspect: number,
    actualAspect: number,
    scaleMode: number,
    matchWidthOrHeight: number,
): number {
    const orthoForWidth = baseOrthoSize * designAspect / actualAspect;
    const orthoForHeight = baseOrthoSize;

    switch (scaleMode) {
        case ScaleMode.FixedWidth: return orthoForWidth;
        case ScaleMode.FixedHeight: return orthoForHeight;
        case ScaleMode.Expand: return Math.max(orthoForWidth, orthoForHeight);
        case ScaleMode.Shrink: return Math.min(orthoForWidth, orthoForHeight);
        case ScaleMode.Match: {
            const t = matchWidthOrHeight;
            return Math.pow(orthoForWidth, 1 - t) * Math.pow(orthoForHeight, t);
        }
        default: return orthoForHeight;
    }
}

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
    canvas: ReturnType<typeof findCanvasData>,
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

    const view = invertViewZ(pov.x, pov.y, pov.z, Math.cos(pov.rotation), Math.sin(pov.rotation));
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
    cam.cameraX = pov.x;
    cam.cameraY = pov.y;
    return cam;
}

// =============================================================================
// Camera Collection
// =============================================================================

/** Authored POVs of the scene's cameras (scene-filtered), no matrices built yet. */
function collectCameraPOVs(
    module: ESEngineModule,
    registry: CppRegistry,
    width: number,
    height: number,
    world?: World,
    activeScenes?: Set<string>,
): CameraPOV[] {
    if (width === 0 || height === 0) return [];
    const cameraEntities = module.registry_getCameraEntities(registry);
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
    module: ESEngineModule,
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
    // The editor view is just another POV (synthetic entity -1, full-frame).
    // null canvas → raw orthoSize (no design-resolution scaling) for predictable zoom.
    const pov: CameraPOV = {
        entity: -1,
        isActive: true,
        x: view.x,
        y: view.y,
        z: 0,
        rotation: 0,
        projection: ProjectionType.Orthographic,
        orthoSize: view.orthoSize,
        fov: 0,
        near: 0,
        far: 100000,
        viewport: { x: 0, y: 0, z: 1, w: 1 },
        clearFlags: ClearFlags.ColorAndDepth,
        priority: 0,
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
function resolveCameras(
    app: App,
    module: ESEngineModule,
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
    const canvas = findCanvasData(module, cppRegistry);
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
    module: ESEngineModule,
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
        uiCam.worldLeft = cam.cameraX - cam.halfW;
        uiCam.worldRight = cam.cameraX + cam.halfW;
        uiCam.worldBottom = cam.cameraY - cam.halfH;
        uiCam.worldTop = cam.cameraY + cam.halfH;
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
            const module = app.wasmModule!;
            const cppRegistry = app.world.getCppRegistry()!;
            const pipeline = app.pipeline!;
            const startTime = platformNow();
            // Per-App scratch pool for collectCameras — one per plugin instance,
            // so two Apps running at once never clobber each other's CameraInfo.
            const cameraInfoPool: CameraInfo[] = [];

            // The editor view is inactive by default — shipped games never touch
            // it; the editor activates it in edit mode (see desktop EngineHost).
            app.insertResource(EditorView, { ...DEFAULT_EDITOR_VIEW });
            // The camera director: by default it just tracks the active camera;
            // games call setViewTarget(app, entity, {time, curve}) to blend.
            app.insertResource(CameraDirector, { ...DEFAULT_DIRECTOR });

            const viewport = getViewportSize ?? (() => {
                const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
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
                    const canvasEntity = module.registry_getCanvasEntity(cppRegistry);
                    if (canvasEntity >= 0) {
                        const canvas = cppRegistry.getCanvas(canvasEntity);
                        const bg = canvas.backgroundColor;
                        Renderer.setClearColor(bg.x, bg.y, bg.z, bg.w);
                    }
                    const elapsed = (platformNow() - startTime) / 1000;

                    Renderer.resize(width, height);

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
                    const cameras = resolveCameras(app, module, cppRegistry, width, height, app.world, activeScenes, cameraInfoPool, elapsed, true);

                    syncUICameraInfo(app, module, cppRegistry, width, height, cameras);

                    if (cameras.length === 0) {
                        pipeline.render({
                            registry: { _cpp: cppRegistry },
                            viewProjection: IDENTITY,
                            width, height, elapsed,
                        });
                    } else {
                        pipeline.beginFrame();
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
                            });
                        }
                        pipeline.endScreenCapture();
                        Renderer.setViewport(0, 0, width, height);
                    }
                },
            };

            app.addSystemToSchedule(Schedule.First, uiCameraSyncSystem);
            app.addSystemToSchedule(Schedule.Last, renderSystem);
        },
    };
}

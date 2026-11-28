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
import { FollowTarget } from './FollowTarget';
import { CameraBounds } from './CameraBounds';
import { CameraDeoccluder, CameraCollision } from './CameraDeoccluder';
import { PositionComposer } from './PositionComposer';
import { CameraTargetGroup, GroupFraming } from './CameraTargetGroup';
import { LookAtTarget } from './LookAtTarget';
import { CameraBrain, cameraRigUpdate } from './CameraRig';
import { applyCameraNoise } from './CameraNoise';
import { applyCameraImpulses, CameraImpulseSource } from './CameraImpulse';
import { StateDrivenCamera } from './StateDrivenCamera';
import { CameraDolly } from './CameraDolly';
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { World } from '../ecs/world';
import type { Entity, Vec3 } from '../types';
import { UICameraInfo, type UICameraData } from '../ui/core/ui-camera-info';
import { CameraCommit, cameraCommitChanged, type CameraCommitData } from './CameraCommit';
import { CameraView, CameraViewAPI, PresentedCameraView, presentedCameraView } from './Camera';
import { ScreenLayout, screenLayoutRect, screenProjection } from '../ui/core/screen-layout';
import { ScreenOverlay } from '../ui/core/screen-overlay';
import { Camera, ProjectionType, SceneOwner, ClearFlags, Transform } from '../ecs/component';
import { canvasRootEntities } from '../ui/core/canvas-roots';
import { uiLayoutRect, computeEffectiveOrthoSize, EDITOR_VIEW_ENTITY, type CanvasScale } from './uiLayoutRect';
import { EditorViewLighting, DEFAULT_EDITOR_VIEW_LIGHTING, pushEditorViewLighting } from './EditorViewLighting';
import { EditorViewShading, DEFAULT_EDITOR_VIEW_SHADING, pushEditorViewShading, pushEditorViewWeights, pushEditorViewSelection } from './EditorViewShading';
import type { ViewShading } from '../render/renderer';
import { EditorView, DEFAULT_EDITOR_VIEW, editorViewStandoff, editorViewEye, editorViewClipFar, editorViewClipNear, type EditorViewData } from './EditorView';
import { ScreenScaling, SCREEN_FIT_OFF } from './ScreenScaling';
import { viewportPixels } from './presentPlan';
import { CameraDirector, CameraEvent, createDirectorState, pickActive, resolveMainPOV, type CameraDirectorState, type CameraEventPayload } from './CameraDirector';
import { EventWriter, type EventWriterInstance } from '../ecs/event';
import { Input } from '../input/input';
import { pendingShaders } from '../render/shaderWarmup';
import { renderTargetSize } from '../render/renderTexture';
import { cameraClearColor } from './cameraClear';
import { Renderer } from '../render/renderer';
import type { RenderPipeline, Viewport } from '../render/renderPipeline';
import { xrPresentation, placeEye, headingOf, sharedEyeView, type XRPresentationState } from '../xr/xrPresentation';
import { XRController, XRHead, syncXRPoses } from '../xr/xrComponents';
import { worldUnitsPerMeter } from '../ecs/worldUnits';
import { followRenderOrigin, pushRenderOrigin, renderOrigin } from '../render/renderOrigin';
import { platformDevicePixelRatio } from '../platform';
import { SceneManager } from '../scene/sceneManager';
import {
    ortho, perspective, invertViewZ, invertViewOrbit, invertViewQuat, multiply,
    frustumCornersWorld, IDENTITY,
} from '../math/mat4';

// =============================================================================
// Camera Info
// =============================================================================

interface CameraInfo {
    entity: number;
    viewProjection: Float32Array;
    /** The same view-projection for the render origin (render/renderOrigin.ts): what the renderer is begun with. Equal to `viewProjection` while the origin is zero. */
    renderViewProjection: Float32Array;
    renderOrigin: Vec3;
    viewport: Viewport;
    clearFlags: number;
    priority: number;
    halfW: number;
    halfH: number;
    cameraX: number;
    cameraY: number;
    cullingMask: number;
    /** Offscreen target this camera draws into; 0 = the screen. */
    renderTarget: number;
}

function acquireCameraInfo(pool: CameraInfo[], index: number): CameraInfo {
    if (index < pool.length) {
        return pool[index];
    }
    const info: CameraInfo = {
        entity: 0,
        viewProjection: new Float32Array(16),
        renderViewProjection: new Float32Array(16),
        renderOrigin: { x: 0, y: 0, z: 0 },
        viewport: { x: 0, y: 0, w: 0, h: 0 },
        clearFlags: 0,
        priority: 0,
        halfW: 0,
        halfH: 0,
        cameraX: 0,
        cameraY: 0,
        cullingMask: 0xFFFFFFFF,
        renderTarget: 0,
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
        const roots = canvasRootEntities(all, entity => {
            if (!registry.hasParent(entity)) return null;
            const parent = registry.getParent(entity).entity;
            return registry.valid(parent) ? parent : null;
        });
        if (world && activeScenes) {
            for (const e of roots) {
                const owner = world.tryGet(e as Entity, SceneOwner);
                if (!owner || owner.scene === '' || activeScenes.has(owner.scene)) return e;
            }
        }
        return roots[0] ?? -1;
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

/**
 * The frame's Canvas: which entity it is, its data, and the fit a frame resolves from it. Resolved ONCE where a frame's
 * cameras are, and handed to everything that reads it - the cameras' fit, the screen and UI layout boxes, the clear
 * colour - so they cannot name different Canvases. Nothing else in a frame looks the Canvas up.
 */
export interface FrameCanvas {
    readonly entity: number;
    readonly data: ReturnType<CppRegistry['getCanvas']> | null;
    readonly fit: CanvasScale | null;
}

/** @internal Exported for the test that holds it to the running scene. */
export function resolveFrameCanvas(
    app: App,
    module: ESEngineModule | null,
    registry: CppRegistry,
    world?: World,
    activeScenes?: Set<string>,
): FrameCanvas {
    const entity = canvasEntityOf(module, registry, world, activeScenes);
    const data = entity < 0 ? null : registry.getCanvas(entity);
    return { entity, data, fit: resolveFitSource(app, data) };
}

/** The scenes running now, or undefined when no scene manager says: what scopes a frame's cameras and its Canvas. */
function runningScenes(app: App): Set<string> | undefined {
    if (!app.hasResource(SceneManager)) return undefined;
    const running = app.getResource(SceneManager).getActiveScenes();
    return running.length > 0 ? new Set(running) : undefined;
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
    /**
     * The camera's full orientation, when it is turned off the 2D plane. Absent
     * for a rotation purely about Z — which every 2D camera is, and which the
     * scalar above already says — so turning this on cannot move a 2D scene.
     */
    tilt?: { x: number; y: number; z: number; w: number };
    /** Orbit in radians about the focus (x, y, focusZ) — an eye that stands off
     *  the -Z axis. Absent (the 2D case) keeps the rotation-about-Z view exactly
     *  as it was; `z` is then the eye's own depth rather than a standoff. */
    orbit?: { yaw: number; pitch: number; focusZ: number };
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
    /** Offscreen target this camera draws into; 0 = the screen. */
    renderTarget: number;
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

/**
 * The Camera fields a POV is read from. Named as a shape rather than as one
 * registry's return type, because the editor reads the same fields off its own
 * projected World.
 *
 * @beta
 */
export interface CameraFields {
    isActive: boolean;
    projectionType: number;
    orthoSize: number;
    fov: number;
    nearPlane: number;
    farPlane: number;
    viewport: { x: number; y: number; z: number; w: number };
    clearFlags: number;
    priority: number;
    pixelPerfect: boolean;
    /** Absent on a core built before the field; that camera drew every layer. */
    cullingMask?: number;
    /** Absent on a core built before the field; that camera drew to the screen. */
    renderTarget?: number;
}

/**
 * The placement a POV is read from — see {@link CameraFields}. WORLD, because a
 * camera's view is its own transform inverted, and a camera parented to anything
 * (a rig, the player) sits where the hierarchy puts it.
 *
 * @beta
 */
export interface CameraTransformFields {
    worldPosition: { x: number; y: number; z: number };
    worldRotation: { x: number; y: number; z: number; w: number };
}

function readCameraPOV(
    entity: number,
    camera: CameraFields,
    transform: CameraTransformFields,
): CameraPOV {
    const q = transform.worldRotation;
    const p = transform.worldPosition;
    return {
        entity,
        isActive: camera.isActive,
        x: p.x,
        y: p.y,
        z: p.z,
        rotation: 2 * Math.atan2(q.z, q.w), // quaternion → Z angle (2D convention)
        // Kept whole only when it says something the Z angle cannot: a camera
        // that looks at 3D content from anywhere but straight down -Z.
        tilt: (q.x !== 0 || q.y !== 0) ? { x: q.x, y: q.y, z: q.z, w: q.w } : undefined,
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
        renderTarget: camera.renderTarget ?? 0,
    };
}

/**
 * Apply design-resolution ortho scaling only to full-screen scene cameras.
 * Sub-viewport and texture cameras keep their authored zoom; null `canvas`
 * preserves raw orthoSize for editor views. Rotation uses invertViewZ.
 */
export function buildCameraInfo(
    pov: CameraPOV,
    width: number,
    height: number,
    canvas: CanvasScale | null,
    pool: CameraInfo[],
    index: number,
): CameraInfo {
    // Projection and pixel snapping must use the same surface the render pass
    // uses; a portrait target on a landscape window otherwise stretches the view.
    const target = pov.renderTarget ? renderTargetSize(pov.renderTarget) : null;
    width = target?.width ?? width;
    height = target?.height ?? height;
    const viewport = viewportPixels({ x: pov.viewport.x, y: pov.viewport.y, w: pov.viewport.z, h: pov.viewport.w }, width, height);
    const aspect = Math.max(1, viewport.w) / Math.max(1, viewport.h);
    let projection: Float32Array;
    let halfW = 0;
    let halfH = 0;

    if (pov.projection === ProjectionType.Orthographic) {
        halfH = pov.orthoSize;
        if (canvas && (pov.renderTarget ?? 0) === 0 && isFullFrame(pov.viewport)) {
            // The fit adapts the camera's OWN size to the screen's aspect — it does
            // not replace it. orthoSize is the camera's half-height at the design
            // aspect, so it stays the zoom a script or a tween drives; it used to be
            // discarded for designResolution.y / 2 whenever a Canvas or the project
            // fit was active, and zooming did nothing. The UI box is the design's,
            // not the camera's (see uiLayoutRect), so a zoom does not reflow UI.
            const designAspect = canvas.designResolution.x / canvas.designResolution.y;
            halfH = computeEffectiveOrthoSize(
                pov.orthoSize, designAspect, aspect,
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
        const worldPerPixel = (2 * halfH) / Math.max(1, viewport.h);
        camX = snapToPixelGrid(pov.x, worldPerPixel);
        camY = snapToPixelGrid(pov.y, worldPerPixel);
    }

    // Three ways to say where the eye is, one view: an orbit turns around a focus
    // (editor navigation), a tilt is the camera's own transform inverted (a scene
    // camera on 3D content), and 2D is the rotation-about-Z, untouched.
    const view = pov.orbit
        ? invertViewOrbit(camX, camY, pov.orbit.focusZ, pov.orbit.yaw, pov.orbit.pitch, pov.z)
        : pov.tilt
            ? invertViewQuat(camX, camY, pov.z, pov.tilt.x, pov.tilt.y, pov.tilt.z, pov.tilt.w)
            : invertViewZ(camX, camY, pov.z, Math.cos(pov.rotation), Math.sin(pov.rotation));
    const cam = acquireCameraInfo(pool, index);
    cam.entity = pov.entity;
    cam.viewProjection.set(multiply(projection, view));
    const origin = renderOrigin();
    cam.renderOrigin.x = origin.x;
    cam.renderOrigin.y = origin.y;
    cam.renderOrigin.z = origin.z;
    if (origin.x === 0 && origin.y === 0 && origin.z === 0) {
        cam.renderViewProjection.set(cam.viewProjection);
    } else {
        // The same view with the eye measured from the origin; the projection is the same.
        const near = pov.orbit
            ? invertViewOrbit(camX - origin.x, camY - origin.y, pov.orbit.focusZ - origin.z, pov.orbit.yaw, pov.orbit.pitch, pov.z)
            : pov.tilt
                ? invertViewQuat(camX - origin.x, camY - origin.y, pov.z - origin.z, pov.tilt.x, pov.tilt.y, pov.tilt.z, pov.tilt.w)
                : invertViewZ(camX - origin.x, camY - origin.y, pov.z - origin.z, Math.cos(pov.rotation), Math.sin(pov.rotation));
        cam.renderViewProjection.set(multiply(projection, near));
    }
    cam.viewport = viewport;
    cam.clearFlags = pov.clearFlags;
    cam.priority = pov.priority;
    cam.halfW = halfW;
    cam.halfH = halfH;
    cam.cameraX = camX;
    cam.cameraY = camY;
    cam.cullingMask = pov.cullingMask;
    cam.renderTarget = pov.renderTarget;
    return cam;
}

const _frustumPool: CameraInfo[] = [];

/**
 * The eight world-space corners of what a camera sees — near face then far, in
 * the order {@link frustumCornersWorld} documents. Built through the same POV →
 * CameraInfo path a frame is, so it carries the projection, the tilt and the
 * design-resolution framing. @p width / @p height are the frame it renders into.
 *
 * @beta
 */
export function cameraFrustumCorners(
    camera: CameraFields,
    transform: CameraTransformFields,
    width: number,
    height: number,
    canvas: CanvasScale | null,
    result?: Float32Array,
): Float32Array {
    const pov = readCameraPOV(0, camera, transform);
    const info = buildCameraInfo(pov, width, height, canvas, _frustumPool, 0);
    return frustumCornersWorld(info.viewProjection, result);
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
        // Through the world when there is one: it reads the two out of the engine's memory, where the registry's getters
        // build each as a new object field by field, and this runs twice a frame for every camera.
        out.push(world
            ? readCameraPOV(e, world.get(e as Entity, Camera) as CameraFields, world.get(e as Entity, Transform) as CameraTransformFields)
            : readCameraPOV(e, registry.getCamera(e), registry.getTransform(e)));
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
    const canvas = findCanvasData(module, registry, world, activeScenes);
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
        // How far back the eye stands, which is what a perspective projection
        // needs and what an orbit swings around.
        z: editorViewStandoff(view),
        rotation: 0,
        // Always an orbit: at yaw = pitch = 0 invertViewOrbit IS the head-on 2D
        // view, so the editor has one way to stand rather than two.
        orbit: {
            yaw: (view.yaw ?? 0) * Math.PI / 180,
            pitch: (view.pitch ?? 0) * Math.PI / 180,
            focusZ: view.z ?? 0,
        },
        projection: view.perspective ? ProjectionType.Perspective : ProjectionType.Orthographic,
        orthoSize: view.orthoSize,
        fov: view.fov,
        near: editorViewClipNear(view),
        far: editorViewClipFar(view),
        viewport: { x: 0, y: 0, z: 1, w: 1 },
        clearFlags: ClearFlags.ColorAndDepth,
        priority: 0,
        pixelPerfect: false, // editor navigation pans/zooms freely — no pixel snapping
        // The editor's own eye is not a game camera: it shows every layer, so a
        // culled scene camera never hides content from authoring.
        cullingMask: 0xFFFFFFFF,
        renderTarget: 0,
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
    frameCanvas: FrameCanvas,
    pool: CameraInfo[],
    now: number,
    mode: 'peek' | 'tick' | 'redraw',
): CameraInfo[] {
    const advance = mode === 'tick';
    const followsOrigin = mode !== 'peek';
    if (app.hasResource(EditorView)) {
        const view = app.getResource(EditorView);
        if (view.active && width > 0 && height > 0) {
            if (followsOrigin) { const eye = editorViewEye(view); followRenderOrigin(eye.x, eye.y, eye.z); }
            return [editorCameraInfo(view, width, height, pool)];
        }
    }

    const povs = collectCameraPOVs(module, cppRegistry, width, height, world, activeScenes);
    if (povs.length === 0) return [];
    // Each camera's handheld drift, on the view it gives and not its Transform, before the director picks and blends: a blend
    // from a shaky camera to a still one settles. Play mode only, as the rest of the camera pipeline.
    if (world && playModeOnly()) {
        applyCameraNoise(world, povs, now);
        // Impulses fired somewhere, felt by each listening camera by its distance: on the drawn view, before the blend.
        applyCameraImpulses(world, povs, now);
    }
    const canvas = frameCanvas.fit;
    // A camera drawing into a texture is not a candidate for the screen: it does
    // not compete with the main view, and it renders BEFORE it, because what it
    // draws is usually what the main view is about to sample.
    const offscreen = povs.filter((p) => p.renderTarget !== 0).sort((a, b) => a.priority - b.priority);
    const onScreen = povs.filter((p) => p.renderTarget === 0);
    const { fullFrame, overlays } = splitOnScreenCameras(onScreen);
    // Resolve the presented view before anchoring the frame, including cuts, blends and shakes.
    let mainViews = fullFrame;
    if (fullFrame.length > 0 && app.hasResource(CameraDirector)) {
        const main = resolveMainPOV(app.getResource(CameraDirector), fullFrame, now, advance);
        mainViews = main ? [main] : [];
    } else {
        fullFrame.sort((a, b) => a.priority - b.priority);
    }
    if (followsOrigin) {
        const eye = mainViews[0] ?? overlays[0];
        if (eye) followRenderOrigin(eye.x, eye.y, eye.z);
    }
    const out: CameraInfo[] = [];
    for (const p of offscreen) out.push(buildCameraInfo(p, width, height, canvas, pool, out.length));
    for (const p of mainViews) out.push(buildCameraInfo(p, width, height, canvas, pool, out.length));
    // Sub-viewport cameras render on top (minimaps, picture-in-picture).
    for (const p of overlays) {
        out.push(buildCameraInfo(p, width, height, canvas, pool, out.length));
    }
    return out;
}

/**
 * Where the editor's view measures parallax from, or null when the drawing camera should (a game, or play mode).
 * Parallax is the GAME camera's effect: measured from the editor's own eye, layers slid as the view panned or
 * zoomed and stood still while the game camera moved. With the preview on, the anchor is the scene camera the
 * game would open on (the active one, then the highest priority, as the director picks at rest); with it off, or
 * with no camera in the scene, it is the world origin, where every layer sits as authored.
 */
export function editorParallaxAnchor(
    app: App,
    module: ESEngineModule | null,
    cppRegistry: CppRegistry,
    width: number,
    height: number,
    world: World | undefined,
    activeScenes: Set<string> | undefined,
): { x: number; y: number } | null {
    if (!app.hasResource(EditorView)) return null;
    const view = app.getResource(EditorView);
    if (!view.active) return null;
    if (!view.parallaxPreview) return { x: 0, y: 0 };
    const onScreen = collectCameraPOVs(module, cppRegistry, width, height, world, activeScenes)
        .filter((p) => p.renderTarget === 0);
    const { fullFrame } = splitOnScreenCameras(onScreen);
    if (fullFrame.length === 0) return { x: 0, y: 0 };
    const main = pickActive(fullFrame);
    return { x: main.x, y: main.y };
}

// =============================================================================
// UICameraInfo Sync
// =============================================================================

/**
 * The aspect the design box is fitted to, when it is NOT the surface's — the
 * editor's design view lays UI out for the DEVICE it simulates, not the panel
 * showing it. Zero is every shipped frame. Mirrors uiLayoutRect's editor branch
 * from the same inputs, so the design frame and the layout cannot disagree.
 */
function simulatedScreenAspect(app: App, fit: CanvasScale | null): number {
    if (!fit || !app.hasResource(EditorView)) return 0;
    const view = app.getResource(EditorView);
    if (!view.active) return 0;
    return view.uiPreviewAspect > 0
        ? view.uiPreviewAspect
        : fit.designResolution.x / fit.designResolution.y;
}

/**
 * The screen domain, published from the fit and the surface and from NOTHING
 * else — `screenLayoutRect` has no parameter a camera could reach. Unconditional,
 * including with no camera at all: a HUD is not something a camera grants.
 */
function publishScreenLayout(app: App, fit: CanvasScale | null, width: number, height: number): void {
    if (!app.hasResource(ScreenLayout)) return;
    const aspect = simulatedScreenAspect(app, fit);
    Object.assign(
        app.getResource(ScreenLayout),
        aspect > 0
            ? screenLayoutRect(fit, height * aspect, height)
            : screenLayoutRect(fit, width, height),
    );
}

/**
 * Publish the camera this frame was drawn from, as a copy.
 *
 * After the submit, never from the early peek: the value names a picture, and a
 * peek draws nothing. Copied because UICameraInfo's array is rewritten in place,
 * so a view onto it would change under a reader mid-gizmo.
 */
function commitCamera(
    app: App, cam: CameraInfo | null, uiCam: UICameraData, anchor: CameraCommitData['parallaxAnchor'],
): void {
    const commit = app.getResource(CameraCommit);
    if (!cam) {
        if (commit.valid) {
            commit.valid = false;
            cameraCommitChanged(commit);
        }
        return;
    }
    const rebasedMoved = copyRebasedProjection(commit, cam);
    const parallaxMoved = commit.parallaxAnchor?.x !== anchor?.x || commit.parallaxAnchor?.y !== anchor?.y;
    const cullingMask = cam.cullingMask >>> 0;
    const moved = !commit.valid || rebasedMoved || parallaxMoved
        || commit.cullingMask !== cullingMask
        || commit.vpX !== uiCam.vpX || commit.vpY !== uiCam.vpY
        || commit.vpW !== uiCam.vpW || commit.vpH !== uiCam.vpH
        || !sameMatrix(commit.viewProjection, cam.viewProjection);
    commit.viewProjection.set(cam.viewProjection);
    commit.cullingMask = cullingMask;
    if (parallaxMoved) commit.parallaxAnchor = anchor;
    commit.vpX = uiCam.vpX;
    commit.vpY = uiCam.vpY;
    commit.vpW = uiCam.vpW;
    commit.vpH = uiCam.vpH;
    commit.revision = uiCam.revision;
    commit.valid = true;
    if (moved) cameraCommitChanged(commit);
}

/** Exact: the question is whether the projection moved, not whether two cameras
 *  are close enough to look alike. */
function sameMatrix(a: Float32Array, b: Float32Array): boolean {
    for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
    return true;
}

function parallaxCenterFor(anchor: CameraCommitData['parallaxAnchor'], origin: CameraInfo['renderOrigin']) {
    return anchor && { x: anchor.x - origin.x, y: anchor.y - origin.y };
}

/** Publish the relative matrix with the exact origin it was built against. */
function copyRebasedProjection(target: Pick<CameraCommitData, 'rebasedProjection'>, cam: CameraInfo): boolean {
    const { x, y, z } = cam.renderOrigin;
    const previous = target.rebasedProjection;
    if (x === 0 && y === 0 && z === 0) {
        target.rebasedProjection = undefined;
        return previous !== undefined;
    }
    const next = previous ?? { origin: { x, y, z }, viewProjection: new Float32Array(16) };
    const moved = !previous || next.origin.x !== x || next.origin.y !== y || next.origin.z !== z
        || !sameMatrix(next.viewProjection, cam.renderViewProjection);
    if (moved) {
        next.origin.x = x;
        next.origin.y = y;
        next.origin.z = z;
        next.viewProjection.set(cam.renderViewProjection);
        target.rebasedProjection = next;
    }
    return moved;
}

// Texture passes run first, but only a screen camera can describe where a
// pointer lands or what the composited screen was drawn through.
function primaryScreenCamera(cameras: CameraInfo[]): CameraInfo | null {
    return cameras.find(cam => cam.renderTarget === 0 && hasViewportPixels(cam)) ?? null;
}

function hasViewportPixels(cam: CameraInfo): boolean {
    return cam.viewport.w > 0 && cam.viewport.h > 0;
}

function cameraPassTarget(cam: CameraInfo, screenTarget = 0): number | null {
    if (!hasViewportPixels(cam)) return null;
    if (cam.renderTarget === 0) return screenTarget;
    return renderTargetSize(cam.renderTarget) ? cam.renderTarget : null;
}

function syncUICameraInfo(app: App, frameCanvas: FrameCanvas, width: number, height: number, cameras: CameraInfo[]): void {
    publishScreenLayout(app, frameCanvas.fit, width, height);
    const uiCam = app.getResource(UICameraInfo);
    const cam = primaryScreenCamera(cameras);
    if (cam) {
        uiCam.viewProjection.set(cam.viewProjection);
        copyRebasedProjection(uiCam, cam);
        // In the same statement group as the write it names: a revision published
        // apart from the matrix is a reader's chance to see one without the other.
        uiCam.revision++;
        const box = cam.viewport;
        // ...and then where the image actually lands inside it, which is the same
        // rect only while the present does not letterbox. screenToWorld maps a
        // point through THIS, so it has to be the picture's rect, not the camera's.
        const policy = app.hasResource(ScreenScaling)
            ? app.getResource(ScreenScaling).renderPolicy
            : undefined;
        const shown = app.pipeline?.cameraPresentPlan(box, 2 * cam.halfH, policy);
        uiCam.vpX = box.x + (shown?.x ?? 0);
        uiCam.vpY = box.y + (shown?.y ?? 0);
        uiCam.vpW = shown?.width ?? box.w;
        uiCam.vpH = shown?.height ?? box.h;
        uiCam.screenW = width;
        uiCam.screenH = height;
        // The box UI lays out within, from the fit the camera was built from (the frame's Canvas). The editor's free-zoom
        // view gets the fixed design box so UI doesn't reflow with the zoom (see uiLayoutRect), and a selected device
        // preset overrides its aspect (uiPreviewAspect; 0 in a shipped game keeps the design aspect).
        const previewAspect = app.hasResource(EditorView) ? app.getResource(EditorView).uiPreviewAspect : 0;
        const rect = uiLayoutRect(cam, frameCanvas.fit, width, height, previewAspect);
        uiCam.worldLeft = rect.left;
        uiCam.worldRight = rect.right;
        uiCam.worldBottom = rect.bottom;
        uiCam.worldTop = rect.top;
        uiCam.valid = true;
    } else {
        uiCam.valid = false;
        uiCam.revision++;
    }
    publishScreenOverlay(app, width, height, uiCam, cameras);
}

/**
 * How the screen domain reaches the framebuffer this frame: {@link
 * screenProjection} over the whole surface, which is every shipped frame.
 *
 * The editor's design VIEW is the one exception: there the screen box is shown
 * inside the scene so it can be zoomed while it is authored.
 */
function publishScreenOverlay(
    app: App,
    width: number,
    height: number,
    uiCam: UICameraData,
    cameras: CameraInfo[],
): void {
    if (!app.hasResource(ScreenOverlay)) return;
    const overlay = app.getResource(ScreenOverlay);
    overlay.surfaceW = width;
    overlay.surfaceH = height;
    // A layer any camera shows, this frame shows. `Camera.cullingMask` is a
    // statement about layers rather than about geometry, so it survives the
    // screen leaving the cameras' passes.
    let mask = 0;
    let hasScreenCamera = false;
    for (const cam of cameras) {
        if (cam.renderTarget !== 0) continue;
        hasScreenCamera = true;
        mask |= cam.cullingMask ?? 0xFFFFFFFF;
    }
    overlay.layerMask = (hasScreenCamera ? mask : 0xFFFFFFFF) >>> 0;
    const primary = primaryScreenCamera(cameras);

    if (primary?.entity === EDITOR_VIEW_ENTITY && app.hasResource(EditorView) && app.getResource(EditorView).screenUi === false) {
        // A still of the world from the editor's eye: the screen's UI is no part of it (EditorView.screenUi).
        overlay.active = false;
        return;
    }
    if (uiCam.valid && primary?.entity === EDITOR_VIEW_ENTITY) {
        overlay.projection.set(uiCam.viewProjection);
        overlay.vpX = uiCam.vpX;
        overlay.vpY = uiCam.vpY;
        overlay.vpW = uiCam.vpW;
        overlay.vpH = uiCam.vpH;
        overlay.active = true;
        return;
    }

    const screen = app.hasResource(ScreenLayout) ? app.getResource(ScreenLayout) : null;
    if (!screen?.valid) {
        overlay.active = false;
        return;
    }
    screenProjection(screen, overlay.projection, overlay.perspective);
    overlay.vpX = 0;
    overlay.vpY = 0;
    overlay.vpW = width;
    overlay.vpH = height;
    overlay.active = true;
}

/**
 * Draws `rig` through each eye of a headset: the rig camera's position and heading, then the eye's own pose and the headset's
 * projection, into the eye's rectangle of the session's framebuffer. The rig's clip planes are handed to the session for the
 * next frame's projections, so the depth the headset composites with is the scene's.
 */
function drawEyes(app: App, pipeline: RenderPipeline, xr: XRPresentationState, rig: CameraInfo, registry: CppRegistry,
    elapsed: number, clearColor: { x: number; y: number; z: number; w: number } | undefined): void {
    // Named for the controllers and the head, which are placed through the same rig next frame.
    xr.rigEntity = rig.entity;
    const t = app.world.tryGet(rig.entity as Entity, Transform) as CameraTransformFields | null;
    const camera = app.world.tryGet(rig.entity as Entity, Camera) as CameraFields | null;
    if (camera) {
        xr.wantNear = camera.nearPlane > 0 ? camera.nearPlane : xr.wantNear;
        xr.wantFar = camera.farPlane > xr.wantNear ? camera.farPlane : xr.wantFar;
    }
    const position = t?.worldPosition ?? { x: rig.cameraX, y: rig.cameraY, z: 0 };
    const heading = t ? headingOf(t.worldRotation) : 0;
    const unitsPerMeter = worldUnitsPerMeter();
    const origin = renderOrigin();
    // One shadow plan for both eyes: the view that sees what either sees. Per eye, the second's cascades are the first's stale
    // ones and the atlas is drawn twice a frame and kept by neither.
    const shared = sharedEyeView({ position, heading }, xr.views, unitsPerMeter, origin);
    if (shared) Renderer.setShadowView(shared);
    // And one collect: the first eye culls and collects for the view both share, the others draw that list from their own.
    if (shared) Renderer.setCollectView(shared);
    for (let i = 0; i < xr.views.length; i++) {
        const eye = xr.views[i]!;
        // Each eye its own history: one shared, a temporal pass blends the left eye's picture into the right's.
        Renderer.setTemporalView(i + 1);
        const placed = placeEye({ position, heading }, eye, unitsPerMeter, origin);
        pipeline.renderCamera({
            registry: { _cpp: registry },
            viewProjection: placed.viewProjection,
            renderViewProjection: placed.renderViewProjection,
            renderOrigin: origin,
            viewportPixels: eye.viewport,
            clearFlags: rig.clearFlags,
            elapsed,
            cameraEntity: rig.entity,
            clearColor: cameraClearColor(rig.entity as Entity, clearColor),
            cullingMask: rig.cullingMask,
            renderTarget: 0,
            replay: i > 0 && shared !== null,
        });
    }
    // The cameras after the eyes (into textures) plan for their own views, and are their targets' only view.
    Renderer.setTemporalView(0);
    if (shared) { Renderer.setShadowView(null); Renderer.setCollectView(null); }
}

/**
 * Which on-screen cameras compete to be the main view and which are laid over it. A full-frame camera that does not clear colour is drawn over
 * what another one drew (a UI camera over the world's): it is a layer on the main view, not a candidate to be it. With nothing else to lay it
 * over, it is the main view. Sub-viewport cameras are layers too; the layers are in priority order.
 * @internal
 */
export function splitOnScreenCameras(onScreen: CameraPOV[]): { fullFrame: CameraPOV[]; overlays: CameraPOV[] } {
    const clearsColour = (p: CameraPOV): boolean => (p.clearFlags & ClearFlags.Color) !== 0;
    const all = onScreen.filter((p) => isFullFrame(p.viewport));
    const fullFrame = all.some(clearsColour) ? all.filter(clearsColour) : all;
    const overlays = onScreen.filter((p) => !fullFrame.includes(p)).sort((a, b) => a.priority - b.priority);
    return { fullFrame, overlays };
}

// =============================================================================
// Camera Plugin
// =============================================================================

export function cameraPlugin(
    getViewportSize?: () => { width: number; height: number },
): Plugin {
    return {
        name: 'camera',
        profileDomain: 'render',
        build(app: App) {
            // Null on the native core: the two engine queries this plugin makes are
            // answered by the registry there (see canvasEntityOf / cameraEntitiesOf),
            // and the frame itself goes through the Renderer's backend.
            const module = app.wasmModule;
            const cppRegistry = app.world.getCppRegistry()!;
            const pipeline = app.pipeline!;
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
            // Its lighting is the view's too: untouched, the scene renders by its own.
            app.insertResource(EditorViewLighting, { ...DEFAULT_EDITOR_VIEW_LIGHTING });
            let lastViewLighting = '';
            // And its shading: clay or albedo for the eye alone, shaded for everything else.
            app.insertResource(EditorViewShading, { ...DEFAULT_EDITOR_VIEW_SHADING });
            let lastViewShading: ViewShading | null = null;
            let lastViewWeights = '';
            let lastViewSelection = '';
            // Where the engine measures parallax from: '' is the drawing camera, as a fresh engine starts.
            let lastParallaxAnchor = '';
            // The camera director: by default it just tracks the active camera;
            // games call setViewTarget(app, entity, {time, curve}) to blend, or
            // shakeCamera(app, {...}) to shake. Fresh state (own arrays) per App.
            app.insertResource(CameraDirector, createDirectorState());
            // The camera queries belong to the plugin that resolves the camera,
            // not to one core's bootstrap: the native core never runs corePlugin,
            // and publishing them there left both null on every device.
            app.insertResource(CameraView, new CameraViewAPI(app));
            // Published beside it, not instead of it: a system inside the frame
            // wants the camera being resolved, and an overlay on the picture wants
            // the one that drew it. Two questions, so two resources.
            app.insertResource(PresentedCameraView, presentedCameraView(app));

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
                _runWhenPaused: true,
                _params: [],
                _fn: () => {
                    const { width, height } = viewport();
                    const now = app.getResource(Time).elapsed;
                    // Peek (advance=false): the render system's tick of the director's blend is the authoritative one.
                    // Same scenes and Canvas as that render: the UI lays out in between, from what this publishes.
                    const activeScenes = runningScenes(app);
                    const frameCanvas = resolveFrameCanvas(app, module, cppRegistry, app.world, activeScenes);
                    const cameras = resolveCameras(app, module, cppRegistry, width, height, app.world, activeScenes, frameCanvas, cameraInfoPool, now, 'peek');
                    syncUICameraInfo(app, frameCanvas, width, height, cameras);
                },
            };

            const renderSystem: SystemDef = {
                _id: Symbol('RenderSystem'),
                _name: 'RenderSystem',
                _params: [],
                _fn: () => {
                    if (!pipeline.renderingEnabled) return;
                    // In a headset the screen is the session's framebuffer, both eyes side by side.
                    const xr = xrPresentation(app);
                    const { width, height } = xr ? { width: xr.framebufferWidth, height: xr.framebufferHeight } : viewport();
                    if (width === 0 || height === 0) return;
                    // A game that asked for only the frames that can look different leaves the others out: the screen keeps the last picture.
                    // Not in a headset, which shows nothing at all for a frame not drawn.
                    if (!xr && pipeline.demand.enabled && !pipeline.demand.shouldRender({
                        width, height,
                        worldVersion: app.world.getWorldVersion(),
                        pendingShaders: pendingShaders(module),
                        input: app.hasResource(Input) ? app.getResource(Input) : null,
                    })) return;
                    // Materials and camera motion share gameplay's clock, including pause, time scale and explicit stepping.
                    const elapsed = app.getResource(Time).elapsed;

                    if (width !== lastResizeW || height !== lastResizeH) {
                        app.measureFrameScope('render.resize', () => Renderer.resize(width, height));
                        lastResizeW = width;
                        lastResizeH = height;
                    }

                    const activeScenes = runningScenes(app);
                    const frameCanvas = resolveFrameCanvas(app, module, cppRegistry, app.world, activeScenes);
                    const clearColor: { x: number; y: number; z: number; w: number } | undefined = frameCanvas.data?.backgroundColor;

                    pipeline.setActiveScenes(activeScenes ?? null);

                    // Transforms resolve BEFORE any camera is read — a view is built
                    // from Transform.worldPosition, and a pass behind the read hands
                    // back the previous frame's placement. beginFrame clears the memo.
                    // The editor view's lighting reaches the engine only while that view is
                    // the one drawing; play mode and shipped games push the neutral state.
                    lastViewLighting = pushEditorViewLighting(
                        module, app.getResource(EditorViewLighting),
                        app.hasResource(EditorView) && app.getResource(EditorView).active,
                        lastViewLighting);
                    lastViewShading = pushEditorViewShading(
                        app.getResource(EditorViewShading),
                        app.hasResource(EditorView) && app.getResource(EditorView).active,
                        lastViewShading);
                    lastViewWeights = pushEditorViewWeights(
                        app.getResource(EditorViewShading),
                        app.hasResource(EditorView) && app.getResource(EditorView).active,
                        lastViewWeights);
                    lastViewSelection = pushEditorViewSelection(
                        app.getResource(EditorViewShading),
                        app.hasResource(EditorView) && app.getResource(EditorView).active,
                        lastViewSelection);
                    pipeline.beginFrame(elapsed);
                    app.measureFrameScope('render.updateTransforms', () =>
                        Renderer.updateTransforms({ _cpp: cppRegistry }));

                    // The regular render ticks the director's blend.
                    const cameras = app.measureFrameScope('render.resolveCameras', () =>
                        resolveCameras(app, module, cppRegistry, width, height, app.world, activeScenes, frameCanvas, cameraInfoPool, elapsed, 'tick'));

                    pushRenderOrigin((x, y, z) => { Renderer.setOrigin(x, y, z); });

                    // Parallax in the editor's view follows the game camera, not the view's eye. Pushed only on change.
                    const anchor = editorParallaxAnchor(app, module, cppRegistry, width, height, app.world, activeScenes);
                    const anchorKey = anchor ? `${anchor.x},${anchor.y}` : '';
                    if (anchorKey !== lastParallaxAnchor) {
                        Renderer.setParallaxAnchor(anchor !== null, anchor?.x ?? 0, anchor?.y ?? 0);
                        lastParallaxAnchor = anchorKey;
                    }

                    app.measureFrameScope('render.uiCameraSync', () =>
                        syncUICameraInfo(app, frameCanvas, width, height, cameras));

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
                                // Already opened above. Opening it twice ages the
                                // render-target pool twice in one frame.
                                frameAlreadyBegun: true,
                            });
                        } else {
                            pipeline.beginScreenCapture();
                            // One project-level choice, read once: a per-camera answer
                            // would let two cameras present the same surface at two
                            // resolutions, which is a picture nobody asked for.
                            const renderPolicy = app.hasResource(ScreenScaling)
                                ? app.getResource(ScreenScaling).renderPolicy
                                : undefined;
                            const xrRig = xr ? primaryScreenCamera(cameras) : null;
                            for (const cam of cameras) {
                                if (xr && cam.renderTarget === 0) {
                                    // A headset shows one camera, through both eyes; another drawing to the screen has no screen there.
                                    if (cam === xrRig) drawEyes(app, pipeline, xr, cam, cppRegistry, elapsed, clearColor);
                                    continue;
                                }
                                const target = cameraPassTarget(cam);
                                if (target === null) continue;
                                pipeline.renderCamera({
                                    registry: { _cpp: cppRegistry },
                                    viewProjection: cam.viewProjection,
                                    renderViewProjection: cam.renderViewProjection,
                                    renderOrigin: cam.renderOrigin,
                                    parallaxCenter: parallaxCenterFor(anchor ?? undefined, cam.renderOrigin),
                                    viewportPixels: cam.viewport,
                                    clearFlags: cam.clearFlags,
                                    elapsed,
                                    cameraEntity: cam.entity,
                                    clearColor: cameraClearColor(cam.entity as Entity, clearColor),
                                    cullingMask: cam.cullingMask,
                                    renderTarget: target,
                                    // The world the camera shows vertically is what the
                                    // render size matches, so worldPerPixel lands on 1.
                                    worldHeight: 2 * cam.halfH,
                                    renderPolicy,
                                });
                            }
                            pipeline.endScreenCapture();
                            Renderer.setViewport(0, 0, width, height);
                        }

                        // Last, and outside the camera branch: a frame with no
                        // camera still has a screen. After the post stack, since a
                        // HUD is not world content for an effect to grade.
                        // Not in a headset: a HUD pinned to a screen has no screen to pin to there (a world-space UI does).
                        if (!xr && app.hasResource(ScreenOverlay)) {
                            pipeline.renderScreenOverlay({ _cpp: cppRegistry },
                                                         app.getResource(ScreenOverlay));
                        }
                        // Over the screen's UI too: what an editor draws to work the scene with.
                        if (!xr) pipeline.renderOverScreen();
                        if (xr) {
                            xr.drawnFrames++;
                            if (!xr.frameActive) xr.missedFrames++;
                        }
                        // ...and now the frame is over, which is when a borrowed
                        // swapchain image goes back.
                        pipeline.endFrame();
                    }, { remainder: 'wait' });

                    // The frame is drawn; say which camera drew it. After the
                    // submit, so nothing can publish a commit for a picture that
                    // then failed to render.
                    commitCamera(app, primaryScreenCamera(cameras), app.getResource(UICameraInfo), anchor ?? undefined);
                },
            };

            // Every camera's pipeline (CameraRig.ts): position, rotation, their limits, then the brain's blend to the
            // director. After Update, so a target moved this frame is framed where it is now (in Update a fast one runs
            // past the soft zone); before camera collection, so the director blends moved cameras. Play mode only.
            app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
                [Res(Time)],
                (time: TimeData) => {
                    // The main view's own pixels, as last drawn (UICameraInfo is synced before Update): the UI layout's
                    // box is in design units, which held a 16:9 design on a square screen and put an off-centre target
                    // twice as far off as asked.
                    const view = app.getResource(UICameraInfo);
                    const aspect = view.vpH > 0 ? view.vpW / view.vpH : 0;
                    const director = app.hasResource(CameraDirector) ? app.getResource(CameraDirector) : null;
                    const collision = app.hasResource(CameraCollision) ? app.getResource(CameraCollision) : null;
                    // The targets' world poses are resolved when the frame draws; read before that they are the previous
                    // frame's, and every stage framed a moving target a frame late. Resolving them now is the pass the
                    // render system makes again, which then finds nothing to do.
                    const cpp = app.world.getCppRegistry();
                    if (cpp) Renderer.updateTransforms({ _cpp: cpp });
                    cameraRigUpdate(app.world, time.delta, aspect, director, collision);
                },
                { name: 'CameraRigSystem' },
            ), { runIf: playModeOnly, activeWhen: [FollowTarget, CameraDolly, PositionComposer, LookAtTarget, CameraTargetGroup, GroupFraming, CameraDeoccluder, CameraBounds, CameraBrain, CameraImpulseSource, StateDrivenCamera] });

            // Hands and head where the headset says, after Update has moved the rig: a hand placed before it trails a walking player.
            app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], () => {
                if (!xrPresentation(app)) return;
                const cpp = app.world.getCppRegistry();
                // The rig's world pose as Update left it, not as last frame drew it.
                if (cpp) Renderer.updateTransforms({ _cpp: cpp });
                syncXRPoses(app);
            }, { name: 'XRPoseSystem' }), { activeWhen: [XRController, XRHead] });

            app.addSystemToSchedule(Schedule.First, uiCameraSyncSystem);
            app.addSystemToSchedule(Schedule.Last, renderSystem);
            // What the director decided as the frame was drawn, onto the CameraEvent bus: a game's systems read it the
            // next frame. After the render, which is where the view is resolved.
            app.addEvent(CameraEvent);
            app.addSystemToSchedule(Schedule.Last, defineSystem(
                [Res(CameraDirector), EventWriter(CameraEvent)],
                (director: CameraDirectorState, events: EventWriterInstance<CameraEventPayload>) => {
                    if (director.pendingEvents.length === 0) return;
                    for (const e of director.pendingEvents) events.send(e);
                    director.pendingEvents.length = 0;
                },
                { name: 'CameraEventSystem' },
            ));
        },
    };
}

/** Draw a camera's current world without stepping gameplay or changing authored cameras. With a `target` (a render target of
 * width x height) the frame goes into it and the screen is left as it was: the host restores the screen's camera state with
 * {@link syncScreenCameras} rather than drawing the screen again. False with a target while a screen-level effect stack is on,
 * which only the screen can hold. */
export function renderCameraFrame(app: App, width: number, height: number, entity?: number, target?: number): boolean {
    const pipeline = app.pipeline;
    const registry = app.world.getCppRegistry();
    const module = app.wasmModule;
    if (!pipeline || !registry || width <= 0 || height <= 0) return false;
    if (target && pipeline.screenEffectsActive) return false;
    const elapsed = pipeline.frameElapsed;
    const anchor = app.getResource(CameraCommit).parallaxAnchor;
    let drewCamera = false;
    let presented: CameraInfo | null = null;
    Renderer.resize(width, height);
    pipeline.beginFrame(elapsed, target ?? 0);
    try {
        Renderer.updateTransforms({ _cpp: registry });
        // An authored-camera preview ignores director selection (so an inactive
        // camera can be inspected), but uses the same project fit as gameplay.
        const frameCanvas = resolveFrameCanvas(app, module, registry, app.world);
        const cameras = entity === undefined
            ? resolveCameras(app, module, registry, width, height, app.world, undefined, frameCanvas, [], elapsed, target ? 'peek' : 'redraw')
            : collectCameraPOVs(module, registry, width, height, app.world)
                .filter(pov => pov.entity === entity)
                .map((pov, i) => {
                    if (!target) followRenderOrigin(pov.x, pov.y, pov.z);
                    return buildCameraInfo({ ...pov, renderTarget: 0 }, width, height, frameCanvas.fit, [], i);
                });
        if (!cameras.length) return false;
        pushRenderOrigin((x, y, z) => { Renderer.setOrigin(x, y, z); });
        const clearColor = frameCanvas.data?.backgroundColor;
        const policy = app.hasResource(ScreenScaling) ? app.getResource(ScreenScaling).renderPolicy : undefined;
        syncUICameraInfo(app, frameCanvas, width, height, cameras);
        if (entity !== undefined || target) {
            Renderer.setViewport(0, 0, width, height);
            Renderer.begin(IDENTITY, target ?? 0, 3, clearColor, { x: 0, y: 0, w: width, h: height });
            Renderer.end();
        }
        if (!target) pipeline.beginScreenCapture();
        for (const cam of cameras) {
            const passTarget = cameraPassTarget(cam, target);
            if (passTarget === null) continue;
            pipeline.renderCamera({ registry: { _cpp: registry }, viewProjection: cam.viewProjection, renderViewProjection: cam.renderViewProjection,
                renderOrigin: cam.renderOrigin, parallaxCenter: parallaxCenterFor(anchor, cam.renderOrigin),
                viewportPixels: cam.viewport, clearFlags: cam.clearFlags, elapsed, cameraEntity: cam.entity,
                clearColor, cullingMask: cam.cullingMask, worldHeight: 2 * cam.halfH, renderPolicy: policy, renderTarget: passTarget });
            drewCamera = true;
        }
        if (!target) pipeline.endScreenCapture();
        Renderer.setViewport(0, 0, width, height);
        if (app.hasResource(ScreenOverlay)) pipeline.renderScreenOverlay({ _cpp: registry }, app.getResource(ScreenOverlay), target ?? 0);
        pipeline.renderOverScreen();
        if (!target) presented = primaryScreenCamera(cameras);
    } finally {
        pipeline.endFrame();
    }
    // A redraw uses the override previously pushed by the regular render system.
    if (presented) commitCamera(app, presented, app.getResource(UICameraInfo), anchor);
    return drewCamera;
}

/** Publish what a frame of the screen at this size says about its cameras (the renderer's size, the UI's camera, the screen
 * layout) without drawing it: what a host owes the screen after {@link renderCameraFrame} drew a camera into a target at another
 * size. Drawing the whole screen again only to say this cost a full editor frame every camera-preview refresh. */
export function syncScreenCameras(app: App, width: number, height: number): void {
    const pipeline = app.pipeline;
    const registry = app.world.getCppRegistry();
    const module = app.wasmModule;
    if (!pipeline || !registry || width <= 0 || height <= 0) return;
    Renderer.resize(width, height);
    const frameCanvas = resolveFrameCanvas(app, module, registry, app.world);
    const cameras = resolveCameras(app, module, registry, width, height, app.world, undefined, frameCanvas, [], pipeline.frameElapsed, 'peek');
    syncUICameraInfo(app, frameCanvas, width, height, cameras);
}

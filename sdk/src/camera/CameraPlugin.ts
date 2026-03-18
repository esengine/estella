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
import { ProjectionType, ScaleMode, SceneOwner } from '../component';
import { RenderPipeline } from '../renderPipeline';
import { Renderer } from '../renderer';
import { platformNow } from '../platform';
import { SceneManager } from '../sceneManager';
import { ortho, perspective, invertTranslation, multiply, IDENTITY } from '../math/mat4';

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

const cameraInfoPool_: CameraInfo[] = [];

function acquireCameraInfo(index: number): CameraInfo {
    if (index < cameraInfoPool_.length) {
        return cameraInfoPool_[index];
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
    cameraInfoPool_.push(info);
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
// Camera Collection
// =============================================================================

export function collectCameras(
    module: ESEngineModule,
    registry: CppRegistry,
    width: number,
    height: number,
    world?: World,
    activeScenes?: Set<string>,
): CameraInfo[] {
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
    if (filtered.length === 0) return [];

    const canvas = findCanvasData(module, registry);
    const cameras: CameraInfo[] = [];

    for (const e of filtered) {
        const camera = registry.getCamera(e);
        const transform = registry.getTransform(e);

        const aspect = (camera.viewportW * width) / (camera.viewportH * height);
        let projection: Float32Array;
        let camHalfW = 0;
        let camHalfH = 0;

        if (camera.projectionType === ProjectionType.Orthographic) {
            camHalfH = camera.orthoSize;

            if (canvas) {
                const baseOrthoSize = canvas.designResolution.y / 2;
                const designAspect = canvas.designResolution.x / canvas.designResolution.y;
                camHalfH = computeEffectiveOrthoSize(
                    baseOrthoSize, designAspect, aspect,
                    canvas.scaleMode, canvas.matchWidthOrHeight,
                );
            }

            camHalfW = camHalfH * aspect;
            projection = ortho(-camHalfW, camHalfW, -camHalfH, camHalfH, -camera.farPlane, camera.farPlane);
        } else {
            projection = perspective(
                camera.fov * Math.PI / 180,
                aspect,
                camera.nearPlane,
                camera.farPlane,
            );
        }

        const view = invertTranslation(transform.position.x, transform.position.y, transform.position.z);
        const cam = acquireCameraInfo(cameras.length);
        cam.entity = e;
        cam.viewProjection.set(multiply(projection, view));
        cam.viewportRect.x = camera.viewportX;
        cam.viewportRect.y = camera.viewportY;
        cam.viewportRect.w = camera.viewportW;
        cam.viewportRect.h = camera.viewportH;
        cam.clearFlags = camera.clearFlags;
        cam.priority = camera.priority;
        cam.halfW = camHalfW;
        cam.halfH = camHalfH;
        cam.cameraX = transform.position.x;
        cam.cameraY = transform.position.y;
        cameras.push(cam);
    }

    cameras.sort((a, b) => a.priority - b.priority);
    return cameras;
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
): void {
    if (!cameras) {
        cameras = collectCameras(module, cppRegistry, width, height);
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
                    syncUICameraInfo(app, module, cppRegistry, width, height);
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
                    const cameras = collectCameras(module, cppRegistry, width, height, app.world, activeScenes);

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

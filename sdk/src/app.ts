/**
 * @file    app.ts
 * @brief   Application builder and web platform integration
 */

import { World } from './world';
import { Schedule, SystemDef, SystemRunner } from './system';
import { ResourceStorage, Time, TimeData, type ResourceDef } from './resource';
import type { ESEngineModule, CppRegistry } from './wasm';
import { UICameraInfo } from './ui/UICameraInfo';
import { inputPlugin } from './input';
import { assetPlugin } from './asset';
import { prefabsPlugin } from './prefabServer';
import { initDrawAPI, shutdownDrawAPI } from './draw';
import { clearDrawCallbacks } from './customDraw';
import { initMaterialAPI, shutdownMaterialAPI } from './material';
import { initGeometryAPI, shutdownGeometryAPI } from './geometry';
import { initPostProcessAPI, shutdownPostProcessAPI } from './postprocess';
import { initRendererAPI, shutdownRendererAPI } from './renderer';
import { initGLDebugAPI, shutdownGLDebugAPI } from './glDebug';
import { platformNow } from './platform';
import { ProjectionType, ScaleMode, SceneOwner } from './component';
import type { Entity } from './types';
import { RenderPipeline, type SpineRendererFn } from './renderPipeline';
import { Renderer } from './renderer';
import { PostProcess } from './postprocess';
import type { SceneConfig } from './sceneManager';
import { SceneManager } from './sceneManager';
import { sceneManagerPlugin } from './scenePlugin';

// =============================================================================
// Plugin Interface
// =============================================================================

export interface Plugin {
    name?: string;
    dependencies?: ResourceDef<any>[];
    build(app: App): void;
}

// =============================================================================
// System Entry
// =============================================================================

interface SystemEntry {
    system: SystemDef;
    runBefore?: string[];
    runAfter?: string[];
}

// =============================================================================
// App
// =============================================================================

export class App {
    private readonly world_: World;
    private readonly resources_: ResourceStorage;
    private readonly systems_ = new Map<Schedule, SystemEntry[]>();
    private runner_: SystemRunner | null = null;

    private running_ = false;
    private lastTime_ = 0;
    private fixedTimestep_ = 1 / 60;
    private fixedAccumulator_ = 0;

    private module_: ESEngineModule | null = null;
    private pipeline_: RenderPipeline | null = null;
    private spineInitPromise_?: Promise<unknown>;
    private physicsInitPromise_?: Promise<unknown>;
    private physicsModule_?: unknown;
    private readonly installed_plugins_ = new Set<Plugin>();
    private error_handler_: ((error: unknown, systemName: string) => void) | null = null;
    private system_error_handler_: ((error: Error, systemName?: string) => 'continue' | 'pause') | null = null;
    private frame_paused_ = false;

    private constructor() {
        this.world_ = new World();
        this.resources_ = new ResourceStorage();

        for (const s of Object.values(Schedule)) {
            if (typeof s === 'number') {
                this.systems_.set(s, []);
            }
        }
    }

    static new(): App {
        return new App();
    }

    // =========================================================================
    // Plugins
    // =========================================================================

    addPlugin(plugin: Plugin): this {
        if (this.installed_plugins_.has(plugin)) return this;
        if (plugin.dependencies) {
            for (const dep of plugin.dependencies) {
                if (!this.hasResource(dep)) {
                    throw new Error(
                        `Plugin "${plugin.name ?? 'unknown'}" requires resource "${dep._name}" which has not been registered`
                    );
                }
            }
        }
        this.installed_plugins_.add(plugin);
        plugin.build(this);
        return this;
    }

    // =========================================================================
    // Systems
    // =========================================================================

    addSystemToSchedule(
        schedule: Schedule,
        system: SystemDef,
        options?: { runBefore?: string[]; runAfter?: string[] }
    ): this {
        this.systems_.get(schedule)!.push({
            system,
            runBefore: options?.runBefore,
            runAfter: options?.runAfter,
        });
        return this;
    }

    addSystem(system: SystemDef): this {
        return this.addSystemToSchedule(Schedule.Update, system);
    }

    addStartupSystem(system: SystemDef): this {
        return this.addSystemToSchedule(Schedule.Startup, system);
    }

    // =========================================================================
    // C++ Integration
    // =========================================================================

    connectCpp(cppRegistry: CppRegistry, module?: ESEngineModule): this {
        this.world_.connectCpp(cppRegistry);

        if (module) {
            this.module_ = module;
        }

        return this;
    }

    get wasmModule(): ESEngineModule | null {
        return this.module_;
    }

    get pipeline(): RenderPipeline | null {
        return this.pipeline_;
    }

    setSpineRenderer(fn: SpineRendererFn | null): void {
        this.pipeline_?.setSpineRenderer(fn);
    }

    get spineInitPromise(): Promise<unknown> | undefined {
        return this.spineInitPromise_;
    }

    set spineInitPromise(p: Promise<unknown> | undefined) {
        this.spineInitPromise_ = p;
    }

    get physicsInitPromise(): Promise<unknown> | undefined {
        return this.physicsInitPromise_;
    }

    set physicsInitPromise(p: Promise<unknown> | undefined) {
        this.physicsInitPromise_ = p;
    }

    get physicsModule(): unknown {
        return this.physicsModule_;
    }

    set physicsModule(m: unknown) {
        this.physicsModule_ = m;
    }

    // =========================================================================
    // World Access
    // =========================================================================

    get world(): World {
        return this.world_;
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    setFixedTimestep(timestep: number): this {
        this.fixedTimestep_ = timestep;
        return this;
    }

    onError(handler: (error: unknown, systemName: string) => void): this {
        this.error_handler_ = handler;
        return this;
    }

    onSystemError(handler: (error: Error, systemName?: string) => 'continue' | 'pause'): this {
        this.system_error_handler_ = handler;
        return this;
    }

    // =========================================================================
    // Resource Access
    // =========================================================================

    insertResource<T>(resource: ResourceDef<T>, value: T): this {
        this.resources_.insert(resource, value);
        return this;
    }

    getResource<T>(resource: ResourceDef<T>): T {
        return this.resources_.get(resource);
    }

    hasResource<T>(resource: ResourceDef<T>): boolean {
        return this.resources_.has(resource);
    }

    // =========================================================================
    // Scene Management
    // =========================================================================

    registerScene(config: SceneConfig): this {
        this.getResource(SceneManager).register(config);
        return this;
    }

    setInitialScene(name: string): this {
        this.getResource(SceneManager).setInitial(name);
        return this;
    }

    // =========================================================================
    // Run
    // =========================================================================

    run(): void {
        if (this.running_) {
            return;
        }

        this.running_ = true;
        this.runner_ = new SystemRunner(this.world_, this.resources_);

        this.resources_.insert(Time, { delta: 0, elapsed: 0, frameCount: 0 });

        this.runSchedule(Schedule.Startup);

        this.lastTime_ = platformNow();
        this.mainLoop();
    }

    private mainLoop = (): void => {
        if (!this.running_) {
            return;
        }

        const currentTime = platformNow();
        const deltaMs = currentTime - this.lastTime_;
        this.lastTime_ = currentTime;

        const delta = Math.min(deltaMs / 1000, 0.25);

        this.updateTime(delta);
        this.world_.resetQueryPool();
        this.frame_paused_ = false;

        this.runSchedule(Schedule.First);

        this.fixedAccumulator_ += delta;
        let fixedSteps = 0;
        while (this.fixedAccumulator_ >= this.fixedTimestep_ && fixedSteps < 8) {
            this.fixedAccumulator_ -= this.fixedTimestep_;
            this.runSchedule(Schedule.FixedPreUpdate);
            this.runSchedule(Schedule.FixedUpdate);
            this.runSchedule(Schedule.FixedPostUpdate);
            fixedSteps++;
        }
        if (fixedSteps >= 8) {
            this.fixedAccumulator_ = 0;
        }

        this.runSchedule(Schedule.PreUpdate);
        this.runSchedule(Schedule.Update);
        this.runSchedule(Schedule.PostUpdate);
        this.runSchedule(Schedule.Last);

        requestAnimationFrame(this.mainLoop);
    };

    quit(): void {
        this.running_ = false;
        clearDrawCallbacks();

        const shutdowns = [
            shutdownGLDebugAPI,
            shutdownRendererAPI,
            shutdownPostProcessAPI,
            shutdownGeometryAPI,
            shutdownMaterialAPI,
            shutdownDrawAPI,
        ];
        for (const fn of shutdowns) {
            try { fn(); } catch (e) {
                console.error('[ESEngine] Shutdown error:', e);
            }
        }

        for (const entity of this.world_.getAllEntities()) {
            try { this.world_.despawn(entity); } catch (_) { /* ignore */ }
        }
        this.world_.disconnectCpp();

        this.pipeline_ = null;
        this.runner_ = null;
        this.module_ = null;
    }

    // =========================================================================
    // Internal
    // =========================================================================

    private sortSystems(systems: SystemEntry[]): SystemEntry[] {
        if (systems.length <= 1) {
            return systems;
        }

        const nameToIndex = new Map<string, number>();
        for (let i = 0; i < systems.length; i++) {
            nameToIndex.set(systems[i].system._name, i);
        }

        for (const entry of systems) {
            if (entry.runBefore) {
                for (const targetName of entry.runBefore) {
                    const targetIndex = nameToIndex.get(targetName);
                    if (targetIndex !== undefined) {
                        const targetEntry = systems[targetIndex];
                        if (!targetEntry.runAfter) {
                            targetEntry.runAfter = [];
                        }
                        if (!targetEntry.runAfter.includes(entry.system._name)) {
                            targetEntry.runAfter.push(entry.system._name);
                        }
                    }
                }
            }
        }

        const sorted: SystemEntry[] = [];
        const visited = new Set<number>();
        const visiting = new Set<number>();

        const visit = (index: number): void => {
            if (visited.has(index)) return;
            if (visiting.has(index)) {
                const name = systems[index].system._name;
                throw new Error(`Circular dependency detected involving system "${name}"`);
            }

            visiting.add(index);
            const entry = systems[index];

            if (entry.runAfter) {
                for (const depName of entry.runAfter) {
                    const depIndex = nameToIndex.get(depName);
                    if (depIndex !== undefined) {
                        visit(depIndex);
                    }
                }
            }

            visiting.delete(index);
            visited.add(index);
            sorted.push(entry);
        };

        for (let i = 0; i < systems.length; i++) {
            visit(i);
        }

        return sorted;
    }

    private runSchedule(schedule: Schedule): void {
        let systems = this.systems_.get(schedule);
        if (!systems || !this.runner_ || this.frame_paused_) {
            return;
        }

        if (systems.some(s => s.runBefore || s.runAfter)) {
            systems = this.sortSystems(systems);
        }

        for (const entry of systems) {
            try {
                this.runner_.run(entry.system);
            } catch (e) {
                const name = entry.system._name;
                console.error(`[ESEngine] System "${name}" threw an error:`, e);
                if (this.error_handler_) {
                    this.error_handler_(e, name);
                }
                if (this.system_error_handler_) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    const action = this.system_error_handler_(err, name);
                    if (action === 'pause') {
                        this.frame_paused_ = true;
                        return;
                    }
                }
            }
        }
    }

    private updateTime(delta: number): void {
        const time = this.resources_.get(Time);
        time.delta = delta;
        time.elapsed += delta;
        time.frameCount++;
    }
}

// =============================================================================
// Web App Factory
// =============================================================================

export interface WebAppOptions {
    getViewportSize?: () => { width: number; height: number };
    glContextHandle?: number;
    plugins?: Plugin[];
}

export function createWebApp(module: ESEngineModule, options?: WebAppOptions): App {
    const app = App.new();
    const cppRegistry = new module.Registry() as unknown as CppRegistry;

    app.connectCpp(cppRegistry, module);

    if (options?.glContextHandle) {
        module.initRendererWithContext(options.glContextHandle);
    } else {
        module.initRenderer();
    }

    initDrawAPI(module);
    initMaterialAPI(module);
    initGeometryAPI(module);
    initPostProcessAPI(module);
    initRendererAPI(module);
    initGLDebugAPI(module);

    const pipeline = new RenderPipeline();
    (app as any).pipeline_ = pipeline;
    let startTime = platformNow();

    const getViewportSize = options?.getViewportSize ?? (() => ({
        width: window.innerWidth * (window.devicePixelRatio || 1),
        height: window.innerHeight * (window.devicePixelRatio || 1)
    }));

    app.insertResource(UICameraInfo, {
        viewProjection: new Float32Array(16),
        vpX: 0, vpY: 0, vpW: 0, vpH: 0,
        screenW: 0, screenH: 0,
        worldLeft: 0, worldBottom: 0, worldRight: 0, worldTop: 0,
        valid: false,
    });

    function syncUICameraInfo(width: number, height: number, cameras?: CameraInfo[]): void {
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

    const uiCameraSyncSystem: SystemDef = {
        _id: Symbol('UICameraSyncSystem'),
        _name: 'UICameraSyncSystem',
        _params: [],
        _fn: () => {
            const { width, height } = getViewportSize();
            syncUICameraInfo(width, height);
        },
    };

    const renderSystem: SystemDef = {
        _id: Symbol('RenderSystem'),
        _name: 'RenderSystem',
        _params: [],
        _fn: () => {
            const { width, height } = getViewportSize();
            if (width === 0 || height === 0) return;
            const canvasEntity = module.registry_getCanvasEntity(cppRegistry);
            if (canvasEntity >= 0) {
                const canvas = cppRegistry.getCanvas(canvasEntity);
                const bg = canvas.backgroundColor;
                Renderer.setClearColor(bg.x, bg.y, bg.z, bg.w);
            }
            const elapsed = (platformNow() - startTime) / 1000;

            Renderer.resize(width, height);
            if (PostProcess.isInitialized() && PostProcess.getPassCount() > 0 && !PostProcess.isBypassed()) {
                PostProcess.resize(width, height);
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
            const cameras = collectCameras(module, cppRegistry, width, height, app.world, activeScenes);

            syncUICameraInfo(width, height, cameras);

            if (cameras.length === 0) {
                pipeline.render({
                    registry: { _cpp: cppRegistry },
                    viewProjection: IDENTITY,
                    width, height, elapsed,
                });
            } else {
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
                    });
                }
                Renderer.setViewport(0, 0, width, height);
            }
        }
    };

    app.addSystemToSchedule(Schedule.First, uiCameraSyncSystem);
    app.addSystemToSchedule(Schedule.Last, renderSystem);

    app.addPlugin(assetPlugin);
    app.addPlugin(prefabsPlugin);
    app.addPlugin(inputPlugin);
    app.addPlugin(sceneManagerPlugin);
    if (options?.plugins) {
        for (const plugin of options.plugins) {
            app.addPlugin(plugin);
        }
    }

    return app;
}

export function flushPendingSystems(app: App): void {
    if (typeof window === 'undefined') return;
    const pending = window.__esengine_pendingSystems;
    if (!pending || pending.length === 0) return;

    for (const entry of pending) {
        app.addSystemToSchedule(entry.schedule as Schedule, entry.system as SystemDef);
    }
    pending.length = 0;
}

// =============================================================================
// View-Projection Computation
// =============================================================================

const IDENTITY = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

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

function collectCameras(
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
        const transform = registry.getLocalTransform(e);

        const vr = {
            x: camera.viewportX,
            y: camera.viewportY,
            w: camera.viewportW,
            h: camera.viewportH,
        };
        const aspect = (vr.w * width) / (vr.h * height);
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
        cameras.push({
            entity: e,
            viewProjection: new Float32Array(multiply(projection, view)),
            viewportRect: vr,
            clearFlags: camera.clearFlags,
            priority: camera.priority,
            halfW: camHalfW,
            halfH: camHalfH,
            cameraX: transform.position.x,
            cameraY: transform.position.y,
        });
    }

    cameras.sort((a, b) => a.priority - b.priority);
    return cameras;
}

function computeViewProjection(module: ESEngineModule, registry: CppRegistry, width: number, height: number): Float32Array {
    if (width === 0 || height === 0) return IDENTITY;
    const cameraEntities = module.registry_getCameraEntities(registry);
    if (cameraEntities.length === 0) return IDENTITY;

    const e = cameraEntities[0];
    const camera = registry.getCamera(e);
    const transform = registry.getLocalTransform(e);

    const aspect = width / height;
    let projection: Float32Array;

    if (camera.projectionType === ProjectionType.Orthographic) {
        let halfH = camera.orthoSize;

        const canvas = findCanvasData(module, registry);
        if (canvas) {
            const baseOrthoSize = canvas.designResolution.y / 2;
            const designAspect = canvas.designResolution.x / canvas.designResolution.y;
            halfH = computeEffectiveOrthoSize(
                baseOrthoSize, designAspect, aspect,
                canvas.scaleMode, canvas.matchWidthOrHeight,
            );
        }

        const halfW = halfH * aspect;
        projection = ortho(-halfW, halfW, -halfH, halfH, -camera.farPlane, camera.farPlane);
    } else {
        projection = perspective(
            camera.fov * Math.PI / 180,
            aspect,
            camera.nearPlane,
            camera.farPlane,
        );
    }

    const view = invertTranslation(transform.position.x, transform.position.y, transform.position.z);
    return multiply(projection, view);
}

const _orthoM = new Float32Array(16);
function ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Float32Array {
    const m = _orthoM;
    m.fill(0);
    const rl = right - left;
    const tb = top - bottom;
    const fn = far - near;
    m[0]  = 2 / rl;
    m[5]  = 2 / tb;
    m[10] = -2 / fn;
    m[12] = -(right + left) / rl;
    m[13] = -(top + bottom) / tb;
    m[14] = -(far + near) / fn;
    m[15] = 1;
    return m;
}

const _perspM = new Float32Array(16);
function perspective(fovRad: number, aspect: number, near: number, far: number): Float32Array {
    const m = _perspM;
    m.fill(0);
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = near - far;
    m[0]  = f / aspect;
    m[5]  = f;
    m[10] = (far + near) / nf;
    m[11] = -1;
    m[14] = (2 * far * near) / nf;
    return m;
}

const _invTransM = new Float32Array(16);
function invertTranslation(x: number, y: number, z: number): Float32Array {
    const m = _invTransM;
    m[0]  = 1; m[1] = 0; m[2] = 0; m[3] = 0;
    m[4]  = 0; m[5] = 1; m[6] = 0; m[7] = 0;
    m[8]  = 0; m[9] = 0; m[10] = 1; m[11] = 0;
    m[12] = -x; m[13] = -y; m[14] = -z; m[15] = 1;
    return m;
}

const _mulM = new Float32Array(16);
function multiply(a: Float32Array, b: Float32Array): Float32Array {
    const m = _mulM;
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            m[j * 4 + i] =
                a[0 * 4 + i] * b[j * 4 + 0] +
                a[1 * 4 + i] * b[j * 4 + 1] +
                a[2 * 4 + i] * b[j * 4 + 2] +
                a[3 * 4 + i] * b[j * 4 + 3];
        }
    }
    return m;
}

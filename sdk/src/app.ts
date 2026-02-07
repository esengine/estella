/**
 * @file    app.ts
 * @brief   Application builder and web platform integration
 */

import { World } from './world';
import { Schedule, SystemDef, SystemRunner } from './system';
import { ResourceStorage, Time, TimeData, type ResourceDef } from './resource';
import type { ESEngineModule, CppRegistry } from './wasm';
import { textPlugin } from './ui/TextPlugin';
import { initDrawAPI, shutdownDrawAPI } from './draw';
import { initMaterialAPI, shutdownMaterialAPI } from './material';
import { initGeometryAPI, shutdownGeometryAPI } from './geometry';
import { initPostProcessAPI, shutdownPostProcessAPI } from './postprocess';
import { initRendererAPI, shutdownRendererAPI } from './renderer';
import { RenderPipeline } from './renderPipeline';

// =============================================================================
// Plugin Interface
// =============================================================================

export interface Plugin {
    build(app: App): void;
}

// =============================================================================
// System Entry
// =============================================================================

interface SystemEntry {
    system: SystemDef;
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

    private module_: ESEngineModule | null = null;

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
        plugin.build(this);
        return this;
    }

    // =========================================================================
    // Systems
    // =========================================================================

    addSystemToSchedule(schedule: Schedule, system: SystemDef): this {
        this.systems_.get(schedule)!.push({ system });
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

    // =========================================================================
    // World Access
    // =========================================================================

    get world(): World {
        return this.world_;
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

        this.lastTime_ = performance.now();
        this.mainLoop();
    }

    private mainLoop = (): void => {
        if (!this.running_) {
            return;
        }

        const now = performance.now();
        const deltaMs = now - this.lastTime_;
        this.lastTime_ = now;

        const delta = deltaMs / 1000;

        this.updateTime(delta);

        this.runSchedule(Schedule.First);
        this.runSchedule(Schedule.PreUpdate);
        this.runSchedule(Schedule.Update);
        this.runSchedule(Schedule.PostUpdate);
        this.runSchedule(Schedule.Last);

        requestAnimationFrame(this.mainLoop);
    };

    quit(): void {
        this.running_ = false;
        shutdownRendererAPI();
        shutdownPostProcessAPI();
        shutdownGeometryAPI();
        shutdownMaterialAPI();
        shutdownDrawAPI();
    }

    // =========================================================================
    // Internal
    // =========================================================================

    private runSchedule(schedule: Schedule): void {
        const systems = this.systems_.get(schedule);
        if (!systems || !this.runner_) {
            return;
        }

        for (const entry of systems) {
            this.runner_.run(entry.system);
        }
    }

    private updateTime(delta: number): void {
        const time = this.resources_.get(Time);
        const newTime: TimeData = {
            delta,
            elapsed: time.elapsed + delta,
            frameCount: time.frameCount + 1
        };
        this.resources_.set(Time, newTime);
    }
}

// =============================================================================
// Web App Factory
// =============================================================================

export interface WebAppOptions {
    getViewportSize?: () => { width: number; height: number };
    glContextHandle?: number;
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

    const pipeline = new RenderPipeline();
    let startTime = performance.now();

    const getViewportSize = options?.getViewportSize ?? (() => ({
        width: window.innerWidth * (window.devicePixelRatio || 1),
        height: window.innerHeight * (window.devicePixelRatio || 1)
    }));

    const renderSystem: SystemDef = {
        _id: Symbol('RenderSystem'),
        _name: 'RenderSystem',
        _params: [],
        _fn: () => {
            const { width, height } = getViewportSize();
            const vp = computeViewProjection(cppRegistry, width, height);
            const elapsed = (performance.now() - startTime) / 1000;
            pipeline.render({
                registry: { _cpp: cppRegistry },
                viewProjection: vp,
                width, height, elapsed,
            });
        }
    };

    app.addSystemToSchedule(Schedule.Last, renderSystem);

    app.addPlugin(textPlugin);

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

function computeViewProjection(registry: CppRegistry, width: number, height: number): Float32Array {
    const count = registry.entityCount();
    const scanLimit = count + 1000;

    for (let e = 0; e < scanLimit; e++) {
        if (!registry.valid(e) || !registry.hasCamera(e) || !registry.hasLocalTransform(e)) {
            continue;
        }

        const camera = registry.getCamera(e) as {
            projectionType: number;
            fov: number;
            orthoSize: number;
            nearPlane: number;
            farPlane: number;
            isActive: boolean;
        };
        if (!camera.isActive) continue;

        const transform = registry.getLocalTransform(e) as {
            position: { x: number; y: number; z: number };
        };

        const aspect = width / height;
        let projection: Float32Array;

        if (camera.projectionType === 1) {
            const halfH = camera.orthoSize;
            const halfW = halfH * aspect;
            projection = ortho(-halfW, halfW, -halfH, halfH, camera.nearPlane, camera.farPlane);
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

    return IDENTITY;
}

function ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Float32Array {
    const m = new Float32Array(16);
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

function perspective(fovRad: number, aspect: number, near: number, far: number): Float32Array {
    const m = new Float32Array(16);
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = near - far;
    m[0]  = f / aspect;
    m[5]  = f;
    m[10] = (far + near) / nf;
    m[11] = -1;
    m[14] = (2 * far * near) / nf;
    return m;
}

function invertTranslation(x: number, y: number, z: number): Float32Array {
    const m = new Float32Array(16);
    m[0]  = 1;
    m[5]  = 1;
    m[10] = 1;
    m[15] = 1;
    m[12] = -x;
    m[13] = -y;
    m[14] = -z;
    return m;
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
    const m = new Float32Array(16);
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

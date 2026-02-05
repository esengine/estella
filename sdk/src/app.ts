/**
 * @file    app.ts
 * @brief   Application builder and web platform integration
 */

import { World } from './world';
import { Schedule, SystemDef, SystemRunner } from './system';
import { ResourceStorage, Time, TimeData, type ResourceDef } from './resource';
import type { ESEngineModule, CppRegistry } from './wasm';
import { textPlugin } from './ui/TextPlugin';

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
            module.renderFrame(cppRegistry, width, height);
        }
    };

    app.addSystemToSchedule(Schedule.Last, renderSystem);

    app.addPlugin(textPlugin);

    return app;
}

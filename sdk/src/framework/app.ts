/**
 * @file    app.ts
 * @brief   Application builder with plugin support
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { World, CppRegistry } from './world';
import { Schedule, SystemOrdering } from './schedule';
import { SystemDef, SystemRunner, ConditionalSystemDef } from './system';
import { ResourceDef, ResourceStorage, Time, TimeData } from './resource';
import { ComponentDef } from './component';
import { Schema } from './types';
import { loadScene, ComponentRegistry, SceneLoadResult } from '../scene/SceneLoader';

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
    system: SystemDef | ConditionalSystemDef;
    ordering?: SystemOrdering;
}

// =============================================================================
// App Configuration
// =============================================================================

export interface AppConfig {
    title?: string;
    width?: number;
    height?: number;
    canvas?: HTMLCanvasElement | string;
    fixedTimestep?: number;
}

// =============================================================================
// App
// =============================================================================

export class App {
    private readonly world_: World;
    private readonly resources_: ResourceStorage;
    private readonly systems_ = new Map<Schedule, SystemEntry[]>();
    private readonly plugins_: Plugin[] = [];
    private readonly componentRegistry_: ComponentRegistry = new Map();
    private runner_: SystemRunner | null = null;

    private running_ = false;
    private lastTime_ = 0;
    private fixedTimestep_ = 1 / 60;
    private fixedAccumulator_ = 0;

    private config_: AppConfig = {};

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
    // Component Registration
    // =========================================================================

    /** @brief Register a custom component for scene loading */
    registerComponent(component: ComponentDef<Schema>): this {
        this.componentRegistry_.set(component._name, component);
        return this;
    }

    /** @brief Get the component registry */
    get componentRegistry(): ComponentRegistry {
        return this.componentRegistry_;
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    configure(config: AppConfig): this {
        this.config_ = { ...this.config_, ...config };
        if (config.fixedTimestep) {
            this.fixedTimestep_ = config.fixedTimestep;
        }
        return this;
    }

    // =========================================================================
    // Plugins
    // =========================================================================

    addPlugin(plugin: Plugin): this {
        this.plugins_.push(plugin);
        plugin.build(this);
        return this;
    }

    addPlugins(...plugins: Plugin[]): this {
        for (const plugin of plugins) {
            this.addPlugin(plugin);
        }
        return this;
    }

    // =========================================================================
    // Systems
    // =========================================================================

    /** @brief Add a system to a specific schedule */
    addSystemToSchedule(schedule: Schedule, system: SystemDef, ordering?: SystemOrdering): this {
        const entry: SystemEntry = { system, ordering };
        this.systems_.get(schedule)!.push(entry);
        return this;
    }

    /** @brief Add a system to the Update schedule (convenience) */
    addSystem(system: SystemDef, ordering?: SystemOrdering): this {
        return this.addSystemToSchedule(Schedule.Update, system, ordering);
    }

    /** @brief Add a startup system */
    addStartupSystem(system: SystemDef): this {
        return this.addSystemToSchedule(Schedule.Startup, system);
    }

    /** @brief Add multiple systems to a schedule */
    addSystems(schedule: Schedule, ...systems: SystemDef[]): this {
        for (const system of systems) {
            this.addSystemToSchedule(schedule, system);
        }
        return this;
    }

    // =========================================================================
    // Scene Loading
    // =========================================================================

    /** @brief Load a scene from a URL */
    async loadSceneAsync(url: string): Promise<SceneLoadResult> {
        return loadScene(this.world_.tsRegistry, url, {
            componentRegistry: this.componentRegistry_,
        });
    }

    /** @brief Load a scene (fire and forget) */
    loadScene(url: string): this {
        this.loadSceneAsync(url)
            .then((result) => {
                if (result.success) {
                    console.log(`Scene loaded: ${result.sceneName} (${result.entityCount} entities)`);
                } else {
                    console.error(`Failed to load scene: ${result.error}`);
                }
            })
            .catch((err) => {
                console.error('Scene loading error:', err);
            });
        return this;
    }

    // =========================================================================
    // Resources
    // =========================================================================

    insertResource<T>(resource: ResourceDef<T>, value: T): this {
        this.resources_.insert(resource, value);
        return this;
    }

    initResource<T>(resource: ResourceDef<T>): this {
        if (!this.resources_.has(resource)) {
            this.resources_.insert(resource, resource._default);
        }
        return this;
    }

    // =========================================================================
    // C++ Integration
    // =========================================================================

    /** @brief Connect to C++ Registry for builtin component access */
    connectCpp(cppRegistry: CppRegistry, heapBuffer: ArrayBuffer): this {
        this.world_.connectCpp(cppRegistry, heapBuffer);
        return this;
    }

    /** @brief Update HEAP buffer reference (after WASM memory growth) */
    updateHeapBuffer(heapBuffer: ArrayBuffer): this {
        this.world_.updateHeapBuffer(heapBuffer);
        return this;
    }

    // =========================================================================
    // World Access
    // =========================================================================

    get world(): World {
        return this.world_;
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

        this.initResource(Time);

        this.sortAllSystems();

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

        this.fixedAccumulator_ += delta;
        while (this.fixedAccumulator_ >= this.fixedTimestep_) {
            this.runSchedule(Schedule.FixedPreUpdate);
            this.runSchedule(Schedule.FixedUpdate);
            this.runSchedule(Schedule.FixedPostUpdate);
            this.fixedAccumulator_ -= this.fixedTimestep_;
        }

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
            const sys = entry.system as ConditionalSystemDef;

            if (sys._condition && !sys._condition()) {
                continue;
            }

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

    private sortAllSystems(): void {
        for (const [_, systems] of this.systems_) {
            this.sortSystems(systems);
        }
    }

    private sortSystems(systems: SystemEntry[]): void {
        // Simple topological sort based on before/after constraints
        // For now, just maintain insertion order
        // TODO: Implement proper topological sort
    }
}

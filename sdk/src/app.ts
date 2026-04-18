/**
 * @file    app.ts
 * @brief   Application builder and web platform integration
 */

import { World } from './world';
import { Schedule, SystemDef, SystemRunner, SystemSet, type RunCondition } from './system';
import { ResourceStorage, Time, TimeData, type ResourceDef } from './resource';
import { EventRegistry, type EventDef } from './event';
import type { ESEngineModule, CppRegistry } from './wasm';
import type { BridgeConnectOptions } from './ecs/BuiltinBridge';
import { UICameraInfo } from './ui/UICameraInfo';
import { inputPlugin } from './input';
import { assetPlugin } from './asset';
import { prefabsPlugin } from './prefabServer';
import { setWasmErrorHandler } from './wasmError';
import { corePlugin, DEFAULT_UI_CAMERA_INFO } from './corePlugin';
import { platformNow } from './platform';
import { RenderPipeline } from './renderPipeline';
import type { SceneConfig } from './sceneManager';
import { SceneManager } from './sceneManager';
import { sceneManagerPlugin } from './scenePlugin';
import { getDefaultContext } from './context';
import { cameraPlugin } from './camera/CameraPlugin';
import { PhysicsRuntime } from './physics/PhysicsRuntime';
import { log } from './logger';

// =============================================================================
// Plugin Interface
// =============================================================================

export type PluginDependency = string | ResourceDef<any>;

export interface Plugin {
    name?: string;
    dependencies?: PluginDependency[];
    before?: string[];
    after?: string[];
    build(app: App): void;
    finish?(app: App): void;
    cleanup?(app?: App): void;
}

// =============================================================================
// System Entry
// =============================================================================

export type { RunCondition };

interface SystemEntry {
    system: SystemDef;
    runBefore?: string[];
    runAfter?: string[];
    runIf?: RunCondition;
}

// =============================================================================
// App
// =============================================================================

export class App {
    private readonly world_: World;
    private readonly resources_: ResourceStorage;
    private readonly systems_ = new Map<Schedule, SystemEntry[]>();
    private runner_: SystemRunner | null = null;
    private systemCounter_ = 0;
    private readonly templateToRuntime_ = new Map<symbol, symbol>();
    /** Set name -> runtime system names registered under that set, for dep expansion. */
    private readonly setMembership_ = new Map<string, string[]>();

    private running_ = false;
    private lastTime_ = 0;
    private fixedTimestep_ = 1 / 60;
    private fixedAccumulator_ = 0;
    private maxDeltaTime_ = 0.25;
    private maxFixedSteps_ = 8;
    private targetFrameInterval_ = 0;

    private module_: ESEngineModule | null = null;
    private pipeline_: RenderPipeline | null = null;
    private spineInitPromise_?: Promise<unknown>;
    private readonly installed_plugins_: Plugin[] = [];
    private readonly installedPluginSet_ = new Set<Plugin>();
    private readonly installedPluginNames_ = new Set<string>();
    private pluginsFinished_ = false;
    private readonly eventRegistry_ = new EventRegistry();
    private readonly sortedSystemsCache_ = new Map<Schedule, SystemEntry[]>();
    private error_handler_: ((error: unknown, systemName: string) => void) | null = null;
    private system_error_handler_: ((error: Error, systemName?: string) => 'continue' | 'pause') | null = null;
    private statsEnabled_ = false;
    private phaseTimings_: Map<string, number> | null = null;
    private frame_paused_ = false;
    private user_paused_ = false;
    private step_pending_ = false;
    private play_speed_ = 1.0;

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

    getPlugin<T extends Plugin>(ctor: new (...args: any[]) => T): T | undefined {
        return this.installed_plugins_.find((p): p is T => p instanceof ctor);
    }

    addPlugins(plugins: Plugin[]): this {
        const sorted = this.sortPlugins(plugins);
        for (const plugin of sorted) {
            this.addPlugin(plugin);
        }
        return this;
    }

    addPlugin(plugin: Plugin): this {
        if (this.installedPluginSet_.has(plugin)) return this;
        if (plugin.dependencies) {
            for (const dep of plugin.dependencies) {
                if (typeof dep === 'string') {
                    if (!this.installedPluginNames_.has(dep)) {
                        throw new Error(
                            `Plugin "${plugin.name ?? 'unknown'}" requires plugin "${dep}" which has not been installed`
                        );
                    }
                } else {
                    if (!this.hasResource(dep)) {
                        throw new Error(
                            `Plugin "${plugin.name ?? 'unknown'}" requires resource "${dep._name}" which has not been registered`
                        );
                    }
                }
            }
        }
        this.installedPluginSet_.add(plugin);
        this.installed_plugins_.push(plugin);
        if (plugin.name) {
            this.installedPluginNames_.add(plugin.name);
        }
        try {
            plugin.build(this);
        } catch (e) {
            this.installedPluginSet_.delete(plugin);
            this.installed_plugins_.pop();
            if (plugin.name) {
                this.installedPluginNames_.delete(plugin.name);
            }
            throw e;
        }
        return this;
    }

    addEvent<T>(event: EventDef<T>): this {
        this.eventRegistry_.register(event);
        return this;
    }

    // =========================================================================
    // Systems
    // =========================================================================

    addSystemToSchedule(
        schedule: Schedule,
        system: SystemDef,
        options?: { runBefore?: string[]; runAfter?: string[]; runIf?: RunCondition }
    ): this {
        const name = system._name || `System_${++this.systemCounter_}`;
        const scoped: SystemDef = {
            _id: Symbol(`System_${name}`),
            _params: system._params,
            _fn: system._fn,
            _name: name,
        };
        this.templateToRuntime_.set(system._id, scoped._id);

        this.systems_.get(schedule)!.push({
            system: scoped,
            runBefore: options?.runBefore,
            runAfter: options?.runAfter,
            runIf: options?.runIf,
        });
        this.sortedSystemsCache_.delete(schedule);
        return this;
    }

    addSystem(system: SystemDef): this {
        return this.addSystemToSchedule(Schedule.Update, system);
    }

    addStartupSystem(system: SystemDef): this {
        return this.addSystemToSchedule(Schedule.Startup, system);
    }

    /**
     * Register every system in `set` onto `schedule`. Each member inherits
     * the set's `runIf` (AND-combined with its own if supplied per-system
     * here), and its `runBefore` / `runAfter` lists are prepended to the
     * member's edges. Other systems may reference the set's name in their
     * own ordering; the scheduler expands those references to every member.
     */
    addSystemSetToSchedule(schedule: Schedule, set: SystemSet): this {
        const members: string[] = [];
        for (const sys of set._systems) {
            const name = sys._name || `System_${String(++this.systemCounter_)}`;
            members.push(name);

            const mergedRunBefore = set._runBefore ? [...set._runBefore] : undefined;
            const mergedRunAfter = set._runAfter ? [...set._runAfter] : undefined;
            const setCondition = set._runIf;
            const runIf: RunCondition | undefined = setCondition ? (() => setCondition()) : undefined;

            // Use the scoped system name the App would generate so ordering
            // lookups match. Mirrors addSystemToSchedule's naming path.
            const scoped: SystemDef = {
                _id: Symbol(`System_${name}`),
                _params: sys._params,
                _fn: sys._fn,
                _name: name,
            };
            this.templateToRuntime_.set(sys._id, scoped._id);

            this.systems_.get(schedule)!.push({
                system: scoped,
                runBefore: mergedRunBefore,
                runAfter: mergedRunAfter,
                runIf,
            });
        }
        this.sortedSystemsCache_.delete(schedule);

        const existing = this.setMembership_.get(set._name);
        this.setMembership_.set(set._name, existing ? [...existing, ...members] : members);
        return this;
    }

    /** Shortcut for `addSystemSetToSchedule(Schedule.Update, set)`. */
    addSystemSet(set: SystemSet): this {
        return this.addSystemSetToSchedule(Schedule.Update, set);
    }

    removeSystem(systemId: symbol): boolean {
        const runtimeId = this.templateToRuntime_.get(systemId) ?? systemId;
        let removed = false;
        for (const [schedule, entries] of this.systems_) {
            const filtered = entries.filter(e => e.system._id !== runtimeId);
            if (filtered.length !== entries.length) {
                this.systems_.set(schedule, filtered);
                this.sortedSystemsCache_.delete(schedule);
                removed = true;
            }
        }
        if (removed) {
            this.runner_?.evict(runtimeId);
            this.templateToRuntime_.delete(systemId);
        }
        return removed;
    }

    // =========================================================================
    // C++ Integration
    // =========================================================================

    connectCpp(
        cppRegistry: CppRegistry,
        module?: ESEngineModule,
        options?: BridgeConnectOptions,
    ): this {
        this.world_.connectCpp(cppRegistry, module, options);

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

    setPipeline(pipeline: RenderPipeline): void {
        this.pipeline_ = pipeline;
    }

    get spineInitPromise(): Promise<unknown> | undefined {
        return this.spineInitPromise_;
    }

    set spineInitPromise(p: Promise<unknown> | undefined) {
        this.spineInitPromise_ = p;
    }

    async waitForPhysics(): Promise<void> {
        if (!this.hasResource(PhysicsRuntime)) {
            log.warn('app', 'No PhysicsPlugin installed, waitForPhysics() is a no-op');
            return;
        }
        const promise = this.getResource(PhysicsRuntime).initPromise;
        if (promise) await promise;
    }

    get isPhysicsReady(): boolean {
        return this.hasResource(PhysicsRuntime)
            && this.getResource(PhysicsRuntime).module != null;
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

    setMaxDeltaTime(v: number): this {
        this.maxDeltaTime_ = v;
        return this;
    }

    setMaxFixedSteps(v: number): this {
        this.maxFixedSteps_ = v;
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

    onWasmError(handler: (error: unknown, context: string) => void): this {
        setWasmErrorHandler(handler);
        return this;
    }

    setPaused(paused: boolean): void {
        this.user_paused_ = paused;
    }

    isPaused(): boolean {
        return this.user_paused_;
    }

    stepFrame(): void {
        this.step_pending_ = true;
    }

    setPlaySpeed(speed: number): void {
        this.play_speed_ = Math.max(0.1, Math.min(4.0, speed));
    }

    setTargetFrameRate(fps: number): void {
        this.targetFrameInterval_ = fps > 0 ? 1000 / fps : 0;
    }

    getTargetFrameRate(): number {
        return this.targetFrameInterval_ > 0 ? 1000 / this.targetFrameInterval_ : 0;
    }

    getPlaySpeed(): number {
        return this.play_speed_;
    }

    // =========================================================================
    // Stats
    // =========================================================================

    enableStats(): this {
        this.statsEnabled_ = true;
        this.phaseTimings_ = new Map();
        this.runner_?.setTimingEnabled(true);
        return this;
    }

    getSystemTimings(): ReadonlyMap<string, number> | null {
        return this.runner_?.getTimings() ?? null;
    }

    getPhaseTimings(): ReadonlyMap<string, number> | null {
        return this.phaseTimings_;
    }

    getEntityCount(): number {
        return this.world_.entityCount();
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

    getResourceByName(name: string): unknown | undefined {
        const def = this.resources_.getByName(name);
        return def ? this.resources_.get(def) : undefined;
    }

    getResourceChangeTick(name: string): number {
        const def = this.resources_.getByName(name);
        return def ? this.resources_.getChangeTick(def) : 0;
    }

    getRegisteredResourceNames(): string[] {
        return this.resources_.getRegisteredNames();
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

    async tick(delta: number): Promise<void> {
        if (!this.runner_) {
            this.runner_ = new SystemRunner(this.world_, this.resources_, this.eventRegistry_);
            if (this.statsEnabled_) {
                this.runner_.setTimingEnabled(true);
            }
            if (!this.resources_.has(Time)) {
                this.resources_.insert(Time, { delta: 0, elapsed: 0, frameCount: 0 });
            }
            this.finishPlugins_();
        }

        await this.flushStartupSystems_();
        await this.runFrame_(delta);
    }

    async run(): Promise<void> {
        if (this.running_) {
            return;
        }

        this.running_ = true;
        if (!this.runner_) {
            this.runner_ = new SystemRunner(this.world_, this.resources_, this.eventRegistry_);
            if (this.statsEnabled_) {
                this.runner_.setTimingEnabled(true);
            }
            if (!this.resources_.has(Time)) {
                this.resources_.insert(Time, { delta: 0, elapsed: 0, frameCount: 0 });
            }
            this.finishPlugins_();
        }
        await this.flushStartupSystems_();

        this.lastTime_ = platformNow();
        this.mainLoop();
    }

    private mainLoop = async (): Promise<void> => {
        if (!this.running_) {
            return;
        }

        const currentTime = platformNow();
        const deltaMs = currentTime - this.lastTime_;

        if (this.targetFrameInterval_ > 0 && deltaMs < this.targetFrameInterval_) {
            requestAnimationFrame(this.mainLoop);
            return;
        }

        this.lastTime_ = currentTime;

        const rawDelta = Math.min(deltaMs / 1000, this.maxDeltaTime_);
        const delta = rawDelta * this.play_speed_;

        await this.flushStartupSystems_();
        await this.runFrame_(delta);

        requestAnimationFrame(this.mainLoop);
    };

    quit(): void {
        this.running_ = false;

        for (let i = this.installed_plugins_.length - 1; i >= 0; i--) {
            try { this.installed_plugins_[i].cleanup?.(this); } catch (e) {
                log.error('app', 'Plugin cleanup error', e);
            }
        }
        this.installed_plugins_.length = 0;
        this.installedPluginSet_.clear();
        this.installedPluginNames_.clear();

        for (const entity of this.world_.getAllEntities()) {
            try { this.world_.despawn(entity); } catch (e) { log.warn('app', 'Shutdown despawn error', e); }
        }
        this.world_.disconnectCpp();

        for (const [, entries] of this.systems_) {
            entries.length = 0;
        }
        this.sortedSystemsCache_.clear();
        this.templateToRuntime_.clear();
        this.systemCounter_ = 0;

        this.pipeline_ = null;
        this.runner_ = null;
        this.module_ = null;
    }

    // =========================================================================
    // Internal
    // =========================================================================

    private async runFrame_(delta: number): Promise<void> {
        this.runner_?.clearTimings();
        this.phaseTimings_?.clear();
        this.eventRegistry_.swapAll();
        this.world_.advanceTick();
        this.updateTime(delta);
        this.world_.resetQueryPool();
        this.frame_paused_ = false;

        if (this.user_paused_ && !this.step_pending_) {
            await this.runSchedule(Schedule.Last);
        } else {
            await this.runSchedule(Schedule.First);

            this.fixedAccumulator_ += delta;
            let fixedSteps = 0;
            while (this.fixedAccumulator_ >= this.fixedTimestep_ && fixedSteps < this.maxFixedSteps_) {
                this.fixedAccumulator_ -= this.fixedTimestep_;
                await this.runSchedule(Schedule.FixedPreUpdate);
                await this.runSchedule(Schedule.FixedUpdate);
                await this.runSchedule(Schedule.FixedPostUpdate);
                fixedSteps++;
            }
            if (fixedSteps >= this.maxFixedSteps_) {
                this.fixedAccumulator_ = this.fixedTimestep_;
            }

            await this.runSchedule(Schedule.PreUpdate);
            await this.runSchedule(Schedule.Update);
            await this.runSchedule(Schedule.PostUpdate);
            await this.runSchedule(Schedule.Last);

            if (this.step_pending_) {
                this.step_pending_ = false;
            }
        }

        const REMOVED_BUFFER_RETENTION = 2;
        this.world_.cleanRemovedBuffer(this.world_.getWorldTick() - REMOVED_BUFFER_RETENTION);
    }

    private finishPlugins_(): void {
        if (this.pluginsFinished_) return;
        this.pluginsFinished_ = true;
        for (const plugin of this.installed_plugins_) {
            try { plugin.finish?.(this); } catch (e) {
                log.error('app', `Plugin "${plugin.name ?? 'unknown'}" finish error`, e);
            }
        }
    }

    private sortPlugins(plugins: Plugin[]): Plugin[] {
        if (plugins.length <= 1) return plugins;

        const nameToIndex = new Map<string, number>();
        for (let i = 0; i < plugins.length; i++) {
            const name = plugins[i].name;
            if (name) {
                if (nameToIndex.has(name)) {
                    log.warn('app', `Duplicate plugin name "${name}" at indices ${nameToIndex.get(name)} and ${i}`);
                }
                nameToIndex.set(name, i);
            }
        }

        const edges = new Map<number, Set<number>>();
        for (let i = 0; i < plugins.length; i++) {
            edges.set(i, new Set());
        }

        for (let i = 0; i < plugins.length; i++) {
            const plugin = plugins[i];
            if (plugin.dependencies) {
                for (const dep of plugin.dependencies) {
                    if (typeof dep !== 'string') continue;
                    const depIndex = nameToIndex.get(dep);
                    if (depIndex !== undefined) {
                        edges.get(i)!.add(depIndex);
                    }
                }
            }
            if (plugin.after) {
                for (const target of plugin.after) {
                    const targetIndex = nameToIndex.get(target);
                    if (targetIndex !== undefined) {
                        edges.get(i)!.add(targetIndex);
                    }
                }
            }
            if (plugin.before) {
                for (const target of plugin.before) {
                    const targetIndex = nameToIndex.get(target);
                    if (targetIndex !== undefined) {
                        edges.get(targetIndex)!.add(i);
                    }
                }
            }
        }

        const sorted: Plugin[] = [];
        const visited = new Set<number>();
        const visiting = new Set<number>();
        const path: number[] = [];

        const visit = (index: number): void => {
            if (visited.has(index)) return;
            if (visiting.has(index)) {
                const cycleStart = path.indexOf(index);
                const cycle = path.slice(cycleStart).concat(index);
                const names = cycle.map(i => plugins[i].name ?? `<index ${i}>`);
                throw new Error(`Circular plugin dependency: ${names.join(' -> ')}`);
            }
            visiting.add(index);
            path.push(index);
            for (const dep of edges.get(index)!) {
                visit(dep);
            }
            path.pop();
            visiting.delete(index);
            visited.add(index);
            sorted.push(plugins[index]);
        };

        for (let i = 0; i < plugins.length; i++) {
            visit(i);
        }
        return sorted;
    }

    private sortSystems(systems: SystemEntry[]): SystemEntry[] {
        if (systems.length <= 1) {
            return systems;
        }

        const nameToIndex = new Map<string, number>();
        for (let i = 0; i < systems.length; i++) {
            nameToIndex.set(systems[i].system._name, i);
        }

        // Expand a name that may refer to a SystemSet into the indices of
        // every member of the set that is also in this schedule. Returns
        // empty when the name matches neither a system nor a known set.
        const resolveTargets = (name: string): number[] => {
            const direct = nameToIndex.get(name);
            if (direct !== undefined) return [direct];
            const members = this.setMembership_.get(name);
            if (!members) return [];
            const out: number[] = [];
            for (const m of members) {
                const idx = nameToIndex.get(m);
                if (idx !== undefined) out.push(idx);
            }
            return out;
        };

        // Build a local dependency graph: `adj[i]` lists indices that must run
        // *before* system `i`. Both runBefore and runAfter feed into the same
        // structure — runBefore is translated symmetrically into
        // "target depends on me" without mutating the caller's SystemEntry
        // objects (the old path appended to target.runAfter, leaving duplicated
        // edges across repeat sorts).
        const adj: number[][] = systems.map(() => []);
        const addEdge = (from: number, to: number) => {
            if (from === to) return;
            const list = adj[to];
            if (!list.includes(from)) list.push(from);
        };

        for (let i = 0; i < systems.length; i++) {
            const e = systems[i];
            if (e.runAfter) {
                for (const depName of e.runAfter) {
                    for (const j of resolveTargets(depName)) addEdge(j, i);
                }
            }
            if (e.runBefore) {
                for (const targetName of e.runBefore) {
                    for (const j of resolveTargets(targetName)) addEdge(i, j);
                }
            }
        }

        // DFS topological sort with path-aware cycle reporting.
        // color: 0 = unvisited, 1 = in the current DFS stack (GRAY), 2 = done.
        const GRAY = 1, BLACK = 2;
        const color = new Uint8Array(systems.length);
        const stack: number[] = [];
        const sorted: SystemEntry[] = [];

        const visit = (index: number): void => {
            if (color[index] === BLACK) return;
            if (color[index] === GRAY) {
                const cycleStart = stack.indexOf(index);
                const path = stack.slice(cycleStart).map(i => systems[i].system._name);
                path.push(systems[index].system._name);
                throw new Error(`Circular system dependency: ${path.join(' → ')}`);
            }
            color[index] = GRAY;
            stack.push(index);
            for (const dep of adj[index]) visit(dep);
            stack.pop();
            color[index] = BLACK;
            sorted.push(systems[index]);
        };

        for (let i = 0; i < systems.length; i++) visit(i);
        return sorted;
    }

    private flushing_startup_ = false;

    private async flushStartupSystems_(): Promise<void> {
        if (this.flushing_startup_) return;
        const startup = this.systems_.get(Schedule.Startup)!;
        if (startup.length === 0) return;
        this.flushing_startup_ = true;
        try {
            await this.runSchedule(Schedule.Startup);
            startup.length = 0;
            this.sortedSystemsCache_.delete(Schedule.Startup);
        } finally {
            this.flushing_startup_ = false;
        }
    }

    private async runSchedule(schedule: Schedule): Promise<void> {
        const rawSystems = this.systems_.get(schedule);
        if (!rawSystems || !this.runner_ || this.frame_paused_) {
            return;
        }

        let systems = this.sortedSystemsCache_.get(schedule);
        if (!systems) {
            if (rawSystems.some(s => s.runBefore || s.runAfter)) {
                systems = this.sortSystems(rawSystems);
            } else {
                systems = rawSystems;
            }
            this.sortedSystemsCache_.set(schedule, systems);
        }

        const t0 = this.phaseTimings_ ? performance.now() : 0;

        for (const entry of systems) {
            if (entry.runIf && !entry.runIf()) continue;
            try {
                const result = this.runner_.run(entry.system);
                if (result instanceof Promise) {
                    await result;
                }
            } catch (e) {
                const name = entry.system._name;
                log.error('app', `System "${name}" threw an error`, e);
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

        if (this.phaseTimings_) {
            this.phaseTimings_.set(Schedule[schedule], performance.now() - t0);
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

    app.connectCpp(cppRegistry, module, { strict: true });

    if (options?.glContextHandle) {
        module.initRendererWithContext(options.glContextHandle);
    } else {
        module.initRenderer();
    }

    app.addPlugin(corePlugin);
    app.setPipeline(new RenderPipeline());
    app.insertResource(UICameraInfo, { ...DEFAULT_UI_CAMERA_INFO });
    app.addPlugin(cameraPlugin(options?.getViewportSize));
    app.addPlugin(assetPlugin);
    app.addPlugin(prefabsPlugin);
    app.addPlugin(inputPlugin);
    app.addPlugin(sceneManagerPlugin);
    if (options?.plugins) {
        app.addPlugins(options.plugins);
    }

    return app;
}

export function flushPendingSystems(app: App): void {
    const drained = getDefaultContext().drainPendingSystems();
    for (const entry of drained) {
        app.addSystemToSchedule(entry.schedule as Schedule, entry.system as SystemDef);
    }
}

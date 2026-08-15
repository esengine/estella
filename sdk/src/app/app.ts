// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    app.ts
 * @brief   Application builder and web platform integration
 */

import { World } from '../ecs/world';
import { Schedule, SystemDef, SystemRunner, SystemSet, mergeOrderingEdges, rescopeSystem, type RunCondition } from '../ecs/system';
import { ResourceStorage, Time, TimeData, type ResourceDef } from '../ecs/resource';
import { EventRegistry, type EventDef } from '../ecs/event';
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { BridgeConnectOptions } from '../ecs/bridge/BuiltinBridge';
import { UICameraInfo } from '../ui/core/ui-camera-info';
import { inputPlugin, Input } from '../input/input';
import { assetPlugin } from '../asset';
import { prefabsPlugin } from '../prefab/prefabServer';
import { setWasmErrorHandler } from '../wasm/wasmError';
import { corePlugin, DEFAULT_UI_CAMERA_INFO } from './corePlugin';
import {
    ancestors,
    dependencyEdges,
    detectAmbiguities,
    parallelBatches,
    type Ambiguity,
    type ResolveTargets,
} from './ambiguity';
import { accessOf, conflicts, type SystemAccess } from './access';
import { platformNow } from '../platform';
import { RenderPipeline } from '../render/renderPipeline';
import type { SceneConfig } from '../scene/sceneManager';
import { SceneManager } from '../scene/sceneManager';
import { sceneManagerPlugin } from '../scene/scenePlugin';
import { getDefaultContext } from '../ecs/context';
import { setLinearColorSpace } from '../ecs/env';
import { seedEngineComponents } from '../ecs/component';
import { cameraPlugin } from '../camera/CameraPlugin';
import { ScreenScaling, SCREEN_FIT_OFF, type ScreenScalingData } from '../camera/ScreenScaling';
import { PhysicsRuntime } from '../physics/PhysicsRuntime';
import { SubsystemRegistry } from './subsystems';
import { DOMAIN_SCRIPTS, DOMAIN_UNATTRIBUTED, type ScopeCost, type ScopeRemainder, type SystemCost } from './frameProfile';
import type { SideModuleHost } from '../sideModules/host';
import { watchWebGPUDeviceLoss } from '../render/renderer';
import { log } from '../util/logger';

// =============================================================================
// Plugin Interface
// =============================================================================

export type PluginDependency = string | ResourceDef<any>;

export interface Plugin {
    name?: string;
    dependencies?: PluginDependency[];
    before?: string[];
    after?: string[];
    /** Cost domain the profiler files this plugin's systems under. Defaults to
     *  `name`; declare it where the two differ, as `camera` producing `render`. */
    profileDomain?: string;
    build(app: App): void;
    finish?(app: App): void;
    cleanup?(app?: App): void;
}

// =============================================================================
// System Entry
// =============================================================================

export type { RunCondition };

/** One frame's costs, attributed. The input `buildFrameProfile` folds. */
export interface FrameCosts {
    systems: SystemCost[];
    scopes: ScopeCost[];
}

/** A system still running, and what decides who may start beside it. */
interface InflightSystem {
    /** Its position in the sorted list — how a dependant recognises it. */
    index: number;
    access: SystemAccess;
    done: Promise<void>;
}

interface SystemEntry {
    system: SystemDef;
    runBefore?: string[];
    runAfter?: string[];
    runIf?: RunCondition;
    /** The subsystem (owning plugin name) this system belongs to — pets that
     *  subsystem's liveness watchdog when it runs (observability). */
    subsystem?: string;
    /** Came through the project bundle's pending-systems drain — the set hot
     *  reload may swap. "No owning subsystem" is NOT that set: engine systems
     *  registered lazily outside a plugin build (the physics event bridge, the
     *  hot-update rebind) carry no subsystem either, and mistaking them for
     *  user systems vetoed every hot swap in any project that had physics. */
    fromBundle?: boolean;
    /** Cost domain, from the building plugin or the door it came through. */
    domain: string;
}

/**
 * How a rejected schedule reads back to whoever wrote it. The two mistakes that
 * get here look nothing alike in the source and identically at runtime, so the
 * message has to tell them apart: a member that does not exist arrives as
 * `undefined`, and swapped arguments arrive as the system itself.
 */
function describeSchedule(value: unknown): string {
    if (value === undefined) return 'undefined (no such Schedule member?)';
    if (value === null) return 'null';
    if (typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
    const name = (value as { _name?: unknown } | null)?._name;
    if (typeof name === 'string') return `the system "${name}" (arguments the wrong way round?)`;
    return Object.prototype.toString.call(value);
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
    // Spiral-of-death guard: cap wall time spent on fixed-step catch-up per frame.
    // A sim too heavy to run real-time (e.g. thousands of bodies) then degrades to
    // slow motion instead of freezing — the frame stays responsive. The first step
    // always runs (the check is after a step), so the sim always advances.
    private fixedStepBudgetMs_ = 8;
    private targetFrameInterval_ = 0;

    private module_: ESEngineModule | null = null;
    private pipeline_: RenderPipeline | null = null;
    private spineInitPromise_?: Promise<unknown>;
    private readonly installed_plugins_: Plugin[] = [];
    private readonly installedPluginSet_ = new Set<Plugin>();
    private readonly installedPluginNames_ = new Set<string>();
    // Per-App (per-realm) so isolated realms never alias; not a shared resource default.
    private readonly subsystems_ = new SubsystemRegistry();
    /** The plugin currently in build(), so systems it adds inherit its name for
     *  liveness reporting. Null outside a build. */
    private buildingPlugin_: string | null = null;
    /** The cost domain of that plugin, which is its name unless it declared one. */
    private buildingDomain_: string | null = null;
    private addingBundleSystems_ = false;
    // The realm's acquirer for optional native modules (physics, spine). Set once
    // at app creation; physics/spine self-gate off it. Null in headless/test apps.
    private sideModules_: SideModuleHost | null = null;
    private pluginsFinished_ = false;
    private readonly eventRegistry_ = new EventRegistry();
    private readonly sortedSystemsCache_ = new Map<Schedule, SystemEntry[]>();
    /** Transitive ordering, per schedule. Invalidated with the sort it follows. */
    private readonly dependencyCache_ = new Map<Schedule, Set<number>[]>();
    private error_handler_: ((error: unknown, systemName: string) => void) | null = null;
    private system_error_handler_: ((error: Error, systemName?: string) => 'continue' | 'pause') | null = null;
    private statsEnabled_ = false;
    private phaseTimings_: Map<string, number> | null = null;
    // Sub-frame CPU scopes inside a single system (e.g. the render system's
    // resolveCameras / submit split) — the JS-side sibling of the engine's C++
    // ES_PROFILE_SCOPE. Null unless stats are on; same per-frame lifecycle as
    // phaseTimings_ (cleared at tick start, read after the tick).
    private frameScopes_: Map<string, ScopeCost> | null = null;
    /** The system being run, so a scope opened inside one is filed under it. */
    private currentSystem_ = '';
    private readonly frameObservers_: Array<(dtMs: number) => void> = [];
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

    /** Subsystem lifecycle registry ("which modules loaded/ready/stepping/errored").
     *  Named plugins auto-register in {@link addPlugin}; async plugins (physics)
     *  drive their own initializing→ready/error transitions. */
    get subsystems(): SubsystemRegistry {
        return this.subsystems_;
    }

    /** The realm's optional-native-module acquirer (physics, spine). Physics and
     *  spine pull their wasm from here, so a realm wires its transport once
     *  (fetch / inlined / WeChat) and every subsystem follows. */
    get sideModules(): SideModuleHost | null {
        return this.sideModules_;
    }

    setSideModules(host: SideModuleHost): void {
        this.sideModules_ = host;
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
            // Observable from frame zero; string deps give the status UI cascade context.
            this.subsystems_.register(plugin.name, {
                dependsOn: plugin.dependencies?.filter(
                    (d): d is string => typeof d === 'string',
                ),
            });
        }
        const prevBuilding = this.buildingPlugin_;
        const prevDomain = this.buildingDomain_;
        this.buildingPlugin_ = plugin.name ?? null;
        this.buildingDomain_ = plugin.profileDomain ?? plugin.name ?? null;
        try {
            plugin.build(this);
            // Sync plugin: live once build() returns → promote. An async plugin
            // (physics) already moved itself off `registered`, so this skips it.
            if (plugin.name && this.subsystems_.phaseOf(plugin.name) === 'registered') {
                this.subsystems_.transition(plugin.name, 'ready');
            }
        } catch (e) {
            this.installedPluginSet_.delete(plugin);
            this.installed_plugins_.pop();
            if (plugin.name) {
                this.installedPluginNames_.delete(plugin.name);
                // Keep the errored (now-uninstalled) entry so the failure stays visible.
                this.subsystems_.markError(plugin.name, e instanceof Error ? e.message : String(e));
            }
            throw e;
        } finally {
            this.buildingPlugin_ = prevBuilding;
            this.buildingDomain_ = prevDomain;
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

    /**
     * The entry list for `schedule`, or a refusal that says what was wrong.
     *
     * Every valid schedule gets its list in the constructor, so a miss means the
     * caller passed something that is not a Schedule — a member that does not
     * exist (`Schedule.LateUpdate` evaluates to `undefined`), or the two
     * arguments the wrong way round. Neither is caught before it runs: the
     * editor and the mini-game exporters bundle project code with esbuild, which
     * strips types without checking them, so a registration TypeScript would
     * have rejected reaches the App intact.
     *
     * It used to be `systems_.get(schedule)!`, which turned both into "Cannot
     * read properties of undefined (reading 'push')" thrown from inside a
     * minified bundle, naming neither the system nor the value.
     */
    private registeringDomain_(): string {
        if (this.buildingDomain_) return this.buildingDomain_;
        return this.addingBundleSystems_ ? DOMAIN_SCRIPTS : DOMAIN_UNATTRIBUTED;
    }

    private scheduleBucket_(schedule: Schedule, systemName: string): SystemEntry[] {
        const bucket = this.systems_.get(schedule);
        if (bucket) return bucket;
        const valid = Object.entries(Schedule)
            .filter(([, v]) => typeof v === 'number')
            .map(([k, v]) => `${k} (${String(v)})`)
            .join(', ');
        throw new Error(
            `addSystemToSchedule("${systemName}"): ${describeSchedule(schedule)} is not a schedule. `
            + `Expected one of: ${valid}. `
            + `Check the Schedule member exists, and that the schedule comes before the system.`,
        );
    }

    /**
     * Register `system` onto `schedule`. Ordering given here is added to
     * whatever the definition already declared, so a system can carry its own
     * edges and still be constrained further at the registration site.
     */
    addSystemToSchedule(
        schedule: Schedule,
        system: SystemDef,
        options?: { runBefore?: string[]; runAfter?: string[]; runIf?: RunCondition }
    ): this {
        const name = system._name || `System_${++this.systemCounter_}`;
        const scoped = rescopeSystem(system, name);
        this.templateToRuntime_.set(system._id, scoped._id);

        this.scheduleBucket_(schedule, name).push({
            system: scoped,
            runBefore: mergeOrderingEdges(system._runBefore, options?.runBefore),
            runAfter: mergeOrderingEdges(system._runAfter, options?.runAfter),
            runIf: options?.runIf,
            subsystem: this.buildingPlugin_ ?? undefined,
            fromBundle: this.addingBundleSystems_ || undefined,
            domain: this.registeringDomain_(),
        });
        this.sortedSystemsCache_.delete(schedule);
        this.dependencyCache_.delete(schedule);
        return this;
    }

    addSystem(system: SystemDef): this {
        return this.addSystemToSchedule(Schedule.Update, system);
    }

    /**
     * Register systems drained from the PROJECT BUNDLE, marking them as the set
     * hot reload may swap. The bundle drain is the one boundary that separates
     * user-authored systems from everything the engine registers — plugin
     * builds tag themselves, but lazily-added engine systems are told apart
     * from user code only by which door they came through.
     * @internal
     */
    addBundleSystems(entries: ReadonlyArray<{ schedule: number; system: SystemDef | SystemSet }>): this {
        this.addingBundleSystems_ = true;
        try {
            for (const e of entries) {
                // A set expands to its members here, so everything downstream —
                // hot reload included — still sees a flat list of user systems.
                if ((e.system as SystemSet)._kind === 'set') {
                    this.addSystemSetToSchedule(e.schedule as Schedule, e.system as SystemSet);
                } else {
                    this.addSystemToSchedule(e.schedule as Schedule, e.system as SystemDef);
                }
            }
        } finally {
            this.addingBundleSystems_ = false;
        }
        return this;
    }

    addStartupSystem(system: SystemDef): this {
        return this.addSystemToSchedule(Schedule.Startup, system);
    }

    /**
     * Hot-swap the project's (user-authored) system function bodies in place, keeping
     * the live World/Registry/entities — the state-preserving hot-reload fast path
     * (RC10 P3). `incoming` is the freshly re-imported bundle's drained systems.
     *
     * Returns false when the structure changed — a user system was added, removed, or
     * renamed, or a schedule's user-system count differs — because the running systems
     * then no longer line up with the new code, so the caller must full-reload instead.
     * Builtin/plugin systems (those with an owning subsystem) are never touched. The
     * match validates fully before mutating, so a rejected swap leaves the scheduler
     * untouched (no torn half-swap). Component identity is stable by name (see
     * component.ts), so the new functions' queries resolve to the live storage.
     */
    hotSwapSystems(incoming: ReadonlyArray<{ schedule: number; system: SystemDef }>): boolean {
        const bySchedule = new Map<Schedule, SystemDef[]>();
        for (const e of incoming) {
            const arr = bySchedule.get(e.schedule as Schedule);
            if (arr) arr.push(e.system);
            else bySchedule.set(e.schedule as Schedule, [e.system]);
        }
        const userEntries = (s: Schedule): SystemEntry[] =>
            (this.systems_.get(s) ?? []).filter((entry) => entry.fromBundle === true);

        // Startup is exempt from matching in both directions: its entries are
        // CONSUMED when they run (flushStartupSystems truncates the list), so the
        // live side is always empty while a re-imported bundle always queues them
        // again — requiring a match would veto hot swap for every project that
        // uses addStartupSystem. There is nothing to swap either way: a startup
        // body can only run on a cold start, so an edited one takes effect on the
        // next full reload, which is the only time it could.
        // Each rejection names the mismatch: "the structure changed" alone reads
        // as a hot reload that arbitrarily lost the World.
        for (const [schedule, defs] of bySchedule) {
            if (schedule === Schedule.Startup) continue;
            const live = userEntries(schedule);
            if (live.length !== defs.length) {
                log.info('hotReload', `structure: schedule ${Schedule[schedule]} has ${live.length} live user system(s) [${live.map((e) => e.system._name).join(', ')}] vs ${defs.length} incoming [${defs.map((d) => d._name || '(unnamed)').join(', ')}]`);
                return false;
            }
            for (let i = 0; i < live.length; i++) {
                if (!App.systemNamesCompatible(live[i].system._name, defs[i]._name)) {
                    log.info('hotReload', `structure: schedule ${Schedule[schedule]} system #${i} renamed "${live[i].system._name}" -> "${defs[i]._name || '(unnamed)'}"`);
                    return false;
                }
            }
        }
        // A schedule that had user systems the new bundle didn't re-add is structural.
        for (const [schedule, entries] of this.systems_) {
            if (schedule === Schedule.Startup) continue;
            if (!bySchedule.has(schedule) && entries.some((e) => e.fromBundle === true)) {
                log.info('hotReload', `structure: schedule ${Schedule[schedule]} lost its user systems in the new bundle`);
                return false;
            }
        }

        for (const [schedule, defs] of bySchedule) {
            if (schedule === Schedule.Startup) continue;
            const live = userEntries(schedule);
            for (let i = 0; i < live.length; i++) {
                const cur = live[i].system;
                live[i].system = { _id: cur._id, _params: defs[i]._params, _fn: defs[i]._fn, _name: cur._name };
            }
            this.sortedSystemsCache_.delete(schedule);
        this.dependencyCache_.delete(schedule);
        }
        return true;
    }

    /** A live (scoped) system name and a re-imported raw name refer to the same system
     *  if the live one is an explicit name that matches, or both are auto-named (the
     *  live `System_N` placeholder ⇔ an unnamed re-import). */
    private static systemNamesCompatible(liveName: string, rawName: string): boolean {
        return /^System_\d+$/.test(liveName) ? rawName === '' : rawName === liveName;
    }

    /**
     * Register every system in `set` onto `schedule`. Each member gets the set's
     * `runIf`, and the set's `runBefore` / `runAfter` edges on top of any it
     * declared itself; members keep the order they were listed in. Other systems
     * may reference the set's name in their own ordering, and the scheduler
     * expands those references to every member.
     */
    addSystemSetToSchedule(schedule: Schedule, set: SystemSet): this {
        const members: string[] = [];
        for (const sys of set._systems) {
            const name = sys._name || `System_${String(++this.systemCounter_)}`;
            members.push(name);

            const mergedRunBefore = mergeOrderingEdges(sys._runBefore, set._runBefore);
            const mergedRunAfter = mergeOrderingEdges(sys._runAfter, set._runAfter);
            const setCondition = set._runIf;
            const runIf: RunCondition | undefined = setCondition ? (() => setCondition()) : undefined;

            // Use the scoped system name the App would generate so ordering
            // lookups match. Mirrors addSystemToSchedule's naming path.
            const scoped = rescopeSystem(sys, name);
            this.templateToRuntime_.set(sys._id, scoped._id);

            this.scheduleBucket_(schedule, name).push({
                system: scoped,
                runBefore: mergedRunBefore,
                runAfter: mergedRunAfter,
                runIf,
                subsystem: this.buildingPlugin_ ?? undefined,
                domain: this.registeringDomain_(),
            });
        }
        this.sortedSystemsCache_.delete(schedule);
        this.dependencyCache_.delete(schedule);

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
        this.dependencyCache_.delete(schedule);
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

    /**
     * Bind the app to an engine core. Part of the embedding contract, which is
     * `esengine/wasm` — a host builds the module and calls this; a game is
     * handed an App that is already connected.
     *
     * @internal
     */
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

    /** @internal */
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

    /** The fixed-update timestep (seconds) — the FixedUpdate / physics cadence. */
    getFixedTimestep(): number {
        return this.fixedTimestep_;
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
        this.frameScopes_ = new Map();
        this.runner_?.setTimingEnabled(true);
        return this;
    }

    getSystemTimings(): ReadonlyMap<string, number> | null {
        return this.runner_?.getTimings() ?? null;
    }

    getPhaseTimings(): ReadonlyMap<string, number> | null {
        return this.phaseTimings_;
    }

    /**
     * Sub-frame CPU scopes recorded this frame via {@link measureFrameScope} —
     * the finer breakdown within a single system, keyed by scope name. Null when
     * stats aren't enabled. Sibling of {@link getSystemTimings} /
     * {@link getPhaseTimings}; surfaces as the profiler's `js.*` rows.
     */
    getFrameScopes(): ReadonlyMap<string, number> | null {
        if (!this.frameScopes_) return null;
        const flat = new Map<string, number>();
        for (const [name, scope] of this.frameScopes_) flat.set(name, scope.ms);
        return flat;
    }

    /**
     * This frame's costs with the attribution a profile tree needs: which domain
     * owns each system, which system each scope ran inside. Null when stats are
     * off. Feed to `buildFrameProfile`, which is where the tree is derived.
     */
    getFrameCosts(): FrameCosts | null {
        if (!this.frameScopes_) return null;
        const timings = this.runner_?.getTimings();
        const domains = new Map<string, string>();
        for (const entries of this.systems_.values()) {
            for (const entry of entries) domains.set(entry.system._name, entry.domain);
        }
        const queryCosts = this.runner_?.getQueryCosts();
        const systems: SystemCost[] = [];
        for (const [name, ms] of timings ?? []) {
            const query = queryCosts?.get(name);
            systems.push({
                name,
                ms,
                domain: domains.get(name) ?? DOMAIN_UNATTRIBUTED,
                ...(query ? { query } : {}),
            });
        }
        return { systems, scopes: [...this.frameScopes_.values()] };
    }

    /**
     * Time `fn` as a named sub-frame scope (accumulated if the name repeats in a
     * frame). A no-op passthrough when stats are off, so shipped games pay only a
     * single branch. Use it to split a heavy system into attributable pieces.
     *
     * `remainder: 'wait'` declares that whatever time is left under this scope
     * once its native scopes are subtracted is CPU blocked, not work — the
     * swapchain block a GPU submit absorbs, or an await. The profiler keeps such
     * time out of every cost total instead of reporting it as a hotspot.
     */
    measureFrameScope<T>(name: string, fn: () => T, options?: { remainder?: ScopeRemainder }): T {
        const scopes = this.frameScopes_;
        if (!scopes) return fn();
        const t0 = performance.now();
        try {
            return fn();
        } finally {
            const elapsed = performance.now() - t0;
            const prev = scopes.get(name);
            scopes.set(name, {
                name,
                ms: (prev?.ms ?? 0) + elapsed,
                system: prev?.system ?? this.currentSystem_,
                remainder: options?.remainder ?? 'work',
            });
        }
    }

    /**
     * Observe the end of every frame, once its systems have run and its timings
     * are final. Returns a disposer.
     *
     * A broadcast, not a slot: a recorder and a game's own budget alarm both
     * watch without either taking the hook from the other.
     */
    onFrameEnd(fn: (dtMs: number) => void): () => void {
        this.frameObservers_.push(fn);
        return () => {
            const i = this.frameObservers_.indexOf(fn);
            if (i >= 0) this.frameObservers_.splice(i, 1);
        };
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
                this.resources_.insert(Time, { delta: 0, elapsed: 0, frameCount: 0, fixedDelta: this.fixedTimestep_, fixedAlpha: 0, fixedTick: 0, scale: 1, unscaledDelta: 0 });
            }
            this.finishPlugins_();
        }

        await this.flushStartupSystems_();
        await this.runFrame_(delta);
    }

    /**
     * Advance exactly `frames` frames of exactly `dt` seconds, with the rAF loop held
     * off for the duration — "let the game run a bit", made reproducible.
     *
     * The loop it replaces is wall-clock and browser-scheduled: a backgrounded tab is
     * throttled to about one frame a second, so an observer that steps by waiting sees
     * a frozen game and concludes the game is broken. Worse, there was no other door —
     * a driver that needed the next 30 frames of simulation had to reach for
     * `runFrame_`, and reaching for a private method is a thing that keeps working
     * until the day it doesn't.
     *
     * A PAUSED app still steps here: advancing frame by frame is exactly what stepping
     * a paused game means. The pause (and the loop) are restored afterwards, with the
     * clock re-based so the first resumed frame is not handed the whole excursion as
     * its delta.
     */
    async stepFrames(frames = 1, dt = 1 / 60): Promise<void> {
        const wasRunning = this.running_;
        const wasPaused = this.user_paused_;
        // The in-flight rAF callback returns without rescheduling, so nothing else
        // ticks the world while this runs.
        this.running_ = false;
        this.user_paused_ = false;
        try {
            for (let i = 0; i < frames; i++) await this.tick(dt);
        } finally {
            this.user_paused_ = wasPaused;
            if (wasRunning) {
                this.lastTime_ = platformNow();
                this.running_ = true;
                // Resumed on the next animation frame, not by starting one here:
                // a frame begun inside this call's own microtask drain swallows
                // the input edge a caller injects the moment it returns.
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(this.mainLoop);
                else void this.mainLoop();
            }
        }
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
                this.resources_.insert(Time, { delta: 0, elapsed: 0, frameCount: 0, fixedDelta: this.fixedTimestep_, fixedAlpha: 0, fixedTick: 0, scale: 1, unscaledDelta: 0 });
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

    quit(options?: { keepRenderer?: boolean }): void {
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
        this.dependencyCache_.clear();
        this.templateToRuntime_.clear();
        this.systemCounter_ = 0;

        this.pipeline_ = null;
        this.runner_ = null;
        // Tear down the C++ engine context too: previously quit() only cleared
        // JS state and dropped the module reference, so the EstellaContext was
        // never shut down — it leaked its GPU subsystems + WebGL context, and a
        // later init silently reused the stale (still-"initialized") singleton.
        // shutdownRenderer is null-safe (no-op if no renderer was initialized).
        // `keepRenderer` skips it: hot-reload rebuilds the App but reuses the live
        // module + GL + renderer (EstellaContext::shutdown destroys the WebGL
        // context), so only a full quit tears the renderer down.
        if (!options?.keepRenderer) {
            this.module_?.shutdownRenderer?.();
            this.module_ = null;
        }
    }

    // =========================================================================
    // Internal
    // =========================================================================

    private async runFrame_(delta: number): Promise<void> {
        this.runner_?.clearTimings();
        this.phaseTimings_?.clear();
        this.frameScopes_?.clear();
        this.eventRegistry_.swapAll();
        this.world_.advanceTick();
        this.updateTime(delta);
        this.world_.resetQueryPool();
        this.frame_paused_ = false;

        if (this.user_paused_ && !this.step_pending_) {
            await this.runSchedule(Schedule.Last);
        } else {
            await this.runSchedule(Schedule.First);

            // The SCALED delta, so Time.scale = 0 stops the fixed steps too —
            // otherwise physics would keep stepping through a paused world.
            this.fixedAccumulator_ += this.resources_.get(Time).delta;
            let fixedSteps = 0;
            // Fixed steps read the input edge mirrors (which persist across frames
            // until a step consumes them) so a press on a sub-timestep frame isn't
            // lost and a catch-up frame doesn't replay it. Null when no input plugin
            // is installed (headless / bare App).
            const input = this.resources_.has(Input) ? this.resources_.get(Input) : null;
            // Direct performance.now() (not platformNow) so the budget guard needs
            // no platform init (unit tests call tick() without it) and degrades to a
            // no-op where performance is absent — the maxFixedSteps cap still applies.
            const perf = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance : null;
            const fixedStart = perf ? perf.now() : 0;
            while (this.fixedAccumulator_ >= this.fixedTimestep_ && fixedSteps < this.maxFixedSteps_) {
                this.fixedAccumulator_ -= this.fixedTimestep_;
                // Every system inside one fixed step sees the same tick number
                // (1-based) — the simulation time axis netcode stamps packets with.
                this.resources_.get(Time).fixedTick++;
                input?.beginFixedStep();
                await this.runSchedule(Schedule.FixedPreUpdate);
                await this.runSchedule(Schedule.FixedUpdate);
                await this.runSchedule(Schedule.FixedPostUpdate);
                input?.endFixedStep();
                fixedSteps++;
                // Stop catching up once this frame's fixed steps blow the time
                // budget — drop the backlog below so we don't spiral.
                if (perf && perf.now() - fixedStart >= this.fixedStepBudgetMs_) break;
            }
            // Hit the step cap or the time budget with a step still pending → the
            // sim can't keep real-time; drop the backlog so the accumulator can't
            // grow unbounded (graceful slow motion instead of a death spiral).
            if (this.fixedAccumulator_ >= this.fixedTimestep_) {
                this.fixedAccumulator_ = 0;
            }
            // Remainder fraction into the current fixed step — render-time systems
            // (physics interpolation) lerp prev→current by this for smooth motion.
            this.resources_.get(Time).fixedAlpha =
                this.fixedTimestep_ > 0 ? this.fixedAccumulator_ / this.fixedTimestep_ : 0;

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

        for (const observe of this.frameObservers_) {
            try { observe(delta * 1000); } catch (e) {
                log.error('app', 'Frame observer error', e);
            }
        }
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

    /**
     * Expands an ordering name to the indices it refers to — a system, or every
     * member of a set that is also in this schedule. A name matching neither
     * resolves to nothing, which is how ordering against a system that was never
     * registered stays a no-op rather than an error.
     */
    private resolverFor(systems: readonly SystemEntry[]): ResolveTargets {
        const nameToIndex = new Map<string, number>();
        for (let i = 0; i < systems.length; i++) {
            nameToIndex.set(systems[i].system._name, i);
        }
        return (name: string): number[] => {
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
    }

    /**
     * Pairs of systems in `schedule` that touch the same data with nothing
     * saying which runs first, so their order is whatever registration and the
     * sort happened to produce.
     *
     * @beta
     */
    scheduleAmbiguities(schedule: Schedule): Ambiguity[] {
        const systems = this.systems_.get(schedule) ?? [];
        return detectAmbiguities(systems, this.resolverFor(systems));
    }

    /**
     * `schedule` grouped into batches that could run at the same time — how much
     * of it is inherently sequential. A measurement: the schedule starts systems
     * in sorted order, overlapping only what awaits. See {@link parallelBatches}.
     *
     * @beta
     */
    scheduleBatches(schedule: Schedule): string[][] {
        const systems = this.systems_.get(schedule) ?? [];
        return parallelBatches(systems, this.resolverFor(systems));
    }

    private sortSystems(systems: SystemEntry[]): SystemEntry[] {
        if (systems.length <= 1) {
            return systems;
        }

        const resolveTargets = this.resolverFor(systems);

        // `adj[i]` lists indices that must run *before* system `i` — the same
        // edges the ambiguity check reads, so what orders a schedule and what
        // judges its order can never be two answers.
        const adj = dependencyEdges(systems, resolveTargets);

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
            this.dependencyCache_.delete(Schedule.Startup);
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

        // Systems that returned a promise and have not settled. A synchronous
        // system runs to completion the moment it starts, so this is empty for a
        // schedule of synchronous systems and the loop below is the old one.
        const inflight: InflightSystem[] = [];
        const settle = async (): Promise<void> => {
            const waiting = inflight.map((f) => f.done);
            inflight.length = 0;
            await Promise.all(waiting);
        };

        for (let i = 0; i < systems.length; i++) {
            const entry = systems[i];
            if (this.frame_paused_) break;
            if (entry.runIf && !entry.runIf()) continue;

            // Where the declarations are spent rather than reported: a system
            // starts beside an unfinished one only when it neither depends on it
            // nor touches what it touches — undeclared conflicts with everything.
            if (inflight.length > 0) {
                const dependsOn = this.dependenciesFor(schedule, systems)[i];
                const access = accessOf(entry.system);
                const blocked = inflight.some(
                    (f) => dependsOn.has(f.index) || conflicts(access, f.access),
                );
                if (blocked) await settle();
            }

            try {
                this.currentSystem_ = entry.system._name;
                const result = this.runner_.run(entry.system);
                if (result instanceof Promise) {
                    inflight.push({
                        index: i,
                        access: accessOf(entry.system),
                        done: result.then(
                            () => { this.markSystemStepped(entry); },
                            (e) => { this.reportSystemError(e, entry.system._name); },
                        ),
                    });
                } else {
                    this.markSystemStepped(entry);
                }
            } catch (e) {
                this.reportSystemError(e, entry.system._name);
            } finally {
                // Only meaningful for the synchronous stretch: a system parked at
                // an await has no claim on it while someone else runs.
                this.currentSystem_ = '';
            }
        }

        await settle();

        if (this.phaseTimings_) {
            this.phaseTimings_.set(Schedule[schedule], performance.now() - t0);
        }
    }

    /**
     * What must finish before each system of `systems` may start, transitively.
     *
     * Ordering edges are a stronger statement than access: two systems that touch
     * nothing in common may still have been ordered on purpose, and starting the
     * second beside the first would silently ignore that.
     */
    private dependenciesFor(schedule: Schedule, systems: readonly SystemEntry[]): Set<number>[] {
        let deps = this.dependencyCache_.get(schedule);
        if (!deps) {
            deps = ancestors(dependencyEdges(systems, this.resolverFor(systems)));
            this.dependencyCache_.set(schedule, deps);
        }
        return deps;
    }

    /** Liveness: a system ran, so its owning subsystem stepped this frame. */
    private markSystemStepped(entry: SystemEntry): void {
        if (entry.subsystem) this.subsystems_.markStepped(entry.subsystem);
    }

    /**
     * Report one system's failure. Pausing stops the schedule from STARTING
     * anything else; what is already in flight still has to be waited for, since
     * a promise cannot be taken back.
     */
    private reportSystemError(e: unknown, name: string): void {
        log.error('app', `System "${name}" threw an error`, e);
        if (this.error_handler_) {
            this.error_handler_(e, name);
        }
        if (this.system_error_handler_) {
            const err = e instanceof Error ? e : new Error(String(e));
            if (this.system_error_handler_(err, name) === 'pause') {
                this.frame_paused_ = true;
            }
        }
    }

    private updateTime(delta: number): void {
        const time = this.resources_.get(Time);
        const scale = time.scale >= 0 ? time.scale : 0;
        time.unscaledDelta = delta;
        time.delta = delta * scale;
        time.elapsed += time.delta;
        time.frameCount++;
        time.fixedDelta = this.fixedTimestep_;
    }
}

// =============================================================================
// Web App Factory
// =============================================================================

/**
 * How the host provides the render surface the C++ renderer binds to — the single
 * seam every platform's renderer init flows through:
 *   - `gl-context`: an emscripten-registered WebGL2 context handle (web/desktop/WeChat).
 *   - `webgpu`: the host acquired a GPUDevice (navigator.gpu) and passed it as the
 *     module factory's `preinitializedWebGPUDevice` before instantiation; the engine
 *     owns the swapchain, resolving the canvas via `canvasSelector` (default '#canvas',
 *     via document.querySelector — so the canvas must be in the DOM).
 *   - `default`: the module resolves its own surface (module.initRenderer()).
 *
 * Native (wasm-on-JSC, no DOM): the host injects the device AND an already-built
 * CAMetalLayer/ANativeWindow surface, so `{ kind: 'webgpu' }` omits `canvasSelector`
 * and must not reach the '#canvas' fallback.
 */
export type RenderSurfaceSource =
    | { readonly kind: 'gl-context'; readonly handle: number }
    | {
        readonly kind: 'webgpu';
        readonly canvasSelector?: string;
        /** Configure the swapchain so the engine can read its own frames back
         *  (`captureFrame`). Fixed at surface configuration, hence here. */
        readonly readback?: boolean;
    }
    | { readonly kind: 'default' };

export interface WebAppOptions {
    getViewportSize?: () => { width: number; height: number };
    /**
     * How the host provides the render surface (WebGL2 context handle / WebGPU
     * device + swapchain / headless default). See {@link RenderSurfaceSource}.
     * Omitted ⇒ `{ kind: 'default' }` (module.initRenderer resolves its own).
     */
    renderSurface?: RenderSurfaceSource;
    plugins?: Plugin[];
    /** The realm's optional-native-module acquirer; set before plugins build so
     *  SpinePlugin (and later physics) can pull from it. See {@link App.sideModules}. */
    sideModules?: SideModuleHost;
    /**
     * Bitmask of render layers (bits 0..31) that sort by world Y within the
     * layer — top-down occlusion (lower on screen draws on top). Project-level
     * setting (Project Settings → Rendering); change later via Renderer.setYSortLayers.
     */
    ySortLayers?: number;
    /**
     * Bitmask of render layers (bits 0..31) that resolve by real depth instead of
     * painter's order — the 2.5D opt-in. Opaque draws in such a layer write the
     * depth buffer and sort front-to-back; blended ones test without writing and
     * stay back-to-front. A layer that also y-sorts keeps y-sorting.
     * Project-level setting (Project Settings → Rendering).
     */
    depthLayers?: number;
    /**
     * Project color space (Project Settings → Rendering). 'linear' renders in
     * linear light: sRGB decode on sample, linear blending in sRGB-format
     * intermediates, and an explicit linear→sRGB encode in the final blit.
     * Must be declared at app creation — shaders compile against it.
     */
    colorSpace?: 'gamma' | 'linear';
    /**
     * Seed the engine's randomness so this run reproduces — a replay, a bug
     * report, a pixel assertion. Absent, every run differs, which is what a
     * player wants of particles.
     */
    randomSeed?: number;
    /**
     * Project camera fit (Project Settings → Display). When set with a real
     * scaleMode (≥ 0), the MAIN scene camera letterboxes this design resolution
     * into the actual aspect regardless of any UI Canvas; omitted / scaleMode = -1
     * keeps the legacy behavior (Canvas fit when present, else raw orthoSize). See
     * {@link ScreenScaling}.
     */
    screenFit?: ScreenScalingData;
}

export function createWebApp(module: ESEngineModule, options?: WebAppOptions): App {
    // Restore any engine components a prior project hot-reload's clearUserComponents
    // wiped, so the scene about to load can still resolve them (no-op before the SDK
    // entry snapshots the baseline — e.g. in unit tests that never load it).
    seedEngineComponents();
    const app = App.new();
    if (options?.sideModules) app.setSideModules(options.sideModules);
    const cppRegistry = new module.Registry() as unknown as CppRegistry;

    app.connectCpp(cppRegistry, module, { strict: true });

    // BEFORE renderer init: shader compilation reads the color-space global.
    // Always applied (realm reloads must reset a prior session's mode too).
    setLinearColorSpace(options?.colorSpace === 'linear');
    module.renderer_setColorSpace?.(options?.colorSpace === 'linear' ? 1 : 0);
    if (options?.randomSeed !== undefined) module.engine_setRandomSeed?.(options.randomSeed >>> 0);

    const surface: RenderSurfaceSource = options?.renderSurface ?? { kind: 'default' };
    switch (surface.kind) {
        case 'webgpu': {
            const size = options?.getViewportSize?.() ?? { width: 800, height: 600 };
            // The canvas' own preference: configuring anything else makes the
            // browser copy the whole frame on every present.
            const preferBGRA = (navigator as unknown as {
                gpu?: { getPreferredCanvasFormat?(): string };
            }).gpu?.getPreferredCanvasFormat?.() === 'bgra8unorm';
            if (!module.initRendererWebGPU(
                surface.canvasSelector ?? '#canvas', size.width, size.height,
                surface.readback === true, preferBGRA)) {
                throw new Error(
                    'WebGPU renderer initialization failed — the module needs a ' +
                    'preinitializedWebGPUDevice and a WebGPU-enabled engine build.');
            }
            watchWebGPUDeviceLoss(module);
            break;
        }
        case 'gl-context':
            module.initRendererWithContext(surface.handle);
            break;
        case 'default':
            module.initRenderer();
            break;
    }
    // Always applied (not only when set): the renderer outlives the App on realm
    // reloads, so a fresh App must reset a prior session's y-sort state too.
    module.renderer_setYSortLayers?.((options?.ySortLayers ?? 0) >>> 0);
    module.renderer_setDepthLayers?.((options?.depthLayers ?? 0) >>> 0);

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

    // Project camera fit: only install the resource when the project opts in (a real
    // scaleMode). Absent ⇒ CameraPlugin.resolveFitSource sees no resource and keeps
    // the legacy Canvas-or-raw fit, so an unconfigured game is byte-for-byte unchanged.
    if (options?.screenFit && options.screenFit.scaleMode > SCREEN_FIT_OFF) {
        app.insertResource(ScreenScaling, { ...options.screenFit });
    }

    return app;
}

/**
 * Install a {@link Plugin} from a project bundle — the module-level twin of
 * {@link App.addPlugin}, and the door a plugin PACKAGE is installed through: a
 * bundle is imported before an App exists.
 *
 * @experimental
 */
export function addPlugin(plugin: Plugin): void {
    getDefaultContext().pendingPlugins.push(plugin);
}

/**
 * Install everything a project bundle registered at module level. One door, so a
 * host cannot drain half of it — plugins first, because a project's own system
 * may read a resource one of them inserts.
 *
 * @experimental
 */
export function flushPendingRegistrations(app: App): void {
    const context = getDefaultContext();
    for (const plugin of context.drainPendingPlugins()) app.addPlugin(plugin as Plugin);
    app.addBundleSystems(context.drainPendingSystems() as ReadonlyArray<{ schedule: number; system: SystemDef }>);
}

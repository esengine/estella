// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sceneManager.ts
 * @brief   Scene management system for loading, switching, and unloading scenes
 */

import type { App } from '../app/app';
import type { Entity, Color } from '../types';
import type { SceneData, SceneLoadOptions, LoadedSceneAssets, SceneLoadProgressCallback } from './scene';
import { AssetScope, type AssetLease } from '../asset/AssetLease';
import { visitEntityAssetBindings } from '../asset/liveAssetBindings';
import { sameAcquisition } from '../asset/leaseBindings';
import type { SystemDef } from '../ecs/system';
import type { RenderReadiness } from '../render/renderReadiness';
import type { DrawCallback } from '../render/customDraw';
import { Schedule } from '../ecs/system';
import { loadSceneWithAssets } from './scene';
import { SceneAssetProgress } from './sceneAssetProgress';
import { recordSceneOrigins } from './sceneOrigins';
import { detachFromSceneParent, SceneEntityBatch } from './sceneHierarchy';
import { discardSceneEntities } from './sceneLoadAttempt';
import { registerDrawCallback, unregisterDrawCallback } from '../render/customDraw';
import { PostProcess, PostProcessStack } from '../postprocess';
import { defineResource } from '../ecs/resource';
import { SceneTransitionController } from './SceneTransitionController';
import { SceneOwner, Disabled, renderableComponents, type RenderableComponentDef } from '../ecs/component';
import { Assets, type AssetsData } from '../asset/AssetPlugin';
import { RuntimeConfig } from '../defaults';
import { log } from '../util/logger';
import { disposeAll } from '../util/disposeAll';
import { createAbort } from '../util/abort';
import { reservePromise } from '../util/reservePromise';

// =============================================================================
// Types
// =============================================================================

/** Where a loaded scene is in its lifecycle. `paused` still draws; `sleeping`
 *  does not — see {@link SceneManagerState.pause} and `sleep`.
 *  @beta */
export type SceneStatus = 'loading' | 'running' | 'paused' | 'sleeping' | 'unloading';

type SceneSurvival = 'all' | 'persistent' | 'none';

interface SceneLoadRequest {
    readonly done: Promise<SceneContext>;
    readonly progress: SceneAssetProgress;
    activate: boolean;
    instance?: SceneInstance;
}

interface SceneArrival {
    request?: SceneLoadRequest;
    readonly settled: Promise<void>;
    finish(): void;
}

/** Operations supplied to a scene's staggered unload hook. @beta */
export interface SceneRetirement {
    /** Hide the remaining roots until they are adopted or destroyed. */
    hideRoots(): void;
    /** Destroy the entity if it still belongs to this unload, preserving other scenes' descendants. */
    despawn(entity: Entity): void;
}

/**
 * A scene as registered: where its data comes from, the systems that run while it
 * is loaded, and hooks either side of its lifetime. `path` and `data` are
 * alternatives — a scene either loads from disk or is handed its content.
 *
 * @beta
 */
export interface SceneConfig {
    name: string;
    path?: string;
    data?: SceneData;
    systems?: Array<{ schedule: Schedule; system: SystemDef }>;
    setup?: (ctx: SceneContext) => void | Promise<void>;
    cleanup?: (ctx: SceneContext) => void;
    /**
     * Authored ids this scene may reference in ANOTHER document, resolved at load
     * time. A streamed cell names the persistent world through this; nothing else
     * has a document boundary to cross.
     */
    externalEntities?: () => ReadonlyMap<number, Entity>;
    /** Where this scene's load spent its time. See {@link SceneLoadOptions.onPhase}. */
    onPhase?: (phase: string, ms: number) => void;
    /**
     * Do everything this scene's load can do without the world seeing anything —
     * fetch, decode, acquire. Creates no entities; `load` publishes what it left.
     */
    prepare?: () => Promise<void>;
    /** Throw away what `prepare` readied, answering how many receipts came back. */
    discardPrepared?: () => number;
    /**
     * Ready the render programs this scene's content requires, from what
     * `prepare` decoded. Absent means the obligation does not apply here, which
     * is how a headless host satisfies it — never by inventing a claim.
     */
    readyRenderPrograms?: () => Promise<RenderReadiness>;
    /**
     * Schedule destruction across frames during a staggered unload. The manager supplies ownership-aware operations
     * so another scene can adopt an entity between frames. Systems and assets remain available until retirement ends.
     */
    retire?: (doomed: readonly Entity[], retirement?: SceneRetirement) => Promise<void>;
    /** Finish, now, whatever of this scene's arrival or departure is being spread over frames. */
    rush?: () => void;
    /** Says whether a player would see this scene missing, so work spread over frames for it may take more of a frame. */
    urge?: (urgent: boolean) => void;
}

/**
 * A live scene, as `setup` receives it and `load` answers with. Everything it
 * spawns or adopts is scene-owned and goes away when the scene unloads, which is
 * why an entity or an asset reference nothing records is one nothing releases.
 *
 * @beta
 */
export interface SceneContext {
    readonly name: string;
    readonly entities: ReadonlySet<Entity>;
    /** Report asset counts from a custom scene loader to callers observing this load. */
    readonly reportAssetProgress?: SceneLoadProgressCallback;
    spawn(): Entity;
    /** Track an entity as scene-owned, transferring it from its previous scene. */
    adopt(entity: Entity): void;
    /**
     * Track assets a loader acquired for this scene, so unload gives them back.
     *
     * The asset half of {@link adopt}: a scene whose data arrives inside `setup`
     * preloads its own, and a reference nothing records is one nothing releases.
     */
    trackAssets(byType: ReadonlyMap<string, ReadonlySet<string>>): void;
    /**
     * Take over the receipts a loader acquired for this scene.
     *
     * A receipt identifies the exact acquisition even when several generations
     * share a path. A value-only loader can report paths through {@link trackAssets}.
     */
    trackAssetScope(scope: AssetScope): void;
    despawn(entity: Entity): void;
    registerDrawCallback(id: string, fn: DrawCallback): void;
    bindPostProcess(camera: Entity, stack: PostProcessStack): void;
    unbindPostProcess(camera: Entity): void;
    setPersistent(entity: Entity, persistent: boolean): void;
}

/**
 * How a switch, unload or reload behaves. `keepPersistent` decides whether
 * entities marked persistent survive it.
 *
 * @beta
 */
export interface TransitionOptions {
    keepPersistent?: boolean;
    /**
     * Unload over frames, through the scene's `retire` (a streamed cell): hidden at once, destroyed under the frame's
     * budget, its assets given back after. A load of the same name waits for it.
     */
    staggered?: boolean;
    transition?: 'none' | 'fade';
    duration?: number;
    color?: Color;
    onStart?: () => void;
    onComplete?: () => void;
}

// Fade transition state machine lives in SceneTransitionController.

// =============================================================================
// Scene Instance (internal)
// =============================================================================

class SceneInstance {
    readonly config: SceneConfig;
    readonly entities = new Set<Entity>();
    readonly drawCallbacks = new Map<string, DrawCallback>();
    readonly postProcessBindings = new Map<Entity, PostProcessStack>();
    readonly savedEnabled = new Map<Entity, { wasDisabled: boolean; renderables: Map<RenderableComponentDef, boolean> }>();
    retirement: SceneEntityBatch | null = null;
    readonly systemIds: symbol[] = [];
    /**
     * What this scene's preload actually acquired, receipt by receipt. Released
     * as a scope at unload, so what goes back is what was taken — not what the
     * scene's refs resolve to by then.
     */
    readonly assetScope = new AssetScope();
    /** Paths reported by a loader, and whether the live asset store supplied their receipts. */
    readonly loadedByType = new Map<string, Map<string, boolean>>();
    status: SceneStatus = 'loading';

    constructor(config: SceneConfig) {
        this.config = config;
    }
}

// =============================================================================
// Scene Context Implementation
// =============================================================================

class SceneContextImpl implements SceneContext {
    private readonly instance_: SceneInstance;
    private readonly app_: App;
    private readonly adopt_: (entity: Entity) => void;
    private readonly isCurrent_: () => boolean;

    constructor(instance: SceneInstance, app: App, adopt: (entity: Entity) => void, isCurrent: () => boolean,
                readonly reportAssetProgress: SceneLoadProgressCallback) {
        this.instance_ = instance;
        this.app_ = app;
        this.adopt_ = adopt;
        this.isCurrent_ = isCurrent;
    }

    private assertCurrent_(): void {
        if (!this.isCurrent_()) throw new SceneLoadCancelled(this.name);
    }

    get name(): string {
        return this.instance_.config.name;
    }

    get entities(): ReadonlySet<Entity> {
        return this.instance_.entities;
    }

    spawn(): Entity {
        this.assertCurrent_();
        const entity = this.app_.world.spawn();
        this.adopt(entity);
        return entity;
    }

    adopt(entity: Entity): void {
        this.assertCurrent_();
        this.adopt_(entity);
    }

    trackAssetScope(scope: AssetScope): void {
        if (!this.isCurrent_()) {
            scope.releaseAll();
            throw new SceneLoadCancelled(this.name);
        }
        this.instance_.assetScope.absorb(scope);
    }

    trackAssets(byType: ReadonlyMap<string, ReadonlySet<string>>): void {
        this.assertCurrent_();
        const assets = this.app_.hasResource(Assets) ? this.app_.getResource(Assets) : null;
        for (const [type, paths] of byType) {
            // Materials are handle-keyed and skeletons belong to the
            // SpineManager; both are released through their own doors.
            if (type === 'material' || type === 'spine') continue;
            let bucket = this.instance_.loadedByType.get(type);
            if (!bucket) { bucket = new Map(); this.instance_.loadedByType.set(type, bucket); }
            for (const path of paths) {
                if (!bucket.has(path)) bucket.set(path, assets?.takeTrackedAsset(type, path, this.instance_.assetScope) ?? false);
            }
        }
    }

    despawn(entity: Entity): void {
        this.assertCurrent_();
        this.instance_.entities.delete(entity);
        this.app_.world.despawn(entity);
    }

    registerDrawCallback(id: string, fn: DrawCallback): void {
        this.assertCurrent_();
        this.instance_.drawCallbacks.set(id, fn);
        registerDrawCallback(id, fn, this.instance_.config.name);
    }

    bindPostProcess(camera: Entity, stack: PostProcessStack): void {
        this.assertCurrent_();
        if (this.app_.hasResource(PostProcess)) this.app_.getResource(PostProcess).bind(camera, stack);
        this.instance_.postProcessBindings.set(camera, stack);
    }

    unbindPostProcess(camera: Entity): void {
        this.assertCurrent_();
        if (this.app_.hasResource(PostProcess)) this.app_.getResource(PostProcess).unbind(camera);
        this.instance_.postProcessBindings.delete(camera);
    }

    setPersistent(entity: Entity, persistent: boolean): void {
        this.assertCurrent_();
        if (this.app_.world.has(entity, SceneOwner)) {
            const data = this.app_.world.get(entity, SceneOwner);
            data.persistent = persistent;
            this.app_.world.insert(entity, SceneOwner, data);
        }
    }
}

// =============================================================================
// Scene Manager State
// =============================================================================

/**
 * Thrown by a `load()` whose scene slot was replaced — by a concurrent `unload()`
 * or a superseding load — while its assets were still loading. The load despawns
 * anything it had spawned and rejects with this instead of committing a
 * half-loaded scene, so a `load()`/`unload()` race can't orphan entities.
 */
export class SceneLoadCancelled extends Error {
    constructor(name: string) {
        super(`Scene load for "${name}" was cancelled (the scene was unloaded or the manager was reset)`);
        this.name = 'SceneLoadCancelled';
    }
}

/**
 * Scene loading and transitions, as `Res(SceneManager)` hands it over. A scene is
 * a unit of ownership as much as of content: what it spawned is despawned and what
 * it acquired is released when it unloads.
 *
 * `@beta`: the vocabulary is settled, but one certified project drives it against
 * twenty-six signatures — thin evidence for that breadth of promise.
 *
 * @beta
 */
export class SceneManagerState {
    private readonly app_: App;
    private readonly configs_ = new Map<string, SceneConfig>();
    private readonly scenes_ = new Map<string, SceneInstance>();
    private readonly contexts_ = new Map<string, SceneContextImpl>();
    private readonly pausedScenes_ = new Set<string>();
    private readonly sleepingScenes_ = new Set<string>();
    private readonly loadOrder_: string[] = [];
    private activeScene_: string | null = null;
    private initialScene_: string | null = null;
    private readonly transitionController_ = new SceneTransitionController();
    private switching_: string | null = null;
    private lifetime_ = createAbort();
    private readonly arrivals_ = new Map<string, Set<SceneArrival>>();
    /** A same-name load waits through cleanup and any remaining retirement frames. */
    private unloadPromises_ = new Map<string, { done: Promise<void>; config: SceneConfig; staggered: boolean }>();
    private stopEntityTracking_: (() => void) | null = null;

    constructor(app: App) {
        this.app_ = app;
    }

    private trackEntityDestruction_(): void {
        if (this.stopEntityTracking_) return;
        this.stopEntityTracking_ = this.app_.world.onDespawn?.(entity => {
            for (const instance of this.scenes_.values()) {
                instance.entities.delete(entity);
                instance.savedEnabled.delete(entity);
            }
        }) ?? null;
    }

    /** Forget registrations and scene services. Committed entities keep their live assets in the World. */
    reset(): void {
        const instances = [...this.scenes_.values()], configs = [...this.configs_.values()];
        const committed = new Set(this.loadOrder_), sleeping = new Set(this.sleepingScenes_);
        const lifetime = this.lifetime_;
        this.lifetime_ = createAbort();
        this.stopEntityTracking_?.();
        this.stopEntityTracking_ = null;
        if (this.switching_ !== null) this.transitionController_.reset(new SceneLoadCancelled(this.switching_));

        this.configs_.clear();
        this.scenes_.clear();
        this.contexts_.clear();
        this.pausedScenes_.clear();
        this.sleepingScenes_.clear();
        this.loadOrder_.length = 0;
        this.activeScene_ = null;
        this.initialScene_ = null;
        this.switching_ = null;
        for (const arrivals of this.arrivals_.values()) {
            for (const arrival of arrivals) arrival.finish();
        }
        this.unloadPromises_.clear();
        lifetime.abort();

        disposeAll([
            () => disposeAll(configs, config => config.discardPrepared?.()),
            () => disposeAll(instances, instance => {
                const name = instance.config.name;
                try { this.disposeSceneOwnedState_(instance, committed.has(name) ? 'all' : 'none', sleeping.has(name)); }
                finally {
                    if (instance.status === 'loading' || instance.status === 'unloading') {
                        this.finishPendingWork_(instance.config);
                    }
                }
            }),
        ], dispose => dispose());
    }

    register(config: SceneConfig): void {
        const previous = this.configs_.get(config.name);
        this.configs_.set(config.name, config);
        if (previous && previous !== config) previous.discardPrepared?.();
    }

    setInitial(name: string): void {
        this.initialScene_ = name;
    }

    getInitial(): string | null {
        return this.initialScene_;
    }

    isTransitioning(): boolean {
        return this.transitionController_.isTransitioning();
    }

    async switchTo(name: string, options?: TransitionOptions): Promise<void> {
        return this.switchTo_(name, options, false);
    }

    /**
     * Start the active scene over: retire it and bring it back up, entities and
     * all. `switchTo` cannot express this — asked for the scene already running
     * it does nothing, which is the right answer for a gate and the wrong one
     * for every death, retry and restart there is.
     */
    async reload(options?: TransitionOptions): Promise<void> {
        const name = this.activeScene_;
        if (!name) {
            log.warn('scene', 'reload() with no active scene');
            return;
        }
        return this.switchTo_(name, options, true);
    }

    private async switchTo_(
        name: string,
        options: TransitionOptions | undefined,
        reload: boolean,
    ): Promise<void> {
        if (this.transitionController_.isTransitioning() || this.switching_ !== null) {
            log.warn('scene', `Scene switch already in progress, ignoring switchTo("${name}")`);
            return;
        }

        // One lock for both paths: "one switch at a time" is a single invariant,
        // and a faded switch must hold the same one a plain switch does.
        const { signal } = this.lifetime_;
        this.switching_ = name;
        try {
            if ((options?.transition ?? 'none') !== 'fade') {
                await this.swapTo_(name, options, reload, signal);
                return;
            }
            await this.transitionController_.start(
                {
                    duration: options?.duration ?? RuntimeConfig.sceneTransitionDuration,
                    color: options?.color ?? { ...RuntimeConfig.sceneTransitionColor },
                    onStart: options?.onStart,
                    onComplete: options?.onComplete,
                },
                () => this.swapTo_(name, options, reload, signal),
            );
        } finally {
            if (!signal.aborted) this.switching_ = null;
        }
    }

    /** The swap itself: retire whatever is active, bring `name` up. */
    private async swapTo_(
        name: string,
        options: TransitionOptions | undefined,
        reload: boolean, signal: AbortSignal,
    ): Promise<void> {
        if (signal.aborted) throw new SceneLoadCancelled(name);
        // Read at swap time, not at switchTo time: a fade puts half a second
        // between the two, and the scene to retire is the one active NOW.
        const outgoing = this.activeScene_;
        if (outgoing && (reload || outgoing !== name)) {
            const swap = this.trackArrival_(name);
            try {
                await this.unload(outgoing, options);
                if (signal.aborted) throw new SceneLoadCancelled(name);
                await this.loadScene_(name, 'exclusive', undefined, swap);
            } finally { swap.finish(); }
            return;
        }
        await this.load(name);
    }

    updateTransition(dt: number): void {
        this.transitionController_.update(dt);
    }

    /** Replace whatever is active with `name`. */
    async load(name: string, onProgress?: SceneLoadProgressCallback): Promise<SceneContext> {
        return this.loadScene_(name, 'exclusive', onProgress);
    }

    /** Bring `name` up alongside whatever is already running. */
    async loadAdditive(name: string, onProgress?: SceneLoadProgressCallback): Promise<SceneContext> {
        return this.loadScene_(name, 'additive', onProgress);
    }

    /**
     * Ready `name` without bringing it up. A no-op for a scene that declares no
     * preparation, and for one already loaded — there is nothing left to hide.
     */
    async prepare(name: string): Promise<void> {
        if (this.scenes_.has(name)) return;
        const config = this.configs_.get(name);
        if (config?.prepare) await this.reserveOperation_<void>(name).start(() => config.prepare!());
    }

    /**
     * Make the render programs `name`'s prepared content requires ready.
     * @returns Not applicable where the scene declares no readying or is already
     *          up; otherwise the claim, or null when one could not be made.
     */
    async readyRenderPrograms(name: string): Promise<RenderReadiness> {
        if (this.scenes_.has(name)) return { applicable: false };
        const ready = this.configs_.get(name)?.readyRenderPrograms;
        return ready ? this.reserveOperation_<RenderReadiness>(name).start(ready) : { applicable: false };
    }

    /**
     * Give back what {@link prepare} readied, answering how many acquisitions
     * came back with it. Zero for a scene that readied nothing.
     */
    discardPrepared(name: string): number {
        if (this.scenes_.has(name)) return 0;
        return this.configs_.get(name)?.discardPrepared?.() ?? 0;
    }

    /** Finish, now, what of `name`'s arrival or departure is being spread over frames (see `SceneConfig.rush`). */
    rush(name: string): void {
        this.workingConfig_(name)?.rush?.();
    }

    /** Says whether a player would see `name` missing (see `SceneConfig.urge`). */
    urge(name: string, urgent: boolean): void {
        this.workingConfig_(name)?.urge?.(urgent);
    }

    private workingConfig_(name: string): SceneConfig | undefined {
        return this.unloadPromises_.get(name)?.config ?? this.scenes_.get(name)?.config ?? this.configs_.get(name);
    }

    private finishPendingWork_(config: SceneConfig): void {
        try { config.rush?.(); }
        finally { config.urge?.(false); }
    }

    /** A switch may be waiting for the outgoing scene while its destination already has a load of its own. */
    private trackArrival_(name: string): SceneArrival {
        const arrivals = this.arrivals_.get(name) ?? new Set<SceneArrival>();
        const settled = reservePromise<void>();
        const arrival: SceneArrival = {
            settled: settled.promise,
            finish: () => {
                if (!arrivals.delete(arrival)) return;
                arrival.request?.progress.close();
                if (!arrivals.size) this.arrivals_.delete(name);
                settled.resolve();
            },
        };
        arrivals.add(arrival);
        this.arrivals_.set(name, arrivals);
        return arrival;
    }

    private loadArrival_(name: string): SceneArrival | undefined {
        for (const arrival of this.arrivals_.get(name) ?? []) {
            if (arrival.request) return arrival;
        }
        return undefined;
    }

    /**
     * The one load path. `mode` is the only difference between the two doors —
     * which is why they were two copies, and why the fix for re-loading a SLEPT
     * scene reached only one: additive flipped the status bit without the
     * restore, leaving those entities disabled forever.
     */
    private async loadScene_(
        name: string,
        mode: 'exclusive' | 'additive',
        onProgress?: SceneLoadProgressCallback,
        swap?: SceneArrival,
    ): Promise<SceneContext> {
        const leaving = this.unloadPromises_.get(name);
        const existing = this.scenes_.get(name);
        if (!leaving && existing && existing.status !== 'loading') {
            // Re-loading a scene that was slept/paused must run the full restore
            // (remove Disabled, replay savedEnabled, re-enable post-process); a
            // bare status flip would strand its entities disabled.
            if (existing.status === 'sleeping') this.wake(name);
            else if (existing.status === 'paused') this.resume(name);
            existing.status = 'running';
            if (mode === 'exclusive') this.activeScene_ = name;
            return this.contexts_.get(name)!;
        }

        const pending = this.loadArrival_(name);
        if (pending?.request) {
            pending.request.progress.observe(onProgress);
            if (mode === 'exclusive') pending.request.activate = true;
            if (swap) void pending.settled.then(swap.finish);
            return pending.request.done;
        }

        const { signal } = this.lifetime_;
        const load = this.reserveOperation_<SceneContext>(name);
        const progress = new SceneAssetProgress();
        progress.observe(onProgress);
        const request: SceneLoadRequest = { done: load.done, activate: mode === 'exclusive', progress };
        const arrival = swap ?? this.trackArrival_(name);
        arrival.request = request;
        try {
            return await load.start(async () => {
                if (leaving) {
                    await leaving.done.catch(() => undefined);
                    if (signal.aborted) throw new SceneLoadCancelled(name);
                }
                return this.publishScene_(name, request);
            });
        } finally { arrival.finish(); }
    }

    private async publishScene_(
        name: string, request: SceneLoadRequest,
    ): Promise<SceneContext> {
        const config = this.configs_.get(name);
        if (!config) {
            throw new Error(`Scene "${name}" is not registered`);
        }

        const instance = new SceneInstance(config);
        request.instance = instance;
        this.trackEntityDestruction_();
        this.scenes_.set(name, instance);

        const ctx = new SceneContextImpl(instance, this.app_,
            entity => this.adoptInto_(instance, entity), () => this.acceptsSceneWork_(instance), request.progress.report);
        this.contexts_.set(name, ctx);

        try {
            let sceneData = config.data;
            if (!sceneData && config.path) {
                const began = performance.now();
                const assetServer = this.app_.hasResource(Assets)
                    ? this.app_.getResource(Assets)
                    : null;
                if (assetServer) {
                    sceneData = await assetServer.fetchJson<SceneData>(config.path);
                } else {
                    const response = await fetch(config.path);
                    sceneData = await response.json() as SceneData;
                }
                config.onPhase?.('fetch', performance.now() - began);
            }

            await this.loadSceneData_(instance, name, config, sceneData, ctx);
            if (!this.acceptsSceneWork_(instance)) throw new SceneLoadCancelled(name);
            instance.status = 'running';
            if (request.activate) this.activeScene_ = name;
            this.loadOrder_.push(name);
            return ctx;
        } catch (error) {
            this.rollbackFailedLoad_(name, instance);
            throw error;
        }
    }

    /**
     * Roll back a load that threw partway, through the teardown a successful
     * unload runs: a half-loaded scene owns what a loaded one owns.
     *
     * Persistence takes effect when the scene commits.
     */
    private rollbackFailedLoad_(name: string, instance: SceneInstance): void {
        this.disposeSceneOwnedState_(instance, 'none', false);
        this.removeSceneSlot_(name, instance);
    }

    /**
     * Give back everything this instance owns — the one teardown protocol.
     *
     * Idempotent by construction: every collection is emptied as it is walked.
     * An `unload` during a load tears the instance down, and that load's own
     * rollback then runs over it again — over whatever its setup added between.
     */
    private disposeSceneOwnedState_(
        instance: SceneInstance, survival: SceneSurvival, wasSleeping: boolean,
        retire?: SceneConfig['retire'],
    ): Promise<void> | void {
        const { survivors, doomed } = this.partitionOnUnload_(instance, survival);
        const batch = instance.retirement ??= new SceneEntityBatch(this.app_.world, doomed);
        for (const survivor of survivors) {
            batch.release(survivor);
            this.promoteToGlobal_(instance, survivor, wasSleeping);
        }
        const finish = (): void => {
            for (const entity of doomed) batch.despawn(entity);
            instance.entities.clear();
            instance.savedEnabled.clear();

            for (const id of instance.drawCallbacks.keys()) {
                unregisterDrawCallback(id);
            }
            instance.drawCallbacks.clear();

            for (const id of instance.systemIds) {
                this.app_.removeSystem(id);
            }
            instance.systemIds.length = 0;

            const pp = this.app_.hasResource(PostProcess) ? this.app_.getResource(PostProcess) : null;
            for (const camera of instance.postProcessBindings.keys()) {
                pp?.unbind(camera);
            }
            instance.postProcessBindings.clear();

            this.releaseSceneAssets_(instance);
        };
        if (!retire) return finish();
        return (async () => {
            try {
                batch.detachSurvivors();
                await retire(doomed, batch);
            } finally {
                finish();
            }
        })();
    }

    /** Decide survival before subtree destruction, including committed entities handed back to the World at reset. */
    private partitionOnUnload_(
        instance: SceneInstance, survival: SceneSurvival,
    ): { survivors: Entity[]; doomed: Entity[] } {
        const world = this.app_.world;
        const survivors: Entity[] = [];
        const doomed: Entity[] = [];
        for (const entity of instance.entities) {
            if (!world.valid(entity) || world.isDestructionPending?.(entity)) continue;
            const keep = survival === 'all' || (survival === 'persistent' && world.tryGet(entity, SceneOwner)?.persistent);
            if (keep) survivors.push(entity);
            else doomed.push(entity);
        }
        return { survivors, doomed };
    }

    /**
     * Hand one entity over to nobody in particular: it outlives the scene it came
     * from, so nothing scene-gated may still read it as that scene's.
     *
     * `scene === ''` is the existing "always active" rule; left as the dead
     * scene's, a persistent camera would stop rendering.
     */
    private promoteToGlobal_(instance: SceneInstance, entity: Entity, wasSleeping: boolean): void {
        const world = this.app_.world;
        this.promoteAssetOwnership_(instance, entity);
        const data = world.tryGet(entity, SceneOwner);
        if (data?.scene) {
            data.scene = '';
            world.insert(entity, SceneOwner, data);
        }
        // The scene's sleep does not follow it out: nothing will wake this entity
        // once the scene is gone, and the record of what it looked like awake
        // dies with the instance.
        if (wasSleeping) this.restoreSleepState_(instance, entity);
    }

    /**
     * Split the scene's ownership of what this entity is bound to.
     *
     * `retain`, not a re-acquire: the era the fields hold is not the era their
     * path resolves to once a hot update has passed this scene by. One per
     * SOURCE receipt — a handle names its receipt by value, a ref names the
     * slot that publishes it.
     */
    private promoteAssetOwnership_(instance: SceneInstance, entity: Entity): void {
        if (!instance.assetScope.size || !this.app_.hasResource(Assets)) return;
        const assets = this.app_.getResource(Assets);
        const sources = new Map<AssetLease, { type: string; value: unknown }>();
        visitEntityAssetBindings(this.app_.world, entity, (type, value) => {
            const held = assets.leaseForBinding(instance.assetScope, type, value);
            if (held && (!sources.has(held) || typeof value === 'string')) sources.set(held, { type, value });
        });
        if (sources.size === 0) return;
        const scope = assets.entityScopes.ensure(this.app_.world, entity);
        for (const [source, { type, value }] of sources) {
            if (scope.leases().some(held => sameAcquisition(held, source))) continue;
            const retained = source.retain();
            if (retained) scope.addFieldLease(type, value, retained);
        }
    }

    private adoptInto_(target: SceneInstance, entity: Entity): void {
        const world = this.app_.world;
        if (!world.valid(entity) || world.isDestructionPending?.(entity)) throw new Error('Cannot adopt a destroyed entity');
        const alreadyOwned = target.entities.has(entity);
        for (const previous of this.scenes_.values()) {
            if (previous === target || !previous.entities.has(entity)) continue;
            this.promoteAssetOwnership_(previous, entity);
            previous.retirement?.release(entity);
            detachFromSceneParent(world, entity, previous.entities);
            if (this.sleepingScenes_.has(previous.config.name)) this.restoreSleepState_(previous, entity);
            const stack = previous.postProcessBindings.get(entity);
            if (stack) {
                previous.postProcessBindings.delete(entity);
                target.postProcessBindings.set(entity, stack);
                stack.setAllPassesEnabled(target.status !== 'sleeping' && target.status !== 'paused');
            }
            previous.entities.delete(entity);
            previous.savedEnabled.delete(entity);
        }
        target.entities.add(entity);
        world.insert(entity, SceneOwner, { scene: target.config.name, persistent: false });
        if (!alreadyOwned && target.status === 'sleeping') this.sleepEntity_(target, entity, renderableComponents());
    }

    /**
     * Forget the scene, if the slot is still this instance's.
     *
     * The identity check is the whole point: a concurrent unload + reload may
     * already have put a NEWER instance in the slot, and a rollback that
     * cleared it by name would delete the live scene out from under it.
     */
    private removeSceneSlot_(name: string, instance: SceneInstance): void {
        if (this.scenes_.get(name) !== instance) return;
        this.scenes_.delete(name);
        this.contexts_.delete(name);
        this.pausedScenes_.delete(name);
        this.sleepingScenes_.delete(name);

        const orderIdx = this.loadOrder_.indexOf(name);
        if (orderIdx !== -1) this.loadOrder_.splice(orderIdx, 1);
        if (this.activeScene_ === name) this.activeScene_ = null;
    }

    async unload(name: string, options?: TransitionOptions): Promise<void> {
        const pending = this.unloadPromises_.get(name);
        if (pending) {
            if (!options?.staggered && pending.staggered) pending.config.rush?.();
            return pending.done;
        }
        const instance = this.scenes_.get(name);
        if (!instance) return;

        const ctx = this.contexts_.get(name)!;
        // Read before the status becomes 'unloading': what a promoted entity
        // needs put back is what sleep() took, and only the old status says so.
        const wasSleeping = instance.status === 'sleeping';
        const wasLoading = instance.status === 'loading';
        instance.status = 'unloading';
        const arrival = this.loadArrival_(name);
        if (arrival?.request?.instance === instance) arrival.finish();

        const unload = this.reserveOperation_<void>(name);
        const staggered = !wasLoading && options?.staggered === true;
        const departure = { done: unload.done, config: instance.config, staggered };
        this.unloadPromises_.set(name, departure);
        return unload.start(async () => {
            try {
                try { instance.config.cleanup?.(ctx); }
                catch (err) { log.error('scene', `Scene "${name}" cleanup callback threw; continuing teardown`, err); }
                if (this.scenes_.get(name) !== instance) return;
                const retire = staggered ? instance.config.retire : undefined;
                const survival = wasLoading || options?.keepPersistent === false ? 'none' : 'persistent';
                const retiring = this.disposeSceneOwnedState_(instance, survival, wasSleeping, retire);
                if (retiring) await retiring;
            } finally {
                try {
                    if (wasLoading && this.scenes_.get(name) === instance) this.finishPendingWork_(instance.config);
                } finally {
                    this.removeSceneSlot_(name, instance);
                    if (this.unloadPromises_.get(name) === departure) this.unloadPromises_.delete(name);
                }
            }
        });
    }

    private acceptsSceneWork_(instance: SceneInstance): boolean {
        return !instance.retirement && this.scenes_.get(instance.config.name) === instance;
    }

    /** A joinable operation exists before its callbacks run. Reset settles it even while external work is pending. */
    private reserveOperation_<T>(name: string) {
        const { signal } = this.lifetime_;
        const { promise, resolve, reject } = reservePromise<T>();
        const cancel = () => reject(new SceneLoadCancelled(name));
        signal.addEventListener('abort', cancel);
        const done = promise.finally(() => signal.removeEventListener('abort', cancel));
        return {
            done,
            start(work: () => Promise<T>) {
                try { work().then(resolve, reject); }
                catch (error) { reject(error); }
                return done;
            },
        };
    }

    /**
     * Populate a scene: entities, assets, systems, setup().
     *
     * Returning means this load still owns the scene slot. Every await inside is a
     * window for a concurrent unload to take it; checking that here rather than
     * per caller is what the additive path was missing.
     */
    private async loadSceneData_(
        instance: SceneInstance,
        name: string,
        config: SceneConfig,
        sceneData: SceneData | undefined,
        ctx: SceneContextImpl,
    ): Promise<void> {
        if (!this.acceptsSceneWork_(instance)) throw new SceneLoadCancelled(name);
        if (sceneData) {
            const collectAssets: LoadedSceneAssets = {
                // What the scene DECLARED is an intention; ownership is the set
                // of receipts the preload hands back, and only successful
                // acquisitions produce one.
                scope: instance.assetScope,
                // The handle sets are the loader's scratch; ownership is the
                // scope, so nothing here is read back at unload.
                texturePaths: new Set(),
                materialHandles: new Set(),
                fontPaths: new Set(),
                spineKeys: new Set(),
            };

            const loadOptions: SceneLoadOptions = {
                collectAssets,
                onProgress: ctx.reportAssetProgress,
                assertCurrent: () => {
                    if (!this.acceptsSceneWork_(instance)) throw new SceneLoadCancelled(name);
                },
            };
            if (config.externalEntities) loadOptions.externalEntities = config.externalEntities();
            if (config.onPhase) loadOptions.onPhase = config.onPhase;
            if (this.app_.hasResource(Assets)) {
                loadOptions.assets = this.app_.getResource(Assets);
            }

            const entityMap = await loadSceneWithAssets(
                this.app_.world, sceneData, loadOptions
            );

            // Load token: if a concurrent unload (or a superseding load) replaced
            // this scene slot while our assets were in flight, the entities we just
            // spawned would orphan in the world under a scene that no longer exists.
            // Despawn them and abort instead of committing to a dead scene.
            if (!this.acceptsSceneWork_(instance)) {
                discardSceneEntities(this.app_.world, entityMap.values());
                throw new SceneLoadCancelled(name);
            }

            for (const entity of entityMap.values()) {
                instance.entities.add(entity);
                this.app_.world.insert(entity, SceneOwner, {
                    scene: name,
                    persistent: false,
                });
            }
            recordSceneOrigins(this.app_, entityMap);
        }

        // Same token check for the data-less path (systems/setup only) and to fail
        // cleanly before setup() dereferences a context an unload already dropped.
        if (!this.acceptsSceneWork_(instance)) throw new SceneLoadCancelled(name);

        if (config.systems) {
            for (const { schedule, system } of config.systems) {
                const wrapped = wrapSceneSystem(this.app_, name, system);
                this.app_.addSystemToSchedule(schedule, wrapped);
                instance.systemIds.push(wrapped._id);
            }
        }

        if (config.setup) {
            await config.setup(ctx);
            // setup() is user code and can await for as long as it likes. An
            // unload during it means everything above — and everything setup
            // itself spawned — belongs to a scene that no longer exists.
            if (!this.acceptsSceneWork_(instance)) throw new SceneLoadCancelled(name);
        }
    }

    private releaseSceneAssets_(instance: SceneInstance): void {
        const assetsRes = this.app_.hasResource(Assets)
            ? this.app_.getResource(Assets)
            : null;

        // Keep path-based cleanup for acquisitions the loader could not bind to receipts.
        const unresolved = new Map<string, Set<string>>();
        for (const [type, paths] of instance.loadedByType) {
            const remaining = new Set<string>();
            for (const [path, captured] of paths) if (!captured) remaining.add(path);
            if (remaining.size) unresolved.set(type, remaining);
        }
        instance.loadedByType.clear();
        try { instance.assetScope.releaseAll(); }
        finally { if (unresolved.size) assetsRes?.releaseAssets(unresolved); }
    }

    /**
     * What the named scene acquired, so an owner-aware operation (a live asset
     * replacement) can put a receipt where this scene will give it back.
     *
     * @internal
     */
    assetScopeFor(name: string): AssetScope | null {
        return this.scenes_.get(name)?.assetScope ?? null;
    }

    pause(name: string): void {
        const instance = this.scenes_.get(name);
        if (!instance || instance.status !== 'running') return;
        instance.status = 'paused';
        this.pausedScenes_.add(name);
        this.setPostProcessPassesEnabled(instance, false);
    }

    resume(name: string): void {
        const instance = this.scenes_.get(name);
        if (!instance || instance.status !== 'paused') return;
        instance.status = 'running';
        this.pausedScenes_.delete(name);
        this.setPostProcessPassesEnabled(instance, true);
    }

    sleep(name: string): void {
        const instance = this.scenes_.get(name);
        if (!instance || instance.status !== 'running') return;
        instance.status = 'sleeping';
        this.sleepingScenes_.add(name);
        this.setPostProcessPassesEnabled(instance, false);
        instance.savedEnabled.clear();

        // Hoisted: the same registry answer for every entity in the scene.
        const renderables = renderableComponents();
        for (const entity of instance.entities) {
            this.sleepEntity_(instance, entity, renderables);
        }
    }

    private sleepEntity_(instance: SceneInstance, entity: Entity, renderables: ReturnType<typeof renderableComponents>): void {
        const world = this.app_.world;
        if (!world.valid(entity)) return;
        const wasDisabled = world.has(entity, Disabled);
        if (!wasDisabled) world.insert(entity, Disabled, {});
        const entitySaved = new Map<RenderableComponentDef, boolean>();
        for (const comp of renderables) {
            if (world.has(entity, comp)) {
                const data = world.get(entity, comp) as Record<string, unknown>;
                const wasEnabled = data[comp.renderableField] !== false;
                entitySaved.set(comp, wasEnabled);
                if (wasEnabled) {
                    data[comp.renderableField] = false;
                    world.set(entity, comp, data as never);
                }
            }
        }
        if (wasDisabled || entitySaved.size) instance.savedEnabled.set(entity, { wasDisabled, renderables: entitySaved });
    }

    wake(name: string): void {
        const instance = this.scenes_.get(name);
        if (!instance || instance.status !== 'sleeping') return;
        instance.status = 'running';
        this.sleepingScenes_.delete(name);
        this.setPostProcessPassesEnabled(instance, true);

        for (const entity of instance.entities) this.restoreSleepState_(instance, entity);
        instance.savedEnabled.clear();
    }

    /** Put one entity back the way {@link sleep} found it. Shared with the
     *  promotion of a persistent entity out of a sleeping scene, which is the
     *  same question asked about one entity instead of all of them. */
    private restoreSleepState_(instance: SceneInstance, entity: Entity): void {
        const world = this.app_.world;
        if (!world.valid(entity)) return;
        const entitySaved = instance.savedEnabled.get(entity);
        if (!entitySaved?.wasDisabled) world.remove(entity, Disabled);
        if (!entitySaved) return;
        for (const [comp, wasEnabled] of entitySaved.renderables) {
            if (!world.has(entity, comp)) continue;
            const data = world.get(entity, comp) as Record<string, unknown>;
            data[comp.renderableField] = wasEnabled;
            world.set(entity, comp, data as never);
        }
    }

    private setPostProcessPassesEnabled(instance: SceneInstance, enabled: boolean): void {
        for (const stack of instance.postProcessBindings.values()) {
            stack.setAllPassesEnabled(enabled);
        }
    }

    isPaused(name: string): boolean {
        return this.pausedScenes_.has(name);
    }

    isSleeping(name: string): boolean {
        return this.sleepingScenes_.has(name);
    }

    isLoaded(name: string): boolean {
        return this.scenes_.has(name);
    }

    isActive(name: string): boolean {
        return this.activeScene_ === name;
    }

    getActive(): string | null {
        return this.activeScene_;
    }

    getActiveScenes(): string[] {
        const result: string[] = [];
        for (const [name, instance] of this.scenes_) {
            if (instance.status === 'running') {
                result.push(name);
            }
        }
        return result;
    }

    getLoaded(): string[] {
        return Array.from(this.scenes_.keys());
    }

    /** Requested scenes still waiting for retirement or publication, in request order. */
    getLoading(): string[] {
        return Array.from(this.arrivals_.keys());
    }

    /**
     * Wait for the currently requested scenes to become ready, fail, or be cancelled.
     * Includes the outgoing retirement of a switch or reload. Cancellation settles
     * this snapshot as soon as the load loses its scene, even while setup unwinds.
     * Later requests have their own wait.
     */
    async whenLoadsSettle(): Promise<void> {
        const pending: Promise<void>[] = [];
        for (const arrivals of this.arrivals_.values()) {
            for (const arrival of arrivals) pending.push(arrival.settled);
        }
        await Promise.all(pending);
    }

    getLoadOrder(): string[] {
        return [...this.loadOrder_];
    }

    bringToTop(name: string): void {
        const idx = this.loadOrder_.indexOf(name);
        if (idx === -1) return;
        this.loadOrder_.splice(idx, 1);
        this.loadOrder_.push(name);
    }

    getScene(name: string): SceneContext | null {
        return this.contexts_.get(name) ?? null;
    }

    getSceneStatus(name: string): SceneStatus | null {
        return this.scenes_.get(name)?.status ?? null;
    }
}

// =============================================================================
// Scene Manager Resource
// =============================================================================

/**
 * Scene loading, as a resource. Registered by the scene plugin, so a bare `App`
 * without it has no scenes to manage.
 *
 * @beta
 */
export const SceneManager = defineResource<SceneManagerState>(
    null!,
    'SceneManager'
);

/**
 * Prefer the entity's own asset scope, then its scene. Promoted entities retain their own scope after unloading.
 * A lookup may create a scope ending at despawn. With `create` disabled it returns null for an untracked entity.
 */
export function assetScopeForEntity(app: App, assets: AssetsData, entity: Entity): AssetScope;
export function assetScopeForEntity(app: App, assets: AssetsData, entity: Entity, create: boolean): AssetScope | null;
export function assetScopeForEntity(app: App, assets: AssetsData, entity: Entity, create = true): AssetScope | null {
    const own = assets.entityScopes.scopeFor(entity, app.world);
    if (own) return own;
    const owner = app.world.tryGet(entity, SceneOwner);
    const scene = owner?.scene && app.hasResource(SceneManager)
        ? app.getResource(SceneManager).assetScopeFor(owner.scene)
        : null;
    return scene ?? (create ? assets.entityScopes.ensure(app.world, entity) : null);
}

// =============================================================================
// Scene System Wrapper
// =============================================================================

export function wrapSceneSystem(app: App, sceneName: string, system: SystemDef): SystemDef {
    return {
        _id: Symbol(`SceneScoped_${system._name}_${sceneName}`),
        _name: `${system._name}@${sceneName}`,
        _params: system._params,
        _fn: (...args: never[]) => {
            const manager = app.getResource(SceneManager);
            const status = manager.getSceneStatus(sceneName);
            if (status === 'running') {
                (system._fn as Function)(...args);
            }
        },
    };
}

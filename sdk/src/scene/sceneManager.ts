// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sceneManager.ts
 * @brief   Scene management system for loading, switching, and unloading scenes
 */

import type { App } from '../app/app';
import type { Entity, Color } from '../types';
import type { SceneData, SceneLoadOptions, LoadedSceneAssets, SceneLoadProgressCallback } from './scene';
import { discoverSceneAssets } from '../asset/discoverAssets';
import type { SystemDef } from '../ecs/system';
import { Material } from '../render/material';
import type { DrawCallback } from '../render/customDraw';
import { Schedule } from '../ecs/system';
import { loadSceneWithAssets } from './scene';
import { registerDrawCallback, unregisterDrawCallback } from '../render/customDraw';
import { PostProcess, PostProcessStack } from '../postprocess';
import { defineResource } from '../ecs/resource';
import { SceneTransitionController } from './SceneTransitionController';
import { SceneOwner, Disabled, renderableComponents, type RenderableComponentDef } from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import { RuntimeConfig } from '../defaults';
import { log } from '../util/logger';

// =============================================================================
// Types
// =============================================================================

export type SceneStatus = 'loading' | 'running' | 'paused' | 'sleeping' | 'unloading';

export interface SceneConfig {
    name: string;
    path?: string;
    data?: SceneData;
    systems?: Array<{ schedule: Schedule; system: SystemDef }>;
    setup?: (ctx: SceneContext) => void | Promise<void>;
    cleanup?: (ctx: SceneContext) => void;
}

export interface SceneContext {
    readonly name: string;
    readonly entities: ReadonlySet<Entity>;
    spawn(): Entity;
    /** Track an externally-spawned entity as scene-owned (despawned on unload). */
    adopt(entity: Entity): void;
    despawn(entity: Entity): void;
    registerDrawCallback(id: string, fn: DrawCallback): void;
    bindPostProcess(camera: Entity, stack: PostProcessStack): void;
    unbindPostProcess(camera: Entity): void;
    setPersistent(entity: Entity, persistent: boolean): void;
}

export interface TransitionOptions {
    keepPersistent?: boolean;
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
    readonly savedEnabled = new Map<Entity, Map<RenderableComponentDef, boolean>>();
    readonly systemIds: symbol[] = [];
    /**
     * Every path-keyed asset this scene acquired, by declared type. NOT a fixed
     * list: it was seven fields, and the four types added since were preloaded
     * and never released, because adding one meant remembering three places.
     */
    readonly loadedByType = new Map<string, Set<string>>();
    /** Materials are keyed by HANDLE, not path — released through their own door. */
    loadedMaterials: Set<number> | null = null;
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

    constructor(instance: SceneInstance, app: App) {
        this.instance_ = instance;
        this.app_ = app;
    }

    get name(): string {
        return this.instance_.config.name;
    }

    get entities(): ReadonlySet<Entity> {
        return this.instance_.entities;
    }

    spawn(): Entity {
        const entity = this.app_.world.spawn();
        this.adopt(entity);
        return entity;
    }

    adopt(entity: Entity): void {
        this.instance_.entities.add(entity);
        this.app_.world.insert(entity, SceneOwner, {
            scene: this.instance_.config.name,
            persistent: false,
        });
    }

    despawn(entity: Entity): void {
        this.instance_.entities.delete(entity);
        this.app_.world.despawn(entity);
    }

    registerDrawCallback(id: string, fn: DrawCallback): void {
        this.instance_.drawCallbacks.set(id, fn);
        registerDrawCallback(id, fn, this.instance_.config.name);
    }

    bindPostProcess(camera: Entity, stack: PostProcessStack): void {
        if (this.app_.hasResource(PostProcess)) this.app_.getResource(PostProcess).bind(camera, stack);
        this.instance_.postProcessBindings.set(camera, stack);
    }

    unbindPostProcess(camera: Entity): void {
        if (this.app_.hasResource(PostProcess)) this.app_.getResource(PostProcess).unbind(camera);
        this.instance_.postProcessBindings.delete(camera);
    }

    setPersistent(entity: Entity, persistent: boolean): void {
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
        super(`Scene load for "${name}" was cancelled (the scene was unloaded mid-load)`);
        this.name = 'SceneLoadCancelled';
    }
}

export class SceneManagerState {
    private readonly app_: App;
    private readonly configs_ = new Map<string, SceneConfig>();
    private readonly scenes_ = new Map<string, SceneInstance>();
    private readonly contexts_ = new Map<string, SceneContextImpl>();
    private readonly additiveScenes_ = new Set<string>();
    private readonly pausedScenes_ = new Set<string>();
    private readonly sleepingScenes_ = new Set<string>();
    private readonly loadOrder_: string[] = [];
    private activeScene_: string | null = null;
    private initialScene_: string | null = null;
    private readonly transitionController_ = new SceneTransitionController();
    private switching_ = false;
    private loadPromises_ = new Map<string, Promise<SceneContext>>();

    constructor(app: App) {
        this.app_ = app;
    }

    reset(): void {
        for (const instance of this.scenes_.values()) {
            for (const id of instance.drawCallbacks.keys()) {
                unregisterDrawCallback(id);
            }
            const pp = this.app_.hasResource(PostProcess) ? this.app_.getResource(PostProcess) : null;
            for (const camera of instance.postProcessBindings.keys()) {
                pp?.unbind(camera);
            }
        }

        this.transitionController_.reset();

        this.configs_.clear();
        this.scenes_.clear();
        this.contexts_.clear();
        this.additiveScenes_.clear();
        this.pausedScenes_.clear();
        this.sleepingScenes_.clear();
        this.loadOrder_.length = 0;
        this.activeScene_ = null;
        this.initialScene_ = null;
        this.switching_ = false;
        this.loadPromises_.clear();
    }

    register(config: SceneConfig): void {
        this.configs_.set(config.name, config);
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
        if (this.transitionController_.isTransitioning() || this.switching_) {
            log.warn('scene', `Scene switch already in progress, ignoring switchTo("${name}")`);
            return;
        }

        const transition = options?.transition ?? 'none';

        if (transition === 'fade') {
            const duration = options?.duration ?? RuntimeConfig.sceneTransitionDuration;
            const color = options?.color ?? { ...RuntimeConfig.sceneTransitionColor };
            const oldScene = this.activeScene_;
            await this.transitionController_.start(
                {
                    duration,
                    color,
                    onStart: options?.onStart,
                    onComplete: options?.onComplete,
                },
                async () => {
                    if (oldScene && oldScene !== name) {
                        await this.unload(oldScene, options);
                    }
                    await this.load(name);
                },
            );
            return;
        }

        this.switching_ = true;
        try {
            if (this.activeScene_ && this.activeScene_ !== name) {
                await this.unload(this.activeScene_, options);
            }
            await this.load(name);
        } finally {
            this.switching_ = false;
        }
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
     * The one load path. `mode` is the only difference between the two doors —
     * which is why they were two copies, and why the fix for re-loading a SLEPT
     * scene reached only one: additive flipped the status bit without the
     * restore, leaving those entities disabled forever.
     */
    private async loadScene_(
        name: string,
        mode: 'exclusive' | 'additive',
        onProgress?: SceneLoadProgressCallback,
    ): Promise<SceneContext> {
        const adopt = (): void => {
            if (mode === 'additive') this.additiveScenes_.add(name);
            else this.activeScene_ = name;
        };

        if (this.scenes_.has(name)) {
            const existing = this.scenes_.get(name)!;
            if (existing.status === 'loading') {
                return this.loadPromises_.get(name)!;
            }
            // Re-loading a scene that was slept/paused must run the full restore
            // (remove Disabled, replay savedEnabled, re-enable post-process); a
            // bare status flip would strand its entities disabled.
            if (existing.status === 'sleeping') this.wake(name);
            else if (existing.status === 'paused') this.resume(name);
            existing.status = 'running';
            adopt();
            return this.contexts_.get(name)!;
        }

        const config = this.configs_.get(name);
        if (!config) {
            throw new Error(`Scene "${name}" is not registered`);
        }

        const instance = new SceneInstance(config);
        this.scenes_.set(name, instance);

        const ctx = new SceneContextImpl(instance, this.app_);
        this.contexts_.set(name, ctx);

        const loadPromise = (async (): Promise<SceneContext> => {
            let sceneData = config.data;
            if (!sceneData && config.path) {
                const assetServer = this.app_.hasResource(Assets)
                    ? this.app_.getResource(Assets)
                    : null;
                if (assetServer) {
                    sceneData = await assetServer.fetchJson<SceneData>(config.path);
                } else {
                    const response = await fetch(config.path);
                    sceneData = await response.json() as SceneData;
                }
            }

            await this.loadSceneData_(instance, name, config, sceneData, onProgress);

            instance.status = 'running';
            adopt();
            this.loadOrder_.push(name);
            return ctx;
        })();

        this.loadPromises_.set(name, loadPromise);
        try {
            return await loadPromise;
        } catch (err) {
            this.rollbackFailedLoad_(name, instance);
            throw err;
        } finally {
            this.loadPromises_.delete(name);
        }
    }

    /**
     * Roll back a load that threw partway. Without this, the half-registered
     * instance stays in `scenes_` stuck at `status==='loading'` while its
     * `loadPromise` is deleted in `finally` — so a retry hits the
     * `status==='loading'` branch and returns the now-undefined loadPromise,
     * wedging the scene so it can NEVER be loaded again. We also despawn any
     * entities `setup`/`loadSceneData_` spawned before the throw, to avoid a leak.
     */
    private rollbackFailedLoad_(name: string, instance: SceneInstance): void {
        for (const entity of instance.entities) {
            if (this.app_.world.valid(entity)) this.app_.world.despawn(entity);
        }
        instance.entities.clear();
        // Only clear the registry slots if they still point at THIS instance — a
        // concurrent unload+reload may already own them, and clobbering the newer
        // load would corrupt it. (A cancelled load's unload already cleared them.)
        if (this.scenes_.get(name) === instance) {
            this.scenes_.delete(name);
            this.contexts_.delete(name);
        }
    }

    async unload(name: string, options?: TransitionOptions): Promise<void> {
        const instance = this.scenes_.get(name);
        if (!instance) return;

        const ctx = this.contexts_.get(name)!;
        instance.status = 'unloading';

        if (instance.config.cleanup) {
            try {
                instance.config.cleanup(ctx);
            } catch (err) {
                // A throwing user cleanup must NOT abort the teardown below —
                // that would leak every entity/system/texture the scene owns.
                log.error('scene', `Scene "${name}" cleanup callback threw; continuing teardown`, err);
            }
        }

        const keepPersistent = options?.keepPersistent ?? true;
        for (const entity of instance.entities) {
            if (keepPersistent && this.app_.world.valid(entity) &&
                this.app_.world.has(entity, SceneOwner)) {
                const data = this.app_.world.get(entity, SceneOwner);
                if (data.persistent) {
                    // A persistent entity outlives its origin scene, so it is now
                    // global. Clear the owning-scene tag — otherwise every
                    // scene-gated consumer (the camera render filter, system/draw
                    // gating) still sees it owned by a scene that no longer exists
                    // and orphans it (a persistent camera would stop rendering).
                    // scene === '' is the existing "always active" rule.
                    if (data.scene !== '') {
                        data.scene = '';
                        this.app_.world.insert(entity, SceneOwner, data);
                    }
                    continue;
                }
            }
            if (this.app_.world.valid(entity)) {
                this.app_.world.despawn(entity);
            }
        }
        instance.entities.clear();

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

        this.scenes_.delete(name);
        this.contexts_.delete(name);
        this.additiveScenes_.delete(name);
        this.pausedScenes_.delete(name);
        this.sleepingScenes_.delete(name);

        const orderIdx = this.loadOrder_.indexOf(name);
        if (orderIdx !== -1) {
            this.loadOrder_.splice(orderIdx, 1);
        }

        if (this.activeScene_ === name) {
            this.activeScene_ = null;
        }
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
        onProgress?: SceneLoadProgressCallback,
    ): Promise<void> {
        if (sceneData) {
            const discovered = discoverSceneAssets(sceneData);
            instance.loadedByType.clear();
            // Whatever the scene declared, whatever its type. Materials are
            // collected as handles below; skeletons belong to the SpineManager.
            for (const [type, paths] of discovered.byType) {
                if (type === 'material' || type === 'spine') continue;
                instance.loadedByType.set(type, new Set(paths));
            }
            const bucketFor = (type: string): Set<string> => {
                let set = instance.loadedByType.get(type);
                if (!set) { set = new Set(); instance.loadedByType.set(type, set); }
                return set;
            };
            instance.loadedMaterials = new Set();

            const collectAssets: LoadedSceneAssets = {
                // The SAME sets the preloader fills in with what it actually
                // loaded, so the release side sees acquisitions, not intentions.
                texturePaths: bucketFor('texture'),
                materialHandles: instance.loadedMaterials,
                fontPaths: bucketFor('font'),
                spineKeys: new Set(),
            };

            const loadOptions: SceneLoadOptions = { collectAssets };
            if (onProgress) loadOptions.onProgress = onProgress;
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
            if (this.scenes_.get(name) !== instance) {
                for (const entity of entityMap.values()) {
                    if (this.app_.world.valid(entity)) this.app_.world.despawn(entity);
                }
                throw new SceneLoadCancelled(name);
            }

            for (const entity of entityMap.values()) {
                instance.entities.add(entity);
                this.app_.world.insert(entity, SceneOwner, {
                    scene: name,
                    persistent: false,
                });
            }
        }

        // Same token check for the data-less path (systems/setup only) and to fail
        // cleanly before setup() dereferences a context an unload already dropped.
        if (this.scenes_.get(name) !== instance) throw new SceneLoadCancelled(name);

        if (config.systems) {
            for (const { schedule, system } of config.systems) {
                const wrapped = wrapSceneSystem(this.app_, name, system);
                this.app_.addSystemToSchedule(schedule, wrapped);
                instance.systemIds.push(wrapped._id);
            }
        }

        const ctx = this.contexts_.get(name)!;
        if (config.setup) {
            await config.setup(ctx);
            // setup() is user code and can await for as long as it likes. An
            // unload during it means everything above — and everything setup
            // itself spawned — belongs to a scene that no longer exists.
            if (this.scenes_.get(name) !== instance) throw new SceneLoadCancelled(name);
        }
    }

    private releaseSceneAssets_(instance: SceneInstance): void {
        const assetsRes = this.app_.hasResource(Assets)
            ? this.app_.getResource(Assets)
            : null;

        if (assetsRes) {
            // Driven by what the scene acquired and the loader registry, not by a
            // list: a type with a registered loader has a release channel, and a
            // type without one no-ops. Adding an asset kind touches neither.
            for (const [type, paths] of instance.loadedByType) {
                for (const path of paths) {
                    if (type === 'texture') assetsRes.releaseTexture(path);
                    else assetsRes.releaseTyped(type, path);
                }
            }
        }

        if (instance.loadedMaterials) {
            for (const handle of instance.loadedMaterials) {
                // Release through Assets so the material's refcount + path cache
                // stay coherent; a bare Material.release strands the destroyed
                // handle in the cache for the next scene that reuses the material.
                if (assetsRes) assetsRes.releaseMaterial(handle);
                else Material.release(handle);
            }
        }

        instance.loadedByType.clear();
        instance.loadedMaterials = null;
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

        const world = this.app_.world;
        // Hoisted: the same registry answer for every entity in the scene.
        const renderables = renderableComponents();
        for (const entity of instance.entities) {
            if (!world.valid(entity)) continue;
            world.insert(entity, Disabled, {});
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
            if (entitySaved.size > 0) {
                instance.savedEnabled.set(entity, entitySaved);
            }
        }
    }

    wake(name: string): void {
        const instance = this.scenes_.get(name);
        if (!instance || instance.status !== 'sleeping') return;
        instance.status = 'running';
        this.sleepingScenes_.delete(name);
        this.setPostProcessPassesEnabled(instance, true);

        const world = this.app_.world;
        for (const entity of instance.entities) {
            if (!world.valid(entity)) continue;
            world.remove(entity, Disabled);
            const entitySaved = instance.savedEnabled.get(entity);
            if (!entitySaved) continue;
            for (const [comp, wasEnabled] of entitySaved) {
                if (world.has(entity, comp)) {
                    const data = world.get(entity, comp) as Record<string, unknown>;
                    data[comp.renderableField] = wasEnabled;
                    world.set(entity, comp, data as never);
                }
            }
        }
        instance.savedEnabled.clear();
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

export const SceneManager = defineResource<SceneManagerState>(
    null!,
    'SceneManager'
);

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

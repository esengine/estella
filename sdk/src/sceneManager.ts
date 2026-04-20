/**
 * @file    sceneManager.ts
 * @brief   Scene management system for loading, switching, and unloading scenes
 */

import type { App } from './app';
import type { Entity, Color } from './types';
import type { SceneData, SceneLoadOptions, LoadedSceneAssets } from './scene';
import { discoverSceneAssets } from './asset/discoverAssets';
import type { SystemDef } from './system';
import { Material } from './material';
import type { DrawCallback } from './customDraw';
import { Schedule } from './system';
import { loadSceneWithAssets } from './scene';
import { registerDrawCallback, unregisterDrawCallback } from './customDraw';
import { PostProcess, PostProcessStack } from './postprocess';
import { defineResource } from './resource';
import { SceneTransitionController } from './scene/SceneTransitionController';
import {
    SceneOwner, Disabled, Sprite, SpineAnimation, BitmapText,
    ShapeRenderer, ParticleEmitter,
    type AnyComponentDef,
} from './component';
import { UIRenderer } from './ui/core/ui-renderer';
import { Assets } from './asset/AssetPlugin';
import { RuntimeConfig } from './defaults';
import { log } from './logger';

const RENDERABLE_COMPONENTS: AnyComponentDef[] = [
    Sprite, SpineAnimation, BitmapText, ShapeRenderer, ParticleEmitter, UIRenderer,
];

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
    readonly savedEnabled = new Map<Entity, Map<AnyComponentDef, boolean>>();
    readonly systemIds: symbol[] = [];
    loadedTextures: Set<string> | null = null;
    loadedMaterials: Set<number> | null = null;
    loadedFonts: Set<string> | null = null;
    loadedAudio: Set<string> | null = null;
    loadedAnimClips: Set<string> | null = null;
    loadedTilemaps: Set<string> | null = null;
    loadedTimelines: Set<string> | null = null;
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
        this.instance_.entities.add(entity);
        this.app_.world.insert(entity, SceneOwner, {
            scene: this.instance_.config.name,
            persistent: false,
        });
        return entity;
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
        PostProcess.bind(camera, stack);
        this.instance_.postProcessBindings.set(camera, stack);
    }

    unbindPostProcess(camera: Entity): void {
        PostProcess.unbind(camera);
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
            for (const camera of instance.postProcessBindings.keys()) {
                PostProcess.unbind(camera);
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

    async load(name: string): Promise<SceneContext> {
        if (this.scenes_.has(name)) {
            const existing = this.scenes_.get(name)!;
            if (existing.status === 'loading') {
                return this.loadPromises_.get(name)!;
            }
            existing.status = 'running';
            this.activeScene_ = name;
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

            await this.loadSceneData_(instance, name, config, sceneData);

            instance.status = 'running';
            this.activeScene_ = name;
            this.loadOrder_.push(name);
            return ctx;
        })();

        this.loadPromises_.set(name, loadPromise);
        try {
            return await loadPromise;
        } finally {
            this.loadPromises_.delete(name);
        }
    }

    async loadAdditive(name: string): Promise<SceneContext> {
        if (this.scenes_.has(name)) {
            const existing = this.scenes_.get(name)!;
            if (existing.status === 'loading') {
                return this.loadPromises_.get(name)!;
            }
            existing.status = 'running';
            this.additiveScenes_.add(name);
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

            await this.loadSceneData_(instance, name, config, sceneData);

            instance.status = 'running';
            this.additiveScenes_.add(name);
            this.loadOrder_.push(name);
            return ctx;
        })();

        this.loadPromises_.set(name, loadPromise);
        try {
            return await loadPromise;
        } finally {
            this.loadPromises_.delete(name);
        }
    }

    async unload(name: string, options?: TransitionOptions): Promise<void> {
        const instance = this.scenes_.get(name);
        if (!instance) return;

        const ctx = this.contexts_.get(name)!;
        instance.status = 'unloading';

        if (instance.config.cleanup) {
            instance.config.cleanup(ctx);
        }

        const keepPersistent = options?.keepPersistent ?? true;
        for (const entity of instance.entities) {
            if (keepPersistent && this.app_.world.valid(entity) &&
                this.app_.world.has(entity, SceneOwner)) {
                const data = this.app_.world.get(entity, SceneOwner);
                if (data.persistent) continue;
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

        for (const camera of instance.postProcessBindings.keys()) {
            PostProcess.unbind(camera);
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

    private async loadSceneData_(
        instance: SceneInstance,
        name: string,
        config: SceneConfig,
        sceneData: SceneData | undefined,
    ): Promise<void> {
        if (sceneData) {
            const discovered = discoverSceneAssets(sceneData);
            instance.loadedTextures = discovered.byType.get('texture') ?? new Set();
            instance.loadedMaterials = new Set();
            instance.loadedFonts = discovered.byType.get('font') ?? new Set();
            // Fire-and-forget asset types that previously leaked on unload —
            // track what the scene declares so releaseSceneAssets_ can drop
            // them via the matching Assets.release* method.
            instance.loadedAudio = discovered.byType.get('audio') ?? new Set();
            instance.loadedAnimClips = discovered.byType.get('anim-clip') ?? new Set();
            instance.loadedTilemaps = discovered.byType.get('tilemap') ?? new Set();
            instance.loadedTimelines = discovered.byType.get('timeline') ?? new Set();

            const collectAssets: LoadedSceneAssets = {
                texturePaths: instance.loadedTextures,
                materialHandles: instance.loadedMaterials,
                fontPaths: instance.loadedFonts,
                spineKeys: new Set(),
            };

            const loadOptions: SceneLoadOptions = { collectAssets };
            if (this.app_.hasResource(Assets)) {
                loadOptions.assets = this.app_.getResource(Assets);
            }

            const entityMap = await loadSceneWithAssets(
                this.app_.world, sceneData, loadOptions
            );

            for (const entity of entityMap.values()) {
                instance.entities.add(entity);
                this.app_.world.insert(entity, SceneOwner, {
                    scene: name,
                    persistent: false,
                });
            }
        }

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
        }
    }

    private releaseSceneAssets_(instance: SceneInstance): void {
        const assetsRes = this.app_.hasResource(Assets)
            ? this.app_.getResource(Assets)
            : null;

        if (assetsRes && instance.loadedTextures) {
            for (const path of instance.loadedTextures) {
                assetsRes.releaseTexture(path);
            }
        }

        if (instance.loadedMaterials) {
            for (const handle of instance.loadedMaterials) {
                Material.release(handle);
            }
        }

        if (assetsRes && instance.loadedFonts) {
            for (const path of instance.loadedFonts) {
                assetsRes.releaseFont(path);
            }
        }

        if (assetsRes) {
            if (instance.loadedAudio) {
                for (const path of instance.loadedAudio) assetsRes.releaseAudio(path);
            }
            if (instance.loadedAnimClips) {
                for (const path of instance.loadedAnimClips) assetsRes.releaseAnimClip(path);
            }
            if (instance.loadedTilemaps) {
                for (const path of instance.loadedTilemaps) assetsRes.releaseTilemap(path);
            }
            if (instance.loadedTimelines) {
                for (const path of instance.loadedTimelines) assetsRes.releaseTimeline(path);
            }
        }

        instance.loadedTextures = null;
        instance.loadedMaterials = null;
        instance.loadedFonts = null;
        instance.loadedAudio = null;
        instance.loadedAnimClips = null;
        instance.loadedTilemaps = null;
        instance.loadedTimelines = null;
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
        for (const entity of instance.entities) {
            if (!world.valid(entity)) continue;
            world.insert(entity, Disabled, {});
            const entitySaved = new Map<AnyComponentDef, boolean>();
            for (const comp of RENDERABLE_COMPONENTS) {
                if (world.has(entity, comp)) {
                    const data = world.get(entity, comp) as { enabled: boolean };
                    entitySaved.set(comp, data.enabled);
                    if (data.enabled) {
                        data.enabled = false;
                        world.set(entity, comp, data);
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
                    const data = world.get(entity, comp) as { enabled: boolean };
                    data.enabled = wasEnabled;
                    world.set(entity, comp, data);
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

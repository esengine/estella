/**
 * @file    sceneManager.ts
 * @brief   Scene management system for loading, switching, and unloading scenes
 */

import type { App } from './app';
import type { Entity, Color } from './types';
import type { SceneData, SceneLoadOptions } from './scene';
import type { SystemDef } from './system';
import type { ShaderHandle } from './material';
import type { DrawCallback } from './customDraw';
import { Schedule } from './system';
import { loadSceneWithAssets } from './scene';
import { registerDrawCallback, unregisterDrawCallback } from './customDraw';
import { PostProcess } from './postprocess';
import { Draw } from './draw';
import { defineResource } from './resource';
import { SceneOwner, Sprite } from './component';
import { Assets } from './asset/AssetPlugin';
import { RuntimeConfig } from './defaults';

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
    addPostProcessPass(name: string, shader: ShaderHandle): number;
    removePostProcessPass(name: string): void;
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

type TransitionPhase = 'fade-out' | 'fade-in';

interface TransitionState {
    phase: TransitionPhase;
    elapsed: number;
    duration: number;
    color: Color;
    targetScene: string;
    options: TransitionOptions;
    resolve: () => void;
}

const TRANSITION_CALLBACK_ID = '__scene_transition_overlay__';
const OVERLAY_SIZE = 20000;

// =============================================================================
// Scene Instance (internal)
// =============================================================================

class SceneInstance {
    readonly config: SceneConfig;
    readonly entities = new Set<Entity>();
    readonly drawCallbacks = new Map<string, DrawCallback>();
    readonly postProcessPasses: string[] = [];
    readonly savedAlphas = new Map<Entity, number>();
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

    addPostProcessPass(name: string, shader: ShaderHandle): number {
        const index = PostProcess.addPass(name, shader);
        this.instance_.postProcessPasses.push(name);
        return index;
    }

    removePostProcessPass(name: string): void {
        PostProcess.removePass(name);
        const idx = this.instance_.postProcessPasses.indexOf(name);
        if (idx !== -1) {
            this.instance_.postProcessPasses.splice(idx, 1);
        }
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
    private transition_: TransitionState | null = null;
    private loadPromises_ = new Map<string, Promise<SceneContext>>();

    constructor(app: App) {
        this.app_ = app;
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
        return this.transition_ !== null;
    }

    async switchTo(name: string, options?: TransitionOptions): Promise<void> {
        if (this.transition_) {
            console.warn(`[SceneManager] Transition already in progress, ignoring switchTo("${name}")`);
            return;
        }

        const transition = options?.transition ?? 'none';

        if (transition === 'fade') {
            await this.startFadeTransition(name, options ?? {});
            return;
        }

        if (this.activeScene_ && this.activeScene_ !== name) {
            await this.unload(this.activeScene_, options);
        }
        await this.load(name);
    }

    private startFadeTransition(targetScene: string, options: TransitionOptions): Promise<void> {
        return new Promise(resolve => {
            const duration = options.duration ?? RuntimeConfig.sceneTransitionDuration;
            const color = options.color ?? { ...RuntimeConfig.sceneTransitionColor };

            options.onStart?.();

            this.transition_ = {
                phase: 'fade-out',
                elapsed: 0,
                duration,
                color,
                targetScene,
                options,
                resolve,
            };

            registerDrawCallback(TRANSITION_CALLBACK_ID, () => {
                if (!this.transition_) return;
                const halfDuration = this.transition_.duration / 2;
                const t = Math.min(this.transition_.elapsed / halfDuration, 1);
                const alpha = this.transition_.phase === 'fade-out' ? t : 1 - t;
                Draw.setLayer(9999);
                Draw.setDepth(9999);
                Draw.rect(
                    { x: 0, y: 0 },
                    { x: OVERLAY_SIZE, y: OVERLAY_SIZE },
                    { r: color.r, g: color.g, b: color.b, a: alpha },
                );
            });
        });
    }

    updateTransition(dt: number): void {
        if (!this.transition_) return;

        this.transition_.elapsed += dt;
        const halfDuration = this.transition_.duration / 2;

        if (this.transition_.phase === 'fade-out' && this.transition_.elapsed >= halfDuration) {
            this.transition_.phase = 'fade-in';
            this.transition_.elapsed = 0;

            const { targetScene, options } = this.transition_;
            const oldScene = this.activeScene_;

            const doSwitch = async () => {
                if (oldScene && oldScene !== targetScene) {
                    await this.unload(oldScene, options);
                }
                await this.load(targetScene);
            };
            doSwitch().catch(err => {
                console.error('Scene transition failed:', err);
                this.transition_ = null;
                unregisterDrawCallback(TRANSITION_CALLBACK_ID);
            });
        }

        if (this.transition_.phase === 'fade-in' && this.transition_.elapsed >= halfDuration) {
            const { resolve, options } = this.transition_;
            this.transition_ = null;
            unregisterDrawCallback(TRANSITION_CALLBACK_ID);
            options.onComplete?.();
            resolve();
        }
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
                    sceneData = await assetServer.loadJson<SceneData>(config.path);
                } else {
                    const response = await fetch(config.path);
                    sceneData = await response.json() as SceneData;
                }
            }

            if (sceneData) {
                const loadOptions: SceneLoadOptions = {};
                if (this.app_.hasResource(Assets)) {
                    loadOptions.assetServer = this.app_.getResource(Assets);
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
                }
            }

            if (config.setup) {
                await config.setup(ctx);
            }

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
                    sceneData = await assetServer.loadJson<SceneData>(config.path);
                } else {
                    const response = await fetch(config.path);
                    sceneData = await response.json() as SceneData;
                }
            }

            if (sceneData) {
                const loadOptions: SceneLoadOptions = {};
                if (this.app_.hasResource(Assets)) {
                    loadOptions.assetServer = this.app_.getResource(Assets);
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
                }
            }

            if (config.setup) {
                await config.setup(ctx);
            }

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

        for (const passName of instance.postProcessPasses) {
            try {
                PostProcess.removePass(passName);
            } catch {
                // pass may already be removed
            }
        }
        instance.postProcessPasses.length = 0;

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
        instance.savedAlphas.clear();

        for (const entity of instance.entities) {
            if (this.app_.world.valid(entity) && this.app_.world.has(entity, Sprite)) {
                const sprite = this.app_.world.get(entity, Sprite);
                instance.savedAlphas.set(entity, sprite.color.a);
                sprite.color = { ...sprite.color, a: 0 };
                this.app_.world.insert(entity, Sprite, sprite);
            }
        }
    }

    wake(name: string): void {
        const instance = this.scenes_.get(name);
        if (!instance || instance.status !== 'sleeping') return;
        instance.status = 'running';
        this.sleepingScenes_.delete(name);
        this.setPostProcessPassesEnabled(instance, true);

        for (const entity of instance.entities) {
            if (this.app_.world.valid(entity) && this.app_.world.has(entity, Sprite)) {
                const sprite = this.app_.world.get(entity, Sprite);
                const savedAlpha = instance.savedAlphas.get(entity) ?? 1;
                sprite.color = { ...sprite.color, a: savedAlpha };
                this.app_.world.insert(entity, Sprite, sprite);
            }
        }
        instance.savedAlphas.clear();
    }

    private setPostProcessPassesEnabled(instance: SceneInstance, enabled: boolean): void {
        for (const passName of instance.postProcessPasses) {
            try {
                PostProcess.setEnabled(passName, enabled);
            } catch {
                // pass may have been removed externally
            }
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

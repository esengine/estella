// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Plugin } from '../app/app';
import type { App } from '../app/app';
import { defineResource, Time } from '../ecs/resource';
import { Schedule } from '../ecs/system';
import type { SystemDef } from '../ecs/system';
import type { Entity } from '../types';
import { SpineManager, type SpineVersion } from './SpineManager';
import type { SpineModuleFactory, SpineWasmModule } from './SpineModuleLoader';
import { SPINE_VERSIONS, spineModuleId } from '../sideModules';
import { engineApi } from '../ecs/bridge/engineApi';
import { AnimatorController } from '../animation/Animator';
import { SpineAnimation } from '../ecs/component';
import { SkeletalEnableMirror } from '../skeletal/enableSync';

export type SpineEventType = 'start' | 'interrupt' | 'end' | 'complete' | 'event';

export interface SpineEvent {
    entity: Entity;
    type: SpineEventType;
    track: number;
    animationName: string;
    eventName?: string;
    floatValue?: number;
    intValue?: number;
    stringValue?: string;
}

export interface SpineEventsData {
    readonly events: readonly SpineEvent[];
}

export const SpineEvents = defineResource<SpineEventsData>({ events: [] }, 'SpineEvents');

/**
 * Public runtime spine API. Present once the app has a {@link SpineManager}
 * (a realm with the spine side-module). Read it with `Res(Spine)` to control
 * playback — `setAnimation` / `setSkin` / `setMixDuration` / `getAnimations` / etc.
 */
/**
 * Spine playback, as `Res(Spine)` hands it over. Reached through the
 * `esengine/spine` entry, since the runtime is a side module a project opts into.
 *
 * @beta
 */
export const Spine = defineResource<SpineManager>(null!, 'Spine');

const SPINE_TYPE_MAP: Record<number, SpineEventType | null> = {
    0: 'start',
    1: 'interrupt',
    2: 'end',
    3: 'complete',
    4: null,
    5: 'event',
};

export function spinePlugin(manager?: SpineManager): SpinePlugin {
    return new SpinePlugin(manager);
}

export class SpinePlugin implements Plugin {
    name = 'spine';
    private spineManager_: SpineManager | null;
    private app_: App | null = null;
    private despawnUnsub_: (() => void) | null = null;
    private submitWired_ = false;
    /** Carries SpineAnimation.enabled into the manager (see skeletal/enableSync). */
    private readonly enableMirror_ = new SkeletalEnableMirror(SpineAnimation);

    /** Pass an explicit manager for headless/tests; otherwise the plugin builds
     *  one in {@link build} from the app's {@link App.sideModules} host (the realm
     *  decides the transport — fetch / inlined / WeChat). */
    constructor(manager?: SpineManager) {
        this.spineManager_ = manager ?? null;
    }

    get spineManager(): SpineManager | null {
        return this.spineManager_;
    }

    setSpineManager(manager: SpineManager): void {
        this.spineManager_ = manager;
        if (this.app_) {
            const app = this.app_;
            app.insertResource(Spine, manager);
            this.wireSubmit_(app);
            this.wireAnimatorDriver_(app);
        }
    }

    // Register the mesh-submit callback exactly once — it reads this.spineManager_
    // live, so build and a later setSpineManager (a manager swap) share one
    // callback instead of stacking a second that double-submits every frame.
    private wireSubmit_(app: App): void {
        if (this.submitWired_) return;
        this.submitWired_ = true;
        app.pipeline?.addPreFlushCallback((registry) => {
            this.spineManager_?.submitMeshes(registry._cpp, (e: Entity) =>
                (app.world.tryGet(e, SpineAnimation)?.material as number | undefined) ?? 0);
        });
    }

    build(app: App): void {
        this.app_ = app;
        // The core the mesh batches are submitted through: the wasm module on the
        // web, the native host's bindings on a device.
        const coreModule = engineApi(app);

        if (!this.spineManager_ && app.sideModules && coreModule) {
            const host = app.sideModules;
            const factories = new Map<SpineVersion, SpineModuleFactory>();
            for (const version of SPINE_VERSIONS) {
                factories.set(version, async () => {
                    const m = await host.acquire(spineModuleId(version));
                    if (!m) throw new Error(`spine ${version} module unavailable in this realm`);
                    return m as unknown as SpineWasmModule;
                });
            }
            this.spineManager_ = new SpineManager(coreModule, factories);
        }

        app.insertResource(SpineEvents, { events: [] });

        if (this.spineManager_) {
            app.insertResource(Spine, this.spineManager_);
        }

        this.despawnUnsub_ = app.world.onDespawn((entity: Entity) => {
            this.spineManager_?.removeEntity(entity);
        });

        // Per-frame spine tick: carry SpineAnimation.enabled across into the
        // manager (see skeletal/enableSync), advance every loaded side-module
        // backend (one per version), and publish their events. Each backend
        // advances only its own entities; there is no native runtime to tick.
        const spineUpdateSystem: SystemDef = {
            _id: Symbol('SpineUpdateSystem'),
            _name: 'SpineUpdateSystem',
            _params: [],
            _fn: () => {
                const time = app.getResource(Time);
                const manager = this.spineManager_;
                if (manager) {
                    this.enableMirror_.sync(app.world, manager);
                    manager.updateAnimations(time.delta);
                }
                this.collectAndPublishEvents_(app);
            },
        };

        app.addSystemToSchedule(Schedule.PreUpdate, spineUpdateSystem);

        if (this.spineManager_) {
            this.wireSubmit_(app);
        }
    }

    /**
     * Wire the spine manager into the Animator as its Spine driver, so
     * spine-targeting Animator states drive skeletal animations. Runs after all
     * plugins build (the AnimatorController resource exists by then if the
     * AnimationPlugin is installed).
     */
    finish(app: App): void {
        this.wireAnimatorDriver_(app);
    }

    private wireAnimatorDriver_(app: App): void {
        if (this.spineManager_ && app.hasResource(AnimatorController)) {
            app.getResource(AnimatorController).setSpineDriver(this.spineManager_);
        }
    }

    /**
     * Drop the world.onDespawn subscription and dispose the spine manager's
     * native backends. Without this, a re-init left a stale despawn listener
     * pointing at a dead manager and leaked the wasm-side spine resources.
     */
    cleanup(): void {
        this.despawnUnsub_?.();
        this.despawnUnsub_ = null;
        this.spineManager_?.dispose();
        this.app_ = null;
        this.submitWired_ = false; // a fresh build (new pipeline) re-registers the submit
    }

    private collectAndPublishEvents_(app: App): void {
        const events: SpineEvent[] = [];

        if (this.spineManager_) {
            for (const { entity, raw } of this.spineManager_.collectAllEvents()) {
                const type = SPINE_TYPE_MAP[raw.type];
                if (type === null || type === undefined) continue;
                const evt: SpineEvent = {
                    entity,
                    type,
                    track: raw.track,
                    animationName: raw.animationName,
                };
                if (type === 'event') {
                    evt.eventName = raw.eventName;
                    evt.floatValue = raw.floatValue;
                    evt.intValue = raw.intValue;
                    evt.stringValue = raw.stringValue;
                }
                events.push(evt);
            }
        }

        app.insertResource(SpineEvents, { events });
    }
}

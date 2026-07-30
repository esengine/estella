// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dragonbones/DragonBonesPlugin.ts
 * @brief   Wires the DragonBones manager into an App: a resource to reach it by,
 *          a tick that advances it, a submit that draws it, and a teardown.
 *
 * @details The module is acquired lazily. Loading it costs a wasm instantiation,
 *          and a project with no DragonBones in it should not pay that — so
 *          nothing is fetched until something asks for the manager, and an app
 *          that never does never touches the side module at all.
 */
import type { App, Plugin } from '../app/app';
import { Schedule } from '../ecs/system';
import type { SystemDef } from '../ecs/system';
import type { Entity } from '../types';
import { defineResource, Time } from '../ecs/resource';
import { engineApi } from '../ecs/bridge/engineApi';
import { DragonBonesAnimation } from '../ecs/component';
import { SkeletalEnableMirror } from '../skeletal/enableSync';
import { DragonBonesManager } from './DragonBonesManager';
import { DragonBonesModuleController } from './DragonBonesController';
import { wrapDragonBonesModule, type DragonBonesWasmModule } from './DragonBonesModuleLoader';
import { log } from '../util/logger';

/** Reach the manager from a system or from gameplay code. Null until acquired. */
export const DragonBones = defineResource<DragonBonesManager | null>(null, 'DragonBones');

export class DragonBonesPlugin implements Plugin {
    name = 'dragonbones';
    private manager_: DragonBonesManager | null;
    private app_: App | null = null;
    private despawnUnsub_: (() => void) | null = null;
    private acquiring_: Promise<DragonBonesManager | null> | null = null;
    private submitWired_ = false;
    /** Carries DragonBonesAnimation.enabled into the manager (skeletal/enableSync). */
    private readonly enableMirror_ = new SkeletalEnableMirror(DragonBonesAnimation);

    /** Pass a manager for headless use or tests; otherwise it is built on demand. */
    constructor(manager?: DragonBonesManager) {
        this.manager_ = manager ?? null;
    }

    get manager(): DragonBonesManager | null {
        return this.manager_;
    }

    /**
     * Load the side module and build the manager, once.
     *
     * Concurrent callers share the one in-flight promise: two entities spawning in
     * the same frame must not instantiate two wasm modules and then disagree about
     * which one owns their skeletons.
     */
    acquire(): Promise<DragonBonesManager | null> {
        if (this.manager_) return Promise.resolve(this.manager_);
        if (this.acquiring_) return this.acquiring_;

        const app = this.app_;
        const host = app?.sideModules;
        if (!app || !host) return Promise.resolve(null);

        this.acquiring_ = host.acquire('dragonbones')
            .then(module => {
                if (!module) {
                    log.warn('dragonbones', 'module unavailable in this realm');
                    return null;
                }
                const raw = module as unknown as DragonBonesWasmModule;
                const manager = new DragonBonesManager(
                    new DragonBonesModuleController(raw, wrapDragonBonesModule(raw)));
                this.manager_ = manager;
                app.insertResource(DragonBones, manager);
                return manager;
            })
            .catch((err: unknown) => {
                log.warn('dragonbones', `module failed to load: ${String(err)}`);
                return null;
            })
            .finally(() => {
                this.acquiring_ = null;
            });
        return this.acquiring_;
    }

    build(app: App): void {
        this.app_ = app;
        app.insertResource(DragonBones, this.manager_);

        this.despawnUnsub_ = app.world.onDespawn((entity: Entity) => {
            this.manager_?.removeEntity(entity);
        });

        // Reads this.manager_ live rather than capturing it, so a manager that
        // arrives later — which is the normal case, since acquisition is lazy —
        // is picked up without registering a second callback that double-submits.
        if (!this.submitWired_) {
            this.submitWired_ = true;
            const core = engineApi(app);
            app.pipeline?.addPreFlushCallback(registry => {
                if (core) this.manager_?.submitMeshes(core, registry._cpp);
            });
        }

        // Carries DragonBonesAnimation.enabled across before advancing — the flag
        // lives on the component, and nothing else reads it into the manager
        // (see skeletal/enableSync).
        const updateSystem: SystemDef = {
            _id: Symbol('DragonBonesUpdateSystem'),
            _name: 'DragonBonesUpdateSystem',
            _params: [],
            _fn: () => {
                const time = app.getResource(Time);
                const manager = this.manager_;
                if (!manager) return;
                this.enableMirror_.sync(app.world, manager);
                manager.updateAnimations(time?.delta ?? 0);
            },
        };
        // PreUpdate, like Spine: poses have to be current before anything that
        // reads a bone position or a bounding box runs this frame.
        app.addSystemToSchedule(Schedule.PreUpdate, updateSystem);
    }

    /**
     * Drop the despawn subscription and free every skeleton the module holds.
     * Without it a re-init leaves a listener pointing at a dead manager and the
     * wasm side keeps armatures nothing can reach.
     */
    cleanup(): void {
        this.despawnUnsub_?.();
        this.despawnUnsub_ = null;
        this.manager_?.dispose();
        this.manager_ = null;
        this.acquiring_ = null;
    }
}

export const dragonBonesPlugin = (): DragonBonesPlugin => new DragonBonesPlugin();

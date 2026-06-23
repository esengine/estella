// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Plugin } from '../app';
import type { App } from '../app';
import { defineResource, Time } from '../resource';
import { Schedule } from '../system';
import type { SystemDef } from '../system';
import type { Entity } from '../types';
import { SpineManager } from './SpineManager';
import type { SpineWasmProvider } from './SpineModuleLoader';
import { createSpineFactories } from './SpineModuleLoader';

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

const SPINE_TYPE_MAP: Record<number, SpineEventType | null> = {
    0: 'start',
    1: 'interrupt',
    2: 'end',
    3: 'complete',
    4: null,
    5: 'event',
};

export class SpinePlugin implements Plugin {
    name = 'spine';
    private spineManager_: SpineManager | null;
    private provider_: SpineWasmProvider | null;
    private app_: App | null = null;
    private despawnUnsub_: (() => void) | null = null;

    constructor(managerOrProvider?: SpineManager | SpineWasmProvider) {
        if (managerOrProvider instanceof SpineManager) {
            this.spineManager_ = managerOrProvider;
            this.provider_ = null;
        } else {
            this.spineManager_ = null;
            this.provider_ = managerOrProvider ?? null;
        }
    }

    get spineManager(): SpineManager | null {
        return this.spineManager_;
    }

    setSpineManager(manager: SpineManager): void {
        this.spineManager_ = manager;
        if (this.app_) {
            const app = this.app_;
            const pipeline = app.pipeline;
            pipeline?.addPreFlushCallback((registry) => {
                manager.submitMeshes(registry._cpp);
            });
        }
    }

    build(app: App): void {
        this.app_ = app;
        const coreModule = app.wasmModule!;

        if (!this.spineManager_ && this.provider_) {
            const factories = createSpineFactories(this.provider_);
            this.spineManager_ = new SpineManager(coreModule, factories);
        }

        app.insertResource(SpineEvents, { events: [] });

        this.despawnUnsub_ = app.world.onDespawn((entity: Entity) => {
            this.spineManager_?.removeEntity(entity);
        });

        // Per-frame spine tick: advance every loaded side-module backend (one
        // per version) and publish their events. Each backend advances only its
        // own entities; there is no native runtime to tick.
        const spineUpdateSystem: SystemDef = {
            _id: Symbol('SpineUpdateSystem'),
            _name: 'SpineUpdateSystem',
            _params: [],
            _fn: () => {
                const time = app.getResource(Time);
                this.spineManager_?.updateAnimations(time.delta);
                this.collectAndPublishEvents_(app);
            },
        };

        app.addSystemToSchedule(Schedule.PreUpdate, spineUpdateSystem);

        if (this.spineManager_) {
            const manager = this.spineManager_;
            const pipeline = app.pipeline;
            pipeline?.addPreFlushCallback((registry) => {
                manager.submitMeshes(registry._cpp);
            });
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

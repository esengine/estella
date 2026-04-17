import type { Plugin } from '../app';
import type { App } from '../app';
import { defineResource, Time } from '../resource';
import { Schedule } from '../system';
import type { SystemDef } from '../system';
import type { Entity } from '../types';
import { initSpineCppAPI, SpineCpp } from './SpineCppAPI';
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
                const fc = app.getResource(Time).frameCount;
                manager.submitMeshes(registry._cpp, fc);
            });
        }
    }

    build(app: App): void {
        this.app_ = app;
        const coreModule = app.wasmModule!;
        initSpineCppAPI(coreModule);

        if (!this.spineManager_ && this.provider_) {
            const factories = createSpineFactories(this.provider_);
            this.spineManager_ = new SpineManager(coreModule, factories);
        }

        app.insertResource(SpineEvents, { events: [] });

        app.world.onDespawn((entity: Entity) => {
            this.spineManager_?.removeEntity(entity);
        });

        // Per-frame spine tick. Both calls fire unconditionally, but
        // they tick DISJOINT entity sets — this is not a double-tick:
        //   - SpineCpp.update(registry, dt)      advances every entity
        //                                        whose C++ `needsReload`
        //                                        flag is true. That's
        //                                        the 4.2 set.
        //   - spineManager_.updateAnimations(dt) iterates
        //                                        SpineManager.backends_
        //                                        (ModuleBackend
        //                                        instances, one per
        //                                        loaded JS runtime
        //                                        version — 3.8 / 4.1).
        //                                        Each backend advances
        //                                        only its own entities.
        //
        // SpineManager.loadEntity does the routing:
        //   - version '4.2': sets entityVersions_['4.2'] and returns,
        //     leaving the entity under C++ control;
        //   - version '3.8' / '4.1': calls spine_setNeedsReload(false)
        //     to hand the entity off to the JS runtime.
        const spineUpdateSystem: SystemDef = {
            _id: Symbol('SpineUpdateSystem'),
            _name: 'SpineUpdateSystem',
            _params: [],
            _fn: () => {
                const cppRegistry = app.world.getCppRegistry();
                if (!cppRegistry) return;
                const time = app.getResource(Time);
                SpineCpp.update({ _cpp: cppRegistry }, time.delta);
                this.spineManager_?.updateAnimations(time.delta);
                this.collectAndPublishEvents_(app);
            },
        };

        app.addSystemToSchedule(Schedule.PreUpdate, spineUpdateSystem);

        if (this.spineManager_) {
            const manager = this.spineManager_;
            const pipeline = app.pipeline;
            pipeline?.addPreFlushCallback((registry) => {
                const fc = app.getResource(Time).frameCount;
                manager.submitMeshes(registry._cpp, fc);
            });
        }
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

        this.collectNativeEvents_(events);
        app.insertResource(SpineEvents, { events });
    }

    private collectNativeEvents_(events: SpineEvent[]): void {
        const EVENT_STRIDE = 4;
        const count = SpineCpp.getEventCount();
        if (count === 0) return;

        const bufferPtr = SpineCpp.getEventBuffer();
        const coreModule = this.app_?.wasmModule;
        if (!coreModule || !bufferPtr) {
            SpineCpp.clearEvents();
            return;
        }

        const f32 = coreModule.HEAPF32;
        const base = bufferPtr >> 2;

        for (let i = 0; i < count; i++) {
            const offset = base + i * EVENT_STRIDE;
            const typeNum = f32[offset];
            const type = SPINE_TYPE_MAP[typeNum];
            if (type === null || type === undefined) continue;

            const record = SpineCpp.getEventRecord(i);
            if (!record) continue;

            const evt: SpineEvent = {
                entity: record.entity as Entity,
                type,
                track: f32[offset + 1],
                animationName: record.animationName,
            };
            if (type === 'event') {
                evt.eventName = record.eventName;
                evt.floatValue = f32[offset + 2];
                evt.intValue = f32[offset + 3];
                evt.stringValue = record.stringValue;
            }
            events.push(evt);
        }

        SpineCpp.clearEvents();
    }
}

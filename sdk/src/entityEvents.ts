// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    entityEvents.ts
 * @brief   EntityEventQueue — the entity-scoped, string-named event channel.
 *
 * The engine has two event channels and they answer different questions.
 * `event.ts` is the GLOBAL, statically-typed bus: `defineEvent<T>()` gives a
 * symbol-keyed, double-buffered stream that systems read as a batch ("all
 * damage events this frame"). This file is the per-ENTITY one: an open string
 * key ("click", "trigger_enter") dispatched synchronously to handlers
 * subscribed for that entity, with bubbling to ancestors. It is what "this
 * button was clicked" means, and it is the channel {@link EventBinding} wires
 * authored data onto.
 *
 * It grew up inside `ui/` (as UIEventQueue) because widgets were its first
 * producer, but nothing in it is UI-specific — the type strings are open and
 * the queue never looks at a component. It lives here so non-UI producers and
 * the core binding layer can speak it without importing `ui/`. The `ui/core/
 * events.ts` names remain as aliases of these very objects.
 */
import { defineResource } from './resource';
import type { Entity } from './types';
import { log } from './logger';

export interface EntityEvent<TData = unknown> {
    /** Event type string (e.g. `'click'`, `'change'`). */
    readonly type: string;
    /** The entity where the event originated. */
    readonly target: Entity;
    /** The entity currently handling the event (differs from target during bubbling). */
    readonly currentTarget: Entity;
    /** User-provided payload (shape depends on `type`). */
    readonly data: TData;
    /** True if any handler called `stopPropagation()`. */
    propagationStopped: boolean;
    /** True if any handler called `preventDefault()`. */
    defaultPrevented: boolean;
    /** Stop the event from bubbling further up the parent chain. */
    stopPropagation(): void;
    /** Signal that the default action (if any) should be skipped. */
    preventDefault(): void;
}

export type EntityEventHandler<TData = unknown> = (event: EntityEvent<TData>) => void;
export type Unsubscribe = () => void;

/**
 * Entity event queue: pub/sub with bubbling support.
 *
 * @example
 * ```ts
 * const events = new EntityEventQueue();
 * world.onDespawn(e => events.removeAll(e));   // one-time wiring
 *
 * events.on(buttonEntity, 'click', e => console.log('clicked'));
 * events.emit(buttonEntity, 'click');
 * ```
 */
export class EntityEventQueue {
    private readonly entityHandlers_ = new Map<
        Entity,
        Map<string, Set<EntityEventHandler>>
    >();
    private readonly globalHandlers_ = new Map<string, Set<EntityEventHandler>>();
    private pending_: EntityEvent[] = [];
    private readonly activeKeys_ = new Set<string>();

    /**
     * Subscribe to an entity-specific event.
     * Returns an unsubscribe function.
     */
    on(entity: Entity, type: string, handler: EntityEventHandler): Unsubscribe;
    /**
     * Subscribe to all events of a type, from any entity.
     */
    on(type: string, handler: EntityEventHandler): Unsubscribe;
    on(
        arg1: Entity | string,
        arg2: string | EntityEventHandler,
        arg3?: EntityEventHandler,
    ): Unsubscribe {
        // Entity-specific: on(entity, type, handler)
        if (typeof arg1 === 'number' && typeof arg2 === 'string' && typeof arg3 === 'function') {
            const entity = arg1 as Entity;
            const type = arg2;
            const handler = arg3;

            let typeMap = this.entityHandlers_.get(entity);
            if (!typeMap) {
                typeMap = new Map();
                this.entityHandlers_.set(entity, typeMap);
            }
            let set = typeMap.get(type);
            if (!set) {
                set = new Set();
                typeMap.set(type, set);
            }
            set.add(handler);

            return () => {
                const tm = this.entityHandlers_.get(entity);
                const s = tm?.get(type);
                if (s) {
                    s.delete(handler);
                    if (s.size === 0) tm!.delete(type);
                    if (tm && tm.size === 0) this.entityHandlers_.delete(entity);
                }
            };
        }

        // Global: on(type, handler)
        const type = arg1 as string;
        const handler = arg2 as EntityEventHandler;

        let set = this.globalHandlers_.get(type);
        if (!set) {
            set = new Set();
            this.globalHandlers_.set(type, set);
        }
        set.add(handler);

        return () => {
            const s = this.globalHandlers_.get(type);
            if (s) {
                s.delete(handler);
                if (s.size === 0) this.globalHandlers_.delete(type);
            }
        };
    }

    /**
     * Remove all entity-specific handlers for `entity`.
     * Wire this to `world.onDespawn` for automatic cleanup.
     */
    removeAll(entity: Entity): void {
        this.entityHandlers_.delete(entity);
    }

    /**
     * Emit an event for `entity`. Synchronously dispatches to registered
     * handlers and queues the event for `drain()` / `query()`. Returns the
     * event so callers can inspect propagationStopped / defaultPrevented
     * (e.g. to drive bubbling to parents).
     */
    emit<TData = unknown>(
        entity: Entity,
        type: string,
        data?: TData,
    ): EntityEvent<TData> {
        const event: EntityEvent<TData> = {
            type,
            target: entity,
            currentTarget: entity,
            data: data as TData,
            propagationStopped: false,
            defaultPrevented: false,
            stopPropagation() {
                this.propagationStopped = true;
            },
            preventDefault() {
                this.defaultPrevented = true;
            },
        };
        this.pending_.push(event);
        this.dispatch_(entity, event);
        return event;
    }

    /**
     * Emit a bubbled event to an ancestor. Shares propagation state with
     * the root event: calling stopPropagation on the bubbled event marks
     * the root as stopped so callers can halt the bubbling walk.
     *
     * Callers are responsible for walking the parent chain; this queue
     * does not know about hierarchy.
     */
    emitBubbled(ancestor: Entity, rootEvent: EntityEvent): EntityEvent {
        if (rootEvent.propagationStopped) return rootEvent;

        const bubbled: EntityEvent = {
            type: rootEvent.type,
            target: rootEvent.target,
            currentTarget: ancestor,
            data: rootEvent.data,
            propagationStopped: false,
            defaultPrevented: rootEvent.defaultPrevented,
            stopPropagation() {
                this.propagationStopped = true;
                rootEvent.propagationStopped = true;
            },
            preventDefault() {
                this.defaultPrevented = true;
                (rootEvent as { defaultPrevented: boolean }).defaultPrevented = true;
            },
        };
        this.pending_.push(bubbled);
        this.dispatch_(ancestor, bubbled);
        return bubbled;
    }

    /**
     * Return all events queued since the last drain and clear the queue.
     * Typically called once per frame by a UI system.
     */
    drain(): readonly EntityEvent[] {
        const events = this.pending_;
        this.pending_ = [];
        return events;
    }

    /** Non-destructively inspect currently-pending events of a type. */
    query(type: string): readonly EntityEvent[] {
        return this.pending_.filter((e) => e.type === type);
    }

    /** Remove all handlers and pending events. */
    clear(): void {
        this.entityHandlers_.clear();
        this.globalHandlers_.clear();
        this.pending_ = [];
        this.activeKeys_.clear();
    }

    private dispatch_(entity: Entity, event: EntityEvent): void {
        // Re-entry guard: a handler that emits the same event on the same
        // entity would recurse forever. Block recursion for (entity, type).
        const key = `${entity as number}:${event.type}`;
        if (this.activeKeys_.has(key)) return;
        this.activeKeys_.add(key);

        try {
            const typeMap = this.entityHandlers_.get(entity);
            if (typeMap) {
                const set = typeMap.get(event.type);
                if (set) {
                    // Snapshot so handler-side unsubscribe doesn't skip peers
                    for (const h of Array.from(set)) {
                        try {
                            h(event);
                        } catch (err) {
                            log.error(
                                'ui',
                                `EntityEventQueue handler error [${event.type}]`,
                                err,
                            );
                        }
                    }
                }
            }

            const global = this.globalHandlers_.get(event.type);
            if (global) {
                for (const h of Array.from(global)) {
                    try {
                        h(event);
                    } catch (err) {
                        log.error(
                            'ui',
                            `EntityEventQueue handler error [${event.type}]`,
                            err,
                        );
                    }
                }
            }
        } finally {
            this.activeKeys_.delete(key);
        }
    }
}

/**
 * Shared EntityEventQueue resource. A plugin inserts the authoritative
 * instance on startup; systems access it via `Res(EntityEvents)`.
 *
 * The default value exists only so the resource is well-typed before
 * the owning plugin constructs the real queue. Consumers should never
 * see the placeholder at runtime — UIInteractionPlugin inserts its
 * queue during `build()`.
 */
export const EntityEvents = defineResource<EntityEventQueue>(new EntityEventQueue(), 'EntityEvents');

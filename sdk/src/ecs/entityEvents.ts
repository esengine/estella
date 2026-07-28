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
import type { Entity } from '../types';
import type { App } from '../app';
import { log } from '../logger';

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
 * The event objects handed to handlers.
 *
 * A class rather than an object literal because the literal's two methods were
 * fresh closures on every emit. Under a JIT that costs nothing; on the
 * interpreter a device runs, a busy frame (physics republishes every contact to
 * both participants) allocated them by the tens of thousands and threw them
 * straight away. On the prototype they are allocated once.
 */
class EmittedEvent<TData> implements EntityEvent<TData> {
    propagationStopped = false;
    defaultPrevented = false;

    constructor(
        readonly type: string,
        readonly target: Entity,
        readonly currentTarget: Entity,
        readonly data: TData,
    ) {}

    stopPropagation(): void {
        this.propagationStopped = true;
    }

    preventDefault(): void {
        this.defaultPrevented = true;
    }
}

/**
 * A bubbled copy, which shares its propagation state with the event that
 * started the walk — stopping it stops the root, so the caller's walk halts.
 */
class BubbledEvent<TData> extends EmittedEvent<TData> {
    constructor(type: string, target: Entity, currentTarget: Entity, data: TData,
                private readonly root_: EntityEvent) {
        super(type, target, currentTarget, data);
        this.defaultPrevented = root_.defaultPrevented;
    }

    override stopPropagation(): void {
        this.propagationStopped = true;
        this.root_.propagationStopped = true;
    }

    override preventDefault(): void {
        this.defaultPrevented = true;
        this.root_.defaultPrevented = true;
    }
}

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
        const event = new EmittedEvent<TData>(type, entity, entity, data as TData);
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

        const bubbled = new BubbledEvent(
            rootEvent.type, rootEvent.target, ancestor, rootEvent.data, rootEvent);
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

/**
 * The app's queue, creating it on first ask. Every producer and consumer — the
 * UI hit-test, the physics bridge, the binding dispatcher — goes through here
 * instead of inserting its own, so plugin build order cannot decide who wins and
 * a late plugin can never replace the queue earlier subscribers captured.
 * Despawn cleanup is wired once, with the queue.
 */
export function ensureEntityEvents(app: App): EntityEventQueue {
    if (!app.hasResource(EntityEvents)) {
        const queue = new EntityEventQueue();
        app.insertResource(EntityEvents, queue);
        app.world.onDespawn((entity: Entity) => queue.removeAll(entity));
    }
    return app.getResource(EntityEvents) as EntityEventQueue;
}

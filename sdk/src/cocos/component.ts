// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/component.ts
 * @brief   `Component`, the base class a Cocos script extends.
 *
 * The lifecycle methods are not defined here — a subclass declares the ones it wants, and the host calls whichever exist, in
 * Cocos's order: `onLoad` once when the instance is made, `onEnable` when it becomes active, `start` once before its first
 * `update`, `update(dt)` and `lateUpdate(dt)` each frame while active, `onDisable` when it stops being active and
 * `onDestroy` when the component or its entity goes. Declaring them as optional members (rather than empty methods) keeps a
 * subclass's own `override` honest and lets the host skip the call when nothing is there.
 */
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { classInfoOf, type ComponentCtor } from './registry';
import type { Node } from './node';

/** One `schedule` / `scheduleOnce` registration. */
interface Timer {
    callback: (dt: number) => void;
    /** Seconds between calls. */
    interval: number;
    /** Calls after the first; `Infinity` for forever. */
    repeat: number;
    /** Seconds until the next call. */
    remaining: number;
    /** Seconds since this timer last fired (what `dt` is). */
    since: number;
    calls: number;
}

export class Component {
    /** The node this component is on. Set before `onLoad`. */
    node!: Node;
    /** Whether the component takes part: a disabled one gets no `update`, and `onDisable` has run. */
    enabled = true;

    /** @internal */ _world!: World;
    /** @internal */ _entity!: Entity;
    /** @internal */ _loaded = false;
    /** @internal */ _started = false;
    /** @internal */ _enabledApplied = false;
    /** @internal */ _destroyed = false;
    /** @internal */ _timers: Timer[] = [];

    onLoad?(): void;
    onEnable?(): void;
    start?(): void;
    update?(dt: number): void;
    lateUpdate?(dt: number): void;
    onDisable?(): void;
    onDestroy?(): void;

    get uuid(): string { return `${this._entity}:${this.constructor.name}`; }

    /** See {@link Node.toJSON}: a component holds the world too. */
    toJSON(): { component: string; entity: number } { return { component: this.constructor.name, entity: this._entity }; }
    [Symbol.for('nodejs.util.inspect.custom')](): string { return `${this.constructor.name}(#${this._entity})`; }
    get name(): string { return `${this.node?.name ?? ''}<${this.constructor.name}>`; }

    /** False once the component or its entity has gone. */
    get isValid(): boolean { return !this._destroyed && !!this._world?.valid(this._entity); }

    /** Enabled, and so is every node above it. */
    get enabledInHierarchy(): boolean { return this.enabled && !!this._world?.isEntityActive(this._entity); }

    getComponent<T extends Component>(type: ComponentCtor<T> | string): T | null { return this.node.getComponent(type); }
    getComponents<T extends Component>(type: ComponentCtor<T> | string): T[] { return this.node.getComponents(type); }
    getComponentInChildren<T extends Component>(type: ComponentCtor<T> | string): T | null { return this.node.getComponentInChildren(type); }
    getComponentsInChildren<T extends Component>(type: ComponentCtor<T> | string): T[] { return this.node.getComponentsInChildren(type); }
    addComponent<T extends Component>(type: ComponentCtor<T> | string): T | null { return this.node.addComponent(type); }

    /**
     * Call @p callback every @p interval seconds, @p repeat more times after the first call (forever by default), the first
     * after @p delay seconds. The callback gets the seconds since its last call.
     */
    schedule(callback: (dt: number) => void, interval = 0, repeat = Infinity, delay = 0): void {
        this.unschedule(callback);
        this._timers.push({ callback, interval, repeat, remaining: delay > 0 ? delay : interval, since: 0, calls: 0 });
    }

    scheduleOnce(callback: (dt: number) => void, delay = 0): void {
        this.schedule(callback, 0, 0, delay);
    }

    unschedule(callback: (dt: number) => void): void {
        this._timers = this._timers.filter((t) => t.callback !== callback);
    }

    unscheduleAllCallbacks(): void {
        this._timers.length = 0;
    }

    /** Remove this component from its node. `onDestroy` runs on the next frame, as in Cocos. */
    destroy(): boolean {
        if (this._destroyed) return false;
        const info = classInfoOf(this.constructor);
        if (info && this._world?.valid(this._entity)) this._world.remove(this._entity, info.def);
        return true;
    }

    /** @internal Advance this component's timers; called by the host, once a frame, while the component is active. */
    _tickTimers(dt: number): void {
        if (this._timers.length === 0) return;
        // A callback may schedule or unschedule: walk a copy, and skip a timer that was removed meanwhile.
        for (const timer of [...this._timers]) {
            if (!this._timers.includes(timer)) continue;
            timer.since += dt;
            timer.remaining -= dt;
            if (timer.remaining > 0) continue;
            const elapsed = timer.since;
            timer.since = 0;
            timer.calls++;
            timer.remaining = timer.interval > 0 ? timer.remaining + timer.interval : 0;
            if (timer.calls > timer.repeat) this._timers = this._timers.filter((t) => t !== timer);
            timer.callback.call(this, elapsed);
        }
    }
}

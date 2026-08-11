// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    resource.ts
 * @brief   Resource system for global singleton data
 */

import { deepClone } from '../util/deepClone';

// =============================================================================
// Resource Definition
// =============================================================================

/**
 * A resource type, as {@link defineResource} returns it: the world holds one
 * value per definition. Opaque — pass it to `Res`/`ResMut`, `insertResource` or
 * `getResource` rather than reading it.
 *
 * @public
 */
export interface ResourceDef<T> {
    /** @internal */
    readonly _id: symbol;
    /** @internal */
    readonly _name: string;
    /** @internal */
    readonly _default: T;
}

let resourceCounter = 0;

export function defineResource<T>(defaultValue: T, name?: string): ResourceDef<T> {
    const id = ++resourceCounter;
    return {
        _id: Symbol(`Resource_${id}_${name ?? ''}`),
        _name: name ?? `Resource_${id}`,
        _default: defaultValue
    };
}

// =============================================================================
// Resource Descriptors (for system parameters)
// =============================================================================

/**
 * A request for read access to a resource, as {@link Res} returns it. Opaque —
 * the system body receives the resource value itself.
 *
 * @public
 */
export interface ResDescriptor<T> {
    /** @internal */
    readonly _type: 'res';
    /** @internal */
    readonly _resource: ResourceDef<T>;
}

/**
 * A request for write access to a resource, as {@link ResMut} returns it.
 * Opaque — the body receives a `ResMutInstance`, whose `set`/`modify` are what
 * store the value back.
 *
 * @public
 */
export interface ResMutDescriptor<T> {
    /** @internal */
    readonly _type: 'res_mut';
    /** @internal */
    readonly _resource: ResourceDef<T>;
}

/**
 * Ask a system for read access to a resource: the world's single instance of
 * `resource`, passed to the system body as the stored value itself.
 *
 * Not a copy — an object resource's fields are reachable through it. Replacing
 * the value, and the change tick recording it, is what {@link ResMut} is for.
 *
 * @public
 */
export function Res<T>(resource: ResourceDef<T>): ResDescriptor<T> {
    return { _type: 'res', _resource: resource };
}

export function ResMut<T>(resource: ResourceDef<T>): ResMutDescriptor<T> {
    return { _type: 'res_mut', _resource: resource };
}

// =============================================================================
// Resource Instances (Runtime)
// =============================================================================

export class ResMutInstance<T> {
    private value_: T;
    private readonly setter_: (v: T) => void;

    constructor(value: T, setter: (v: T) => void) {
        this.value_ = value;
        this.setter_ = setter;
    }

    get(): T {
        return this.value_;
    }

    set(value: T): void {
        this.value_ = value;
        this.setter_(value);
    }

    modify(fn: (value: T) => void): void {
        fn(this.value_);
        this.setter_(this.value_);
    }

    /** @internal */
    updateValue(value: T): void {
        this.value_ = value;
    }
}

// =============================================================================
// Resource Storage
// =============================================================================

export class ResourceStorage {
    private resources_ = new Map<symbol, unknown>();
    private resMutPool_ = new Map<symbol, ResMutInstance<unknown>>();
    private ticks_ = new Map<symbol, number>();
    private globalTick_ = 0;
    private nameRegistry_ = new Map<string, ResourceDef<unknown>>();
    /**
     * Slots holding a materialised default rather than a value somebody put
     * there. `has` is what every self-gating subsystem asks before installing
     * itself, so a read must not answer it: a resource defaulting to `null`
     * would report present the moment any system took it as a parameter.
     */
    private defaulted_ = new Set<symbol>();

    insert<T>(resource: ResourceDef<T>, value: T): void {
        this.resources_.set(resource._id, value);
        this.defaulted_.delete(resource._id);
        this.ticks_.set(resource._id, ++this.globalTick_);
        if (resource._name && !resource._name.startsWith('Resource_')) {
            this.nameRegistry_.set(resource._name, resource as ResourceDef<unknown>);
        }
    }

    get<T>(resource: ResourceDef<T>): T {
        if (!this.resources_.has(resource._id)) {
            // Clone so each storage owns its default; mutating it never leaks
            // into the shared ResourceDef or a sibling world.
            this.resources_.set(resource._id, deepClone(resource._default));
            this.defaulted_.add(resource._id);
        }
        return this.resources_.get(resource._id) as T;
    }

    set<T>(resource: ResourceDef<T>, value: T): void {
        this.resources_.set(resource._id, value);
        this.defaulted_.delete(resource._id);
        this.ticks_.set(resource._id, ++this.globalTick_);
    }

    has<T>(resource: ResourceDef<T>): boolean {
        return this.resources_.has(resource._id) && !this.defaulted_.has(resource._id);
    }

    remove<T>(resource: ResourceDef<T>): void {
        this.resources_.delete(resource._id);
        this.defaulted_.delete(resource._id);
        this.resMutPool_.delete(resource._id);
        this.ticks_.delete(resource._id);
        this.nameRegistry_.delete(resource._name);
    }

    getChangeTick(resource: ResourceDef<unknown>): number {
        return this.ticks_.get(resource._id) ?? 0;
    }

    getByName(name: string): ResourceDef<unknown> | undefined {
        return this.nameRegistry_.get(name);
    }

    getRegisteredNames(): string[] {
        return Array.from(this.nameRegistry_.keys());
    }

    getResMut<T>(resource: ResourceDef<T>): ResMutInstance<T> {
        let instance = this.resMutPool_.get(resource._id) as ResMutInstance<T> | undefined;
        if (instance) {
            instance.updateValue(this.get(resource));
            return instance;
        }
        instance = new ResMutInstance(
            this.get(resource),
            (v) => this.set(resource, v)
        );
        this.resMutPool_.set(resource._id, instance as ResMutInstance<unknown>);
        return instance;
    }
}

// =============================================================================
// Builtin Resources
// =============================================================================

export interface TimeData {
    delta: number;
    elapsed: number;
    frameCount: number;
    /** Fixed-update timestep in seconds — the FixedUpdate / physics cadence. */
    fixedDelta: number;
    /**
     * Interpolation factor in [0, 1) into the current fixed step
     * (fixedAccumulator / fixedDelta), set after the fixed-update loop each
     * frame. Render-time systems lerp prev→current state by this to smooth
     * fixed-step simulation (e.g. physics) onto the variable render rate.
     */
    fixedAlpha: number;
    /**
     * Monotonic count of completed FixedUpdate steps — the simulation's own
     * time axis (frameCount counts render frames, which vary per machine).
     * Netcode stamps snapshots and input commands with this.
     */
    fixedTick: number;
    /**
     * Multiplier on `delta` and on the fixed-step accumulation; negatives clamp
     * to 0. At 0 the frame still runs — systems tick and a menu draws — while
     * everything advancing by `delta` (movement, navigation, behaviour trees,
     * the physics step) advances by nothing.
     */
    scale: number;
    /** Real frame time, unaffected by `scale`, for whatever must keep moving. */
    unscaledDelta: number;
}

export const Time = defineResource<TimeData>({
    delta: 0,
    elapsed: 0,
    frameCount: 0,
    fixedDelta: 1 / 60,
    fixedAlpha: 0,
    fixedTick: 0,
    scale: 1,
    unscaledDelta: 0,
}, 'Time');


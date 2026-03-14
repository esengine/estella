/**
 * @file    resource.ts
 * @brief   Resource system for global singleton data
 */

// =============================================================================
// Resource Definition
// =============================================================================

export interface ResourceDef<T> {
    readonly _id: symbol;
    readonly _name: string;
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

export interface ResDescriptor<T> {
    readonly _type: 'res';
    readonly _resource: ResourceDef<T>;
}

export interface ResMutDescriptor<T> {
    readonly _type: 'res_mut';
    readonly _resource: ResourceDef<T>;
}

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

    insert<T>(resource: ResourceDef<T>, value: T): void {
        this.resources_.set(resource._id, value);
        this.ticks_.set(resource._id, ++this.globalTick_);
        if (resource._name && !resource._name.startsWith('Resource_')) {
            this.nameRegistry_.set(resource._name, resource as ResourceDef<unknown>);
        }
    }

    get<T>(resource: ResourceDef<T>): T {
        if (!this.resources_.has(resource._id)) {
            this.resources_.set(resource._id, resource._default);
        }
        return this.resources_.get(resource._id) as T;
    }

    set<T>(resource: ResourceDef<T>, value: T): void {
        this.resources_.set(resource._id, value);
        this.ticks_.set(resource._id, ++this.globalTick_);
    }

    has<T>(resource: ResourceDef<T>): boolean {
        return this.resources_.has(resource._id);
    }

    remove<T>(resource: ResourceDef<T>): void {
        this.resources_.delete(resource._id);
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
}

export const Time = defineResource<TimeData>({
    delta: 0,
    elapsed: 0,
    frameCount: 0
}, 'Time');


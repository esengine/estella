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
}

// =============================================================================
// Resource Storage
// =============================================================================

export class ResourceStorage {
    private resources_ = new Map<symbol, unknown>();

    insert<T>(resource: ResourceDef<T>, value: T): void {
        this.resources_.set(resource._id, value);
    }

    get<T>(resource: ResourceDef<T>): T {
        if (!this.resources_.has(resource._id)) {
            this.resources_.set(resource._id, resource._default);
        }
        return this.resources_.get(resource._id) as T;
    }

    set<T>(resource: ResourceDef<T>, value: T): void {
        this.resources_.set(resource._id, value);
    }

    has<T>(resource: ResourceDef<T>): boolean {
        return this.resources_.has(resource._id);
    }

    remove<T>(resource: ResourceDef<T>): void {
        this.resources_.delete(resource._id);
    }

    getResMut<T>(resource: ResourceDef<T>): ResMutInstance<T> {
        return new ResMutInstance(
            this.get(resource),
            (v) => this.set(resource, v)
        );
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

export interface InputState {
    keysDown: Set<string>;
    keysPressed: Set<string>;
    keysReleased: Set<string>;
    mouseX: number;
    mouseY: number;
    mouseButtons: Set<number>;
}

export const Input = defineResource<InputState>({
    keysDown: new Set(),
    keysPressed: new Set(),
    keysReleased: new Set(),
    mouseX: 0,
    mouseY: 0,
    mouseButtons: new Set()
}, 'Input');

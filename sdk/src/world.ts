/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

import { Entity } from './types';
import { AnyComponentDef, ComponentDef, ComponentData, BuiltinComponentDef, isBuiltinComponent, getAllRegisteredComponents, getComponentRegistry, Name } from './component';
import type { CppRegistry, ESEngineModule } from './wasm';
import { validateComponentData, formatValidationErrors } from './validation';
import { handleWasmError } from './wasmError';

function convertFromWasm(
    obj: Record<string, unknown>,
    colorKeys: readonly string[],
): Record<string, unknown> {
    if (colorKeys.length === 0) return obj;
    const result: Record<string, unknown> = { ...obj };
    for (const key of colorKeys) {
        const val = result[key] as Record<string, unknown> | null | undefined;
        if (val && typeof val === 'object') {
            result[key] = { r: val.x, g: val.y, b: val.z, a: val.w };
        }
    }
    return result;
}

function convertForWasm(
    obj: Record<string, unknown>,
    colorKeys: readonly string[],
): Record<string, unknown> {
    if (colorKeys.length === 0) return obj;
    const result: Record<string, unknown> = { ...obj };
    for (const key of colorKeys) {
        const val = result[key] as Record<string, unknown> | null | undefined;
        if (val && typeof val === 'object') {
            result[key] = { x: val.r, y: val.g, z: val.b, w: val.a };
        }
    }
    return result;
}

// =============================================================================
// Pointer-based Field Layout Descriptors
// =============================================================================

type PtrFieldType = 'f32' | 'i32' | 'u32' | 'bool' | 'u8' | 'vec2' | 'vec3' | 'quat' | 'color';

interface PtrFieldDesc {
    readonly name: string;
    readonly type: PtrFieldType;
    readonly offset: number;
}

interface PtrLayout {
    readonly ptrFn: string;
    readonly fields: readonly PtrFieldDesc[];
}

const PTR_LAYOUTS: Record<string, PtrLayout> = {
    Transform: {
        ptrFn: 'getTransformPtr',
        fields: [
            { name: 'position',      type: 'vec3', offset: 0 },
            { name: 'rotation',      type: 'quat', offset: 12 },
            { name: 'scale',         type: 'vec3', offset: 28 },
            { name: 'worldPosition', type: 'vec3', offset: 40 },
            { name: 'worldRotation', type: 'quat', offset: 52 },
            { name: 'worldScale',    type: 'vec3', offset: 68 },
        ],
    },
    Sprite: {
        ptrFn: 'getSpritePtr',
        fields: [
            { name: 'texture',  type: 'u32',   offset: 0 },
            { name: 'color',    type: 'color', offset: 4 },
            { name: 'size',     type: 'vec2',  offset: 20 },
            { name: 'uvOffset', type: 'vec2',  offset: 28 },
            { name: 'uvScale',  type: 'vec2',  offset: 36 },
            { name: 'layer',    type: 'i32',   offset: 44 },
            { name: 'flipX',    type: 'bool',  offset: 48 },
            { name: 'flipY',    type: 'bool',  offset: 49 },
            { name: 'material', type: 'u32',   offset: 52 },
            { name: 'enabled',  type: 'bool',  offset: 56 },
        ],
    },
    Velocity: {
        ptrFn: 'getVelocityPtr',
        fields: [
            { name: 'linear',  type: 'vec3', offset: 0 },
            { name: 'angular', type: 'vec3', offset: 12 },
        ],
    },
    Camera: {
        ptrFn: 'getCameraPtr',
        fields: [
            { name: 'projectionType', type: 'u8',   offset: 0 },
            { name: 'fov',            type: 'f32',  offset: 4 },
            { name: 'orthoSize',      type: 'f32',  offset: 8 },
            { name: 'nearPlane',      type: 'f32',  offset: 12 },
            { name: 'farPlane',       type: 'f32',  offset: 16 },
            { name: 'aspectRatio',    type: 'f32',  offset: 20 },
            { name: 'isActive',       type: 'bool', offset: 24 },
            { name: 'priority',       type: 'i32',  offset: 28 },
            { name: 'viewportX',      type: 'f32',  offset: 32 },
            { name: 'viewportY',      type: 'f32',  offset: 36 },
            { name: 'viewportW',      type: 'f32',  offset: 40 },
            { name: 'viewportH',      type: 'f32',  offset: 44 },
            { name: 'clearFlags',     type: 'i32',  offset: 48 },
        ],
    },
    UIRect: {
        ptrFn: 'getUIRectPtr',
        fields: [
            { name: 'anchorMin', type: 'vec2', offset: 0 },
            { name: 'anchorMax', type: 'vec2', offset: 8 },
            { name: 'offsetMin', type: 'vec2', offset: 16 },
            { name: 'offsetMax', type: 'vec2', offset: 24 },
            { name: 'size',      type: 'vec2', offset: 32 },
            { name: 'pivot',     type: 'vec2', offset: 40 },
        ],
    },
    RigidBody: {
        ptrFn: 'getRigidBodyPtr',
        fields: [
            { name: 'bodyType',       type: 'u8',   offset: 0 },
            { name: 'gravityScale',   type: 'f32',  offset: 4 },
            { name: 'linearDamping',  type: 'f32',  offset: 8 },
            { name: 'angularDamping', type: 'f32',  offset: 12 },
            { name: 'fixedRotation',  type: 'bool', offset: 16 },
            { name: 'bullet',         type: 'bool', offset: 17 },
            { name: 'enabled',        type: 'bool', offset: 18 },
        ],
    },
    BoxCollider: {
        ptrFn: 'getBoxColliderPtr',
        fields: [
            { name: 'halfExtents',  type: 'vec2', offset: 0 },
            { name: 'offset',       type: 'vec2', offset: 8 },
            { name: 'density',      type: 'f32',  offset: 16 },
            { name: 'friction',     type: 'f32',  offset: 20 },
            { name: 'restitution',  type: 'f32',  offset: 24 },
            { name: 'isSensor',     type: 'bool', offset: 28 },
            { name: 'enabled',      type: 'bool', offset: 29 },
            { name: 'categoryBits', type: 'u32',  offset: 32 },
            { name: 'maskBits',     type: 'u32',  offset: 36 },
        ],
    },
    CircleCollider: {
        ptrFn: 'getCircleColliderPtr',
        fields: [
            { name: 'radius',       type: 'f32',  offset: 0 },
            { name: 'offset',       type: 'vec2', offset: 4 },
            { name: 'density',      type: 'f32',  offset: 12 },
            { name: 'friction',     type: 'f32',  offset: 16 },
            { name: 'restitution',  type: 'f32',  offset: 20 },
            { name: 'isSensor',     type: 'bool', offset: 24 },
            { name: 'enabled',      type: 'bool', offset: 25 },
            { name: 'categoryBits', type: 'u32',  offset: 28 },
            { name: 'maskBits',     type: 'u32',  offset: 32 },
        ],
    },
};

function readPtrField(
    f32: Float32Array, u32: Uint32Array, u8: Uint8Array,
    ptr: number, field: PtrFieldDesc,
): unknown {
    const byteOff = ptr + field.offset;
    const idx = byteOff >> 2;
    switch (field.type) {
        case 'f32':   return f32[idx];
        case 'i32':   return u32[idx] | 0;
        case 'u32':   return u32[idx];
        case 'bool':  return u8[byteOff] !== 0;
        case 'u8':    return u8[byteOff];
        case 'vec2':  return { x: f32[idx], y: f32[idx + 1] };
        case 'vec3':  return { x: f32[idx], y: f32[idx + 1], z: f32[idx + 2] };
        case 'quat':  return { x: f32[idx], y: f32[idx + 1], z: f32[idx + 2], w: f32[idx + 3] };
        case 'color': return { r: f32[idx], g: f32[idx + 1], b: f32[idx + 2], a: f32[idx + 3] };
    }
}

function fillPtrFields(
    f32: Float32Array, u32: Uint32Array, u8: Uint8Array,
    ptr: number, fields: readonly PtrFieldDesc[], target: Record<string, unknown>,
): void {
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const byteOff = ptr + field.offset;
        const idx = byteOff >> 2;
        switch (field.type) {
            case 'f32':   target[field.name] = f32[idx]; break;
            case 'i32':   target[field.name] = u32[idx] | 0; break;
            case 'u32':   target[field.name] = u32[idx]; break;
            case 'bool':  target[field.name] = u8[byteOff] !== 0; break;
            case 'u8':    target[field.name] = u8[byteOff]; break;
            case 'vec2': {
                const v = target[field.name] as any;
                v.x = f32[idx]; v.y = f32[idx + 1];
                break;
            }
            case 'vec3': {
                const v = target[field.name] as any;
                v.x = f32[idx]; v.y = f32[idx + 1]; v.z = f32[idx + 2];
                break;
            }
            case 'quat': {
                const v = target[field.name] as any;
                v.x = f32[idx]; v.y = f32[idx + 1]; v.z = f32[idx + 2]; v.w = f32[idx + 3];
                break;
            }
            case 'color': {
                const v = target[field.name] as any;
                v.r = f32[idx]; v.g = f32[idx + 1]; v.b = f32[idx + 2]; v.a = f32[idx + 3];
                break;
            }
        }
    }
}

function createPreallocatedResult(fields: readonly PtrFieldDesc[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const f of fields) {
        switch (f.type) {
            case 'vec2':  obj[f.name] = { x: 0, y: 0 }; break;
            case 'vec3':  obj[f.name] = { x: 0, y: 0, z: 0 }; break;
            case 'quat':  obj[f.name] = { x: 0, y: 0, z: 0, w: 0 }; break;
            case 'color': obj[f.name] = { r: 0, g: 0, b: 0, a: 0 }; break;
            default:      obj[f.name] = null; break;
        }
    }
    return obj;
}

function writePtrField(
    f32: Float32Array, u32: Uint32Array, u8: Uint8Array,
    ptr: number, field: PtrFieldDesc, value: any,
): void {
    const byteOff = ptr + field.offset;
    const idx = byteOff >> 2;
    switch (field.type) {
        case 'f32':   f32[idx] = value; break;
        case 'i32':   u32[idx] = value | 0; break;
        case 'u32':   u32[idx] = value; break;
        case 'bool':  u8[byteOff] = value ? 1 : 0; break;
        case 'u8':    u8[byteOff] = value; break;
        case 'vec2':  f32[idx] = value.x; f32[idx + 1] = value.y; break;
        case 'vec3':  f32[idx] = value.x; f32[idx + 1] = value.y; f32[idx + 2] = value.z; break;
        case 'quat':  f32[idx] = value.x; f32[idx + 1] = value.y; f32[idx + 2] = value.z; f32[idx + 3] = value.w; break;
        case 'color': f32[idx] = value.r; f32[idx + 1] = value.g; f32[idx + 2] = value.b; f32[idx + 3] = value.a; break;
    }
}

// =============================================================================
// Numeric Component IDs for Cache Keys
// =============================================================================

let nextCompNumId_ = 1;
const compNumIds_ = new WeakMap<object, number>();

function getCompNumId(comp: AnyComponentDef): number {
    let id = compNumIds_.get(comp);
    if (id === undefined) {
        id = nextCompNumId_++;
        compNumIds_.set(comp, id);
    }
    return id;
}

const _keyIds: number[] = [];

export function computeQueryCacheKey(
    components: AnyComponentDef[],
    withFilters: AnyComponentDef[] = [],
    withoutFilters: AnyComponentDef[] = [],
): string {
    _keyIds.length = 0;
    for (const c of components) _keyIds.push(getCompNumId(c));
    _keyIds.sort((a, b) => a - b);
    let key = _keyIds.join(',');
    if (withFilters.length > 0) {
        _keyIds.length = 0;
        for (const c of withFilters) _keyIds.push(getCompNumId(c));
        _keyIds.sort((a, b) => a - b);
        key += '|+' + _keyIds.join(',');
    }
    if (withoutFilters.length > 0) {
        _keyIds.length = 0;
        for (const c of withoutFilters) _keyIds.push(getCompNumId(c));
        _keyIds.sort((a, b) => a - b);
        key += '|-' + _keyIds.join(',');
    }
    return key;
}

// =============================================================================
// World
// =============================================================================

interface BuiltinMethods {
    add: (e: Entity, d: unknown) => void;
    get: (e: Entity) => unknown;
    has: (e: Entity) => boolean;
    remove: (e: Entity) => void;
}

export class World {
    private cppRegistry_: CppRegistry | null = null;
    private module_: ESEngineModule | null = null;
    private entities_ = new Map<Entity, number>();
    private tsStorage_ = new Map<symbol, Map<Entity, unknown>>();
    private entityComponents_ = new Map<Entity, Set<symbol>>();
    private builtinEntitySets_ = new Map<string, Set<Entity>>();
    private worldVersion_ = 0;
    private queryCache_ = new Map<string, { version: number; result: Entity[] }>();
    private builtinMethodCache_ = new Map<string, BuiltinMethods>();
    private iterationDepth_ = 0;
    private nextEntityId_ = 0;
    private nextGeneration_ = 0;
    private spawnCallbacks_: Array<(entity: Entity) => void> = [];
    private despawnCallbacks_: Array<(entity: Entity) => void> = [];

    private nameIndex_ = new Map<string, Entity>();

    private worldTick_ = 0;
    private componentAddedTicks_ = new Map<symbol, Map<Entity, number>>();
    private componentChangedTicks_ = new Map<symbol, Map<Entity, number>>();
    private componentRemovedBuffer_ = new Map<symbol, Array<{ entity: Entity; tick: number }>>();
    private trackedComponents_ = new Set<symbol>();

    connectCpp(cppRegistry: CppRegistry, module?: ESEngineModule): void {
        this.cppRegistry_ = cppRegistry;
        this.module_ = module ?? null;
        this.builtinMethodCache_.clear();
    }

    disconnectCpp(): void {
        this.cppRegistry_ = null;
        this.module_ = null;
        this.builtinMethodCache_.clear();
    }

    get hasCpp(): boolean {
        return this.cppRegistry_ !== null;
    }

    getCppRegistry(): CppRegistry | null {
        return this.cppRegistry_;
    }

    /** @internal */
    getWasmModule(): ESEngineModule | null {
        return this.module_;
    }

    // =========================================================================
    // Entity Management
    // =========================================================================

    spawn(name?: string): Entity {
        if (this.isIterating()) {
            throw new Error(
                'Cannot spawn entity during query iteration. ' +
                'Use Commands to defer entity creation until after iteration completes.'
            );
        }

        let entity: Entity;

        if (this.cppRegistry_) {
            try {
                entity = this.cppRegistry_.create();
            } catch (e) {
                handleWasmError(e, 'spawn');
                throw e;
            }
        } else {
            entity = (++this.nextEntityId_) as Entity;
        }

        let generation = 0;
        if (this.module_ && this.cppRegistry_) {
            try {
                generation = this.module_.registry_getGeneration(this.cppRegistry_, entity);
            } catch { /* fallback to 0 */ }
        } else {
            generation = ++this.nextGeneration_;
        }
        this.entities_.set(entity, generation);
        this.worldVersion_++;

        if (name !== undefined) {
            this.insert(entity, Name, { value: name });
        }

        for (const cb of this.spawnCallbacks_) {
            try { cb(entity); } catch (e) { console.warn('[World] Spawn callback error:', e); }
        }

        return entity;
    }

    despawn(entity: Entity): void {
        if (this.isIterating()) {
            throw new Error(
                'Cannot despawn entity during query iteration. ' +
                'Use Commands to defer entity destruction until after iteration completes.'
            );
        }

        for (const cb of this.despawnCallbacks_) {
            try { cb(entity); } catch (e) { console.warn('[World] Despawn callback error:', e); }
        }

        this.removeNameIndex_(entity);

        if (this.cppRegistry_) {
            try {
                this.cppRegistry_.destroy(entity);
            } catch (e) {
                handleWasmError(e, `despawn(entity=${entity})`);
            }
        }
        this.entities_.delete(entity);
        this.worldVersion_++;

        for (const [, set] of this.builtinEntitySets_) {
            set.delete(entity);
        }

        const ids = this.entityComponents_.get(entity);
        if (ids) {
            for (const id of ids) {
                this.tsStorage_.get(id)?.delete(entity);
                this.componentAddedTicks_.get(id)?.delete(entity);
                this.componentChangedTicks_.get(id)?.delete(entity);
                let buffer = this.componentRemovedBuffer_.get(id);
                if (!buffer) {
                    buffer = [];
                    this.componentRemovedBuffer_.set(id, buffer);
                }
                buffer.push({ entity, tick: this.worldTick_ });
            }
            this.entityComponents_.delete(entity);
        }
    }

    onSpawn(callback: (entity: Entity) => void): () => void {
        this.spawnCallbacks_.push(callback);
        return () => {
            const idx = this.spawnCallbacks_.indexOf(callback);
            if (idx !== -1) this.spawnCallbacks_.splice(idx, 1);
        };
    }

    onDespawn(callback: (entity: Entity) => void): () => void {
        this.despawnCallbacks_.push(callback);
        return () => {
            const idx = this.despawnCallbacks_.indexOf(callback);
            if (idx !== -1) this.despawnCallbacks_.splice(idx, 1);
        };
    }

    valid(entity: Entity): boolean {
        return this.entities_.has(entity);
    }

    entityCount(): number {
        return this.entities_.size;
    }

    getWorldVersion(): number {
        return this.worldVersion_;
    }

    beginIteration(): void {
        this.iterationDepth_++;
    }

    endIteration(): void {
        this.iterationDepth_--;
        if (this.iterationDepth_ < 0) {
            console.warn('World.endIteration: mismatched begin/end calls');
            this.iterationDepth_ = 0;
        }
    }

    resetIterationDepth(): void {
        this.iterationDepth_ = 0;
    }

    isIterating(): boolean {
        return this.iterationDepth_ > 0;
    }

    getAllEntities(): Entity[] {
        return Array.from(this.entities_.keys());
    }

    setParent(child: Entity, parent: Entity): void {
        if (this.cppRegistry_) {
            try {
                this.cppRegistry_.setParent(child, parent);
            } catch (e) {
                handleWasmError(e, `setParent(child=${child}, parent=${parent})`);
            }
        }
    }

    removeParent(entity: Entity): void {
        if (this.cppRegistry_) {
            try {
                this.cppRegistry_.removeParent(entity);
            } catch (e) {
                handleWasmError(e, `removeParent(entity=${entity})`);
            }
        }
    }

    // =========================================================================
    // Component Management
    // =========================================================================

    insert<C extends AnyComponentDef>(entity: Entity, component: C, data?: Partial<ComponentData<C>>): ComponentData<C> {
        if (isBuiltinComponent(component)) {
            return this.insertBuiltin(entity, component, data) as ComponentData<C>;
        }
        return this.insertScript(entity, component as ComponentDef<any>, data) as ComponentData<C>;
    }

    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void {
        if (isBuiltinComponent(component)) {
            if (this.cppRegistry_) {
                try {
                    const defaults = component._default as Record<string, unknown>;
                    const raw = data as Record<string, unknown>;
                    let wasmData = raw;
                    for (const k of Object.keys(raw)) {
                        if (!(k in defaults)) {
                            if (wasmData === raw) wasmData = { ...raw };
                            delete wasmData[k];
                        }
                    }
                    this.getBuiltinMethods(component._cppName).add(
                        entity,
                        convertForWasm(wasmData, component._colorKeys)
                    );
                } catch (e) {
                    handleWasmError(e, `set(${component._name}, entity=${entity})`);
                }
            }
            this.recordChangedTick_(component, entity);
            return;
        }
        this.getStorage(component as ComponentDef<any>).set(entity, data);
        this.recordChangedTick_(component, entity);
        if ((component as ComponentDef<any>)._id === Name._id) {
            this.updateNameIndex_(entity, (data as { value: string }).value);
        }
    }

    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C> {
        if (isBuiltinComponent(component)) {
            return this.getBuiltin(entity, component) as ComponentData<C>;
        }
        return this.getScript(entity, component as ComponentDef<any>) as ComponentData<C>;
    }

    has(entity: Entity, component: AnyComponentDef): boolean {
        if (component._builtin) {
            if (!this.cppRegistry_) return false;
            const cppName = (component as BuiltinComponentDef<any>)._cppName;
            const bset = this.builtinEntitySets_.get(cppName);
            if (bset) return bset.has(entity);
            return this.getBuiltinMethods(cppName).has(entity);
        }
        return this.hasScript(entity, component as ComponentDef<any>);
    }

    tryGet<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C> | null {
        if (isBuiltinComponent(component)) {
            if (!this.cppRegistry_) return null;
            const bset = this.builtinEntitySets_.get(component._cppName);
            if (bset && !bset.has(entity)) return null;
            try {
                const methods = this.getBuiltinMethods(component._cppName);
                if (!bset && !methods.has(entity)) return null;
                return convertFromWasm(
                    methods.get(entity) as Record<string, unknown>,
                    component._colorKeys,
                ) as ComponentData<C>;
            } catch (e) {
                handleWasmError(e, `tryGet(${component._name}, entity=${entity})`);
                return null;
            }
        }
        const storage = this.tsStorage_.get(component._id as symbol);
        if (!storage) return null;
        const val = storage.get(entity);
        return val !== undefined ? val as ComponentData<C> : null;
    }

    remove(entity: Entity, component: AnyComponentDef): void {
        if (this.isIterating()) {
            throw new Error(
                'Cannot remove component during query iteration. ' +
                'Use Commands to defer component removal until after iteration completes.'
            );
        }

        if (isBuiltinComponent(component)) {
            this.removeBuiltin(entity, component);
        } else {
            this.removeScript(entity, component as ComponentDef<any>);
        }
    }

    // =========================================================================
    // Builtin Component Operations (C++ Registry)
    // =========================================================================

    private getBuiltinMethods(cppName: string): BuiltinMethods {
        let methods = this.builtinMethodCache_.get(cppName);
        if (methods) return methods;

        const reg = this.cppRegistry_!;
        const addFn = reg[`add${cppName}`];
        const getFn = reg[`get${cppName}`];
        const hasFn = reg[`has${cppName}`];
        const removeFn = reg[`remove${cppName}`];

        if (typeof addFn !== 'function' || typeof getFn !== 'function' ||
            typeof hasFn !== 'function' || typeof removeFn !== 'function') {
            throw new Error(
                `C++ Registry missing methods for component "${cppName}". ` +
                `Expected: add${cppName}, get${cppName}, has${cppName}, remove${cppName}`
            );
        }

        methods = {
            add: addFn.bind(reg),
            get: getFn.bind(reg),
            has: hasFn.bind(reg),
            remove: removeFn.bind(reg),
        };
        this.builtinMethodCache_.set(cppName, methods);
        return methods;
    }

    private insertBuiltin<T>(entity: Entity, component: BuiltinComponentDef<T>, data?: Partial<T>): T {
        const defaults = component._default as Record<string, unknown>;
        const filtered: Record<string, unknown> = {};
        if (data !== null && data !== undefined && typeof data === 'object') {
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
                if (v === undefined) continue;
                if (!(k in defaults)) continue;
                filtered[k] = v;
            }

            const errors = validateComponentData(
                component._name,
                defaults,
                filtered
            );
            if (errors.length > 0) {
                throw new Error(formatValidationErrors(component._name, errors));
            }
        }
        const merged = { ...component._default, ...filtered } as T;

        let isNew = true;
        if (this.cppRegistry_) {
            try {
                const methods = this.getBuiltinMethods(component._cppName);
                isNew = !methods.has(entity);
                methods.add(entity, convertForWasm(merged as Record<string, unknown>, component._colorKeys));
            } catch (e) {
                handleWasmError(e, `insertBuiltin(${component._name}, entity=${entity})`);
            }
        }

        let set = this.builtinEntitySets_.get(component._cppName);
        if (!set) {
            set = new Set();
            this.builtinEntitySets_.set(component._cppName, set);
        }
        const tracked = set.has(entity);
        if (isNew || !tracked) {
            if (!tracked) set.add(entity);
            this.worldVersion_++;
            this.recordAddedTick_(component, entity);
        }
        this.recordChangedTick_(component, entity);
        return merged;
    }

    private getBuiltin<T>(entity: Entity, component: BuiltinComponentDef<T>): T {
        if (!this.cppRegistry_) {
            throw new Error('C++ Registry not connected');
        }
        try {
            const raw = this.getBuiltinMethods(component._cppName).get(entity);
            return convertFromWasm(
                raw as Record<string, unknown>,
                component._colorKeys,
            ) as T;
        } catch (e) {
            handleWasmError(e, `getBuiltin(${component._name}, entity=${entity})`);
            return { ...component._default } as T;
        }
    }

    private hasBuiltin(entity: Entity, component: BuiltinComponentDef<any>): boolean {
        if (!this.cppRegistry_) {
            return false;
        }
        try {
            return this.getBuiltinMethods(component._cppName).has(entity);
        } catch (e) {
            handleWasmError(e, `hasBuiltin(${component._name}, entity=${entity})`);
            return false;
        }
    }

    private removeBuiltin(entity: Entity, component: BuiltinComponentDef<any>): void {
        if (!this.cppRegistry_) {
            return;
        }
        try {
            this.getBuiltinMethods(component._cppName).remove(entity);
        } catch (e) {
            handleWasmError(e, `removeBuiltin(${component._name}, entity=${entity})`);
        }
        this.recordRemovedTick_(component, entity);
        this.worldVersion_++;
        this.builtinEntitySets_.get(component._cppName)?.delete(entity);
    }

    // =========================================================================
    // Script Component Operations (TypeScript storage)
    // =========================================================================

    private insertScript<T>(entity: Entity, component: ComponentDef<T>, data?: unknown): T {
        let filtered: Partial<T> | undefined;
        if (data !== null && data !== undefined && typeof data === 'object') {
            const clean: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
                if (v !== undefined) {
                    clean[k] = v;
                }
            }
            const errors = validateComponentData(
                component._name,
                component._default as Record<string, unknown>,
                clean
            );
            if (errors.length > 0) {
                throw new Error(formatValidationErrors(component._name, errors));
            }
            filtered = clean as Partial<T>;
        }

        const value = component.create(filtered);
        const storage = this.getStorage(component);
        const isNew = !storage.has(entity);
        storage.set(entity, value);
        let ids = this.entityComponents_.get(entity);
        if (!ids) {
            ids = new Set();
            this.entityComponents_.set(entity, ids);
        }
        ids.add(component._id);
        if (isNew) {
            this.worldVersion_++;
            this.recordAddedTick_(component, entity);
        }
        this.recordChangedTick_(component, entity);
        if (component._id === Name._id) {
            this.updateNameIndex_(entity, (value as { value: string }).value);
        }
        return value;
    }

    private getScript<T>(entity: Entity, component: ComponentDef<T>): T {
        const storage = this.tsStorage_.get(component._id);
        if (!storage) {
            throw new Error(`Component not found: ${component._name}`);
        }
        return storage.get(entity) as T;
    }

    private hasScript<T>(entity: Entity, component: ComponentDef<T>): boolean {
        const storage = this.tsStorage_.get(component._id);
        return storage?.has(entity) ?? false;
    }

    private removeScript<T>(entity: Entity, component: ComponentDef<T>): void {
        if (component._id === Name._id) {
            this.removeNameIndex_(entity);
        }
        const storage = this.tsStorage_.get(component._id);
        storage?.delete(entity);
        this.recordRemovedTick_(component, entity);
        this.worldVersion_++;
        const ids = this.entityComponents_.get(entity);
        if (ids) {
            ids.delete(component._id);
        }
    }

    // =========================================================================
    // Name Index
    // =========================================================================

    private updateNameIndex_(entity: Entity, name: string): void {
        for (const [n, e] of this.nameIndex_) {
            if (e === entity) {
                this.nameIndex_.delete(n);
                break;
            }
        }
        if (name) {
            this.nameIndex_.set(name, entity);
        }
    }

    private removeNameIndex_(entity: Entity): void {
        for (const [n, e] of this.nameIndex_) {
            if (e === entity) {
                this.nameIndex_.delete(n);
                break;
            }
        }
    }

    findEntityByName(name: string): Entity | null {
        return this.nameIndex_.get(name) ?? null;
    }

    private getStorage(component: ComponentDef<any>): Map<Entity, unknown> {
        let storage = this.tsStorage_.get(component._id);
        if (!storage) {
            storage = new Map();
            this.tsStorage_.set(component._id, storage);
        }
        return storage;
    }

    /** @internal Pre-resolve a component to its direct storage/getter for fast iteration. */
    resolveGetter(component: AnyComponentDef): ((entity: Entity) => unknown) | null {
        if (isBuiltinComponent(component)) {
            if (!this.cppRegistry_) return null;

            if (this.module_) {
                const ptrGetter = this.resolvePtrGetter_(component._cppName);
                if (ptrGetter) return ptrGetter;
            }

            const methods = this.getBuiltinMethods(component._cppName);
            const colorKeys = component._colorKeys;
            if (colorKeys.length === 0) {
                return (e) => methods.get(e);
            }
            return (e) => convertFromWasm(methods.get(e) as Record<string, unknown>, colorKeys);
        }
        const storage = this.tsStorage_.get(component._id);
        if (!storage) return null;
        return (e) => storage.get(e);
    }

    /** @internal Pre-resolve a component to a direct has-check for fast query matching. */
    resolveHas(component: AnyComponentDef): ((entity: Entity) => boolean) | null {
        if (isBuiltinComponent(component)) {
            if (!this.cppRegistry_) return null;
            const methods = this.getBuiltinMethods(component._cppName);
            return (e) => methods.has(e);
        }
        const storage = this.tsStorage_.get(component._id);
        if (!storage) return null;
        return (e) => storage.has(e);
    }

    /** @internal Pre-resolve a component to a direct setter for fast Mut write-back. */
    resolveSetter(component: AnyComponentDef): ((entity: Entity, data: unknown) => void) | null {
        if (isBuiltinComponent(component)) {
            if (!this.cppRegistry_) return null;

            if (this.module_) {
                const ptrSetter = this.resolvePtrSetter_(component._cppName);
                if (ptrSetter) return ptrSetter;
            }

            const methods = this.getBuiltinMethods(component._cppName);
            const colorKeys = component._colorKeys;
            if (colorKeys.length === 0) {
                return (e, d) => methods.add(e, d);
            }
            return (e, d) => methods.add(e, convertForWasm(d as Record<string, unknown>, colorKeys));
        }
        const storage = this.tsStorage_.get(component._id);
        if (!storage) return null;
        return (e, d) => storage.set(e, d);
    }

    private resolvePtrFn_(cppName: string): ((entity: Entity) => number) | null {
        const layout = PTR_LAYOUTS[cppName];
        if (!layout) return null;
        const fn = (this.module_ as any)[layout.ptrFn] as ((r: any, e: number) => number) | undefined;
        if (!fn) return null;
        const reg = this.cppRegistry_!;
        return (e: Entity) => fn(reg, e);
    }

    private resolvePtrSetter_(cppName: string): ((entity: Entity, data: unknown) => void) | null {
        const layout = PTR_LAYOUTS[cppName];
        if (!layout) return null;
        const getPtrFn = this.resolvePtrFn_(cppName);
        if (!getPtrFn) return null;
        const mod = this.module_!;
        const fields = layout.fields;
        return (e: Entity, data: unknown) => {
            const ptr = getPtrFn(e);
            if (!ptr) return;
            const d = data as any;
            for (let i = 0; i < fields.length; i++) {
                writePtrField(mod.HEAPF32, mod.HEAPU32, mod.HEAPU8, ptr, fields[i], d[fields[i].name]);
            }
        };
    }

    private resolvePtrGetter_(cppName: string): ((entity: Entity) => unknown) | null {
        const layout = PTR_LAYOUTS[cppName];
        if (!layout) return null;
        const getPtrFn = this.resolvePtrFn_(cppName);
        if (!getPtrFn) return null;
        const mod = this.module_!;
        const fields = layout.fields;
        const cached = createPreallocatedResult(fields);
        return (e: Entity) => {
            const ptr = getPtrFn(e);
            if (!ptr) return null;
            fillPtrFields(mod.HEAPF32, mod.HEAPU32, mod.HEAPU8, ptr, fields, cached);
            return cached;
        };
    }

    // =========================================================================
    // Query Support
    // =========================================================================

    resetQueryPool(): void {
        // No-op: query pool removed, results stored directly in cache
    }

    getComponentTypes(entity: Entity): string[] {
        const types = new Set<string>();
        for (const [name, methods] of this.builtinMethodCache_) {
            try { if (methods.has(entity)) types.add(name); } catch (e) { console.warn(`[World] Component check failed for ${name}:`, e); }
        }
        if (this.cppRegistry_) {
            for (const [name, comp] of getAllRegisteredComponents()) {
                if (isBuiltinComponent(comp) && !types.has(name)) {
                    try {
                        const m = this.getBuiltinMethods(comp._cppName);
                        if (m.has(entity)) types.add(name);
                    } catch (e) { console.warn(`[World] Builtin check failed for ${name}:`, e); }
                }
            }
        }
        const ids = this.entityComponents_.get(entity);
        if (ids) {
            const registry = getComponentRegistry();
            for (const id of ids) {
                for (const [name, def] of registry) {
                    if (def._id === id) {
                        types.add(name);
                        break;
                    }
                }
            }
        }
        return Array.from(types);
    }

    private resolveStorages_(
        comps: AnyComponentDef[],
        scriptOut: Map<Entity, unknown>[],
        builtinOut: BuiltinMethods[],
    ): boolean {
        for (const comp of comps) {
            if (isBuiltinComponent(comp)) {
                if (!this.cppRegistry_) return false;
                builtinOut.push(this.getBuiltinMethods(comp._cppName));
            } else {
                const storage = this.tsStorage_.get(comp._id);
                if (!storage) return false;
                scriptOut.push(storage);
            }
        }
        return true;
    }

    getEntitiesWithComponents(
        components: AnyComponentDef[],
        withFilters: AnyComponentDef[] = [],
        withoutFilters: AnyComponentDef[] = [],
        precomputedKey?: string
    ): Entity[] {
        if (components.length === 0 && withFilters.length === 0 && withoutFilters.length === 0) {
            return this.getAllEntities();
        }

        const cacheKey = precomputedKey ?? computeQueryCacheKey(components, withFilters, withoutFilters);
        const cached = this.queryCache_.get(cacheKey);
        if (cached && cached.version === this.worldVersion_) {
            return cached.result;
        }

        const entities: Entity[] = [];

        const reqScript: Map<Entity, unknown>[] = [];
        const reqBuiltin: BuiltinMethods[] = [];
        if (!this.resolveStorages_(components, reqScript, reqBuiltin)) {
            this.queryCache_.set(cacheKey, { version: this.worldVersion_, result: [] });
            return entities;
        }

        let withScript: Map<Entity, unknown>[] | null = null;
        let withBuiltin: BuiltinMethods[] | null = null;
        if (withFilters.length > 0) {
            withScript = [];
            withBuiltin = [];
            if (!this.resolveStorages_(withFilters, withScript, withBuiltin)) {
                this.queryCache_.set(cacheKey, { version: this.worldVersion_, result: [] });
                return entities;
            }
        }

        let woScript: Map<Entity, unknown>[] | null = null;
        let woBuiltin: BuiltinMethods[] | null = null;
        if (withoutFilters.length > 0) {
            woScript = [];
            woBuiltin = [];
            this.resolveStorages_(withoutFilters, woScript, woBuiltin);
        }

        let smallestSet: { keys(): IterableIterator<Entity>; size: number } | null = null;
        let smallestSize = Infinity;
        for (let i = 0; i < reqScript.length; i++) {
            const size = reqScript[i].size;
            if (size < smallestSize) {
                smallestSize = size;
                smallestSet = reqScript[i];
            }
        }
        for (const comp of components) {
            if (isBuiltinComponent(comp)) {
                const bset = this.builtinEntitySets_.get(comp._cppName);
                if (bset && bset.size < smallestSize) {
                    smallestSize = bset.size;
                    smallestSet = bset;
                }
            }
        }

        const candidates = smallestSet ? smallestSet.keys() : this.entities_.keys();
        const rsLen = reqScript.length;
        const rbLen = reqBuiltin.length;

        for (const entity of candidates) {
            let match = true;
            for (let i = 0; i < rsLen; i++) {
                if (!reqScript[i].has(entity)) { match = false; break; }
            }
            if (match) {
                for (let i = 0; i < rbLen; i++) {
                    if (!reqBuiltin[i].has(entity)) { match = false; break; }
                }
            }
            if (match && withScript) {
                for (let i = 0; i < withScript.length; i++) {
                    if (!withScript[i].has(entity)) { match = false; break; }
                }
                if (match) {
                    for (let i = 0; i < withBuiltin!.length; i++) {
                        if (!withBuiltin![i].has(entity)) { match = false; break; }
                    }
                }
            }
            if (match && woScript) {
                for (let i = 0; i < woScript.length; i++) {
                    if (woScript[i].has(entity)) { match = false; break; }
                }
                if (match) {
                    for (let i = 0; i < woBuiltin!.length; i++) {
                        if (woBuiltin![i].has(entity)) { match = false; break; }
                    }
                }
            }
            if (match) {
                entities.push(entity);
            }
        }

        this.queryCache_.set(cacheKey, { version: this.worldVersion_, result: entities });

        return entities;
    }

    // =========================================================================
    // Change Detection
    // =========================================================================

    advanceTick(): void {
        this.worldTick_++;
    }

    getWorldTick(): number {
        return this.worldTick_;
    }

    enableChangeTracking(component: AnyComponentDef): void {
        this.trackedComponents_.add(component._id);
    }

    isAddedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        const map = this.componentAddedTicks_.get(component._id);
        if (!map) return false;
        const tick = map.get(entity);
        return tick !== undefined && tick > sinceTick;
    }

    isChangedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        const map = this.componentChangedTicks_.get(component._id);
        if (!map) return false;
        const tick = map.get(entity);
        return tick !== undefined && tick > sinceTick;
    }

    getRemovedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        const buffer = this.componentRemovedBuffer_.get(component._id);
        if (!buffer) return [];
        const result: Entity[] = [];
        for (const entry of buffer) {
            if (entry.tick > sinceTick) {
                result.push(entry.entity);
            }
        }
        return result;
    }

    cleanRemovedBuffer(beforeTick: number): void {
        for (const [id, buffer] of this.componentRemovedBuffer_) {
            let writeIdx = 0;
            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i].tick >= beforeTick) {
                    buffer[writeIdx++] = buffer[i];
                }
            }
            buffer.length = writeIdx;
            if (writeIdx === 0) {
                this.componentRemovedBuffer_.delete(id);
            }
        }
    }

    private recordAddedTick_(component: AnyComponentDef, entity: Entity): void {
        if (!this.trackedComponents_.has(component._id)) return;
        let map = this.componentAddedTicks_.get(component._id);
        if (!map) {
            map = new Map();
            this.componentAddedTicks_.set(component._id, map);
        }
        map.set(entity, this.worldTick_);
    }

    /** @internal Mark component as changed without writing data (for in-place Mut query) */
    markChanged(entity: Entity, component: AnyComponentDef): void {
        this.recordChangedTick_(component, entity);
    }

    private recordChangedTick_(component: AnyComponentDef, entity: Entity): void {
        if (!this.trackedComponents_.has(component._id)) return;
        let map = this.componentChangedTicks_.get(component._id);
        if (!map) {
            map = new Map();
            this.componentChangedTicks_.set(component._id, map);
        }
        map.set(entity, this.worldTick_);
    }

    private recordRemovedTick_(component: AnyComponentDef, entity: Entity): void {
        if (!this.trackedComponents_.has(component._id)) return;
        let buffer = this.componentRemovedBuffer_.get(component._id);
        if (!buffer) {
            buffer = [];
            this.componentRemovedBuffer_.set(component._id, buffer);
        }
        buffer.push({ entity, tick: this.worldTick_ });
        this.componentAddedTicks_.get(component._id)?.delete(entity);
        this.componentChangedTicks_.get(component._id)?.delete(entity);
    }
}

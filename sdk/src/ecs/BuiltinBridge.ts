/**
 * @file    BuiltinBridge.ts
 * @brief   C++ Registry integration layer for builtin components
 */

import { Entity } from '../types';
import type { BuiltinComponentDef } from '../component';
import type { CppRegistry, ESEngineModule } from '../wasm';
import { validateComponentData, formatValidationErrors } from '../validation';
import { handleWasmError } from '../wasmError';
import { PTR_LAYOUTS } from '../ptrLayouts.generated';

// =============================================================================
// Color conversion helpers
// =============================================================================

export function convertFromWasm(
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

export function convertForWasm(
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
// Pointer-based Field Access
// =============================================================================

type PtrFieldType = 'f32' | 'i32' | 'u32' | 'bool' | 'u8' | 'vec2' | 'vec3' | 'vec4' | 'quat' | 'color';

interface PtrFieldDesc {
    readonly name: string;
    readonly type: PtrFieldType;
    readonly offset: number;
}

export function readPtrField(
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
        case 'vec4':
        case 'quat':  return { x: f32[idx], y: f32[idx + 1], z: f32[idx + 2], w: f32[idx + 3] };
        case 'color': return { r: f32[idx], g: f32[idx + 1], b: f32[idx + 2], a: f32[idx + 3] };
    }
}

export function fillPtrFields(
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
            case 'vec4':
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

export function createPreallocatedResult(fields: readonly PtrFieldDesc[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const f of fields) {
        switch (f.type) {
            case 'vec2':  obj[f.name] = { x: 0, y: 0 }; break;
            case 'vec3':  obj[f.name] = { x: 0, y: 0, z: 0 }; break;
            case 'vec4':
            case 'quat':  obj[f.name] = { x: 0, y: 0, z: 0, w: 0 }; break;
            case 'color': obj[f.name] = { r: 0, g: 0, b: 0, a: 0 }; break;
            default:      obj[f.name] = null; break;
        }
    }
    return obj;
}

export function writePtrField(
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
        case 'vec4':
        case 'quat':  f32[idx] = value.x; f32[idx + 1] = value.y; f32[idx + 2] = value.z; f32[idx + 3] = value.w; break;
        case 'color': f32[idx] = value.r; f32[idx + 1] = value.g; f32[idx + 2] = value.b; f32[idx + 3] = value.a; break;
    }
}

// =============================================================================
// BuiltinMethods
// =============================================================================

export interface BuiltinMethods {
    add: (e: Entity, d: unknown) => void;
    get: (e: Entity) => unknown;
    has: (e: Entity) => boolean;
    remove: (e: Entity) => void;
}

// =============================================================================
// BuiltinBridge
// =============================================================================

export class BuiltinBridge {
    private cppRegistry_: CppRegistry | null = null;
    private module_: ESEngineModule | null = null;
    private builtinMethodCache_ = new Map<string, BuiltinMethods>();
    private builtinEntitySets_ = new Map<string, Set<Entity>>();

    connect(cppRegistry: CppRegistry, module?: ESEngineModule): void {
        this.cppRegistry_ = cppRegistry;
        this.module_ = module ?? null;
        this.builtinMethodCache_.clear();
    }

    disconnect(): void {
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

    getWasmModule(): ESEngineModule | null {
        return this.module_;
    }

    getBuiltinMethods(cppName: string): BuiltinMethods {
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

    getMethodCache(): Map<string, BuiltinMethods> {
        return this.builtinMethodCache_;
    }

    getEntitySet(cppName: string): Set<Entity> | undefined {
        return this.builtinEntitySets_.get(cppName);
    }

    getOrCreateEntitySet(cppName: string): Set<Entity> {
        let set = this.builtinEntitySets_.get(cppName);
        if (!set) {
            set = new Set();
            this.builtinEntitySets_.set(cppName, set);
        }
        return set;
    }

    deleteFromEntitySets(entity: Entity): void {
        for (const [, set] of this.builtinEntitySets_) {
            set.delete(entity);
        }
    }

    insert<T>(entity: Entity, component: BuiltinComponentDef<T>, data?: Partial<T>): { merged: T; isNew: boolean } {
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
                methods.add(entity, convertForWasm(merged as Record<string, unknown>, component.colorKeys));
            } catch (e) {
                handleWasmError(e, `insertBuiltin(${component._name}, entity=${entity})`);
            }
        }

        const set = this.getOrCreateEntitySet(component._cppName);
        const tracked = set.has(entity);
        if (isNew || !tracked) {
            if (!tracked) set.add(entity);
        }

        return { merged, isNew: isNew || !tracked };
    }

    get<T>(entity: Entity, component: BuiltinComponentDef<T>): T {
        if (!this.cppRegistry_) {
            throw new Error('C++ Registry not connected');
        }
        try {
            const raw = this.getBuiltinMethods(component._cppName).get(entity);
            return convertFromWasm(
                raw as Record<string, unknown>,
                component.colorKeys,
            ) as T;
        } catch (e) {
            handleWasmError(e, `getBuiltin(${component._name}, entity=${entity})`);
            return { ...component._default } as T;
        }
    }

    has(entity: Entity, component: BuiltinComponentDef<any>): boolean {
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

    remove(entity: Entity, component: BuiltinComponentDef<any>): void {
        if (!this.cppRegistry_) {
            return;
        }
        try {
            this.getBuiltinMethods(component._cppName).remove(entity);
        } catch (e) {
            handleWasmError(e, `removeBuiltin(${component._name}, entity=${entity})`);
        }
        this.builtinEntitySets_.get(component._cppName)?.delete(entity);
    }

    resolvePtrFn(cppName: string): ((entity: Entity) => number) | null {
        const layout = PTR_LAYOUTS[cppName];
        if (!layout) return null;
        const fn = (this.module_ as any)[layout.ptrFn] as ((r: any, e: number) => number) | undefined;
        if (!fn) return null;
        const reg = this.cppRegistry_!;
        return (e: Entity) => fn(reg, e);
    }

    resolvePtrSetter(cppName: string): ((entity: Entity, data: unknown) => void) | null {
        const layout = PTR_LAYOUTS[cppName];
        if (!layout) return null;
        const getPtrFn = this.resolvePtrFn(cppName);
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

    resolvePtrGetter(cppName: string): ((entity: Entity) => unknown) | null {
        const layout = PTR_LAYOUTS[cppName];
        if (!layout) return null;
        const getPtrFn = this.resolvePtrFn(cppName);
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
}

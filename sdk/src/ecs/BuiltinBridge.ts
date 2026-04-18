/**
 * @file    BuiltinBridge.ts
 * @brief   C++ Registry integration layer for builtin components
 */

import { Entity } from '../types';
import type { BuiltinComponentDef } from '../component';
import type { CppRegistry, ESEngineModule } from '../wasm';
import { validateComponentData, formatValidationErrors } from '../validation';
import { handleWasmError } from '../wasmError';
import { COMPONENT_META } from '../component.generated';
import { PTR_LAYOUTS } from '../ptrLayouts.generated';
import { PTR_ACCESSORS } from './ptrAccessors.generated';

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

interface XY { x: number; y: number }
interface XYZ { x: number; y: number; z: number }
interface XYZW { x: number; y: number; z: number; w: number }
interface RGBA { r: number; g: number; b: number; a: number }

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
                const v = target[field.name] as XY;
                v.x = f32[idx]; v.y = f32[idx + 1];
                break;
            }
            case 'vec3': {
                const v = target[field.name] as XYZ;
                v.x = f32[idx]; v.y = f32[idx + 1]; v.z = f32[idx + 2];
                break;
            }
            case 'vec4':
            case 'quat': {
                const v = target[field.name] as XYZW;
                v.x = f32[idx]; v.y = f32[idx + 1]; v.z = f32[idx + 2]; v.w = f32[idx + 3];
                break;
            }
            case 'color': {
                const v = target[field.name] as RGBA;
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

export type PtrFieldValue = number | boolean | XY | XYZ | XYZW | RGBA;

export function writePtrField(
    f32: Float32Array, u32: Uint32Array, u8: Uint8Array,
    ptr: number, field: PtrFieldDesc, value: PtrFieldValue | unknown,
): void {
    const byteOff = ptr + field.offset;
    const idx = byteOff >> 2;
    switch (field.type) {
        case 'f32':   f32[idx] = value as number; break;
        case 'i32':   u32[idx] = (value as number) | 0; break;
        case 'u32':   u32[idx] = value as number; break;
        case 'bool':  u8[byteOff] = value ? 1 : 0; break;
        case 'u8':    u8[byteOff] = value as number; break;
        case 'vec2': { const v = value as XY; f32[idx] = v.x; f32[idx + 1] = v.y; break; }
        case 'vec3': { const v = value as XYZ; f32[idx] = v.x; f32[idx + 1] = v.y; f32[idx + 2] = v.z; break; }
        case 'vec4':
        case 'quat': { const v = value as XYZW; f32[idx] = v.x; f32[idx + 1] = v.y; f32[idx + 2] = v.z; f32[idx + 3] = v.w; break; }
        case 'color': { const v = value as RGBA; f32[idx] = v.r; f32[idx + 1] = v.g; f32[idx + 2] = v.b; f32[idx + 3] = v.a; break; }
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

/** Result of verifying a connected C++ Registry against the generated metadata. */
export interface BridgeVerification {
    /** True when every component in COMPONENT_META has all four methods. */
    readonly ok: boolean;
    /** List of components with missing bindings (empty when ok). */
    readonly missing: readonly { readonly name: string; readonly methods: readonly string[] }[];
    /**
     * Components reported by the WASM module's reflection table
     * (`getBuiltinComponentNames`) that are not present in the shipped
     * COMPONENT_META — the WASM was built from a newer schema than the SDK
     * bundle. Only populated when the module exposes the reflection call.
     */
    readonly wasmOnly: readonly string[];
    /**
     * Components declared in COMPONENT_META that the WASM module's reflection
     * table does not list — the SDK was built from a newer schema than the
     * WASM. Only populated when the module exposes the reflection call.
     */
    readonly sdkOnly: readonly string[];
}

/** Options for {@link BuiltinBridge.connect}. */
export interface BridgeConnectOptions {
    /**
     * When true (recommended for production), verify every component in
     * COMPONENT_META against the registry at connect time and throw a single
     * aggregated diagnostic if any bindings are missing. When false (default,
     * legacy-compatible), pre-populate the method cache for whatever bindings
     * exist and let per-component lookups throw on demand — this keeps
     * partial mock registries used in unit tests working unchanged.
     */
    readonly strict?: boolean;
}

const METHOD_PREFIXES = ['add', 'get', 'has', 'remove'] as const;

function formatBridgeDiagnostic(v: BridgeVerification): string {
    const parts: string[] = [];
    if (v.missing.length > 0) {
        const detail = v.missing.map(m => `  - ${m.name}: missing ${m.methods.join(', ')}`).join('\n');
        parts.push(`C++ Registry is missing ${String(v.missing.length)} builtin component binding(s):\n${detail}`);
    }
    if (v.wasmOnly.length > 0) {
        parts.push(`WASM exposes components not in the SDK's COMPONENT_META:\n  ${v.wasmOnly.join(', ')}`);
    }
    if (v.sdkOnly.length > 0) {
        parts.push(`SDK's COMPONENT_META lists components the WASM does not export:\n  ${v.sdkOnly.join(', ')}`);
    }
    parts.push(
        'Likely cause: WebBindings.generated.cpp is out of sync with component.generated.ts. ' +
        'Rerun the EHT generator and rebuild the WASM target.',
    );
    return parts.join('\n\n');
}

// =============================================================================
// BuiltinBridge
// =============================================================================

export class BuiltinBridge {
    private cppRegistry_: CppRegistry | null = null;
    private module_: ESEngineModule | null = null;
    private builtinMethodCache_ = new Map<string, BuiltinMethods>();
    private builtinEntitySets_ = new Map<string, Set<Entity>>();

    /**
     * Bind to a C++ Registry.
     *
     * Production call sites should pass `{ strict: true }` so the bridge
     * verifies that every component declared in COMPONENT_META has its four
     * bindings (add/get/has/remove) and throws a single aggregated diagnostic
     * if any are missing. This surfaces drift between the WASM build and the
     * generated metadata at startup rather than on first component use.
     *
     * In non-strict mode (default, used by unit tests with partial mock
     * registries) the cache is pre-populated for whatever bindings exist and
     * individual `getBuiltinMethods()` calls throw lazily on missing ones.
     */
    connect(
        cppRegistry: CppRegistry,
        module?: ESEngineModule,
        options: BridgeConnectOptions = {},
    ): void {
        this.cppRegistry_ = cppRegistry;
        this.module_ = module ?? null;
        this.builtinMethodCache_.clear();
        this.builtinEntitySets_.clear();

        const verification = this.verifyAgainst_(cppRegistry, module);
        if (options.strict && !verification.ok) {
            this.cppRegistry_ = null;
            this.module_ = null;
            this.builtinMethodCache_.clear();
            throw new Error(formatBridgeDiagnostic(verification));
        }
    }

    disconnect(): void {
        this.cppRegistry_ = null;
        this.module_ = null;
        this.builtinMethodCache_.clear();
        this.builtinEntitySets_.clear();
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

    /**
     * Describe the current binding state without throwing. Useful for
     * diagnostics and tests that want to inspect coverage.
     */
    verify(): BridgeVerification {
        if (!this.cppRegistry_) {
            return {
                ok: false,
                missing: [{ name: '<registry>', methods: ['connect() not called'] }],
                wasmOnly: [],
                sdkOnly: [],
            };
        }
        return this.verifyAgainst_(this.cppRegistry_, this.module_ ?? undefined);
    }

    private verifyAgainst_(reg: CppRegistry, module?: ESEngineModule): BridgeVerification {
        const missing: { name: string; methods: string[] }[] = [];
        for (const cppName of Object.keys(COMPONENT_META)) {
            const missingMethods: string[] = [];
            for (const prefix of METHOD_PREFIXES) {
                const fn = reg[`${prefix}${cppName}`];
                if (typeof fn !== 'function') missingMethods.push(`${prefix}${cppName}`);
            }
            if (missingMethods.length > 0) {
                missing.push({ name: cppName, methods: missingMethods });
                continue;
            }
            this.resolveAndCache_(reg, cppName);
        }

        // Cross-check against the WASM module's self-reported component list
        // (added in the EHT generator as `getBuiltinComponentNames`). Older
        // WASM builds may not expose it — those skip this check.
        let wasmOnly: string[] = [];
        let sdkOnly: string[] = [];
        const listFn = (module as unknown as { getBuiltinComponentNames?: () => string[] } | undefined)
            ?.getBuiltinComponentNames;
        if (typeof listFn === 'function') {
            let wasmList: string[];
            try {
                wasmList = listFn();
            } catch {
                wasmList = [];
            }
            const sdkSet = new Set(Object.keys(COMPONENT_META));
            const wasmSet = new Set(wasmList);
            wasmOnly = wasmList.filter(n => !sdkSet.has(n));
            sdkOnly = Object.keys(COMPONENT_META).filter(n => !wasmSet.has(n));
        }

        const ok = missing.length === 0 && wasmOnly.length === 0 && sdkOnly.length === 0;
        return { ok, missing, wasmOnly, sdkOnly };
    }

    getBuiltinMethods(cppName: string): BuiltinMethods {
        const cached = this.builtinMethodCache_.get(cppName);
        if (cached) return cached;
        if (!this.cppRegistry_) {
            throw new Error(`BuiltinBridge.getBuiltinMethods("${cppName}") called before connect().`);
        }
        // Fallback for components not declared in COMPONENT_META — user-defined
        // builtins and test-only synthetic components. Production components are
        // resolved eagerly in verifyAgainst_ and never hit this path.
        return this.resolveAndCache_(this.cppRegistry_, cppName);
    }

    private resolveAndCache_(reg: CppRegistry, cppName: string): BuiltinMethods {
        const addFn = reg[`add${cppName}`];
        const getFn = reg[`get${cppName}`];
        const hasFn = reg[`has${cppName}`];
        const removeFn = reg[`remove${cppName}`];
        if (typeof addFn !== 'function' || typeof getFn !== 'function' ||
            typeof hasFn !== 'function' || typeof removeFn !== 'function') {
            throw new Error(
                `C++ Registry missing methods for component "${cppName}". ` +
                `Expected: add${cppName}, get${cppName}, has${cppName}, remove${cppName}`,
            );
        }
        const methods: BuiltinMethods = {
            add: (addFn as (e: Entity, d: unknown) => void).bind(reg),
            get: (getFn as (e: Entity) => unknown).bind(reg),
            has: (hasFn as (e: Entity) => boolean).bind(reg),
            remove: (removeFn as (e: Entity) => void).bind(reg),
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
        const mod = this.module_ as Record<string, unknown> | null;
        if (!mod) return null;
        const fn = mod[layout.ptrFn] as ((r: CppRegistry, e: number) => number) | undefined;
        if (!fn) return null;
        const reg = this.cppRegistry_!;
        return (e: Entity) => fn(reg, e);
    }

    resolvePtrSetter(cppName: string): ((entity: Entity, data: unknown) => void) | null {
        const accessor = PTR_ACCESSORS[cppName];
        if (!accessor) return null;
        const getPtrFn = this.resolvePtrFn(cppName);
        if (!getPtrFn) return null;
        const mod = this.module_!;
        return (e: Entity, data: unknown) => {
            const ptr = getPtrFn(e);
            if (!ptr) return;
            accessor.write(mod.HEAPF32, mod.HEAPU32, mod.HEAPU8, ptr, data);
        };
    }

    /**
     * Returns a getter that reads C++ component data into a shared preallocated object.
     * WARNING: The returned object is reused across calls — copy it if you need to retain the values.
     */
    resolvePtrGetter(cppName: string): ((entity: Entity) => unknown) | null {
        const accessor = PTR_ACCESSORS[cppName];
        if (!accessor) return null;
        const getPtrFn = this.resolvePtrFn(cppName);
        if (!getPtrFn) return null;
        const mod = this.module_!;
        const cached = accessor.create();
        return (e: Entity) => {
            const ptr = getPtrFn(e);
            if (!ptr) return null;
            accessor.fill(mod.HEAPF32, mod.HEAPU32, mod.HEAPU8, ptr, cached);
            return cached;
        };
    }
}

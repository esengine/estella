// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Backend-neutral fast-path component memory.
//
// The generated ptrAccessors (ptrAccessors.generated.ts) read and write a
// component's fields against three typed-array views + a base byte offset. Where
// those views come from is the one thing that differs between backends, so it is
// the only thing abstracted here — the accessor logic itself is shared verbatim:
//
//   * web  (WasmMemoryProvider):   the whole wasm HEAP as F32/U32/U8 views, and a
//     per-entity byte offset from the wasm-exported ptr function.
//   * native (NativeMemoryProvider): a zero-copy ArrayBuffer over one native ECS
//     component (the host's generated `es_<Component>_buffer(entity)` binding),
//     viewed as F32/U32/U8, with offset 0.
//
// The native host exposes a buffer only when its compiler proves all accessed
// offsets agree with wasm32 and the component is trivially copyable. Otherwise
// resolution returns null and BuiltinBridge uses generated member bindings.

import type { Entity } from '../../types';
import type { CppRegistry, ESEngineModule } from '../../wasm';
import { PTR_ACCESSORS, type ScalarWrite } from './ptrAccessors.generated';
import { PTR_LAYOUTS } from '../../wasm/ptrLayouts.generated';

/**
 * Heap views + base byte offset for one component instance. The resolver reuses a
 * single instance across calls (it only ever writes the four fields), so callers
 * must consume it immediately and never retain it.
 */
export interface ComponentHeap {
    f32: Float32Array;
    u32: Uint32Array;
    u8: Uint8Array;
    ptr: number;
}

/** Fills `out` with the heap views + base ptr for `entity`'s component; returns
 *  false when the entity has no live component (skip the read/write). */
export type ComponentHeapResolver = (entity: Entity, out: ComponentHeap) => boolean;
export type ComponentSource = (entity: Entity) => ComponentHeap | null;
/** A native registry getter can expose its non-creating, layout-checked read. */
export const nativeComponentSource = Symbol('native component source');
export interface NativeComponentGetter {
    (entity: Entity): unknown;
    [nativeComponentSource]?: ComponentSource;
}

/** Synchronously submit a complete reflected row to the core. */
export type ComponentWriter = (entity: Entity, data: Record<string, unknown>) => boolean;

/**
 * Where the fast path gets a component's memory. One implementation per engine
 * backend; the BuiltinBridge holds one and both `resolvePtrSetter` and
 * `resolvePtrGetter` go through it.
 */
export interface MemoryProvider {
    /**
     * Resolve a per-entity heap-view filler for `cppName`, or null if this backend
     * has no fast-path binding for the component (the bridge then falls back to the
     * method-based path).
     */
    resolveComponentHeap(cppName: string): ComponentHeapResolver | null;
    /** Submit a complete numeric SDK row; false delegates to the registry object binding. */
    resolveComponentWriter?(cppName: string): ComponentWriter | null;
}

// A fresh reusable ComponentHeap for one resolver. Its views are overwritten on
// every successful resolve, so the empty initial arrays are never observed.
export function createComponentHeap(): ComponentHeap {
    return { f32: EMPTY_F32, u32: EMPTY_U32, u8: EMPTY_U8, ptr: 0 };
}
const EMPTY_F32 = new Float32Array(0);
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_U8 = new Uint8Array(0);

/** Resolve fresh views for each access. The record is borrowed until the next call. */
export function resolveHeapSource(memory: MemoryProvider | null, cppName: string): ComponentSource | null {
    const resolve = memory?.resolveComponentHeap(cppName);
    if (!resolve) return null;
    const heap = createComponentHeap();
    return (entity) => resolve(entity, heap) ? heap : null;
}
/** One generated field store for mutable query rows and native component replacement. */
export function resolveHeapWriter(memory: MemoryProvider | null, cppName: string) {
    const accessor = PTR_ACCESSORS[cppName];
    const resolve = accessor && memory?.resolveComponentHeap(cppName);
    if (!resolve) return null;
    const heap = createComponentHeap();
    return (entity: Entity, data: unknown) => {
        if (!resolve(entity, heap)) return false;
        accessor.write(heap.f32, heap.u32, heap.u8, heap.ptr, data);
        return true;
    };
}

/**
 * Resolve the wasm-exported pointer function for `cppName` — `(entity) => byte
 * offset of that entity's component in the wasm heap`, or null if the module lacks
 * the export or the component has no layout. Shared by WasmMemoryProvider and the
 * bridge's (web-only) resolvePtrFn.
 */
export function resolveWasmPtrFn(
    module: ESEngineModule | null,
    cppRegistry: CppRegistry | null,
    cppName: string,
): ((entity: Entity) => number) | null {
    const ptrFn = PTR_LAYOUTS[cppName]?.ptrFn;
    if (!ptrFn || !module || !cppRegistry) return null;
    const mod = module as unknown as Record<string, unknown>;
    const fn = mod[ptrFn] as ((r: CppRegistry, e: number) => number) | undefined;
    if (!fn) return null;
    return (e: Entity) => fn(cppRegistry, e);
}

/**
 * Web/emscripten backend: the whole wasm HEAP, indexed by a per-entity byte
 * offset. Behaviourally identical to the pre-abstraction inline path — same
 * ptr function, same `mod.HEAP*` views, same "skip when ptr is 0".
 */
export class WasmMemoryProvider implements MemoryProvider {
    constructor(
        private readonly module: ESEngineModule,
        private readonly cppRegistry: CppRegistry,
    ) {}

    resolveComponentWriter(cppName: string): ComponentWriter | null {
        const store = PTR_ACCESSORS[cppName]?.storeFields;
        const fn = (this.module as unknown as Record<string, unknown>)[`store${cppName}Fields`];
        if (!store || typeof fn !== 'function') return null;
        const write = fn.bind(this.module, this.cppRegistry) as ScalarWrite;
        return (entity: Entity, data: Record<string, unknown>) => store(write, entity, data);
    }

    resolveComponentHeap(cppName: string): ComponentHeapResolver | null {
        const getPtrFn = resolveWasmPtrFn(this.module, this.cppRegistry, cppName);
        if (!getPtrFn) return null;
        const mod = this.module;
        return (entity: Entity, out: ComponentHeap): boolean => {
            const ptr = getPtrFn(entity);
            if (!ptr) return false;
            // HEAP* views are re-read each call: emscripten swaps them out on heap
            // growth, so a cached reference can go stale.
            out.f32 = mod.HEAPF32;
            out.u32 = mod.HEAPU32;
            out.u8 = mod.HEAPU8;
            out.ptr = ptr;
            return true;
        };
    }
}

/** A host-injected zero-copy accessor: `entity -> ArrayBuffer` over the native
 *  ECS component, or a nullish value when the entity has no live component. */
export type NativeComponentBufferFn = (entity: number) => ArrayBuffer | null | undefined;

/**
 * Native (embedded-Dawn) backend: each component is reached through the host's
 * generated `es_<Component>_buffer(entity)` binding, which hands back a zero-copy
 * ArrayBuffer over that entity's native component. The accessors then write it at
 * offset 0. `scope` is where those globals live (the QuickJS global object on a
 * device; a plain object in tests).
 *
 * The buffer is re-fetched on every access on purpose: a SparseSet growth moves
 * the dense array, invalidating any previously handed-out ArrayBuffer.
 */
export class NativeMemoryProvider implements MemoryProvider {
    constructor(
        private readonly scope: Record<string, unknown> =
            globalThis as unknown as Record<string, unknown>,
    ) {}

    resolveComponentWriter(cppName: string): ComponentWriter | null {
        return PTR_ACCESSORS[cppName]?.acceptsFields ? resolveHeapWriter(this, cppName) : null;
    }

    resolveComponentHeap(cppName: string): ComponentHeapResolver | null {
        const bufFn = this.scope[`es_${cppName}_buffer`] as NativeComponentBufferFn | undefined;
        if (typeof bufFn !== 'function') return null;
        return (entity: Entity, out: ComponentHeap): boolean => {
            const buf = bufFn(entity);
            if (!buf) return false;
            const words = Math.floor(buf.byteLength / 4);
            out.f32 = new Float32Array(buf, 0, words);
            out.u32 = new Uint32Array(buf, 0, words);
            out.u8 = new Uint8Array(buf);
            out.ptr = 0;
            return true;
        };
    }
}

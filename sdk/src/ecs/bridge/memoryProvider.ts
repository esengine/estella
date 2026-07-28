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
// Same generated accessors, same POD layout (wasm32/arm64 layout-identical, per
// the EHT ABI hash), two memory backends — this is the seam that lets the real
// SDK component API run unchanged on both.

import type { Entity } from '../../types';
import type { CppRegistry, ESEngineModule } from '../../wasm';
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
    const layout = PTR_LAYOUTS[cppName];
    if (!layout || !module || !cppRegistry) return null;
    const mod = module as unknown as Record<string, unknown>;
    const fn = mod[layout.ptrFn] as ((r: CppRegistry, e: number) => number) | undefined;
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

    resolveComponentHeap(cppName: string): ComponentHeapResolver | null {
        const bufFn = this.scope[`es_${cppName}_buffer`] as NativeComponentBufferFn | undefined;
        if (typeof bufFn !== 'function') return null;
        return (entity: Entity, out: ComponentHeap): boolean => {
            const buf = bufFn(entity);
            if (!buf) return false;
            out.f32 = new Float32Array(buf);
            out.u32 = new Uint32Array(buf);
            out.u8 = new Uint8Array(buf);
            out.ptr = 0;
            return true;
        };
    }
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ecs/nativeHeap.ts
 * @brief   The heap a native core marshals bulk data through.
 *
 * Half the engine's surface passes bulk data as an offset plus a count: tile
 * arrays, polygon vertices, body transforms, spine meshes. On the web that offset
 * addresses wasm's linear memory, which the SDK writes through `module.HEAPF32`
 * and hands over as a number. A native core had no such memory, so every one of
 * those calls was web-only — which is why physics, tilemaps and spine could not
 * run on a device even though their C++ compiles natively.
 *
 * The host now reserves one arena and exposes it as a single `ArrayBuffer`
 * (`native/host/heap.hpp`). This builds the same views over it that an emscripten
 * module exposes, so a subsystem's module interface — `HEAPF32` + `_malloc` +
 * a `…Ptr` argument — is satisfied by the same SDK code on both platforms.
 *
 * One difference, in the native build's favour: the arena never moves, so these
 * views stay valid for the process lifetime instead of being invalidated by heap
 * growth.
 */

/** The heap members a subsystem module interface asks for. */
export interface NativeHeap {
    HEAPU8: Uint8Array;
    HEAPU16: Uint16Array;
    HEAPU32: Uint32Array;
    HEAPI32: Int32Array;
    HEAPF32: Float32Array;
    HEAPF64: Float64Array;
    _malloc(bytes: number): number;
    _free(offset: number): void;
}

/** The host globals that carry it. */
export const HEAP_BINDINGS = {
    heap: 'es_heap',
    malloc: 'es_malloc',
    free: 'es_free',
} as const;

/** Whether this host bound the heap at all. A core that marshals nothing may not. */
export function hasHeapBindings(scope: Record<string, unknown>): boolean {
    return typeof scope[HEAP_BINDINGS.heap] === 'function'
        && typeof scope[HEAP_BINDINGS.malloc] === 'function'
        && typeof scope[HEAP_BINDINGS.free] === 'function';
}

/**
 * Build the heap views over a host scope (the QuickJS global object; a plain
 * object in tests). Null when the host bound no heap, which every caller treats
 * the way it treats a core that left a subsystem out.
 */
export function createNativeHeap(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): NativeHeap | null {
    if (!hasHeapBindings(scope)) return null;
    const buffer = (scope[HEAP_BINDINGS.heap] as () => ArrayBuffer | null)();
    if (!buffer) return null;
    const malloc = scope[HEAP_BINDINGS.malloc] as (bytes: number) => number;
    const free = scope[HEAP_BINDINGS.free] as (offset: number) => void;
    return {
        HEAPU8: new Uint8Array(buffer),
        HEAPU16: new Uint16Array(buffer),
        HEAPU32: new Uint32Array(buffer),
        HEAPI32: new Int32Array(buffer),
        HEAPF32: new Float32Array(buffer),
        HEAPF64: new Float64Array(buffer),
        _malloc: (bytes: number) => malloc(bytes),
        _free: (offset: number) => free(offset),
    };
}

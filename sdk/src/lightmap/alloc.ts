// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    alloc.ts
 * @brief   Where a bake's large arrays live: ordinary memory on one thread, memory
 *          every worker can see when the solve is split across several.
 */

export interface BakeAlloc {
    f32(length: number): Float32Array;
    i32(length: number): Int32Array;
    u8(length: number): Uint8Array;
}

export const plainAlloc: BakeAlloc = {
    f32: (n) => new Float32Array(n),
    i32: (n) => new Int32Array(n),
    u8: (n) => new Uint8Array(n),
};

/** A copy of `src` in memory `alloc` hands out. */
export function adopt<T extends Float32Array | Int32Array | Uint8Array>(src: T, alloc: BakeAlloc): T {
    const out = (src instanceof Float32Array ? alloc.f32(src.length)
        : src instanceof Int32Array ? alloc.i32(src.length) : alloc.u8(src.length)) as T;
    out.set(src as never);
    return out;
}

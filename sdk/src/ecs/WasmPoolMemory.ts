// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WasmPoolMemory.ts
 * @brief   Component rows on the engine's wasm heap, where compiled code is.
 *
 * @details A compiled system runs inside the engine's module and reads memory by
 *          offset. Rows on the JS heap are as unreachable to it as the objects
 *          they replaced, so on web they come from `_malloc` instead — one
 *          linear memory, one set of offsets, and `ScriptPool.address` is
 *          already the address the compiled code wants.
 *
 *          The trap is growth: `_malloc` may grow the heap, and growing DETACHES
 *          every ArrayBuffer view of it. The bytes survive at the same offsets —
 *          it is the same linear memory — but a held `Float64Array` stops
 *          working, silently returning undefined rather than throwing. So a
 *          block is identified by its OFFSET and the buffer is fetched fresh,
 *          which is the same thing emscripten does for its own HEAP views.
 */

import type { PoolBlock, PoolMemory } from './ScriptPool';

/** What this needs of the engine module: an allocator and its heap. */
export interface WasmHeap {
    _malloc(size: number): number;
    _free(ptr: number): void;
    /** The live view. Emscripten replaces this object when the heap grows. */
    readonly HEAPU8: Uint8Array;
}

/**
 * Rows on the engine's heap. `byteOffset` is a wasm address, which is what makes
 * a pool's `span()` directly usable by compiled code.
 */
export class WasmPoolMemory implements PoolMemory {
    constructor(private readonly heap: WasmHeap) {}

    alloc(bytes: number): PoolBlock {
        // Eight-aligned because a row's fields are f64 and an unaligned typed
        // array view is a range error rather than a slow read.
        const size = (bytes + 7) & ~7;
        const at = this.heap._malloc(size);
        if (at === 0) throw new Error(`ScriptPool: the wasm heap refused ${size} bytes`);
        return { buffer: this.heap.HEAPU8.buffer, byteOffset: at, byteLength: size };
    }

    release(block: PoolBlock): void {
        this.heap._free(block.byteOffset);
    }

    /**
     * The block's buffer as it is NOW. After a growth the one handed out at
     * `alloc` is detached and this is a different object holding the same bytes
     * at the same offset.
     */
    current(block: PoolBlock): ArrayBufferLike {
        void block;
        return this.heap.HEAPU8.buffer;
    }
}

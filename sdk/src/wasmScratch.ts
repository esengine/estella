// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wasmScratch.ts
 * @brief   Exception-safe transient allocation on the WASM heap.
 *
 * @details The boundary repeatedly does `ptr = _malloc(n); …write/​call…; _free(ptr)`.
 *          When the intervening work throws (a validation error, a module
 *          abort, an out-of-bounds write), the `_free` is skipped and the WASM
 *          heap leaks permanently. {@link withScratch} makes that structurally
 *          impossible: every allocation taken from its `alloc` callback is freed
 *          when the callback returns OR throws.
 *
 *          The callback MUST be synchronous — do not `await` between alloc and
 *          the implicit free, or the buffer is freed while still in use.
 */

/** Minimal slice of an emscripten module: just the heap allocator. */
export interface WasmAllocator {
    _malloc(size: number): number;
    _free(ptr: number): void;
}

/**
 * Run `fn` with a scratch allocator; free everything it allocated on exit,
 * whether `fn` returns normally or throws. Frees in reverse allocation order.
 *
 * @example
 * const offset = withScratch(module, alloc => {
 *     const ptr = alloc(pixels.length);
 *     module.HEAPU8.set(pixels, ptr);
 *     return module.uploadTexture(ptr, pixels.length); // may throw — ptr still freed
 * });
 */
export function withScratch<R>(
    mod: WasmAllocator,
    fn: (alloc: (size: number) => number) => R,
): R {
    const ptrs: number[] = [];
    const alloc = (size: number): number => {
        const p = mod._malloc(size);
        if (p) ptrs.push(p);
        return p;
    };
    try {
        return fn(alloc);
    } finally {
        for (let i = ptrs.length - 1; i >= 0; i--) {
            mod._free(ptrs[i]!);
        }
    }
}

/**
 * Convenience for the single-buffer case: allocate `size` bytes, run `fn` with
 * the pointer, and free it on exit (normal or throw).
 */
export function withMalloc<R>(
    mod: WasmAllocator,
    size: number,
    fn: (ptr: number) => R,
): R {
    return withScratch(mod, alloc => fn(alloc(size)));
}

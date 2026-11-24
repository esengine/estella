// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { LodDecision } from './renderer';

/** Read the decision from the core that owns the output buffer. */
export function readLodDecision(
    core: { readonly HEAPF32?: Float32Array }, ptr: number, inspect: (out: number) => unknown,
): LodDecision | null {
    const heap = core.HEAPF32;
    if (!ptr || !heap) return null;
    const i = ptr >>> 2;
    // Older cores write only the first four fields.
    heap[i + 4] = -1;
    heap[i + 5] = 1;
    if (!inspect(ptr)) return null;
    const f = core.HEAPF32!; // The call may have grown wasm memory.
    return {
        level: f[i]! < 0 ? null : f[i]!,
        unbiased: f[i + 1]! < 0 ? null : f[i + 1]!,
        levels: f[i + 2]!,
        screenSize: f[i + 3]!,
        fadingFrom: f[i + 4]! < 0 ? null : f[i + 4]!,
        fade: f[i + 5]!,
    };
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** Cells per side of a rendered terrain patch and its finest collision tile. */
export const TERRAIN_PATCH_CELLS = 32;

/** Cut each cell along the (1, 0) to (0, 1) diagonal, with the chosen winding. */
export function buildPatchIndices(cells: number, flipped: boolean): Uint32Array {
    const side = cells + 1;
    const indices = new Uint32Array(cells * cells * 6);
    let at = 0;
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
        const a = j * side + i, b = a + 1, c = a + side, d = c + 1;
        indices.set(flipped ? [a, b, c, b, d, c] : [a, c, b, b, c, d], at);
        at += 6;
    }
    return indices;
}

let upIndices: Uint32Array | undefined;
let reversedIndices: Uint32Array | undefined;

/** Copy the fixed topology so every published tile owns its writable index buffer. */
export function copyCollisionPatchIndices(flipped = false): Uint32Array {
    const indices = flipped
        ? (reversedIndices ??= buildPatchIndices(TERRAIN_PATCH_CELLS, true))
        : (upIndices ??= buildPatchIndices(TERRAIN_PATCH_CELLS, false));
    return indices.slice();
}

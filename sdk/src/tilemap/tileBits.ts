// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tileBits.ts
 * @brief   The per-cell tile encoding (13-bit id + 3 flip bits) and the D4
 *          orientation algebra shared by the painter and the C++ renderer.
 *
 * A stored cell is a `u16`: the low 13 bits are the 1-based tile id (0 = empty), the top
 * three are flip flags. The flags mirror Tiled's convention so `.tmj` imports and
 * editor-authored tiles render through one path. The C++ renderer
 * (`TilemapRenderPlugin`) interprets the same flags by the same {@link orientationPerm}
 * corner permutation — keep the base perms below byte-identical with the C++ side.
 */

/** Mirrors C++ `tilemap::TILE_ID_MASK` — 13 bits, max id 8191. */
export const TILE_ID_MASK = 0x1fff;
export const TILE_FLIP_H = 0x2000;
export const TILE_FLIP_V = 0x4000;
export const TILE_FLIP_D = 0x8000;
export const TILE_FLAGS_MASK = TILE_FLIP_H | TILE_FLIP_V | TILE_FLIP_D;

/** The three orientation bits a cell can carry (Tiled H/V/anti-diagonal). */
export interface TileFlags {
    flipH: boolean;
    flipV: boolean;
    flipD: boolean;
}

export const NO_FLAGS: TileFlags = { flipH: false, flipV: false, flipD: false };

/** The 1-based tile id of a raw cell (flip bits stripped); 0 = empty. */
export function tileIdOf(raw: number): number {
    return raw & TILE_ID_MASK;
}

export function tileFlagsOf(raw: number): TileFlags {
    return {
        flipH: (raw & TILE_FLIP_H) !== 0,
        flipV: (raw & TILE_FLIP_V) !== 0,
        flipD: (raw & TILE_FLIP_D) !== 0,
    };
}

/** Pack a tile id + flags into a raw cell value. `id` is masked to 13 bits. */
export function encodeTile(id: number, flags: TileFlags = NO_FLAGS): number {
    let raw = id & TILE_ID_MASK;
    if (flags.flipH) raw |= TILE_FLIP_H;
    if (flags.flipV) raw |= TILE_FLIP_V;
    if (flags.flipD) raw |= TILE_FLIP_D;
    return raw;
}

/**
 * The four quad corners, indexed in the renderer's vertex order: 0=BL, 1=BR, 2=TR, 3=TL
 * (screen space, y-up). A "corner permutation" `p` means screen corner `i` samples the
 * atlas corner `p[i]`; identity `[0,1,2,3]` is the unflipped tile.
 */
type Perm = readonly [number, number, number, number];

const IDENT: Perm = [0, 1, 2, 3];
const P_H: Perm = [1, 0, 3, 2]; // mirror left/right  (BL↔BR, TL↔TR)
const P_V: Perm = [3, 2, 1, 0]; // mirror top/bottom  (BL↔TL, BR↔TR)
const P_D: Perm = [0, 3, 2, 1]; // anti-diagonal flip (TL↔BR), the Tiled "diagonal" bit
const P_ROT_CW: Perm = [1, 2, 3, 0]; // rotate the displayed tile 90° clockwise

/** Compose perms: `(compose(a,b))[i] = a[b[i]]` — apply `b` then `a`. */
function compose(a: Perm, b: Perm): Perm {
    return [a[b[0]], a[b[1]], a[b[2]], a[b[3]]];
}

/**
 * The atlas-corner permutation a cell's flags produce. Flags apply D first, then V, then H
 * — the order that makes (H,V,D) bijective onto the 8 D4 orientations and matches Tiled.
 */
export function orientationPerm(flags: TileFlags): Perm {
    let p: Perm = IDENT;
    if (flags.flipD) p = compose(P_D, p);
    if (flags.flipV) p = compose(P_V, p);
    if (flags.flipH) p = compose(P_H, p);
    return p;
}

// Reverse map: orientation perm → the flags that produce it (built from the 8 combos).
const PERM_TO_FLAGS = new Map<string, TileFlags>();
for (let bits = 0; bits < 8; bits++) {
    const flags: TileFlags = {
        flipH: (bits & 1) !== 0,
        flipV: (bits & 2) !== 0,
        flipD: (bits & 4) !== 0,
    };
    PERM_TO_FLAGS.set(orientationPerm(flags).join(','), flags);
}

function flagsForPerm(p: Perm): TileFlags {
    return PERM_TO_FLAGS.get(p.join(',')) ?? NO_FLAGS;
}

/** Apply a screen-space transform (pre-composed) to a cell's flags, returning new flags. */
function transformFlags(screen: Perm, flags: TileFlags): TileFlags {
    return flagsForPerm(compose(screen, orientationPerm(flags)));
}

export function flipFlagsH(flags: TileFlags): TileFlags {
    return transformFlags(P_H, flags);
}
export function flipFlagsV(flags: TileFlags): TileFlags {
    return transformFlags(P_V, flags);
}
export function rotateFlagsCW(flags: TileFlags): TileFlags {
    return transformFlags(P_ROT_CW, flags);
}

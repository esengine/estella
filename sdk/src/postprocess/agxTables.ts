// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    agxTables.ts
 * @brief   The two tables of Blender's AgX, unpacked into the textures the AgX shader reads.
 *
 * @details Blender's view transform is a 57^3 table over the log2-encoded E-Gamut cube; its contrast looks first pass the colour
 *          through a 37^3 luminance-compensation table. Both are packed small by tools/gen-agx-lut.py (predicted from their
 *          neighbours, deflated) and decoded here, once, when the effect is built.
 *
 *          A table is laid out as an atlas of its slices, a grid of `size x size` tiles with the blue index picking the tile
 *          (column = b % columns, row = b / columns), the red index running along a tile's row and the green down it. A flat
 *          strip of `size` slices would be 57 x 57 = 3249 texels wide, past the 2048 that OpenGL ES 3.0 promises, so a grid keeps
 *          every dimension under 512. The shader reads it by texel (`texelFetch`), so no filter applies.
 *
 *          The look table's values keep 12 bits, and a byte holds 8, so it is two textures: the high eight bits in one, the low
 *          four (in the top of a byte) in the other.
 */
import type { BuiltinTexture } from './effects';
import { inflateRaw } from './inflate';
import { AGX_BASE_BITS, AGX_BASE_DATA, AGX_BASE_SIZE, AGX_LOOK_BITS, AGX_LOOK_DATA, AGX_LOOK_SIZE } from './agxLut.generated';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 to bytes, by hand: not every runtime has `atob`. */
function bytesOf(text: string): Uint8Array {
    const out = new Uint8Array(Math.floor((text.length * 3) / 4));
    let bits = 0, held = 0, n = 0;
    for (let i = 0; i < text.length; i++) {
        const v = BASE64.indexOf(text[i]!);
        if (v < 0) continue;
        held = ((held << 6) | v) & 0xffffff;
        bits += 6;
        if (bits >= 8) { bits -= 8; out[n++] = (held >> bits) & 0xff; }
    }
    return out.subarray(0, n);
}

/** A table's values, `size^3 x 3` of them in file order (red fastest, then green, then blue), each `bits` wide. */
function unpack(data: string, size: number): Uint16Array {
    const cells = size * size * size;
    const planes = inflateRaw(bytesOf(data), cells * 3 * 2);
    const values = new Uint16Array(cells * 3);
    const at = (r: number, g: number, b: number): number => (b * size + g) * size + r;
    for (let c = 0; c < 3; c++) {
        const lo = planes.subarray(c * 2 * cells, c * 2 * cells + cells), hi = planes.subarray(c * 2 * cells + cells, (c + 1) * 2 * cells);
        // Undo the prediction in the order it was made: each value is its residual plus what the seven neighbours behind it say.
        const plane = new Int32Array(cells);
        for (let b = 0; b < size; b++) {
            for (let g = 0; g < size; g++) {
                for (let r = 0; r < size; r++) {
                    const i = at(r, g, b), zig = lo[i]! | (hi[i]! << 8);
                    const residual = (zig & 1) ? -((zig + 1) >> 1) : zig >> 1;
                    const a = r > 0 ? plane[at(r - 1, g, b)]! : 0, bb = g > 0 ? plane[at(r, g - 1, b)]! : 0, cc = b > 0 ? plane[at(r, g, b - 1)]! : 0;
                    const ab = r > 0 && g > 0 ? plane[at(r - 1, g - 1, b)]! : 0, ac = r > 0 && b > 0 ? plane[at(r - 1, g, b - 1)]! : 0;
                    const bc = g > 0 && b > 0 ? plane[at(r, g - 1, b - 1)]! : 0, abc = r > 0 && g > 0 && b > 0 ? plane[at(r - 1, g - 1, b - 1)]! : 0;
                    plane[i] = residual + a + bb + cc - ab - ac - bc + abc;
                }
            }
        }
        for (let i = 0; i < cells; i++) values[i * 3 + c] = plane[i]!;
    }
    return values;
}

/** The atlas geometry for `size` slices: tiles per row, and the texture's width and height. */
function atlas(size: number): { columns: number; width: number; height: number } {
    const columns = Math.ceil(Math.sqrt(size));
    return { columns, width: columns * size, height: Math.ceil(size / columns) * size };
}

/** Write one table into an atlas of RGBA texels, `pick` turning each stored value into the byte for one texture. */
function build(values: Uint16Array, size: number, pick: (value: number) => number): BuiltinTexture {
    const { columns, width, height } = atlas(size);
    const pixels = new Uint8Array(width * height * 4);
    for (let b = 0; b < size; b++) {
        const x0 = (b % columns) * size, y0 = Math.floor(b / columns) * size;
        for (let g = 0; g < size; g++) {
            for (let r = 0; r < size; r++) {
                const from = ((b * size + g) * size + r) * 3, to = ((y0 + g) * width + x0 + r) * 4;
                pixels[to] = pick(values[from]!); pixels[to + 1] = pick(values[from + 1]!); pixels[to + 2] = pick(values[from + 2]!); pixels[to + 3] = 255;
            }
        }
    }
    return { width, height, pixels };
}

let baseValues: Uint16Array | undefined, lookValues: Uint16Array | undefined;

/** The view transform's table: 8 bits a value, in an atlas of 57 tiles of 57 x 57. */
export function agxBaseTexture(): BuiltinTexture {
    baseValues ??= unpack(AGX_BASE_DATA, AGX_BASE_SIZE);
    return build(baseValues, AGX_BASE_SIZE, (v) => v);
}

/** The look's luminance compensation, as the top eight of its twelve bits... */
export function agxLookHighTexture(): BuiltinTexture {
    lookValues ??= unpack(AGX_LOOK_DATA, AGX_LOOK_SIZE);
    return build(lookValues, AGX_LOOK_SIZE, (v) => v >> (AGX_LOOK_BITS - 8));
}

/** ... and the rest: its low four bits, in the top of a byte. */
export function agxLookLowTexture(): BuiltinTexture {
    lookValues ??= unpack(AGX_LOOK_DATA, AGX_LOOK_SIZE);
    const low = AGX_LOOK_BITS - 8;
    return build(lookValues, AGX_LOOK_SIZE, (v) => (v & ((1 << low) - 1)) << (8 - low));
}

/** Where the shader finds a table's tile layout (it needs the same numbers): tiles per row for a table of `size`. */
export const agxAtlasColumns = (size: number): number => atlas(size).columns;
export { AGX_BASE_BITS, AGX_BASE_SIZE, AGX_LOOK_BITS, AGX_LOOK_SIZE };

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    platform/fontWeights.ts
 * @brief   The weights a font file can draw, read from its own tables.
 *
 * @details A variable font holds every weight from its lightest to its heaviest in one file (its `fvar` table has a `wght`
 *          axis). A browser draws such a face at the weight a Text asks only when the face was registered as covering that
 *          range; registered without one it is a face of weight 400, and a Text at 300 gets its default instance. A font of one
 *          weight is registered as it always was, so a bold asked of it is still made bold by the browser.
 */

const tag = (v: DataView, at: number): string =>
    String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

/** The `wght` axis of an `fvar` table at `at`, as [lightest, heaviest]; null with none. */
function weightAxis(v: DataView, at: number, length: number): [number, number] | null {
    if (at + 16 > v.byteLength) return null;
    const axesAt = at + v.getUint16(at + 4), count = v.getUint16(at + 8), size = v.getUint16(at + 10);
    for (let i = 0; i < count; i++) {
        const axis = axesAt + i * size;
        if (axis + 20 > v.byteLength || axis + 20 > at + length) return null;
        if (tag(v, axis) !== 'wght') continue;
        const min = v.getInt32(axis + 4) / 65536, max = v.getInt32(axis + 12) / 65536;
        return min > 0 && max >= min ? [Math.round(min), Math.round(max)] : null;
    }
    return null;
}

/** A WOFF2 table directory's UIntBase128 at `at`: the value and where the next field starts. */
function base128(v: DataView, at: number): [number, number] {
    let value = 0;
    for (let i = 0; i < 5; i++) {
        const byte = v.getUint8(at + i);
        value = value * 128 + (byte & 0x7f);
        if (!(byte & 0x80)) return [value, at + i + 1];
    }
    return [value, at + 5];
}

/** Where WOFF2 names `fvar` among its known tables. */
const WOFF2_FVAR = 47;
/** glyf and loca: the two tables whose transform version 0 is a transform. */
const WOFF2_GLYF = 10, WOFF2_LOCA = 11;
/** What a variable font is said to cover when its axis cannot be read (its tables are compressed): the whole CSS scale. */
const WHOLE_SCALE: [number, number] = [1, 1000];

/**
 * The weights a font file (TrueType, OpenType, WOFF or WOFF2) draws: its `wght` axis as [lightest, heaviest] when it is a variable
 * font, null for a font of one weight or bytes that are no font. Pure; reads the table directory only.
 */
export function fontWeightRange(bytes: ArrayBuffer): [number, number] | null {
    try {
        const v = new DataView(bytes);
        if (v.byteLength < 12) return null;
        const signature = tag(v, 0);
        if (signature === 'wOFF') {
            const tables = v.getUint16(12);
            for (let i = 0; i < tables; i++) {
                const entry = 44 + i * 20;
                if (tag(v, entry) !== 'fvar') continue;
                const offset = v.getUint32(entry + 4), compressed = v.getUint32(entry + 8), length = v.getUint32(entry + 12);
                return compressed === length ? weightAxis(v, offset, length) : WHOLE_SCALE;
            }
            return null;
        }
        if (signature === 'wOF2') {
            const tables = v.getUint16(12);
            let at = 48;
            for (let i = 0; i < tables; i++) {
                const flags = v.getUint8(at++);
                const known = flags & 0x3f, version = (flags >> 6) & 3;
                let name: string | number = known;
                if (known === 63) { name = tag(v, at); at += 4; }
                [, at] = base128(v, at);
                const transformed = known === WOFF2_GLYF || known === WOFF2_LOCA ? version === 0 : version !== 0;
                if (transformed) [, at] = base128(v, at);
                if (name === WOFF2_FVAR || name === 'fvar') return WHOLE_SCALE;
            }
            return null;
        }
        // TrueType (0x00010000, 'true') or OpenType with CFF outlines ('OTTO'): a plain table directory.
        if (v.getUint32(0) !== 0x00010000 && signature !== 'true' && signature !== 'OTTO') return null;
        const tables = v.getUint16(4);
        for (let i = 0; i < tables; i++) {
            const entry = 12 + i * 16;
            if (tag(v, entry) === 'fvar') return weightAxis(v, v.getUint32(entry + 8), v.getUint32(entry + 12));
        }
        return null;
    } catch {
        return null;
    }
}

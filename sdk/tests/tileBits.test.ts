// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    encodeTile, tileIdOf, tileFlagsOf, orientationPerm,
    flipFlagsH, flipFlagsV, rotateFlagsCW, NO_FLAGS,
    TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D,
    type TileFlags,
} from '../src/tilemap/tileBits';
import {
    singleStamp, flipStampH, flipStampV, rotateStampCW, isEmptyStamp,
} from '../src/tilemap/tileStamp';

const ALL_FLAGS: TileFlags[] = [];
for (let b = 0; b < 8; b++) {
    ALL_FLAGS.push({ flipH: !!(b & 1), flipV: !!(b & 2), flipD: !!(b & 4) });
}

describe('tile bit encoding', () => {
    it('round-trips id + flags', () => {
        for (const f of ALL_FLAGS) {
            const raw = encodeTile(42, f);
            expect(tileIdOf(raw)).toBe(42);
            expect(tileFlagsOf(raw)).toEqual(f);
        }
    });

    it('masks the id to 13 bits and sets the right flag bits', () => {
        expect(encodeTile(1, { flipH: true, flipV: false, flipD: false })).toBe(1 | TILE_FLIP_H);
        expect(encodeTile(1, { flipH: false, flipV: true, flipD: false })).toBe(1 | TILE_FLIP_V);
        expect(encodeTile(1, { flipH: false, flipV: false, flipD: true })).toBe(1 | TILE_FLIP_D);
        expect(tileIdOf(0x9000 | 0x1234)).toBe(0x1234);
    });

    it('the 8 flag combos map to 8 distinct orientation perms (D4 bijection)', () => {
        const seen = new Set(ALL_FLAGS.map((f) => orientationPerm(f).join(',')));
        expect(seen.size).toBe(8);
    });
});

describe('D4 flag algebra', () => {
    it('flipH and flipV are involutions', () => {
        for (const f of ALL_FLAGS) {
            expect(flipFlagsH(flipFlagsH(f))).toEqual(f);
            expect(flipFlagsV(flipFlagsV(f))).toEqual(f);
        }
    });

    it('rotateCW has order 4', () => {
        for (const f of ALL_FLAGS) {
            expect(rotateFlagsCW(rotateFlagsCW(rotateFlagsCW(rotateFlagsCW(f))))).toEqual(f);
        }
    });

    it('flipH ∘ flipV == rotate 180 (two CW rotations)', () => {
        for (const f of ALL_FLAGS) {
            expect(flipFlagsH(flipFlagsV(f))).toEqual(rotateFlagsCW(rotateFlagsCW(f)));
        }
    });

    it('a plain tile gains the matching flag under a single op', () => {
        expect(flipFlagsH(NO_FLAGS)).toEqual({ flipH: true, flipV: false, flipD: false });
        expect(flipFlagsV(NO_FLAGS)).toEqual({ flipH: false, flipV: true, flipD: false });
    });
});

describe('tile stamps', () => {
    it('singleStamp wraps one raw cell', () => {
        const s = singleStamp(encodeTile(7));
        expect(s).toEqual({ w: 1, h: 1, cells: [7] });
        expect(isEmptyStamp(singleStamp(0))).toBe(true);
        expect(isEmptyStamp(s)).toBe(false);
    });

    it('flipStampH mirrors the grid and each cell', () => {
        // 2×1: [id1, id2] → [id2', id1'] with each cell flipped H.
        const s = { w: 2, h: 1, cells: [encodeTile(1), encodeTile(2)] };
        const r = flipStampH(s);
        expect(r.w).toBe(2);
        expect(r.h).toBe(1);
        expect(tileIdOf(r.cells[0])).toBe(2);
        expect(tileIdOf(r.cells[1])).toBe(1);
        expect(tileFlagsOf(r.cells[0]).flipH).toBe(true);
    });

    it('rotateStampCW transposes dims and rotates cells', () => {
        // 2×1 row → 1×2 column.
        const s = { w: 2, h: 1, cells: [encodeTile(1), encodeTile(2)] };
        const r = rotateStampCW(s);
        expect(r.w).toBe(1);
        expect(r.h).toBe(2);
        // 4× rotate restores the original.
        expect(rotateStampCW(rotateStampCW(rotateStampCW(rotateStampCW(s))))).toEqual(s);
    });

    it('empty cells stay empty through transforms', () => {
        const s = { w: 2, h: 1, cells: [0, encodeTile(5)] };
        expect(flipStampH(s).cells.filter((c) => tileIdOf(c) === 0).length).toBe(1);
        expect(rotateStampCW(s).cells.filter((c) => tileIdOf(c) === 0).length).toBe(1);
    });
});

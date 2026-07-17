// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    tileCellCenter, tileCellOutline, isNonOrthogonal, TileOrientation,
    type TileGridParams,
} from '../src/tilemap/tileGeometry';

// tw=64, th=32 so hw=32, hh=16 — a rectangular tile that makes iso/hex offsets legible.
const base = { tileWidth: 64, tileHeight: 32 };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 5);
const centerEq = (p: TileGridParams, tx: number, ty: number, x: number, y: number) => {
    const c = tileCellCenter(p, tx, ty);
    close(c.x, x); close(c.y, y);
};

describe('tileCellCenter', () => {
    it('orthogonal: tile (0,0) center sits at (+hw,-hh); +tx→right, +ty→down', () => {
        const p = { ...base, orientation: TileOrientation.Orthogonal };
        centerEq(p, 0, 0, 32, -16);
        centerEq(p, 1, 0, 96, -16);
        centerEq(p, 0, 1, 32, -48);
    });

    it('isometric: tile (0,0) center is the origin; the lattice is a diamond', () => {
        const p = { ...base, orientation: TileOrientation.Isometric };
        centerEq(p, 0, 0, 0, 0);
        centerEq(p, 1, 0, 32, -16);
        centerEq(p, 0, 1, -32, -16);
        centerEq(p, 1, 1, 0, -32);
    });

    it('staggered (axis Y, index odd): odd rows shift right hw and every row drops hh', () => {
        const p = { ...base, orientation: TileOrientation.Staggered };
        centerEq(p, 0, 0, 32, -16);
        centerEq(p, 0, 1, 64, -32); // row 1 (odd) shifted +hw, dropped +hh
        centerEq(p, 0, 2, 32, -48); // row 2 (even) back to the column
    });

    it('staggered index even flips which rows shift', () => {
        const p = { ...base, orientation: TileOrientation.Staggered, staggerIndexEven: true };
        centerEq(p, 0, 0, 64, -16); // row 0 (even) now shifted
        centerEq(p, 0, 1, 32, -32); // row 1 (odd) unshifted
    });

    it('staggered axis X shifts odd columns down instead of rows right', () => {
        const p = { ...base, orientation: TileOrientation.Staggered, staggerAxisX: true };
        // colW = (64+0)/2 = 32
        centerEq(p, 0, 0, 32, -16);
        centerEq(p, 1, 0, 64, -32); // col 1 (odd) shifted down hh, advanced one colW
        centerEq(p, 2, 0, 96, -16);
    });

    it('hexagonal (axis Y): row pitch is (th+side)/2, side defaults to th/2', () => {
        const side8 = { ...base, orientation: TileOrientation.Hexagonal, hexSideLength: 8 };
        // rowH = (32+8)/2 = 20
        centerEq(side8, 0, 0, 32, -16);
        centerEq(side8, 0, 1, 64, -36); // odd row shifted +hw, y = -(20 + 16)
        centerEq(side8, 0, 2, 32, -56); // even row, y = -(40 + 16)

        const dflt = { ...base, orientation: TileOrientation.Hexagonal }; // side → th/2 = 16
        // rowH = (32+16)/2 = 24
        centerEq(dflt, 0, 2, 32, -64); // y = -(2*24 + 16)
    });

    it('hexagonal axis X: column pitch is (tw+side)/2', () => {
        const p = { ...base, orientation: TileOrientation.Hexagonal, hexSideLength: 8, staggerAxisX: true };
        // colW = (64+8)/2 = 36
        centerEq(p, 0, 0, 32, -16);
        centerEq(p, 1, 0, 68, -32); // col 1 (odd) shifted down hh, x = 36 + 32
        centerEq(p, 2, 0, 104, -16);
    });
});

describe('tileCellOutline', () => {
    it('orthogonal outline is the tile rect', () => {
        const o = tileCellOutline({ ...base, orientation: TileOrientation.Orthogonal });
        expect(o).toHaveLength(4);
        // spans the full tile box
        expect(Math.max(...o.map((v) => v.x))).toBe(32);
        expect(Math.min(...o.map((v) => v.x))).toBe(-32);
        expect(Math.max(...o.map((v) => v.y))).toBe(16);
    });

    it('isometric/staggered outline is a diamond (points on the axes)', () => {
        for (const orientation of [TileOrientation.Isometric, TileOrientation.Staggered]) {
            const o = tileCellOutline({ ...base, orientation });
            expect(o).toEqual([{ x: 0, y: 16 }, { x: 32, y: 0 }, { x: 0, y: -16 }, { x: -32, y: 0 }]);
        }
    });

    it('hexagonal axis Y is a pointy-top hex: 6 verts, flat edges vertical of length side', () => {
        const o = tileCellOutline({ ...base, orientation: TileOrientation.Hexagonal, hexSideLength: 8 });
        expect(o).toHaveLength(6);
        // top and bottom are single points on the y axis
        expect(o).toContainEqual({ x: 0, y: 16 });
        expect(o).toContainEqual({ x: 0, y: -16 });
        // right flat edge: two verts at x=+hw, y=±side/2
        expect(o).toContainEqual({ x: 32, y: 4 });
        expect(o).toContainEqual({ x: 32, y: -4 });
    });

    it('hexagonal axis X is a flat-top hex: points on the x axis', () => {
        const o = tileCellOutline({ ...base, orientation: TileOrientation.Hexagonal, hexSideLength: 8, staggerAxisX: true });
        expect(o).toHaveLength(6);
        expect(o).toContainEqual({ x: 32, y: 0 });
        expect(o).toContainEqual({ x: -32, y: 0 });
        // top flat edge (length side) at y=+hh
        expect(o).toContainEqual({ x: -4, y: 16 });
        expect(o).toContainEqual({ x: 4, y: 16 });
    });
});

describe('isNonOrthogonal', () => {
    it('is true for iso/staggered/hex, false for orthogonal', () => {
        expect(isNonOrthogonal(TileOrientation.Orthogonal)).toBe(false);
        expect(isNonOrthogonal(TileOrientation.Isometric)).toBe(true);
        expect(isNonOrthogonal(TileOrientation.Staggered)).toBe(true);
        expect(isNonOrthogonal(TileOrientation.Hexagonal)).toBe(true);
    });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The 2D fog of war: the field of view cast against the walls, the grid of what has been seen and how it is saved, and the effect that draws it.
 */
import { describe, expect, it } from 'vitest';
import { ExploredGrid, applyFogOfWarToFog, exploredFromString, exploredToString, fanDistances } from '../src/render/fogOfWar';
import { getEffectDef } from '../src/postprocess/effects';
import { FOG_EXPLORED_TEXTURE, FOG_VISIBLE_TEXTURE } from '../src/postprocess/fogOfWarMask';
import type { BlendedEffect } from '../src/postprocess/volumeBlending';

/** A wall 20 wide and 200 tall at x = 100, as a ring. */
const wall = [{ x: 90, y: -100 }, { x: 110, y: -100 }, { x: 110, y: 100 }, { x: 90, y: 100 }];

describe('a viewer\'s rays', () => {
    it('go the whole radius in the open and stop at a wall', () => {
        const open = fanDistances({ x: 0, y: 0 }, 300, [], 8);
        expect([...open]).toEqual(new Array(8).fill(300));
        const rays = fanDistances({ x: 0, y: 0 }, 300, [wall], 8);
        // The ray along +x meets the wall's near face at x = 90.
        expect(rays[0]).toBeCloseTo(90, 4);
        // The ray along -x goes away from it, and so do the ones that miss it.
        expect(rays[4]).toBe(300);
        expect(rays[2]).toBe(300);
    });

    it('ignores a wall the viewer stands in, and one the circle cannot touch', () => {
        expect(fanDistances({ x: 100, y: 0 }, 300, [wall], 8)[0]).toBe(300);
        expect(fanDistances({ x: 0, y: 0 }, 50, [wall], 8)[0]).toBe(50);
    });
});

describe('what has been seen', () => {
    it('marks the cells a fan reaches and tells whether anything was new', () => {
        const grid = new ExploredGrid(64);
        const first = grid.markFan({ x: 500, y: 500 }, new Float32Array(32).fill(100), 0, 0, 1000, 1000);
        expect(first).toBe(true);
        const marked = grid.cells.reduce((n, c) => n + c, 0);
        expect(marked).toBeGreaterThan(50);
        expect(grid.cells[Math.floor(500 / (1000 / 64)) * 64 + Math.floor(500 / (1000 / 64))]).toBe(1);
        // The same field of view again finds nothing new, and a point outside the rectangle is not a cell.
        expect(grid.markFan({ x: 500, y: 500 }, new Float32Array(32).fill(100), 0, 0, 1000, 1000)).toBe(false);
        expect(grid.mark(-5, 500, 0, 0, 1000, 1000)).toBe(false);
    });

    it('is saved as a string and restored from it, and refuses one that does not fit', () => {
        const grid = new ExploredGrid(32);
        grid.markFan({ x: 100, y: 100 }, new Float32Array(16).fill(60), 0, 0, 320, 320);
        const text = grid.toString();
        const other = new ExploredGrid(32);
        expect(other.fromString(text)).toBe(true);
        expect([...other.cells]).toEqual([...grid.cells]);
        const wrongSize = new ExploredGrid(16);
        expect(wrongSize.fromString(text)).toBe(false);
        expect(other.fromString('32:zz')).toBe(false);
        expect(other.fromString('32:1,1')).toBe(false);
        // A refused string leaves the grid as it was.
        expect([...other.cells]).toEqual([...grid.cells]);
        // An empty fog is one run.
        expect(new ExploredGrid(4).toString()).toBe('4:g');
    });

    it('has nothing to save or restore with no fog in the scene', () => {
        expect(exploredToString()).toBe('');
        expect(exploredFromString('4:g')).toBe(false);
    });
});

describe('the fog effect', () => {
    it('is an atmosphere effect that asks for no depth, whose maps and rectangle are written by the engine', () => {
        const def = getEffectDef('fog2d');
        expect(def).toBeDefined();
        expect(def!.category).toBe('atmosphere');
        expect(def!.uniforms.filter((u) => u.internal).map((u) => u.name)).toEqual(['u_fogL', 'u_fogB', 'u_fogW', 'u_fogH']);
        expect(def!.textures!.map((t) => t.name)).toEqual([FOG_EXPLORED_TEXTURE, FOG_VISIBLE_TEXTURE]);
    });

    it('is turned off while there is no fog to read, so the whole picture is not black', () => {
        const fog: BlendedEffect = { enabled: true, uniforms: new Map(), textures: new Map(), colors: new Map() };
        applyFogOfWarToFog(new Map([['fog2d', fog]]));
        expect(fog.enabled).toBe(false);
        const other: BlendedEffect = { enabled: true, uniforms: new Map(), textures: new Map(), colors: new Map() };
        applyFogOfWarToFog(new Map([['vignette', other]]));
        expect(other.enabled).toBe(true);
    });
});

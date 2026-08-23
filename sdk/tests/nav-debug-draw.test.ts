// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the navigation overlay draws.
 *
 * Counted, not looked at: the claims are which faces appear, where the walkable
 * world stops, and that an overlay nobody asked for costs nothing. A pixel test
 * could say none of those.
 *
 * One drawer serves both kinds of surface, so both are asked here — a grid whose
 * faces lie in the scene's own plane, and a mesh whose faces follow the ground.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { NavMesh } from '../src/ai/nav/NavMesh';
import { drawNavDebug, type NavDebugDrawConfig } from '../src/ai/nav/NavDebugDraw';
import { Draw } from '../src/render/draw';
import type { Vec3 } from '../src/types';

const ON: NavDebugDrawConfig = { enabled: true, showFaces: true, showBorders: true };
let lines: Array<[Vec3, Vec3]>;

beforeEach(() => {
    lines = [];
    vi.spyOn(Draw, 'line3D').mockImplementation((from, to) => {
        lines.push([{ ...from }, { ...to }]);
    });
});
afterEach(() => vi.restoreAllMocks());

/** One square polygon 40 units up, with nothing beside it. */
const oneQuadMesh = (): NavMesh => new NavMesh({
    verts: Float32Array.from([0, 40, 0, 10, 40, 0, 10, 40, 10, 0, 40, 10]),
    polys: Int32Array.from([0, 1, 2, 3, -1, -1]),
    neis: Int32Array.from([-1, -1, -1, -1, -1, -1]),
    polyCount: 1,
    maxVertsPerPoly: 6,
    agentRadius: 0,
    snapDistance: 10,
    verticalReach: 100,
});

describe('drawNavDebug', () => {
    it('draws nothing at all until it is turned on', () => {
        drawNavDebug(new NavGrid({ width: 3, height: 3, cellSize: 10 }), { ...ON, enabled: false });
        expect(lines).toHaveLength(0);
    });

    it('draws nothing when there is no surface', () => {
        drawNavDebug(null, ON);
        expect(lines).toHaveLength(0);
    });

    it('outlines the walkable cells of a grid and leaves out the blocked ones', () => {
        const grid = new NavGrid({ width: 2, height: 1, cellSize: 10 });
        grid.setWalkable(1, 0, false);
        drawNavDebug(grid, { ...ON, showBorders: false });
        expect(lines).toHaveLength(4); // one quad, for the one walkable cell
    });

    // The borders are the only thing that says where a route can turn: the faces
    // of an open floor and of a corridor look the same drawn one at a time.
    it('marks every edge the walkable world stops at', () => {
        const grid = new NavGrid({ width: 3, height: 1, cellSize: 10 });
        drawNavDebug(grid, { ...ON, showFaces: false });
        // Three cells in a row: two ends, and the long side of each, twice over.
        expect(lines).toHaveLength(8);
    });

    // Off the ground means different things on a flat scene and a spatial one,
    // and drawing a grid's overlay along +Y would slide it across the floor it
    // is describing rather than lifting it off.
    it('lifts the overlay along the surface own idea of up', () => {
        drawNavDebug(new NavGrid({ width: 1, height: 1, cellSize: 10, origin: { x: 0, y: 0, z: 5 } }),
            { ...ON, showBorders: false });
        expect(lines[0]![0]!.z).toBeCloseTo(6);
        expect(lines[0]![0]!.y).toBeCloseTo(-5);

        lines = [];
        drawNavDebug(oneQuadMesh(), { ...ON, showBorders: false });
        expect(lines[0]![0]!.y).toBeCloseTo(41);
    });

    it('draws a mesh polygon as one loop and its open edges as borders', () => {
        drawNavDebug(oneQuadMesh(), ON);
        expect(lines).toHaveLength(8); // four edges of the face, four borders
    });

    it('stops drawing faces long before an overlay is what the frame is doing', () => {
        const huge = new NavGrid({ width: 200, height: 200, cellSize: 10 });
        drawNavDebug(huge, { ...ON, showBorders: false });
        expect(lines.length).toBe(4096 * 4);
    });
});

/**
 * Plugins register their overlays at build time whether one will ever be turned
 * on, and a core built without a Draw API has no batch to open. The pipeline has
 * to skip it: the alternative is a thrown frame for a callback that would have
 * drawn nothing.
 */
describe('an overlay on a core with no Draw API', () => {
    it('does not open a batch it cannot open', async () => {
        const { isDrawAPIReady } = await import('../src/render/draw');
        expect(isDrawAPIReady()).toBe(false); // nothing initialised one here
    });
});

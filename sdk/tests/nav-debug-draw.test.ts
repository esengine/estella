// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the navigation overlay draws.
 *
 * Counted, not looked at: the claims are which cells appear (the walkable ones),
 * where the ledges are (the pairs the step limit refuses) and that an overlay
 * nobody asked for costs nothing. A pixel test could say none of those.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { drawNavDebug, type NavDebugDrawConfig } from '../src/ai/nav/NavDebugDraw';
import { Draw } from '../src/render/draw';
import type { Vec3 } from '../src/types';

const ON: NavDebugDrawConfig = { enabled: true, showCells: true, showLedges: true };
let lines: Array<[Vec3, Vec3]>;

beforeEach(() => {
    lines = [];
    vi.spyOn(Draw, 'line3D').mockImplementation((from, to) => {
        lines.push([{ ...from }, { ...to }]);
    });
});
afterEach(() => vi.restoreAllMocks());

/** A ground grid whose middle column stands 90 units up. */
const ridge = (stepHeight: number) => new NavGrid({
    width: 3, height: 1, cellSize: 10, plane: 'xz',
    surface: [0, 90, 0], stepHeight,
});

describe('drawNavDebug', () => {
    it('draws nothing at all until it is turned on', () => {
        drawNavDebug(ridge(20), { ...ON, enabled: false });
        expect(lines).toHaveLength(0);
    });

    it('draws nothing when there is no grid', () => {
        drawNavDebug(null, ON);
        expect(lines).toHaveLength(0);
    });

    it('outlines the walkable cells and leaves out the blocked ones', () => {
        const grid = new NavGrid({ width: 2, height: 1, cellSize: 10, plane: 'xz' });
        grid.setWalkable(1, 0, false);
        drawNavDebug(grid, { ...ON, showLedges: false });
        expect(lines).toHaveLength(4); // one quad, for the one walkable cell
    });

    // The height is the point: an overlay drawn on a flat plane would say nothing
    // about the ground the route actually walks over.
    it('draws each cell at the height of its own ground', () => {
        const grid = new NavGrid({
            width: 2, height: 1, cellSize: 10, plane: 'xz', surface: [0, 90],
        });
        drawNavDebug(grid, { ...ON, showLedges: false });
        const heights = new Set(lines.map(([a]) => Math.round(a.y)));
        expect(heights.has(1)).toBe(true);  // the low cell, lifted off its floor
        expect(heights.has(91)).toBe(true); // the high one
    });

    // A ledge is the only thing that explains a route going the long way round,
    // and it is invisible in the cells themselves — both sides are walkable.
    it('marks the pairs the step limit refuses, and only those', () => {
        const cells = (g: NavGrid) => {
            lines = [];
            drawNavDebug(g, { ...ON, showLedges: false });
            return lines.length;
        };
        const blocked = ridge(20);
        const base = cells(blocked);
        lines = [];
        drawNavDebug(blocked, ON);
        expect(lines.length).toBeGreaterThan(base); // two ledges, either side of the ridge

        // The same ground with a limit that clears it: cells, and no ledges.
        const climbable = ridge(200);
        const climbBase = cells(climbable);
        lines = [];
        drawNavDebug(climbable, ON);
        expect(lines.length).toBe(climbBase);
    });

    it('stops drawing cells long before an overlay is what the frame is doing', () => {
        const huge = new NavGrid({ width: 200, height: 200, cellSize: 10, plane: 'xz' });
        drawNavDebug(huge, { ...ON, showLedges: false });
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

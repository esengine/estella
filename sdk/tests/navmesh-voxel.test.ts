// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The voxel stages of the navmesh bake, each on its own terms.
 *
 * The end-to-end bake has four different reasons to leave a cell out, and they
 * back each other up: take any one away and the mesh usually still comes out
 * right, which makes a whole-pipeline test blind to three of them. So each stage
 * is asked here for the one thing only it can answer.
 */
import { describe, it, expect } from 'vitest';
import {
    NavHeightfield, addSpan, rasterizeTriangles, filterLedgeSpans,
    filterLowHangingWalkableObstacles, filterWalkableLowHeightSpans,
    NAV_AREA_NULL, NAV_AREA_WALKABLE, type NavSpan,
} from '../src/ai/nav/navmesh/heightfield';
import { NavCompactField, erodeWalkableArea, NAV_NOT_CONNECTED } from '../src/ai/nav/navmesh/compact';

const MIN = { x: 0, y: 0, z: 0 };
const MAX = { x: 100, y: 100, z: 100 };
/** Ten by ten cells of ten units, in voxels of one. */
const field = (): NavHeightfield => new NavHeightfield(MIN, MAX, 10, 1);

/** The spans of one column, lowest first. */
function column(hf: NavHeightfield, x: number, z: number): NavSpan[] {
    const out: NavSpan[] = [];
    for (let s = hf.spans[x + z * hf.width] ?? null; s; s = s.next) out.push(s);
    return out;
}

/** A level quad at height `y` covering `[x0,x1] x [z0,z1]`, as two triangles. */
function floor(y: number, x0: number, x1: number, z0: number, z1: number)
: { verts: Float32Array; indices: Uint32Array } {
    return {
        verts: Float32Array.from([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]),
        indices: Uint32Array.from([0, 2, 1, 0, 3, 2]),
    };
}

describe('the solid heightfield', () => {
    it('fills every column a triangle crosses, not just the ones it has a corner in', () => {
        const hf = field();
        const q = floor(50, 5, 95, 5, 95);
        rasterizeTriangles(hf, q.verts, q.indices, Math.cos(Math.PI / 4), 1);
        // The quad covers cells 0..9 in both axes; a sampler would have missed
        // every cell whose centre the two triangles happen to straddle.
        for (let z = 0; z < 10; z++) {
            for (let x = 0; x < 10; x++) expect(column(hf, x, z)).toHaveLength(1);
        }
        expect(column(hf, 5, 5)[0]!.area).toBe(NAV_AREA_WALKABLE);
        // A surface is rounded UP to the top of the voxel it falls in, so a floor
        // at 50 fills the voxel below 51 — the reason a baked mesh floats by up
        // to one `cellHeight` over the geometry it came from.
        expect(column(hf, 5, 5)[0]!.smax).toBe(51);
    });

    it('leaves ground steeper than the agent solid but not walkable', () => {
        const hf = field();
        // A wall face: vertical, so its normal has no upward component at all.
        const wall = {
            verts: Float32Array.from([50, 0, 5, 50, 0, 95, 50, 80, 95, 50, 80, 5]),
            indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
        };
        rasterizeTriangles(hf, wall.verts, wall.indices, Math.cos(Math.PI / 4), 1);
        const spans = column(hf, 5, 5);
        expect(spans.length).toBeGreaterThan(0);
        expect(spans[0]!.area).toBe(NAV_AREA_NULL);
    });

    it('merges overlapping spans into the one solid thing they are', () => {
        const hf = field();
        addSpan(hf, 0, 0, 10, 20, NAV_AREA_WALKABLE, 1);
        addSpan(hf, 0, 0, 15, 30, NAV_AREA_NULL, 1);
        const spans = column(hf, 0, 0);
        expect(spans).toHaveLength(1);
        expect(spans[0]!.smin).toBe(10);
        expect(spans[0]!.smax).toBe(30);
        // Two tops far apart: the lower one's area does not carry to the new top.
        expect(spans[0]!.area).toBe(NAV_AREA_NULL);
    });
});

describe('filterLowHangingWalkableObstacles', () => {
    // A kerb rasterises as an obstacle standing on the floor. Left as one it cuts
    // the walkable world in two at every doorstep in the level.
    it('makes a step small enough to walk up into ground', () => {
        const hf = field();
        addSpan(hf, 0, 0, 0, 10, NAV_AREA_WALKABLE, 1);
        addSpan(hf, 0, 0, 12, 13, NAV_AREA_NULL, 1);
        filterLowHangingWalkableObstacles(hf, 4);
        expect(column(hf, 0, 0)[1]!.area).toBe(NAV_AREA_WALKABLE);
    });

    it('leaves one too tall to step onto alone', () => {
        const hf = field();
        addSpan(hf, 0, 0, 0, 10, NAV_AREA_WALKABLE, 1);
        addSpan(hf, 0, 0, 20, 21, NAV_AREA_NULL, 1);
        filterLowHangingWalkableObstacles(hf, 4);
        expect(column(hf, 0, 0)[1]!.area).toBe(NAV_AREA_NULL);
    });
});

describe('filterLedgeSpans', () => {
    // The last row of floor before a drop is where an agent walking the very edge
    // of it would fall. Nothing else in the bake knows that: a cell on the lip
    // has a floor, has headroom, and is perfectly flat.
    it('takes the walkable flag off the floor at the edge of a drop', () => {
        const hf = field();
        // A plateau over the left half at height 40, nothing at all on the right.
        for (let z = 0; z < 10; z++) {
            for (let x = 0; x < 5; x++) addSpan(hf, x, z, 0, 40, NAV_AREA_WALKABLE, 1);
        }
        filterLedgeSpans(hf, 4, 2);
        expect(column(hf, 4, 5)[0]!.area).toBe(NAV_AREA_NULL);
        expect(column(hf, 2, 5)[0]!.area).toBe(NAV_AREA_WALKABLE);
    });

    it('leaves a step it can walk down alone', () => {
        const hf = field();
        for (let z = 0; z < 10; z++) {
            for (let x = 0; x < 10; x++) {
                addSpan(hf, x, z, 0, x < 5 ? 40 : 39, NAV_AREA_WALKABLE, 1);
            }
        }
        filterLedgeSpans(hf, 4, 2);
        expect(column(hf, 4, 5)[0]!.area).toBe(NAV_AREA_WALKABLE);
    });
});

describe('filterWalkableLowHeightSpans', () => {
    it('takes away floor an agent cannot stand up on', () => {
        const hf = field();
        addSpan(hf, 0, 0, 0, 10, NAV_AREA_WALKABLE, 1);
        addSpan(hf, 0, 0, 13, 20, NAV_AREA_NULL, 1);
        addSpan(hf, 1, 0, 0, 10, NAV_AREA_WALKABLE, 1);
        addSpan(hf, 1, 0, 30, 40, NAV_AREA_NULL, 1);
        filterWalkableLowHeightSpans(hf, 5);
        expect(column(hf, 0, 0)[0]!.area).toBe(NAV_AREA_NULL);
        expect(column(hf, 1, 0)[0]!.area).toBe(NAV_AREA_WALKABLE);
    });
});

describe('the compact field', () => {
    /** Two neighbouring columns of floor, the second `step` voxels higher. */
    const stepped = (step: number, climb: number): NavCompactField => {
        const hf = field();
        addSpan(hf, 0, 0, 0, 10, NAV_AREA_WALKABLE, 1);
        addSpan(hf, 1, 0, 0, 10 + step, NAV_AREA_WALKABLE, 1);
        return new NavCompactField(hf, 5, climb);
    };

    it('connects two floors only when the step between them can be climbed', () => {
        expect(stepped(2, 4).getCon(0, 2)).not.toBe(NAV_NOT_CONNECTED);
        expect(stepped(20, 4).getCon(0, 2)).toBe(NAV_NOT_CONNECTED);
    });

    it('will not connect through a gap too short to stand in', () => {
        const hf = field();
        addSpan(hf, 0, 0, 0, 10, NAV_AREA_WALKABLE, 1);
        addSpan(hf, 1, 0, 0, 10, NAV_AREA_WALKABLE, 1);
        // A ceiling over the second column, three voxels above its floor.
        addSpan(hf, 1, 0, 13, 20, NAV_AREA_NULL, 1);
        expect(new NavCompactField(hf, 3, 4).getCon(0, 2)).not.toBe(NAV_NOT_CONNECTED);
        expect(new NavCompactField(hf, 5, 4).getCon(0, 2)).toBe(NAV_NOT_CONNECTED);
    });

    it('erodes the walkable area by the width of the agent', () => {
        const hf = field();
        for (let z = 0; z < 10; z++) {
            for (let x = 0; x < 10; x++) addSpan(hf, x, z, 0, 10, NAV_AREA_WALKABLE, 1);
        }
        const chf = new NavCompactField(hf, 5, 4);
        erodeWalkableArea(chf, 2);
        const areaAt = (x: number, z: number): number => chf.areas[chf.cellIndex[x + z * 10]!]!;
        // Two cells in from EVERY edge is gone, the far ones included: a distance
        // transform swept one way only measures the corner it started from.
        expect(areaAt(0, 5)).toBe(NAV_AREA_NULL);
        expect(areaAt(1, 5)).toBe(NAV_AREA_NULL);
        expect(areaAt(9, 5)).toBe(NAV_AREA_NULL);
        expect(areaAt(8, 5)).toBe(NAV_AREA_NULL);
        expect(areaAt(5, 9)).toBe(NAV_AREA_NULL);
        expect(areaAt(5, 8)).toBe(NAV_AREA_NULL);
        expect(areaAt(5, 5)).toBe(NAV_AREA_WALKABLE);
    });
});

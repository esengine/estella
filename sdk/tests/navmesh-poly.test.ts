// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Region outlines and the convex polygons made from them.
 */
import { describe, it, expect } from 'vitest';
import {
    NavHeightfield, addSpan, NAV_AREA_WALKABLE,
} from '../src/ai/nav/navmesh/heightfield';
import { NavCompactField } from '../src/ai/nav/navmesh/compact';
import { buildRegionsMonotone } from '../src/ai/nav/navmesh/regions';
import { buildContours, type NavContour } from '../src/ai/nav/navmesh/contours';
import { buildPolyMesh } from '../src/ai/nav/navmesh/polymesh';

const SIZE = 12;

/** A field of walkable floor, with `hole` deciding which columns are missing. */
function fieldOf(hole: (x: number, z: number) => boolean = () => false): NavCompactField {
    const hf = new NavHeightfield(
        { x: 0, y: 0, z: 0 }, { x: SIZE * 10, y: 100, z: SIZE * 10 }, 10, 1);
    for (let z = 0; z < SIZE; z++) {
        for (let x = 0; x < SIZE; x++) {
            if (hole(x, z)) continue;
            addSpan(hf, x, z, 0, 10, NAV_AREA_WALKABLE, 1);
        }
    }
    return new NavCompactField(hf, 5, 4);
}

/** Twice the signed area of a contour in the ground plane, Recast's measure. */
function signedArea(contour: NavContour): number {
    const n = contour.verts.length / 3;
    let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        area += contour.verts[i * 3]! * contour.verts[j * 3 + 2]!
            - contour.verts[j * 3]! * contour.verts[i * 3 + 2]!;
    }
    return area;
}

describe('buildContours', () => {
    // Which way an outline runs is not a detail: the funnel reads one side of
    // every doorway as left and the other as right, and a contour traced the
    // other way round would hand it the two the wrong way about.
    it('winds every outline the same way', () => {
        const chf = fieldOf((x, z) => x >= 4 && x <= 7 && z >= 4 && z <= 7);
        buildRegionsMonotone(chf, 4);
        const contours = buildContours(chf, 1.3, 12);
        expect(contours.length).toBeGreaterThan(0);
        for (const contour of contours) expect(signedArea(contour)).toBeGreaterThan(0);
    });

    it('puts a corner where the walkable world turns, inside and out', () => {
        const chf = fieldOf((x, z) => x >= 5 && x <= 6 && z >= 5 && z <= 6);
        buildRegionsMonotone(chf, 4);
        const contours = buildContours(chf, 1.3, 12);
        const corners = contours.flatMap(c => {
            const out: string[] = [];
            for (let i = 0; i < c.verts.length; i += 3) out.push(`${c.verts[i]},${c.verts[i + 2]}`);
            return out;
        });
        // The outer corners of the field are on some outline...
        expect(corners).toContain('0,0');
        expect(corners).toContain(`${SIZE},${SIZE}`);
        // ...and so are the corners of the hole, which is what makes it a hole.
        expect(corners).toContain('5,5');
    });
});

describe('buildPolyMesh', () => {
    const meshOf = (hole?: (x: number, z: number) => boolean) => {
        const chf = fieldOf(hole);
        buildRegionsMonotone(chf, 4);
        return buildPolyMesh(buildContours(chf, 1.3, 12), 6);
    };

    // Convex is the whole promise: inside one polygon a straight line is always
    // walkable, and a route that only names polygons rests on it entirely.
    it('covers the floor in polygons that are actually convex', () => {
        // A T: one wide row with a narrow stem, so the region the sweep produces
        // has corners that turn the other way and a careless merge would cut across.
        const mesh = meshOf((x, z) => z >= 1 && (x < 4 || x > 7));
        expect(mesh.polyCount).toBeGreaterThan(0);
        for (let p = 0; p < mesh.polyCount; p++) {
            const verts: number[] = [];
            for (let i = 0; i < mesh.maxVertsPerPoly; i++) {
                const v = mesh.polys[p * mesh.maxVertsPerPoly + i]!;
                if (v === -1) break;
                verts.push(v);
            }
            expect(verts.length).toBeGreaterThanOrEqual(3);
            expect(verts.length).toBeLessThanOrEqual(6);
            expect(isConvex(mesh.verts, verts)).toBe(true);
        }
    });

    // Regions are cut by a sweep, not by anything in the world, so the seams
    // between them are invisible — unless the polygons on either side fail to
    // find each other, and then the mesh is in pieces no route can cross.
    it('links the polygons on either side of a region seam', () => {
        const mesh = meshOf((x, z) => x === 5 && z >= 8);
        expect(mesh.polyCount).toBeGreaterThan(1);
        let linked = 0;
        for (let i = 0; i < mesh.neis.length; i++) if (mesh.neis[i] !== -1) linked++;
        expect(linked).toBeGreaterThan(0);
        // Every link is mutual: the neighbour names this polygon back.
        for (let p = 0; p < mesh.polyCount; p++) {
            for (let e = 0; e < mesh.maxVertsPerPoly; e++) {
                const other = mesh.neis[p * mesh.maxVertsPerPoly + e]!;
                if (other === -1) continue;
                let back = false;
                for (let f = 0; f < mesh.maxVertsPerPoly; f++) {
                    if (mesh.neis[other * mesh.maxVertsPerPoly + f] === p) back = true;
                }
                expect(back).toBe(true);
            }
        }
    });
});

/** Whether the polygon turns the same way at every corner, in the ground plane. */
function isConvex(verts: Int32Array, poly: number[]): boolean {
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]! * 3;
        const b = poly[(i + 1) % poly.length]! * 3;
        const c = poly[(i + 2) % poly.length]! * 3;
        const cross = (verts[b]! - verts[a]!) * (verts[c + 2]! - verts[b + 2]!)
            - (verts[b + 2]! - verts[a + 2]!) * (verts[c]! - verts[b]!);
        if (cross === 0) continue;
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) return false;
    }
    return true;
}

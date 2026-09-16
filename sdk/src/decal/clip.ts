// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    clip.ts
 * @brief   The geometry a decal IS: the receiving surface, cut to the projector's box.
 *
 * @details A decal is not a sticker floating in front of a wall — it is the wall,
 *          drawn again with the decal's material and won on depth by the bias that
 *          material carries. So what a projector produces is the receiver's own
 *          triangles, clipped to the box and given the box's coordinates as UVs.
 *
 *          Cut and not discarded per pixel: the result is ordinary geometry, which
 *          is the whole reason a decal here needs no pass, no depth read and no
 *          G-buffer, and is lit and shadowed exactly as the surface under it.
 */

/** A point in the projector's own space: the unit cube from -0.5 to 0.5. */
export interface ClipVertex {
    /** Position, projector-local. */
    p: [number, number, number];
    /** Normal, projector-local — carried through so the cut geometry lights
     *  like the surface it was cut from rather than like the box. */
    n: [number, number, number];
}

/** One triangle of a receiver, already in the projector's space. */
export type ClipTriangle = [ClipVertex, ClipVertex, ClipVertex];

/**
 * How far from facing the projector a surface may be and still take the decal,
 * as the cosine of the angle. A wall at 90° to the projector catches the decal
 * as an infinitely stretched smear, which is what this refuses.
 */
export const DEFAULT_FACING_COSINE = 0.2;

/** The six half-spaces of the unit cube, as `axis` and which side keeps. */
const PLANES: ReadonlyArray<{ axis: 0 | 1 | 2; sign: 1 | -1 }> = [
    { axis: 0, sign: 1 }, { axis: 0, sign: -1 },
    { axis: 1, sign: 1 }, { axis: 1, sign: -1 },
    { axis: 2, sign: 1 }, { axis: 2, sign: -1 },

];

/**
 * How close to a face of the box a vertex may be and still count as on it.
 *
 * A projector placed so its box ENDS at the surface puts every receiver vertex
 * exactly on a face, where the last bit of the transform decides it: a floor at
 * y=0 came out ±6e-16 either side, and half the decal was clipped away.
 */
export const CLIP_EPSILON = 1e-5;

/** Signed distance into the half-space `sign * x <= 0.5` — positive is inside. */
function inside(v: ClipVertex, axis: 0 | 1 | 2, sign: 1 | -1): number {
    return 0.5 + CLIP_EPSILON - sign * v.p[axis];
}

function lerpVertex(a: ClipVertex, b: ClipVertex, t: number): ClipVertex {
    const mix = (x: number, y: number): number => x + (y - x) * t;
    return {
        p: [mix(a.p[0], b.p[0]), mix(a.p[1], b.p[1]), mix(a.p[2], b.p[2])],
        n: [mix(a.n[0], b.n[0]), mix(a.n[1], b.n[1]), mix(a.n[2], b.n[2])],
    };
}

/**
 * Sutherland-Hodgman against one half-space. A convex polygon stays convex and
 * stays one polygon, which is why the box is clipped plane by plane rather than
 * by a general boolean.
 */
function clipToPlane(poly: ClipVertex[], axis: 0 | 1 | 2, sign: 1 | -1): ClipVertex[] {
    if (poly.length === 0) return poly;
    const out: ClipVertex[] = [];
    for (let i = 0; i < poly.length; ++i) {
        const cur = poly[i]!;
        const next = poly[(i + 1) % poly.length]!;
        const dc = inside(cur, axis, sign);
        const dn = inside(next, axis, sign);
        if (dc >= 0) out.push(cur);
        // STRICTLY straddling, both ends off the plane: an end ON it is its own
        // crossing and is already in `out` (or will be next turn), and adding it
        // twice is a duplicate the fan turns into a zero-area triangle.
        if ((dc > 0 && dn < 0) || (dc < 0 && dn > 0)) {
            const t = dc / (dc - dn);
            out.push(lerpVertex(cur, next, t));
        }
    }
    return out;
}

/**
 * Twice a triangle's area, in the box's own units. Squared-free and 3D, since a
 * cut polygon is tilted in general.
 */
function area2(t: ClipTriangle): number {
    const ux = t[1].p[0] - t[0].p[0], uy = t[1].p[1] - t[0].p[1], uz = t[1].p[2] - t[0].p[2];
    const wx = t[2].p[0] - t[0].p[0], wy = t[2].p[1] - t[0].p[1], wz = t[2].p[2] - t[0].p[2];
    return Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
}

/** Below this a fanned triangle is a sliver the cut invented, not geometry. The
 *  box is one unit across, so this is a trillionth of what a whole decal is. */
const AREA_EPSILON = 1e-12;

/** Whether the triangle faces the projector closely enough to take the decal. */
function faces(tri: ClipTriangle, minCosine: number): boolean {
    // The average of the corner normals, against the projector's own -Z: a decal
    // projects ALONG -Z, so a surface it can print on has a normal opposing it.
    const nz = (tri[0].n[2] + tri[1].n[2] + tri[2].n[2]) / 3;
    return nz >= minCosine;
}

/**
 * The receiver triangles, cut to the box.
 *
 * Returns triangles in the same projector space, fanned from each clipped
 * polygon. A triangle wholly outside contributes nothing; one wholly inside
 * comes back unchanged, which is the common case for small geometry.
 */
export function clipToProjector(
    triangles: readonly ClipTriangle[],
    minCosine = DEFAULT_FACING_COSINE,
): ClipTriangle[] {
    const out: ClipTriangle[] = [];
    for (const tri of triangles) {
        if (!faces(tri, minCosine)) continue;
        let poly: ClipVertex[] = [tri[0], tri[1], tri[2]];
        for (const plane of PLANES) {
            poly = clipToPlane(poly, plane.axis, plane.sign);
            if (poly.length < 3) break;
        }
        for (let i = 2; i < poly.length; ++i) {
            const fan: ClipTriangle = [poly[0]!, poly[i - 1]!, poly[i]!];
            // A triangle with no area covers no pixel, and the cut makes them.
            // Dropped here so a decal's vertex count is what it draws, not what
            // the cut happened to produce.
            if (area2(fan) > AREA_EPSILON) out.push(fan);
        }
    }
    return out;
}

/** Where a clipped vertex reads the decal's texture: the box's own xy. */
export function projectorUV(v: ClipVertex): [number, number] {
    return [v.p[0] + 0.5, v.p[1] + 0.5];
}

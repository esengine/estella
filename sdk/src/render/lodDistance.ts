// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lodDistance.ts
 * @brief   A rule that says a distance, as the screen size a LODGroup is told.
 *
 * @details A LODGroup's thresholds are fractions of the screen's height, measured
 *          on the bounding sphere of the geometry it actually draws. A rule a
 *          person writes is a distance — "draw this out to 600 m" — so something
 *          turns one into the other, and it has to use the sphere the engine will
 *          measure: the half-diagonal of the box that holds every level of the
 *          group (`lod::boundingSphere` over `gatherLodLevels`).
 *
 *          A guessed radius is how a chunk comes to vanish in front of the player.
 *          A chunk of a world is as big as what stands in it: a 192 m square with
 *          one group of rocks in a corner has a sphere of a few metres, and a
 *          threshold worked out for the square's own diagonal culled it at a few
 *          percent of the distance its rule named.
 */

/** The field of view the distances are meant in. A narrower one draws further, as a zoom should. */
export const LOD_REFERENCE_FOV_DEG = 60;

const HALF_VIEW = Math.tan((LOD_REFERENCE_FOV_DEG / 2) * Math.PI / 180);

/** A box as mesh data carries it. */
export interface LodBox {
    aabbMin: readonly [number, number, number];
    aabbMax: readonly [number, number, number];
}

/**
 * The radius the engine measures a LODGroup by: the half-diagonal of the one box
 * that holds every level's geometry. Zero when no level is given.
 */
export function lodSphereRadius(levels: readonly (LodBox | null | undefined)[]): number {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (const level of levels) {
        if (!level) continue;
        any = true;
        for (let i = 0; i < 3; i++) {
            lo[i] = Math.min(lo[i]!, level.aabbMin[i]!);
            hi[i] = Math.max(hi[i]!, level.aabbMax[i]!);
        }
    }
    if (!any) return 0;
    return Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2;
}

/**
 * The share of the screen's height a sphere of `radius` covers with its centre
 * `distance` away, in the reference view: the LODGroup threshold that falls at
 * that distance. A level takes over, or the group is culled, once the sphere is
 * smaller than its threshold — that is, further than `distance`.
 */
export function lodSizeAtDistance(radius: number, distance: number): number {
    return radius / (Math.max(1, distance) * HALF_VIEW);
}

/**
 * The cull threshold that keeps a group drawn while any of its sphere is within
 * `distance`: the centre may be a radius further than the part nearest the eye.
 */
export function lodCullSizeWithin(radius: number, distance: number): number {
    return lodSizeAtDistance(radius, distance + radius);
}

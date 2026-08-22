// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bakeNavGrid.ts
 * @brief   Build a ground-plane {@link NavGrid} by asking the 3D solver what is
 *          under each cell.
 *
 * The bodies a scene already collides against ARE its walkable surface, so this
 * takes them as the source rather than a second authored description that can
 * disagree with them. One ray straight down per cell answers three questions at
 * once: whether there is ground, how high it is, and how steeply it is tilted.
 *
 * What this is NOT: it samples ONE surface per column, so a bridge and the road
 * under it collapse into whichever the ray meets first. Multi-level navigation
 * wants a real navmesh (voxelise → regions → contours), which this deliberately
 * is not — it is the whole of what a heightfield can honestly answer.
 */

import type { Vec3 } from '../../types';
import { NavGrid } from './NavGrid';

/** One downward hit: the height of the ground and how it is tilted. */
export interface GroundHit {
    /** World height of the point hit. */
    y: number;
    /** The surface normal's up component, 1 = level, 0 = a vertical wall. */
    normalY: number;
}

/**
 * What the baker needs from a solver — a ray, and what it hit. `Physics3DQueries`
 * satisfies it as it stands; a test satisfies it with a function.
 */
export interface GroundProbe {
    raycast(origin: Vec3, direction: Vec3, layerMask?: number): GroundHit | null;
}

export interface BakeNavGridOptions {
    /** The box of world to sample, in world pixels. */
    min: Vec3;
    max: Vec3;
    /** World pixels per cell (square, in the x/z plane). */
    cellSize: number;
    /**
     * Steepest ground an agent can stand on, in degrees from level. Anything
     * steeper is a wall it walks past, not a slope it walks up.
     */
    maxSlopeDegrees?: number;
    /**
     * How much room an agent needs above the ground. A cell whose ceiling is
     * lower than this is not walkable however flat its floor is — a crawlspace
     * is not a corridor. 0 skips the check (and its second ray per cell).
     */
    agentHeight?: number;
    /** Height difference between neighbours an agent can cross — see NavGrid. */
    stepHeight?: number;
    /** Physics layers the ground is on; 0 (default) = every layer. */
    layers?: number;
}

/**
 * Sample the solver into a walkable grid over the x/z plane. Every cell centre
 * gets one ray straight down: no hit is a hole, too steep a hit is a wall, too
 * low a ceiling is a crawlspace. What survives is walkable at the height the ray
 * found, which is the surface the agent then walks along.
 */
export function bakeNavGrid(probe: GroundProbe, opts: BakeNavGridOptions): NavGrid {
    const { min, max, cellSize } = opts;
    const layers = opts.layers ?? 0;
    const agentHeight = opts.agentHeight ?? 0;
    const cosMaxSlope = Math.cos(((opts.maxSlopeDegrees ?? 45) * Math.PI) / 180);
    const depth = max.y - min.y;

    const width = Math.max(1, Math.floor((max.x - min.x) / cellSize) + 1);
    const height = Math.max(1, Math.floor((max.z - min.z) / cellSize) + 1);
    const walkable = new Uint8Array(width * height);
    const surface = new Float32Array(width * height);

    for (let gy = 0; gy < height; gy++) {
        for (let gx = 0; gx < width; gx++) {
            const i = gy * width + gx;
            const x = min.x + gx * cellSize;
            const z = min.z + gy * cellSize;
            surface[i] = min.y;

            const ground = probe.raycast({ x, y: max.y, z }, { x: 0, y: -depth, z: 0 }, layers);
            if (!ground) continue;
            surface[i] = ground.y;
            // Level ground has a normal pointing straight up; the steeper it is,
            // the smaller that component, which is the cosine of the slope.
            if (ground.normalY < cosMaxSlope) continue;
            if (agentHeight > 0) {
                // From just above the floor, so the floor itself is not the ceiling.
                const from = { x, y: ground.y + CEILING_EPSILON, z };
                if (probe.raycast(from, { x: 0, y: agentHeight, z: 0 }, layers)) continue;
            }
            walkable[i] = 1;
        }
    }

    return new NavGrid({
        width, height, cellSize,
        origin: { x: min.x, y: min.y, z: min.z },
        plane: 'xz',
        walkable, surface,
        stepHeight: opts.stepHeight ?? 0,
    });
}

/** How far off the floor the headroom ray starts — enough to leave the surface
 *  it was just cast onto, small next to any agent worth the check. */
const CEILING_EPSILON = 1;

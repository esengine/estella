// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    build.ts
 * @brief   Triangles in, {@link NavMesh} out — the whole bake, in one place.
 *
 * Voxelise, filter, partition, trace, polygonise. Each stage lives in its own
 * file and is testable on its own; this is the order they go in and the one
 * place the world's units (pixels, degrees) are turned into the voxel counts
 * every stage below actually works in.
 *
 * The stages and their order are Recast's (Mikko Mononen, zlib) — this is an
 * independent TypeScript implementation of that published pipeline, not a port of
 * its source. In TypeScript rather than a second wasm module because a bake runs
 * once per volume and splitting navigation across two languages costs more than
 * it buys.
 */

import type { Vec3 } from '../../../types';
import { NavMesh, type NavLinkSegment } from '../NavMesh';
import {
    NavHeightfield, heightfieldColumns, rasterizeTriangles,
    filterLowHangingWalkableObstacles, filterLedgeSpans, filterWalkableLowHeightSpans,
} from './heightfield';
import { log } from '../../../util/logger';
import {
    NavCompactField, erodeWalkableArea, markObstacles, markAreas,
    type NavObstacleBox, type NavAreaBox,
} from './compact';
import { buildRegionsMonotone } from './regions';
import { buildContours } from './contours';
import { buildPolyMesh } from './polymesh';

export interface BuildNavMeshOptions {
    /** The box of world to bake, in world pixels. */
    min: Vec3;
    max: Vec3;
    /** Voxel size in the ground plane. The finer it is, the closer the mesh hugs
     *  the geometry and the longer the bake takes. */
    cellSize: number;
    /** Voxel size vertically. Wants to be several times smaller than `cellSize`,
     *  because it is what decides whether two floors are one. */
    cellHeight: number;
    /** Steepest ground an agent can stand on, in degrees from level. */
    maxSlopeDegrees?: number;
    /** How much room an agent needs above the floor, in world pixels. */
    agentHeight?: number;
    /** How wide the agent is. The mesh is pulled back from every wall by this, so
     *  routes over it clear the walls by construction. */
    agentRadius?: number;
    /** The tallest step an agent can walk up rather than round, in world pixels. */
    stepHeight?: number;
    /** How far, in world pixels, a simplified outline may stray from the raw one. */
    maxSimplificationError?: number;
    /** How long a wall edge may get before it is split, in world pixels. 0 leaves
     *  them alone. */
    maxEdgeLength?: number;
    /** Smallest patch of unreachable ground worth a polygon, in world pixels
     *  squared. Below this a stranded ledge is left out of the mesh entirely. */
    minRegionArea?: number;
    /** Corners a polygon may have. Six is the default this is tuned around. */
    maxVertsPerPoly?: number;
    /** Boxes that block without being geometry — see `NavObstacle`. */
    obstacles?: readonly NavObstacleBox[];
    /** Ways between places the ground does not join — see `NavLink`. */
    links?: readonly NavLinkSegment[];
    /** Boxes of ground that cost more or less to cross — see `NavArea`. */
    areas?: readonly NavAreaBox[];
}

export function buildNavMesh(
    verts: Float32Array, indices: ArrayLike<number>, opts: BuildNavMeshOptions,
): NavMesh {
    const cs = opts.cellSize;
    const ch = opts.cellHeight;
    const agentRadius = opts.agentRadius ?? 0;

    const slopeCos = Math.cos(((opts.maxSlopeDegrees ?? 45) * Math.PI) / 180);
    // A span has to be at least one voxel tall to exist at all, so an agent with
    // no stated height still asks for the one voxel of headroom.
    const walkableHeight = Math.max(1, Math.ceil((opts.agentHeight ?? 0) / ch));
    const walkableClimb = Math.floor((opts.stepHeight ?? 0) / ch);
    const walkableRadius = Math.ceil(agentRadius / cs);
    const maxError = (opts.maxSimplificationError ?? cs * 1.3) / cs;
    const maxEdgeLen = Math.floor((opts.maxEdgeLength ?? cs * 12) / cs);
    const minRegionArea = Math.max(1, Math.round((opts.minRegionArea ?? (cs * 8) ** 2) / (cs * cs)));

    const size = heightfieldColumns(opts.min, opts.max, cs);
    if (size.width * size.depth > MAX_COLUMNS) {
        log.warn('nav', `a navigation volume ${size.width}x${size.depth} cells across is too`
            + ` big to voxelise — raise cellSize (now ${cs}) or shrink the volume`);
        return emptyMesh(agentRadius, cs);
    }

    const hf = new NavHeightfield(opts.min, opts.max, cs, ch);
    rasterizeTriangles(hf, verts, indices, slopeCos, walkableClimb);
    filterLowHangingWalkableObstacles(hf, walkableClimb);
    filterLedgeSpans(hf, walkableHeight, walkableClimb);
    filterWalkableLowHeightSpans(hf, walkableHeight);

    const chf = new NavCompactField(hf, walkableHeight, walkableClimb);
    if (opts.obstacles?.length) markObstacles(chf, opts.obstacles);
    // An obstacle takes ground away and an area only prices it, so this one does
    // not erode anything and only ever writes over ground that is already walkable.
    if (opts.areas?.length) markAreas(chf, opts.areas);
    erodeWalkableArea(chf, walkableRadius);
    buildRegionsMonotone(chf, minRegionArea);

    const contours = buildContours(chf, maxError, maxEdgeLen);
    const mesh = buildPolyMesh(contours, opts.maxVertsPerPoly ?? 6);

    const world = new Float32Array(mesh.vertCount * 3);
    for (let i = 0; i < mesh.vertCount; i++) {
        world[i * 3] = opts.min.x + mesh.verts[i * 3]! * cs;
        world[i * 3 + 1] = opts.min.y + mesh.verts[i * 3 + 1]! * ch;
        world[i * 3 + 2] = opts.min.z + mesh.verts[i * 3 + 2]! * cs;
    }

    const built = new NavMesh({
        verts: world,
        polys: mesh.polys,
        neis: mesh.neis,
        polyCount: mesh.polyCount,
        maxVertsPerPoly: mesh.maxVertsPerPoly,
        areas: mesh.areas,
        agentRadius,
        // A point is only ever off the mesh by what the bake took away: the
        // erosion, plus the cell the voxel grid rounded it into.
        snapDistance: agentRadius + cs,
        // A floor within an agent's own height and one step of it is one it could
        // be standing on; anything further is a different storey.
        verticalReach: Math.max((opts.agentHeight ?? 0) + (opts.stepHeight ?? 0), ch * 4),
    });
    if (opts.links?.length) built.connect(opts.links);
    return built;
}

/**
 * How many voxel columns one bake may cover. Past this it is minutes of work and
 * a heap the size of the level: a volume this big wants a coarser `cellSize`,
 * and saying so beats a frozen editor and no explanation.
 */
const MAX_COLUMNS = 1_000_000;

function emptyMesh(agentRadius: number, cellSize: number): NavMesh {
    return new NavMesh({
        verts: new Float32Array(0),
        polys: new Int32Array(0),
        neis: new Int32Array(0),
        polyCount: 0,
        maxVertsPerPoly: 6,
        areas: new Uint8Array(0),
        agentRadius,
        snapDistance: agentRadius + cellSize,
        verticalReach: 0,
    });
}

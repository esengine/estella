// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavSurface.ts
 * @brief   What "somewhere an agent can walk" means to everything that uses one.
 *
 * There are two honest representations of a navigable world and they do not
 * overlap. A uniform GRID is what a tilemap already is — authored cell by cell,
 * editable a cell at a time while the game runs, and exactly as accurate as the
 * tiles it came from. A polygon MESH is what arbitrary geometry reduces to —
 * it follows sloped and multi-level ground, which no single grid can, and its
 * cost is that it is baked rather than poked.
 *
 * Everything above them asks the same three questions, so they meet here and not
 * in each consumer: the agent driver, the resource games query, the running
 * overlay and the editor viewport all speak to a `NavSurface` and never learn
 * which kind they were handed.
 */

import type { Vec3 } from '../../types';

/** A world point a caller may name in two axes — a flat scene has no third. */
export interface NavPoint {
    x: number;
    y: number;
    z?: number;
}

export interface NavQueryOptions {
    /**
     * How wide the body being routed is, in world pixels. A path planned for a
     * point is a path only the centre of an agent fits through. 0 (the default)
     * plans for a point.
     */
    radius?: number;
}

/**
 * Where a surface hands out its shape, for a drawer to turn into lines. A
 * visitor rather than a returned array because the caller is a per-frame overlay
 * over thousands of faces: the corner array a `face` call is given belongs to
 * the surface and is only valid until that call returns.
 */
export interface NavSurfaceSink {
    /** One walkable face — a closed convex polygon, in world space. */
    face(corners: readonly Vec3[]): void;
    /** An edge the walkable world STOPS at: a wall, a ledge, a drop. */
    border(a: Vec3, b: Vec3): void;
    /** A way between two places the ground does not join — see `NavLink`. A
     *  surface with no such thing simply never calls it. */
    link(a: Vec3, b: Vec3): void;
}

/** The active navigable world, however it was built. */
export interface NavSurface {
    /**
     * Which way is OFF the ground here — the direction anything drawn ON this
     * surface is lifted along so it does not fight the floor for pixels. A flat
     * grid's is +Z, toward the viewer of a scene laid out in x/y; a spatial
     * mesh's is +Y, out of the ground it follows.
     */
    readonly up: Vec3;

    /**
     * Plan a world-space route between two world points, or null when there is
     * no way. The waypoints carry all three axes: on a flat surface the third is
     * the plane the scene is drawn on, on a spatial one it is the ground the
     * route walks over.
     */
    findWorldPath(from: NavPoint, to: NavPoint, opts?: NavQueryOptions): Vec3[] | null;

    /** Hand the shape of the walkable world to a drawer. */
    describe(sink: NavSurfaceSink): void;
}

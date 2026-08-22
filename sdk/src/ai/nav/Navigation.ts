// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Navigation.ts
 * @brief   `Nav` resource — holds the active NavGrid and world-space pathfinding.
 *
 * Published by NavPlugin; game code reads it as `Res(Nav)` (or
 * `app.getResource(Nav)`) to swap the grid or query a path directly.
 */

import { defineResource } from '../../ecs/resource';
import type { Vec3 } from '../../types';
import { NavGrid } from './NavGrid';
import { findPath, pathToWorld, type PathfindOptions } from './pathfind';

export class Navigation {
    /** The active navigation grid, or null until one is built and installed. */
    grid: NavGrid | null = null;

    setGrid(grid: NavGrid | null): void {
        this.grid = grid;
    }

    hasGrid(): boolean {
        return this.grid !== null;
    }

    /**
     * Plan a world-space path (cell-centre waypoints) between two world points,
     * or null if there is no grid or no route. `radius` is the body being
     * routed, in world units: a path planned for a point is a path only the
     * centre of an agent fits through.
     *
     * The waypoints carry all three axes: on a flat grid the third is the plane
     * the scene is drawn on, and on a spatial one it is the height of the ground
     * the route walks over.
     */
    findWorldPath(
        from: { x: number; y: number; z?: number },
        to: { x: number; y: number; z?: number },
        opts?: PathfindOptions & { radius?: number },
    ): Vec3[] | null {
        const grid = this.grid;
        if (!grid) return null;
        const start = grid.worldToCell(from);
        const goal = grid.worldToCell(to);
        const radius = opts?.radius ?? 0;
        const clearance = opts?.clearance ?? (radius > 0 ? Math.ceil(radius / grid.cellSize) : 0);
        const cells = findPath(grid, start, goal, { ...opts, clearance });
        return cells ? pathToWorld(grid, cells) : null;
    }
}

export const Nav = defineResource<Navigation>(null!, 'Nav');

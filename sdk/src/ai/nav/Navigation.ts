// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Navigation.ts
 * @brief   `Nav` resource — holds the active NavGrid and world-space pathfinding.
 *
 * Published by NavPlugin; game code reads it as `Res(Nav)` (or
 * `app.getResource(Nav)`) to swap the grid or query a path directly.
 */

import { defineResource } from '../../resource';
import type { Vec2 } from '../../types';
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
     * Plan a world-space path (cell-center waypoints) between two world points,
     * or null if there is no grid or no route.
     */
    findWorldPath(from: Vec2, to: Vec2, opts?: PathfindOptions): Vec2[] | null {
        const grid = this.grid;
        if (!grid) return null;
        const start = grid.worldToCell(from.x, from.y);
        const goal = grid.worldToCell(to.x, to.y);
        const cells = findPath(grid, start, goal, opts);
        return cells ? pathToWorld(grid, cells) : null;
    }
}

export const Nav = defineResource<Navigation>(null!, 'Nav');

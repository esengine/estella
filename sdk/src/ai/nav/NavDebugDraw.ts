// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavDebugDraw.ts
 * @brief   The navigation grid, drawn by the running game.
 *
 * The volume's gizmo answers "is this box where I meant" while a scene is
 * authored. This answers what only the bake can: which cells came back walkable,
 * how high the ground under each one is, and where the step limit cut the grid in
 * two. Without it, `cellSize`, `maxSlopeDegrees` and `agentHeight` are tuned by
 * watching whether an agent happens to move.
 *
 * Drawn from the grid the search READS, so the picture cannot disagree with the
 * routes — the same seam the volume gizmo takes from the bake.
 */
import type { App } from '../../app/app';
import type { Color, Vec3 } from '../../types';
import { Draw } from '../../render/draw';
import { defineResource } from '../../ecs/resource';
import { registerDrawCallback } from '../../render/customDraw';
import { Nav, type Navigation } from './Navigation';
import type { NavGrid } from './NavGrid';

export interface NavDebugDrawConfig {
    enabled: boolean;
    /** Outline each walkable cell. */
    showCells: boolean;
    /** Mark the pairs the step limit refuses, which is where a route stops. */
    showLedges: boolean;
}

/** Off until a game turns it on: a grid is thousands of cells and each is a quad. */
export const NavDebugDraw = defineResource<NavDebugDrawConfig>({
    enabled: false,
    showCells: true,
    showLedges: true,
}, 'NavDebugDraw');

const WALKABLE: Color = { r: 0.3, g: 0.9, b: 0.5, a: 0.55 };
const LEDGE: Color = { r: 1.0, g: 0.35, b: 0.3, a: 0.9 };
/** World units, at 100 to the metre — thin enough to read a grid through. */
const LINE_THICKNESS = 1.5;
/**
 * Cells drawn per frame. A grid is unbounded in principle and every cell costs
 * four lines: past this the overlay is what the frame is spending its time on,
 * and an overlay that stops the game is not a diagnostic. Cells past it are
 * simply not drawn — `cellSize` is the knob for seeing more of a big world.
 */
const MAX_CELLS = 4096;

/** The four corners of a cell, lifted just off its own ground so the lines are
 *  not z-fighting the floor they describe. */
function cellQuad(grid: NavGrid, gx: number, gy: number, lift: number): Vec3[] {
    const c = grid.cellToWorld(gx, gy);
    const h = grid.cellSize / 2;
    const y = c.y + lift;
    return grid.plane === 'xy'
        ? [{ x: c.x - h, y: c.y - h, z: c.z }, { x: c.x + h, y: c.y - h, z: c.z },
           { x: c.x + h, y: c.y + h, z: c.z }, { x: c.x - h, y: c.y + h, z: c.z }]
        : [{ x: c.x - h, y, z: c.z - h }, { x: c.x + h, y, z: c.z - h },
           { x: c.x + h, y, z: c.z + h }, { x: c.x - h, y, z: c.z + h }];
}

/** Draw one frame of the overlay. Exported for the unit test, which counts what
 *  it asked to be drawn rather than looking at pixels. */
export function drawNavDebug(grid: NavGrid | null, cfg: NavDebugDrawConfig): void {
    if (!grid || !cfg.enabled) return;
    const lift = grid.plane === 'xy' ? 0 : 1;
    let drawn = 0;

    if (cfg.showCells) {
        for (let gy = 0; gy < grid.height && drawn < MAX_CELLS; gy++) {
            for (let gx = 0; gx < grid.width && drawn < MAX_CELLS; gx++) {
                if (!grid.isWalkable(gx, gy)) continue;
                const q = cellQuad(grid, gx, gy, lift);
                for (let i = 0; i < 4; i++) {
                    Draw.line3D(q[i], q[(i + 1) % 4], WALKABLE, LINE_THICKNESS);
                }
                drawn++;
            }
        }
    }

    if (!cfg.showLedges) return;
    // Where two walkable cells are NOT connected: the step limit's own answer, and
    // the only thing that explains a route going the long way round.
    for (let gy = 0; gy < grid.height; gy++) {
        for (let gx = 0; gx < grid.width; gx++) {
            if (!grid.isWalkable(gx, gy)) continue;
            for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
                const nx = gx + dx;
                const ny = gy + dy;
                if (!grid.isWalkable(nx, ny) || grid.canStep(gx, gy, nx, ny)) continue;
                const a = cellQuad(grid, gx, gy, lift);
                const b = cellQuad(grid, nx, ny, lift);
                // The shared edge, drawn at both heights: a ledge IS the drop.
                Draw.line3D(a[dx === 1 ? 1 : 3], a[2], LEDGE, LINE_THICKNESS);
                Draw.line3D(b[dx === 1 ? 0 : 0], b[dx === 1 ? 3 : 1], LEDGE, LINE_THICKNESS);
            }
        }
    }
}

/** Install the overlay. Off until a game turns the resource on. */
export function setupNavDebugDraw(app: App): void {
    app.insertResource(NavDebugDraw, { enabled: false, showCells: true, showLedges: true });
    registerDrawCallback('nav-debug-draw', () => {
        const cfg = app.getResource<NavDebugDrawConfig>(NavDebugDraw);
        if (!cfg?.enabled) return;
        drawNavDebug(app.getResource<Navigation>(Nav)?.grid ?? null, cfg);
    });
}

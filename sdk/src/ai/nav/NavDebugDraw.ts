// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavDebugDraw.ts
 * @brief   The navigable world, drawn by the running game.
 *
 * The volume's gizmo answers "is this box where I meant" while a scene is
 * authored. This answers what only the bake can: what came back walkable, how
 * high the ground under it is, and where the walkable world ends. Without it
 * `cellSize`, `maxSlopeDegrees` and `agentHeight` are tuned by watching whether
 * an agent happens to move.
 *
 * Drawn from the surface the search READS, so the picture cannot disagree with
 * the routes — and through {@link NavSurface.describe}, so a grid and a mesh get
 * one drawer rather than one each.
 */
import type { App } from '../../app/app';
import type { Color, Vec3 } from '../../types';
import { Draw } from '../../render/draw';
import { defineResource } from '../../ecs/resource';
import { registerDrawCallback } from '../../render/customDraw';
import { Nav, type Navigation } from './Navigation';
import type { NavSurface } from './NavSurface';

export interface NavDebugDrawConfig {
    enabled: boolean;
    /** Outline every walkable face. */
    showFaces: boolean;
    /** Mark the edges the walkable world stops at, which is where a route turns. */
    showBorders: boolean;
    /** Draw the ways between places the ground does not join. */
    showLinks: boolean;
}

/** Off until a game turns it on: a surface is thousands of faces and each is a loop. */
export const NavDebugDraw = defineResource<NavDebugDrawConfig>({
    enabled: false,
    showFaces: true,
    showBorders: true,
    showLinks: true,
}, 'NavDebugDraw');

const FACE: Color = { r: 0.3, g: 0.9, b: 0.5, a: 0.55 };
const BORDER: Color = { r: 1.0, g: 0.35, b: 0.3, a: 0.9 };
/** Its own colour: a link is the one thing here that is not ground. */
const LINK: Color = { r: 0.45, g: 0.7, b: 1.0, a: 0.95 };
/** World units, at 100 to the metre — thin enough to read a surface through. */
const LINE_THICKNESS = 1.5;
/** How far off the ground the overlay floats, so its lines do not fight the floor
 *  they describe for pixels. */
const LIFT = 1;
/**
 * Faces drawn per frame. A surface is unbounded in principle and every face costs
 * a line per edge: past this the overlay is what the frame is spending its time
 * on, and an overlay that stops the game is not a diagnostic. Faces past it are
 * simply not drawn — `cellSize` is the knob for seeing more of a big world.
 */
const MAX_FACES = 4096;

/** Draw one frame of the overlay. Exported for the unit test, which counts what
 *  it asked to be drawn rather than looking at pixels. */
export function drawNavDebug(surface: NavSurface | null, cfg: NavDebugDrawConfig): void {
    if (!surface || !cfg.enabled) return;
    const up = surface.up;
    const lx = up.x * LIFT, ly = up.y * LIFT, lz = up.z * LIFT;
    const a: Vec3 = { x: 0, y: 0, z: 0 };
    const b: Vec3 = { x: 0, y: 0, z: 0 };
    let faces = 0;

    surface.describe({
        face(corners) {
            if (!cfg.showFaces || faces >= MAX_FACES) return;
            faces++;
            for (let i = 0; i < corners.length; i++) {
                const p = corners[i]!;
                const q = corners[(i + 1) % corners.length]!;
                a.x = p.x + lx; a.y = p.y + ly; a.z = p.z + lz;
                b.x = q.x + lx; b.y = q.y + ly; b.z = q.z + lz;
                Draw.line3D(a, b, FACE, LINE_THICKNESS);
            }
        },
        border(p, q) {
            if (!cfg.showBorders) return;
            a.x = p.x + lx; a.y = p.y + ly; a.z = p.z + lz;
            b.x = q.x + lx; b.y = q.y + ly; b.z = q.z + lz;
            Draw.line3D(a, b, BORDER, LINE_THICKNESS);
        },
        link(p, q) {
            if (!cfg.showLinks) return;
            a.x = p.x + lx; a.y = p.y + ly; a.z = p.z + lz;
            b.x = q.x + lx; b.y = q.y + ly; b.z = q.z + lz;
            Draw.line3D(a, b, LINK, LINE_THICKNESS * 2);
        },
    });
}

/** Install the overlay. Off until a game turns the resource on. */
export function setupNavDebugDraw(app: App): void {
    app.insertResource(NavDebugDraw,
        { enabled: false, showFaces: true, showBorders: true, showLinks: true });
    registerDrawCallback('nav-debug-draw', () => {
        const cfg = app.getResource<NavDebugDrawConfig>(NavDebugDraw);
        if (!cfg?.enabled) return;
        drawNavDebug(app.getResource<Navigation>(Nav)?.surface ?? null, cfg);
    });
}

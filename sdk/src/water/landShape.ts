// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    landShape.ts
 * @brief   What a body of water does to the ground under it: a lake's floor cut under its outline, and an island raised inside its own.
 *
 * @details Both are terrain modifiers (terrain/source.ts): laid over the ground the terrain was made or sculpted with, never written into it,
 *          so a body moved or removed gives the ground back as it was. A lake's floor only cuts (ground already lower is left), and an
 *          island only raises (ground already higher, or sculpted up afterwards, is left), so either can sit over hand-made ground.
 */
import type { TerrainModifier } from '../terrain/source';
import { polygonSdf, type Point2 } from './shore';

/** An outline on a body's own plane and how a world (x, z) is put into that plane; `scale` turns a distance there into world units. */
export interface OutlineSpace {
    outline: readonly Point2[];
    toLocal(x: number, z: number): [number, number];
    toWorld(x: number, z: number): [number, number];
    scale: number;
}

const smoothstep = (t: number): number => {
    const c = Math.min(Math.max(t, 0), 1);
    return c * c * (3 - 2 * c);
};

/** The world square the outline covers, grown by `margin` world units. */
function boundsOf(space: OutlineSpace, margin: number): [number, number, number, number] {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of space.outline) {
        const [x, z] = space.toWorld(p.x, p.y);
        x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
    }
    return [x0 - margin, z0 - margin, x1 + margin, z1 + margin];
}

/** How far inside the outline a world point is, in world units (negative outside). */
function inside(space: OutlineSpace, x: number, z: number): number {
    const [lx, lz] = space.toLocal(x, z);
    return polygonSdf(space.outline, lx, lz) * space.scale;
}

/**
 * The floor of a lake: under its outline the ground is lowered to `depth` under its surface at `level`, the floor sloping down from the
 * shore to that depth over `ramp` world units in. Only cuts.
 */
export function lakeFloorModifier(id: string, space: OutlineSpace, level: number, depth: number, ramp: number): TerrainModifier {
    const reach = Math.max(ramp, 1e-6);
    return {
        id,
        bounds: boundsOf(space, 0),
        apply(x, z, h) {
            const d = inside(space, x, z);
            if (d <= 0) return h;
            return Math.min(h, level - depth * smoothstep(d / reach));
        },
        heights: [level - depth, level],
    };
}

/**
 * An island: inside its outline the ground is raised to `top`, and outside it eases back down to the ground over `falloff` world units.
 * Only raises.
 */
export function islandModifier(id: string, space: OutlineSpace, top: number, falloff: number): TerrainModifier {
    return {
        id,
        bounds: boundsOf(space, Math.max(falloff, 0)),
        apply(x, z, h) {
            const d = inside(space, x, z);
            if (d >= 0) return Math.max(h, top);
            if (falloff <= 0 || -d >= falloff) return h;
            const w = smoothstep(1 + d / falloff);
            return Math.max(h, h + (top - h) * w);
        },
        heights: [top, top],
    };
}

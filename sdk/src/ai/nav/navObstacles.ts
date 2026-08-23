// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    navObstacles.ts
 * @brief   The boxes a scene currently says are in the way, and a number that
 *          changes when any of them does.
 *
 * Blocking is a bake input, not a query filter: an obstacle has to take its
 * ground away before the erosion, or routes would scrape along its face. So what
 * a running game needs from this is cheap CHANGE detection — walking a handful of
 * boxes every frame to find out whether the expensive thing has to happen again.
 */

import type { Quat, Vec3 } from '../../types';
import type { World } from '../../ecs/world';
import { Transform } from '../../ecs/component';
import { q } from '../../math/quat';
import { NavObstacle, type NavObstacleData } from './NavObstacle';
import { NavLink, type NavLinkData } from './NavLink';
import { NavArea, type NavAreaData } from './NavArea';
import type { NavLinkSegment } from './NavMesh';
import type { NavGrid } from './NavGrid';
import type { NavAreaBox, NavObstacleBox } from './navmesh/compact';

export type { NavAreaBox, NavObstacleBox };

/** Every obstacle currently blocking, in world space. Disabled ones are absent,
 *  which is what makes a door opening a change of this list. */
export function collectNavObstacles(world: World): NavObstacleBox[] {
    const out: NavObstacleBox[] = [];
    for (const entity of world.getEntitiesWithComponents([NavObstacle, Transform])) {
        const obstacle = world.get(entity, NavObstacle) as NavObstacleData;
        if (obstacle.enabled === false) continue;
        const h = obstacle.halfExtents;
        if (h.x <= 0 || h.y <= 0 || h.z <= 0) continue;
        const tf = world.get(entity, Transform);
        out.push({
            center: { ...(tf.position as Vec3) },
            halfExtents: { x: h.x, y: h.y, z: h.z },
            rotation: { ...(tf.rotation as Quat) },
        });
    }
    return out;
}

/**
 * Every priced patch of ground a scene declares. Each gets an area id of its own,
 * numbered in the order they are found: a cost can then be changed without
 * rebuilding anything, because the mesh carries the ID and not the price.
 */
export function collectNavAreas(world: World): Array<NavAreaBox & { cost: number }> {
    const out: Array<NavAreaBox & { cost: number }> = [];
    for (const entity of world.getEntitiesWithComponents([NavArea, Transform])) {
        const area = world.get(entity, NavArea) as NavAreaData;
        if (area.enabled === false) continue;
        const h = area.halfExtents;
        if (h.x <= 0 || h.y <= 0 || h.z <= 0) continue;
        // Area 0 is unwalkable and 1 is open ground; a byte is what a span carries,
        // so a scene may price 254 patches and no more.
        const id = FIRST_AREA + out.length;
        if (id > 255) break;
        const tf = world.get(entity, Transform);
        out.push({
            center: { ...(tf.position as Vec3) },
            halfExtents: { x: h.x, y: h.y, z: h.z },
            rotation: { ...(tf.rotation as Quat) },
            area: id,
            cost: area.cost > 0 ? area.cost : 1,
        });
    }
    return out;
}

/** The first area id a scene may use. 0 is unwalkable, 1 is open ground. */
export const FIRST_AREA = 2;

/** A number that differs whenever the priced patches move, resize or appear. The
 *  COST is left out: changing one costs a lookup, and moving one costs a bake. */
export function navAreaDigest(areas: ReadonlyArray<NavAreaBox>): number {
    let hash = 2166136261;
    const mix = (v: number): void => {
        hash = Math.imul(hash ^ (Math.round(v * 10) | 0), 16777619);
    };
    for (const box of areas) {
        mix(box.center.x); mix(box.center.y); mix(box.center.z);
        mix(box.halfExtents.x); mix(box.halfExtents.y); mix(box.halfExtents.z);
        mix(box.rotation.x * 1000); mix(box.rotation.y * 1000);
        mix(box.rotation.z * 1000); mix(box.rotation.w * 1000);
        mix(box.area);
    }
    return hash;
}

/** Price the cells a patch covers. A grid charges by the cell, as it blocks. */
export function applyAreasToGrid(
    grid: NavGrid, areas: ReadonlyArray<NavAreaBox & { cost: number }>,
): void {
    grid.clearCosts();
    const cs = grid.cellSize;
    for (const box of areas) {
        const reach = Math.abs(box.halfExtents.x) + Math.abs(box.halfExtents.y)
            + Math.abs(box.halfExtents.z);
        const inverse = { x: -box.rotation.x, y: -box.rotation.y, z: -box.rotation.z, w: box.rotation.w };
        const gx0 = Math.max(0, Math.ceil((box.center.x - reach - grid.originX) / cs));
        const gx1 = Math.min(grid.width - 1, Math.floor((box.center.x + reach - grid.originX) / cs));
        const gy0 = Math.max(0, Math.ceil((box.center.y - reach - grid.originY) / cs));
        const gy1 = Math.min(grid.height - 1, Math.floor((box.center.y + reach - grid.originY) / cs));
        for (let gy = gy0; gy <= gy1; gy++) {
            for (let gx = gx0; gx <= gx1; gx++) {
                const local = q.rotate(inverse, {
                    x: grid.originX + gx * cs - box.center.x,
                    y: grid.originY + gy * cs - box.center.y,
                    z: grid.originZ - box.center.z,
                });
                if (Math.abs(local.x) > box.halfExtents.x) continue;
                if (Math.abs(local.y) > box.halfExtents.y) continue;
                if (Math.abs(local.z) > box.halfExtents.z) continue;
                grid.setCost(gx, gy, box.cost);
            }
        }
    }
}

/** Every link a scene declares, with both ends placed in the world. */
export function collectNavLinks(world: World): NavLinkSegment[] {
    const out: NavLinkSegment[] = [];
    for (const entity of world.getEntitiesWithComponents([NavLink, Transform])) {
        const link = world.get(entity, NavLink) as NavLinkData;
        if (link.enabled === false) continue;
        const tf = world.get(entity, Transform);
        const at = tf.position as Vec3;
        const rot = tf.rotation as Quat;
        const place = (offset: Vec3): Vec3 => {
            const r = q.rotate(rot, offset);
            return { x: at.x + r.x, y: at.y + r.y, z: at.z + r.z };
        };
        out.push({
            start: place(link.start),
            end: place(link.end),
            bidirectional: link.bidirectional !== false,
            radius: Math.max(1, link.radius),
        });
    }
    return out;
}

/** A number that differs whenever the links do. Same shape as the obstacles'
 *  digest, and separate because re-joining a mesh is cheap and re-baking is not. */
export function navLinkDigest(links: readonly NavLinkSegment[]): number {
    let hash = 2166136261;
    const mix = (v: number): void => {
        hash = Math.imul(hash ^ (Math.round(v * 10) | 0), 16777619);
    };
    for (const link of links) {
        mix(link.start.x); mix(link.start.y); mix(link.start.z);
        mix(link.end.x); mix(link.end.y); mix(link.end.z);
        mix(link.radius); mix(link.bidirectional ? 1 : 0);
    }
    return hash;
}

/**
 * A number that differs whenever the obstacles do — one moved, resized, added,
 * removed or switched off. Positions are rounded to a tenth of a pixel first, so
 * a body settling under gravity does not read as a world that keeps changing.
 */
export function navObstacleDigest(obstacles: readonly NavObstacleBox[]): number {
    let hash = 2166136261;
    const mix = (v: number): void => {
        hash = Math.imul(hash ^ (Math.round(v * 10) | 0), 16777619);
    };
    for (const box of obstacles) {
        mix(box.center.x); mix(box.center.y); mix(box.center.z);
        mix(box.halfExtents.x); mix(box.halfExtents.y); mix(box.halfExtents.z);
        mix(box.rotation.x * 1000); mix(box.rotation.y * 1000);
        mix(box.rotation.z * 1000); mix(box.rotation.w * 1000);
    }
    return hash;
}

/**
 * Mark the cells an obstacle is standing on. A grid blocks by the cell, so this
 * is the whole of what an obstacle does to one — and it is re-marked from scratch
 * each time, because working out which cells a box has LEFT is the same walk.
 */
export function applyObstaclesToGrid(grid: NavGrid, obstacles: readonly NavObstacleBox[]): void {
    grid.clearObstructions();
    const cs = grid.cellSize;
    for (const box of obstacles) {
        const reach = Math.abs(box.halfExtents.x) + Math.abs(box.halfExtents.y)
            + Math.abs(box.halfExtents.z);
        const inverse = { x: -box.rotation.x, y: -box.rotation.y, z: -box.rotation.z, w: box.rotation.w };
        const gx0 = Math.max(0, Math.ceil((box.center.x - reach - grid.originX) / cs));
        const gx1 = Math.min(grid.width - 1, Math.floor((box.center.x + reach - grid.originX) / cs));
        const gy0 = Math.max(0, Math.ceil((box.center.y - reach - grid.originY) / cs));
        const gy1 = Math.min(grid.height - 1, Math.floor((box.center.y + reach - grid.originY) / cs));
        for (let gy = gy0; gy <= gy1; gy++) {
            for (let gx = gx0; gx <= gx1; gx++) {
                const local = q.rotate(inverse, {
                    x: grid.originX + gx * cs - box.center.x,
                    y: grid.originY + gy * cs - box.center.y,
                    z: grid.originZ - box.center.z,
                });
                if (Math.abs(local.x) > box.halfExtents.x) continue;
                if (Math.abs(local.y) > box.halfExtents.y) continue;
                if (Math.abs(local.z) > box.halfExtents.z) continue;
                grid.setObstructed(gx, gy, true);
            }
        }
    }
}

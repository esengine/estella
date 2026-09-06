// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cells.ts
 * @brief   What a cooked world IS, and the one function that decides which of its
 *          cells should exist right now.
 *
 * @details Separated from the streamer on purpose: residency is a decision about
 *          geometry and radii, and everything expensive — loading, spawning,
 *          releasing — is what happens AFTER it. Pure here means the union rule
 *          and the hysteresis band can be held to by a criterion that never
 *          builds a world.
 */

/** One cooked cell: an additive scene, and the ground it covers. @experimental */
export interface WorldCell {
    /** Registered scene name — what `SceneManager` is asked to bring up. */
    name: string;
    /** Where its document ships, package-relative. */
    path: string;
    /** Grid coordinate on the XZ plane. */
    x: number;
    z: number;
    /**
     * The ground it covers, world units. The grid square UNIONED with where its
     * content actually is: a cell is asked for by distance to this box, and a
     * prop hanging over the edge is part of the place the box stands for.
     */
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
    /** Authored entities inside, for a report that can be checked against the world. */
    entityCount: number;
    /** Top-level authored entities inside — each one a residency atom. */
    rootCount: number;
}

/** A cooked world: the persistent scene's cells. @experimental */
export interface WorldManifest {
    version: number;
    /** Registered name of the persistent scene these cells belong to. */
    scene: string;
    /** Edge of one grid square, world units. */
    cellSize: number;
    cells: WorldCell[];
}

/** One source's ask, as the streamer samples it. @experimental */
export interface ResidencySource {
    x: number;
    z: number;
    loadRadius: number;
    unloadRadius: number;
}

/** What residency should be, and the two moves that get there. @experimental */
export interface ResidencyDecision {
    /** Every cell that should exist after this tick, in manifest order. */
    target: string[];
    toLoad: string[];
    toUnload: string[];
}

/**
 * Ground-plane distance from a point to a cell's box; zero inside it.
 *
 * To the BOX rather than to the cell's centre, because a centre answers the same
 * for a source standing on a diagonal corner as for one a whole cell away, and
 * that is where holes open in a world laid out on a grid.
 */
export function distanceToCell(cell: WorldCell, x: number, z: number): number {
    const dx = Math.max(cell.minX - x, 0, x - cell.maxX);
    const dz = Math.max(cell.minZ - z, 0, z - cell.maxZ);
    return Math.hypot(dx, dz);
}

/**
 * Which cells should exist, given where the sources are and what is resident.
 *
 * A UNION, never a fold: a fold lets the last source win, and a second camera
 * then deletes the world the first is standing in. The band is the other half —
 * in at `loadRadius`, out past `unloadRadius`, so a boundary is not a treadmill.
 */
export function desiredResidency(
    cells: readonly WorldCell[],
    sources: readonly ResidencySource[],
    resident: ReadonlySet<string>,
): ResidencyDecision {
    const target: string[] = [];
    const toLoad: string[] = [];
    const toUnload: string[] = [];
    for (const cell of cells) {
        let wanted = false;
        let kept = false;
        for (const source of sources) {
            const distance = distanceToCell(cell, source.x, source.z);
            if (distance <= source.loadRadius) { wanted = true; break; }
            // An authored band that is not a band is not one the streamer invents:
            // the wider of the two is the only reading under which a resident cell
            // cannot be dropped by the same distance that just asked for it.
            if (distance <= Math.max(source.loadRadius, source.unloadRadius)) kept = true;
        }
        const isResident = resident.has(cell.name);
        if (wanted || (kept && isResident)) {
            target.push(cell.name);
            if (!isResident) toLoad.push(cell.name);
        } else if (isResident) {
            toUnload.push(cell.name);
        }
    }
    return { target, toLoad, toUnload };
}

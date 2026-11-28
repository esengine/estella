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
    /**
     * Where the cell's far proxy document ships, package-relative, when the cook baked one: its static meshes merged and
     * simplified, shown while the cell is not resident.
     */
    proxy?: string;
}

/** A cooked world: the persistent scene's cells. @experimental */
export interface WorldManifest {
    version: number;
    /** Registered name of the persistent scene these cells belong to. */
    scene: string;
    /** Edge of one grid square, world units. */
    cellSize: number;
    /**
     * The world plane the cells lie on: `'xz'` (the default, and what a manifest cooked before this field has) or `'xy'` for a 2D world. A cell's
     * `z` and `minZ`/`maxZ` are the SECOND axis of that plane, so on `'xy'` they are world y.
     */
    plane?: 'xz' | 'xy';
    /**
     * Authored ids in the persistent world that a cell holds a hard reference to.
     * Only these are kept resolvable — a table of every row would be a cost the
     * whole world pays for the handful of references that exist.
     */
    persistentRefs: number[];
    cells: WorldCell[];
    /** How far from a source a cell that is not resident shows its far proxy. Absent when the world has none. */
    farDistance?: number;
}

/** One source's ask, as the streamer samples it. @experimental */
export interface ResidencySource {
    x: number;
    z: number;
    loadRadius: number;
    unloadRadius: number;
    /** How early this source is worth preparing for. Never below `loadRadius`. */
    prefetchRadius: number;
}

/** The plane a manifest's cells lie on, a manifest cooked before the field existing as the ground. @experimental */
export function manifestPlane(manifest: { plane?: 'xz' | 'xy' } | null): 'xz' | 'xy' {
    return manifest?.plane === 'xy' ? 'xy' : 'xz';
}

/** The second coordinate of a world position on a plane: z on the ground, y on the screen. @experimental */
export function planeSecond(position: { y: number; z?: number }, plane: 'xz' | 'xy'): number {
    return plane === 'xy' ? position.y : position.z ?? 0;
}

/** What residency should be, and the moves that get there. @experimental */
export interface ResidencyDecision {
    /** Every cell that should exist after this tick, in manifest order. */
    target: string[];
    /**
     * Cells worth PREPARING: near enough that a source may soon want them. A
     * superset of the demanded ones in the ordinary case, but not by rule — a
     * cell held by hysteresis can sit past every prefetch radius.
     */
    prefetch: string[];
    /** Demanded and not resident, nearest first: what to publish. */
    toLoad: string[];
    toUnload: string[];
}

/**
 * The cell a world position falls in — the one rule, with two callers that must
 * not drift: the cook assigns every top-level root by it, and the editor draws
 * its grid from it. `z` is the position's SECOND coordinate on the plane the
 * world is cut on: world z on the ground, world y on the screen plane.
 */
export function cellAt(x: number, z: number, cellSize: number): { x: number; z: number } {
    return { x: Math.floor(x / cellSize), z: Math.floor(z / cellSize) };
}

/**
 * The grid square one cell coordinate stands for.
 *
 * NOT the same as {@link WorldCell}'s box: a cooked cell's box is this square
 * unioned with where its content actually reached, so it is usually larger. This
 * is the partition; that is the partition plus its overhang.
 */
export function cellSquare(cellX: number, cellZ: number, cellSize: number): {
    minX: number; minZ: number; maxX: number; maxZ: number;
} {
    const minX = cellX * cellSize;
    const minZ = cellZ * cellSize;
    return { minX, minZ, maxX: minX + cellSize, maxZ: minZ + cellSize };
}

/**
 * Ground-plane distance from a point to a cell's box; zero inside it.
 *
 * To the BOX rather than to the cell's centre, because a centre answers the same
 * for a source standing on a diagonal corner as for one a whole cell away, and
 * that is where holes open in a world laid out on a grid.
 */
export function distanceToCell(cell: WorldCell, x: number, z: number): number {
    return distanceOrLowerBound(cell, x, z);
}

/** Outside the limit, the larger axis gap is enough to rule out membership. */
function distanceOrLowerBound(cell: WorldCell, x: number, z: number, limit?: number): number {
    const dx = Math.max(cell.minX - x, 0, x - cell.maxX);
    const dz = Math.max(cell.minZ - z, 0, z - cell.maxZ);
    if (dx === 0) return dz;
    if (dz === 0) return dx;
    if (limit !== undefined && (dx > limit || dz > limit)) return Math.max(dx, dz);
    return Math.hypot(dx, dz);
}

interface SourceReach { x: number; z: number; reach: number }

export interface SourceBounds {
    minX: number; minZ: number; maxX: number; maxZ: number;
    /** Radius at which an idle cell can start work. Active cells are always reconciled. */
    reach: number;
    /** Multiple sources may leave gaps inside their enclosing box. */
    individual?: SourceReach[];
}

/** Conservative bounds for one reconciliation. Exact membership and ordering still use distanceToCell. */
export function sourceBounds(sources: readonly ResidencySource[]): SourceBounds {
    if (sources.length === 1) {
        const { x, z, loadRadius, prefetchRadius } = sources[0]!;
        return { minX: x, minZ: z, maxX: x, maxZ: z, reach: Math.max(loadRadius, prefetchRadius) };
    }
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, reach = -Infinity;
    const individual: SourceReach[] = [];
    for (const { x, z, loadRadius, prefetchRadius } of sources) {
        const sourceReach = Math.max(loadRadius, prefetchRadius);
        minX = Math.min(minX, x);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxZ = Math.max(maxZ, z);
        reach = Math.max(reach, sourceReach);
        individual.push({ x, z, reach: sourceReach });
    }
    return { minX, minZ, maxX, maxZ, reach, individual };
}

/** Only reject a box when even the separation on one axis exceeds every source's reach. */
export function outsideSourceReach(cell: WorldCell, bounds: SourceBounds, radius: number): boolean {
    return cell.minX - bounds.maxX > radius || bounds.minX - cell.maxX > radius ||
        cell.minZ - bounds.maxZ > radius || bounds.minZ - cell.maxZ > radius;
}

/** Refine a multi-source box. Far proxies supply the same radius for every source. */
export function withinIndividualReach(cell: WorldCell, sources: readonly SourceReach[], radius?: number): boolean {
    for (let i = 0; i < sources.length; i++) {
        const source = sources[i]!;
        const sourceReach = radius ?? source.reach;
        if (cell.minX - source.x > sourceReach || source.x - cell.maxX > sourceReach ||
            cell.minZ - source.z > sourceReach || source.z - cell.maxZ > sourceReach) continue;
        return true;
    }
    return false;
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
    const prefetch: Array<{ name: string; distance: number }> = [];
    const toUnload: string[] = [];
    /** Demanded-and-absent cells with how far the nearest source is. */
    const pending: Array<{ name: string; distance: number }> = [];
    const ranges = sources.map(source => {
        const { x, z, loadRadius } = source;
        const keep = Math.max(loadRadius, source.unloadRadius);
        const prefetch = Math.max(loadRadius, source.prefetchRadius);
        const reach = sources.length > 1 ? Math.max(keep, prefetch) : undefined;
        return { x, z, load: loadRadius, keep, prefetch, reach };
    });
    for (const cell of cells) {
        let wanted = false;
        let kept = false;
        let speculated = false;
        let nearest = Infinity;
        let outsideReach = Infinity;
        for (const source of ranges) {
            const distance = distanceOrLowerBound(cell, source.x, source.z, source.reach);
            if (source.reach !== undefined && distance > source.reach) {
                if (distance < outsideReach) outsideReach = distance;
                continue;
            }
            if (distance < nearest) nearest = distance;
            if (distance <= source.load) wanted = true;
            // An authored band that is not a band is not one the streamer invents:
            // the wider of the two is the only reading under which a resident cell
            // cannot be dropped by the same distance that just asked for it.
            else if (distance <= source.keep) kept = true;
            if (distance <= source.prefetch) speculated = true;
        }
        const isResident = resident.has(cell.name);
        // A source outside its own radius may still be closer than the one that
        // asked for the cell. Measure it when it could change the ordering.
        if (outsideReach < nearest && (speculated || (wanted && !isResident))) {
            for (const source of sources) {
                const distance = distanceToCell(cell, source.x, source.z);
                if (distance < nearest) nearest = distance;
            }
        }
        if (speculated) prefetch.push({ name: cell.name, distance: nearest });
        if (wanted || (kept && isResident)) {
            target.push(cell.name);
            if (!isResident) pending.push({ name: cell.name, distance: nearest });
        } else if (isResident) {
            toUnload.push(cell.name);
        }
    }
    // Nearest first, and stable: two cells a source is equally far from keep the
    // order the cook wrote them in rather than one the sort invented.
    pending.sort((a, b) => a.distance - b.distance);
    // The same for what is only readied: with a cap on preparations at once (`StreamingPolicy.maxLoadingCells`), the order
    // is who gets a slot, and in the cook's order the cell ahead of a player waited behind the far side of the map.
    prefetch.sort((a, b) => a.distance - b.distance);
    return { target, prefetch: prefetch.map((p) => p.name), toLoad: pending.map((p) => p.name), toUnload };
}

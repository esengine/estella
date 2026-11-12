// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    quadtree.ts
 * @brief   Which squares of ground to draw, and how finely: a CDLOD quadtree round the eye.
 *
 * @details Every node is one square drawn with the same patch of `cells` by `cells`, so a node at level L has cells 2^L times the finest.
 *          Each level has a range: a node closer to the eye than the level below's range is split into its four children, so the
 *          ground is finest where it is near and coarsens with distance, level by level. The Terrain shader moves each vertex in the
 *          outer part of its level's range onto the grid of the level above (geomorphing), so where two levels meet their edges are the
 *          same line: no crack, no skirt, and nothing pops as the eye moves.
 */

/** One square of ground to draw: its level (0 the finest), its place in that level's grid, and its extent in the terrain's space. */
export interface TerrainNode {
    level: number;
    ix: number;
    iz: number;
    x0: number;
    z0: number;
    size: number;
}

/** What the tree is cut by. */
export interface QuadtreeParams {
    /** The side of a level-0 node, in world units. */
    leafSize: number;
    /** How many levels there are: the top one's nodes are `leafSize * 2^(levels - 1)` across. */
    levels: number;
    /** The distance within which level 0 is drawn; each level's is twice the one below's. */
    range0: number;
    /** The area to draw, [minX, minZ, maxX, maxZ]; null draws the top level's nodes round the eye out to its range (an infinite ground). */
    bounds: readonly [number, number, number, number] | null;
    /** The least and most height the ground has: the vertical extent every node's box is measured with. */
    minHeight: number;
    maxHeight: number;
}

/** The range of level `level`: where its nodes end and the next level's begin. */
export function levelRange(p: Pick<QuadtreeParams, 'range0'>, level: number): number {
    return p.range0 * 2 ** level;
}

/**
 * The nodes to draw for an eye at (ex, ey, ez), coarse to fine. Every place in the area (or within the top range of the eye, for an
 * infinite ground) is covered by exactly one node.
 */
export function selectNodes(p: QuadtreeParams, ex: number, ey: number, ez: number): TerrainNode[] {
    const out: TerrainNode[] = [];
    const top = p.levels - 1;
    const topSize = p.leafSize * 2 ** top;
    let minX: number, minZ: number, maxX: number, maxZ: number;
    if (p.bounds) {
        [minX, minZ, maxX, maxZ] = p.bounds;
    } else {
        const reach = levelRange(p, top);
        minX = ex - reach; maxX = ex + reach; minZ = ez - reach; maxZ = ez + reach;
    }
    const i0 = Math.floor(minX / topSize), i1 = Math.ceil(maxX / topSize) - 1;
    const k0 = Math.floor(minZ / topSize), k1 = Math.ceil(maxZ / topSize) - 1;
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) visit(p, top, i, k, ex, ey, ez, out);
    return out;
}

function visit(p: QuadtreeParams, level: number, ix: number, iz: number, ex: number, ey: number, ez: number, out: TerrainNode[]): void {
    const size = p.leafSize * 2 ** level;
    const x0 = ix * size, z0 = iz * size;
    if (p.bounds && (x0 >= p.bounds[2] || z0 >= p.bounds[3] || x0 + size <= p.bounds[0] || z0 + size <= p.bounds[1])) return;
    if (level === 0 || boxDistance(x0, z0, size, p.minHeight, p.maxHeight, ex, ey, ez) > levelRange(p, level - 1)) {
        out.push({ level, ix, iz, x0, z0, size });
        return;
    }
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) visit(p, level - 1, ix * 2 + dx, iz * 2 + dz, ex, ey, ez, out);
}

/** How far the eye is from a node's box (its square, from the least to the most height). */
export function boxDistance(x0: number, z0: number, size: number, y0: number, y1: number, ex: number, ey: number, ez: number): number {
    const dx = Math.max(x0 - ex, 0, ex - (x0 + size));
    const dz = Math.max(z0 - ez, 0, ez - (z0 + size));
    const dy = Math.max(y0 - ey, 0, ey - y1);
    return Math.hypot(dx, dy, dz);
}

/** The node one level up that holds this one. */
export function parentOf(n: TerrainNode, leafSize: number): TerrainNode {
    const level = n.level + 1, size = leafSize * 2 ** level;
    const ix = Math.floor(n.ix / 2), iz = Math.floor(n.iz / 2);
    return { level, ix, iz, x0: ix * size, z0: iz * size, size };
}

/** A node's key, for the pages and the pool. */
export function nodeKey(level: number, ix: number, iz: number): string {
    return `${level}:${ix}:${iz}`;
}

/** How much a fit that is over its budget gives up at a time, and how far under the budget the next step up has to be before it is taken back. */
const FIT_STEP = 0.9;
const FIT_ROOM = 0.85;

/**
 * The share of its `range0` a tree (`tree(share)`) can keep and still draw the eye's ground in `most` nodes: a node is a page, and a tree
 * that wants more pages than the atlas holds is drawn in part by coarser pages, which do not meet their finer neighbours' edges (cracks).
 * `held` is the share the frame before settled on: given up a step at a time while the nodes are too many, taken back a step only with
 * room to spare, so an eye moving along the edge of the budget does not change the ground every frame.
 */
export function fitRange(tree: (share: number) => QuadtreeParams, ex: number, ey: number, ez: number, most: number, held = 1): { share: number; nodes: TerrainNode[] } {
    let share = Math.min(Math.max(held, 0.01), 1);
    let nodes = selectNodes(tree(share), ex, ey, ez);
    while (nodes.length > most && share > 0.01) {
        share *= FIT_STEP;
        nodes = selectNodes(tree(share), ex, ey, ez);
    }
    if (share < 1 && nodes.length <= most) {
        const up = Math.min(share / FIT_STEP, 1);
        const more = selectNodes(tree(up), ex, ey, ez);
        if (more.length <= most * FIT_ROOM) return { share: up, nodes: more };
    }
    return { share, nodes };
}

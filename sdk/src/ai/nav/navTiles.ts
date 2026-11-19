// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    navTiles.ts
 * @brief   Navigation over a streamed world: one tile per grid square, baked from what is there, stitched into one mesh.
 *
 * @details A tile is baked over its square with a border thrown away after erosion (`BuildNavMeshOptions.border`), so its
 *          polygons stop exactly on the square's edges, where its neighbours' begin. Their vertices do not line up there - each
 *          side simplified its own outline - so stitching splits every edge on a shared border wherever the other side has a
 *          vertex, and joins the pieces that face each other at a height an agent can step between. Pieces that face the same
 *          polygon are joined back into one, so a doorway across a seam is one portal.
 */

import { NavMesh } from './NavMesh';
import { buildNavMesh, type BuildNavMeshOptions } from './navmesh/build';
import type { Vec3 } from '../../types';

/** A grid square of the world, in the ground plane. */
export interface NavSquare {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
}

/** Triangles for a box, as `collectNavGeometry` answers. */
export type NavTileGeometry = (min: Vec3, max: Vec3) => { verts: Float32Array; indices: ArrayLike<number> };

/**
 * Bake the tile over `square`, between heights `minY` and `maxY`. The voxel size is nudged so the square is a whole number of
 * voxels, and the field reaches a border past it on every side that is eroded with the rest and then thrown away: the tile's
 * polygons end on the square's edges, and a wall just past an edge still keeps an agent off it.
 */
export function bakeNavTile(
    square: NavSquare, minY: number, maxY: number, geometry: NavTileGeometry,
    options: Omit<BuildNavMeshOptions, 'min' | 'max' | 'border'>,
): NavTile {
    const side = Math.max(square.maxX - square.minX, square.maxZ - square.minZ);
    const cellSize = side / Math.max(1, Math.round(side / options.cellSize));
    const border = Math.ceil((options.agentRadius ?? 0) / cellSize) + 3;
    const pad = border * cellSize;
    const min = { x: square.minX - pad, y: minY, z: square.minZ - pad };
    const max = { x: square.maxX + pad, y: maxY, z: square.maxZ + pad };
    const geo = geometry(min, max);
    const mesh = buildNavMesh(geo.verts, geo.indices, { ...options, cellSize, min, max, border });
    return { mesh, ...square };
}

/** One baked tile and the square it covers. */
export interface NavTile {
    mesh: NavMesh;
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
}

/** A polygon edge lying on a tile's border, waiting to be joined across it. */
interface BorderEdge {
    poly: number;
    /** 'x' when the edge runs along a line of constant x (so its span is in z), 'z' for constant z. */
    axis: 'x' | 'z';
    line: number;
    /** Along the line: where the edge starts and ends, in the polygon's own winding. */
    s0: number;
    s1: number;
    y0: number;
    y1: number;
    tile: number;
}

const EPS = 1e-3;

/** The height of `e` at `s` along its line. */
function heightAt(e: BorderEdge, s: number): number {
    const t = e.s1 === e.s0 ? 0 : (s - e.s0) / (e.s1 - e.s0);
    return e.y0 + (e.y1 - e.y0) * t;
}

/**
 * One mesh from `tiles`, joined across their shared borders. `climb` is how far apart in height two edges may be and still be
 * one way through: an agent's step.
 */
export function stitchNavTiles(tiles: readonly NavTile[], climb: number): NavMesh {
    const verts: number[] = [];
    const polys: number[][] = [];
    const neis: number[][] = [];
    const areas: number[] = [];
    const owner: number[] = [];
    let agentRadius = 0, snapDistance = 0, verticalReach = 0;

    for (const [t, tile] of tiles.entries()) {
        const m = tile.mesh;
        const vertexBase = verts.length / 3;
        const polyBase = polys.length;
        for (let i = 0; i < m.verts.length; i++) verts.push(m.verts[i]!);
        for (let p = 0; p < m.polyCount; p++) {
            const n = m.vertexCount(p);
            const ring: number[] = [], next: number[] = [];
            for (let i = 0; i < n; i++) {
                ring.push(m.polys[p * m.maxVertsPerPoly + i]! + vertexBase);
                const nei = m.neis[p * m.maxVertsPerPoly + i]!;
                next.push(nei >= 0 ? nei + polyBase : -1);
            }
            polys.push(ring);
            neis.push(next);
            areas.push(m.areas[p]!);
            owner.push(t);
        }
        agentRadius = m.agentRadius;
        snapDistance = Math.max(snapDistance, m.snapDistance);
        verticalReach = Math.max(verticalReach, m.verticalReach);
    }

    // Every open edge lying on its tile's border, grouped by the line it lies on.
    const lines = new Map<string, BorderEdge[]>();
    const x = (v: number) => verts[v * 3]!, y = (v: number) => verts[v * 3 + 1]!, z = (v: number) => verts[v * 3 + 2]!;
    for (let p = 0; p < polys.length; p++) {
        const ring = polys[p]!, tile = tiles[owner[p]!]!;
        for (let i = 0; i < ring.length; i++) {
            if (neis[p]![i] !== -1) continue;
            const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
            let edge: BorderEdge | null = null;
            for (const line of [tile.minX, tile.maxX]) {
                if (Math.abs(x(a) - line) < EPS && Math.abs(x(b) - line) < EPS) {
                    edge = { poly: p, axis: 'x', line, s0: z(a), s1: z(b), y0: y(a), y1: y(b), tile: owner[p]! };
                }
            }
            for (const line of [tile.minZ, tile.maxZ]) {
                if (Math.abs(z(a) - line) < EPS && Math.abs(z(b) - line) < EPS) {
                    edge = { poly: p, axis: 'z', line, s0: x(a), s1: x(b), y0: y(a), y1: y(b), tile: owner[p]! };
                }
            }
            if (!edge) continue;
            const key = `${edge.axis}:${Math.round(edge.line * 1000)}`;
            let group = lines.get(key);
            if (!group) lines.set(key, group = []);
            group.push(edge);
            (edge as BorderEdge & { index: number }).index = i;
        }
    }

    // For each border edge, the pieces it splits into and what each faces.
    const splits = new Map<number, Map<number, Array<{ s: number; y: number; nei: number }>>>();
    for (const group of lines.values()) {
        for (const e of group) {
            const lo = Math.min(e.s0, e.s1), hi = Math.max(e.s0, e.s1);
            const facing = group.filter((f) => f.tile !== e.tile
                && Math.min(hi, Math.max(f.s0, f.s1)) - Math.max(lo, Math.min(f.s0, f.s1)) > EPS);
            if (facing.length === 0) continue;
            // Breakpoints: the other side's ends that fall inside this edge, walked in this edge's own direction.
            const cuts = new Set<number>([e.s0, e.s1]);
            for (const f of facing) for (const s of [f.s0, f.s1]) if (s > lo + EPS && s < hi - EPS) cuts.add(s);
            const ordered = [...cuts].sort((a, b) => (e.s1 >= e.s0 ? a - b : b - a));
            const pieces: Array<{ s: number; y: number; nei: number }> = [];
            for (let k = 0; k + 1 < ordered.length; k++) {
                const mid = (ordered[k]! + ordered[k + 1]!) / 2;
                const across = facing.find((f) => mid > Math.min(f.s0, f.s1) - EPS && mid < Math.max(f.s0, f.s1) + EPS
                    && Math.abs(heightAt(f, mid) - heightAt(e, mid)) <= climb);
                const nei = across ? across.poly : -1;
                // A piece facing what the previous one faced is the same portal, kept whole.
                if (pieces.length > 0 && pieces[pieces.length - 1]!.nei === nei) continue;
                pieces.push({ s: ordered[k]!, y: heightAt(e, ordered[k]!), nei });
            }
            let byEdge = splits.get(e.poly);
            if (!byEdge) splits.set(e.poly, byEdge = new Map());
            byEdge.set((e as BorderEdge & { index: number }).index, pieces);
            (e as BorderEdge & { pieces?: typeof pieces }).pieces = pieces;
        }
    }

    // Rebuild each split polygon: a border edge becomes its pieces, a new vertex where each piece after the first begins.
    for (const [p, byEdge] of splits) {
        const ring = polys[p]!, next = neis[p]!;
        const outRing: number[] = [], outNext: number[] = [];
        for (let i = 0; i < ring.length; i++) {
            const pieces = byEdge.get(i);
            outRing.push(ring[i]!);
            if (!pieces) { outNext.push(next[i]!); continue; }
            const a = ring[i]!;
            const axisX = Math.abs(x(a) - x(ring[(i + 1) % ring.length]!)) < EPS;
            for (const [k, piece] of pieces.entries()) {
                if (k > 0) {
                    const v = verts.length / 3;
                    if (axisX) verts.push(x(a), piece.y, piece.s); else verts.push(piece.s, piece.y, z(a));
                    outRing.push(v);
                }
                outNext.push(piece.nei);
            }
        }
        polys[p] = outRing;
        neis[p] = outNext;
    }

    const maxVertsPerPoly = polys.reduce((m, ring) => Math.max(m, ring.length), 3);
    const polyData = new Int32Array(polys.length * maxVertsPerPoly).fill(-1);
    const neiData = new Int32Array(polys.length * maxVertsPerPoly).fill(-1);
    for (let p = 0; p < polys.length; p++) {
        polyData.set(polys[p]!, p * maxVertsPerPoly);
        neiData.set(neis[p]!, p * maxVertsPerPoly);
    }
    return new NavMesh({
        verts: Float32Array.from(verts), polys: polyData, neis: neiData, polyCount: polys.length, maxVertsPerPoly,
        areas: Uint8Array.from(areas), agentRadius, snapDistance, verticalReach,
    });
}

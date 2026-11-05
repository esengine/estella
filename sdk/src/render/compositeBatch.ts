// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    compositeBatch.ts
 * @brief   A model built from many parts, drawn in a few draws, that still moves as a whole.
 *
 * @details A static batch bakes each part's WORLD transform into its vertices, so a merged
 *          mesh is nailed to where the parts stood: a ship, a train or a moving platform
 *          assembled from planks, rails and props cannot use it. A composite batch bakes
 *          each part relative to the composite's ROOT instead, and draws the result from an
 *          entity parented to that root. Moving the root moves every draw with no work per
 *          part; the parts themselves are never touched again.
 *
 *          Two ways to fold a part, chosen per mesh:
 *            - a mesh repeated `instanceMin` times or more (deck planks, rail posts) stays one
 *              resident mesh and is drawn as the placements of one `MeshInstances` set, which
 *              holds a copy of nothing;
 *            - every other part is merged, by draw state, into chunks: cells of the root's own
 *              space, so adding or removing a part re-merges the one chunk it is in.
 *
 *          This module is the arithmetic and the plan; compositeBatchPlugin.ts is the world.
 */
import { planStaticBatches, worldMatrix, type StaticBatchCandidate } from './staticBatch';

/** A 4x4 column-major matrix, as {@link worldMatrix} makes one (doubles, so a deep chain does not drift). */
export type Mat4 = Float64Array;

export interface TRS {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    scale: { x: number; y: number; z: number };
}

/** `a * b`, column-major. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
    const out = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
        }
    }
    return out;
}

/**
 * Where a part stands in its root's space: the product of the LOCAL transforms on the way down
 * from the root to it, root excluded. Read from local transforms rather than from world ones, so
 * the answer does not depend on whether the root has moved this frame and its world matrices
 * have been brought up to date yet.
 */
export function rootLocalMatrix(chain: readonly TRS[]): Mat4 {
    let m = worldMatrix({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 1, z: 1 });
    for (const t of chain) m = multiply(m, worldMatrix(t.position, t.rotation, t.scale));
    return m;
}

/** Whether two placements are the same within a rounding a float transform picks up from a read-back. */
export function sameMatrix(a: Mat4, b: Mat4, eps = 1e-5): boolean {
    for (let i = 0; i < 16; i++) if (Math.abs(a[i]! - b[i]!) > eps * Math.max(1, Math.abs(a[i]!))) return false;
    return true;
}

/** Floats a placement takes in the engine's `MeshInstances`: three rows of the model matrix (translation in .w), then a tint. */
export const COMPOSITE_PLACEMENT_FLOATS = 16;

/** The placements of a `MeshInstances` set, one per matrix, untinted. */
export function placementsOf(matrices: readonly Mat4[]): Float32Array {
    const out = new Float32Array(matrices.length * COMPOSITE_PLACEMENT_FLOATS);
    matrices.forEach((m, n) => {
        const at = n * COMPOSITE_PLACEMENT_FLOATS;
        for (let row = 0; row < 3; row++) {
            out[at + row * 4] = m[row]!;
            out[at + row * 4 + 1] = m[4 + row]!;
            out[at + row * 4 + 2] = m[8 + row]!;
            out[at + row * 4 + 3] = m[12 + row]!;
        }
        out[at + 12] = out[at + 13] = out[at + 14] = out[at + 15] = 1;
    });
    return out;
}

/** One part, as the planner sees it: its draw state, its mesh and where it stands in the root's space. */
export interface CompositePart {
    entity: number;
    /** Draw state plus vertex layout (`staticBatchKey`): parts that may share a draw. */
    key: string;
    /** The mesh handle: parts that may share an instanced set share this AND the key. */
    mesh: number;
    local: Mat4;
    vertices: number;
    /** Centre of its mesh's bounds in the root's space: the cell it is merged in. */
    center: readonly [number, number, number];
}

export interface CompositeLimits {
    /** Parts of one mesh at or past which they are drawn as one instanced set instead of merged. */
    instanceMin: number;
    /** Side of a merge chunk in the root's space; 0 = chosen from the composite's size. */
    cellSize: number;
    /** Vertices a merged chunk may hold before it is split. */
    maxVertices: number;
}

export const COMPOSITE_DEFAULTS: CompositeLimits = { instanceMin: 4, cellSize: 0, maxVertices: 262144 };

/** Parts of one mesh and draw state, drawn as the placements of one set. */
export interface CompositeInstanceSet {
    key: string;
    mesh: number;
    entities: number[];
}

/** Parts merged into one mesh. `id` is stable while the chunk's members are the same, which is what lets an edit re-merge only its chunk. */
export interface CompositeChunk {
    id: string;
    key: string;
    entities: number[];
}

export interface CompositePlan {
    sets: CompositeInstanceSet[];
    chunks: CompositeChunk[];
    /** Parts nothing would draw with: they keep drawing themselves. */
    alone: number[];
    cellSize: number;
}

/**
 * The side of a chunk when the author left it to the planner: a quarter of the composite's
 * longest side, so a ship is a handful of chunks and an edit re-merges a fraction of it.
 */
export function autoCellSize(parts: readonly CompositePart[]): number {
    if (parts.length === 0) return 1;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of parts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p.center[k]!); max[k] = Math.max(max[k]!, p.center[k]!); }
    const longest = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
    return longest > 0 ? longest / 4 : 1;
}

/** Decide which parts are instanced, which are merged and in which chunk, and which draw alone. */
export function planComposite(parts: readonly CompositePart[], limits: CompositeLimits = COMPOSITE_DEFAULTS, cellSize?: number): CompositePlan {
    const byMesh = new Map<string, CompositePart[]>();
    for (const p of parts) {
        const id = `${p.key}|${p.mesh}`;
        const list = byMesh.get(id);
        if (list) list.push(p); else byMesh.set(id, [p]);
    }
    const sets: CompositeInstanceSet[] = [];
    const merge: CompositePart[] = [];
    const instanceMin = Math.max(2, limits.instanceMin);
    for (const list of byMesh.values()) {
        if (list.length >= instanceMin) {
            sets.push({ key: list[0]!.key, mesh: list[0]!.mesh, entities: list.map((p) => p.entity) });
        } else {
            merge.push(...list);
        }
    }
    const size = cellSize ?? (limits.cellSize > 0 ? limits.cellSize : autoCellSize(merge));
    const candidates: StaticBatchCandidate[] = merge.map((p) => ({ entity: p.entity, key: p.key, center: p.center, vertices: p.vertices }));
    const planned = planStaticBatches(candidates, { cellSize: size, maxVertices: limits.maxVertices });
    const chunks = planned.batches.map((b) => {
        const entities = [...b.entities].sort((x, y) => x - y);
        return { id: `${b.key}#${entities.join(',')}`, key: b.key, entities };
    });
    return { sets, chunks, alone: [...planned.alone], cellSize: size };
}

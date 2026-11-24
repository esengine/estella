// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    clusterLod.ts
 * @brief   Cut a dense static mesh into a hierarchy of triangle clusters a view can pick from piece by piece.
 *
 *          The mesh is split into clusters of at most {@link CLUSTER_MAX_TRIANGLES} triangles. Neighbouring clusters are
 *          grouped, each group is simplified to half its triangles with the vertices it shares with other groups held
 *          still, and the result is split into clusters again: the next level. A cluster carries two bounds, its own
 *          and its group's, each a sphere and an error in mesh units. A view draws a cluster when its own error is small
 *          enough on screen and its group's is not. Every cluster of a group shares the group's bounds, so a group is
 *          swapped for its simplified form as a whole, and the held vertices make the swap meet its neighbours exactly.
 */
import { MeshoptClusterizer, MeshoptSimplifier } from 'meshoptimizer';
import type { MeshData } from 'esengine';
import { canSimplify, simplifierStreams } from './meshSimplify';

/** Triangles one cluster holds at most. */
export const CLUSTER_MAX_TRIANGLES = 128;
/** Vertices one cluster names at most: what the clusterizer is asked for, above what 128 triangles of a closed surface need. */
const CLUSTER_MAX_VERTICES = 192;
/** A group that keeps more than this share of its triangles was not simplified: its clusters stay as they are. */
const STUCK_SHARE = 0.85;
/**
 * Pairing rounds a level's clusters are grouped by: four make groups of up to sixteen. A small group has a long border for
 * its area, and the border is held still, so the simplifier spends its whole error on a thin interior: measured on a
 * 1.4M-triangle generated model, groups of four needed 0.3 of the radius to reach the size groups of sixteen reach at 0.01.
 */
const PAIRING_ROUNDS = 4;
/** Clusters a group gathers at most after the pairing rounds and the lone clusters taken in. */
const GROUP_MAX_CLUSTERS = 24;
/**
 * What a full swing of an attribute costs, as a share of its group's radius. The simplifier adds attribute error to the
 * distance it reports, so an attribute must be in the mesh's units: in a UV's own units a seam on a model a few
 * centimetres across reads as an error of metres, and a far view keeps a level it cannot see the difference of.
 *
 * Small, because fine shading is the normal map's to carry, as a generated model's is: measured on a 1.4M-triangle one
 * with its own maps, 0.05 drew 3% of the triangles near with 3.5% of its pixels off the source by more than a tenth,
 * and a few hundred far. A share of 2 brought those pixels to 0.3% for twice the triangles near and ten times far, and
 * left a smooth mesh drawn whole at a few pixels a triangle. A mesh lit by its vertex normals alone loses grooves
 * shallower than a pixel at this share.
 */
const ATTRIBUTE_SHARE = 0.05;
/** Floats one cluster's bounds occupy in {@link ClusterLod.bounds}: its own sphere and error, then its group's. */
export const CLUSTER_BOUNDS_FLOATS = 10;

/**
 * A mesh as clusters at every level of detail.
 *
 * Level 0 comes first and is the source mesh's own triangles, reordered: `indices.subarray(0, leafIndexCount)` draws the
 * mesh as it was. The rest are the simplified levels, which name the same vertices: a collapse keeps whole vertices.
 */
export interface ClusterLod {
    indices: Uint32Array;
    /** Two per cluster: the first index of its run in `indices`, and how many indices the run has. */
    ranges: Uint32Array;
    /**
     * {@link CLUSTER_BOUNDS_FLOATS} per cluster: centre xyz, radius and error of the cluster, then of the group that
     * replaces it. A cluster nothing replaces has `Infinity` for its group's error.
     */
    bounds: Float32Array;
    clusterCount: number;
    leafIndexCount: number;
    /** Levels built, level 0 included. */
    levels: number;
}

interface Sphere { x: number; y: number; z: number; radius: number; error: number }

interface Cluster {
    indices: Uint32Array;
    self: Sphere;
    parent: Sphere | null;
}

/** The centre of the points' box and the farthest point from it: not the smallest sphere, and always one that holds them. */
function sphereOfVertices(indices: Uint32Array, positions: Float32Array): Sphere {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const i of indices) {
        const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    let r2 = 0;
    for (const i of indices) {
        const dx = positions[i * 3]! - cx, dy = positions[i * 3 + 1]! - cy, dz = positions[i * 3 + 2]! - cz;
        r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
    return { x: cx, y: cy, z: cz, radius: Math.sqrt(r2), error: 0 };
}

/**
 * A sphere holding every one of `spheres`, with the largest of their errors. Holding them is what keeps a group's error on
 * screen at or above its clusters' from any eye: it is nearer and its error is no smaller.
 */
function sphereOfSpheres(spheres: Sphere[]): Sphere {
    let x = 0, y = 0, z = 0, error = 0;
    for (const s of spheres) { x += s.x; y += s.y; z += s.z; error = Math.max(error, s.error); }
    x /= spheres.length; y /= spheres.length; z /= spheres.length;
    let radius = 0;
    for (const s of spheres) radius = Math.max(radius, Math.hypot(s.x - x, s.y - y, s.z - z) + s.radius);
    return { x, y, z, radius, error };
}

/** `indices` as clusters. The streams may be a group's own compact copy: `toSource` then names each vertex in the mesh. */
function split(indices: Uint32Array, positions: Float32Array, toSource: Uint32Array | null): Uint32Array[] {
    const built = MeshoptClusterizer.buildMeshlets(indices, positions, 3, CLUSTER_MAX_VERTICES, CLUSTER_MAX_TRIANGLES, 0);
    const out: Uint32Array[] = [];
    for (let m = 0; m < built.meshletCount; m++) {
        const { vertices, triangles } = MeshoptClusterizer.extractMeshlet(built, m);
        const cluster = new Uint32Array(triangles.length);
        for (let k = 0; k < triangles.length; k++) {
            const v = vertices[triangles[k]!]!;
            cluster[k] = toSource ? toSource[v]! : v;
        }
        if (cluster.length > 0) out.push(cluster);
    }
    return out;
}

/**
 * How many edges each pair of clusters shares, by position: two clusters either side of a UV seam are neighbours.
 * Only a cluster's outline is entered, an edge two of its own triangles share being no one else's.
 */
function sharedEdges(clusters: Cluster[], ids: number[], weld: Uint32Array, vertexCount: number): Map<number, number>[] {
    const owner = new Map<number, number>();
    const adjacency: Map<number, number>[] = ids.map(() => new Map());
    const outline = new Map<number, number>();
    ids.forEach((id, node) => {
        const tri = clusters[id]!.indices;
        outline.clear();
        for (let t = 0; t < tri.length; t += 3) {
            for (let e = 0; e < 3; e++) {
                const a = weld[tri[t + e]!]!, b = weld[tri[t + (e + 1) % 3]!]!;
                if (a === b) continue;
                const key = a < b ? a * vertexCount + b : b * vertexCount + a;
                outline.set(key, (outline.get(key) ?? 0) + 1);
            }
        }
        for (const [key, uses] of outline) {
            if (uses !== 1) continue;
            const other = owner.get(key);
            if (other === undefined) { owner.set(key, node); continue; }
            if (other === node) continue;
            adjacency[node]!.set(other, (adjacency[node]!.get(other) ?? 0) + 1);
            adjacency[other]!.set(node, (adjacency[other]!.get(node) ?? 0) + 1);
        }
    });
    return adjacency;
}

/** One pairing round: the heaviest edges first, each node joined to one neighbour at most. Returns the merged nodes and their edges. */
function pair(members: number[][], adjacency: Map<number, number>[]): { members: number[][]; adjacency: Map<number, number>[] } {
    const edges: [number, number, number][] = [];
    adjacency.forEach((near, a) => { for (const [b, w] of near) if (a < b) edges.push([w, a, b]); });
    edges.sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2]);
    const into = new Int32Array(members.length).fill(-1);
    const merged: number[][] = [];
    for (const [, a, b] of edges) {
        if (into[a]! >= 0 || into[b]! >= 0) continue;
        into[a] = into[b] = merged.length;
        merged.push([...members[a]!, ...members[b]!]);
    }
    members.forEach((m, a) => {
        if (into[a]! < 0) {
            into[a] = merged.length;
            merged.push(m);
        }
    });
    const next: Map<number, number>[] = merged.map(() => new Map());
    adjacency.forEach((near, a) => {
        for (const [b, w] of near) {
            const from = into[a]!, to = into[b]!;
            if (from !== to) next[from]!.set(to, (next[from]!.get(to) ?? 0) + w);
        }
    });
    return { members: merged, adjacency: next };
}

/**
 * The level's clusters as groups of neighbours: the pairing rounds make groups of up to sixteen, and a cluster left alone
 * joins the neighbouring group it shares the most with. A cluster simplified alone has its whole outline held and gives
 * up almost nothing, so as few as possible are left that way.
 */
function partition(clusters: Cluster[], ids: number[], weld: Uint32Array, vertexCount: number): number[][] {
    let graph = { members: ids.map((_, node) => [node]), adjacency: sharedEdges(clusters, ids, weld, vertexCount) };
    for (let round = 0; round < PAIRING_ROUNDS; round++) graph = pair(graph.members, graph.adjacency);
    const { members, adjacency } = graph;
    const gone = new Uint8Array(members.length);
    members.forEach((m, a) => {
        if (m.length !== 1) return;
        let best = -1, bestWeight = 0;
        for (const [b, w] of adjacency[a]!) {
            if (gone[b] || members[b]!.length >= GROUP_MAX_CLUSTERS) continue;
            if (w > bestWeight) { best = b; bestWeight = w; }
        }
        if (best < 0) return;
        members[best]!.push(...m);
        gone[a] = 1;
    });
    return members.filter((_, a) => !gone[a]).map(m => m.map(node => ids[node]!));
}

/**
 * Whether a mesh is worth cutting into clusters: static (bones and morph deltas are addressed by vertex, and a level
 * that drops vertices would have to carry its own), and more than a few clusters' worth of triangles.
 */
export function canClusterMesh(data: MeshData): boolean {
    return canSimplify(data) && data.indices.length / 3 > CLUSTER_MAX_TRIANGLES * 4;
}

/**
 * `data` as a cluster hierarchy, or null where it cannot be one (@ref canClusterMesh).
 */
export async function buildClusterLod(data: MeshData): Promise<ClusterLod | null> {
    if (!canClusterMesh(data)) return null;
    await Promise.all([MeshoptClusterizer.ready, MeshoptSimplifier.ready]);

    const { positions, attributes, attributeStride, weights } = simplifierStreams(data);
    const vertexCount = data.vertexCount;
    const weld = MeshoptSimplifier.generatePositionRemap(positions, 3);

    const clusters: Cluster[] = split(data.indices, positions, null).map(indices => ({
        indices, self: sphereOfVertices(indices, positions), parent: null,
    }));
    let leafIndexCount = 0;
    for (const c of clusters) leafIndexCount += c.indices.length;

    // Positions a cluster that stopped simplifying still draws with: every later level meets it there, so they never move again.
    const frozen = new Uint8Array(vertexCount);
    const groupOf = new Int32Array(vertexCount);
    const shared = new Uint8Array(vertexCount);
    const local = new Int32Array(vertexCount).fill(-1);

    let level: number[] = clusters.map((_, id) => id);
    let levels = 1;
    while (level.length > 1) {
        const groups = partition(clusters, level, weld, vertexCount);

        groupOf.fill(-1);
        shared.fill(0);
        groups.forEach((group, g) => {
            for (const id of group) for (const i of clusters[id]!.indices) {
                const p = weld[i]!;
                if (groupOf[p] === -1) groupOf[p] = g;
                else if (groupOf[p] !== g) shared[p] = 1;
            }
        });

        const next: number[] = [];
        for (const group of groups) {
            let count = 0;
            for (const id of group) count += clusters[id]!.indices.length;

            // The group's own compact streams: the simplifier is handed every vertex it is given on each call, and a
            // dense mesh's whole vertex array per group is a bake that never ends.
            const toSource: number[] = [];
            const merged = new Uint32Array(count);
            let at = 0;
            for (const id of group) for (const i of clusters[id]!.indices) {
                if (local[i] === -1) { local[i] = toSource.length; toSource.push(i); }
                merged[at++] = local[i]!;
            }
            const groupPositions = new Float32Array(toSource.length * 3);
            const groupAttributes = new Float32Array(toSource.length * attributeStride);
            const lock = new Uint8Array(toSource.length);
            toSource.forEach((source, v) => {
                groupPositions.set(positions.subarray(source * 3, source * 3 + 3), v * 3);
                groupAttributes.set(attributes.subarray(source * attributeStride, (source + 1) * attributeStride), v * attributeStride);
                const p = weld[source]!;
                lock[v] = shared[p] || frozen[p] ? 1 : 0;
                local[source] = -1;
            });

            const target = Math.floor(count / 3 / 2) * 3;
            const bounds = sphereOfSpheres(group.map(id => clusters[id]!.self));
            const scale = bounds.radius * ATTRIBUTE_SHARE;
            const groupWeights = weights.map(w => w * scale);
            let [kept, error] = MeshoptSimplifier.simplifyWithAttributes(merged, groupPositions, 3, groupAttributes,
                attributeStride, groupWeights, lock, target, 3e38, ['ErrorAbsolute']);
            // A group cut into UV islands holds every island's edge as a seam and stops shrinking: a generated model's
            // unwrap does that nearly everywhere. Once more, free to collapse across a seam; the held border is held still.
            if (kept.length === 0 || kept.length > count * STUCK_SHARE) {
                [kept, error] = MeshoptSimplifier.simplifyWithAttributes(merged, groupPositions, 3, groupAttributes,
                    attributeStride, groupWeights, lock, target, 3e38, ['ErrorAbsolute', 'Permissive']);
            }
            if (kept.length === 0 || kept.length > count * STUCK_SHARE) {
                for (const id of group) for (const i of clusters[id]!.indices) frozen[weld[i]!] = 1;
                continue;
            }

            // The larger of what the group's clusters show and what this collapse moved, not their sum: summed over a dozen
            // levels the bound kept twice the triangles at every distance on a generated model, and a level's own error
            // never falls below its children's, which is all that keeps one level drawn everywhere.
            bounds.error = Math.max(bounds.error, error);
            for (const id of group) clusters[id]!.parent = bounds;
            const source = Uint32Array.from(toSource);
            for (const indices of split(kept, groupPositions, source)) {
                next.push(clusters.length);
                clusters.push({ indices, self: bounds, parent: null });
            }
        }
        if (next.length === 0) break;
        level = next;
        levels++;
    }

    let total = 0;
    for (const c of clusters) total += c.indices.length;
    const indices = new Uint32Array(total);
    const ranges = new Uint32Array(clusters.length * 2);
    const bounds = new Float32Array(clusters.length * CLUSTER_BOUNDS_FLOATS);
    let first = 0;
    clusters.forEach((c, id) => {
        indices.set(c.indices, first);
        ranges[id * 2] = first;
        ranges[id * 2 + 1] = c.indices.length;
        first += c.indices.length;
        const p = c.parent;
        bounds.set([c.self.x, c.self.y, c.self.z, c.self.radius, c.self.error,
            p ? p.x : c.self.x, p ? p.y : c.self.y, p ? p.z : c.self.z, p ? p.radius : c.self.radius, p ? p.error : Infinity],
            id * CLUSTER_BOUNDS_FLOATS);
    });
    return { indices, ranges, bounds, clusterCount: clusters.length, leafIndexCount, levels };
}

/**
 * `data` with its hierarchy, as an `.esmesh` carries one: the mesh's own triangles in cluster order, the levels above
 * them beside it. Null where it cannot be cut (@ref canClusterMesh).
 */
export async function withClusters(data: MeshData): Promise<MeshData | null> {
    const lod = await buildClusterLod(data);
    if (!lod) return null;
    return {
        ...data,
        indices: lod.indices.slice(0, lod.leafIndexCount),
        clusters: { coarseIndices: lod.indices.slice(lod.leafIndexCount), ranges: lod.ranges, bounds: lod.bounds },
    };
}

/**
 * The clusters a view draws: those whose own error is at most `threshold` on screen while their group's is above it.
 * `onScreen` turns a sphere and an error in mesh units into the view's measure; it must not shrink when the sphere
 * grows to hold the old one or the error grows, which a size over distance-to-the-sphere's-surface does not.
 */
export function selectClusters(lod: ClusterLod, threshold: number,
    onScreen: (x: number, y: number, z: number, radius: number, error: number) => number): number[] {
    const b = lod.bounds;
    const out: number[] = [];
    for (let id = 0; id < lod.clusterCount; id++) {
        const at = id * CLUSTER_BOUNDS_FLOATS;
        if (onScreen(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!, b[at + 4]!) > threshold) continue;
        if (b[at + 9] !== Infinity && onScreen(b[at + 5]!, b[at + 6]!, b[at + 7]!, b[at + 8]!, b[at + 9]!) <= threshold) continue;
        out.push(id);
    }
    return out;
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    staticProxy.ts
 * @brief   Bake a static cluster into material-preserving, simplified geometry proxies.
 */
import { createHash } from 'node:crypto';
import { staticBatchLayout, staticBatchLayoutRefusal, mergeMeshes, planStaticBatches, staticBatchKey, encodeMesh,
    type MeshData, type StaticBatchDrawState, type StaticBatchRefusal } from 'esengine';
import { simplifyMesh } from '../assets/meshSimplify';

/** One placed surface. The collector must classify motion and material blending before baking. */
export interface StaticProxySource {
    entity: number;
    mesh: MeshData;
    world: ArrayLike<number>;
    state: StaticBatchDrawState;
    motion: 'static' | 'dynamic' | 'deformed' | 'billboard';
    blended: boolean;
    /** Preserve high-contrast or emissive geometry until its appearance has a baked replacement. */
    preserveGeometry?: boolean;
    baked?: boolean;
    enabled?: boolean;
}

export interface StaticProxyOptions {
    /** Cluster-local origin; the returned meshes are placed here when drawn. */
    origin: readonly [number, number, number];
    /** Target triangle share, in (0, 1]. The error limit takes precedence. */
    ratio: number;
    /** Maximum simplification error in world units, independent of cluster extent. */
    maxWorldError: number;
    /** Allow entire disconnected pieces to disappear within the error bound. Requires visual review. */
    pruneDisconnected?: boolean;
    /** Vertex budget before simplification. A single larger source remains one group. */
    maxVertices?: number;
}

export interface StaticProxyGroup {
    sources: number[];
    state: StaticBatchDrawState;
    mesh: MeshData;
    trianglesBefore: number;
    trianglesAfter: number;
    bytesBefore: number;
    bytesAfter: number;
    worldError: number;
    preservedGeometry: boolean;
    fingerprint: string;
}

export interface StaticProxyResult {
    origin: [number, number, number];
    groups: StaticProxyGroup[];
    refused: Array<{ entity: number; reason: StaticBatchRefusal | 'deformed' | 'transform' }>;
}

function refusal(source: StaticProxySource): StaticProxyResult['refused'][number]['reason'] | null {
    if (source.enabled === false) return 'disabled';
    if (source.motion === 'dynamic') return 'moves';
    if (source.motion === 'deformed') return 'deformed';
    if (source.motion === 'billboard') return 'billboard';
    if (source.blended) return 'blended';
    if (source.baked) return 'baked';
    if (source.mesh.vertexCount === 0 || source.mesh.indices.length === 0) return 'no-mesh';
    const m = Array.from(source.world);
    if (m.length !== 16 || m.some(value => !Number.isFinite(value))
        || m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) return 'transform';
    const determinant = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!)
        - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
    if (determinant === 0) return 'transform';
    return staticBatchLayoutRefusal(source.mesh);
}

/** Bake one already-partitioned cluster. Refused surfaces remain the caller's responsibility. */
export async function bakeStaticProxy(sources: readonly StaticProxySource[], options: StaticProxyOptions): Promise<StaticProxyResult> {
    if (!Number.isFinite(options.ratio) || options.ratio <= 0 || options.ratio > 1
        || !Number.isFinite(options.maxWorldError) || options.maxWorldError < 0
        || options.origin.length !== 3 || options.origin.some(value => !Number.isFinite(value))
        || (options.maxVertices !== undefined && (!Number.isInteger(options.maxVertices) || options.maxVertices < 3))) {
        throw new Error('Static proxy requires a finite origin, ratio in (0, 1], nonnegative world error and a positive vertex budget');
    }
    const result: StaticProxyResult = { origin: [...options.origin], groups: [], refused: [] };
    const accepted = new Map<number, StaticProxySource>();
    const seen = new Set<number>();
    for (const source of [...sources].sort((a, b) => a.entity - b.entity)) {
        if (!Number.isSafeInteger(source.entity) || seen.has(source.entity)) throw new Error('Static proxy source ids must be unique integers');
        seen.add(source.entity);
        const reason = refusal(source);
        if (reason) result.refused.push({ entity: source.entity, reason });
        else accepted.set(source.entity, source);
    }
    const plan = planStaticBatches([...accepted.values()].map(source => ({
        entity: source.entity, key: staticBatchKey(source.state, staticBatchLayout(source.mesh.channels, source.mesh.vertexStride)),
        center: [0, 0, 0], vertices: source.mesh.vertexCount,
    })), { cellSize: 1, maxVertices: options.maxVertices ?? 262144 });
    const groups = [...plan.batches.map(batch => batch.entities), ...plan.alone.map(entity => [entity])]
        .sort((a, b) => a[0]! - b[0]!);
    for (const ids of groups) {
        const parts = ids.map(entity => accepted.get(entity)!);
        const merged = mergeMeshes(parts.map(source => {
            const world = Array.from(source.world);
            for (let axis = 0; axis < 3; axis++) world[12 + axis]! -= options.origin[axis]!;
            return { mesh: source.mesh, world };
        }));
        const preservedGeometry = parts.some(source => source.preserveGeometry);
        const simplified = preservedGeometry ? null : await simplifyMesh(merged, { ratio: options.ratio, maxError: options.maxWorldError,
            flags: options.pruneDisconnected ? ['ErrorAbsolute', 'Permissive', 'Prune'] : ['ErrorAbsolute', 'Permissive'] });
        const mesh = simplified?.data ?? merged;
        const state = structuredClone(parts[0]!.state);
        const fingerprint = createHash('sha256').update('static-proxy-v1\0')
            .update(JSON.stringify([options.origin, options.ratio, options.maxWorldError, !!options.pruneDisconnected, preservedGeometry,
                staticBatchKey(state, staticBatchLayout(merged.channels, merged.vertexStride)), ids]))
            .update(encodeMesh(merged)).digest('hex');
        result.groups.push({ sources: ids, state, mesh, worldError: simplified?.error ?? 0, preservedGeometry, fingerprint,
            trianglesBefore: merged.indices.length / 3, trianglesAfter: mesh.indices.length / 3,
            bytesBefore: merged.vertices.byteLength + merged.indices.byteLength,
            bytesAfter: mesh.vertices.byteLength + mesh.indices.byteLength });
    }
    return result;
}

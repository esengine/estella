// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    meshCollision.ts
 * @brief   The CPU-side triangles of a loaded mesh, kept for whoever needs shape
 *          rather than pixels.
 * @details Geometry goes to the GPU and the bytes are let go, which is right for
 *          drawing and useless for colliding: a physics world, a navmesh bake and
 *          a precise pick all need the triangles themselves. The decode already
 *          produces them, so this keeps the positions and the indices — nothing
 *          else — under the handle everything references the mesh by.
 *
 *          Positions only: a collider does not care what colour a vertex is, and
 *          keeping the full interleaved buffer would hold several times as much
 *          for no reader.
 */

/** One mesh's triangles, in the model space its vertices were authored in. */
export interface MeshCollisionData {
    /** `vertexCount * 3` floats. */
    positions: Float32Array;
    indices: Uint32Array;
}

const byHandle = new Map<number, MeshCollisionData>();

/** Remember `handle`'s triangles. Called by the loader that decoded them. */
export function registerMeshCollision(handle: number, data: MeshCollisionData): void {
    if (handle !== 0) byHandle.set(handle, data);
}

/** The triangles behind a mesh handle, or null when nothing loaded it. */
export function getMeshCollision(handle: number): MeshCollisionData | null {
    return byHandle.get(handle) ?? null;
}

export function releaseMeshCollision(handle: number): void {
    byHandle.delete(handle);
}

/** How many meshes are holding triangles — for a leak check, not for gameplay. */
export function meshCollisionCount(): number {
    return byHandle.size;
}

/**
 * Pull the Position channel out of an interleaved vertex buffer.
 *
 * @param channels The file's channel table; Position is semantic 0.
 * @returns null when the mesh carries no positions, which nothing can collide with.
 */
export function extractPositions(
    vertices: Uint8Array, vertexCount: number, vertexStride: number,
    channels: ReadonlyArray<{ semantic: number; offset: number; type: number }>,
): Float32Array | null {
    const position = channels.find((c) => c.semantic === 0);
    // Float32 is type 0 in the format's own enum. A packed position would need
    // its own decode, and no exporter this engine reads writes one.
    if (!position || position.type !== 0) return null;
    const view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const out = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
        const at = i * vertexStride + position.offset;
        out[i * 3] = view.getFloat32(at, true);
        out[i * 3 + 1] = view.getFloat32(at + 4, true);
        out[i * 3 + 2] = view.getFloat32(at + 8, true);
    }
    return out;
}

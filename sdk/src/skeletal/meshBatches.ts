// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    skeletal/meshBatches.ts
 * @brief   Reading posed geometry back out of a skeletal side module.
 *
 * @details Every such module answers the same four questions — how many batches,
 *          how many vertices, how many indices, give me the bytes — because
 *          SkeletalModule.hpp packs them the same way on the other side. So this
 *          is written against those four rather than against a runtime, and Spine
 *          and DragonBones both hand it their own.
 *
 *          The views handed to the callback point INTO the module's scratch heap
 *          and die when the call returns. That is the point: a consumer copies
 *          those bytes straight into its own heap, and nothing allocates a typed
 *          array per batch per frame.
 */
import { withMalloc, withScratch } from '../wasm/wasmScratch';

/** The heap a module marshals through. */
export interface SkeletalHeap {
    _malloc(size: number): number;
    _free(ptr: number): void;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
}

/** The four readback entry points, however a module spells them. */
export interface MeshBatchSource {
    getMeshBatchCount(instanceId: number): number;
    getMeshBatchVertexCount(instanceId: number, batchIndex: number): number;
    getMeshBatchIndexCount(instanceId: number, batchIndex: number): number;
    getMeshBatchData(
        instanceId: number, batchIndex: number,
        verticesPtr: number, indicesPtr: number, textureIdPtr: number, blendModePtr: number,
    ): void;
}

export type MeshBatchVisitor = (
    vertBytes: Uint8Array, indexBytes: Uint8Array,
    vertexCount: number, indexCount: number,
    textureId: number, blendMode: number,
) => void;

/** Interleaved x,y,u,v,r,g,b,a — the layout every skeletal module writes. */
const VERTEX_FLOATS = 8;

/** Visit each posed batch. Views are valid only for the duration of each call. */
export function forEachMeshBatch(
    heap: SkeletalHeap,
    api: MeshBatchSource,
    instanceId: number,
    cb: MeshBatchVisitor,
): void {
    const batchCount = api.getMeshBatchCount(instanceId);
    if (batchCount === 0) return;

    withMalloc(heap, 8, metaPtr => {
        const texIdPtr = metaPtr;
        const blendPtr = metaPtr + 4;

        for (let i = 0; i < batchCount; i++) {
            const vertexCount = api.getMeshBatchVertexCount(instanceId, i);
            const indexCount = api.getMeshBatchIndexCount(instanceId, i);
            if (vertexCount <= 0 || indexCount <= 0) continue;

            const vertByteLen = vertexCount * VERTEX_FLOATS * 4;
            const idxByteLen = indexCount * 2;
            withScratch(heap, alloc => {
                const vertPtr = alloc(vertByteLen);
                const idxPtr = alloc(idxByteLen);
                api.getMeshBatchData(instanceId, i, vertPtr, idxPtr, texIdPtr, blendPtr);
                cb(
                    new Uint8Array(heap.HEAPU8.buffer, vertPtr, vertByteLen),
                    new Uint8Array(heap.HEAPU8.buffer, idxPtr, idxByteLen),
                    vertexCount, indexCount,
                    heap.HEAPU32[texIdPtr >> 2],
                    heap.HEAPU32[blendPtr >> 2],
                );
            });
        }
    });
}

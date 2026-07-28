// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    skeletal/submitMeshes.ts
 * @brief   Handing one entity's posed geometry to the engine core.
 *
 * @details The core's entry point is `renderer_submitSpineBatchByEntity`, and the
 *          name is the only thing about it that is Spine's: it takes vertices,
 *          indices, a texture, a blend mode, an entity, a scale, two flips and a
 *          layer, and nothing in that list knows what posed them. DragonBones
 *          submits through exactly the same call.
 *
 *          (The name is worth fixing, but it spans the wasm ABI, the native host
 *          and the WeChat build, so it is its own change rather than a rename
 *          smuggled into this one.)
 *
 *          The copy is the delicate part. A module's batch bytes live in ITS heap,
 *          and the core reads from the CORE's — so each batch is copied into an
 *          engine-side scratch arena and submitted while the source view is still
 *          live. Nothing intermediate is allocated, and nothing is cached between
 *          frames.
 */
import { withScratch } from '../wasmScratch';
import type { Entity } from '../types';
import type { MeshBatchVisitor } from './meshBatches';

/** How an entity's skeleton sits in the world, independent of what posed it. */
export interface SkeletalSubmitProps {
    skeletonScale: number;
    flipX: boolean;
    flipY: boolean;
    layer: number;
}

/** The slice of the engine core this needs. */
export interface SkeletalSubmitCore {
    renderer_submitSpineBatchByEntity?(
        registry: unknown,
        verticesPtr: number, vertexCount: number,
        indicesPtr: number, indexCount: number,
        textureId: number, blendMode: number,
        entity: number, skeletonScale: number, flipX: boolean, flipY: boolean,
        layer: number, depth: number,
    ): void;
    _malloc?(size: number): number;
    _free?(ptr: number): void;
    HEAPU8?: Uint8Array;
}

/** Iterates a module's batches for one instance. */
export type MeshBatchWalker = (cb: MeshBatchVisitor) => void;

/**
 * Copy each posed batch into the core's heap and submit it for `entity`.
 *
 * Returns false when the core cannot accept geometry at all (no submit export, no
 * heap) — the caller stops rather than repeating the check per entity.
 */
export function submitEntityMeshes(
    core: SkeletalSubmitCore,
    registry: unknown,
    entity: Entity,
    props: SkeletalSubmitProps,
    walk: MeshBatchWalker,
): boolean {
    const submit = core.renderer_submitSpineBatchByEntity;
    const heap = core.HEAPU8;
    if (!submit || !heap || !core._malloc || !core._free) return false;

    const allocator = { _malloc: core._malloc, _free: core._free };
    withScratch(allocator, alloc => {
        walk((vertBytes, idxBytes, vertexCount, indexCount, textureId, blendMode) => {
            const dstVert = alloc(vertBytes.byteLength);
            const dstIdx = alloc(idxBytes.byteLength);
            heap.set(vertBytes, dstVert);
            heap.set(idxBytes, dstIdx);
            submit.call(core, registry,
                dstVert, vertexCount, dstIdx, indexCount,
                textureId, blendMode, entity as number,
                props.skeletonScale, props.flipX, props.flipY, props.layer, 0);
        });
    });
    return true;
}

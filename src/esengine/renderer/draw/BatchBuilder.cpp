// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BatchBuilder.cpp
 * @brief   Implementation of the single submission face — the only DrawCommand producer.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "./BatchBuilder.hpp"

#include <vector>

namespace esengine {

namespace {

// Reused across calls so offsetting local indices into the target stream costs no
// per-call heap allocation. The renderer collects single-threaded and each call fully
// consumes the scratch before returning, so a file-local buffer is safe — and it amortizes
// the allocation across the frame, mirroring DrawList::sorted_scratch_.
std::vector<u32> g_indexScratch;

template <typename IndexT>
void pushBatchCommandImpl(TransientBufferPool& pool, DrawList& drawList, const ClipState& clips,
                          u32 vertexByteOffset, u32 vertexCount,
                          const IndexT* localIndices, u32 indexCount,
                          const BatchDrawKey& key) {
    if (indexCount == 0) return;

    u32 baseVertex = vertexByteOffset / pool.vertexStride(key.layoutId);
    g_indexScratch.resize(indexCount);
    for (u32 i = 0; i < indexCount; ++i) {
        g_indexScratch[i] = baseVertex + static_cast<u32>(localIndices[i]);
    }
    u32 indexOffset = pool.appendIndices(key.layoutId, g_indexScratch.data(), indexCount);

    pushBatchDraw(drawList, clips, vertexByteOffset, vertexCount, indexOffset, indexCount, key);
}

}  // namespace

void pushBatchDraw(DrawList& drawList, const ClipState& clips,
                   u32 vertexByteOffset, u32 vertexCount, u32 indexOffset, u32 indexCount,
                   const BatchDrawKey& key) {
    if (indexCount == 0) return;

    DrawCommand cmd{};
    const bool ysorted = key.layer >= 0 && key.layer < 32 &&
                         ((drawList.ySortMask() >> key.layer) & 1u) != 0;
    cmd.sort_key = ysorted
        ? DrawCommand::buildSortKeyYSorted(key.stage, key.layer, key.y, key.shaderId,
                                           key.blend, 0)
        : DrawCommand::buildSortKey(key.stage, key.layer, key.shaderId,
                                    key.blend, 0, key.depth, key.materialId);
    cmd.index_offset = indexOffset;
    cmd.index_count = indexCount;
    cmd.vertex_byte_offset = vertexByteOffset;
    cmd.vertex_count = vertexCount;
    cmd.instance_count = key.instanceCount;
    cmd.shader_id = key.shaderId;
    cmd.blend_mode = key.blend;
    cmd.layout_id = key.layoutId;
    cmd.material_id = key.materialId;
    cmd.depth_test = key.depthTest;
    cmd.depth_write = key.depthWrite;
    cmd.cull = key.cull;
    // The Batch stream always samples a texture (white fallback at minimum); other
    // streams bind one only when the draw actually has one (the shape stream is
    // textureless, so execute() must not touch sampler units for it).
    cmd.texture_count = (key.layoutId == LayoutId::Batch || key.textureId != 0) ? 1 : 0;
    cmd.texture_ids[0] = key.textureId;
    cmd.entity = key.entity;
    cmd.type = key.type;
    cmd.layer = key.layer;

    clips.applyTo(key.entity, cmd);
    drawList.push(cmd);
}

void pushBatchCommand(TransientBufferPool& pool, DrawList& drawList, const ClipState& clips,
                      u32 vertexByteOffset, u32 vertexCount,
                      const u32* localIndices, u32 indexCount,
                      const BatchDrawKey& key) {
    pushBatchCommandImpl(pool, drawList, clips, vertexByteOffset, vertexCount, localIndices, indexCount, key);
}

void pushBatchCommand(TransientBufferPool& pool, DrawList& drawList, const ClipState& clips,
                      u32 vertexByteOffset, u32 vertexCount,
                      const u16* localIndices, u32 indexCount,
                      const BatchDrawKey& key) {
    pushBatchCommandImpl(pool, drawList, clips, vertexByteOffset, vertexCount, localIndices, indexCount, key);
}

void appendIndexedDraw(TransientBufferPool& pool, DrawList& drawList, const ClipState& clips,
                       const void* verts, u32 vertexCount,
                       const u32* localIndices, u32 indexCount,
                       const BatchDrawKey& key) {
    if (vertexCount == 0 || indexCount == 0) return;
    u32 vertexByteOffset = pool.appendVertices(
        key.layoutId, verts, vertexCount * pool.vertexStride(key.layoutId));
    pushBatchCommandImpl(pool, drawList, clips, vertexByteOffset, vertexCount, localIndices, indexCount, key);
}

void appendIndexedBatch(TransientBufferPool& pool, DrawList& drawList, const ClipState& clips,
                        const BatchVertex* verts, u32 vertexCount,
                        const u32* localIndices, u32 indexCount,
                        const BatchDrawKey& key) {
    appendIndexedDraw(pool, drawList, clips, verts, vertexCount, localIndices, indexCount, key);
}

}  // namespace esengine

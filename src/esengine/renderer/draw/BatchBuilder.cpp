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
    // The camera's culling mask, applied at the one place draws are produced, so no
    // render path can be added that forgets it.
    if (!drawList.layerVisible(key.cullBit ? key.cullBit : DrawList::layerBit(key.layer))) return;

    DrawCommand cmd{};
    const auto order = drawList.layerOrder(key.layer);

    // A depth layer decides its own stage and depth state; every other layer takes
    // what the caller resolved from the material. The rule is the physical one, so
    // it is derived rather than declared: an opaque draw may write depth and sorts
    // front-to-back (the key inverts its depth bits for the Opaque stage, which is
    // what makes early-z pay off), while a blended draw MUST NOT write — writing is
    // how translucent sprites clip each other into black edges — so it only tests,
    // and stays in back-to-front painter's order. Nobody should have to declare a
    // fact about alpha compositing per material.
    RenderStage stage = key.stage;
    bool depthTest = key.depthTest;
    bool depthWrite = key.depthWrite;
    if (order == DrawList::LayerOrder::Depth) {
        const bool opaque = key.blend == BlendMode::None;
        stage = opaque ? RenderStage::Opaque : RenderStage::Transparent;
        depthTest = true;
        depthWrite = opaque;
    }

    // stateFlags is 0: ClipState stamps the real scissor/stencil below, after the key
    // exists. A stencil write still precedes the draws testing it because UI pre-order
    // puts a mask below its descendants in LAYER, the key's top field. Not so on one layer.
    cmd.sort_key = order == DrawList::LayerOrder::YSort
        ? DrawCommand::buildSortKeyYSorted(stage, key.layer, key.y, key.shaderId,
                                           key.blend, 0)
        : DrawCommand::buildSortKey(stage, key.layer, key.shaderId,
                                    key.blend, 0, key.depth, key.materialId);
    cmd.stage = stage;
    cmd.index_offset = indexOffset;
    cmd.index_count = indexCount;
    cmd.vertex_byte_offset = vertexByteOffset;
    cmd.vertex_count = vertexCount;
    cmd.instance_count = key.instanceCount;
    cmd.vertex_buffer = key.vertexBuffer;
    cmd.index_buffer = key.indexBuffer;
    cmd.vertex_layout = key.vertexLayout;
    cmd.skin_offset = key.skinOffset;
    cmd.skin_count = key.skinCount;
    cmd.shader_id = key.shaderId;
    cmd.blend_mode = key.blend;
    cmd.layout_id = key.layoutId;
    cmd.material_id = key.materialId;
    cmd.depth_test = depthTest;
    cmd.depth_write = depthWrite;
    cmd.cull = key.cull;
    // The Batch stream always samples a texture (white fallback at minimum); other
    // streams bind one only when the draw actually has one (the shape stream is
    // textureless, so execute() must not touch sampler units for it).
    cmd.texture_count = (key.layoutId == LayoutId::Batch || key.textureId != 0) ? 1 : 0;
    cmd.texture_ids[0] = key.textureId;
    // Slot 1 belongs to the draw, so it is only ever bound where the shader
    // declares it — the Batch stream picks its extra slots per vertex instead.
    if (key.normalTextureId != 0 && cmd.texture_count == 1 && key.layoutId != LayoutId::Batch) {
        cmd.texture_ids[1] = key.normalTextureId;
        cmd.texture_count = 2;
    }
    // The shadow map's unit is pinned in the shader, so the gap below it is filled
    // rather than the slot moved: a draw with no normal map still samples slot 2.
    if (key.shadowTextureId != 0 && cmd.texture_count >= 1 && key.layoutId != LayoutId::Batch) {
        if (cmd.texture_count == 1) cmd.texture_ids[1] = key.textureId;
        cmd.texture_ids[2] = key.shadowTextureId;
        cmd.texture_count = 3;
    }
    // The reflection atlas is pinned one slot further on, filled the same way.
    if (key.envTextureId != 0 && cmd.texture_count >= 1 && key.layoutId != LayoutId::Batch) {
        for (u8 slot = cmd.texture_count; slot < 3; ++slot) cmd.texture_ids[slot] = key.textureId;
        cmd.texture_ids[3] = key.envTextureId;
        cmd.texture_count = 4;
    }
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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BatchBuilder.hpp
 * @brief   The single submission face: the ONLY place a DrawCommand is assembled.
 * @details Every render path — the batch-quad plugins (sprite/UI/text), the dedicated
 *          streams (shape/particle/tilemap), and RenderFrame's spine/text/tile direct
 *          submits — describes its draw as a BatchDrawKey plus geometry, and this face
 *          does the rest: append vertices, offset indices by baseVertex, build the sort
 *          key, assemble the DrawCommand, apply clip state, push into the DrawList.
 *          Renderers only *generate* commands; sorting, merging, and GfxDevice submission
 *          live unified in DrawList. The invariant is CI-enforced
 *          (tools/check-draw-command-boundary.mjs): DrawCommand assembly outside this
 *          translation unit fails the build.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../../core/Types.hpp"
#include "./BatchVertex.hpp"
#include "./BlendMode.hpp"
#include "./ClipState.hpp"
#include "./DrawCommand.hpp"
#include "./DrawList.hpp"
#include "./RenderItem.hpp"
#include "../frame/RenderStage.hpp"
#include "../rhi/TransientBufferPool.hpp"

#include <glm/glm.hpp>

namespace esengine {

// =============================================================================
// Shared quad geometry (single source of truth)
// =============================================================================

/** @brief Canonical centered unit-quad corner positions (CCW). */
inline constexpr glm::vec4 BATCH_QUAD_POSITIONS[4] = {
    { -0.5f, -0.5f, 0.0f, 1.0f },
    {  0.5f, -0.5f, 0.0f, 1.0f },
    {  0.5f,  0.5f, 0.0f, 1.0f },
    { -0.5f,  0.5f, 0.0f, 1.0f },
};

/** @brief Unit-quad texture coordinates matching BATCH_QUAD_POSITIONS. */
inline constexpr glm::vec2 BATCH_QUAD_TEX_COORDS[4] = {
    { 0.0f, 0.0f },
    { 1.0f, 0.0f },
    { 1.0f, 1.0f },
    { 0.0f, 1.0f },
};

/** @brief Canonical two-triangle quad winding shared by every batch path. */
inline constexpr u32 BATCH_QUAD_INDICES[6] = { 0, 1, 2, 2, 3, 0 };

/** @brief Rotates a point around @p center in the XY plane, carrying the center's z
 *         through untouched — the rotation a 2D renderer means is about z. */
inline glm::vec3 rotatePoint(const glm::vec3& center, f32 px, f32 py, f32 cosA, f32 sinA) {
    f32 dx = px - center.x;
    f32 dy = py - center.y;
    return { center.x + dx * cosA - dy * sinA,
             center.y + dx * sinA + dy * cosA,
             center.z };
}

// =============================================================================
// Batch submission
// =============================================================================

/** @brief Non-geometry attributes of a batch draw — everything needed to build the sort key + DrawCommand. */
struct BatchDrawKey {
    RenderStage stage = RenderStage::Transparent;
    i32 layer = 0;
    u32 shaderId = 0;
    BlendMode blend = BlendMode::Normal;
    u32 textureId = 0;
    // A second sampler this draw needs for itself (a mesh's normal map), bound to
    // slot 1. Not the same thing as the Batch stream's extra slots, which are a
    // MERGE product chosen per vertex.
    u32 normalTextureId = 0;
    // The frame's shadow map, on the slot the injected Lit2D header samples. Per-draw
    // like the two above rather than a global unit: which draws receive a shadow is a
    // question the collect answers, and the device has no "bind for everyone" seam.
    u32 shadowTextureId = 0;
    f32 depth = 0.0f;
    // World-space Y of the draw's anchor. Consumed only when the layer is y-sorted
    // (DrawList::ySortMask); layers outside 0..31 cannot y-sort.
    f32 y = 0.0f;
    // Mask bit of the layer this draw belongs to for camera culling; 0 derives it from
    // `layer`. UI sets it from its Canvas, whose `layer` is tree order, not membership.
    u32 cullBit = 0;
    Entity entity = INVALID_ENTITY;
    RenderType type = RenderType::Sprite;
    // Material handle + the render state resolved from it (defaults when materialId == 0).
    u32 materialId = 0;
    bool depthTest = false;
    bool depthWrite = true;
    u8 cull = 0;  ///< CullMode: 0 = none, 1 = back, 2 = front.
    // The transient stream this draw's geometry lives in. Only the Batch stream carries
    // a per-vertex texIndex, so only it participates in the multi-texture merge.
    LayoutId layoutId = LayoutId::Batch;
    // > 0 selects an instanced draw: indexCount indices drawn instanceCount times, with
    // per-instance attributes based at the vertex byte offset (see DrawCommand).
    u32 instanceCount = 0;
    // Geometry the GPU already holds. Set together with a MeshInstance stream, whose
    // offset is the draw's vertexByteOffset: the mesh supplies the vertices and the
    // frame supplies only the transforms.
    BufferHandle vertexBuffer = BufferHandle::Invalid;
    BufferHandle indexBuffer = BufferHandle::Invalid;
    VertexLayoutHandle vertexLayout = VertexLayoutHandle::Invalid;

    // A skinned draw's pose, already in the frame's matrix pool. Passed through
    // like the buffers above: what deforms a draw is the draw's, not the batch's.
    u32 skinOffset = 0;
    u32 skinCount = 0;
};

/**
 * @brief Atomic primitive: assemble + clip + push one DrawCommand for an index range ALREADY
 *        written into (or, for instanced draws, static in) the key's stream.
 * @details The single piece every render path used to duplicate. Use directly when the caller
 *          streams both vertices and indices in place, or for instanced draws over a static
 *          index range (the particle emitter's unit quad).
 */
void pushBatchDraw(DrawList& drawList, const ClipState& clips,
                   u32 vertexByteOffset, u32 vertexCount, u32 indexOffset, u32 indexCount,
                   const BatchDrawKey& key);

/**
 * @brief Pushes a DrawCommand for vertices ALREADY resident in the Batch stream at @p vertexByteOffset.
 * @details Offsets @p localIndices (0-based within the primitive) by the stream's baseVertex,
 *          appends them, then delegates to pushBatchDraw. Use when the caller formatted vertices
 *          in place via allocVertices()+vertexData() (the spine path). The u16/u32 overloads
 *          cover both index source widths.
 */
void pushBatchCommand(TransientBufferPool& pool, DrawList& drawList, const ClipState& clips,
                      u32 vertexByteOffset, u32 vertexCount, const u32* localIndices, u32 indexCount,
                      const BatchDrawKey& key);
void pushBatchCommand(TransientBufferPool& pool, DrawList& drawList, const ClipState& clips,
                      u32 vertexByteOffset, u32 vertexCount, const u16* localIndices, u32 indexCount,
                      const BatchDrawKey& key);

/**
 * @brief Copies raw vertices into the key's stream, then pushes one DrawCommand spanning them.
 * @details The layout-generic bulk form: @p verts must be @p vertexCount records of the
 *          stream's vertex stride (TransientBufferPool::vertexStride). This is the whole
 *          face a renderer with its own vertex format needs (shape today; any future
 *          trail/mesh2d stream).
 */
void appendIndexedDraw(TransientBufferPool& pool, DrawList& drawList, const ClipState& clips,
                       const void* verts, u32 vertexCount,
                       const u32* localIndices, u32 indexCount,
                       const BatchDrawKey& key);

/**
 * @brief Copies @p verts into the Batch stream, then pushes one DrawCommand spanning them.
 * @details Typed convenience over appendIndexedDraw for the shared BatchVertex format
 *          (tilemap chunk, single tile); the key must target the Batch stream.
 */
void appendIndexedBatch(TransientBufferPool& pool, DrawList& drawList, const ClipState& clips,
                        const BatchVertex* verts, u32 vertexCount,
                        const u32* localIndices, u32 indexCount,
                        const BatchDrawKey& key);

/** @brief Convenience for a single 4-vertex quad with the canonical 6-index winding. */
inline void appendQuad(TransientBufferPool& pool, DrawList& drawList, const ClipState& clips,
                       const BatchVertex quad[4], const BatchDrawKey& key) {
    appendIndexedBatch(pool, drawList, clips, quad, 4, BATCH_QUAD_INDICES, 6, key);
}

}  // namespace esengine

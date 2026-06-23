// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BatchBuilder.hpp
 * @brief   Backend-agnostic batch submission primitive shared by every batch render path.
 * @details Collapses the "append vertices -> offset indices by baseVertex -> assemble
 *          DrawCommand -> apply clip state -> push" sequence that each batch emitter
 *          (sprite/UI/text/particle/tilemap plugins + RenderFrame's spine/tile direct
 *          submits) used to copy verbatim. Giving the renderer one submission face here
 *          is the de-risking prerequisite for the GfxDevice keystone: the keystone rewrites
 *          DrawList::execute against a single producer, not six.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the PolyForm Noncommercial License 1.0.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"
#include "BatchVertex.hpp"
#include "BlendMode.hpp"
#include "ClipState.hpp"
#include "DrawCommand.hpp"
#include "DrawList.hpp"
#include "RenderItem.hpp"
#include "RenderStage.hpp"
#include "TransientBufferPool.hpp"

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

/** @brief Rotates a point around @p center using a precomputed cos/sin. */
inline glm::vec2 rotatePoint(const glm::vec2& center, f32 px, f32 py, f32 cosA, f32 sinA) {
    f32 dx = px - center.x;
    f32 dy = py - center.y;
    return { center.x + dx * cosA - dy * sinA,
             center.y + dx * sinA + dy * cosA };
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
    f32 depth = 0.0f;
    Entity entity = INVALID_ENTITY;
    RenderType type = RenderType::Sprite;
};

/**
 * @brief Atomic primitive: assemble + clip + push one DrawCommand for an index range ALREADY
 *        written into the Batch stream.
 * @details The single piece every batch path used to duplicate. Use directly when the caller
 *          streams both vertices and indices in place (the particle emitter writes its whole
 *          index range via writeIndices() before pushing one command).
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
 * @brief Copies @p verts into the Batch stream, then pushes one DrawCommand spanning them.
 * @details The bulk form — a single command over @p vertexCount vertices / @p indexCount
 *          indices (particle emitter, tilemap chunk, single tile).
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

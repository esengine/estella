// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BatchPlugin.hpp
 * @brief   Base class for render-type plugins that emit textured quads into the Batch stream.
 * @details Sprite and UI rendering build the same rotated/unrotated quad and the same 3x3
 *          nine-slice grid; only their pivot convention, border source type, and RenderType
 *          differ. This base owns the shared geometry construction (parameterized over those
 *          differences) and the batch shader id, leaving each plugin only its ECS query and
 *          per-entity attribute resolution. Submission goes through BatchBuilder, so there is
 *          one quad-emitting path for the renderer keystone to target.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../RenderTypePlugin.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../draw/BatchVertex.hpp"

#include <glm/glm.hpp>

namespace esengine {

class BatchPlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override { batch_shader_id_ = ctx.batch_shader_id; }
    void shutdown() override {}

protected:
    /**
     * @brief Emits a single rotated/unrotated textured quad.
     * @param pivotNorm Pivot in [0,1] within the quad; (0.5,0.5) keeps it centered on @p position.
     * @param key Non-geometry attributes (stage/layer/shader/blend/texture/depth/entity/type).
     */
    void emitQuad(TransientBufferPool& buffers, DrawList& draw_list, const ClipState& clips,
                  const glm::vec2& position, const glm::vec2& size, const glm::vec2& pivotNorm,
                  f32 angle, const glm::vec2& uvOffset, const glm::vec2& uvScale,
                  const glm::vec4& color, const BatchDrawKey& key);

    /**
     * @brief Emits a 3x3 nine-slice grid of quads sharing one BatchDrawKey.
     * @param border Slice insets as (left, right, top, bottom) in pixels.
     * @param texSize Texture dimensions; if either axis is <= 0 the slice UVs collapse to the outer rect.
     */
    void emitNineSlice(TransientBufferPool& buffers, DrawList& draw_list, const ClipState& clips,
                       const glm::vec2& position, const glm::vec2& size, const glm::vec2& pivotNorm,
                       f32 angle, const glm::vec2& texSize, const glm::vec4& border,
                       const glm::vec2& uvOffset, const glm::vec2& uvScale,
                       const glm::vec4& color, const BatchDrawKey& key);

    /**
     * @brief Emits a centered angular wedge (Radial Filled): a triangle fan from
     *        the box center out to its perimeter, swept clockwise from @p startAngle
     *        over @p sweep radians.
     * @details The wedge boundary follows the rectangle exactly — box corners
     *          crossed by the sweep become fan vertices, so edges stay straight
     *          and corners sharp (≤5 triangles, no per-frame tessellation).
     *          One BatchVertex stream, same shader as emitQuad — a radial gauge
     *          batches with every other UI quad. Radial90/180/360 differ only in
     *          the caller's @p sweep (fillAmount times the mode arc); the geometry
     *          is identical.
     * @param startAngle Sweep start in radians, box-local (before @p angle rotation).
     * @param sweep Total swept angle in radians, [0, 2π].
     */
    void emitRadialFill(TransientBufferPool& buffers, DrawList& draw_list, const ClipState& clips,
                        const glm::vec2& center, const glm::vec2& size, f32 angle,
                        f32 startAngle, f32 sweep,
                        const glm::vec2& uvOffset, const glm::vec2& uvScale,
                        const glm::vec4& color, const BatchDrawKey& key);

    u32 batch_shader_id_ = 0;
};

}  // namespace esengine

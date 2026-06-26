// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BatchPlugin.cpp
 * @brief   Shared quad / nine-slice geometry construction for batch render-type plugins.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "BatchPlugin.hpp"

#include <cmath>

namespace esengine {

void BatchPlugin::emitQuad(
    TransientBufferPool& buffers, DrawList& draw_list, const ClipState& clips,
    const glm::vec2& position, const glm::vec2& size, const glm::vec2& pivotNorm,
    f32 angle, const glm::vec2& uvOffset, const glm::vec2& uvScale,
    const glm::vec4& color, const BatchDrawKey& key
) {
    f32 ox = 0.5f - pivotNorm.x;
    f32 oy = 0.5f - pivotNorm.y;
    const u32 packedColor = packColor(color);  // constant across the 4 verts

    BatchVertex verts[4];
    if (std::abs(angle) > 0.001f) {
        f32 cosA = std::cos(angle);
        f32 sinA = std::sin(angle);
        for (u32 i = 0; i < 4; ++i) {
            f32 lx = (BATCH_QUAD_POSITIONS[i].x + ox) * size.x;
            f32 ly = (BATCH_QUAD_POSITIONS[i].y + oy) * size.y;
            verts[i].position = glm::vec2(
                position.x + lx * cosA - ly * sinA,
                position.y + lx * sinA + ly * cosA
            );
            verts[i].color = packedColor;
            verts[i].texCoord = BATCH_QUAD_TEX_COORDS[i] * uvScale + uvOffset;
        }
    } else {
        for (u32 i = 0; i < 4; ++i) {
            verts[i].position = glm::vec2(
                position.x + (BATCH_QUAD_POSITIONS[i].x + ox) * size.x,
                position.y + (BATCH_QUAD_POSITIONS[i].y + oy) * size.y
            );
            verts[i].color = packedColor;
            verts[i].texCoord = BATCH_QUAD_TEX_COORDS[i] * uvScale + uvOffset;
        }
    }

    appendQuad(buffers, draw_list, clips, verts, key);
}

void BatchPlugin::emitNineSlice(
    TransientBufferPool& buffers, DrawList& draw_list, const ClipState& clips,
    const glm::vec2& position, const glm::vec2& size, const glm::vec2& pivotNorm,
    f32 angle, const glm::vec2& texSize, const glm::vec4& border,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    const glm::vec4& color, const BatchDrawKey& key
) {
    f32 L = border.x;
    f32 R = border.y;
    f32 T = border.z;
    f32 B = border.w;

    f32 baseX = position.x - size.x * pivotNorm.x;
    f32 baseY = position.y - size.y * pivotNorm.y;

    f32 x[4] = { baseX, baseX + L, baseX + size.x - R, baseX + size.x };
    f32 y[4] = { baseY, baseY + B, baseY + size.y - T, baseY + size.y };

    f32 u[4], v[4];
    if (texSize.x > 0.0f && texSize.y > 0.0f) {
        u[0] = uvOffset.x;
        u[1] = uvOffset.x + L / texSize.x;
        u[2] = uvOffset.x + uvScale.x - R / texSize.x;
        u[3] = uvOffset.x + uvScale.x;
        v[0] = uvOffset.y;
        v[1] = uvOffset.y + B / texSize.y;
        v[2] = uvOffset.y + uvScale.y - T / texSize.y;
        v[3] = uvOffset.y + uvScale.y;
    } else {
        u[0] = uvOffset.x;
        u[1] = uvOffset.x;
        u[2] = uvOffset.x + uvScale.x;
        u[3] = uvOffset.x + uvScale.x;
        v[0] = uvOffset.y;
        v[1] = uvOffset.y;
        v[2] = uvOffset.y + uvScale.y;
        v[3] = uvOffset.y + uvScale.y;
    }

    f32 cosA = std::cos(angle);
    f32 sinA = std::sin(angle);
    const u32 pc = packColor(color);

    for (i32 row = 0; row < 3; ++row) {
        for (i32 col = 0; col < 3; ++col) {
            f32 pw = x[col + 1] - x[col];
            f32 ph = y[row + 1] - y[row];
            if (pw <= 0.0f || ph <= 0.0f) continue;

            BatchVertex verts[4];
            verts[0] = { rotatePoint(position, x[col],     y[row],     cosA, sinA), pc, {u[col],     v[row]}     };
            verts[1] = { rotatePoint(position, x[col + 1], y[row],     cosA, sinA), pc, {u[col + 1], v[row]}     };
            verts[2] = { rotatePoint(position, x[col + 1], y[row + 1], cosA, sinA), pc, {u[col + 1], v[row + 1]} };
            verts[3] = { rotatePoint(position, x[col],     y[row + 1], cosA, sinA), pc, {u[col],     v[row + 1]} };

            appendQuad(buffers, draw_list, clips, verts, key);
        }
    }
}

}  // namespace esengine

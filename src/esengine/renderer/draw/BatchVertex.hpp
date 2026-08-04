// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include <glm/glm.hpp>

namespace esengine {

/**
 * @brief One vertex of the shared batch stream.
 *
 * @details `position.z` must be the same world z the draw reports as its sort depth
 *          (`BatchDrawKey::depth`). The two answer different questions — the key decides
 *          draw ORDER, the vertex feeds projection and the depth test — and a draw whose
 *          answers disagree is one the painter's order and the depth buffer would place
 *          differently. Under an orthographic camera with the depth test off (today's 2D
 *          default) that disagreement is invisible, which is exactly why it has to be an
 *          invariant rather than a habit.
 */
struct BatchVertex {
    glm::vec3 position;
    u32 color;
    glm::vec2 texCoord;
    f32 texIndex = 0.0f;  // sampler slot within the draw's texture set; assigned at merge time
    // How far to push the SDF text edge outward, in the atlas's own distance units
    // (0.5 = one spread). An outline is the glyph drawn once more with this raised,
    // which is a real dilation of the distance field — the alternative, stamping the
    // glyph around itself, stops looking like the glyph once the ring is wide.
    // Per-vertex rather than per-draw so labels of different styles still batch;
    // everything that is not SDF text leaves it at 0.
    f32 sdfBias = 0.0f;
};

inline u32 packColor(f32 r, f32 g, f32 b, f32 a) {
    auto clamp = [](f32 v) -> u8 {
        return static_cast<u8>(std::min(std::max(v, 0.0f), 1.0f) * 255.0f + 0.5f);
    };
    return static_cast<u32>(clamp(r)) | (static_cast<u32>(clamp(g)) << 8)
         | (static_cast<u32>(clamp(b)) << 16) | (static_cast<u32>(clamp(a)) << 24);
}

inline u32 packColor(const glm::vec4& c) {
    return packColor(c.r, c.g, c.b, c.a);
}

}  // namespace esengine

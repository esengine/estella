// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ImpostorFrames.hpp
 * @brief   Which direction each picture of an impostor atlas is taken from, and which picture a view is shown.
 *
 * @details The pictures cover the upper half of a sphere on a hemi-octahedral grid: the square folds onto the hemisphere with its
 *          centre straight above and its edges round the horizon, so every grid point is a usable direction and the pictures are
 *          spread evenly. Frame (i, j) is taken from the grid point at (i, j) / (frames - 1), so the horizon is in the set. The SDK's
 *          bake places its cameras by the same rule (`impostorFrameDirection` in sdk/src/render/impostor.ts); the two are held to each
 *          other by tests on both sides.
 *
 *          Header-only and free of the renderer: a direction and a frame count are the whole input.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../math/Math.hpp"

#include <algorithm>
#include <cmath>

namespace esengine::impostor {

/** @brief Where on the unit square a direction of the upper hemisphere folds to. Below the horizon is taken as on it. */
inline glm::vec2 encode(glm::vec3 d) {
    d.y = std::max(d.y, 0.0f);
    const f32 s = std::abs(d.x) + std::abs(d.y) + std::abs(d.z);
    if (s < 1e-12f) return glm::vec2(0.5f);
    const f32 px = d.x / s, pz = d.z / s;
    return glm::vec2((px + pz) * 0.5f + 0.5f, (px - pz) * 0.5f + 0.5f);
}

/** @brief The direction a point of the unit square unfolds to. */
inline glm::vec3 decode(glm::vec2 uv) {
    const f32 qx = uv.x * 2.0f - 1.0f, qy = uv.y * 2.0f - 1.0f;
    const f32 px = (qx + qy) * 0.5f, pz = (qx - qy) * 0.5f;
    const f32 y = 1.0f - std::abs(px) - std::abs(pz);
    return glm::normalize(glm::vec3(px, std::max(y, 0.0f), pz));
}

/** @brief The direction, from the object toward the camera, that frame (@p i, @p j) is taken from. */
inline glm::vec3 frameDirection(u32 i, u32 j, u32 frames) {
    const f32 last = static_cast<f32>(std::max(frames, 2u) - 1u);
    return decode(glm::vec2(static_cast<f32>(i) / last, static_cast<f32>(j) / last));
}

/** @brief The frame taken nearest @p d, a direction from the object toward the viewer in the object's own space. */
inline glm::uvec2 nearestFrame(const glm::vec3& d, u32 frames) {
    const glm::vec2 uv = encode(d);
    const f32 last = static_cast<f32>(std::max(frames, 2u) - 1u);
    const u32 i = static_cast<u32>(std::clamp(std::lround(uv.x * last), 0L, static_cast<long>(last)));
    const u32 j = static_cast<u32>(std::clamp(std::lround(uv.y * last), 0L, static_cast<long>(last)));
    return {i, j};
}

/**
 * @brief The up a picture is taken with from @p d: world up laid flat across the view.
 *
 * @details Straight overhead there is no such thing, and -Z stands in (the bake's camera looks down with the object's -Z at the
 *          top of the picture). The card is drawn with the same rule, so a picture and its card agree on which way is up.
 */
inline glm::vec3 pictureUp(const glm::vec3& d) {
    glm::vec3 up = glm::vec3(0.0f, 1.0f, 0.0f) - d * d.y;
    if (glm::dot(up, up) < 1e-8f) return glm::vec3(0.0f, 0.0f, -1.0f);
    return glm::normalize(up);
}

}  // namespace esengine::impostor

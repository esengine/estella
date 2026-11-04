// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BillboardFacing.hpp
 * @brief   The rotation that turns a card to a view.
 *
 * @details Header-only and free of the renderer: a view-projection, the view's eye and where the card stands are the whole input, so the
 *          arithmetic can be held against its claims without a device.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../math/Math.hpp"

#include <glm/gtc/quaternion.hpp>

#include <cmath>

namespace esengine::billboard {

/** @brief The view's right, up and toward-the-viewer axes in the world, read off its view-projection. */
struct ViewAxes {
    glm::vec3 right{1.0f, 0.0f, 0.0f};
    glm::vec3 up{0.0f, 1.0f, 0.0f};
    glm::vec3 back{0.0f, 0.0f, 1.0f};
};

/**
 * @brief The axes a view looks along.
 *
 * @details NDC x and y are the view's right and up scaled by the projection, so the first two rows of the view-projection point along them
 *          under both projections (a jittered or off-centre frustum leans them by its tiny skew, and the cross products below take that out).
 *          Toward the viewer is their cross product: the camera looks down its own -Z.
 */
inline ViewAxes viewAxes(const glm::mat4& viewProjection) {
    const glm::vec3 row0(viewProjection[0][0], viewProjection[1][0], viewProjection[2][0]);
    const glm::vec3 row1(viewProjection[0][1], viewProjection[1][1], viewProjection[2][1]);
    ViewAxes axes;
    if (glm::dot(row0, row0) < 1e-20f || glm::dot(row1, row1) < 1e-20f) return axes;
    const glm::vec3 right = glm::normalize(row0);
    const glm::vec3 back = glm::cross(right, glm::normalize(row1));
    if (glm::dot(back, back) < 1e-12f) return axes;
    axes.back = glm::normalize(back);
    axes.right = right;
    axes.up = glm::cross(axes.back, axes.right);
    return axes;
}

/**
 * @brief The rotation a card standing at @p position is drawn with in this view.
 *
 * @param mode           0 lies flat in the view plane; 1 turns about world up only.
 * @param viewProjection The view's, which is where the view plane comes from.
 * @param eye            The view's eye in FrameConstants::camera's convention: a position when w = 1, the direction toward the viewer when
 *                       w = 0 (an orthographic view, which has no position).
 */
inline glm::quat facing(i32 mode, const glm::mat4& viewProjection, const glm::vec4& eye, const glm::vec3& position) {
    const ViewAxes axes = viewAxes(viewProjection);
    if (mode != 1) {
        // Columns are where the card's own +X, +Y and +Z go.
        return glm::quat_cast(glm::mat3(axes.right, axes.up, axes.back));
    }
    // Upright: toward the viewer, flattened onto the ground. Straight overhead there is no such direction, and the view plane's own back,
    // flattened, is what keeps the card from spinning as the camera passes over it.
    glm::vec3 toward = eye.w > 0.5f ? glm::vec3(eye) - position : glm::vec3(eye);
    toward.y = 0.0f;
    if (glm::dot(toward, toward) < 1e-8f) {
        toward = glm::vec3(axes.back.x, 0.0f, axes.back.z);
        if (glm::dot(toward, toward) < 1e-8f) toward = -glm::vec3(axes.up.x, 0.0f, axes.up.z);
        if (glm::dot(toward, toward) < 1e-8f) return glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    }
    const f32 yaw = std::atan2(toward.x, toward.z);
    return glm::angleAxis(yaw, glm::vec3(0.0f, 1.0f, 0.0f));
}

}  // namespace esengine::billboard

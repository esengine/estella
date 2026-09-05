// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Frustum.hpp
 * @brief   The six planes a projection bounds, and the box test against them.
 *
 * @details Its own header because both sides of the collect need it: the frame
 *          builds one, and the collect context each plugin is handed answers
 *          "is this visible" with it. Left inside RenderFrame.hpp those two
 *          could not both see it — RenderFrame.hpp includes RenderTypePlugin.hpp,
 *          so the plugin side only ever had a forward declaration.
 */
#pragma once

#include "../../core/Types.hpp"

#include <glm/glm.hpp>

namespace esengine {

struct Plane {
    glm::vec3 normal;
    f32 distance;
    f32 signedDistance(const glm::vec3& point) const;
};

struct Frustum {
    Plane planes[6];
    void extractFromMatrix(const glm::mat4& vp);
    bool intersectsAABB(const glm::vec3& center, const glm::vec3& halfExtents) const;
};

}  // namespace esengine

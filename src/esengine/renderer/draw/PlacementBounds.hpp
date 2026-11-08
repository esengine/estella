// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PlacementBounds.hpp
 * @brief   Conservative mesh reach and affine stretch for native placements.
 */
#pragma once

#include "../../core/Types.hpp"
#include <glm/glm.hpp>
#include <algorithm>
#include <cmath>

namespace esengine::placement_bounds {

/** Radius about the placement origin, including the material's local displacement. */
inline f32 radius(const glm::vec3& lo, const glm::vec3& hi, f32 displacement) {
    return glm::length(glm::max(glm::abs(lo), glm::abs(hi)) + glm::vec3(std::max(displacement, 0.0f)));
}

/** Squared stretch bound for the linear part of a row-major 3x4 placement. */
inline f32 stretchSquared(const f32* rows) {
    const glm::vec3 a(rows[0], rows[4], rows[8]);
    const glm::vec3 b(rows[1], rows[5], rows[9]);
    const glm::vec3 c(rows[2], rows[6], rows[10]);
    const f32 ab = std::abs(glm::dot(a, b));
    const f32 ac = std::abs(glm::dot(a, c));
    const f32 bc = std::abs(glm::dot(b, c));
    // The maximum absolute row sum of A^T A bounds its largest eigenvalue.
    // Orthogonal TRS columns retain the exact longest scale; shears remain conservative.
    return std::max({glm::dot(a, a) + ab + ac, glm::dot(b, b) + ab + bc, glm::dot(c, c) + ac + bc});
}

/** Transforms a local box through the complete placement and parent linear transforms. */
inline void transformedBox(const glm::mat3& parent, const f32* rows, const glm::vec3& origin,
                           const glm::vec3& localCentre, const glm::vec3& localHalf,
                           glm::vec3& centre, glm::vec3& half) {
    const glm::vec3 a = parent * glm::vec3(rows[0], rows[4], rows[8]);
    const glm::vec3 b = parent * glm::vec3(rows[1], rows[5], rows[9]);
    const glm::vec3 c = parent * glm::vec3(rows[2], rows[6], rows[10]);
    centre = origin + a * localCentre.x + b * localCentre.y + c * localCentre.z;
    half = glm::abs(a) * localHalf.x + glm::abs(b) * localHalf.y + glm::abs(c) * localHalf.z;
}

}  // namespace esengine::placement_bounds

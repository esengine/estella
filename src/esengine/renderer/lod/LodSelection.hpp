// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LodSelection.hpp
 * @brief   Which representation an object's size on screen asks for.
 *
 * @details Header-only and free of the renderer, so the arithmetic can be held
 *          against its own claims without a device: a projection, a sphere and
 *          the level last shown are the whole input.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../math/Math.hpp"

#include <glm/gtc/quaternion.hpp>

#include <cmath>

namespace esengine::lod {

/** @brief How many stand-ins a group may declare beyond the renderer's own mesh. */
inline constexpr u8 kMaxStandIns = 3;

/** @brief The level of an object small enough that nothing is drawn for it. */
inline constexpr u8 kCulled = 0xFFu;

/**
 * @brief What a point at or behind the eye reports.
 *
 * @details It has no finite projection, and the only useful answer there is the
 *          one that picks the nearest level rather than the farthest.
 */
inline constexpr f32 kSizeAtEye = 1e30f;

/**
 * @brief The screen sizes a group hands over at, in the order it hands them over.
 *
 * @details `takeOver[i]` is the boundary between level `i` and level `i+1` and
 *          must descend; `cull` is the last boundary of all. `hysteresis` is the
 *          fraction a boundary is raised by to be crossed toward the FINER side.
 */
struct LevelSet {
    f32 takeOver[kMaxStandIns]{};
    f32 cull = 0.0f;
    f32 hysteresis = 0.0f;
    u8 count = 0;
};

/**
 * @brief The sphere a group is measured by: its centre in the world and its radius.
 *
 * @details A sphere rather than the turned box, because the radius is the same at
 *          every angle — a box's projected size breathes as its owner spins, which
 *          at a boundary is a level that changes for no reason but rotation.
 */
inline void boundingSphere(const glm::vec3& position, const glm::quat& rotation,
                           const glm::vec3& scale, const glm::vec3& localMin,
                           const glm::vec3& localMax, glm::vec3& outCentre, f32& outRadius) {
    const glm::vec3 scaledHalf = glm::abs((localMax - localMin) * 0.5f * scale);
    outCentre = position + glm::mat3_cast(rotation) * ((localMin + localMax) * 0.5f * scale);
    outRadius = glm::length(scaledHalf);
}

/**
 * @brief How much of the viewport's HEIGHT a sphere covers: 1 = one screen high.
 *
 * @details The gradient of NDC y with respect to world position, times the radius;
 *          NDC spans 2, so that ratio IS the fraction. Both projections are in the
 *          matrix, so one expression answers for both. A fraction of the height is
 *          free of the viewport's pixel count and of its aspect.
 */
inline f32 screenRelativeSize(const glm::mat4& viewProjection, const glm::vec3& centre,
                              f32 radius) {
    const glm::vec4 clip = viewProjection * glm::vec4(centre, 1.0f);
    if (clip.w <= 1e-6f) return kSizeAtEye;
    const glm::vec3 row1(viewProjection[0][1], viewProjection[1][1], viewProjection[2][1]);
    const glm::vec3 row3(viewProjection[0][3], viewProjection[1][3], viewProjection[2][3]);
    // The term in ndcY is the stretch toward the edges of a perspective frame; it
    // falls out on its own under a projection that has none.
    const glm::vec3 gradient = (row1 - (clip.y / clip.w) * row3) / clip.w;
    return radius * glm::length(gradient);
}

/**
 * @brief The level @p size asks for, given the one shown last.
 *
 * @details Each boundary is asymmetric — `takeOver * (1 + hysteresis)` to come back
 *          toward the fine side, the bare threshold to go coarse — because a
 *          boundary that is not a wall flips every frame for a breathing camera.
 *          @p current biases by one band only, so a stale one costs a frame.
 */
inline u8 selectLevel(const LevelSet& set, f32 size, u8 current) {
    u8 level = 0;
    for (u8 i = 0; i < set.count && i < kMaxStandIns; ++i) {
        const u8 candidate = static_cast<u8>(i + 1);
        const bool coarseSide = current >= candidate;
        if (size >= set.takeOver[i] * (coarseSide ? 1.0f + set.hysteresis : 1.0f)) break;
        level = candidate;
    }
    if (set.cull > 0.0f) {
        const bool wasCulled = current == kCulled;
        if (size < set.cull * (wasCulled ? 1.0f + set.hysteresis : 1.0f)) return kCulled;
    }
    return level;
}

/**
 * @brief What a frame's selections came to, counted where each one is made.
 *
 * @details One SELECTION per view per object, not one per object: a frame with two
 *          cameras counts the same object twice, and the two counts differing is
 *          the only evidence that the two views decided independently.
 */
struct SelectionCounts {
    u32 selections = 0;
    u32 level[kMaxStandIns + 1]{};
    u32 culled = 0;

    void record(u8 level_) {
        ++selections;
        if (level_ == kCulled) ++culled;
        else if (level_ <= kMaxStandIns) ++level[level_];
    }
};

}  // namespace esengine::lod

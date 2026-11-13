// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Transform.hpp
 * @brief   Unified Transform component with local and world-space data
 * @details Single component storing both local (user-controlled) and world-space
 *          (system-computed) transforms. Uses quaternions for rotation.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

#include <cstring>
#include <limits>

namespace esengine::ecs {

/**
 * @brief Unified transform component
 *
 * @details Contains both local (relative to parent) and world-space transforms.
 *          Local fields (position, rotation, scale) are user-controlled.
 *          World fields (worldPosition, worldRotation, worldScale) are computed
 *          by TransformSystem each frame.
 *
 * @code
 * Entity e = registry.create();
 * registry.emplace<Transform>(e, glm::vec3(10.0f, 0.0f, 0.0f));
 *
 * auto& transform = registry.get<Transform>(e);
 * transform.position.x = 5.0f;  // set local
 * // After TransformSystem runs:
 * // transform.worldPosition contains final world-space position
 * @endcode
 */
ES_COMPONENT(stability=public)
struct Transform {
    ES_PROPERTY(animatable, anim_override, replicated, tooltip="Local position in world units, relative to the parent.")
    glm::vec3 position{0.0f, 0.0f, 0.0f};

    ES_PROPERTY(animatable, anim_override, replicated, tooltip="Local rotation in degrees, applied X then Y then Z. 2D content turns about Z alone.")
    glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};

    ES_PROPERTY(animatable, anim_override, replicated, tooltip="Local scale per axis (1 = original size; negative flips).")
    glm::vec3 scale{1.0f, 1.0f, 1.0f};

    ES_PROPERTY(readonly)
    glm::vec3 worldPosition{0.0f, 0.0f, 0.0f};

    ES_PROPERTY(readonly)
    glm::quat worldRotation{1.0f, 0.0f, 0.0f, 0.0f};

    ES_PROPERTY(readonly)
    glm::vec3 worldScale{1.0f, 1.0f, 1.0f};

    glm::mat4 cachedMatrix_{std::numeric_limits<f32>::quiet_NaN()};
    bool decomposed_ = true;

    void ensureDecomposed() {
        if (!decomposed_) {
            math::decompose(cachedMatrix_, worldPosition, worldRotation, worldScale);
            decomposed_ = true;
        }
    }

    /**
     * @brief What the change audit takes as unchanged since @p kept (Registry::auditChanges).
     * @details The local fields and the world matrix, bit for bit. The world fields too, except where they were filled in since:
     *          ensureDecomposed() reads them out of a matrix that did not change, which is a read made lazily, not a write.
     *          Fields that differ under the same matrix, both already filled, were written.
     */
    bool auditSame(const Transform& kept) const {
        const auto same = [](const auto& a, const auto& b) { return std::memcmp(&a, &b, sizeof(a)) == 0; };
        if (!same(position, kept.position) || !same(rotation, kept.rotation) || !same(scale, kept.scale)
            || !same(cachedMatrix_, kept.cachedMatrix_)) {
            return false;
        }
        if (!decomposed_ || !kept.decomposed_) return true;
        return same(worldPosition, kept.worldPosition) && same(worldRotation, kept.worldRotation)
            && same(worldScale, kept.worldScale);
    }

    Transform() = default;

    explicit Transform(const glm::vec3& pos) : position(pos) {}

    Transform(const glm::vec3& pos, const glm::quat& rot)
        : position(pos), rotation(rot) {}

    Transform(const glm::vec3& pos, const glm::quat& rot, const glm::vec3& scl)
        : position(pos), rotation(rot), scale(scl) {}
};

struct TransformDirty {};

struct TransformStatic {};

}  // namespace esengine::ecs

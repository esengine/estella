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
 *            Licensed under the MIT License.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

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
ES_COMPONENT()
struct Transform {
    ES_PROPERTY(animatable, anim_override)
    glm::vec3 position{0.0f, 0.0f, 0.0f};

    ES_PROPERTY(animatable, anim_override)
    glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};

    ES_PROPERTY(animatable, anim_override)
    glm::vec3 scale{1.0f, 1.0f, 1.0f};

    ES_PROPERTY()
    glm::vec3 worldPosition{0.0f, 0.0f, 0.0f};

    ES_PROPERTY()
    glm::quat worldRotation{1.0f, 0.0f, 0.0f, 0.0f};

    ES_PROPERTY()
    glm::vec3 worldScale{1.0f, 1.0f, 1.0f};

    glm::mat4 cachedMatrix_{1.0f};
    bool decomposed_ = true;

    void ensureDecomposed() {
        if (!decomposed_) {
            math::decompose(cachedMatrix_, worldPosition, worldRotation, worldScale);
            decomposed_ = true;
        }
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

/**
 * @file    Camera.hpp
 * @brief   Camera component for rendering viewpoints
 * @details Provides Camera component supporting perspective and orthographic projections.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

// =============================================================================
// Projection Type
// =============================================================================

/**
 * @brief Camera projection type
 */
ES_ENUM()
enum class ProjectionType : u8 {
    Perspective,
    Orthographic
};

// =============================================================================
// Camera Component
// =============================================================================

/**
 * @brief Camera component for rendering viewpoints
 *
 * @details Defines a camera that can be used to render the scene.
 *          Supports both perspective and orthographic projections.
 *
 * @code
 * Entity camera = registry.create();
 * registry.emplace<LocalTransform>(camera, glm::vec3(0, 0, 10));
 * auto& cam = registry.emplace<Camera>(camera);
 * cam.projectionType = ProjectionType::Perspective;
 * cam.fov = 60.0f;
 * cam.isActive = true;
 * @endcode
 */
ES_COMPONENT()
struct Camera {
    /** @brief Projection type */
    ES_PROPERTY()
    ProjectionType projectionType{ProjectionType::Perspective};

    /** @brief Field of view in degrees (perspective only) */
    ES_PROPERTY()
    f32 fov{60.0f};

    /** @brief Orthographic size (half-height in world units) */
    ES_PROPERTY()
    f32 orthoSize{5.0f};

    /** @brief Near clipping plane distance */
    ES_PROPERTY()
    f32 nearPlane{0.1f};

    /** @brief Far clipping plane distance */
    ES_PROPERTY()
    f32 farPlane{1000.0f};

    /** @brief Aspect ratio (width / height), 0 = auto from viewport */
    ES_PROPERTY()
    f32 aspectRatio{0.0f};

    /** @brief Whether this is the active camera */
    ES_PROPERTY()
    bool isActive{false};

    /** @brief Priority for determining active camera (higher = preferred) */
    ES_PROPERTY()
    i32 priority{0};

    Camera() = default;
};

}  // namespace esengine::ecs

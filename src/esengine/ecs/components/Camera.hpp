// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Camera.hpp
 * @brief   Camera component for rendering viewpoints
 * @details Provides Camera component supporting perspective and orthographic projections.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

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

/**
 * @brief Camera clear flags
 */
ES_ENUM()
enum class ClearFlags : u8 {
    Nothing,
    Color,
    Depth,
    ColorAndDepth
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
 * registry.emplace<Transform>(camera, glm::vec3(0, 0, 10));
 * auto& cam = registry.emplace<Camera>(camera);
 * cam.projectionType = ProjectionType::Perspective;
 * cam.fov = 60.0f;
 * cam.isActive = true;
 * @endcode
 */
ES_COMPONENT()
struct Camera {
    /** @brief Projection type */
    ES_PROPERTY(tooltip="Orthographic (2D) or Perspective projection.")
    ProjectionType projectionType{ProjectionType::Perspective};

    /** @brief Field of view in degrees (perspective only) */
    ES_PROPERTY(min=1, max=179, unit="°")
    f32 fov{60.0f};

    /** @brief Orthographic size (half-height in world units) */
    ES_PROPERTY(animatable, min=0, tooltip="Half the visible height in world units (Orthographic).")
    f32 orthoSize{5.0f};

    /** @brief Near clipping plane distance */
    ES_PROPERTY(min=0, advanced)
    f32 nearPlane{0.1f};

    /** @brief Far clipping plane distance */
    ES_PROPERTY(min=0, advanced)
    f32 farPlane{1000.0f};

    /** @brief Aspect ratio (width / height), 0 = auto from viewport */
    ES_PROPERTY(advanced)
    f32 aspectRatio{0.0f};

    /** @brief Whether this is the active camera */
    ES_PROPERTY()
    bool isActive{false};

    /** @brief Priority for determining active camera (higher = preferred) */
    ES_PROPERTY(step=1, advanced)
    i32 priority{0};

    /** @brief Viewport rectangle (x, y, width, height) in normalized coords */
    ES_PROPERTY()
    glm::vec4 viewport{0.0f, 0.0f, 1.0f, 1.0f};

    // A bitmask (ColorAndDepth = Color | Depth) → multi-select, so the curated bit
    // list lives in TS and the single-choice enum dropdown is suppressed (flags).
    ES_PROPERTY(flags, tooltip="Which buffers to clear before rendering this camera.")
    ClearFlags clearFlags{ClearFlags::ColorAndDepth};

    /** @brief Snap the camera to the world-space pixel grid (Orthographic) so static
     *         pixel art renders crisp, without sub-pixel shimmer when the camera moves. */
    ES_PROPERTY(advanced, tooltip="Snap the camera to the pixel grid for crisp pixel-art (Orthographic).")
    bool pixelPerfect{false};

    Camera() = default;
};

}  // namespace esengine::ecs

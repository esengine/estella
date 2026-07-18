// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Canvas.hpp
 * @brief   Canvas component for 2D game resolution management
 * @details Provides Canvas component for defining design resolution,
 *          pixels-per-unit, and screen scaling behavior.
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
// Scale Mode
// =============================================================================

/**
 * @brief Canvas scaling mode for different screen resolutions
 */
ES_ENUM()
enum class CanvasScaleMode : u8 {
    FixedWidth,
    FixedHeight,
    Expand,
    Shrink,
    Match
};

// =============================================================================
// Canvas Component
// =============================================================================

/**
 * @brief Canvas component for 2D game resolution management
 *
 * @details Defines the design resolution and scaling behavior for 2D games.
 *          The Canvas works with the Camera component to ensure consistent
 *          rendering across different screen resolutions.
 *
 * @code
 * Entity canvas = registry.create();
 * auto& c = registry.emplace<Canvas>(canvas);
 * c.designResolution = {1920, 1080};
 * c.pixelsPerUnit = 100.0f;  // 100 pixels = 1 world unit
 * c.scaleMode = CanvasScaleMode::FixedHeight;
 * @endcode
 *
 * Workflow:
 * 1. Artist creates assets at design resolution (e.g., 1920x1080)
 * 2. World units are design pixels: a 100x200 texture spawns a 100x200 sprite,
 *    and the default scene camera shows designResolution.y world units of height
 *    (orthoSize = designResolution.y / 2)
 * 3. pixelsPerUnit is the physics scale: world pixels per Box2D meter
 * 4. At runtime, scaleMode fits the design resolution to the actual screen
 */
ES_COMPONENT()
struct Canvas {
    /** @brief Design resolution in pixels */
    ES_PROPERTY()
    glm::uvec2 designResolution{1920, 1080};

    /** @brief World pixels per physics meter (e.g., 100 means 100px = 1 Box2D meter) */
    ES_PROPERTY(min=1, tooltip="World pixels per physics meter (Box2D + tile collider scale).")
    f32 pixelsPerUnit{100.0f};

    /** @brief Scaling mode for different screen resolutions */
    ES_PROPERTY(tooltip="How the canvas adapts the design resolution to the screen.")
    CanvasScaleMode scaleMode{CanvasScaleMode::FixedHeight};

    /** @brief Match factor for Match scale mode (0 = width, 1 = height) */
    ES_PROPERTY(min=0, max=1, slider, tooltip="0 matches width, 1 matches height (Match mode only).")
    f32 matchWidthOrHeight{0.5f};

    /** @brief Background color for letterbox/pillarbox areas */
    ES_PROPERTY()
    glm::vec4 backgroundColor{0.0f, 0.0f, 0.0f, 1.0f};

    Canvas() = default;

    /**
     * @brief Calculate orthographic camera size for this canvas
     * @return Half-height in world units for orthographic projection
     */
    f32 getOrthoSize() const {
        return (static_cast<f32>(designResolution.y) * 0.5f) / pixelsPerUnit;
    }

    /**
     * @brief Calculate design aspect ratio
     * @return Width / Height ratio
     */
    f32 getDesignAspectRatio() const {
        return static_cast<f32>(designResolution.x) / static_cast<f32>(designResolution.y);
    }

    /**
     * @brief Calculate world size of the design resolution
     * @return Size in world units
     */
    glm::vec2 getWorldSize() const {
        return glm::vec2(designResolution) / pixelsPerUnit;
    }

    /**
     * @brief Convert pixel position to world position
     * @param pixelPos Position in pixels (origin at bottom-left)
     * @return Position in world units (centered origin)
     */
    glm::vec2 pixelToWorld(const glm::vec2& pixelPos) const {
        glm::vec2 worldSize = getWorldSize();
        return (pixelPos / pixelsPerUnit) - (worldSize * 0.5f);
    }

    /**
     * @brief Convert world position to pixel position
     * @param worldPos Position in world units
     * @return Position in pixels (origin at bottom-left)
     */
    glm::vec2 worldToPixel(const glm::vec2& worldPos) const {
        glm::vec2 worldSize = getWorldSize();
        return (worldPos + worldSize * 0.5f) * pixelsPerUnit;
    }
};

}  // namespace esengine::ecs

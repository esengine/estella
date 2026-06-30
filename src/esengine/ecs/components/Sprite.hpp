// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Sprite.hpp
 * @brief   2D sprite rendering component
 * @details Provides Sprite component for 2D rendering with texture handles.
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
#include "../../resource/Handle.hpp"

namespace esengine::ecs {

// =============================================================================
// Sprite Component
// =============================================================================

/**
 * @brief 2D sprite component for rendering
 *
 * @details Contains all data needed to render a 2D sprite including
 *          texture handle, color tint, size, UV coordinates, and
 *          sorting layer.
 *
 * @code
 * Entity e = registry.create();
 * auto& sprite = registry.emplace<Sprite>(e);
 * sprite.texture = resourceManager.loadTexture("player.png");
 * sprite.color = glm::vec4(1.0f, 0.5f, 0.5f, 1.0f); // Red tint
 * sprite.layer = 10; // Render on top
 * @endcode
 */
ES_COMPONENT()
struct Sprite {
    /** @brief Texture resource handle (type-safe) */
    ES_PROPERTY(asset = texture)
    resource::TextureHandle texture;

    /** @brief Color tint (RGBA, 0-1 range) */
    ES_PROPERTY(animatable, tooltip="Tint multiplied into the texture (white = unchanged).")
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    /** @brief Sprite size in world units */
    ES_PROPERTY(animatable)
    glm::vec2 size{1.0f, 1.0f};

    /** @brief Pivot point (0,0 = bottom-left, 0.5,0.5 = center, 1,1 = top-right) */
    ES_PROPERTY(advanced, tooltip="Anchor point (0–1) the sprite rotates and scales about.")
    glm::vec2 pivot{0.5f, 0.5f};

    /** @brief UV coordinate offset for sprite sheets */
    ES_PROPERTY(advanced)
    glm::vec2 uvOffset{0.0f, 0.0f};

    /** @brief UV coordinate scale for sprite sheets */
    ES_PROPERTY(advanced)
    glm::vec2 uvScale{1.0f, 1.0f};

    /** @brief Sorting layer (higher = rendered on top) */
    ES_PROPERTY(step=1, enum_source=sortingLayers, tooltip="Sorting layer — controls draw order across sprites.")
    i32 layer{0};

    /** @brief Flip sprite horizontally */
    ES_PROPERTY()
    bool flipX{false};

    /** @brief Flip sprite vertically */
    ES_PROPERTY()
    bool flipY{false};

    /** @brief Tile size in world units for tiling mode ({0,0} = no tiling) */
    ES_PROPERTY(advanced)
    glm::vec2 tileSize{0.0f, 0.0f};

    /** @brief Spacing between tiles in world units ({0,0} = seamless) */
    ES_PROPERTY(advanced)
    glm::vec2 tileSpacing{0.0f, 0.0f};

    /** @brief Parallax scroll factor per axis. 1 = moves with the world (default, no
     *         parallax); <1 = scrolls slower than the camera (appears farther, e.g. a
     *         background); 0 = locked to the camera (e.g. a sky). The renderer offsets
     *         the sprite by camera_center * (1 - factor). */
    ES_PROPERTY(advanced, tooltip="Parallax scroll factor (1 = with world, <1 = slower, 0 = locked to camera).")
    glm::vec2 parallax{1.0f, 1.0f};

    /** @brief Custom material ID (0 = use default batch shader) */
    ES_PROPERTY(asset = material, advanced)
    u32 material{0};

    ES_PROPERTY()
    bool enabled{true};

    /** @brief Default constructor (white, no texture) */
    Sprite() = default;

    /**
     * @brief Constructs sprite with texture handle
     * @param tex Texture resource handle
     */
    explicit Sprite(resource::TextureHandle tex) : texture(tex) {}

    /**
     * @brief Constructs sprite with texture and color tint
     * @param tex Texture resource handle
     * @param col Color tint
     */
    Sprite(resource::TextureHandle tex, const glm::vec4& col)
        : texture(tex), color(col) {}
};

}  // namespace esengine::ecs

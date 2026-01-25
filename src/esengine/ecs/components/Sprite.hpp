/**
 * @file    Sprite.hpp
 * @brief   2D sprite rendering component
 * @details Provides Sprite component for 2D rendering with texture handles.
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
struct Sprite {
    /** @brief Texture resource handle (type-safe) */
    resource::TextureHandle texture;

    /** @brief Color tint (RGBA, 0-1 range) */
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    /** @brief Sprite size in world units */
    glm::vec2 size{1.0f, 1.0f};

    /** @brief UV coordinate offset for sprite sheets */
    glm::vec2 uvOffset{0.0f, 0.0f};

    /** @brief UV coordinate scale for sprite sheets */
    glm::vec2 uvScale{1.0f, 1.0f};

    /** @brief Sorting layer (higher = rendered on top) */
    i32 layer{0};

    /** @brief Flip sprite horizontally */
    bool flipX{false};

    /** @brief Flip sprite vertically */
    bool flipY{false};

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

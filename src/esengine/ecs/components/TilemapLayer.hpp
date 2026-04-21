/**
 * @file    TilemapLayer.hpp
 * @brief   Tilemap layer ECS component (editor-facing metadata)
 * @details The ECS component holds only the fields the editor needs to
 *          show in the Inspector and to round-trip through scene I/O.
 *          Heavy runtime state — chunks, per-tile animations, tile
 *          properties — lives in TilemapSystem::LayerData keyed by this
 *          entity, same split SpineAnimation uses with SpineResourceManager.
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
// TilemapLayer Component
// =============================================================================

/**
 * @brief Editor-facing metadata for a tilemap layer entity
 *
 * @details The bulk tile data (chunks, animations, per-tile properties)
 *          lives in TilemapSystem's LayerData keyed by this entity —
 *          see TilemapSystem for why the heavy state is held out-of-
 *          component. Chunks flow through the
 *          tilemap_exportChunks / tilemap_importChunks bindings during
 *          scene serialization so the component itself stays light.
 */
ES_COMPONENT()
struct TilemapLayer {
    /** @brief Size in world units of one tile cell */
    ES_PROPERTY()
    glm::vec2 cellSize{32.0f, 32.0f};

    /**
     * @brief World offset applied before rendering
     * @details Per-layer parallax scales this by the camera position so
     *          background layers can drift more slowly.
     */
    ES_PROPERTY()
    glm::vec2 originOffset{0.0f, 0.0f};

    /**
     * @brief Texture atlas from which tile IDs index quads
     * @details Tile 0 is always treated as empty; IDs 1..N index into
     *          the atlas row-major.
     */
    ES_PROPERTY(asset = texture)
    resource::TextureHandle tileset;

    /** @brief Atlas layout: columns of tiles in the tileset texture */
    ES_PROPERTY()
    i32 tilesetColumns{1};

    /** @brief Atlas layout: rows of tiles in the tileset texture */
    ES_PROPERTY()
    i32 tilesetRows{1};

    /** @brief Sort order within the 2D renderer. Lower draws first */
    ES_PROPERTY()
    i32 renderLayer{0};

    /** @brief Multiplied against the tile sample colour before blending */
    ES_PROPERTY(animatable)
    glm::vec4 tintColor{1.0f, 1.0f, 1.0f, 1.0f};

    /** @brief Multiplied into the alpha channel of tintColor at submit time */
    ES_PROPERTY(animatable)
    f32 opacity{1.0f};

    /**
     * @brief Per-axis parallax factor
     * @details 1.0 = locked to camera, 0.0 = static background.
     *          Evaluated against the active camera each frame.
     */
    ES_PROPERTY()
    glm::vec2 parallaxFactor{1.0f, 1.0f};

    /** @brief Whether the layer is drawn this frame */
    ES_PROPERTY()
    bool visible{true};

    /**
     * @brief Runtime-only dirty flag for TilemapSystem
     * @details Set by TilemapSystem when author-settable fields (tint,
     *          visible, render layer) need to sync back into LayerData.
     *          Not ES_PROPERTY — not author data, not serialized.
     *          Starts true so the first tick after spawn pushes the
     *          component defaults through.
     */
    bool needsSync{true};

    TilemapLayer() = default;
};

}  // namespace esengine::ecs

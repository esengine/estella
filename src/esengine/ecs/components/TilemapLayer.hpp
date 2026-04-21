/**
 * @file    TilemapLayer.hpp
 * @brief   Tilemap layer ECS component (editor-facing metadata)
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

namespace esengine::ecs {

/**
 * Heavy tile data (chunks, animations, per-tile properties) lives in
 * TilemapSystem's LayerData keyed by this entity. Chunks flow through
 * tilemap_exportChunks / tilemap_importChunks during scene I/O.
 */
ES_COMPONENT()
struct TilemapLayer {
    ES_PROPERTY()
    glm::vec2 cellSize{32.0f, 32.0f};

    ES_PROPERTY()
    glm::vec2 originOffset{0.0f, 0.0f};

    ES_PROPERTY(asset = texture)
    resource::TextureHandle tileset;

    ES_PROPERTY()
    i32 tilesetColumns{1};

    ES_PROPERTY()
    i32 tilesetRows{1};

    ES_PROPERTY()
    i32 renderLayer{0};

    ES_PROPERTY(animatable)
    glm::vec4 tintColor{1.0f, 1.0f, 1.0f, 1.0f};

    ES_PROPERTY(animatable)
    f32 opacity{1.0f};

    ES_PROPERTY()
    glm::vec2 parallaxFactor{1.0f, 1.0f};

    ES_PROPERTY()
    bool visible{true};

    // Runtime-only; not ES_PROPERTY so it isn't serialized.
    bool needsSync{true};

    TilemapLayer() = default;
};

}  // namespace esengine::ecs

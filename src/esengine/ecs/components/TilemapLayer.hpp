#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

namespace esengine::ecs {

// Visible editor-facing metadata for a tilemap layer entity. The bulk tile
// data (chunks, animations, per-tile properties) lives in TilemapSystem's
// LayerData keyed by this entity — see TilemapSystem for why the heavy
// state is held out-of-component. The split mirrors SpineAnimation, where
// the component describes "what this layer is" and the system owns the
// resolved runtime state.
ES_COMPONENT()
struct TilemapLayer {
    // Size in world units of one tile cell.
    ES_PROPERTY()
    glm::vec2 cellSize{32.0f, 32.0f};

    // World offset applied before rendering. Per-layer parallax scales this
    // by the camera position so background layers can drift more slowly.
    ES_PROPERTY()
    glm::vec2 originOffset{0.0f, 0.0f};

    // Texture atlas from which tile IDs index quads. Tile 0 is always
    // treated as empty; IDs 1..N index into the atlas row-major.
    ES_PROPERTY(asset = texture)
    resource::TextureHandle tileset;

    // Atlas layout: columns × rows of tiles in the tileset texture. Used
    // to compute the per-tile UV rect on render.
    ES_PROPERTY()
    i32 tilesetColumns{1};

    ES_PROPERTY()
    i32 tilesetRows{1};

    // Sort order within the 2D renderer. Lower draws first.
    ES_PROPERTY()
    i32 renderLayer{0};

    // Multiplied against the tile sample colour before blending.
    ES_PROPERTY(animatable)
    glm::vec4 tintColor{1.0f, 1.0f, 1.0f, 1.0f};

    // Multiplied into the alpha channel of tintColor at submit time.
    ES_PROPERTY(animatable)
    f32 opacity{1.0f};

    // Per-axis parallax factor (1.0 = locked to camera, 0.0 = static
    // background). Evaluated against the active camera each frame.
    ES_PROPERTY()
    glm::vec2 parallaxFactor{1.0f, 1.0f};

    ES_PROPERTY()
    bool visible{true};

    // Runtime-only: set by TilemapSystem when it needs to sync author-
    // settable fields (tint, visible, render layer) from the component
    // back into LayerData. Not ES_PROPERTY — not author data, not
    // serialized. Starts true so the first tick after spawn pushes the
    // component defaults through.
    bool needsSync{true};

    TilemapLayer() = default;
};

}  // namespace esengine::ecs

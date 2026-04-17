#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

#include <string>

namespace esengine::ecs {

/**
 * @brief Bitmask flags for `StateVisuals::transitionFlags`.
 *
 * @details Multiple transition modes may be combined. Values are bit
 *          positions, not exclusive, so the field is stored as `u32`
 *          rather than an ES_ENUM.
 */
namespace StateVisualsTransition {
    constexpr u32 None       = 0;
    constexpr u32 ColorTint  = 1u << 0;   // write color to targetGraphic UIRenderer
    constexpr u32 SpriteSwap = 1u << 1;   // write texture to targetGraphic UIRenderer
    constexpr u32 Scale      = 1u << 2;   // multiply targetGraphic Transform scale
}

/**
 * @brief Maps state names to visual overrides on a target entity.
 *
 * @details Eight open slots, each labelled by `slotNName`. The visual
 *          system reads the owning entity's StateMachine.current, looks
 *          up the matching slot (empty names are treated as unused), and
 *          applies `color` / `sprite` / `scale` to `targetGraphic`
 *          according to `transitionFlags`.
 *
 *          `targetGraphic == INVALID_ENTITY` means "apply to self".
 */
ES_COMPONENT()
struct StateVisuals {
    ES_PROPERTY(entity_ref)
    Entity targetGraphic = INVALID_ENTITY;

    /** @brief Bitmask of StateVisualsTransition constants. */
    ES_PROPERTY()
    u32 transitionFlags{0};

    /** @brief Seconds over which to lerp color/scale on state change. 0 = snap. Sprite swap is always instant. */
    ES_PROPERTY()
    f32 fadeDuration{0.0f};

    // -- slots (8 × 4 = 32 fields) --

    ES_PROPERTY() std::string slot0Name;
    ES_PROPERTY() glm::vec4   slot0Color{1.0f, 1.0f, 1.0f, 1.0f};
    ES_PROPERTY(asset = texture) resource::TextureHandle slot0Sprite;
    ES_PROPERTY() f32         slot0Scale{1.0f};

    ES_PROPERTY() std::string slot1Name;
    ES_PROPERTY() glm::vec4   slot1Color{1.0f, 1.0f, 1.0f, 1.0f};
    ES_PROPERTY(asset = texture) resource::TextureHandle slot1Sprite;
    ES_PROPERTY() f32         slot1Scale{1.0f};

    ES_PROPERTY() std::string slot2Name;
    ES_PROPERTY() glm::vec4   slot2Color{1.0f, 1.0f, 1.0f, 1.0f};
    ES_PROPERTY(asset = texture) resource::TextureHandle slot2Sprite;
    ES_PROPERTY() f32         slot2Scale{1.0f};

    ES_PROPERTY() std::string slot3Name;
    ES_PROPERTY() glm::vec4   slot3Color{1.0f, 1.0f, 1.0f, 1.0f};
    ES_PROPERTY(asset = texture) resource::TextureHandle slot3Sprite;
    ES_PROPERTY() f32         slot3Scale{1.0f};

    ES_PROPERTY() std::string slot4Name;
    ES_PROPERTY() glm::vec4   slot4Color{1.0f, 1.0f, 1.0f, 1.0f};
    ES_PROPERTY(asset = texture) resource::TextureHandle slot4Sprite;
    ES_PROPERTY() f32         slot4Scale{1.0f};

    ES_PROPERTY() std::string slot5Name;
    ES_PROPERTY() glm::vec4   slot5Color{1.0f, 1.0f, 1.0f, 1.0f};
    ES_PROPERTY(asset = texture) resource::TextureHandle slot5Sprite;
    ES_PROPERTY() f32         slot5Scale{1.0f};

    ES_PROPERTY() std::string slot6Name;
    ES_PROPERTY() glm::vec4   slot6Color{1.0f, 1.0f, 1.0f, 1.0f};
    ES_PROPERTY(asset = texture) resource::TextureHandle slot6Sprite;
    ES_PROPERTY() f32         slot6Scale{1.0f};

    ES_PROPERTY() std::string slot7Name;
    ES_PROPERTY() glm::vec4   slot7Color{1.0f, 1.0f, 1.0f, 1.0f};
    ES_PROPERTY(asset = texture) resource::TextureHandle slot7Sprite;
    ES_PROPERTY() f32         slot7Scale{1.0f};
};

}  // namespace esengine::ecs

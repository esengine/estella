// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../core/UITypes.hpp"   // VisualState

#include <vector>

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
    constexpr u32 ColorTint  = 1u << 0;   // write color to targetGraphic UIVisual
    constexpr u32 SpriteSwap = 1u << 1;   // write texture to targetGraphic UIVisual
    constexpr u32 Scale      = 1u << 2;   // multiply targetGraphic Transform scale
}

/**
 * @brief Maps state names to visual overrides on a target entity.
 *
 * @details A variable-length `states` list (replaced the old 8
 *          hardcoded `slotN*` field quartets + stringly-keyed reflection). The
 *          visual system reads the owning entity's StateMachine.current, finds
 *          the matching VisualState by name, and applies its color / sprite /
 *          scale to `targetGraphic` according to `transitionFlags`.
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

    /** @brief Named visual states; looked up by StateMachine.current. */
    ES_PROPERTY()
    std::vector<VisualState> states;
};

}  // namespace esengine::ecs

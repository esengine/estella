// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpriteMask.hpp
 * @brief   Turns this entity's Sprite into a stencil the sprites drawn after it can be cut by.
 * @details The mask is a SPRITE, not a shape of its own: the same entity's `Sprite` supplies
 *          the texture, size, pivot, flips and 9-slice, and is drawn with colour writes off.
 *          A second geometry field would be a second thing to keep in step with what the
 *          author sees, and there is nothing a mask needs that a sprite cannot already say.
 *
 *          Reach is a RANGE, not a subtree. What a 2D mask cuts is rarely its own children —
 *          a hole in a fog layer is drawn over scenery that belongs to no part of it — so the
 *          mask reaches the sprites drawn after it, which is the order the author already
 *          arranges by layer and order. `UIMask` keeps the subtree rule, because a UI tree
 *          IS its containment.
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

/**
 * @brief A stencil cut from this entity's own Sprite.
 */
ES_COMPONENT(renderable=enabled, stability=beta)
struct SpriteMask {
    /** @brief Above 0, cut to the sprite's SHAPE — fragments below this alpha do not mask. */
    ES_PROPERTY(min=0, max=1, slider,
                tooltip="Cut to the sprite's shape instead of its box: fragments below this alpha do not mask.")
    f32 alphaCutoff{0.0f};

    /** @brief Stop reaching at a stated layer/order instead of running to the end of the frame. */
    ES_PROPERTY(tooltip="Limit how far this mask reaches; off = every sprite drawn after it.")
    bool limitRange{false};

    /** @brief Last sorting layer this mask reaches. */
    ES_PROPERTY(step=1, enum_source=sortingLayers, shown_when=limitRange:true,
                tooltip="Last sorting layer this mask reaches.")
    i32 rangeEndLayer{0};

    /** @brief Last order WITHIN that layer, inclusive. */
    ES_PROPERTY(step=1, min=-128, max=127, shown_when=limitRange:true,
                tooltip="Last order inside that layer this mask reaches, inclusive.")
    i32 rangeEndOrder{0};

    /** @brief Off is not a mask at all: the sprite goes back to being drawn normally,
     *         which is what makes "is this masking?" answerable by looking. */
    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs

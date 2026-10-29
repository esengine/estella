// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

/**
 * @brief Fades an entity and everything under it, the way `UINode.opacity` fades a UI subtree.
 *
 * @details The opacities multiply down the hierarchy into each descendant's own alpha. It is not a composited layer: where children overlap they
 *          show through one another mid-fade, which is the cheap behaviour every group alpha makes. It reaches the world content that draws a
 *          colour — sprites, text, shapes, trails; a UI node answers to its own `opacity` instead.
 */
ES_COMPONENT(stability=beta)
struct GroupOpacity {
    ES_PROPERTY(min=0, max=1, step=0.01, tooltip="Opacity of this entity and everything under it, multiplied with the opacity of every group above it.")
    f32 opacity{1.0f};

    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs

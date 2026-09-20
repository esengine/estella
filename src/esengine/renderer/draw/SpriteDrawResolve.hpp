// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpriteDrawResolve.hpp
 * @brief   Which geometry a Sprite draws — the rule, apart from the frame.
 * @details Pure so it can be held to cases directly: a frame shows that SOME
 *          geometry was emitted, never which rule chose it.
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../ecs/components/Sprite.hpp"

namespace esengine {

/** Which of the three geometries a sprite emits. At most one is true. */
struct SpriteDrawChoice {
    bool tiled{false};
    bool nineSlice{false};
};

/**
 * @brief Resolve the geometry from the author's mode and what the data offers.
 *
 * Under `Auto` a tileSize outranks a slice border, because a tileSize is only
 * ever set deliberately. A named mode overrides the inference but cannot invent
 * data: Tiled with no tileSize and NineSlice with no border draw the plain quad.
 */
constexpr SpriteDrawChoice resolveSpriteDraw(ecs::SpriteDrawMode mode,
                                             bool hasTileSize,
                                             bool hasSliceBorder) {
    switch (mode) {
        case ecs::SpriteDrawMode::Simple:
            return {};
        case ecs::SpriteDrawMode::Tiled:
            return {hasTileSize, false};
        case ecs::SpriteDrawMode::NineSlice:
            return {false, hasSliceBorder};
        case ecs::SpriteDrawMode::Auto:
        default:
            return {hasTileSize, !hasTileSize && hasSliceBorder};
    }
}

} // namespace esengine

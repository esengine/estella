// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Impostor.hpp
 * @brief   A picture of a mesh, taken from many directions, drawn in its place once it is small.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

/**
 * @brief Stands a card in for the MeshRenderer beside it once the object covers less than @ref screenSize of the view.
 *
 * @details The mesh is photographed from `frames` x `frames` directions over the upper half of a sphere into one atlas, as it is
 *          lit when the pictures are taken. Each view then draws the picture taken nearest its own direction to the object, on a
 *          card facing it, and every impostor that shares an atlas is drawn with the others: a forest on the horizon is a handful of
 *          draws. The atlas is shared by every entity with the same mesh, material, texture and colour.
 *
 *          What it cannot do: the light is the light at the time of the pictures, the picture changes in steps as the view moves
 *          round, a card casts no shadow and is not seen from below.
 */
ES_COMPONENT(stability=beta)
struct Impostor {
    /** @brief Fraction of the viewport height below which the card replaces the mesh. */
    ES_PROPERTY(min=0, max=1, tooltip="Screen height fraction below which the card replaces the mesh.")
    f32 screenSize{0.06f};

    /** @brief Directions along each side of the atlas: frames x frames pictures in all. */
    ES_PROPERTY(min=2, max=16, step=1, tooltip="Pictures along each side of the atlas (frames x frames in all). More is smoother as the view goes round, and smaller each.")
    i32 frames{8};

    /** @brief The atlas's side in pixels. */
    ES_PROPERTY(min=128, max=4096, step=128, tooltip="The atlas's side in pixels; each picture is this divided by frames.")
    i32 resolution{1024};

    ES_PROPERTY(tooltip="Off: the mesh is always drawn as itself.")
    bool enabled{true};

    Impostor() = default;
};

}  // namespace esengine::ecs

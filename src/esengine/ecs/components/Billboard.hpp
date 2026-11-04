// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Billboard.hpp
 * @brief   A mesh that turns to whoever looks at it.
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

/// How a billboard is turned. ViewPlane lies flat in the view, like a particle; Upright turns about world up only, so a tree, a sign or a
/// character drawn on a card stays standing as the camera looks down on it.
ES_ENUM(stability=beta)
enum class BillboardMode : i32 {
    ViewPlane = 0,
    Upright = 1,
};

/**
 * @brief Turns the MeshRenderer beside it to face each view that draws it.
 *
 * @details The rotation is the VIEW's, worked out while the view collects what it draws, so two cameras each see the card face on and the
 *          entity's own Transform is never written: scripts, physics and the editor read the rotation that was authored. The mesh's +Z is
 *          turned toward the viewer and its +Y up, which is how a builtin quad stands; position and scale are the entity's. A shadow map
 *          is a view too, so a card turns to the light there and casts its whole outline.
 */
ES_COMPONENT(stability=beta)
struct Billboard {
    ES_PROPERTY(enum=BillboardMode, tooltip="View plane lies flat in the view, like a particle. Upright turns about world up only, so it stays standing as the camera looks down.")
    i32 mode{static_cast<i32>(BillboardMode::ViewPlane)};

    ES_PROPERTY(tooltip="Off: the mesh keeps the entity's own rotation.")
    bool enabled{true};

    Billboard() = default;
};

}  // namespace esengine::ecs

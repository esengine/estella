// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ShadowCaster2D.hpp
 * @brief   Marks an entity as a 2D shadow occluder for the Lit2D lighting path.
 * @details The render collect path turns each enabled caster into a world-space AABB (centered
 *          on the entity's Transform, `size` wide/tall) and feeds it to LightStore as an occluder.
 *          A point/spot light is then blocked at any fragment whose segment to the light crosses
 *          the box (see ShaderParser's injected es_shadowFactor2D). Carries no geometry of its own.
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

/**
 * @brief A 2D shadow occluder. The box is centered on the entity's world position.
 */
ES_COMPONENT()
struct ShadowCaster2D {
    /** @brief Occluder box size in world units (full width/height; centered on the Transform). */
    ES_PROPERTY(animatable, min=0, tooltip="Occluder box size in world units (centered on the entity).")
    glm::vec2 size{32.0f, 32.0f};

    /** @brief Disabled casters are skipped during collection. */
    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs

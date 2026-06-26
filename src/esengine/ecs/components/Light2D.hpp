// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Light2D.hpp
 * @brief   2D light source component for the Lit2D material domain.
 * @details A scene's Light2D components are gathered by the render collect path into the
 *          per-frame LightConstants UBO (binding 2); Lit2D-domain material shaders read them
 *          via the injected es_applyLighting2D() helper. Point/Directional lights occupy a
 *          light slot; Ambient lights sum into the ambient term. World position comes from the
 *          entity's Transform — this component carries only the light's intrinsic parameters.
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
#include "../../math/Math.hpp"

namespace esengine::ecs {

/**
 * @brief 2D light kind. Point uses the Transform position + radius falloff; Directional uses
 *        `direction` with no attenuation; Ambient adds a flat term independent of normal/position.
 */
enum class Light2DType : i32 {
    Point = 0,
    Directional = 1,
    Ambient = 2,
    Spot = 3,
};

/**
 * @brief A 2D light contributing to Lit2D-shaded materials.
 *
 * @code
 * auto& light = registry.emplace<Light2D>(e);
 * light.type = static_cast<i32>(Light2DType::Directional);
 * light.color = {0, 1, 0};   // green
 * light.intensity = 1.0f;
 * @endcode
 */
ES_COMPONENT()
struct Light2D {
    /** @brief Light kind: 0 = Point, 1 = Directional, 2 = Ambient (see Light2DType). */
    ES_PROPERTY()
    i32 type{0};

    /** @brief Light color, multiplied by intensity. RGBA for editor color-picker consistency
     *         with every other engine color (Sprite/Shape/Text); the alpha is unused (a light's
     *         strength is `intensity`, which can exceed 1 for HDR). */
    ES_PROPERTY(animatable)
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    /** @brief Light strength multiplier. */
    ES_PROPERTY(animatable)
    f32 intensity{1.0f};

    /** @brief Point/Spot falloff radius in world units (ignored by Directional/Ambient). */
    ES_PROPERTY(animatable)
    f32 radius{200.0f};

    /** @brief Direction in the 2D plane: Directional light direction, or Spot cone axis
     *         ({0,0} = straight at the screen / cone aims down). Ignored by Point/Ambient. */
    ES_PROPERTY()
    glm::vec2 direction{0.0f, 0.0f};

    /** @brief Spot inner cone angle in degrees (full angle; fully lit inside). */
    ES_PROPERTY(animatable)
    f32 innerAngle{30.0f};

    /** @brief Spot outer cone angle in degrees (full angle; fades to dark by here). */
    ES_PROPERTY(animatable)
    f32 outerAngle{45.0f};

    /** @brief Disabled lights are skipped during collection. */
    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs

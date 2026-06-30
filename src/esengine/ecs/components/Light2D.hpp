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
ES_ENUM()
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
    ES_PROPERTY(enum=Light2DType, tooltip="Point, Directional, Ambient, or Spot.")
    i32 type{0};

    /** @brief Light color, multiplied by intensity. RGBA for editor color-picker consistency
     *         with every other engine color (Sprite/Shape/Text); the alpha is unused (a light's
     *         strength is `intensity`, which can exceed 1 for HDR). */
    ES_PROPERTY(animatable)
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    /** @brief Light strength multiplier. */
    ES_PROPERTY(animatable, min=0, tooltip="Brightness multiplier of the light.")
    f32 intensity{1.0f};

    /** @brief Point/Spot falloff radius in world units (ignored by Directional/Ambient). */
    ES_PROPERTY(animatable, min=0, tooltip="Falloff reach in world units (Point / Spot).")
    f32 radius{200.0f};

    /** @brief Direction in the 2D plane: Directional light direction, or Spot cone axis
     *         ({0,0} = straight at the screen / cone aims down). Ignored by Point/Ambient. */
    ES_PROPERTY(advanced, tooltip="Aim direction (Directional / Spot).")
    glm::vec2 direction{0.0f, 0.0f};

    /** @brief Spot inner cone angle in degrees (full angle; fully lit inside). */
    ES_PROPERTY(animatable, min=0, max=180, unit="°", advanced)
    f32 innerAngle{30.0f};

    /** @brief Spot outer cone angle in degrees (full angle; fades to dark by here). */
    ES_PROPERTY(animatable, min=0, max=180, unit="°", advanced)
    f32 outerAngle{45.0f};

    /** @brief Shadow penumbra softness = light-source half-extent in world units. 0 = hard-edged
     *         shadow (default; identical to no softening). Larger values widen the penumbra the way
     *         a bigger area light does. Applies to every light type that casts a shadow. */
    ES_PROPERTY(animatable, min=0, tooltip="Shadow softness (light-source size); 0 = hard edge.")
    f32 shadowSoftness{0.0f};

    /** @brief Directional-light shadow reach in world units: how far back toward the light a
     *         fragment searches for an occluder. 0 = a Directional light casts no shadow (default).
     *         Ignored by Point/Spot, which shadow along the segment to the light position. */
    ES_PROPERTY(animatable, min=0, advanced, tooltip="Directional shadow distance; 0 = no directional shadow.")
    f32 shadowDistance{0.0f};

    /** @brief Disabled lights are skipped during collection. */
    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs

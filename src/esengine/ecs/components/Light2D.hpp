// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Light2D.hpp
 * @brief   2D light source component for the Lit2D material domain.
 * @details A scene's Light2D components are gathered by the render collect path into the
 *          per-frame LightConstants UBO (binding 2); Lit2D-domain material shaders read them
 *          via the injected applyLighting2D() helper. Point/Directional/Spot lights occupy a
 *          light slot; Ambient lights sum into the ambient term. This component carries only
 *          the light's intrinsic parameters. Where a light sits and where it aims are the
 *          entity's Transform: Point/Spot read their world position from it (and are skipped
 *          without one), and Directional/Spot aim along the entity's forward — its rotation
 *          applied to -Z, which is what an unrotated light has always shone along.
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
#include "../../resource/Handle.hpp"

namespace esengine::ecs {

/**
 * @brief 2D light kind. Point uses the Transform position + radius falloff; Directional uses
 *        the Transform's forward with no attenuation; Ambient adds a flat term independent of
 *        normal/position.
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
ES_COMPONENT(renderable=enabled)
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

    /** @brief Spot inner cone angle in degrees (full angle; fully lit inside). */
    ES_PROPERTY(animatable, min=0, max=180, unit="°", advanced)
    f32 innerAngle{30.0f};

    /** @brief Spot outer cone angle in degrees (full angle; fades to dark by here). */
    ES_PROPERTY(animatable, min=0, max=180, unit="°", advanced)
    f32 outerAngle{45.0f};

    /** @brief Shadow penumbra softness = the light source's half-extent in world units; 0 is a
     *         hard edge (default). It widens a penumbra the way a bigger source does, and the edge
     *         sharpens as a caster nears what it falls on. Read by the 2D occluder boxes of every
     *         type, and by a mesh shadow map only where the light HAS a position (Point/Spot). */
    ES_PROPERTY(animatable, min=0, tooltip="Shadow softness (light-source size); 0 = hard edge.")
    f32 shadowSoftness{0.0f};

    /** @brief Directional-light shadow reach in world units: how far back toward the light a
     *         fragment searches for an occluder. 0 = a Directional light casts no shadow (default).
     *         Ignored by Point/Spot, which shadow along the segment to the light position. */
    ES_PROPERTY(animatable, min=0, advanced, tooltip="Directional shadow distance; 0 = no directional shadow.")
    f32 shadowDistance{0.0f};

    /** @brief Casts a shadow map over 3D meshes. Every type but Ambient can: a
     *         Directional light's map is a set of cascades over the view, a Spot's is its
     *         cone, and a Point's is the six faces of a cube around it. Separate from
     *         @ref shadowDistance, which shadows 2D ShadowCaster2D boxes in the XY plane:
     *         one light can do both, and a 2.5D scene often wants exactly that. Lights
     *         that stand somewhere claim their tiles first and one sun takes what is left,
     *         so a crowded frame costs the sun its farthest cascade rather than a map. */
    ES_PROPERTY(tooltip="Cast a shadow map over 3D meshes (Directional, Spot, Point).")
    bool meshShadows{false};

    /** @brief Half-extent of the shadow map's world coverage, centred on the camera.
     *         0 = fit what the camera can see. Larger trades sharpness for reach. */
    ES_PROPERTY(min=0, advanced, tooltip="Shadow map coverage radius; 0 = fit the view.")
    f32 shadowExtent{0.0f};

    /** @brief What this Ambient light IS, when it is more than one colour: a baked
     *         panorama's irradiance and reflection. Without one the light stays the
     *         flat term it has always been — the same lighting, at order zero.
     *         @ref color and @ref intensity scale it. Ignored by the other types;
     *         the first Ambient light that carries one is the frame's environment. */
    ES_PROPERTY(asset = environment, tooltip="Baked environment (.esenv) this Ambient light casts.")
    resource::EnvironmentHandle environment;

    /** @brief Draw @ref environment as the background as well as reflecting it. Off by
     *         default, so a scene that adopts an environment for its lighting does not
     *         also acquire a sky it did not ask for. Ignored without one — and the
     *         camera still decides whether the background is drawn at all. */
    ES_PROPERTY(tooltip="Draw this environment as the sky behind the scene.")
    bool drawEnvironment{false};

    /** @brief Disabled lights are skipped during collection. */
    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs

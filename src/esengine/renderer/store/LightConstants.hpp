// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LightConstants.hpp
 * @brief   Per-frame 2D lighting constants — the third tier of the engine's constant-buffer
 *          layering (after per-frame FrameConstants at 0 and per-material MaterialConstants at 1).
 * @details A Lit2D-domain material shader (#pragma domain Lit2D) gets a `layout(std140) uniform
 *          LightConstants { ... }` block auto-injected by ShaderParser, and Shader::compile links
 *          it to LIGHT_CONSTANTS_BINDING. LightStore (owned by RenderContext) collects the scene's
 *          Light2D components into this CPU mirror each frame and uploads it once. The GLSL struct
 *          layout MUST match this std140 mirror exactly — a mismatch silently corrupts lighting.
 */
#pragma once

#include "../../core/Types.hpp"

#include <glm/glm.hpp>

namespace esengine {

/** @brief Indexed UBO binding point for the per-frame LightConstants block. */
inline constexpr u32 LIGHT_CONSTANTS_BINDING = 2;

/** @brief GLSL block name; must match ShaderParser's injected block + Shader::compile lookup. */
inline constexpr const char* LIGHT_CONSTANTS_BLOCK = "LightConstants";

/**
 * @brief The injected shadow-map sampler, and the texture unit Shader::compile pins it to.
 * @details Every Lit2D shader gets the sampler from the injected header, so the unit is a
 *          contract rather than something each compile site repeats. Slot 2 sits after the
 *          draw's own two (base colour, normal map) — see BatchBuilder's slot assembly.
 */
inline constexpr const char* SHADOW_MAP_SAMPLER = "u_shadowMap";
inline constexpr u32 SHADOW_MAP_TEXTURE_UNIT = 2;

/** @brief The injected reflection sampler, one unit past the shadow map's. */
inline constexpr const char* ENV_MAP_SAMPLER = "u_envMap";
inline constexpr u32 ENV_MAP_TEXTURE_UNIT = 3;

/**
 * @brief Max simultaneous 2D lights packed into the UBO. The injected fragment loop is a fixed
 *        bound; inactive slots are zeroed (intensity 0) so they contribute nothing. Must match
 *        the `u_lights[..]` array size in ShaderParser's injected GLSL.
 */
inline constexpr u32 MAX_LIGHTS_2D = 16;

/**
 * @brief Max 2D shadow occluders packed into the UBO (axis-aligned boxes in world space).
 *        The injected applyLighting2D loops up to the active count; 0 occluders = no
 *        shadowing (identity), so the feature is inert until the render path feeds boxes.
 *        Must match the `u_occluders[..]` array size in ShaderParser's injected GLSL.
 */
inline constexpr u32 MAX_OCCLUDERS_2D = 8;

/**
 * @brief Cascades one directional shadow map is split into, laid out 2x2 in one
 *        atlas texture (the RHI has no array textures, the same reason the
 *        environment reflection is an atlas). Each covers a slice of the view,
 *        so the near one spends its texels on what is near instead of on the
 *        whole scene. Must match `u_shadowMatrix[..]` in the injected shaders.
 */
inline constexpr u32 MAX_SHADOW_CASCADES = 4;

/**
 * @brief One 2D light, std140-packed (four vec4s, 64 bytes, 16-aligned).
 * @details posDir: xy = world position (point/spot) or aim direction (directional); z = type
 *          (0 = point, 1 = directional, 2 = spot); w = falloff radius in world units for
 *          point/spot, and the aim's third component for directional — the two never share
 *          a use for it, which is what lets a sun be aimed out of the plane.
 *          color: rgb = light color, a = intensity.
 *          spot: xy = normalized cone axis, z = cos(innerHalfAngle), w = cos(outerHalfAngle)
 *          (spot only; zero for other types). Ambient lights are folded into
 *          LightConstants::ambient instead of occupying a slot.
 *          shadow: x = penumbra softness (light-source half-extent in world units; 0 = hard,
 *          backward-compatible); y = directional shadow march distance (world units; 0 = a
 *          directional light casts no shadow); z = a point/spot light's world height, which
 *          only a surface with real geometry measures against (MESH_NORMALS); w = a spot's
 *          cone-axis third component. Read by shadowFactor2D and lightVector/spotCone.
 */
struct GpuLight2D {
    glm::vec4 posDir{0.0f};
    glm::vec4 color{0.0f};
    glm::vec4 spot{0.0f};
    glm::vec4 shadow{0.0f};
};

/**
 * @brief CPU mirror of the GLSL LightConstants block (std140).
 * @details ambient: rgb = summed ambient color, a = active light count (informational).
 *          std140 array-of-struct stride is 64 (each GpuLight2D is four 16-aligned vec4s), so
 *          lights start at offset 16 and the lights array spans 64*MAX_LIGHTS_2D bytes.
 */
struct LightConstants {
    glm::vec4 ambient{0.0f};
    GpuLight2D lights[MAX_LIGHTS_2D];
    /// x = active occluder count; yzw unused. Appended after `lights` so existing std140
    /// offsets (ambient, lights) are unchanged — old Lit2D shaders keep reading the same bytes.
    glm::vec4 occluderCount{0.0f};
    /// World-space AABBs: (minX, minY, maxX, maxY). A light is shadowed at a fragment when the
    /// fragment→light segment (or, for directional, the fragment→far-along-light-dir segment)
    /// crosses any box.
    glm::vec4 occluders[MAX_OCCLUDERS_2D];
    /// World -> each cascade's clip space, for the one directional light casting a
    /// map. Identity where a cascade is unused; `shadowParams.x` says whether any
    /// may be read and `shadowParams.y` how many.
    glm::mat4 shadowMatrix[MAX_SHADOW_CASCADES];
    /// x = 1 when a shadow map was rendered this frame — the master switch, so w's
    /// zeroed default cannot darken slot 0 before one exists; y = how many cascades
    /// carry one; z = one texel of the atlas; w = the light slot that cast it.
    glm::vec4 shadowParams{0.0f};
    /// Depth bias per cascade, in the map's own [0,1] units, xyzw = cascade 0..3.
    /// Per cascade because one covers less world in the same texels than the next:
    /// a bias that stops the near one shadowing itself lets the far one detach.
    glm::vec4 shadowBias{0.0f};
    /// The frame environment's nine irradiance coefficients, rgb in xyz. Zero when
    /// no light carries one, which makes the flat `ambient` term the order-zero case
    /// of one expression rather than a second path. vec4: std140 pads vec3 anyway.
    glm::vec4 envIrradiance[9]{};
    /// x = 1 when a prefiltered reflection is bound; y = its RGBM decode range;
    /// z = the highest mip index; w = mip 0's octahedral face size, in texels.
    glm::vec4 envParams{0.0f};
    /// rgb = the ambient light's colour times its intensity, which scales BOTH halves
    /// of the environment. Kept out of the coefficients so the reflection — sampled
    /// from a texture the light does not own — is tinted by the same number.
    glm::vec4 envTint{0.0f};
};

static_assert(sizeof(GpuLight2D) == 64, "GpuLight2D must be std140-tight (four vec4s)");
static_assert(sizeof(LightConstants) == 16 + 64 * MAX_LIGHTS_2D + 16 + 16 * MAX_OCCLUDERS_2D
                                        + 64 * MAX_SHADOW_CASCADES + 16 + 16 + 16 * 9 + 16 + 16,
              "LightConstants must match the std140 GLSL block layout");

}  // namespace esengine

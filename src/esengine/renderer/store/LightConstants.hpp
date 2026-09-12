// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LightConstants.hpp
 * @brief   Per-frame 2D lighting constants — the third tier of the engine's constant-buffer
 *          layering (after per-frame FrameConstants at 0 and per-material MaterialConstants at 1).
 * @details A Lit-domain material shader (#pragma domain Lit) gets a `layout(std140) uniform
 *          LightConstants { ... }` block auto-injected by ShaderParser, and Shader::compile links
 *          it to LIGHT_CONSTANTS_BINDING. LightStore (owned by RenderContext) collects the scene's
 *          Light components into this CPU mirror each frame and uploads it once. The GLSL struct
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
 * @details Every Lit shader gets the sampler from the injected header, so the unit is a
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
inline constexpr u32 MAX_LIGHTS = 16;

/**
 * @brief The 2D shadow mask, and the texture unit every Lit shader samples it from.
 * @details One screen-sized RGBA8 target, a channel per casting light: the shadow pass
 *          draws what each occluder hides and a Lit fragment reads its own channel at
 *          its own pixel. Unit 7 is the top of the batch stream's eight, taken from it
 *          only while a mask exists — so a scene with no 2D shadows pays no merge slot.
 */
inline constexpr const char* SHADOW_2D_SAMPLER = "u_shadow2D";
inline constexpr u32 SHADOW_2D_TEXTURE_UNIT = 7;

/**
 * @brief Lights whose 2D shadows one frame can carry — the mask's four channels.
 * @details A cap on CASTERS, not on lights: past it a light still lights the scene and
 *          stops shadowing, which is the failure a 2D scene can look at and understand.
 *          Four because an RGBA8 target has four channels and a fifth would be a second
 *          target, a second bind and a second sample for a case 2D art rarely reaches.
 */
inline constexpr u32 MAX_SHADOW_2D_LIGHTS = 4;

/**
 * @brief Slices one directional shadow map is split into, each covering a stretch
 *        of the view — so the near one spends its texels on what is near instead
 *        of on the whole scene. Where they LAND is the atlas's answer, not this
 *        number's: a cascade claims a tile like anything else that casts.
 */
inline constexpr u32 MAX_SHADOW_CASCADES = 4;

/**
 * @brief Faces a point light's map is rendered as. Six cones at right angles cover
 *        every direction from a point, and each is a tile like any other — which is
 *        what spares the pass a projection nothing else in it understands.
 */
inline constexpr u32 SHADOW_CUBE_FACES = 6;

/**
 * @brief Max shadow tiles one frame's atlas hands out — the shader's array bound.
 * @details Not the same number as the cascades above: a cascade is one reason to want
 *          a tile and a spot light is another, and the atlas does not care which asked.
 *          Sixteen because a point light's map is a cube — six of them — and eight
 *          could not hold one beside a sun's cascades.
 */
inline constexpr u32 MAX_SHADOW_TILES = 16;

/**
 * @brief One 2D light, std140-packed (six vec4s, 96 bytes, 16-aligned).
 * @details Every lane is spoken for; each field says which. An Ambient light occupies no
 *          slot at all — it folds into LightConstants::ambient.
 */
struct GpuLight {
    /// xy = world position (point/spot) or aim direction (directional); z = the type
    /// (0 point, 1 directional, 2 spot); w = the falloff radius, or a directional aim's
    /// third component — never both, which is what lets a sun aim out of the plane.
    glm::vec4 posDir{0.0f};
    /// rgb = colour, a = intensity.
    glm::vec4 color{0.0f};
    /// Spot only, zero otherwise: xy = the cone axis in the plane, z = cos(inner half
    /// angle), w = cos(outer half angle).
    glm::vec4 spot{0.0f};
    /// x = penumbra softness (the source's half-extent in world units; 0 = hard); y = a
    /// directional light's shadow march distance (0 = it casts none); z = a positional
    /// light's world height, measured against only by real geometry; w = a spot axis' z.
    glm::vec4 shadow{0.0f};
    /// x = first atlas tile, y = how many it owns (0 = no map); z = the tangent of the
    /// angle its source subtends, for the map with no distance to divide by (0 for a
    /// light that stands somewhere); w = its 2D mask channel, -1 for none.
    glm::vec4 shadowMap{0.0f, 0.0f, 0.0f, -1.0f};
    /// How the light ENDS, as opposed to where: x = the radius it holds full strength
    /// out to, y = the power its ramp is raised to (1 = linear), z = how much of it a
    /// shadow removes (1 = all). The defaults ARE the old linear ramp. w unused.
    glm::vec4 falloff{0.0f, 1.0f, 1.0f, 0.0f};
};

/**
 * @brief CPU mirror of the GLSL LightConstants block (std140).
 * @details ambient: rgb = summed ambient color, a = active light count (informational).
 *          std140 array-of-struct stride is 96 (each GpuLight is six 16-aligned vec4s), so
 *          lights start at offset 16 and the lights array spans 96*MAX_LIGHTS bytes.
 */
struct LightConstants {
    glm::vec4 ambient{0.0f};
    GpuLight lights[MAX_LIGHTS];
    /// Where the CAMERA NOW DRAWING lands in the 2D shadow mask: xy = its low corner,
    /// zw = its size, as fractions of the mask; zero width = no mask this frame. Per
    /// camera, because the mask is screen space and two cameras own two parts of it.
    glm::vec4 shadow2DRect{0.0f};
    /// World -> tile i's clip space. Identity where a tile is unclaimed; which tiles
    /// a light may read are the ones its own `shadowMap` names.
    glm::mat4 shadowMatrix[MAX_SHADOW_TILES];
    /// Where tile i sits: xy = its low corner as a fraction of the atlas, z = its side
    /// as one; w unused. DATA and not an expression the shader recomputes, so tiles need
    /// not all be one size — and how big one is is what a receiver derives its own bias
    /// from, which is why no bias is stored here.
    glm::vec4 shadowTile[MAX_SHADOW_TILES];
    /// x = 1 when the atlas holds a map this frame — the master switch, so a zeroed
    /// tile record cannot darken anything before one exists; y = one texel of the atlas.
    glm::vec4 shadowParams{0.0f};
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

static_assert(sizeof(GpuLight) == 96, "GpuLight must be std140-tight (six vec4s)");
static_assert(sizeof(LightConstants) == 16 + 96 * MAX_LIGHTS + 16
                                        + 64 * MAX_SHADOW_TILES + 16 * MAX_SHADOW_TILES
                                        + 16 + 16 * 9 + 16 + 16,
              "LightConstants must match the std140 GLSL block layout");

}  // namespace esengine

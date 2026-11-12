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
#include "./EngineTextureUnits.hpp"
#include "./TiledLights.hpp"

#include <algorithm>
#include <glm/glm.hpp>

namespace esengine {

/** @brief Indexed UBO binding point for the per-frame LightConstants block. */
inline constexpr u32 LIGHT_CONSTANTS_BINDING = 2;

/** @brief GLSL block name; must match ShaderParser's injected block + Shader::compile lookup. */
inline constexpr const char* LIGHT_CONSTANTS_BLOCK = "LightConstants";

/**
 * @brief Max simultaneous 2D lights packed into the UBO. The injected fragment loop is a fixed
 *        bound; inactive slots are zeroed (intensity 0) so they contribute nothing. Must match
 *        the `u_lights[..]` array size in ShaderParser's injected GLSL.
 */
inline constexpr u32 MAX_LIGHTS = 16;

/** @brief Lights whose SHAPE one frame can carry — the shape mask's four channels. */
inline constexpr u32 MAX_SHAPE_2D_LIGHTS = 4;

/// Channels one 2D shadow mask carries: an RGBA8 target has four.
inline constexpr u32 SHADOW_2D_MASK_CHANNELS = 4;

/**
 * @brief Channels of the 2D shadow mask: the lights that MEET one another and cast at once (see ShadowChannels2D.hpp).
 * @details Eight: a second mask, which takes the shape mask's texture unit (6) because every unit above it is the first mask's and
 *          every one below is spoken for. A frame with a light that has a cookie needs that unit for the shape mask, and has the first
 *          mask's four. A light past the channels still lights the scene and stops shadowing, which is the failure a 2D scene can look
 *          at and understand.
 */
inline constexpr u32 MAX_SHADOW_2D_LIGHTS = 8;

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
 * @brief Columns of the reflection atlas one frame can address — column 0 the
 *        environment's, so fifteen probes and a sky.
 * @details Here rather than with the store that fills them: what bounds it is the
 *          array in the block below, a box per column.
 */
inline constexpr u32 MAX_REFLECTION_PROBES = 15;

/**
 * @brief The sprite layers a light reaches ride in `GpuLight::shadowMap.y` above the atlas tile count: `tiles + 8 * range`.
 * @details The block has no spare lane (it sits at the 16 KB every device guarantees). The range is two bytes, the lowest layer biased up by 128
 *          and the highest counted down from 127, so that ZERO IS EVERY LAYER and a light nobody gave a range is unchanged.
 */
inline constexpr f32 LIGHT_TILE_BITS = 8.0f;

/** @brief The range of sprite layers a light reaches, as the number that rides in `shadowMap.y` above the tile count. 0 is every layer. */
inline f32 packLightLayerRange(i32 layerMin, i32 layerMax) {
    const i32 lo = std::clamp(layerMin, -128, 127) + 128;
    const i32 hi = 127 - std::clamp(layerMax, -128, 127);
    return static_cast<f32>(lo + 256 * hi);
}

/** @brief What a sprite's layer is written as in the vertex lane the lit fragment reads: the layer plus 129, so 0 is "no layer to test". */
inline constexpr f32 SPRITE_LAYER_BIAS = 129.0f;

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
    /// x = first atlas tile, y = tiles owned (0 = no map) in its low bits and the sprite-layer range above (packLightLayerRange);
    /// z = the tangent of the angle its source subtends (0 for a light that stands somewhere); w = its 2D mask channel, -1 for none.
    glm::vec4 shadowMap{0.0f, 0.0f, 0.0f, -1.0f};
    /// How the light ENDS, as opposed to where: x = the radius it holds full strength
    /// out to, y = the power its ramp is raised to (1 = linear), z = how much a shadow
    /// removes (1 = all), w = its shape-mask channel (-1 = unshaped). Defaults = linear.
    glm::vec4 falloff{0.0f, 1.0f, 1.0f, -1.0f};
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
    /// Where the CAMERA NOW DRAWING lands in a screen-space light mask: xy = its low
    /// corner, zw = its size, as fractions of one; zero width = no mask this frame. One
    /// rect for BOTH masks — same size, same viewport, so two would be two answers.
    glm::vec4 mask2DRect{0.0f};
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
    /// x = how many COLUMNS the bound atlas holds, the environment's included, so
    /// one texture serves the sky and every baked room; y = how bright a baked
    /// column shows and z how much colour it keeps (1 = as baked); w unused. One
    /// column is the environment alone, which is what a scene with no bake has always been.
    glm::vec4 reflParams{1.0f, 1.0f, 1.0f, 0.0f};
    /// The world box column i answers inside: [2i] = min, [2i+1] = max. Column 0
    /// is the environment and has none — a sky is not somewhere. The shader
    /// PROJECTS onto a box, which is what slides a reflection across a wall.
    glm::vec4 reflBox[2 * MAX_REFLECTION_PROBES]{};
    /// rgb = what the BAKED indirect light (a lightmap, a probe volume) is multiplied by: a bake holds one
    /// moment's light, so a scene that passes through a day or a weather scales and tints it here (1 = as baked).
    glm::vec4 bakedTint{1.0f};
    /// The lights past the loop's sixteen (point and spot, no shadow map), read through the tile masks below; see TiledLights.hpp.
    GpuLight tiledLights[MAX_TILED_LIGHTS];
    /// Per screen tile, which of those lights can reach it: bit i of word i / 32.
    glm::uvec4 tileMask[TILE_COLUMNS * TILE_ROWS]{};
    /// x = how many tiled lights there are (0 = the loop does not run), y = tile columns, z = tile rows, w unused.
    glm::vec4 tileInfo{0.0f};
    /// rgb = what the ambient term moves by between a surface facing up and one facing down: ground minus
    /// sky, so zero (no hemisphere light) leaves `ambient` as the flat term, pixel for pixel. Last, because a
    /// block that does not read it is free not to declare it.
    glm::vec4 ambientGround{0.0f};
};

/**
 * @brief Which of the loop's lights can reach a lit quad rides in the same vertex lane as its layer: `-(layer + 129 + 512 * reach)`.
 * @details A lit pixel used to work every light of the frame out, the ones across the level included, and that arithmetic is the whole
 *          cost of 2D lighting (docs/GPU_PERFORMANCE_OPTIONS.md, section 9). The quad's box is known where it is submitted, so which
 *          lights reach it is settled there and the fragment skips the rest. NEGATIVE says the lane carries a reach at all: a lane
 *          written by anything older, or by a draw that does not know, is the bare layer and every light is worked out as before.
 *          Fifteen bits, because 9 bits of layer and 15 of reach is what a float carries whole; the sixteenth light is always worked out.
 */
inline constexpr f32 SPRITE_LIGHT_REACH_STEP = 512.0f;
inline constexpr u32 SPRITE_LIGHT_REACH_BITS = 15;

/**
 * @brief Bit i set when loop light i can put any light on the box @p lo .. @p hi (the plane's XY, the space the vertices are in).
 * @details A light's ramp is zero from its radius outward whichever way it falls off (distanceFalloff), so a box wholly past the
 *          radius gets exactly nothing from it. A directional light reaches everything; a light of no intensity reaches nothing.
 *          The radius is taken a hair wide: the fragment measures from an interpolated position, not from the corners.
 */
inline u32 lightReachMask2D(const GpuLight* lights, u32 count, const glm::vec2& lo, const glm::vec2& hi) {
    u32 mask = 0;
    const u32 n = std::min(count, SPRITE_LIGHT_REACH_BITS);
    for (u32 i = 0; i < n; ++i) {
        const GpuLight& light = lights[i];
        if (light.color.a == 0.0f) continue;
        const bool directional = light.posDir.z >= 0.5f && light.posDir.z < 1.5f;
        if (!directional) {
            const f32 dx = std::max(std::max(lo.x - light.posDir.x, light.posDir.x - hi.x), 0.0f);
            const f32 dy = std::max(std::max(lo.y - light.posDir.y, light.posDir.y - hi.y), 0.0f);
            const f32 reach = std::max(light.posDir.w, 0.0001f) * 1.001f + 0.001f;
            if (dx * dx + dy * dy >= reach * reach) continue;
        }
        mask |= 1u << i;
    }
    return mask;
}

/** @brief The lane a lit quad carries: its layer and the lights that reach it (lightReachMask2D). */
inline f32 packSpriteLightLane(i32 layer, u32 reachMask) {
    const f32 layerLane = static_cast<f32>(std::clamp(layer, -128, 127)) + SPRITE_LAYER_BIAS;
    const u32 reach = reachMask & ((1u << SPRITE_LIGHT_REACH_BITS) - 1u);
    return -(layerLane + SPRITE_LIGHT_REACH_STEP * static_cast<f32>(reach));
}

static_assert(sizeof(GpuLight) == 96, "GpuLight must be std140-tight (six vec4s)");
static_assert(sizeof(LightConstants) <= 16384, "the block has to fit the 16 KB every device guarantees a uniform block");
static_assert(sizeof(LightConstants) == 16 + 96 * MAX_LIGHTS + 16
                                        + 64 * MAX_SHADOW_TILES + 16 * MAX_SHADOW_TILES
                                        + 16 + 16 * 9 + 16 + 16
                                        + 16 + 32 * MAX_REFLECTION_PROBES + 16
                                        + 96 * MAX_TILED_LIGHTS + 16 * TILE_COLUMNS * TILE_ROWS + 16 + 16,
              "LightConstants must match the std140 GLSL block layout");

}  // namespace esengine

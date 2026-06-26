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

#include "../core/Types.hpp"

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
inline constexpr u32 MAX_LIGHTS_2D = 16;

/**
 * @brief One 2D light, std140-packed (three vec4s, 48 bytes, 16-aligned).
 * @details posDir: xy = world position (point/spot) or direction (directional); z = type
 *          (0 = point, 1 = directional, 2 = spot); w = falloff radius (point/spot, world units).
 *          color: rgb = light color, a = intensity.
 *          spot: xy = normalized cone axis, z = cos(innerHalfAngle), w = cos(outerHalfAngle)
 *          (spot only; zero for other types). Ambient lights are folded into
 *          LightConstants::ambient instead of occupying a slot.
 */
struct GpuLight2D {
    glm::vec4 posDir{0.0f};
    glm::vec4 color{0.0f};
    glm::vec4 spot{0.0f};
};

/**
 * @brief CPU mirror of the GLSL LightConstants block (std140).
 * @details ambient: rgb = summed ambient color, a = active light count (informational).
 *          std140 array-of-struct stride is 32 (each GpuLight2D is already 16-aligned), so
 *          lights start at offset 16 and the whole block is 16 + 32*MAX_LIGHTS_2D bytes.
 */
struct LightConstants {
    glm::vec4 ambient{0.0f};
    GpuLight2D lights[MAX_LIGHTS_2D];
};

static_assert(sizeof(GpuLight2D) == 48, "GpuLight2D must be std140-tight (three vec4s)");
static_assert(sizeof(LightConstants) == 16 + 48 * MAX_LIGHTS_2D,
              "LightConstants must match the std140 GLSL block layout");

}  // namespace esengine

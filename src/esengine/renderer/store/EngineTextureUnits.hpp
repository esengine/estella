// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EngineTextureUnits.hpp
 * @brief   The samplers the engine injects into a shader, and the texture unit each is pinned to.
 * @details One table for the three that act on it: Shader::compile pins the samplers, BatchBuilder fills a draw's units with what
 *          they read, and ShaderParser hands a material texture only a unit its shader does not read from here. Dependency free,
 *          so the parser and its native harness take it without the renderer's math.
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"

namespace esengine {

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

/** @brief The sampler a mesh's morph deltas arrive through, and the unit it is pinned to. */
inline constexpr const char* MORPH_DELTA_SAMPLER = "u_morphDeltas";
inline constexpr u32 MORPH_DELTA_TEXTURE_UNIT = 4;

/**
 * @brief The baked-light atlas, and the unit a lightmapped mesh samples it from.
 * @details Unit 5 and not 4: the morph deltas hold that one and 6/7 are the
 *          frame's 2D masks, so this is the last a draw's own stream can claim.
 *          A lit fragment ADDS the bake as its indirect term; an unlit one takes
 *          it as the whole of its light.
 */
inline constexpr const char* LIGHTMAP_SAMPLER = "u_lightmap";
inline constexpr u32 LIGHTMAP_TEXTURE_UNIT = 5;

/**
 * @brief The frame's probe atlas, read per pixel, on the bake's unit.
 * @details A draw that reads a bake asks no volume for its light, so the two never meet in one draw; a mesh
 *          variant compiled with the bake's sampler declares no atlas at all and reads its volume per object.
 */
inline constexpr const char* PROBE_GRID_SAMPLER = "u_probeGrid";

/**
 * @brief The 2D light-shape mask, and the unit below the shadow mask's.
 * @details The same target shape carrying the other half of "how much of this light is
 *          here": what its SHAPE covers, drawn as the light's own cookie. Two planes
 *          rather than one channel, because a fragment needs both numbers to multiply
 *          them — a single channel could only carry their sum.
 */
inline constexpr const char* SHAPE_2D_SAMPLER = "u_lightShape2D";
inline constexpr u32 SHAPE_2D_TEXTURE_UNIT = 6;

/**
 * @brief The 2D shadow mask, and the texture unit every Lit shader samples it from.
 * @details One screen-sized RGBA8 target, a channel per casting light: the shadow pass
 *          draws what each occluder hides and a Lit fragment reads its own channel at
 *          its own pixel. Unit 7 is the top of the batch stream's eight, taken from it
 *          only while a mask exists — so a scene with no 2D shadows pays no merge slot.
 */
inline constexpr const char* SHADOW_2D_SAMPLER = "u_shadow2D";
inline constexpr u32 SHADOW_2D_TEXTURE_UNIT = 7;

}  // namespace esengine

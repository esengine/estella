// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ProbeConstants.hpp
 * @brief   The indirect light where ONE draw stands, when a grid was baked for it.
 *
 * @details Per DRAW and rewritten immediately before it, the way @ref SkinConstants
 *          and @ref MorphConstants are. A draw and not an object: a bake's rectangle
 *          belongs to an object, because one mesh placed twice occupies two patches,
 *          but irradiance is a function of WHERE, and a batch of instances has only
 *          one position to speak of. So a draw that stands in a volume is its own.
 *
 *          Nine coefficients and not four: this is the same shape
 *          LightConstants::envIrradiance carries, evaluated by the same expression.
 *          An environment is that field held constant; a volume is it sampled.
 */
#pragma once

#include "../../core/Types.hpp"

#include <glm/glm.hpp>

namespace esengine {

/** @brief Indexed UBO binding point for the per-draw ProbeConstants block. */
inline constexpr u32 PROBE_CONSTANTS_BINDING = 7;

/** @brief GLSL block name; must match the injected Lit header + Shader::compile lookup. */
inline constexpr const char* PROBE_CONSTANTS_BLOCK = "ProbeConstants";

/** @brief std140 mirror of the block. */
struct ProbeConstants {
    /// SH9, rgb in xyz. `[0].w` is 1 where this draw stands in a volume — a flag
    /// and not the absence of coefficients, since zeroes ARE an answer here: a
    /// probe in the dark.
    glm::vec4 irradiance[9]{};
};

static_assert(sizeof(ProbeConstants) == 16 * 9,
              "ProbeConstants must be a tight array of vec4 to match std140");

}  // namespace esengine

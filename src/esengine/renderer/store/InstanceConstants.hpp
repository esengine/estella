// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    InstanceConstants.hpp
 * @brief   WHERE one draw's objects start in the frame's per-object record texture.
 *
 * @details Per DRAW and rewritten immediately before it, the way @ref ProbeConstants
 *          and @ref MorphConstants are. `gl_InstanceID` restarts at zero every draw
 *          while the frame's records are one continuous run, so a draw has to say
 *          where its own run begins; a merge makes that run longer, never split.
 *
 *          A uniform and not a vertex attribute: an attribute would cost the record
 *          the very slot this whole carrier exists to give back.
 */
#pragma once

#include "../../core/Types.hpp"

namespace esengine {

/** @brief Indexed UBO binding point for the per-draw InstanceConstants block.
 *  Nine and not four: slot 4 is DRAW_PARAMS_BINDING, which every shader whose
 *  loose uniforms were lifted declares — two blocks on one binding is a pipeline
 *  the device refuses without naming either. */
inline constexpr u32 INSTANCE_CONSTANTS_BINDING = 8;

/** @brief GLSL block name; must match the injected mesh header + Shader::compile lookup. */
inline constexpr const char* INSTANCE_CONSTANTS_BLOCK = "InstanceConstants";

/** @brief GLSL name of the record texture; pinned to its unit by Shader::compile. */
inline constexpr const char* INSTANCE_DATA_SAMPLER = "u_instanceData";

/** @brief The first record of one draw's run. */
struct InstanceConstants {
    u32 base = 0;
    /// std140 rounds a block up to a vec4 anyway; naming the rest keeps the C++
    /// size equal to what the shader's block occupies rather than nearly equal.
    u32 pad[3]{};
};

static_assert(sizeof(InstanceConstants) == 16,
              "InstanceConstants must be one vec4 to match std140");

}  // namespace esengine

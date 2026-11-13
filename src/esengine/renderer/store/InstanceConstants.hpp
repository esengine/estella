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

/**
 * @brief The most draws one call may carry where the device draws runs (WEBGL_multi_draw).
 *
 * @details There the block is an array, one entry per draw of the run, which the vertex stage indexes by gl_DrawID: x is where
 *          that draw's records start, y where its instances start in the run's probe block. A draw on its own is a run of one,
 *          and gl_DrawID is 0 for it.
 */
inline constexpr u32 MULTI_DRAW_MAX = 64;

/**
 * @brief Whether this process's GLSL mesh programs read their draw's entry by gl_DrawID.
 *
 * @details Set by the GL device when it enables WEBGL_multi_draw, before any program is assembled, and read by the shader
 *          assembly and by the block pool, which must agree: a program that declares the array is refused a binding the size
 *          of one entry.
 */
inline bool& glslMultiDraw() {
    static bool on = false;
    return on;
}

}  // namespace esengine

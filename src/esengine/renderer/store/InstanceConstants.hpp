// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    InstanceConstants.hpp
 * @brief   WHERE one draw's entry is in the frame's per-object record texture, and what an entry says.
 *
 * @details The frame's record texture is the scene on the GPU: the per-object records a resident mesh is placed by, and beside them
 *          one ENTRY per draw, a texel saying everything about the draw a vertex stage reads by a number it only learns while it
 *          runs. A draw's block (this one, per draw and rewritten immediately before it, the way @ref ProbeConstants is) says only
 *          where its entry is.
 *
 *          The entry, RGBA32F like every texel of the texture (each value a whole number well under 2^24, so exact):
 *            x  the draw's first record. `gl_InstanceID` restarts at zero every draw while the frame's records are one
 *               continuous run, so a draw has to say where its own run begins; a merge makes that run longer, never split.
 *            y  the draw's first instance in its run's probe block, which the probe slot (ES_INSTANCE_ID) counts from.
 *            z  the texel its shapes start at (see MorphConstants.hpp), or 0 for a draw with none.
 *            w  unused.
 *
 *          Where the device draws runs (WEBGL_multi_draw) a run's entries lie one after another from its head's and the vertex
 *          stage counts through them by gl_DrawID; a draw on its own is a run of one.
 *
 *          A texel and not a uniform array: a vertex stage that indexes a uniform array by gl_DrawID or by a loop counter is
 *          one Adreno 6xx drivers fail to link ("cannot compute gv size for oob"), and with it every mesh. A uniform and not a
 *          vertex attribute: an attribute would cost the record the very slot this whole carrier exists to give back.
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

/** @brief Where one draw's entry is: a texel of the record texture. */
struct InstanceConstants {
    u32 entry = 0;
    /// std140 rounds a block up to a vec4 anyway; naming the rest keeps the C++
    /// size equal to what the shader's block occupies rather than nearly equal.
    u32 pad[3]{};
};

static_assert(sizeof(InstanceConstants) == 16,
              "InstanceConstants must be one vec4 to match std140");

/** @brief The most draws one call may carry where the device draws runs (WEBGL_multi_draw). */
inline constexpr u32 MULTI_DRAW_MAX = 64;

/**
 * @brief Whether this process's GLSL mesh programs count through a run's entries by gl_DrawID.
 *
 * @details Set by the GL device when it enables WEBGL_multi_draw, before any program is assembled, and read by the shader
 *          assembly, which then enables the extension in a stage that reads an entry.
 */
inline bool& glslMultiDraw() {
    static bool on = false;
    return on;
}

}  // namespace esengine

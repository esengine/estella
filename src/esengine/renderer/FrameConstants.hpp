// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FrameConstants.hpp
 * @brief   Per-frame shader constants shared via a single Uniform Buffer Object.
 * @details The engine's per-frame data (the view-projection) lives in exactly one
 *          UBO, bound once per frame at FRAME_CONSTANTS_BINDING. Every engine shader
 *          declares `layout(std140) uniform FrameConstants { mat4 u_projection; };`
 *          and Shader::compile auto-links that block to the binding point — there is
 *          no loose per-shader u_projection upload. This is the first non-texture
 *          resource of the eventual BindGroup model.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../core/Types.hpp"

#include <glm/glm.hpp>

namespace esengine {

/**
 * @brief CPU mirror of the GLSL FrameConstants block (std140).
 * @details A lone mat4 occupies 64 bytes at offset 0 with 16-byte alignment, so the
 *          std140 layout needs no padding. Append future per-frame fields here and in
 *          the shader block in the same order (std140 keeps prior offsets stable).
 */
struct FrameConstants {
    glm::mat4 viewProjection{1.0f};
};

/** @brief Indexed uniform binding point the FrameConstants block is bound to. */
inline constexpr u32 FRAME_CONSTANTS_BINDING = 0;

/** @brief GLSL block name; must match the shader declarations and Shader::compile lookup. */
inline constexpr const char* FRAME_CONSTANTS_BLOCK = "FrameConstants";

}  // namespace esengine

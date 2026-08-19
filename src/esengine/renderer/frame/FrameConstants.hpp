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

#include "../../core/Types.hpp"

#include <glm/glm.hpp>

#include <cmath>

namespace esengine {

/**
 * @brief CPU mirror of the GLSL FrameConstants block (std140).
 * @details A mat4 at offset 0 and a vec4 at 64 need no std140 padding. Append future
 *          fields here and in ShaderParser's injected block in the same order.
 *          camera: w = 1 means xyz is the eye's world position (perspective), w = 0
 *          that xyz points at the viewer (orthographic has no eye point).
 */
struct FrameConstants {
    glm::mat4 viewProjection{1.0f};
    glm::vec4 camera{0.0f, 0.0f, 1.0f, 0.0f};
};

/**
 * @brief Where the frame is seen from, read out of the matrix that projects it.
 *
 * @details inverse(VP) on the clip z axis: a perspective divide brings it down to
 *          the eye POINT (w = 1); orthographic has none, so it stays a DIRECTION,
 *          negated to point at the viewer (w = 0). One answer for both the shaders'
 *          FrameConstants::camera and the CPU's draw ordering.
 */
inline glm::vec4 cameraFromViewProjection(const glm::mat4& viewProjection) {
    const glm::vec4 axis = glm::inverse(viewProjection)[2];
    if (std::abs(axis.w) > 1e-6f) return glm::vec4(glm::vec3(axis) / axis.w, 1.0f);
    const f32 len = glm::length(glm::vec3(axis));
    if (len < 1e-12f) return glm::vec4(0.0f, 0.0f, 1.0f, 0.0f);
    return glm::vec4(-glm::vec3(axis) / len, 0.0f);
}

/** @brief Indexed uniform binding point the FrameConstants block is bound to. */
inline constexpr u32 FRAME_CONSTANTS_BINDING = 0;

/** @brief GLSL block name; must match the shader declarations and Shader::compile lookup. */
inline constexpr const char* FRAME_CONSTANTS_BLOCK = "FrameConstants";

/**
 * @brief CPU mirror of the injected TimeConstants block (std140).
 * @details u_time = (elapsed s, delta s, 0, 0); u_viewport = (w, h, 1/w, 1/h) of the
 *          canvas in pixels. Engine-owned: ShaderParser injects the block into every
 *          assembled stage — shaders never declare it.
 */
struct TimeConstants {
    glm::vec4 time{0.0f};
    glm::vec4 viewport{0.0f};
};

inline constexpr u32 TIME_CONSTANTS_BINDING = 3;
inline constexpr const char* TIME_CONSTANTS_BLOCK = "TimeConstants";

}  // namespace esengine

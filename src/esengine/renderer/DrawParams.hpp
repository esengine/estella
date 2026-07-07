// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DrawParams.hpp
 * @brief   Per-draw shader parameter block — the UBO home for what used to be
 *          loose uniforms.
 * @details Shaders created through ResourceManager::createShader (user draw
 *          shaders, post-process effects) may declare loose non-sampler
 *          uniforms; rewriteLooseUniforms() lifts those declarations into one
 *          `layout(std140) uniform DrawParams { ... }` block and reports the
 *          member layout. Shader keeps a CPU shadow of the block: setUniform
 *          writes land in the shadow by std140 offset and commitParams()
 *          uploads + binds the shader's UBO at DRAW_PARAMS_BINDING before the
 *          draw. Samplers stay loose uniforms (GL sampler units; bind-group
 *          entries on future backends). The setUniform authoring surface is
 *          unchanged while all uniform DATA flows through the buffer seam a
 *          WebGPU backend requires.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../core/Types.hpp"

#include <string>
#include <vector>

namespace esengine {

/** @brief Indexed UBO binding point for the per-draw DrawParams block.
 *  (0 = FrameConstants, 1 = MaterialConstants, 2 = LightConstants, 3 = TimeConstants.) */
inline constexpr u32 DRAW_PARAMS_BINDING = 4;

/** @brief GLSL block name; must match the rewriter's generated block + Shader::compile lookup. */
inline constexpr const char* DRAW_PARAMS_BLOCK = "DrawParams";

/**
 * @brief Size of the zeroed fallback UBO RenderContext binds at DRAW_PARAMS_BINDING
 *        each frame.
 * @details A draw path that never calls commitParams (e.g. a raw material shader
 *          drawn by the batch path) still needs SOME buffer bound that covers its
 *          block, or WebGL rejects the draw; the fallback makes unset members read
 *          zero — exactly what their loose-uniform ancestors read. Adoption warns
 *          if a shader's block ever exceeds this.
 */
inline constexpr u32 DRAW_PARAMS_FALLBACK_SIZE = 4096;

/** @brief GLSL type of one lifted uniform (the subset the rewriter supports). */
enum class DrawParamType : u8 { Float, Int, Vec2, Vec3, Vec4, Mat3, Mat4 };

/** @brief One lifted uniform's slot in a shader's std140 DrawParams block. */
struct DrawParamSlot {
    std::string name;
    DrawParamType type = DrawParamType::Float;
    u32 offset = 0;  ///< std140 byte offset within the block.
};

/** @brief A shader's DrawParams layout: lifted members + 16-aligned block size. */
struct DrawParamsLayout {
    std::vector<DrawParamSlot> slots;
    u32 blockSize = 0;  ///< 0 ⇒ the shader has no DrawParams block.

    bool empty() const { return blockSize == 0; }
    const DrawParamSlot* find(const std::string& name) const;
};

/** @brief std140 size/base-alignment of a supported param type. */
void drawParamSizeAlign(DrawParamType t, u32& size, u32& align);

/** @brief Result of rewriteLooseUniforms; layout.empty() ⇒ sources unchanged. */
struct DrawParamsRewrite {
    std::string vertexSrc;
    std::string fragmentSrc;
    DrawParamsLayout layout;
};

/**
 * @brief Lifts loose non-sampler uniform declarations out of both stages into
 *        one shared std140 DrawParams block.
 * @details Handles single-declarator float/int/vec2/vec3/vec4/mat3/mat4
 *          declarations (optional precision qualifier); arrays, initializers,
 *          multi-declarator lines, samplers and struct types stay loose and
 *          untouched. Both stages share ONE block definition (GLSL requires
 *          identical redeclarations), inserted where each stage's first lifted
 *          declaration was. Returns the inputs unchanged when nothing lifts,
 *          when the same name is declared with two types, or when the source
 *          already mentions the DrawParams block name.
 */
DrawParamsRewrite rewriteLooseUniforms(const std::string& vertexSrc, const std::string& fragmentSrc);

}  // namespace esengine

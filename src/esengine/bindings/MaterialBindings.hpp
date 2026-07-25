// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MaterialBindings.hpp
 * @brief   Material + `.esshader` entry points, for whichever core is embedded.
 *
 * @details A material is engine-side data: the SDK compiles its shader here, then
 *          pushes the resolved render state and param values, and the render path
 *          reads them by the handle a component carries. These used to live in the
 *          web entry point as hand-written embind, which made every material — and
 *          every post-process pass, whose shader compiles through the same
 *          `material_compileEsshader` — web-only by construction. Declared here,
 *          EHT generates the native wrappers from the same source embind registers.
 */
#pragma once


#include "../core/Types.hpp"
#include <string>

namespace esengine {

/**
 * Compile a `.esshader` through the full ShaderParser path — assembling the
 * auto-generated MaterialConstants block plus the requested feature/switch
 * permutation (each feature -> `#define NAME 1`) — and register its param layout.
 * @p featuresCsv is the enabled `#pragma switch` set, comma-separated, so a
 * material's static switches select a permutation; the SDK loader caches one
 * compiled program per (shader, switch-set). Returns the shader resource handle,
 * or 0 on failure.
 */
u32 material_compileEsshader(const std::string& source, const std::string& featuresCsv);

/**
 * Publish a material's resolved render state. @p shaderHandle is the SDK shader
 * resource handle, translated here to the program id the render path binds;
 * @p flags packs depthTest (bit 0), depthWrite (bit 1) and CullMode (bits 2-3).
 * Param values arrive separately, via material_setUniform / material_setTexture.
 */
void material_define(u32 materialId, u32 shaderHandle, u32 blendMode, u32 flags);

/** Pack a named param's float components into the material's std140 block, by
 *  reflected offset. A no-op when the shader declares no matching `#pragma param`. */
void material_setUniform(u32 materialId, const std::string& name, u32 arity,
                         f32 v0, f32 v1, f32 v2, f32 v3);

/** Bind a texture param to its reflected sampler unit. @p textureHandle is an SDK
 *  texture resource handle; 0 clears the binding back to the param's default. */
void material_setTexture(u32 materialId, const std::string& name, u32 textureHandle);

void material_undefine(u32 materialId);

}  // namespace esengine

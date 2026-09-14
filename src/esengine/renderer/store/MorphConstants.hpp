// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MorphConstants.hpp
 * @brief   The shapes one draw is blended towards: which targets, and how far.
 *
 * @details Per DRAW and rewritten immediately before it, exactly as
 *          @ref SkinConstants is — the same reason serves both: only one draw's
 *          deformation is ever in flight.
 *
 *          The DELTAS are not here. They are per vertex per target, which is
 *          megabytes and no uniform block, so they live in a texture the mesh
 *          owns and this block says where in it to look. What a block can carry
 *          is the part that changes every frame: the weights.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../rhi/GfxEnums.hpp"
#include "../../math/Math.hpp"

namespace esengine {

/** @brief Indexed UBO binding point for the per-draw MorphConstants block. */
inline constexpr u32 MORPH_CONSTANTS_BINDING = 6;

/** @brief GLSL block name; must match the shader's declaration + Shader::compile lookup. */
inline constexpr const char* MORPH_CONSTANTS_BLOCK = "MorphConstants";

/** @brief The sampler the deltas arrive through, and the unit it is pinned to. */
inline constexpr const char* MORPH_DELTA_SAMPLER = "u_morphDeltas";
inline constexpr u32 MORPH_DELTA_TEXTURE_UNIT = 4;

/** @brief std140 mirror of the block. */
struct MorphConstants {
    /// x = live shapes below, y = vertices, z = texels one vertex occupies (2
    /// where the targets bend normals), w = the texture's width. Floats: a
    /// std140 int vector is the member the two backends align differently.
    glm::vec4 info{0.0f};
    /// x = which target, y = how far towards it. Only the first `info.x` are read.
    glm::vec4 shape[MESH_MAX_ACTIVE_MORPHS];
};

static_assert(sizeof(MorphConstants) == 16 + MESH_MAX_ACTIVE_MORPHS * 16,
              "MorphConstants must be a tight array of vec4 to match std140");

}  // namespace esengine

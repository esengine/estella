// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SkinConstants.hpp
 * @brief   The pose one skinned draw is deformed by: a bone matrix per joint.
 *
 * @details Per DRAW, unlike the frame's lights and the material's parameters, so
 *          it is uploaded and bound immediately before the draw that reads it —
 *          the same shape the engine's other blocks have, at the next binding
 *          point. A uniform block rather than a texture because a bind group's
 *          textures are visible to the fragment stage alone on WebGPU, while its
 *          buffers are already visible to both.
 *
 *          Each matrix is `jointWorld * inverseBind`: world space, because a
 *          skinned mesh's own transform is ignored (glTF requires it) — the
 *          joints are already placed, so the vertices they move are too.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../rhi/GfxEnums.hpp"
#include "../../math/Math.hpp"

namespace esengine {

/** @brief Indexed UBO binding point for the per-draw SkinConstants block. */
inline constexpr u32 SKIN_CONSTANTS_BINDING = 5;

/** @brief GLSL block name; must match the shader's declaration + Shader::compile lookup. */
inline constexpr const char* SKIN_CONSTANTS_BLOCK = "SkinConstants";

/** @brief std140 mirror of the block. One mat4 per joint, MESH_MAX_BONES of them. */
struct SkinConstants {
    glm::mat4 bones[MESH_MAX_BONES];
};

static_assert(sizeof(SkinConstants) == MESH_MAX_BONES * 64,
              "SkinConstants must be a tight array of mat4 to match std140");

}  // namespace esengine

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MorphConstants.hpp
 * @brief   The shapes one draw is blended towards: which targets, and how far.
 *
 * @details Per DRAW. The DELTAS are not here: they are per vertex per target,
 *          which is megabytes, so they live in a texture the mesh owns and this
 *          says where in it to look. What is here is the part that changes every
 *          frame: the weights.
 *
 *          The draw list writes them into the frame's record texture beside the
 *          draw's entry, `info` first and then one texel per live shape, and the
 *          entry's z names the first (see InstanceConstants.hpp). A texel fetch and
 *          not a uniform block: the vertex stage loops over the shapes, and a loop
 *          indexing a uniform array is one Adreno 6xx drivers fail to link.
 */
#pragma once

#include "../../core/Types.hpp"
#include "./EngineTextureUnits.hpp"
#include "../rhi/GfxEnums.hpp"
#include "../../math/Math.hpp"

namespace esengine {

/** @brief One draw's shapes, laid out as the texels they are written as. */
struct MorphConstants {
    /// x = live shapes below, y = vertices, z = texels one vertex occupies (2
    /// where the targets bend normals), w = the delta texture's width.
    glm::vec4 info{0.0f};
    /// x = which target, y = how far towards it. Only the first `info.x` are written.
    glm::vec4 shape[MESH_MAX_ACTIVE_MORPHS];
};

static_assert(sizeof(MorphConstants) == 16 + MESH_MAX_ACTIVE_MORPHS * 16,
              "MorphConstants must be a tight run of texels");

}  // namespace esengine

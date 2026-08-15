// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Mesh.hpp
 * @brief   Geometry that lives on the GPU rather than in a frame.
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "../renderer/rhi/GfxEnums.hpp"
#include "./Handle.hpp"

namespace esengine {

/**
 * @brief Buffers, the layout that describes them, and the bounds culling reads.
 *
 * @details One record because the three are inseparable: a buffer without its
 *          layout cannot be drawn, and bounds kept elsewhere go stale. Material,
 *          layer and transform belong to the entity, so one mesh serves many.
 */
class Mesh {
public:
    resource::VertexBufferHandle vertices;
    resource::IndexBufferHandle indices;

    /** GPU-side handles, cached so a draw does not walk two pools per frame. */
    BufferHandle vertexBuffer = BufferHandle::Invalid;
    BufferHandle indexBuffer = BufferHandle::Invalid;
    VertexLayoutHandle layout = VertexLayoutHandle::Invalid;

    u32 indexCount = 0;

    /** Whether the vertices carry normals — decides the per-object record's shape
     *  and which shader variant draws it. */
    bool hasNormals = false;

    /** Local-space bounds of the vertices, for the frustum cull. */
    glm::vec3 localMin{0.0f, 0.0f, 0.0f};
    glm::vec3 localMax{0.0f, 0.0f, 0.0f};

    bool isDrawable() const {
        return vertexBuffer != BufferHandle::Invalid
            && indexBuffer != BufferHandle::Invalid
            && layout != VertexLayoutHandle::Invalid
            && indexCount > 0;
    }
};

}  // namespace esengine

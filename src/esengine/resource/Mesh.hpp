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

#include <vector>

namespace esengine {

/**
 * @brief How a mesh's geometry comes back after a device generation ends.
 *
 * @details Declared by the producer that mints the handle, because nothing
 *          downstream can work it out — by the time recovery runs, all that is
 *          left of a mesh is a number. tools/meshProducers.mjs is the census
 *          that keeps every producer's answer here and its declaration in step.
 */
enum class MeshRecovery : u8 {
    SourceReplayable,  ///< Replayable from an asset the loader can load again.
    HostOnly,          ///< Built in this process from bytes kept nowhere else.
};

/**
 * @brief Buffers, the layout that describes them, and the bounds culling reads.
 *
 * @details One record because the three are inseparable: a buffer without its
 *          layout cannot be drawn, and bounds kept elsewhere go stale. Material,
 *          layer and transform belong to the entity, so one mesh serves many.
 *
 *          The handle is a LOGICAL identity: the buffers and the layout realize
 *          it on ONE device generation and a lost device takes all three, while
 *          the handle survives. Where the geometry comes back FROM is the
 *          minting producer's to declare — tools/meshProducers.mjs.
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

    /** Set at mint by the producer that created this mesh; never inferred later.
     *  Defaulted to the answer that promises nothing, so a mesh reaching the pool
     *  without one is never mistaken for recoverable. */
    MeshRecovery recovery = MeshRecovery::HostOnly;

    /** The device generation the three handles above belong to. A diagnostic:
     *  it answers whether a mesh was really rebuilt, where a non-zero handle
     *  only looks like it. */
    u64 realizationGeneration = 0;

    /** Whether the vertices carry normals — decides the per-object record's shape
     *  and which shader variant draws it. */
    bool hasNormals = false;

    /** Local-space bounds of the vertices, for the frustum cull. */
    glm::vec3 localMin{0.0f, 0.0f, 0.0f};
    glm::vec3 localMax{0.0f, 0.0f, 0.0f};

    /** The bind pose, one per joint the Joints channel indexes. Empty for
     *  geometry nothing skins; its size is what a skinned draw allocates. */
    std::vector<glm::mat4> inverseBind;

    bool isSkinned() const { return !inverseBind.empty(); }

    /** Whether a live GPU realization stands behind this identity. False from a
     *  device loss until the rematerialization that replaces it, which is what
     *  stops the draw path consuming buffers that died with their device. */
    bool hasRealization() const {
        return vertexBuffer != BufferHandle::Invalid
            && indexBuffer != BufferHandle::Invalid
            && layout != VertexLayoutHandle::Invalid;
    }

    bool isDrawable() const { return hasRealization() && indexCount > 0; }
};

}  // namespace esengine

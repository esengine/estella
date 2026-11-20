// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Mesh.hpp
 * @brief   Geometry that lives on the GPU rather than in a frame.
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "../renderer/lod/ClusterSelection.hpp"
#include "../renderer/rhi/GfxEnums.hpp"
#include "./Handle.hpp"

#include <memory>
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
    HostOnly,          ///< Built in this process; the device keeps its bytes.
};

/**
 * @brief The shapes handed to a realization: the deltas, and how to read them.
 *
 * @details One record because the three are unreadable apart — the array is flat,
 *          and the count and the flag are what say where target i begins.
 */
struct MeshMorphSource {
    /// `targetCount * vertexCount * (hasNormals ? 6 : 3)` floats.
    ConstSpan<f32> deltas;
    u32 targetCount = 0;
    bool hasNormals = false;
};

/**
 * @brief One piece a skinned mesh is drawn in, when its bones are more than one draw can carry.
 *
 * @details A run of the mesh's own indices whose vertices are moved only by the chunk's bones: its vertices' joint `k` is
 *          the chunk's `k`-th bone, an index into the bind matrices kept in Mesh::skinChunkBones.
 */
struct MeshSkinChunk {
    /** First index of the run, from the mesh's own first. */
    u32 firstIndex = 0;
    u32 indexCount = 0;
    /** Where the chunk's bones start in Mesh::skinChunkBones, and how many. At most MESH_MAX_BONES. */
    u32 boneOffset = 0;
    u32 boneCount = 0;
};

/**
 * @brief Buffers, the layout that describes them, and the bounds culling reads.
 *
 * @details One record because the three are inseparable: a buffer without its
 *          layout cannot be drawn, and bounds kept elsewhere go stale. Where the
 *          geometry comes back from after a device loss is the minting producer's
 *          to declare — tools/meshProducers.mjs.
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

    /**
     * Where this mesh's first index sits in indexBuffer: past zero when the mesh shares a page with others of its vertex shape
     * (MeshArena), whose buffers and layout it then draws through. Its indices are rebased onto the page's vertices, so a draw
     * reads indexCount of them from here and needs nothing else to find its own.
     */
    u32 firstIndex = 0;
    /** The page and first vertex of that place, to give it back: page 0 is buffers of the mesh's own. */
    u32 arenaPage = 0;
    u32 arenaFirstVertex = 0;

    /**
     * The mesh's own edges as line-list indices into the same vertices, one pair per
     * distinct edge. Derived from `indices` when the mesh is realized, and only while
     * the manager is asked for diagnostic geometry (an editor's wireframe view): a
     * shipped game spends nothing on it. Invalid otherwise.
     */
    resource::IndexBufferHandle edges;
    BufferHandle edgeIndexBuffer = BufferHandle::Invalid;
    u32 edgeIndexCount = 0;

    /** Whether the edges can be drawn. */
    bool hasEdges() const { return edgeIndexBuffer != BufferHandle::Invalid && edgeIndexCount > 0; }

    /** Set at mint by the producer that created this mesh; never inferred later.
     *  Defaulted to the answer that promises nothing, so a mesh reaching the pool
     *  without one is never mistaken for recoverable. */
    MeshRecovery recovery = MeshRecovery::HostOnly;

    /** Whether the vertices carry normals — decides the per-object record's shape
     *  and which shader variant draws it. */
    bool hasNormals = false;

    /** Whether the vertices carry a second UV set — the one a bake is read
     *  through. Beside hasNormals and for the same reason: an optional channel
     *  the geometry owns decides the record's shape and the variant. */
    bool hasLightmapUV = false;

    /** Whether the vertices carry a tangent (xyz along +u, w the bitangent's handedness) beside the normal — the frame a
     *  normal map was baked in. Without one the fragment derives a frame from screen-space derivatives. */
    bool hasTangents = false;

    /** UV units per world unit of the mesh's own surface (see MeshUvDensity.hpp): what a view asks a texture's size by. 0 without
     *  float positions and a float first UV set. */
    f32 uvDensity = 0.0f;

    /** Local-space bounds of the vertices, for the frustum cull. */
    glm::vec3 localMin{0.0f, 0.0f, 0.0f};
    glm::vec3 localMax{0.0f, 0.0f, 0.0f};

    /** The bind pose, one per joint the Joints channel indexes. Empty for
     *  geometry nothing skins; its size is what a skinned draw allocates. */
    std::vector<glm::mat4> inverseBind;

    bool isSkinned() const { return !inverseBind.empty(); }

    /** The shapes this geometry can be blended towards, as a texture of deltas:
     *  one texel per (target, vertex), and a second behind it where the targets
     *  bend normals. Realized with the buffers above and lost with them. */
    TextureHandle morphTexture = TextureHandle::Invalid;
    u32 morphTargetCount = 0;
    bool morphHasNormals = false;
    /** Vertices the deltas are indexed by — the stride from one target to the
     *  next inside the texture, and the reason it is kept beside them. */
    u32 vertexCount = 0;

    bool isMorphable() const {
        return morphTargetCount > 0 && morphTexture != TextureHandle::Invalid;
    }

    /**
     * The mesh at every level of detail, as clusters a view picks from (ClusterSelection.hpp). Null for a mesh drawn whole.
     * `indexBuffer` holds level 0, the mesh's own triangles, so whatever knows nothing of clusters draws it as it always was.
     * Given after the geometry is realized and dropped when it is realized again: the indices in it name these vertices.
     */
    std::shared_ptr<const lod::ClusterHierarchy> clusters;

    /**
     * The chunks a skin of more bones than one draw carries is drawn in, one draw each; empty for a mesh drawn in one.
     * Given after the geometry is realized and dropped when it is realized again, like the clusters: its runs name these
     * indices and its bones these bind matrices.
     */
    std::vector<MeshSkinChunk> skinChunks;
    std::vector<u16> skinChunkBones;
    bool isChunked() const { return !skinChunks.empty(); }

    /** Changes whenever this mesh's geometry does (it is realized again: a reload, a recovery): see core/Revision.hpp. */
    u64 revision = 0;

    /** Whether GPU buffers stand behind this identity. */
    bool hasRealization() const {
        return vertexBuffer != BufferHandle::Invalid
            && indexBuffer != BufferHandle::Invalid
            && layout != VertexLayoutHandle::Invalid;
    }


    bool isDrawable() const { return hasRealization() && indexCount > 0; }
};

}  // namespace esengine

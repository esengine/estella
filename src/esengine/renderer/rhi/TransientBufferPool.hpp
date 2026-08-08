// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "./GfxDevice.hpp"

#include <vector>
#include <array>

namespace esengine {

// LayoutId / LAYOUT_COUNT now live in GfxEnums.hpp (a leaf header) so PipelineState can
// reference LayoutId without pulling in the GfxDevice include cycle.

/**
 * Per-frame vertex/index staging with one independent VBO+EBO+vertex-layout per stream.
 *
 * Design note: heterogeneous vertex formats (BatchVertex 20B, ShapeVertex 48B,
 * ...) cannot safely share a single VBO because each plugin computes
 * `baseVertex = byteOffset / sizeof(OwnVertex)`. Once a prior plugin writes a
 * non-multiple of the next plugin's vertex size, the next plugin's baseVertex
 * truncates and the GPU reads garbage vertices. Giving each layout its own
 * stream makes every offset "vertex 0" for that layout by construction — no
 * alignment discipline needed at call sites, no cross-plugin coupling.
 */
class TransientBufferPool {
public:
    explicit TransientBufferPool(GfxDevice& device);

    void init(u32 initialVertexBytes = 2 * 1024 * 1024,
              u32 initialIndexCount = 256 * 1024);
    void shutdown();

    /// Re-creates the streams' GPU buffers and layouts after a device loss.
    void recreateGpuResources();

    void beginFrame();

    u32 allocVertices(LayoutId layout, u32 byteSize);
    u32 allocIndices(LayoutId layout, u32 count);

    void writeVertices(LayoutId layout, u32 byteOffset, const void* data, u32 byteSize);
    void writeIndices(LayoutId layout, u32 indexOffset, const u32* data, u32 count);

    u32 appendVertices(LayoutId layout, const void* data, u32 byteSize);
    u32 appendIndices(LayoutId layout, const u32* data, u32 count);

    /** Upload every non-empty stream's staging to its VBO/EBO. */
    void upload();

    /** Bind this stream's vertex + index buffers for the next draw. */
    void bindLayout(LayoutId layout);

    /**
     * Bind an instanced stream with its per-instance buffer rebased to @p instanceByteOffset.
     * GLES3 has no baseInstance, so each emitter's instanced draw rebases the instance
     * slot here before drawElementsInstanced. The static quad slot is untouched.
     */
    void bindInstanceLayout(LayoutId layout, u32 instanceByteOffset);

    /** The device vertex layout a pipeline drawing this stream must reference. */
    VertexLayoutHandle layoutHandle(LayoutId layout) const;

    /** Byte stride of this stream's writable vertex slot (the per-instance slot for
     *  ParticleInstance) — the single source for baseVertex math, so submission code
     *  never hardcodes a sizeof that could drift from the device layout. */
    u32 vertexStride(LayoutId layout) const;

    /** Direct write-through pointer into a layout's staging, for hot paths
     *  that want to format vertices in place after `allocVertices`. */
    u8* vertexData(LayoutId layout);
    u32 vertexBytesUsed(LayoutId layout) const;
    u32 indicesUsed(LayoutId layout) const;
    BufferHandle vertexBuffer(LayoutId layout) const;
    BufferHandle indexBuffer(LayoutId layout) const;

private:
    struct Stream {
        BufferHandle vbo = BufferHandle::Invalid;  // for ParticleInstance: the per-instance (streamed) buffer
        BufferHandle ebo = BufferHandle::Invalid;
        VertexLayoutHandle layout = VertexLayoutHandle::Invalid;
        BufferHandle quad_vbo = BufferHandle::Invalid;  // ParticleInstance only: static unit-quad geometry (slot 0)
        std::vector<u8> vertex_staging;
        std::vector<u32> index_staging;  // 32-bit indices: a single Batch stream can exceed 65535 vertices
        u32 vertex_stride = 0;
        u32 vertex_write_pos = 0;
        u32 index_write_pos = 0;
        u32 vbo_capacity = 0;
        u32 ebo_capacity = 0;
    };

    void setupStream(LayoutId layout);
    void growVertexStaging(Stream& s, u32 requiredBytes);
    void growIndexStaging(Stream& s, u32 requiredCount);

    Stream& stream(LayoutId layout);
    const Stream& stream(LayoutId layout) const;

    GfxDevice& device_;
    std::array<Stream, LAYOUT_COUNT> streams_{};
    u32 initial_vertex_bytes_ = 0;
    u32 initial_index_count_ = 0;
    bool initialized_ = false;
};

}  // namespace esengine

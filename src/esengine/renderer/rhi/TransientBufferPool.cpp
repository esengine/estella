// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./TransientBufferPool.hpp"
#include "../../core/Log.hpp"

#include <cstring>
#include <algorithm>

namespace esengine {

TransientBufferPool::TransientBufferPool(GfxDevice& device)
    : device_(device) {
}

void TransientBufferPool::init(u32 initialVertexBytes, u32 initialIndexCount) {
    if (initialized_) return;
    initial_vertex_bytes_ = initialVertexBytes;
    initial_index_count_ = initialIndexCount;

    for (auto layout : {LayoutId::Batch, LayoutId::ParticleInstance, LayoutId::Shape}) {
        setupStream(layout);
    }

    initialized_ = true;
}

void TransientBufferPool::recreateGpuResources() {
    if (!initialized_) return;
    // Dropped without deleting, then re-set up from the same initial sizes. The
    // staging vectors are CPU-side and survive; only their write positions reset.
    for (auto& s : streams_) {
        s.vbo = BufferHandle::Invalid;
        s.ebo = BufferHandle::Invalid;
        s.quad_vbo = BufferHandle::Invalid;
        s.layout = VertexLayoutHandle::Invalid;
        s.vbo_capacity = 0;
        s.ebo_capacity = 0;
        s.vertex_write_pos = 0;
        s.index_write_pos = 0;
    }
    initialized_ = false;
    init(initial_vertex_bytes_, initial_index_count_);
}

void TransientBufferPool::shutdown() {
    if (!initialized_) return;

    for (auto& s : streams_) {
        if (s.layout != VertexLayoutHandle::Invalid) {
            device_.deleteVertexLayout(s.layout);
            s.layout = VertexLayoutHandle::Invalid;
        }
        if (s.vbo != BufferHandle::Invalid) { device_.deleteBuffer(s.vbo); s.vbo = BufferHandle::Invalid; }
        if (s.ebo != BufferHandle::Invalid) { device_.deleteBuffer(s.ebo); s.ebo = BufferHandle::Invalid; }
        if (s.quad_vbo != BufferHandle::Invalid) { device_.deleteBuffer(s.quad_vbo); s.quad_vbo = BufferHandle::Invalid; }
        s.vertex_staging.clear();
        s.index_staging.clear();
        s.vertex_write_pos = 0;
        s.index_write_pos = 0;
        s.vbo_capacity = 0;
        s.ebo_capacity = 0;
    }
    initialized_ = false;
}

void TransientBufferPool::beginFrame() {
    for (auto& s : streams_) {
        s.vertex_write_pos = 0;
        s.index_write_pos = 0;
    }
}

TransientBufferPool::Stream& TransientBufferPool::stream(LayoutId layout) {
    return streams_[static_cast<u32>(layout)];
}

const TransientBufferPool::Stream& TransientBufferPool::stream(LayoutId layout) const {
    return streams_[static_cast<u32>(layout)];
}

u32 TransientBufferPool::allocVertices(LayoutId layout, u32 byteSize) {
    Stream& s = stream(layout);
    u32 offset = s.vertex_write_pos;
    u32 newPos = s.vertex_write_pos + byteSize;
    if (newPos > static_cast<u32>(s.vertex_staging.size())) {
        growVertexStaging(s, newPos);
    }
    s.vertex_write_pos = newPos;
    return offset;
}

u32 TransientBufferPool::allocIndices(LayoutId layout, u32 count) {
    Stream& s = stream(layout);
    u32 offset = s.index_write_pos;
    u32 newPos = s.index_write_pos + count;
    if (newPos > static_cast<u32>(s.index_staging.size())) {
        growIndexStaging(s, newPos);
    }
    s.index_write_pos = newPos;
    return offset;
}

void TransientBufferPool::writeVertices(LayoutId layout, u32 byteOffset, const void* data, u32 byteSize) {
    std::memcpy(stream(layout).vertex_staging.data() + byteOffset, data, byteSize);
}

void TransientBufferPool::writeIndices(LayoutId layout, u32 indexOffset, const u32* data, u32 count) {
    std::memcpy(stream(layout).index_staging.data() + indexOffset, data, count * sizeof(u32));
}

u32 TransientBufferPool::appendVertices(LayoutId layout, const void* data, u32 byteSize) {
    u32 offset = allocVertices(layout, byteSize);
    writeVertices(layout, offset, data, byteSize);
    return offset;
}

u32 TransientBufferPool::appendIndices(LayoutId layout, const u32* data, u32 count) {
    u32 offset = allocIndices(layout, count);
    writeIndices(layout, offset, data, count);
    return offset;
}

void TransientBufferPool::upload() {
    // Growth goes through resizeBuffer, which keeps the handle stable, so per-draw
    // buffer bindings and the backend's cached vertex state stay valid.
    for (auto& s : streams_) {
        if (s.vbo == BufferHandle::Invalid) continue;
        if (s.vertex_write_pos == 0 && s.index_write_pos == 0) continue;

        // Grow to the STAGING capacity, which already doubles — not to what this
        // frame needed, which reallocates every frame for a workload creeping
        // upward (2.1MB, 2.2MB, 2.3MB). One growth rule, in growVertexStaging.
        if (s.vertex_write_pos > s.vbo_capacity) {
            s.vbo_capacity = static_cast<u32>(s.vertex_staging.size());
            device_.resizeBuffer(s.vbo, s.vbo_capacity, s.vertex_staging.data());
        } else if (s.vertex_write_pos > 0) {
            device_.updateBuffer(s.vbo, 0, s.vertex_staging.data(), s.vertex_write_pos);
        }

        u32 eboBytes = s.index_write_pos * sizeof(u32);
        u32 eboCapBytes = s.ebo_capacity * sizeof(u32);
        if (eboBytes > eboCapBytes) {
            s.ebo_capacity = static_cast<u32>(s.index_staging.size());
            device_.resizeBuffer(s.ebo, static_cast<u32>(s.ebo_capacity * sizeof(u32)),
                                 s.index_staging.data());
        } else if (eboBytes > 0) {
            device_.updateBuffer(s.ebo, 0, s.index_staging.data(), eboBytes);
        }
    }
}

void TransientBufferPool::bindLayout(LayoutId layout) {
    const Stream& s = stream(layout);
    if (layout == LayoutId::ParticleInstance) {
        bindInstanceLayout(layout, 0);
        return;
    }
    device_.setVertexBuffer(0, s.vbo, 0);
    device_.setIndexBuffer(s.ebo);
}

void TransientBufferPool::bindInstanceLayout(LayoutId layout, u32 instanceByteOffset) {
    const Stream& s = stream(layout);
    device_.setVertexBuffer(0, s.quad_vbo, 0);
    device_.setVertexBuffer(1, s.vbo, instanceByteOffset);
    device_.setIndexBuffer(s.ebo);
}

VertexLayoutHandle TransientBufferPool::layoutHandle(LayoutId layout) const {
    return stream(layout).layout;
}

u8* TransientBufferPool::vertexData(LayoutId layout) {
    return stream(layout).vertex_staging.data();
}

u32 TransientBufferPool::vertexBytesUsed(LayoutId layout) const {
    return stream(layout).vertex_write_pos;
}

u32 TransientBufferPool::indicesUsed(LayoutId layout) const {
    return stream(layout).index_write_pos;
}

BufferHandle TransientBufferPool::vertexBuffer(LayoutId layout) const {
    return stream(layout).vbo;
}

BufferHandle TransientBufferPool::indexBuffer(LayoutId layout) const {
    return stream(layout).ebo;
}

u32 TransientBufferPool::vertexStride(LayoutId layout) const {
    return stream(layout).vertex_stride;
}

void TransientBufferPool::setupStream(LayoutId layout) {
    Stream& s = stream(layout);

    if (layout == LayoutId::ParticleInstance) {
        // Per-instance (per-particle) stream: dynamic, streamed each frame.
        s.vertex_staging.resize(initial_vertex_bytes_);
        s.vbo_capacity = initial_vertex_bytes_;
        s.vbo = device_.createBuffer({GfxBufferUsage::Vertex, s.vbo_capacity, /*dynamic=*/true}, nullptr);

        // Static unit quad (pos + uv) and its 6 indices, uploaded once. UVs are laid out
        // so the instance shader's a_texCoord*uvScale+uvOffset reproduces the prior
        // per-corner particle UVs.
        struct QuadV { f32 px, py, u, v; };
        const QuadV quad[4] = {
            { -0.5f, -0.5f, 0.0f, 1.0f },
            {  0.5f, -0.5f, 1.0f, 1.0f },
            {  0.5f,  0.5f, 1.0f, 0.0f },
            { -0.5f,  0.5f, 0.0f, 0.0f },
        };
        const u32 quadIdx[6] = { 0, 1, 2, 2, 3, 0 };
        s.quad_vbo = device_.createBuffer(
            {GfxBufferUsage::Vertex, static_cast<u32>(sizeof(quad)), /*dynamic=*/false}, quad);
        s.ebo = device_.createBuffer(
            {GfxBufferUsage::Index, static_cast<u32>(sizeof(quadIdx)), /*dynamic=*/false}, quadIdx);

        // Slot 0: the static quad (per vertex). Slot 1: the instance stream (per instance),
        // rebased per draw in bindInstanceLayout.
        VertexLayoutDesc desc;
        desc.attributeCount = 8;
        desc.strides[0] = 16;
        desc.strides[1] = 40;
        desc.instanceStep[1] = true;
        desc.attributes[0] = {0, 2, GfxDataType::Float, false, 0, 0};
        desc.attributes[1] = {1, 2, GfxDataType::Float, false, 8, 0};
        desc.attributes[2] = {2, 2, GfxDataType::Float, false, 0, 1};
        desc.attributes[3] = {3, 2, GfxDataType::Float, false, 8, 1};
        desc.attributes[4] = {4, 1, GfxDataType::Float, false, 16, 1};
        desc.attributes[5] = {5, 4, GfxDataType::UnsignedByte, true, 20, 1};
        desc.attributes[6] = {6, 2, GfxDataType::Float, false, 24, 1};
        desc.attributes[7] = {7, 2, GfxDataType::Float, false, 32, 1};
        s.vertex_stride = desc.strides[1];
        s.layout = device_.createVertexLayout(desc);
        return;
    }

    s.vertex_staging.resize(initial_vertex_bytes_);
    s.index_staging.resize(initial_index_count_);
    s.vbo_capacity = initial_vertex_bytes_;
    s.ebo_capacity = initial_index_count_;

    s.vbo = device_.createBuffer({GfxBufferUsage::Vertex, s.vbo_capacity, /*dynamic=*/true}, nullptr);
    s.ebo = device_.createBuffer(
        {GfxBufferUsage::Index, static_cast<u32>(s.ebo_capacity * sizeof(u32)), /*dynamic=*/true}, nullptr);

    VertexLayoutDesc desc;
    switch (layout) {
        case LayoutId::Batch:
            // BatchVertex: pos(12) + color(4) + uv(8) + texIndex(4) + sdfBias(4)
            desc.attributeCount = 5;
            desc.strides[0] = 32;
            desc.attributes[0] = {0, 3, GfxDataType::Float, false, 0, 0};
            desc.attributes[1] = {1, 4, GfxDataType::UnsignedByte, true, 12, 0};
            desc.attributes[2] = {2, 2, GfxDataType::Float, false, 16, 0};
            desc.attributes[3] = {3, 1, GfxDataType::Float, false, 24, 0};
            desc.attributes[4] = {4, 1, GfxDataType::Float, false, 28, 0};
            break;
        case LayoutId::Shape:
            desc.attributeCount = 4;
            desc.strides[0] = 48;
            desc.attributes[0] = {0, 2, GfxDataType::Float, false, 0, 0};
            desc.attributes[1] = {1, 2, GfxDataType::Float, false, 8, 0};
            desc.attributes[2] = {2, 4, GfxDataType::Float, false, 16, 0};
            desc.attributes[3] = {3, 4, GfxDataType::Float, false, 32, 0};
            break;
        default:
            break;
    }
    s.vertex_stride = desc.strides[0];
    s.layout = device_.createVertexLayout(desc);
}

void TransientBufferPool::growVertexStaging(Stream& s, u32 requiredBytes) {
    u32 newSize = static_cast<u32>(s.vertex_staging.size());
    if (newSize == 0) newSize = 1024;
    while (newSize < requiredBytes) {
        newSize = newSize * 2;
    }
    s.vertex_staging.resize(newSize);
    ES_LOG_WARN("TransientBufferPool: vertex staging grown to {}KB", newSize / 1024);
}

void TransientBufferPool::growIndexStaging(Stream& s, u32 requiredCount) {
    u32 newSize = static_cast<u32>(s.index_staging.size());
    if (newSize == 0) newSize = 1024;
    while (newSize < requiredCount) {
        newSize = newSize * 2;
    }
    s.index_staging.resize(newSize);
    ES_LOG_WARN("TransientBufferPool: index staging grown to {} indices", newSize);
}

}  // namespace esengine

#include "TransientBufferPool.hpp"
#include "../core/Log.hpp"

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

    for (auto layout : {LayoutId::Batch, LayoutId::Shape, LayoutId::MatSprite}) {
        setupStream(layout);
    }

    initialized_ = true;
}

void TransientBufferPool::shutdown() {
    if (!initialized_) return;

    for (auto& s : streams_) {
        if (s.vao) { device_.deleteVertexArray(s.vao); s.vao = 0; }
        if (s.vbo) { device_.deleteBuffer(s.vbo); s.vbo = 0; }
        if (s.ebo) { device_.deleteBuffer(s.ebo); s.ebo = 0; }
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

void TransientBufferPool::writeIndices(LayoutId layout, u32 indexOffset, const u16* data, u32 count) {
    std::memcpy(stream(layout).index_staging.data() + indexOffset, data, count * sizeof(u16));
}

u32 TransientBufferPool::appendVertices(LayoutId layout, const void* data, u32 byteSize) {
    u32 offset = allocVertices(layout, byteSize);
    writeVertices(layout, offset, data, byteSize);
    return offset;
}

u32 TransientBufferPool::appendIndices(LayoutId layout, const u16* data, u32 count) {
    u32 offset = allocIndices(layout, count);
    writeIndices(layout, offset, data, count);
    return offset;
}

void TransientBufferPool::upload() {
    for (auto& s : streams_) {
        if (!s.vbo) continue;
        if (s.vertex_write_pos == 0 && s.index_write_pos == 0) continue;

        device_.bindVertexBuffer(s.vbo);
        if (s.vertex_write_pos > s.vbo_capacity) {
            s.vbo_capacity = s.vertex_write_pos;
            device_.bufferData(GfxBufferTarget::Vertex, s.vertex_staging.data(), s.vbo_capacity, true);
        } else if (s.vertex_write_pos > 0) {
            device_.bufferSubData(GfxBufferTarget::Vertex, 0, s.vertex_staging.data(), s.vertex_write_pos);
        }

        device_.bindIndexBuffer(s.ebo);
        u32 eboBytes = s.index_write_pos * sizeof(u16);
        u32 eboCapBytes = s.ebo_capacity * sizeof(u16);
        if (eboBytes > eboCapBytes) {
            s.ebo_capacity = s.index_write_pos;
            device_.bufferData(GfxBufferTarget::Index, s.index_staging.data(),
                                s.ebo_capacity * sizeof(u16), true);
        } else if (eboBytes > 0) {
            device_.bufferSubData(GfxBufferTarget::Index, 0, s.index_staging.data(), eboBytes);
        }
    }
}

void TransientBufferPool::bindLayout(LayoutId layout) {
    const Stream& s = stream(layout);
    if (s.vao) device_.bindVertexArray(s.vao);
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

u32 TransientBufferPool::vboId(LayoutId layout) const {
    return stream(layout).vbo;
}

u32 TransientBufferPool::eboId(LayoutId layout) const {
    return stream(layout).ebo;
}

void TransientBufferPool::setupStream(LayoutId layout) {
    Stream& s = stream(layout);

    s.vertex_staging.resize(initial_vertex_bytes_);
    s.index_staging.resize(initial_index_count_);
    s.vbo_capacity = initial_vertex_bytes_;
    s.ebo_capacity = initial_index_count_;

    s.vbo = device_.createBuffer();
    s.ebo = device_.createBuffer();

    device_.bindVertexBuffer(s.vbo);
    device_.bufferData(GfxBufferTarget::Vertex, nullptr, s.vbo_capacity, true);

    device_.bindIndexBuffer(s.ebo);
    device_.bufferData(GfxBufferTarget::Index, nullptr, s.ebo_capacity * sizeof(u16), true);

    s.vao = device_.createVertexArray();
    device_.bindVertexArray(s.vao);
    // VAO captures the ELEMENT_ARRAY_BUFFER binding at this point, and every
    // subsequent vertexAttribPointer captures the currently-bound ARRAY_BUFFER.
    device_.bindVertexBuffer(s.vbo);
    device_.bindIndexBuffer(s.ebo);

    switch (layout) {
        case LayoutId::Batch: {
            constexpr u32 STRIDE = 20;
            device_.enableVertexAttrib(0);
            device_.vertexAttribPointer(0, 2, GfxDataType::Float, false, STRIDE, 0);
            device_.enableVertexAttrib(1);
            device_.vertexAttribPointer(1, 4, GfxDataType::UnsignedByte, true, STRIDE, 8);
            device_.enableVertexAttrib(2);
            device_.vertexAttribPointer(2, 2, GfxDataType::Float, false, STRIDE, 12);
            break;
        }
        case LayoutId::Shape: {
            constexpr u32 STRIDE = 48;
            device_.enableVertexAttrib(0);
            device_.vertexAttribPointer(0, 2, GfxDataType::Float, false, STRIDE, 0);
            device_.enableVertexAttrib(1);
            device_.vertexAttribPointer(1, 2, GfxDataType::Float, false, STRIDE, 8);
            device_.enableVertexAttrib(2);
            device_.vertexAttribPointer(2, 4, GfxDataType::Float, false, STRIDE, 16);
            device_.enableVertexAttrib(3);
            device_.vertexAttribPointer(3, 4, GfxDataType::Float, false, STRIDE, 32);
            break;
        }
        case LayoutId::MatSprite: {
            constexpr u32 STRIDE = 32;
            device_.enableVertexAttrib(0);
            device_.vertexAttribPointer(0, 2, GfxDataType::Float, false, STRIDE, 0);
            device_.enableVertexAttrib(1);
            device_.vertexAttribPointer(1, 2, GfxDataType::Float, false, STRIDE, 8);
            device_.enableVertexAttrib(2);
            device_.vertexAttribPointer(2, 4, GfxDataType::Float, false, STRIDE, 16);
            break;
        }
    }

    device_.bindVertexArray(0);
    device_.bindVertexBuffer(0);
    device_.bindIndexBuffer(0);
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

#include "TransientBufferPool.hpp"
#include "OpenGLHeaders.hpp"
#include "../core/Log.hpp"

#include <cstring>
#include <algorithm>

namespace esengine {

TransientBufferPool::TransientBufferPool(GfxDevice& device)
    : device_(device) {
}

void TransientBufferPool::init(u32 initialVertexBytes, u32 initialIndexCount) {
    if (initialized_) return;

    vertex_staging_.resize(initialVertexBytes);
    index_staging_.resize(initialIndexCount);
    vbo_capacity_ = initialVertexBytes;
    ebo_capacity_ = initialIndexCount;

    vbo_ = device_.createBuffer();
    ebo_ = device_.createBuffer();

    device_.bindVertexBuffer(vbo_);
    device_.bufferData(GL_ARRAY_BUFFER, nullptr, vbo_capacity_, true);
    device_.bindVertexBuffer(0);

    device_.bindIndexBuffer(ebo_);
    device_.bufferData(GL_ELEMENT_ARRAY_BUFFER, nullptr, ebo_capacity_ * sizeof(u16), true);
    device_.bindIndexBuffer(0);

    for (auto layout : {LayoutId::Batch, LayoutId::Shape, LayoutId::MatSprite}) {
        setupLayoutVAO(layout);
    }

    vertex_write_pos_ = 0;
    index_write_pos_ = 0;
    initialized_ = true;
}

void TransientBufferPool::shutdown() {
    if (!initialized_) return;

    for (u32 i = 0; i < LAYOUT_COUNT; ++i) {
        if (vaos_[i]) {
            device_.deleteVertexArray(vaos_[i]);
            vaos_[i] = 0;
        }
    }
    if (vbo_) { device_.deleteBuffer(vbo_); vbo_ = 0; }
    if (ebo_) { device_.deleteBuffer(ebo_); ebo_ = 0; }

    vertex_staging_.clear();
    index_staging_.clear();
    initialized_ = false;
}

void TransientBufferPool::beginFrame() {
    vertex_write_pos_ = 0;
    index_write_pos_ = 0;
}

u32 TransientBufferPool::allocVertices(u32 byteSize) {
    u32 offset = vertex_write_pos_;
    u32 newPos = vertex_write_pos_ + byteSize;
    if (newPos > static_cast<u32>(vertex_staging_.size())) {
        growVertexBuffer(newPos);
    }
    vertex_write_pos_ = newPos;
    return offset;
}

u32 TransientBufferPool::allocIndices(u32 count) {
    u32 offset = index_write_pos_;
    u32 newPos = index_write_pos_ + count;
    if (newPos > static_cast<u32>(index_staging_.size())) {
        growIndexBuffer(newPos);
    }
    index_write_pos_ = newPos;
    return offset;
}

void TransientBufferPool::writeVertices(u32 byteOffset, const void* data, u32 byteSize) {
    std::memcpy(vertex_staging_.data() + byteOffset, data, byteSize);
}

void TransientBufferPool::writeIndices(u32 indexOffset, const u16* data, u32 count) {
    std::memcpy(index_staging_.data() + indexOffset, data, count * sizeof(u16));
}

u32 TransientBufferPool::appendVertices(const void* data, u32 byteSize) {
    u32 offset = allocVertices(byteSize);
    writeVertices(offset, data, byteSize);
    return offset;
}

u32 TransientBufferPool::appendIndices(const u16* data, u32 count) {
    u32 offset = allocIndices(count);
    writeIndices(offset, data, count);
    return offset;
}

void TransientBufferPool::upload() {
    if (vertex_write_pos_ == 0 && index_write_pos_ == 0) return;

    device_.bindVertexBuffer(vbo_);
    if (vertex_write_pos_ > vbo_capacity_) {
        vbo_capacity_ = vertex_write_pos_;
        device_.bufferData(GL_ARRAY_BUFFER, vertex_staging_.data(), vbo_capacity_, true);
    } else {
        device_.bufferSubData(GL_ARRAY_BUFFER, 0, vertex_staging_.data(), vertex_write_pos_);
    }

    device_.bindIndexBuffer(ebo_);
    u32 eboBytes = index_write_pos_ * sizeof(u16);
    u32 eboCapBytes = ebo_capacity_ * sizeof(u16);
    if (eboBytes > eboCapBytes) {
        ebo_capacity_ = index_write_pos_;
        device_.bufferData(GL_ELEMENT_ARRAY_BUFFER, index_staging_.data(),
                            ebo_capacity_ * sizeof(u16), true);
    } else {
        device_.bufferSubData(GL_ELEMENT_ARRAY_BUFFER, 0, index_staging_.data(), eboBytes);
    }
}

void TransientBufferPool::bindLayout(LayoutId layout) {
    u32 idx = static_cast<u32>(layout);
    if (idx < LAYOUT_COUNT && vaos_[idx]) {
        device_.bindVertexArray(vaos_[idx]);
    }
}

void TransientBufferPool::setupLayoutVAO(LayoutId layout) {
    u32 idx = static_cast<u32>(layout);
    vaos_[idx] = device_.createVertexArray();
    device_.bindVertexArray(vaos_[idx]);

    device_.bindVertexBuffer(vbo_);
    device_.bindIndexBuffer(ebo_);

    switch (layout) {
        case LayoutId::Batch: {
            constexpr u32 STRIDE = 20;
            device_.enableVertexAttrib(0);
            device_.vertexAttribPointer(0, 2, GL_FLOAT, false, STRIDE, 0);
            device_.enableVertexAttrib(1);
            device_.vertexAttribPointer(1, 4, GL_UNSIGNED_BYTE, true, STRIDE, 8);
            device_.enableVertexAttrib(2);
            device_.vertexAttribPointer(2, 2, GL_FLOAT, false, STRIDE, 12);
            break;
        }
        case LayoutId::Shape: {
            constexpr u32 STRIDE = 48;
            device_.enableVertexAttrib(0);
            device_.vertexAttribPointer(0, 2, GL_FLOAT, false, STRIDE, 0);
            device_.enableVertexAttrib(1);
            device_.vertexAttribPointer(1, 2, GL_FLOAT, false, STRIDE, 8);
            device_.enableVertexAttrib(2);
            device_.vertexAttribPointer(2, 4, GL_FLOAT, false, STRIDE, 16);
            device_.enableVertexAttrib(3);
            device_.vertexAttribPointer(3, 4, GL_FLOAT, false, STRIDE, 32);
            break;
        }
        case LayoutId::MatSprite: {
            constexpr u32 STRIDE = 32;
            device_.enableVertexAttrib(0);
            device_.vertexAttribPointer(0, 2, GL_FLOAT, false, STRIDE, 0);
            device_.enableVertexAttrib(1);
            device_.vertexAttribPointer(1, 2, GL_FLOAT, false, STRIDE, 8);
            device_.enableVertexAttrib(2);
            device_.vertexAttribPointer(2, 4, GL_FLOAT, false, STRIDE, 16);
            break;
        }
    }

    device_.bindVertexArray(0);
}

void TransientBufferPool::growVertexBuffer(u32 requiredBytes) {
    u32 newSize = static_cast<u32>(vertex_staging_.size());
    while (newSize < requiredBytes) {
        newSize = newSize * 2;
    }
    vertex_staging_.resize(newSize);
    ES_LOG_WARN("TransientBufferPool: vertex staging grown to {}KB", newSize / 1024);
}

void TransientBufferPool::growIndexBuffer(u32 requiredCount) {
    u32 newSize = static_cast<u32>(index_staging_.size());
    while (newSize < requiredCount) {
        newSize = newSize * 2;
    }
    index_staging_.resize(newSize);
    ES_LOG_WARN("TransientBufferPool: index staging grown to {} indices", newSize);
}

}  // namespace esengine

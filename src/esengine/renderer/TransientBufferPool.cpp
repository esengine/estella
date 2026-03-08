#include "TransientBufferPool.hpp"
#include "../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#include <cstring>
#include <algorithm>

namespace esengine {

void TransientBufferPool::init(u32 initialVertexBytes, u32 initialIndexCount) {
    if (initialized_) return;

    vertex_staging_.resize(initialVertexBytes);
    index_staging_.resize(initialIndexCount);
    vbo_capacity_ = initialVertexBytes;
    ebo_capacity_ = initialIndexCount;

    glGenBuffers(1, &vbo_);
    glGenBuffers(1, &ebo_);

    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    glBufferData(GL_ARRAY_BUFFER, vbo_capacity_, nullptr, GL_DYNAMIC_DRAW);
    glBindBuffer(GL_ARRAY_BUFFER, 0);

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo_);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, ebo_capacity_ * sizeof(u16), nullptr, GL_DYNAMIC_DRAW);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);

    for (u32 i = 0; i < LAYOUT_COUNT; ++i) {
        setupLayoutVAO(static_cast<LayoutId>(i));
    }

    vertex_write_pos_ = 0;
    index_write_pos_ = 0;
    initialized_ = true;
}

void TransientBufferPool::shutdown() {
    if (!initialized_) return;

    for (u32 i = 0; i < LAYOUT_COUNT; ++i) {
        if (vaos_[i]) {
            glDeleteVertexArrays(1, &vaos_[i]);
            vaos_[i] = 0;
        }
    }
    if (vbo_) { glDeleteBuffers(1, &vbo_); vbo_ = 0; }
    if (ebo_) { glDeleteBuffers(1, &ebo_); ebo_ = 0; }

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

    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    if (vertex_write_pos_ > vbo_capacity_) {
        vbo_capacity_ = vertex_write_pos_;
        glBufferData(GL_ARRAY_BUFFER, vbo_capacity_, vertex_staging_.data(), GL_DYNAMIC_DRAW);
    } else {
        glBufferSubData(GL_ARRAY_BUFFER, 0, vertex_write_pos_, vertex_staging_.data());
    }

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo_);
    u32 eboBytes = index_write_pos_ * sizeof(u16);
    u32 eboCapBytes = ebo_capacity_ * sizeof(u16);
    if (eboBytes > eboCapBytes) {
        ebo_capacity_ = index_write_pos_;
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, ebo_capacity_ * sizeof(u16),
                     index_staging_.data(), GL_DYNAMIC_DRAW);
    } else {
        glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, 0, eboBytes, index_staging_.data());
    }
}

void TransientBufferPool::bindLayout(LayoutId layout) {
    u32 idx = static_cast<u32>(layout);
    if (idx < LAYOUT_COUNT && vaos_[idx]) {
        glBindVertexArray(vaos_[idx]);
    }
}

void TransientBufferPool::setupLayoutVAO(LayoutId layout) {
    u32 idx = static_cast<u32>(layout);
    glGenVertexArrays(1, &vaos_[idx]);
    glBindVertexArray(vaos_[idx]);

    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo_);

    switch (layout) {
        case LayoutId::Batch: {
            constexpr u32 STRIDE = 20;
            glEnableVertexAttribArray(0);
            glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, STRIDE, reinterpret_cast<void*>(0));
            glEnableVertexAttribArray(1);
            glVertexAttribPointer(1, 4, GL_UNSIGNED_BYTE, GL_TRUE, STRIDE, reinterpret_cast<void*>(8));
            glEnableVertexAttribArray(2);
            glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, STRIDE, reinterpret_cast<void*>(12));
            break;
        }
        case LayoutId::Shape: {
            // ShapeVertex: vec2 pos + vec2 uv + vec4 color + vec4 shapeInfo = 48B
            constexpr u32 STRIDE = 48;
            glEnableVertexAttribArray(0);
            glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, STRIDE, reinterpret_cast<void*>(0));
            glEnableVertexAttribArray(1);
            glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, STRIDE, reinterpret_cast<void*>(8));
            glEnableVertexAttribArray(2);
            glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, STRIDE, reinterpret_cast<void*>(16));
            glEnableVertexAttribArray(3);
            glVertexAttribPointer(3, 4, GL_FLOAT, GL_FALSE, STRIDE, reinterpret_cast<void*>(32));
            break;
        }
        case LayoutId::MatSprite: {
            // MatSpriteVertex: vec2 pos + vec2 uv + vec4 color = 32B
            constexpr u32 STRIDE = 32;
            glEnableVertexAttribArray(0);
            glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, STRIDE, reinterpret_cast<void*>(0));
            glEnableVertexAttribArray(1);
            glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, STRIDE, reinterpret_cast<void*>(8));
            glEnableVertexAttribArray(2);
            glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, STRIDE, reinterpret_cast<void*>(16));
            break;
        }
    }

    glBindVertexArray(0);
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

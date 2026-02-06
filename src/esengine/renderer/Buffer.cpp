/**
 * @file    Buffer.cpp
 * @brief   GPU buffer implementations for vertex and index data
 * @details Implements VertexBuffer, IndexBuffer, and VertexArray classes
 *          for OpenGL/WebGL buffer management.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Buffer.hpp"
#include "../core/Log.hpp"
#include "OpenGLHeaders.hpp"

namespace esengine {

u32 shaderDataTypeSize(ShaderDataType type) {
    switch (type) {
    case ShaderDataType::Float:  return 4;
    case ShaderDataType::Float2: return 4 * 2;
    case ShaderDataType::Float3: return 4 * 3;
    case ShaderDataType::Float4: return 4 * 4;
    case ShaderDataType::Int:    return 4;
    case ShaderDataType::Int2:   return 4 * 2;
    case ShaderDataType::Int3:   return 4 * 3;
    case ShaderDataType::Int4:   return 4 * 4;
    case ShaderDataType::Bool:   return 1;
    default: return 0;
    }
}

u32 shaderDataTypeComponentCount(ShaderDataType type) {
    switch (type) {
    case ShaderDataType::Float:  return 1;
    case ShaderDataType::Float2: return 2;
    case ShaderDataType::Float3: return 3;
    case ShaderDataType::Float4: return 4;
    case ShaderDataType::Int:    return 1;
    case ShaderDataType::Int2:   return 2;
    case ShaderDataType::Int3:   return 3;
    case ShaderDataType::Int4:   return 4;
    case ShaderDataType::Bool:   return 1;
    default: return 0;
    }
}

// ========================================
// VertexBuffer
// ========================================

VertexBuffer::~VertexBuffer() {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    if (bufferId_ != 0) {
        glDeleteBuffers(1, &bufferId_);
    }
#endif
}

VertexBuffer::VertexBuffer(VertexBuffer&& other) noexcept
    : bufferId_(other.bufferId_), layout_(std::move(other.layout_)) {
    other.bufferId_ = 0;
}

VertexBuffer& VertexBuffer::operator=(VertexBuffer&& other) noexcept {
    if (this != &other) {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
        if (bufferId_ != 0) {
            glDeleteBuffers(1, &bufferId_);
        }
#endif
        bufferId_ = other.bufferId_;
        layout_ = std::move(other.layout_);
        other.bufferId_ = 0;
    }
    return *this;
}

Unique<VertexBuffer> VertexBuffer::createRaw(const void* data, u32 sizeBytes) {
    auto buffer = makeUnique<VertexBuffer>();
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glGenBuffers(1, &buffer->bufferId_);
    glBindBuffer(GL_ARRAY_BUFFER, buffer->bufferId_);
    glBufferData(GL_ARRAY_BUFFER, sizeBytes, data, GL_STATIC_DRAW);
#else
    (void)data;
    (void)sizeBytes;
#endif
    return buffer;
}

Unique<VertexBuffer> VertexBuffer::create(u32 size) {
    auto buffer = makeUnique<VertexBuffer>();
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glGenBuffers(1, &buffer->bufferId_);
    glBindBuffer(GL_ARRAY_BUFFER, buffer->bufferId_);
    glBufferData(GL_ARRAY_BUFFER, size, nullptr, GL_DYNAMIC_DRAW);
#else
    (void)size;
#endif
    return buffer;
}

void VertexBuffer::bind() const {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glBindBuffer(GL_ARRAY_BUFFER, bufferId_);
#endif
}

void VertexBuffer::unbind() const {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glBindBuffer(GL_ARRAY_BUFFER, 0);
#endif
}

void VertexBuffer::setDataRaw(const void* data, u32 sizeBytes) {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glBindBuffer(GL_ARRAY_BUFFER, bufferId_);
    glBufferSubData(GL_ARRAY_BUFFER, 0, sizeBytes, data);
#else
    (void)data;
    (void)sizeBytes;
#endif
}

void VertexBuffer::setSubDataRaw(const void* data, u32 sizeBytes, u32 offsetBytes) {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glBindBuffer(GL_ARRAY_BUFFER, bufferId_);
    glBufferSubData(GL_ARRAY_BUFFER, offsetBytes, sizeBytes, data);
#else
    (void)data;
    (void)sizeBytes;
    (void)offsetBytes;
#endif
}

// ========================================
// IndexBuffer
// ========================================

IndexBuffer::~IndexBuffer() {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    if (bufferId_ != 0) {
        glDeleteBuffers(1, &bufferId_);
    }
#endif
}

IndexBuffer::IndexBuffer(IndexBuffer&& other) noexcept
    : bufferId_(other.bufferId_), count_(other.count_), is16Bit_(other.is16Bit_) {
    other.bufferId_ = 0;
    other.count_ = 0;
}

IndexBuffer& IndexBuffer::operator=(IndexBuffer&& other) noexcept {
    if (this != &other) {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
        if (bufferId_ != 0) {
            glDeleteBuffers(1, &bufferId_);
        }
#endif
        bufferId_ = other.bufferId_;
        count_ = other.count_;
        is16Bit_ = other.is16Bit_;
        other.bufferId_ = 0;
        other.count_ = 0;
    }
    return *this;
}

Unique<IndexBuffer> IndexBuffer::create(const u32* indices, u32 count) {
    auto buffer = makeUnique<IndexBuffer>();
    buffer->count_ = count;
    buffer->is16Bit_ = false;
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glGenBuffers(1, &buffer->bufferId_);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, buffer->bufferId_);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, count * sizeof(u32), indices, GL_STATIC_DRAW);
#else
    (void)indices;
#endif
    return buffer;
}

Unique<IndexBuffer> IndexBuffer::create(const u16* indices, u32 count) {
    auto buffer = makeUnique<IndexBuffer>();
    buffer->count_ = count;
    buffer->is16Bit_ = true;
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glGenBuffers(1, &buffer->bufferId_);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, buffer->bufferId_);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, count * sizeof(u16), indices, GL_STATIC_DRAW);
#else
    (void)indices;
#endif
    return buffer;
}

void IndexBuffer::bind() const {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, bufferId_);
#endif
}

void IndexBuffer::unbind() const {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);
#endif
}

// ========================================
// VertexArray
// ========================================

VertexArray::VertexArray() {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glGenVertexArrays(1, &arrayId_);
#endif
}

VertexArray::~VertexArray() {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    if (arrayId_ != 0) {
        glDeleteVertexArrays(1, &arrayId_);
    }
#endif
}

VertexArray::VertexArray(VertexArray&& other) noexcept
    : arrayId_(other.arrayId_)
    , vertexAttribIndex_(other.vertexAttribIndex_)
    , vertexBuffers_(std::move(other.vertexBuffers_))
    , indexBuffer_(std::move(other.indexBuffer_)) {
    other.arrayId_ = 0;
    other.vertexAttribIndex_ = 0;
}

VertexArray& VertexArray::operator=(VertexArray&& other) noexcept {
    if (this != &other) {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
        if (arrayId_ != 0) {
            glDeleteVertexArrays(1, &arrayId_);
        }
#endif
        arrayId_ = other.arrayId_;
        vertexAttribIndex_ = other.vertexAttribIndex_;
        vertexBuffers_ = std::move(other.vertexBuffers_);
        indexBuffer_ = std::move(other.indexBuffer_);
        other.arrayId_ = 0;
        other.vertexAttribIndex_ = 0;
    }
    return *this;
}

Unique<VertexArray> VertexArray::create() {
    return makeUnique<VertexArray>();
}

void VertexArray::bind() const {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glBindVertexArray(arrayId_);
#endif
}

void VertexArray::unbind() const {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glBindVertexArray(0);
#endif
}

void VertexArray::addVertexBuffer(Shared<VertexBuffer> buffer) {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    ES_ASSERT(!buffer->getLayout().getAttributes().empty(), "Vertex buffer has no layout");

    bind();
    buffer->bind();

    const auto& layout = buffer->getLayout();
    for (const auto& attr : layout) {
        glEnableVertexAttribArray(vertexAttribIndex_);

        GLenum glType = GL_FLOAT;
        switch (attr.type) {
        case ShaderDataType::Float:
        case ShaderDataType::Float2:
        case ShaderDataType::Float3:
        case ShaderDataType::Float4:
            glType = GL_FLOAT;
            break;
        case ShaderDataType::Int:
        case ShaderDataType::Int2:
        case ShaderDataType::Int3:
        case ShaderDataType::Int4:
            glType = GL_INT;
            break;
        case ShaderDataType::Bool:
            glType = GL_UNSIGNED_BYTE;
            break;
        default:
            break;
        }

        glVertexAttribPointer(
            vertexAttribIndex_,
            shaderDataTypeComponentCount(attr.type),
            glType,
            attr.normalized ? GL_TRUE : GL_FALSE,
            layout.getStride(),
            reinterpret_cast<const void*>(static_cast<uintptr_t>(attr.offset))
        );
        ++vertexAttribIndex_;
    }
#endif
    vertexBuffers_.push_back(std::move(buffer));
}

void VertexArray::setIndexBuffer(Shared<IndexBuffer> buffer) {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    bind();
    buffer->bind();
#endif
    indexBuffer_ = std::move(buffer);
}

}  // namespace esengine

#include "Buffer.hpp"
#include "../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <GL/gl.h>
    #ifndef GL_ARRAY_BUFFER
        #define GL_ARRAY_BUFFER 0x8892
        #define GL_ELEMENT_ARRAY_BUFFER 0x8893
        #define GL_STATIC_DRAW 0x88E4
        #define GL_DYNAMIC_DRAW 0x88E8
    #endif
#endif

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
#ifdef ES_PLATFORM_WEB
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
#ifdef ES_PLATFORM_WEB
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

Unique<VertexBuffer> VertexBuffer::create(const void* data, u32 size) {
    auto buffer = makeUnique<VertexBuffer>();
#ifdef ES_PLATFORM_WEB
    glGenBuffers(1, &buffer->bufferId_);
    glBindBuffer(GL_ARRAY_BUFFER, buffer->bufferId_);
    glBufferData(GL_ARRAY_BUFFER, size, data, GL_STATIC_DRAW);
#else
    (void)data;
    (void)size;
#endif
    return buffer;
}

Unique<VertexBuffer> VertexBuffer::create(u32 size) {
    auto buffer = makeUnique<VertexBuffer>();
#ifdef ES_PLATFORM_WEB
    glGenBuffers(1, &buffer->bufferId_);
    glBindBuffer(GL_ARRAY_BUFFER, buffer->bufferId_);
    glBufferData(GL_ARRAY_BUFFER, size, nullptr, GL_DYNAMIC_DRAW);
#else
    (void)size;
#endif
    return buffer;
}

void VertexBuffer::bind() const {
#ifdef ES_PLATFORM_WEB
    glBindBuffer(GL_ARRAY_BUFFER, bufferId_);
#endif
}

void VertexBuffer::unbind() const {
#ifdef ES_PLATFORM_WEB
    glBindBuffer(GL_ARRAY_BUFFER, 0);
#endif
}

void VertexBuffer::setData(const void* data, u32 size) {
#ifdef ES_PLATFORM_WEB
    glBindBuffer(GL_ARRAY_BUFFER, bufferId_);
    glBufferSubData(GL_ARRAY_BUFFER, 0, size, data);
#else
    (void)data;
    (void)size;
#endif
}

// ========================================
// IndexBuffer
// ========================================

IndexBuffer::~IndexBuffer() {
#ifdef ES_PLATFORM_WEB
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
#ifdef ES_PLATFORM_WEB
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
#ifdef ES_PLATFORM_WEB
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
#ifdef ES_PLATFORM_WEB
    glGenBuffers(1, &buffer->bufferId_);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, buffer->bufferId_);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, count * sizeof(u16), indices, GL_STATIC_DRAW);
#else
    (void)indices;
#endif
    return buffer;
}

void IndexBuffer::bind() const {
#ifdef ES_PLATFORM_WEB
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, bufferId_);
#endif
}

void IndexBuffer::unbind() const {
#ifdef ES_PLATFORM_WEB
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);
#endif
}

// ========================================
// VertexArray
// ========================================

VertexArray::VertexArray() {
#ifdef ES_PLATFORM_WEB
    glGenVertexArrays(1, &arrayId_);
#endif
}

VertexArray::~VertexArray() {
#ifdef ES_PLATFORM_WEB
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
#ifdef ES_PLATFORM_WEB
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
#ifdef ES_PLATFORM_WEB
    glBindVertexArray(arrayId_);
#endif
}

void VertexArray::unbind() const {
#ifdef ES_PLATFORM_WEB
    glBindVertexArray(0);
#endif
}

void VertexArray::addVertexBuffer(Shared<VertexBuffer> buffer) {
#ifdef ES_PLATFORM_WEB
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
            glType = GL_BOOL;
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
#ifdef ES_PLATFORM_WEB
    bind();
    buffer->bind();
#endif
    indexBuffer_ = std::move(buffer);
}

}  // namespace esengine

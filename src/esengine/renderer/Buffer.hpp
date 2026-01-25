#pragma once

#include "../core/Types.hpp"
#include <vector>

namespace esengine {

// Vertex attribute types
enum class ShaderDataType {
    None = 0,
    Float, Float2, Float3, Float4,
    Int, Int2, Int3, Int4,
    Bool
};

u32 shaderDataTypeSize(ShaderDataType type);
u32 shaderDataTypeComponentCount(ShaderDataType type);

// Single vertex attribute
struct VertexAttribute {
    std::string name;
    ShaderDataType type;
    u32 size;
    u32 offset;
    bool normalized;

    VertexAttribute() = default;
    VertexAttribute(ShaderDataType type, const std::string& name, bool normalized = false)
        : name(name), type(type), size(shaderDataTypeSize(type)), offset(0), normalized(normalized) {}
};

// Vertex buffer layout
class VertexLayout {
public:
    VertexLayout() = default;
    VertexLayout(std::initializer_list<VertexAttribute> attributes)
        : attributes_(attributes) {
        calculateOffsetsAndStride();
    }

    const std::vector<VertexAttribute>& getAttributes() const { return attributes_; }
    u32 getStride() const { return stride_; }

    std::vector<VertexAttribute>::iterator begin() { return attributes_.begin(); }
    std::vector<VertexAttribute>::iterator end() { return attributes_.end(); }
    std::vector<VertexAttribute>::const_iterator begin() const { return attributes_.begin(); }
    std::vector<VertexAttribute>::const_iterator end() const { return attributes_.end(); }

private:
    void calculateOffsetsAndStride() {
        u32 offset = 0;
        stride_ = 0;
        for (auto& attr : attributes_) {
            attr.offset = offset;
            offset += attr.size;
            stride_ += attr.size;
        }
    }

    std::vector<VertexAttribute> attributes_;
    u32 stride_ = 0;
};

// Vertex Buffer (VBO)
class VertexBuffer {
public:
    VertexBuffer() = default;
    ~VertexBuffer();

    // Non-copyable, movable
    VertexBuffer(const VertexBuffer&) = delete;
    VertexBuffer& operator=(const VertexBuffer&) = delete;
    VertexBuffer(VertexBuffer&& other) noexcept;
    VertexBuffer& operator=(VertexBuffer&& other) noexcept;

    // Create static buffer
    static Unique<VertexBuffer> create(const void* data, u32 size);

    // Create dynamic buffer
    static Unique<VertexBuffer> create(u32 size);

    void bind() const;
    void unbind() const;

    // Update data (for dynamic buffers)
    void setData(const void* data, u32 size);

    // Layout
    void setLayout(const VertexLayout& layout) { layout_ = layout; }
    const VertexLayout& getLayout() const { return layout_; }

    u32 getId() const { return bufferId_; }

private:
    u32 bufferId_ = 0;
    VertexLayout layout_;
};

// Index Buffer (EBO)
class IndexBuffer {
public:
    IndexBuffer() = default;
    ~IndexBuffer();

    // Non-copyable, movable
    IndexBuffer(const IndexBuffer&) = delete;
    IndexBuffer& operator=(const IndexBuffer&) = delete;
    IndexBuffer(IndexBuffer&& other) noexcept;
    IndexBuffer& operator=(IndexBuffer&& other) noexcept;

    // Create from indices
    static Unique<IndexBuffer> create(const u32* indices, u32 count);
    static Unique<IndexBuffer> create(const u16* indices, u32 count);

    void bind() const;
    void unbind() const;

    u32 getCount() const { return count_; }
    u32 getId() const { return bufferId_; }
    bool is16Bit() const { return is16Bit_; }

private:
    u32 bufferId_ = 0;
    u32 count_ = 0;
    bool is16Bit_ = false;
};

// Vertex Array Object (VAO) - abstracts vertex attribute configuration
class VertexArray {
public:
    VertexArray();
    ~VertexArray();

    // Non-copyable, movable
    VertexArray(const VertexArray&) = delete;
    VertexArray& operator=(const VertexArray&) = delete;
    VertexArray(VertexArray&& other) noexcept;
    VertexArray& operator=(VertexArray&& other) noexcept;

    static Unique<VertexArray> create();

    void bind() const;
    void unbind() const;

    void addVertexBuffer(Shared<VertexBuffer> buffer);
    void setIndexBuffer(Shared<IndexBuffer> buffer);

    const std::vector<Shared<VertexBuffer>>& getVertexBuffers() const { return vertexBuffers_; }
    const Shared<IndexBuffer>& getIndexBuffer() const { return indexBuffer_; }

private:
    u32 arrayId_ = 0;
    u32 vertexAttribIndex_ = 0;
    std::vector<Shared<VertexBuffer>> vertexBuffers_;
    Shared<IndexBuffer> indexBuffer_;
};

}  // namespace esengine

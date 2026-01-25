/**
 * @file    Buffer.hpp
 * @brief   GPU buffer abstractions for vertex and index data
 * @details Provides cross-platform abstractions for OpenGL/WebGL buffer
 *          objects including VertexBuffer, IndexBuffer, and VertexArray.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Types.hpp"

// Standard library
#include <span>
#include <vector>

namespace esengine {

// =============================================================================
// Shader Data Types
// =============================================================================

/**
 * @brief Vertex attribute data types
 *
 * @details Used to describe the data type of each vertex attribute
 *          in the vertex layout. Maps to OpenGL/WebGL types.
 */
enum class ShaderDataType {
    None = 0,
    Float,   ///< Single 32-bit float
    Float2,  ///< vec2 (2 floats)
    Float3,  ///< vec3 (3 floats)
    Float4,  ///< vec4 (4 floats)
    Int,     ///< Single 32-bit integer
    Int2,    ///< ivec2 (2 ints)
    Int3,    ///< ivec3 (3 ints)
    Int4,    ///< ivec4 (4 ints)
    Bool     ///< Boolean (1 byte)
};

/**
 * @brief Gets the size in bytes of a shader data type
 * @param type The shader data type
 * @return Size in bytes
 */
u32 shaderDataTypeSize(ShaderDataType type);

/**
 * @brief Gets the component count of a shader data type
 * @param type The shader data type
 * @return Number of components (e.g., 3 for Float3)
 */
u32 shaderDataTypeComponentCount(ShaderDataType type);

// =============================================================================
// Vertex Attribute
// =============================================================================

/**
 * @brief Describes a single vertex attribute
 *
 * @details Contains all information needed to configure a vertex attribute
 *          pointer in OpenGL/WebGL.
 */
struct VertexAttribute {
    /** @brief Attribute name (for debugging) */
    std::string name;
    /** @brief Data type of the attribute */
    ShaderDataType type;
    /** @brief Size in bytes */
    u32 size;
    /** @brief Byte offset within the vertex */
    u32 offset;
    /** @brief Whether to normalize integer data to [0,1] or [-1,1] */
    bool normalized;

    /** @brief Default constructor */
    VertexAttribute() = default;

    /**
     * @brief Constructs a vertex attribute
     * @param type Data type
     * @param name Attribute name
     * @param normalized Whether to normalize integer data
     */
    VertexAttribute(ShaderDataType type, const std::string& name, bool normalized = false)
        : name(name), type(type), size(shaderDataTypeSize(type)), offset(0), normalized(normalized) {}
};

// =============================================================================
// Vertex Layout
// =============================================================================

/**
 * @brief Describes the layout of vertex data in a buffer
 *
 * @details Specifies the attributes that make up each vertex and their
 *          arrangement in memory. Used to configure vertex attribute pointers.
 *
 * @code
 * VertexLayout layout = {
 *     {ShaderDataType::Float3, "a_position"},
 *     {ShaderDataType::Float2, "a_texCoord"},
 *     {ShaderDataType::Float4, "a_color"}
 * };
 * @endcode
 */
class VertexLayout {
public:
    /** @brief Default constructor (empty layout) */
    VertexLayout() = default;

    /**
     * @brief Constructs layout from initializer list
     * @param attributes List of vertex attributes
     */
    VertexLayout(std::initializer_list<VertexAttribute> attributes)
        : attributes_(attributes) {
        calculateOffsetsAndStride();
    }

    /**
     * @brief Gets all vertex attributes
     * @return Const reference to attribute vector
     */
    const std::vector<VertexAttribute>& getAttributes() const { return attributes_; }

    /**
     * @brief Gets the stride (total size) of one vertex
     * @return Stride in bytes
     */
    u32 getStride() const { return stride_; }

    // Iterator support for range-based for loops
    std::vector<VertexAttribute>::iterator begin() { return attributes_.begin(); }
    std::vector<VertexAttribute>::iterator end() { return attributes_.end(); }
    std::vector<VertexAttribute>::const_iterator begin() const { return attributes_.begin(); }
    std::vector<VertexAttribute>::const_iterator end() const { return attributes_.end(); }

private:
    /**
     * @brief Calculates byte offsets and total stride
     */
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

// =============================================================================
// Vertex Buffer
// =============================================================================

/**
 * @brief GPU buffer for vertex data
 *
 * @details Wraps OpenGL/WebGL Vertex Buffer Objects (VBOs). Supports both
 *          static and dynamic buffer usage.
 *
 * @code
 * struct Vertex { float x, y, u, v; };
 * std::vector<Vertex> vertices = {...};
 *
 * auto vbo = VertexBuffer::create(std::span(vertices));
 * vbo->setLayout({
 *     {ShaderDataType::Float2, "a_position"},
 *     {ShaderDataType::Float2, "a_texCoord"}
 * });
 * @endcode
 */
class VertexBuffer {
public:
    VertexBuffer() = default;
    ~VertexBuffer();

    // Non-copyable, movable
    VertexBuffer(const VertexBuffer&) = delete;
    VertexBuffer& operator=(const VertexBuffer&) = delete;
    VertexBuffer(VertexBuffer&& other) noexcept;
    VertexBuffer& operator=(VertexBuffer&& other) noexcept;

    // =========================================================================
    // Type-Safe Creation Methods
    // =========================================================================

    /**
     * @brief Creates a static buffer from a span
     * @tparam T Vertex type
     * @param data Span of vertex data
     * @return Unique pointer to the buffer
     */
    template<typename T>
    static Unique<VertexBuffer> create(std::span<const T> data) {
        return createRaw(data.data(), static_cast<u32>(data.size_bytes()));
    }

    /**
     * @brief Creates a static buffer from a vector
     * @tparam T Vertex type
     * @param data Vector of vertex data
     * @return Unique pointer to the buffer
     */
    template<typename T>
    static Unique<VertexBuffer> create(const std::vector<T>& data) {
        return create(std::span<const T>(data));
    }

    /**
     * @brief Creates a static buffer from a C array
     * @tparam T Vertex type
     * @tparam N Array size
     * @param data Array of vertex data
     * @return Unique pointer to the buffer
     */
    template<typename T, usize N>
    static Unique<VertexBuffer> create(const T (&data)[N]) {
        return create(std::span<const T>(data, N));
    }

    /**
     * @brief Creates a dynamic buffer of specified size
     * @param sizeBytes Buffer size in bytes
     * @return Unique pointer to the buffer
     *
     * @details Use setData() to upload data later.
     */
    static Unique<VertexBuffer> create(u32 sizeBytes);

    // =========================================================================
    // Operations
    // =========================================================================

    /** @brief Binds the buffer for rendering */
    void bind() const;

    /** @brief Unbinds the buffer */
    void unbind() const;

    /**
     * @brief Updates buffer data from a span
     * @tparam T Vertex type
     * @param data New vertex data
     */
    template<typename T>
    void setData(std::span<const T> data) {
        setDataRaw(data.data(), static_cast<u32>(data.size_bytes()));
    }

    /**
     * @brief Updates buffer data from a vector
     * @tparam T Vertex type
     * @param data New vertex data
     */
    template<typename T>
    void setData(const std::vector<T>& data) {
        setData(std::span<const T>(data));
    }

    /**
     * @brief Updates buffer data from a C array
     * @tparam T Vertex type
     * @tparam N Array size
     * @param data New vertex data
     */
    template<typename T, usize N>
    void setData(const T (&data)[N]) {
        setData(std::span<const T>(data, N));
    }

    // =========================================================================
    // Layout
    // =========================================================================

    /**
     * @brief Sets the vertex layout
     * @param layout The vertex attribute layout
     */
    void setLayout(const VertexLayout& layout) { layout_ = layout; }

    /**
     * @brief Gets the vertex layout
     * @return Const reference to the layout
     */
    const VertexLayout& getLayout() const { return layout_; }

    /**
     * @brief Gets the GPU buffer ID
     * @return OpenGL buffer handle
     */
    u32 getId() const { return bufferId_; }

    // =========================================================================
    // Raw API for internal use only
    // =========================================================================

    /**
     * @brief Creates a buffer from raw data pointer for internal use
     * @param data Pointer to vertex data
     * @param sizeBytes Size of data in bytes
     * @return Unique pointer to the buffer
     */
    static Unique<VertexBuffer> createRaw(const void* data, u32 sizeBytes);

    /**
     * @brief Updates buffer data from raw pointer (internal use)
     * @param data Pointer to new data
     * @param sizeBytes Size of data in bytes
     */
    void setDataRaw(const void* data, u32 sizeBytes);

private:
    u32 bufferId_ = 0;
    VertexLayout layout_;
};

// =============================================================================
// Index Buffer
// =============================================================================

/**
 * @brief GPU buffer for index data
 *
 * @details Wraps OpenGL/WebGL Element Buffer Objects (EBOs). Supports
 *          both 16-bit and 32-bit indices.
 *
 * @code
 * std::vector<u32> indices = {0, 1, 2, 2, 3, 0};
 * auto ebo = IndexBuffer::create(std::span(indices));
 * @endcode
 */
class IndexBuffer {
public:
    IndexBuffer() = default;
    ~IndexBuffer();

    // Non-copyable, movable
    IndexBuffer(const IndexBuffer&) = delete;
    IndexBuffer& operator=(const IndexBuffer&) = delete;
    IndexBuffer(IndexBuffer&& other) noexcept;
    IndexBuffer& operator=(IndexBuffer&& other) noexcept;

    // =========================================================================
    // Type-Safe Creation Methods
    // =========================================================================

    /**
     * @brief Creates an index buffer from a span of 32-bit indices
     * @param indices Span of index data
     * @return Unique pointer to the buffer
     */
    static Unique<IndexBuffer> create(std::span<const u32> indices) {
        return create(indices.data(), static_cast<u32>(indices.size()));
    }

    /**
     * @brief Creates an index buffer from a span of 16-bit indices
     * @param indices Span of index data
     * @return Unique pointer to the buffer
     */
    static Unique<IndexBuffer> create(std::span<const u16> indices) {
        return create(indices.data(), static_cast<u32>(indices.size()));
    }

    /**
     * @brief Creates an index buffer from a vector of 32-bit indices
     * @param indices Vector of index data
     * @return Unique pointer to the buffer
     */
    static Unique<IndexBuffer> create(const std::vector<u32>& indices) {
        return create(std::span<const u32>(indices));
    }

    /**
     * @brief Creates an index buffer from a vector of 16-bit indices
     * @param indices Vector of index data
     * @return Unique pointer to the buffer
     */
    static Unique<IndexBuffer> create(const std::vector<u16>& indices) {
        return create(std::span<const u16>(indices));
    }

    /**
     * @brief Creates an index buffer with 32-bit indices from pointer
     * @param indices Pointer to index data
     * @param count Number of indices
     * @return Unique pointer to the buffer
     */
    static Unique<IndexBuffer> create(const u32* indices, u32 count);

    /**
     * @brief Creates an index buffer with 16-bit indices from pointer
     * @param indices Pointer to index data
     * @param count Number of indices
     * @return Unique pointer to the buffer
     *
     * @details Use 16-bit indices for better performance when vertex
     *          count is under 65536.
     */
    static Unique<IndexBuffer> create(const u16* indices, u32 count);

    // =========================================================================
    // Operations
    // =========================================================================

    /** @brief Binds the buffer for rendering */
    void bind() const;

    /** @brief Unbinds the buffer */
    void unbind() const;

    /** @brief Gets the number of indices */
    u32 getCount() const { return count_; }

    /** @brief Gets the GPU buffer ID */
    u32 getId() const { return bufferId_; }

    /** @brief Returns true if using 16-bit indices */
    bool is16Bit() const { return is16Bit_; }

private:
    u32 bufferId_ = 0;
    u32 count_ = 0;
    bool is16Bit_ = false;
};

// =============================================================================
// Vertex Array Object
// =============================================================================

/**
 * @brief Encapsulates vertex attribute configuration
 *
 * @details Wraps OpenGL/WebGL Vertex Array Objects. Stores the association
 *          between vertex buffers and their attribute layouts.
 *
 * @code
 * auto vao = VertexArray::create();
 *
 * auto vbo = VertexBuffer::create(vertices);
 * vbo->setLayout({...});
 * vao->addVertexBuffer(std::move(vbo));
 *
 * auto ebo = IndexBuffer::create(indices, 6);
 * vao->setIndexBuffer(std::move(ebo));
 *
 * // Rendering
 * vao->bind();
 * RenderCommand::drawIndexed(*vao);
 * @endcode
 */
class VertexArray {
public:
    VertexArray();
    ~VertexArray();

    // Non-copyable, movable
    VertexArray(const VertexArray&) = delete;
    VertexArray& operator=(const VertexArray&) = delete;
    VertexArray(VertexArray&& other) noexcept;
    VertexArray& operator=(VertexArray&& other) noexcept;

    /**
     * @brief Creates a new vertex array
     * @return Unique pointer to the VAO
     */
    static Unique<VertexArray> create();

    /** @brief Binds the VAO for rendering */
    void bind() const;

    /** @brief Unbinds the VAO */
    void unbind() const;

    /**
     * @brief Adds a vertex buffer to the VAO
     * @param buffer Shared pointer to the vertex buffer
     *
     * @details The buffer's layout must be set before adding.
     *          Multiple vertex buffers can be added for interleaved
     *          or separate attribute streams.
     */
    void addVertexBuffer(Shared<VertexBuffer> buffer);

    /**
     * @brief Sets the index buffer
     * @param buffer Shared pointer to the index buffer
     */
    void setIndexBuffer(Shared<IndexBuffer> buffer);

    /**
     * @brief Gets all attached vertex buffers
     * @return Const reference to buffer vector
     */
    const std::vector<Shared<VertexBuffer>>& getVertexBuffers() const { return vertexBuffers_; }

    /**
     * @brief Gets the index buffer
     * @return Const reference to the index buffer pointer
     */
    const Shared<IndexBuffer>& getIndexBuffer() const { return indexBuffer_; }

private:
    u32 arrayId_ = 0;
    u32 vertexAttribIndex_ = 0;
    std::vector<Shared<VertexBuffer>> vertexBuffers_;
    Shared<IndexBuffer> indexBuffer_;
};

}  // namespace esengine

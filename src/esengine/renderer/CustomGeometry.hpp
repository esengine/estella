/**
 * @file    CustomGeometry.hpp
 * @brief   Custom geometry for user-defined mesh rendering
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../core/Types.hpp"
#include "Buffer.hpp"

#include <vector>

namespace esengine {

/**
 * @brief Custom geometry for user-defined mesh rendering
 *
 * @details Manages vertex buffer and index buffer with support for dynamic updates.
 *          Used for custom shapes, particles, trails, and other procedural geometry.
 */
class CustomGeometry {
public:
    CustomGeometry() = default;
    ~CustomGeometry() = default;

    CustomGeometry(const CustomGeometry&) = delete;
    CustomGeometry& operator=(const CustomGeometry&) = delete;
    CustomGeometry(CustomGeometry&&) = default;
    CustomGeometry& operator=(CustomGeometry&&) = default;

    /**
     * @brief Initializes geometry with vertex data and layout
     * @param vertices Pointer to vertex data
     * @param vertexCount Number of floats in vertex data
     * @param layout Vertex attribute layout
     * @param dynamic If true, allows vertex updates
     */
    void init(const f32* vertices, u32 vertexCount, const VertexLayout& layout, bool dynamic = false);

    /**
     * @brief Sets indices for indexed rendering
     * @param indices Pointer to index data
     * @param indexCount Number of indices
     */
    void setIndices(const u16* indices, u32 indexCount);

    /**
     * @brief Sets indices for indexed rendering (32-bit)
     * @param indices Pointer to index data
     * @param indexCount Number of indices
     */
    void setIndices(const u32* indices, u32 indexCount);

    /**
     * @brief Updates vertex data (only for dynamic geometry)
     * @param vertices Pointer to new vertex data
     * @param vertexCount Number of floats
     * @param offset Offset in floats from start
     */
    void updateVertices(const f32* vertices, u32 vertexCount, u32 offset = 0);

    /**
     * @brief Binds the geometry for rendering
     */
    void bind() const;

    /**
     * @brief Unbinds the geometry
     */
    void unbind() const;

    /**
     * @brief Gets the VAO for rendering
     */
    VertexArray* getVAO() { return vao_.get(); }
    const VertexArray* getVAO() const { return vao_.get(); }

    /**
     * @brief Gets the index count
     */
    u32 getIndexCount() const;

    /**
     * @brief Gets the vertex count
     */
    u32 getVertexCount() const { return vertexCount_; }

    /**
     * @brief Checks if geometry uses indices
     */
    bool hasIndices() const;

    /**
     * @brief Checks if geometry is dynamic
     */
    bool isDynamic() const { return dynamic_; }

    /**
     * @brief Checks if geometry is initialized
     */
    bool isValid() const { return vao_ != nullptr; }

private:
    Unique<VertexArray> vao_;
    Shared<VertexBuffer> vbo_;
    Shared<IndexBuffer> ibo_;
    u32 vertexCount_ = 0;
    u32 stride_ = 0;
    bool dynamic_ = false;
};

/**
 * @brief Manager for custom geometries
 */
class GeometryManager {
public:
    using GeometryHandle = u32;
    static constexpr GeometryHandle INVALID_HANDLE = 0;

    GeometryManager() = default;
    ~GeometryManager() = default;

    /**
     * @brief Creates a new geometry
     * @return Handle to the geometry
     */
    GeometryHandle create();

    /**
     * @brief Gets a geometry by handle
     */
    CustomGeometry* get(GeometryHandle handle);
    const CustomGeometry* get(GeometryHandle handle) const;

    /**
     * @brief Releases a geometry
     */
    void release(GeometryHandle handle);

    /**
     * @brief Checks if handle is valid
     */
    bool isValid(GeometryHandle handle) const;

private:
    std::vector<Unique<CustomGeometry>> geometries_;
    std::vector<GeometryHandle> freeList_;
    GeometryHandle nextHandle_ = 1;
};

}  // namespace esengine

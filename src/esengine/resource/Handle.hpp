/**
 * @file    Handle.hpp
 * @brief   Type-safe resource handle system
 * @details Provides lightweight, type-safe handles for referencing GPU
 *          resources without exposing raw pointers or ownership semantics.
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
#include <limits>

namespace esengine::resource {

// =============================================================================
// Handle Template
// =============================================================================

/**
 * @brief Type-safe resource handle
 *
 * @details Lightweight identifier for resources stored in ResourcePool.
 *          Handles are copyable and comparable, but do not manage resource
 *          lifetime - use ResourceManager for acquire/release.
 *
 * @tparam T The resource type this handle references
 *
 * @code
 * ShaderHandle shader = resourceManager.loadShader("vert.glsl", "frag.glsl");
 * if (shader.isValid()) {
 *     Shader* ptr = resourceManager.getShader(shader);
 * }
 * @endcode
 */
template<typename T>
class Handle {
public:
    using IdType = u32;
    static constexpr IdType INVALID = std::numeric_limits<IdType>::max();

    /** @brief Creates an invalid handle */
    Handle() = default;

    /**
     * @brief Creates a handle with the given ID
     * @param id The resource identifier
     */
    explicit Handle(IdType id) : id_(id) {}

    /** @brief Checks if the handle references a valid resource */
    bool isValid() const { return id_ != INVALID; }

    /** @brief Gets the raw identifier */
    IdType id() const { return id_; }

    /** @brief Equality comparison */
    bool operator==(const Handle& other) const { return id_ == other.id_; }

    /** @brief Inequality comparison */
    bool operator!=(const Handle& other) const { return id_ != other.id_; }

    /** @brief Explicit bool conversion (true if valid) */
    explicit operator bool() const { return isValid(); }

private:
    IdType id_ = INVALID;
};

}  // namespace esengine::resource

// =============================================================================
// Forward Declarations
// =============================================================================

namespace esengine {
    class Shader;
    class Texture;
    class VertexBuffer;
    class IndexBuffer;
}

namespace esengine::spine {
    struct SpineSkeletonData;
}

namespace esengine::text {
    class BitmapFont;
}

// =============================================================================
// Handle Type Aliases
// =============================================================================

namespace esengine::resource {

/** @brief Handle to a shader resource */
using ShaderHandle = Handle<esengine::Shader>;

/** @brief Handle to a texture resource */
using TextureHandle = Handle<esengine::Texture>;

/** @brief Handle to a vertex buffer resource */
using VertexBufferHandle = Handle<esengine::VertexBuffer>;

/** @brief Handle to an index buffer resource */
using IndexBufferHandle = Handle<esengine::IndexBuffer>;

/** @brief Handle to a Spine skeleton data resource */
using SpineDataHandle = Handle<esengine::spine::SpineSkeletonData>;

/** @brief Handle to a bitmap font resource */
using BitmapFontHandle = Handle<esengine::text::BitmapFont>;

}  // namespace esengine::resource

// =============================================================================
// Std Hash Support
// =============================================================================

namespace std {

template<typename T>
struct hash<esengine::resource::Handle<T>> {
    size_t operator()(const esengine::resource::Handle<T>& handle) const noexcept {
        return hash<esengine::u32>{}(handle.id());
    }
};

}  // namespace std

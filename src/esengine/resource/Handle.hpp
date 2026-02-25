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

    static constexpr u32 INDEX_BITS = 20;
    static constexpr u32 GEN_BITS = 12;
    static constexpr u32 INDEX_MASK = (1u << INDEX_BITS) - 1;
    static constexpr u32 GEN_MASK = (1u << GEN_BITS) - 1;
    static constexpr IdType INVALID = std::numeric_limits<IdType>::max();

    /** @brief Creates an invalid handle */
    Handle() = default;

    /**
     * @brief Creates a handle from a packed ID (index + generation)
     * @param id The packed resource identifier
     */
    explicit Handle(IdType id) : id_(id) {}

    /**
     * @brief Creates a handle from separate index and generation
     * @param index Slot index in the resource pool (max ~1M)
     * @param generation Reuse counter for the slot (max 4095)
     */
    static Handle fromParts(u32 index, u32 generation) {
        return Handle(((generation & GEN_MASK) << INDEX_BITS) | (index & INDEX_MASK));
    }

    /** @brief Checks if the handle references a valid resource */
    bool isValid() const { return id_ != INVALID; }

    /** @brief Gets the packed identifier (index + generation) */
    IdType id() const { return id_; }

    /** @brief Extracts the slot index from the packed handle */
    u32 index() const { return id_ & INDEX_MASK; }

    /** @brief Extracts the generation from the packed handle */
    u32 generation() const { return (id_ >> INDEX_BITS) & GEN_MASK; }

    /** @brief Extracts index from a raw packed ID */
    static u32 extractIndex(IdType packed) { return packed & INDEX_MASK; }

    /** @brief Extracts generation from a raw packed ID */
    static u32 extractGeneration(IdType packed) { return (packed >> INDEX_BITS) & GEN_MASK; }

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

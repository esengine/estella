// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Texture.hpp
 * @brief   GPU texture abstraction for 2D images
 * @details Provides cross-platform texture handling for OpenGL ES/WebGL
 *          including creation, binding, and pixel data management.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Types.hpp"
#include "GfxEnums.hpp"

// Standard library
#include <span>
#include <string>
#include <vector>

namespace esengine {

class GfxDevice;

// =============================================================================
// Texture Enums
// =============================================================================

// TextureFilter / TextureWrap live in GfxEnums.hpp with the other backend-agnostic
// sampling enums; TextureFormat below is this wrapper's user-facing format set.

/**
 * @brief Texture pixel format
 */
enum class TextureFormat {
    None = 0,
    RGB8,    ///< 3 channels, 8 bits each (24 bpp)
    RGBA8,   ///< 4 channels, 8 bits each (32 bpp)
    Depth24  ///< Depth buffer format (24 bits)
};

// =============================================================================
// Texture Specification
// =============================================================================

/**
 * @brief Texture creation parameters
 *
 * @details Specifies all properties for texture creation including
 *          dimensions, format, filtering, and wrapping.
 *
 * @code
 * TextureSpecification spec;
 * spec.width = 256;
 * spec.height = 256;
 * spec.format = TextureFormat::RGBA8;
 * spec.minFilter = TextureFilter::Nearest;
 * auto texture = Texture::create(spec);
 * @endcode
 */
struct TextureSpecification {
    /** @brief Texture width in pixels */
    u32 width = 1;
    /** @brief Texture height in pixels */
    u32 height = 1;
    /** @brief Pixel format */
    TextureFormat format = TextureFormat::RGBA8;
    /** @brief Minification filter */
    TextureFilter minFilter = TextureFilter::Linear;
    /** @brief Magnification filter */
    TextureFilter magFilter = TextureFilter::Linear;
    /** @brief Horizontal wrap mode */
    TextureWrap wrapS = TextureWrap::Repeat;
    /** @brief Vertical wrap mode */
    TextureWrap wrapT = TextureWrap::Repeat;
    /** @brief Generate mipmaps automatically */
    bool generateMips = true;
};

// =============================================================================
// Texture Class
// =============================================================================

/**
 * @brief 2D texture for GPU rendering
 *
 * @details Encapsulates an OpenGL/WebGL texture object. Supports
 *          creation from pixel data, files, or empty specifications.
 *
 * @code
 * // Create from pixel data
 * std::vector<u8> pixels = {...}; // RGBA data
 * auto texture = Texture::create(64, 64, std::span(pixels));
 *
 * // Bind for rendering
 * texture->bind(0); // Bind to texture unit 0
 * @endcode
 */
class Texture {
public:
    Texture() = default;
    virtual ~Texture();

    // Non-copyable, movable
    Texture(const Texture&) = delete;
    Texture& operator=(const Texture&) = delete;
    Texture(Texture&& other) noexcept;
    Texture& operator=(Texture&& other) noexcept;

    // =========================================================================
    // Creation
    // =========================================================================

    /**
     * @brief Creates an empty texture from specification
     * @param spec Texture parameters
     * @return Unique pointer to the texture
     *
     * @details Creates a texture with uninitialized pixel data.
     *          Use setData() to upload pixels later.
     */
    static Unique<Texture> create(GfxDevice& device, const TextureSpecification& spec);

    /**
     * @brief Creates a texture from a span of pixel data
     * @param width Texture width in pixels
     * @param height Texture height in pixels
     * @param pixels Pixel data (size must match width*height*channels)
     * @param format Pixel format (default RGBA8)
     * @return Unique pointer to the texture
     */
    static Unique<Texture> create(GfxDevice& device, u32 width, u32 height, std::span<const u8> pixels,
                                   TextureFormat format = TextureFormat::RGBA8,
                                   bool flipY = false);

    /**
     * @brief Creates a texture from pixel vector
     * @param width Texture width in pixels
     * @param height Texture height in pixels
     * @param pixels Pixel data (size must match width*height*channels)
     * @param format Pixel format (default RGBA8)
     * @param flipY Flip vertically on upload (for web image data)
     * @return Unique pointer to the texture
     */
    static Unique<Texture> create(GfxDevice& device, u32 width, u32 height, const std::vector<u8>& pixels,
                                   TextureFormat format = TextureFormat::RGBA8,
                                   bool flipY = false);

    // =========================================================================
    // Operations
    // =========================================================================

    /**
     * @brief Binds the texture to a texture unit
     * @param slot Texture unit index (0-7 typical for WebGL)
     */
    void bind(u32 slot = 0) const;

    /** @brief Unbinds the texture */
    void unbind() const;

    /**
     * @brief Updates texture pixel data from span
     * @param pixels New pixel data
     */
    void setData(std::span<const u8> pixels);

    /**
     * @brief Updates texture pixel data from vector
     * @param pixels New pixel data
     */
    void setData(const std::vector<u8>& pixels);

    /**
     * @brief Uploads pixel data to a sub-rectangle of the texture.
     *
     * Lets the dynamic glyph atlas pack glyphs one-by-one
     * without re-uploading the whole atlas. The sub-rect must lie fully inside
     * the texture and `data` must be tightly packed in this texture's format.
     *
     * @param xoffset,yoffset top-left of the sub-rect, in texels
     * @param width,height    sub-rect size, in texels
     * @param data,sizeBytes  pixel buffer matching the texture's format
     */
    void updateSubRegion(u32 xoffset, u32 yoffset, u32 width, u32 height,
                         const void* data, u32 sizeBytes, bool flipY = false);

    // =========================================================================
    // Properties
    // =========================================================================

    /** @brief Gets the device texture handle */
    TextureHandle handle() const { return handle_; }

    /** @brief Gets the texture handle's raw value, for command payloads and the WASM boundary */
    u32 getId() const { return static_cast<u32>(handle_); }

    /** @brief Gets the texture width in pixels */
    u32 getWidth() const { return width_; }

    /** @brief Gets the texture height in pixels */
    u32 getHeight() const { return height_; }

    /** @brief Gets the pixel format */
    TextureFormat getFormat() const { return format_; }

    /**
     * @brief Compares textures by GPU ID
     * @param other Texture to compare with
     * @return True if same GPU texture
     */
    bool operator==(const Texture& other) const {
        return handle_ == other.handle_;
    }

    // =========================================================================
    // Raw API for internal use only
    // =========================================================================

    /**
     * @brief Creates a texture from raw pixel pointer (internal use)
     * @param width Texture width in pixels
     * @param height Texture height in pixels
     * @param data Pointer to pixel data
     * @param format Pixel format (default RGBA8)
     * @return Unique pointer to the texture
     */
    static Unique<Texture> createRaw(GfxDevice& device, u32 width, u32 height, const void* data,
                                      TextureFormat format = TextureFormat::RGBA8,
                                      bool flipY = false);

    /**
     * @brief Wraps an existing GL texture ID
     * @param glTextureId The OpenGL texture ID created externally
     * @param width Texture width in pixels
     * @param height Texture height in pixels
     * @param format Pixel format
     * @return Unique pointer to the texture wrapper
     */
    static Unique<Texture> createFromExternalId(GfxDevice& device, u32 glTextureId, u32 width, u32 height,
                                                 TextureFormat format = TextureFormat::RGBA8);

    /**
     * @brief Updates texture pixel data from raw pointer (internal use)
     * @param data Pointer to pixel data
     * @param sizeBytes Size of data in bytes
     */
    void setDataRaw(const void* data, u32 sizeBytes, bool flipY = false);

private:
    /**
     * @brief Initializes the texture on GPU
     * @param spec Texture parameters
     * @param pixels Optional initial pixel data
     * @param flipY Vertical flip on the initial upload
     * @return True on success
     */
    bool initialize(const TextureSpecification& spec, const void* pixels, bool flipY);

    GfxDevice* device_ = nullptr;  ///< Set by the create* factories; all GL goes through it.
    TextureHandle handle_ = TextureHandle::Invalid;
    u32 width_ = 0;
    u32 height_ = 0;
    TextureFormat format_ = TextureFormat::None;
    // False for textures wrapping an externally-owned GL id (createFromExternalId):
    // the external owner frees it, so this wrapper must NOT delete it (double-free).
    bool owns_ = true;
};

}  // namespace esengine

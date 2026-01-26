/**
 * @file    Framebuffer.hpp
 * @brief   GPU framebuffer abstraction for render-to-texture
 * @details Provides off-screen rendering targets with color and depth attachments
 *          for OpenGL ES/WebGL.
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

#include "../core/Types.hpp"
#include "Texture.hpp"

namespace esengine {

// =============================================================================
// Framebuffer Specification
// =============================================================================

/**
 * @brief Framebuffer creation parameters
 *
 * @details Specifies the dimensions and attachment configuration
 *          for an off-screen rendering target.
 *
 * @code
 * FramebufferSpec spec;
 * spec.width = 1280;
 * spec.height = 720;
 * spec.samples = 1; // No multisampling
 * auto fbo = Framebuffer::create(spec);
 * @endcode
 */
struct FramebufferSpec {
    /** @brief Framebuffer width in pixels */
    u32 width = 1280;
    /** @brief Framebuffer height in pixels */
    u32 height = 720;
    /** @brief Number of samples for MSAA (1 = no multisampling) */
    u32 samples = 1;
    /** @brief Whether to create depth/stencil attachment */
    bool depthStencil = true;
};

// =============================================================================
// Framebuffer Class
// =============================================================================

/**
 * @brief Off-screen rendering target
 *
 * @details Encapsulates an OpenGL/WebGL framebuffer object with
 *          color and optional depth attachments. Supports render-to-texture
 *          for scene views, post-processing, and shadow maps.
 *
 * @code
 * // Create framebuffer
 * FramebufferSpec spec;
 * spec.width = 800;
 * spec.height = 600;
 * auto fbo = Framebuffer::create(spec);
 *
 * // Render to texture
 * fbo->bind();
 * RenderCommand::clear();
 * // ... render scene ...
 * fbo->unbind();
 *
 * // Use color texture
 * u32 textureId = fbo->getColorAttachment();
 * @endcode
 */
class Framebuffer {
public:
    Framebuffer() = default;
    ~Framebuffer();

    // Non-copyable, movable
    Framebuffer(const Framebuffer&) = delete;
    Framebuffer& operator=(const Framebuffer&) = delete;
    Framebuffer(Framebuffer&& other) noexcept;
    Framebuffer& operator=(Framebuffer&& other) noexcept;

    // =========================================================================
    // Creation
    // =========================================================================

    /**
     * @brief Creates a framebuffer from specification
     * @param spec Framebuffer parameters
     * @return Unique pointer to the framebuffer
     *
     * @details Creates framebuffer with color attachment and optional
     *          depth/stencil attachment based on spec.
     */
    static Unique<Framebuffer> create(const FramebufferSpec& spec);

    // =========================================================================
    // Operations
    // =========================================================================

    /**
     * @brief Binds the framebuffer for rendering
     * @details All subsequent draw calls will render to this framebuffer
     *          until unbind() is called.
     */
    void bind() const;

    /**
     * @brief Unbinds the framebuffer
     * @details Restores rendering to the default framebuffer (screen).
     */
    void unbind() const;

    /**
     * @brief Resizes the framebuffer
     * @param width New width in pixels
     * @param height New height in pixels
     *
     * @details Recreates all attachments with new dimensions.
     *          Existing content is lost.
     */
    void resize(u32 width, u32 height);

    // =========================================================================
    // Properties
    // =========================================================================

    /** @brief Gets the color attachment texture ID */
    u32 getColorAttachment() const { return colorAttachment_; }

    /** @brief Gets the depth attachment texture ID (0 if none) */
    u32 getDepthAttachment() const { return depthAttachment_; }

    /** @brief Gets the framebuffer width in pixels */
    u32 getWidth() const { return spec_.width; }

    /** @brief Gets the framebuffer height in pixels */
    u32 getHeight() const { return spec_.height; }

    /** @brief Gets the framebuffer specification */
    const FramebufferSpec& getSpecification() const { return spec_; }

private:
    /**
     * @brief Initializes the framebuffer on GPU
     * @return True on success
     */
    bool initialize();

    /**
     * @brief Releases GPU resources
     */
    void cleanup();

    FramebufferSpec spec_;
    u32 framebufferId_ = 0;
    u32 colorAttachment_ = 0;
    u32 depthAttachment_ = 0;
};

}  // namespace esengine

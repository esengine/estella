/**
 * @file    Renderer.hpp
 * @brief   Core rendering functionality for ESEngine
 * @details Provides both immediate-mode rendering (Renderer) and efficient
 *          batched 2D sprite rendering (BatchRenderer2D) for WebGL/OpenGL ES.
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
#include "../math/Math.hpp"
#include "Buffer.hpp"
#include "Shader.hpp"
#include "Texture.hpp"
#include "RenderContext.hpp"
#include "../resource/Handle.hpp"
#include "../resource/TextureMetadata.hpp"

// Forward declaration
namespace esengine::resource {
    class ResourceManager;
}

namespace esengine {

// =============================================================================
// Renderer Statistics
// =============================================================================

using RendererStats = RenderContextStats;

// =============================================================================
// Renderer Class
// =============================================================================

/**
 * @brief Instance-based renderer for 2D drawing
 *
 * @details Provides immediate-mode 2D rendering with dependency injection.
 *          Requires a RenderContext for shared resources and state.
 *
 * @code
 * RenderContext context;
 * context.init();
 *
 * Renderer renderer(context);
 *
 * // Frame rendering
 * renderer.beginFrame();
 * renderer.clear();
 * renderer.beginScene(camera.getViewProjection());
 *
 * renderer.drawQuad({100, 100}, {50, 50}, {1, 0, 0, 1}); // Red quad
 *
 * renderer.endScene();
 * renderer.endFrame();
 * @endcode
 */
class Renderer {
public:
    /**
     * @brief Constructs a renderer with the given context
     * @param context Reference to the rendering context
     */
    explicit Renderer(RenderContext& context);

    ~Renderer() = default;

    // Non-copyable
    Renderer(const Renderer&) = delete;
    Renderer& operator=(const Renderer&) = delete;

    // =========================================================================
    // Frame Management
    // =========================================================================

    /** @brief Begins a new frame */
    void beginFrame();

    /** @brief Ends the current frame */
    void endFrame();

    // =========================================================================
    // Viewport and Clearing
    // =========================================================================

    /**
     * @brief Sets the rendering viewport
     * @param x Viewport X origin in pixels
     * @param y Viewport Y origin in pixels
     * @param width Viewport width in pixels
     * @param height Viewport height in pixels
     */
    void setViewport(i32 x, i32 y, u32 width, u32 height);

    /**
     * @brief Sets the clear color for subsequent clear() calls
     * @param color RGBA color (0-1 range)
     */
    void setClearColor(const glm::vec4& color);

    /** @brief Clears the color and depth buffers */
    void clear();

    // =========================================================================
    // Scene Management
    // =========================================================================

    /**
     * @brief Begins a scene with the given camera transform
     * @param viewProjection Combined view-projection matrix
     */
    void beginScene(const glm::mat4& viewProjection);

    /** @brief Ends the current scene */
    void endScene();

    // =========================================================================
    // Draw Submission
    // =========================================================================

    /**
     * @brief Submits geometry for rendering with a shader
     * @param shader The shader program to use
     * @param vao The vertex array containing geometry
     * @param transform Model transform matrix (defaults to identity)
     */
    void submit(const Shader& shader,
                const VertexArray& vao,
                const glm::mat4& transform = glm::mat4(1.0f));

    // =========================================================================
    // 2D Rendering Helpers
    // =========================================================================

    /**
     * @brief Draws a colored quad at a 2D position
     * @param position Center position (x, y)
     * @param size Width and height
     * @param color RGBA color
     */
    void drawQuad(const glm::vec2& position, const glm::vec2& size,
                  const glm::vec4& color);

    /**
     * @brief Draws a colored quad at a 3D position
     * @param position Center position (x, y, z)
     * @param size Width and height
     * @param color RGBA color
     */
    void drawQuad(const glm::vec3& position, const glm::vec2& size,
                  const glm::vec4& color);

    /**
     * @brief Draws a textured quad at a 2D position
     * @param position Center position (x, y)
     * @param size Width and height
     * @param texture Texture to apply
     * @param tintColor Optional color tint (defaults to white)
     */
    void drawQuad(const glm::vec2& position, const glm::vec2& size,
                  const Texture& texture, const glm::vec4& tintColor = glm::vec4(1.0f));

    /**
     * @brief Draws a textured quad at a 3D position
     * @param position Center position (x, y, z)
     * @param size Width and height
     * @param texture Texture to apply
     * @param tintColor Optional color tint (defaults to white)
     */
    void drawQuad(const glm::vec3& position, const glm::vec2& size,
                  const Texture& texture, const glm::vec4& tintColor = glm::vec4(1.0f));

    /**
     * @brief Draws a textured quad using a texture handle
     * @param position Center position (x, y)
     * @param size Width and height
     * @param texture Texture handle
     * @param rm Resource manager to resolve the handle
     * @param tintColor Optional color tint (defaults to white)
     */
    void drawQuad(const glm::vec2& position, const glm::vec2& size,
                  resource::TextureHandle texture, resource::ResourceManager& rm,
                  const glm::vec4& tintColor = glm::vec4(1.0f));

    // =========================================================================
    // Statistics
    // =========================================================================

    /**
     * @brief Gets the current frame's rendering statistics
     * @return RendererStats with draw call and geometry counts
     */
    RendererStats getStats() const;

    /** @brief Resets statistics counters */
    void resetStats();

    // =========================================================================
    // Context Access
    // =========================================================================

    /**
     * @brief Gets the rendering context
     * @return Reference to the context
     */
    RenderContext& getContext() { return context_; }

private:
    RenderContext& context_;
};

// =============================================================================
// BatchRenderer2D Class
// =============================================================================

/**
 * @brief High-performance batched 2D sprite renderer
 *
 * @details Batches multiple quads into single draw calls for optimal
 *          performance. Supports textured and colored quads with rotation.
 *          Now uses RenderContext for shared state.
 *
 * @code
 * BatchRenderer2D batch(context);
 * batch.setProjection(orthoMatrix);
 *
 * batch.beginBatch();
 * for (auto& sprite : sprites) {
 *     batch.drawQuad(sprite.pos, sprite.size, sprite.textureId);
 * }
 * batch.endBatch();
 * batch.flush();
 * @endcode
 */
class BatchRenderer2D {
public:
    /**
     * @brief Constructs a batch renderer
     * @param context Render context for shared resources
     * @param resource_manager Resource manager for shader loading
     */
    BatchRenderer2D(RenderContext& context, resource::ResourceManager& resource_manager);

    ~BatchRenderer2D();

    // Non-copyable
    BatchRenderer2D(const BatchRenderer2D&) = delete;
    BatchRenderer2D& operator=(const BatchRenderer2D&) = delete;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /** @brief Initializes batch rendering resources */
    void init();

    /** @brief Shuts down and releases resources */
    void shutdown();

    // =========================================================================
    // Batch Operations
    // =========================================================================

    /** @brief Begins a new batch */
    void beginBatch();

    /** @brief Ends the current batch (prepares for flush) */
    void endBatch();

    /** @brief Flushes the batch to the GPU (issues draw call) */
    void flush();

    // =========================================================================
    // Textured Quads
    // =========================================================================

    /**
     * @brief Draws a textured quad at a 2D position
     * @param position Position (x, y)
     * @param size Width and height
     * @param textureId GPU texture handle
     * @param color Color tint (defaults to white)
     */
    void drawQuad(const glm::vec2& position, const glm::vec2& size,
                  u32 textureId, const glm::vec4& color = glm::vec4(1.0f));

    /**
     * @brief Draws a textured quad at a 3D position
     * @param position Position (x, y, z)
     * @param size Width and height
     * @param textureId GPU texture handle
     * @param color Color tint (defaults to white)
     */
    void drawQuad(const glm::vec3& position, const glm::vec2& size,
                  u32 textureId, const glm::vec4& color = glm::vec4(1.0f));

    // =========================================================================
    // Colored Quads
    // =========================================================================

    /**
     * @brief Draws a solid colored quad (no texture)
     * @param position Position (x, y)
     * @param size Width and height
     * @param color RGBA color
     */
    void drawQuad(const glm::vec2& position, const glm::vec2& size,
                  const glm::vec4& color);

    // =========================================================================
    // Rotated Quads
    // =========================================================================

    /**
     * @brief Draws a rotated colored quad
     * @param position Position (x, y)
     * @param size Width and height
     * @param rotation Rotation angle in radians
     * @param color RGBA color
     */
    void drawRotatedQuad(const glm::vec2& position, const glm::vec2& size,
                         f32 rotation, const glm::vec4& color);

    /**
     * @brief Draws a rotated textured quad
     * @param position Position (x, y)
     * @param size Width and height
     * @param rotation Rotation angle in radians
     * @param textureId GPU texture handle
     * @param tintColor Color tint (defaults to white)
     */
    void drawRotatedQuad(const glm::vec2& position, const glm::vec2& size,
                         f32 rotation, u32 textureId,
                         const glm::vec4& tintColor = glm::vec4(1.0f));

    // =========================================================================
    // Nine-Slice Rendering
    // =========================================================================

    /**
     * @brief Draws a nine-slice sprite
     * @param position Center position (x, y)
     * @param size Total width and height
     * @param textureId GPU texture handle
     * @param texSize Texture dimensions in pixels
     * @param border Nine-slice border configuration
     * @param color Color tint (defaults to white)
     * @param rotation Rotation angle in radians (defaults to 0)
     */
    void drawNineSlice(const glm::vec2& position, const glm::vec2& size,
                       u32 textureId, const glm::vec2& texSize,
                       const resource::SliceBorder& border,
                       const glm::vec4& color = glm::vec4(1.0f),
                       f32 rotation = 0.0f);

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * @brief Sets the projection matrix for 2D rendering
     * @param projection Orthographic projection matrix
     */
    void setProjection(const glm::mat4& projection);

    // =========================================================================
    // Statistics
    // =========================================================================

    /** @brief Gets the number of draw calls in the current/last frame */
    u32 getDrawCallCount() const;

    /** @brief Gets the number of quads rendered in the current/last frame */
    u32 getQuadCount() const;

private:
    struct BatchData;
    Unique<BatchData> data_;
    RenderContext& context_;
    resource::ResourceManager& resource_manager_;
};

}  // namespace esengine

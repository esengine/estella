/**
 * @file    Renderer.hpp
 * @brief   Core rendering functionality for ESEngine
 * @details Provides both immediate-mode rendering (Renderer) and efficient
 *          batched 2D sprite rendering (BatchRenderer2D) for WebGL/OpenGL ES.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
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

namespace esengine {

// =============================================================================
// Renderer Statistics
// =============================================================================

/**
 * @brief Statistics for rendering performance analysis
 *
 * @details Tracks draw calls and geometry counts per frame.
 *          Use Renderer::getStats() to retrieve current values.
 */
struct RendererStats {
    /** @brief Number of draw calls this frame */
    u32 drawCalls = 0;
    /** @brief Number of triangles rendered this frame */
    u32 triangleCount = 0;
    /** @brief Number of vertices processed this frame */
    u32 vertexCount = 0;

    /** @brief Resets all counters to zero */
    void reset() {
        drawCalls = 0;
        triangleCount = 0;
        vertexCount = 0;
    }
};

// =============================================================================
// Renderer Class
// =============================================================================

/**
 * @brief Static renderer for immediate-mode drawing
 *
 * @details Provides low-level rendering operations and a simple 2D quad
 *          drawing API. For performance-critical sprite rendering, prefer
 *          BatchRenderer2D.
 *
 * @code
 * // Initialization (called by Application)
 * Renderer::init();
 *
 * // Frame rendering
 * Renderer::beginFrame();
 * Renderer::clear();
 * Renderer::beginScene(camera.getViewProjection());
 *
 * Renderer::drawQuad({100, 100}, {50, 50}, {1, 0, 0, 1}); // Red quad
 *
 * Renderer::endScene();
 * Renderer::endFrame();
 * @endcode
 */
class Renderer {
public:
    /** @brief Initializes the renderer (call once at startup) */
    static void init();

    /** @brief Shuts down the renderer and releases resources */
    static void shutdown();

    /** @brief Begins a new frame */
    static void beginFrame();

    /** @brief Ends the current frame */
    static void endFrame();

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
    static void setViewport(i32 x, i32 y, u32 width, u32 height);

    /**
     * @brief Sets the clear color for subsequent clear() calls
     * @param color RGBA color (0-1 range)
     */
    static void setClearColor(const glm::vec4& color);

    /** @brief Clears the color and depth buffers */
    static void clear();

    // =========================================================================
    // Scene Management
    // =========================================================================

    /**
     * @brief Begins a scene with the given camera transform
     * @param viewProjection Combined view-projection matrix
     */
    static void beginScene(const glm::mat4& viewProjection);

    /** @brief Ends the current scene */
    static void endScene();

    // =========================================================================
    // Draw Submission
    // =========================================================================

    /**
     * @brief Submits geometry for rendering with a shader
     * @param shader The shader program to use
     * @param vao The vertex array containing geometry
     * @param transform Model transform matrix (defaults to identity)
     */
    static void submit(const Shader& shader,
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
    static void drawQuad(const glm::vec2& position, const glm::vec2& size,
                         const glm::vec4& color);

    /**
     * @brief Draws a textured quad at a 2D position
     * @param position Center position (x, y)
     * @param size Width and height
     * @param texture Texture to apply
     * @param tintColor Optional color tint (defaults to white)
     */
    static void drawQuad(const glm::vec2& position, const glm::vec2& size,
                         const Texture& texture, const glm::vec4& tintColor = glm::vec4(1.0f));

    /**
     * @brief Draws a colored quad at a 3D position
     * @param position Center position (x, y, z)
     * @param size Width and height
     * @param color RGBA color
     */
    static void drawQuad(const glm::vec3& position, const glm::vec2& size,
                         const glm::vec4& color);

    /**
     * @brief Draws a textured quad at a 3D position
     * @param position Center position (x, y, z)
     * @param size Width and height
     * @param texture Texture to apply
     * @param tintColor Optional color tint (defaults to white)
     */
    static void drawQuad(const glm::vec3& position, const glm::vec2& size,
                         const Texture& texture, const glm::vec4& tintColor = glm::vec4(1.0f));

    // =========================================================================
    // Statistics
    // =========================================================================

    /**
     * @brief Gets the current frame's rendering statistics
     * @return RendererStats with draw call and geometry counts
     */
    static RendererStats getStats();

    /** @brief Resets statistics counters (call at frame start) */
    static void resetStats();

private:
    static void initQuadData();
    static void flushBatch();
};

// =============================================================================
// BatchRenderer2D Class
// =============================================================================

/**
 * @brief High-performance batched 2D sprite renderer
 *
 * @details Batches multiple quads into single draw calls for optimal
 *          performance. Supports textured and colored quads with rotation.
 *
 * @code
 * BatchRenderer2D::init();
 * BatchRenderer2D::setProjection(orthoMatrix);
 *
 * BatchRenderer2D::beginBatch();
 * for (auto& sprite : sprites) {
 *     BatchRenderer2D::drawQuad(sprite.pos, sprite.size, sprite.textureId);
 * }
 * BatchRenderer2D::endBatch();
 * BatchRenderer2D::flush();
 * @endcode
 *
 * @note The batch is automatically flushed when full or when texture
 *       slots are exhausted.
 */
class BatchRenderer2D {
public:
    /** @brief Initializes the batch renderer */
    static void init();

    /** @brief Shuts down and releases batch renderer resources */
    static void shutdown();

    /** @brief Begins a new batch */
    static void beginBatch();

    /** @brief Ends the current batch (prepares for flush) */
    static void endBatch();

    /** @brief Flushes the batch to the GPU (issues draw call) */
    static void flush();

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
    static void drawQuad(const glm::vec2& position, const glm::vec2& size,
                         u32 textureId, const glm::vec4& color = glm::vec4(1.0f));

    /**
     * @brief Draws a textured quad at a 3D position
     * @param position Position (x, y, z)
     * @param size Width and height
     * @param textureId GPU texture handle
     * @param color Color tint (defaults to white)
     */
    static void drawQuad(const glm::vec3& position, const glm::vec2& size,
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
    static void drawQuad(const glm::vec2& position, const glm::vec2& size,
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
    static void drawRotatedQuad(const glm::vec2& position, const glm::vec2& size,
                                 f32 rotation, const glm::vec4& color);

    /**
     * @brief Draws a rotated textured quad
     * @param position Position (x, y)
     * @param size Width and height
     * @param rotation Rotation angle in radians
     * @param textureId GPU texture handle
     * @param tintColor Color tint (defaults to white)
     */
    static void drawRotatedQuad(const glm::vec2& position, const glm::vec2& size,
                                 f32 rotation, u32 textureId,
                                 const glm::vec4& tintColor = glm::vec4(1.0f));

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * @brief Sets the projection matrix for 2D rendering
     * @param projection Orthographic projection matrix
     */
    static void setProjection(const glm::mat4& projection);

    // =========================================================================
    // Statistics
    // =========================================================================

    /** @brief Gets the number of draw calls in the current/last frame */
    static u32 getDrawCallCount();

    /** @brief Gets the number of quads rendered in the current/last frame */
    static u32 getQuadCount();
};

}  // namespace esengine

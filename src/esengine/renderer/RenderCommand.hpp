/**
 * @file    RenderCommand.hpp
 * @brief   Low-level rendering commands
 * @details Provides a static interface for GPU state management and
 *          draw call submission. Abstracts OpenGL/WebGL calls.
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
#include "BlendMode.hpp"

namespace esengine {

// Forward declaration
class VertexArray;

// =============================================================================
// RenderCommand Class
// =============================================================================

/**
 * @brief Static interface for low-level rendering operations
 *
 * @details Provides direct control over GPU state and draw calls.
 *          All methods are static - no instance needed. Used internally
 *          by the Renderer class and can be used directly for custom
 *          rendering pipelines.
 *
 * @code
 * RenderCommand::init();
 * RenderCommand::setViewport(0, 0, 800, 600);
 * RenderCommand::setClearColor({0.1f, 0.1f, 0.1f, 1.0f});
 * RenderCommand::clear();
 *
 * // Enable alpha blending
 * RenderCommand::setBlending(true);
 * RenderCommand::setBlendFunc();
 *
 * // Draw indexed geometry
 * vao.bind();
 * RenderCommand::drawIndexed(vao);
 * @endcode
 */
class RenderCommand {
public:
    // =========================================================================
    // Initialization
    // =========================================================================

    /**
     * @brief Initializes the rendering subsystem
     * @details Must be called once before any other RenderCommand functions.
     *          Sets up OpenGL/WebGL state and capabilities.
     */
    static void init();

    /**
     * @brief Shuts down the rendering subsystem
     * @details Releases any allocated resources. Call once at application exit.
     */
    static void shutdown();

    // =========================================================================
    // Viewport and Clearing
    // =========================================================================

    /**
     * @brief Sets the rendering viewport
     * @param x Viewport X origin (pixels from left)
     * @param y Viewport Y origin (pixels from bottom)
     * @param width Viewport width in pixels
     * @param height Viewport height in pixels
     */
    static void setViewport(i32 x, i32 y, u32 width, u32 height);

    /**
     * @brief Sets the color used by clear()
     * @param color RGBA color (0-1 range)
     */
    static void setClearColor(const glm::vec4& color);

    /**
     * @brief Clears the framebuffer
     * @details Clears both color and depth buffers.
     */
    static void clear();

    // =========================================================================
    // Draw Calls
    // =========================================================================

    /**
     * @brief Draws indexed geometry
     * @param vao Vertex array containing geometry and indices
     * @param indexCount Number of indices to draw (0 = all)
     *
     * @details The VAO must be bound and have an index buffer set.
     */
    static void drawIndexed(const VertexArray& vao, u32 indexCount = 0);

    /**
     * @brief Draws non-indexed geometry
     * @param vertexCount Number of vertices to draw
     *
     * @details Draws vertices as triangles (GL_TRIANGLES).
     */
    static void drawArrays(u32 vertexCount);

    // =========================================================================
    // Depth Testing
    // =========================================================================

    /**
     * @brief Enables or disables depth testing
     * @param enabled True to enable depth test
     */
    static void setDepthTest(bool enabled);

    /**
     * @brief Enables or disables depth buffer writes
     * @param enabled True to allow depth writes
     */
    static void setDepthWrite(bool enabled);

    // =========================================================================
    // Blending
    // =========================================================================

    /**
     * @brief Enables or disables alpha blending
     * @param enabled True to enable blending
     */
    static void setBlending(bool enabled);

    /**
     * @brief Sets the blend function to standard alpha blending
     * @details Uses SrcAlpha and OneMinusSrcAlpha factors.
     */
    static void setBlendFunc();

    /**
     * @brief Sets the blend mode to a predefined mode
     * @param mode The blend mode to use
     */
    static void setBlendMode(BlendMode mode);

    // =========================================================================
    // Face Culling
    // =========================================================================

    /**
     * @brief Enables or disables face culling
     * @param enabled True to enable culling
     */
    static void setCulling(bool enabled);

    /**
     * @brief Sets which face to cull
     * @param front True to cull front faces, false for back faces
     */
    static void setCullFace(bool front);

    // =========================================================================
    // Debug
    // =========================================================================

    /**
     * @brief Enables or disables wireframe rendering
     * @param enabled True for wireframe mode
     *
     * @note May not be supported on WebGL/OpenGL ES.
     */
    static void setWireframe(bool enabled);
};

}  // namespace esengine

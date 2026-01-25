/**
 * @file    RenderContext.hpp
 * @brief   Rendering context containing all renderer state
 * @details Replaces global renderer state with an injectable context object
 *          that owns shader and geometry resources for basic 2D rendering.
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
#include "Buffer.hpp"
#include "Shader.hpp"

// Third-party
#include <glm/glm.hpp>

namespace esengine {

// =============================================================================
// Renderer Statistics
// =============================================================================

/**
 * @brief Statistics for rendering performance analysis
 */
struct RenderContextStats {
    u32 drawCalls = 0;      ///< Number of draw calls this frame
    u32 triangleCount = 0;  ///< Number of triangles rendered this frame

    /** @brief Resets all counters to zero */
    void reset() {
        drawCalls = 0;
        triangleCount = 0;
    }
};

// =============================================================================
// RenderContext Class
// =============================================================================

/**
 * @brief Rendering context containing shared renderer state
 *
 * @details Owns the resources and state needed for basic 2D rendering,
 *          including the quad VAO, color shader, and view-projection matrix.
 *          Replaces global static state with dependency injection.
 *
 * @code
 * RenderContext context;
 * context.init();
 *
 * Renderer renderer(context);
 * renderer.beginFrame();
 * renderer.drawQuad({100, 100}, {50, 50}, {1, 0, 0, 1});
 * renderer.endFrame();
 *
 * context.shutdown();
 * @endcode
 */
class RenderContext {
public:
    RenderContext() = default;
    ~RenderContext();

    // Non-copyable
    RenderContext(const RenderContext&) = delete;
    RenderContext& operator=(const RenderContext&) = delete;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * @brief Initializes rendering resources
     * @details Creates the quad VAO, shaders, and default textures.
     */
    void init();

    /**
     * @brief Releases all rendering resources
     */
    void shutdown();

    /**
     * @brief Checks if the context is initialized
     * @return True if init() has been called successfully
     */
    bool isInitialized() const { return initialized_; }

    // =========================================================================
    // State Access
    // =========================================================================

    /**
     * @brief Gets the current view-projection matrix
     * @return Reference to the matrix
     */
    glm::mat4& viewProjection() { return viewProjection_; }

    /**
     * @brief Gets the current view-projection matrix (const)
     * @return Const reference to the matrix
     */
    const glm::mat4& viewProjection() const { return viewProjection_; }

    /**
     * @brief Gets the rendering statistics
     * @return Reference to the stats
     */
    RenderContextStats& stats() { return stats_; }

    /**
     * @brief Gets the rendering statistics (const)
     * @return Const reference to the stats
     */
    const RenderContextStats& stats() const { return stats_; }

    // =========================================================================
    // Internal Resources
    // =========================================================================

    /**
     * @brief Gets the quad vertex array
     * @return Pointer to the quad VAO
     */
    VertexArray* getQuadVAO() { return quadVAO_.get(); }

    /**
     * @brief Gets the color shader
     * @return Pointer to the color shader
     */
    Shader* getColorShader() { return colorShader_.get(); }

    /**
     * @brief Gets the texture shader
     * @return Pointer to the texture shader
     */
    Shader* getTextureShader() { return textureShader_.get(); }

    /**
     * @brief Gets the white texture ID (for untextured quads)
     * @return GPU texture handle
     */
    u32 getWhiteTextureId() const { return whiteTextureId_; }

private:
    void initQuadData();
    void initShaders();
    void initWhiteTexture();

    glm::mat4 viewProjection_{1.0f};
    RenderContextStats stats_;

    Unique<VertexArray> quadVAO_;
    Unique<Shader> colorShader_;
    Unique<Shader> textureShader_;
    u32 whiteTextureId_ = 0;

    bool initialized_ = false;
};

}  // namespace esengine

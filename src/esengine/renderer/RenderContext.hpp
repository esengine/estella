// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
 *            Licensed under the PolyForm Noncommercial License 1.0.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Types.hpp"
#include "Buffer.hpp"
#include "LightStore.hpp"
#include "MaterialStore.hpp"
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
class GfxDevice;

class RenderContext {
public:
    explicit RenderContext(GfxDevice& device);
    RenderContext() = delete;
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
     * @brief Gets the white texture ID (for untextured quads)
     * @return GPU texture handle
     */
    u32 getWhiteTextureId() const { return whiteTextureId_; }

    /**
     * @brief GL texture id for a named built-in default texture, used to resolve a material
     *        texture param's `#pragma param ... texture default(<name>)`.
     * @details "black" → opaque black, "flatnormal"/"normal" → a flat tangent-space normal
     *          (RGB 128,128,255 → (0,0,1)); anything else (incl. "white" / empty) → white.
     */
    u32 defaultTextureByName(const std::string& name) const;

    /**
     * @brief Uploads the per-frame view-projection into the shared FrameConstants UBO.
     * @details Called once per render pass before its draws; every engine shader reads
     *          u_projection from this single UBO (bound at FRAME_CONSTANTS_BINDING).
     */
    void updateFrameConstants(const glm::mat4& viewProjection);

    /**
     * @brief The engine-side material registry (handle -> resolved render state).
     * @details Written by the SDK material binding (defineMaterial) and read by the render
     *          collect path to resolve a component's material handle into shader + pipeline
     *          state. Lives here so both sides reach it without a global lookup.
     */
    MaterialStore& materials() { return materials_; }
    const MaterialStore& materials() const { return materials_; }

    /**
     * @brief The engine-side per-frame 2D light registry (binding 2 LightConstants UBO).
     * @details Filled by the render collect path from the scene's Light2D components and uploaded
     *          once per frame; Lit2D material shaders read it. Lives here next to materials() so
     *          the render path reaches one store / one UBO without a global lookup.
     */
    LightStore& lights() { return lights_; }
    const LightStore& lights() const { return lights_; }

private:
    void initDefaultTextures();
    u32 make1x1Texture(u32 rgba);
    void initFrameUbo();

    glm::mat4 viewProjection_{1.0f};
    RenderContextStats stats_;

    u32 whiteTextureId_ = 0;
    u32 blackTextureId_ = 0;
    u32 flatNormalTextureId_ = 0;
    u32 frameUbo_ = 0;
    MaterialStore materials_;
    LightStore lights_;

    GfxDevice& device_;
    bool initialized_ = false;
};

}  // namespace esengine

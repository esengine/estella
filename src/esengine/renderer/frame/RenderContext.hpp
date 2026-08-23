// SPDX-License-Identifier: Apache-2.0
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
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../../core/Types.hpp"
#include "../rhi/Buffer.hpp"
#include "../rhi/GfxEnums.hpp"
#include "../store/LightStore.hpp"
#include "../store/MaterialStore.hpp"
#include "../rhi/Shader.hpp"

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

    /// Rebuilds the built-in textures and frame UBOs after a device loss, and
    /// re-points the stores that depend on them.
    void recreateGpuResources();

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
     * @brief Gets the white texture handle's raw value (for untextured quads)
     */
    u32 getWhiteTextureId() const { return static_cast<u32>(whiteTexture_); }

    /// The white 1x1 as a typed handle — what a lost texture is parked on until
    /// its content is re-uploaded.
    TextureHandle getWhiteTexture() const { return whiteTexture_; }


    /**
     * @brief Point the frame at what a CAMERA sees.
     * @details Keeps the projection in the engine's convention and uploads it in
     *          the device's. This is the one place that conversion happens.
     */
    void updateCameraConstants(const glm::mat4& viewProjection);

    /**
     * @brief Point the frame at a pass whose projection already suits the device.
     * @details The shadow cascades: theirs spans exactly the occluders it draws,
     *          so it lands inside either clip volume untouched, and converting it
     *          would move the depths it writes away from the copy of the matrix
     *          the receiving shader compares against.
     */
    void updateFrameConstants(const glm::mat4& viewProjection);

    /** @brief Uploads the frame clock + canvas size into the injected TimeConstants UBO. */
    void setFrameTime(f32 elapsedSec, u32 viewportW, u32 viewportH);

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
     * @details Filled by the render collect path from the scene's Light components and uploaded
     *          once per frame; Lit material shaders read it. Lives here next to materials() so
     *          the render path reaches one store / one UBO without a global lookup.
     */
    LightStore& lights() { return lights_; }
    const LightStore& lights() const { return lights_; }

private:
    void initDefaultTextures();
    TextureHandle make1x1Texture(u32 rgba);
    void initFrameUbo();

    void uploadFrameConstants(const glm::mat4& upload, const glm::mat4& engine);

    glm::mat4 viewProjection_{1.0f};
    RenderContextStats stats_;

    TextureHandle whiteTexture_ = TextureHandle::Invalid;
    TextureHandle blackTexture_ = TextureHandle::Invalid;
    TextureHandle flatNormalTexture_ = TextureHandle::Invalid;
    BufferHandle frameUbo_ = BufferHandle::Invalid;
    BufferHandle timeUbo_ = BufferHandle::Invalid;
    BufferHandle drawParamsFallback_ = BufferHandle::Invalid;
    /// One skinned draw's bone matrices, rewritten immediately before that draw.
    BufferHandle skinUbo_ = BufferHandle::Invalid;

public:
    /** @brief The per-draw bone-matrix block a skinned draw writes into. */
    BufferHandle skinUbo() const { return skinUbo_; }

private:
    f32 lastElapsed_ = 0.0f;
    MaterialStore materials_;
    LightStore lights_;

    GfxDevice& device_;
    bool initialized_ = false;
};

}  // namespace esengine

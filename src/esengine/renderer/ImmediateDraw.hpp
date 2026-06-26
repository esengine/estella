// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ImmediateDraw.hpp
 * @brief   Immediate mode 2D drawing API
 * @details Provides simple, immediate mode drawing primitives (lines, rectangles,
 *          circles, polygons) with automatic batching for efficient rendering.
 *          All draw commands are cleared each frame.
 *
 *          Backed by the same TransientBufferPool + GfxDevice pipeline machinery
 *          as RenderFrame — there is no separate batch renderer.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "TransientBufferPool.hpp"

#include <glm/glm.hpp>
#include <vector>
#include <span>

namespace esengine {

class GfxDevice;
class RenderContext;

namespace resource {
    class ResourceManager;
}

/**
 * @brief Immediate mode 2D drawing API
 *
 * @details Provides a simple API for drawing 2D primitives. All commands
 *          submitted between begin() and end() are batched (per texture) and
 *          drawn in submission order. The buffer is cleared each frame.
 *
 * @code
 * ImmediateDraw draw(device, state, context, resourceManager);
 * draw.init();
 *
 * draw.begin(viewProjection);
 * draw.line({0, 0}, {100, 100}, {1, 0, 0, 1});
 * draw.rect({50, 50}, {30, 30}, {0, 1, 0, 1});
 * draw.circle({150, 150}, 25, {0, 0, 1, 1});
 * draw.end();
 * @endcode
 */
class ImmediateDraw {
public:
    /**
     * @brief Constructs an immediate draw instance
     * @param device  Graphics device (GPU command sink)
     * @param context Render context for shared resources (white texture)
     * @param resource_manager Resource manager for shader access
     */
    ImmediateDraw(GfxDevice& device, RenderContext& context,
                  resource::ResourceManager& resource_manager);
    ~ImmediateDraw();

    ImmediateDraw(const ImmediateDraw&) = delete;
    ImmediateDraw& operator=(const ImmediateDraw&) = delete;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    void init();
    void shutdown();

    // =========================================================================
    // Frame Management
    // =========================================================================

    /** @brief Begins a new draw frame */
    void begin(const glm::mat4& viewProjection);

    /** @brief Ends the frame and submits all draw commands */
    void end();

    /**
     * @brief Flushes pending draw commands without ending the frame
     * @details Use before operations that change GL state to ensure accumulated
     *          primitives are rendered with the correct state.
     */
    void flush();

    // =========================================================================
    // Line Drawing
    // =========================================================================

    void line(const glm::vec2& from, const glm::vec2& to,
              const glm::vec4& color, f32 thickness = 1.0f);

    void polyline(std::span<const glm::vec2> vertices, const glm::vec4& color,
                  f32 thickness = 1.0f, bool closed = false);

    // =========================================================================
    // Rectangle Drawing
    // =========================================================================

    void rect(const glm::vec2& position, const glm::vec2& size,
              const glm::vec4& color, bool filled = true);

    void rectOutline(const glm::vec2& position, const glm::vec2& size,
                     const glm::vec4& color, f32 thickness = 1.0f);

    // =========================================================================
    // Circle Drawing
    // =========================================================================

    void circle(const glm::vec2& center, f32 radius,
                const glm::vec4& color, bool filled = true, i32 segments = 32);

    void circleOutline(const glm::vec2& center, f32 radius,
                       const glm::vec4& color, f32 thickness = 1.0f, i32 segments = 32);

    // =========================================================================
    // Polygon Drawing
    // =========================================================================

    void polygon(std::span<const glm::vec2> vertices, const glm::vec4& color);

    // =========================================================================
    // Texture Drawing
    // =========================================================================

    void texture(const glm::vec2& position, const glm::vec2& size,
                 u32 textureId, const glm::vec4& tint = glm::vec4(1.0f));

    void textureRotated(const glm::vec2& position, const glm::vec2& size,
                        f32 rotation, u32 textureId,
                        const glm::vec4& tint = glm::vec4(1.0f));

    // =========================================================================
    // Configuration
    // =========================================================================

    void setLayer(i32 layer) { currentLayer_ = layer; }
    i32 getLayer() const { return currentLayer_; }
    void setDepth(f32 depth) { currentDepth_ = depth; }
    f32 getDepth() const { return currentDepth_; }

    // =========================================================================
    // Statistics
    // =========================================================================

    u32 getDrawCallCount() const { return drawCallCount_; }
    u32 getPrimitiveCount() const { return primitiveCount_; }

private:
    /** Emits a (optionally rotated) textured quad into the current batch. */
    void emitQuad(const glm::vec2& center, const glm::vec2& size, f32 rotation,
                  const glm::vec4& color, u32 textureId,
                  const glm::vec2& uvOffset = glm::vec2(0.0f),
                  const glm::vec2& uvScale = glm::vec2(1.0f));
    /** Emits a flat triangle (white texture) into the current batch. */
    void emitTriangle(const glm::vec2& p0, const glm::vec2& p1, const glm::vec2& p2,
                      const glm::vec4& color);
    /** Switches the batch texture, flushing first if it changed. */
    void useTexture(u32 textureId);

    GfxDevice& device_;
    RenderContext& context_;
    resource::ResourceManager& resource_manager_;

    TransientBufferPool pool_;
    u32 batch_shader_id_ = 0;
    PipelineHandle pipeline_ = PipelineHandle::Invalid;
    u32 white_texture_id_ = 0;
    u32 currentTexture_ = 0;
    bool pendingGeometry_ = false;

    i32 currentLayer_ = 0;
    f32 currentDepth_ = 0.0f;
    u32 primitiveCount_ = 0;
    u32 drawCallCount_ = 0;
    bool initialized_ = false;
    bool inFrame_ = false;
};

}  // namespace esengine

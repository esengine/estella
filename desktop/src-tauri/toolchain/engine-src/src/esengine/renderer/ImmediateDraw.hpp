/**
 * @file    ImmediateDraw.hpp
 * @brief   Immediate mode 2D drawing API
 * @details Provides simple, immediate mode drawing primitives (lines, rectangles,
 *          circles, polygons) with automatic batching for efficient rendering.
 *          All draw commands are cleared each frame.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"

#include <glm/glm.hpp>
#include <vector>
#include <span>

namespace esengine {

class RenderContext;
class BatchRenderer2D;

namespace resource {
    class ResourceManager;
}

/**
 * @brief Immediate mode 2D drawing API
 *
 * @details Provides a simple API for drawing 2D primitives. All commands
 *          submitted between begin() and end() are batched for efficient
 *          rendering. The draw buffer is automatically cleared each frame.
 *
 * @code
 * ImmediateDraw draw(context, resourceManager);
 * draw.init();
 *
 * // Each frame
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
     * @param context Render context for shared resources
     * @param resource_manager Resource manager for shader/texture access
     */
    ImmediateDraw(RenderContext& context, resource::ResourceManager& resource_manager);
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

    /**
     * @brief Begins a new draw frame
     * @param viewProjection Combined view-projection matrix
     */
    void begin(const glm::mat4& viewProjection);

    /**
     * @brief Ends the frame and submits all draw commands
     */
    void end();

    /**
     * @brief Flushes pending draw commands without ending the frame
     * @details Use this before operations that change GL state (e.g. custom geometry draws)
     *          to ensure accumulated primitives are rendered with the correct state.
     */
    void flush();

    // =========================================================================
    // Line Drawing
    // =========================================================================

    /**
     * @brief Draws a line between two points
     * @param from Start point
     * @param to End point
     * @param color RGBA color
     * @param thickness Line thickness in pixels (default: 1.0)
     */
    void line(const glm::vec2& from, const glm::vec2& to,
              const glm::vec4& color, f32 thickness = 1.0f);

    /**
     * @brief Draws a polyline through multiple points
     * @param vertices Array of points
     * @param color RGBA color
     * @param thickness Line thickness in pixels (default: 1.0)
     * @param closed If true, connects last point to first (default: false)
     */
    void polyline(std::span<const glm::vec2> vertices, const glm::vec4& color,
                  f32 thickness = 1.0f, bool closed = false);

    // =========================================================================
    // Rectangle Drawing
    // =========================================================================

    /**
     * @brief Draws a filled or outlined rectangle
     * @param position Center position
     * @param size Width and height
     * @param color RGBA color
     * @param filled If true, draws filled; if false, draws outline (default: true)
     */
    void rect(const glm::vec2& position, const glm::vec2& size,
              const glm::vec4& color, bool filled = true);

    /**
     * @brief Draws a rectangle outline
     * @param position Center position
     * @param size Width and height
     * @param color RGBA color
     * @param thickness Line thickness in pixels (default: 1.0)
     */
    void rectOutline(const glm::vec2& position, const glm::vec2& size,
                     const glm::vec4& color, f32 thickness = 1.0f);

    // =========================================================================
    // Circle Drawing
    // =========================================================================

    /**
     * @brief Draws a filled or outlined circle
     * @param center Center position
     * @param radius Circle radius
     * @param color RGBA color
     * @param filled If true, draws filled; if false, draws outline (default: true)
     * @param segments Number of segments for approximation (default: 32)
     */
    void circle(const glm::vec2& center, f32 radius,
                const glm::vec4& color, bool filled = true, i32 segments = 32);

    /**
     * @brief Draws a circle outline
     * @param center Center position
     * @param radius Circle radius
     * @param color RGBA color
     * @param thickness Line thickness in pixels (default: 1.0)
     * @param segments Number of segments for approximation (default: 32)
     */
    void circleOutline(const glm::vec2& center, f32 radius,
                       const glm::vec4& color, f32 thickness = 1.0f, i32 segments = 32);

    // =========================================================================
    // Polygon Drawing
    // =========================================================================

    /**
     * @brief Draws a filled polygon
     * @param vertices Array of vertices (must be convex for correct fill)
     * @param color RGBA color
     */
    void polygon(std::span<const glm::vec2> vertices, const glm::vec4& color);

    // =========================================================================
    // Texture Drawing
    // =========================================================================

    /**
     * @brief Draws a textured quad
     * @param position Center position
     * @param size Width and height
     * @param textureId GPU texture handle
     * @param tint Color tint (default: white)
     */
    void texture(const glm::vec2& position, const glm::vec2& size,
                 u32 textureId, const glm::vec4& tint = glm::vec4(1.0f));

    /**
     * @brief Draws a rotated textured quad
     * @param position Center position
     * @param size Width and height
     * @param rotation Rotation angle in radians
     * @param textureId GPU texture handle
     * @param tint Color tint (default: white)
     */
    void textureRotated(const glm::vec2& position, const glm::vec2& size,
                        f32 rotation, u32 textureId,
                        const glm::vec4& tint = glm::vec4(1.0f));

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * @brief Sets the current render layer
     * @param layer Layer index (higher layers render on top)
     */
    void setLayer(i32 layer) { currentLayer_ = layer; }

    /**
     * @brief Gets the current render layer
     * @return Current layer index
     */
    i32 getLayer() const { return currentLayer_; }

    /**
     * @brief Sets the current depth for sorting within a layer
     * @param depth Z depth value
     */
    void setDepth(f32 depth) { currentDepth_ = depth; }

    /**
     * @brief Gets the current depth
     * @return Current depth value
     */
    f32 getDepth() const { return currentDepth_; }

    // =========================================================================
    // Statistics
    // =========================================================================

    u32 getDrawCallCount() const;
    u32 getPrimitiveCount() const { return primitiveCount_; }

private:
    struct Impl;
    Unique<Impl> impl_;

    RenderContext& context_;
    resource::ResourceManager& resource_manager_;

    i32 currentLayer_ = 0;
    f32 currentDepth_ = 0.0f;
    u32 primitiveCount_ = 0;
    bool initialized_ = false;
    bool inFrame_ = false;
};

}  // namespace esengine

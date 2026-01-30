/**
 * @file    UIBatchRenderer.hpp
 * @brief   Batched UI rendering with SDF primitives
 * @details Provides efficient batched rendering of UI elements including
 *          rounded rectangles, text, and textured quads with scissor support.
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

#include "../../core/Types.hpp"
#include "../core/Types.hpp"
#include "../layout/SizeValue.hpp"

#include <glm/glm.hpp>

#include <string>
#include <vector>

namespace esengine {

class RenderContext;

namespace ui {

#if ES_FEATURE_SDF_FONT
class SDFFont;
class MSDFFont;
#endif

#if ES_FEATURE_BITMAP_FONT
class BitmapFont;
#endif

class SystemFont;

#if ES_FEATURE_SDF_FONT
using Font = SDFFont;
#elif ES_FEATURE_BITMAP_FONT
using Font = BitmapFont;
#endif

// =============================================================================
// UI Render Statistics
// =============================================================================

/**
 * @brief Statistics for UI rendering performance analysis
 */
struct UIRenderStats {
    u32 drawCalls = 0;
    u32 quadCount = 0;
    u32 textQuadCount = 0;
    u32 clipChanges = 0;

    void reset() {
        drawCalls = 0;
        quadCount = 0;
        textQuadCount = 0;
        clipChanges = 0;
    }
};

// =============================================================================
// UIBatchRenderer Class
// =============================================================================

/**
 * @brief High-performance batched UI renderer
 *
 * @details Renders UI primitives efficiently using batching and SDF techniques
 *          for smooth rounded rectangles. Supports scissor-based clipping for
 *          nested UI elements.
 *
 * @code
 * UIBatchRenderer renderer(context);
 * renderer.init();
 *
 * renderer.begin(projection);
 * renderer.pushClipRect(panelBounds);
 * renderer.drawRoundedRect(buttonBounds, buttonColor, CornerRadii::all(4.0f));
 * renderer.drawText("Click Me", textPos, font, 14.0f, textColor);
 * renderer.popClipRect();
 * renderer.end();
 * @endcode
 */
class UIBatchRenderer {
public:
    explicit UIBatchRenderer(RenderContext& context);
    ~UIBatchRenderer();

    // Non-copyable
    UIBatchRenderer(const UIBatchRenderer&) = delete;
    UIBatchRenderer& operator=(const UIBatchRenderer&) = delete;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * @brief Initializes rendering resources
     */
    void init();

    /**
     * @brief Releases rendering resources
     */
    void shutdown();

    /**
     * @brief Checks if initialized
     */
    bool isInitialized() const;

    // =========================================================================
    // Frame Management
    // =========================================================================

    /**
     * @brief Begins a UI rendering frame
     * @param projection Orthographic projection matrix
     * @param devicePixelRatio Scale factor for high-DPI displays (default 1.0)
     */
    void begin(const glm::mat4& projection, f32 devicePixelRatio = 1.0f);

    /**
     * @brief Ends the UI rendering frame and flushes all batches
     */
    void end();

    /**
     * @brief Flushes the current batch to the GPU
     */
    void flush();

    // =========================================================================
    // Clipping
    // =========================================================================

    /**
     * @brief Pushes a clip rectangle onto the stack
     * @param rect The clip region (intersected with current clip)
     */
    void pushClipRect(const Rect& rect);

    /**
     * @brief Pops the top clip rectangle from the stack
     */
    void popClipRect();

    /**
     * @brief Gets the current clip rectangle
     * @return Current clip rect (empty if no clipping)
     */
    Rect getCurrentClipRect() const;

    // =========================================================================
    // Primitive Drawing
    // =========================================================================

    /**
     * @brief Draws a solid rectangle
     * @param rect Rectangle bounds
     * @param color Fill color (RGBA)
     */
    void drawRect(const Rect& rect, const glm::vec4& color);

    /**
     * @brief Draws a rounded rectangle
     * @param rect Rectangle bounds
     * @param color Fill color (RGBA)
     * @param radii Corner radii
     */
    void drawRoundedRect(const Rect& rect, const glm::vec4& color, const CornerRadii& radii);

    /**
     * @brief Draws a rounded rectangle outline
     * @param rect Rectangle bounds
     * @param color Stroke color (RGBA)
     * @param radii Corner radii
     * @param thickness Border thickness in pixels
     */
    void drawRoundedRectOutline(const Rect& rect, const glm::vec4& color, const CornerRadii& radii,
                                 f32 thickness);

    /**
     * @brief Draws a textured rectangle
     * @param rect Rectangle bounds
     * @param textureId GPU texture handle
     * @param tint Tint color (default white)
     * @param uvMin UV coordinates for top-left (default 0,0)
     * @param uvMax UV coordinates for bottom-right (default 1,1)
     */
    void drawTexturedRect(const Rect& rect, u32 textureId, const glm::vec4& tint = {1, 1, 1, 1},
                          const glm::vec2& uvMin = {0, 0}, const glm::vec2& uvMax = {1, 1});

    /**
     * @brief Draws a line between two points
     * @param p1 Start point
     * @param p2 End point
     * @param color Line color
     * @param thickness Line thickness
     */
    void drawLine(const glm::vec2& p1, const glm::vec2& p2, const glm::vec4& color,
                  f32 thickness = 1.0f);

    // =========================================================================
    // Text Drawing
    // =========================================================================

#if ES_FEATURE_SDF_FONT
    /**
     * @brief Draws text using SDF font (UTF-8 supported)
     */
    void drawText(const std::string& text, const glm::vec2& position, SDFFont& font, f32 fontSize,
                  const glm::vec4& color);

    void drawTextInBounds(const std::string& text, const Rect& bounds, SDFFont& font, f32 fontSize,
                          const glm::vec4& color, HAlign hAlign = HAlign::Left,
                          VAlign vAlign = VAlign::Top);

    /**
     * @brief Draws text using MSDF font for sharper rendering (UTF-8 supported)
     */
    void drawText(const std::string& text, const glm::vec2& position, MSDFFont& font, f32 fontSize,
                  const glm::vec4& color);

    void drawTextInBounds(const std::string& text, const Rect& bounds, MSDFFont& font, f32 fontSize,
                          const glm::vec4& color, HAlign hAlign = HAlign::Left,
                          VAlign vAlign = VAlign::Top);
#endif

#if ES_FEATURE_BITMAP_FONT
    /**
     * @brief Draws text using bitmap font (UTF-8 supported)
     */
    void drawText(const std::string& text, const glm::vec2& position, BitmapFont& font, f32 fontSize,
                  const glm::vec4& color);

    void drawTextInBounds(const std::string& text, const Rect& bounds, BitmapFont& font, f32 fontSize,
                          const glm::vec4& color, HAlign hAlign = HAlign::Left,
                          VAlign vAlign = VAlign::Top);
#endif

    void drawText(const std::string& text, const glm::vec2& position, SystemFont& font, f32 fontSize,
                  const glm::vec4& color);

    void drawTextInBounds(const std::string& text, const Rect& bounds, SystemFont& font, f32 fontSize,
                          const glm::vec4& color, HAlign hAlign = HAlign::Left,
                          VAlign vAlign = VAlign::Top);

    // =========================================================================
    // Statistics
    // =========================================================================

    /**
     * @brief Gets rendering statistics for the current frame
     */
    const UIRenderStats& getStats() const;

    /**
     * @brief Resets statistics counters
     */
    void resetStats();

private:
    struct BatchData;

    void flushQuadBatch();
    void flushTextBatch();
    void applyScissor();
    void addQuadVertices(const Rect& rect, const glm::vec4& color, const glm::vec4& radii,
                          f32 borderThickness, u32 textureIndex, const glm::vec2& uvMin,
                          const glm::vec2& uvMax);

    RenderContext& context_;
    Unique<BatchData> data_;
};

}  // namespace ui
}  // namespace esengine

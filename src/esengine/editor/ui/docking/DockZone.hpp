/**
 * @file    DockZone.hpp
 * @brief   Drop zone detection for docking drag-and-drop
 * @details Handles detection of drop zones and rendering of
 *          drop zone indicators and preview.
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

#include "DockTypes.hpp"
#include "../../../ui/core/Types.hpp"

#include <glm/glm.hpp>

#include <vector>

namespace esengine::ui {

// Forward declarations
class DockNode;
class DockPanel;
class DockArea;
class UIBatchRenderer;

// =============================================================================
// DockDropTarget
// =============================================================================

/**
 * @brief Information about a potential drop target
 */
struct DockDropTarget {
    DockDropZone zone = DockDropZone::None;
    DockNode* targetNode = nullptr;
    Rect previewBounds;
    f32 splitRatio = 0.3f;
};

// =============================================================================
// DockZoneOverlay
// =============================================================================

/**
 * @brief Visual overlay for a dock zone indicator
 */
struct DockZoneOverlay {
    Rect bounds;
    DockDropZone zone;
    bool hovered = false;
};

// =============================================================================
// DockZoneDetector Class
// =============================================================================

/**
 * @brief Detects drop zones and renders drag feedback
 *
 * @details During a drag operation, the detector:
 *          - Tracks the current mouse position
 *          - Determines valid drop zones based on cursor location
 *          - Calculates preview bounds for visual feedback
 *          - Renders zone indicators and drop preview
 */
class DockZoneDetector {
public:
    /**
     * @brief Constructs a zone detector for a dock area
     * @param area The owning DockArea
     */
    explicit DockZoneDetector(DockArea* area);

    // =========================================================================
    // Drag Operations
    // =========================================================================

    /**
     * @brief Begin a drag operation
     * @param panel The panel being dragged
     * @param startPos Initial mouse position
     */
    void beginDrag(DockPanel* panel, const glm::vec2& startPos);

    /**
     * @brief Update drag with current mouse position
     * @param pos Current mouse position
     */
    void updateDrag(const glm::vec2& pos);

    /**
     * @brief End drag and return the final drop target
     * @return Drop target (zone may be None if cancelled)
     */
    DockDropTarget endDrag();

    /**
     * @brief Cancel the current drag operation
     */
    void cancelDrag();

    /** @brief Returns true if currently dragging */
    bool isDragging() const { return dragging_; }

    /** @brief Gets the panel being dragged */
    DockPanel* getDraggedPanel() const { return draggedPanel_; }

    // =========================================================================
    // Target Information
    // =========================================================================

    /** @brief Gets the current drop target */
    const DockDropTarget& getCurrentTarget() const { return currentTarget_; }

    /** @brief Gets all zone overlays for rendering */
    const std::vector<DockZoneOverlay>& getZoneOverlays() const { return zoneOverlays_; }

    // =========================================================================
    // Rendering
    // =========================================================================

    /**
     * @brief Render drop zone indicators and preview
     * @param renderer UI batch renderer
     */
    void render(UIBatchRenderer& renderer);

    // =========================================================================
    // Configuration
    // =========================================================================

    /** @brief Sets the zone indicator button size */
    void setZoneSize(f32 size) { zoneSize_ = size; }

    /** @brief Sets the preview overlay opacity */
    void setPreviewAlpha(f32 alpha) { previewAlpha_ = alpha; }

    /** @brief Sets the edge detection threshold (fraction of node size) */
    void setEdgeThreshold(f32 threshold) { edgeThreshold_ = threshold; }

private:
    DockDropZone detectZoneAtPosition(const glm::vec2& pos, DockNode*& outNode);
    void calculateZoneOverlays(DockNode* targetNode);
    Rect calculatePreviewBounds(const DockDropTarget& target);
    void renderZoneOverlays(UIBatchRenderer& renderer);
    void renderDropPreview(UIBatchRenderer& renderer);
    void renderZoneButton(UIBatchRenderer& renderer, const DockZoneOverlay& overlay);

    DockArea* area_;
    DockPanel* draggedPanel_ = nullptr;
    bool dragging_ = false;

    glm::vec2 dragStartPos_{0.0f};
    glm::vec2 dragCurrentPos_{0.0f};

    DockDropTarget currentTarget_;
    std::vector<DockZoneOverlay> zoneOverlays_;

    f32 zoneSize_ = 32.0f;
    f32 previewAlpha_ = 0.3f;
    f32 edgeThreshold_ = 0.3f;
};

}  // namespace esengine::ui

/**
 * @file    DockZone.cpp
 * @brief   DockZoneDetector implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "DockZone.hpp"
#include "DockArea.hpp"
#include "DockNode.hpp"
#include "DockPanel.hpp"
#include "../UIContext.hpp"
#include "../rendering/UIBatchRenderer.hpp"

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

DockZoneDetector::DockZoneDetector(DockArea* area)
    : area_(area) {}

// =============================================================================
// Drag Operations
// =============================================================================

void DockZoneDetector::beginDrag(DockPanel* panel, const glm::vec2& startPos) {
    draggedPanel_ = panel;
    dragStartPos_ = startPos;
    dragCurrentPos_ = startPos;
    dragging_ = true;
    currentTarget_ = {};
    zoneOverlays_.clear();
}

void DockZoneDetector::updateDrag(const glm::vec2& pos) {
    if (!dragging_) return;

    dragCurrentPos_ = pos;

    DockNode* targetNode = nullptr;
    DockDropZone zone = detectZoneAtPosition(pos, targetNode);

    currentTarget_.zone = zone;
    currentTarget_.targetNode = targetNode;

    if (zone != DockDropZone::None && targetNode) {
        currentTarget_.previewBounds = calculatePreviewBounds(currentTarget_);
        calculateZoneOverlays(targetNode);
    } else {
        zoneOverlays_.clear();
    }
}

DockDropTarget DockZoneDetector::endDrag() {
    DockDropTarget result = currentTarget_;
    dragging_ = false;
    draggedPanel_ = nullptr;
    currentTarget_ = {};
    zoneOverlays_.clear();
    return result;
}

void DockZoneDetector::cancelDrag() {
    dragging_ = false;
    draggedPanel_ = nullptr;
    currentTarget_ = {};
    zoneOverlays_.clear();
}

// =============================================================================
// Zone Detection
// =============================================================================

DockDropZone DockZoneDetector::detectZoneAtPosition(const glm::vec2& pos, DockNode*& outNode) {
    outNode = nullptr;

    if (!area_) return DockDropZone::None;

    DockNode* root = area_->getRootNode();
    if (!root) return DockDropZone::None;

    DockNode* hitNode = nullptr;
    root->forEachLeaf([&](DockNode& node) {
        if (node.getBounds().contains(pos)) {
            hitNode = &node;
        }
    });

    if (!hitNode) {
        if (root->getBounds().contains(pos)) {
            hitNode = root;
        } else {
            return DockDropZone::None;
        }
    }

    outNode = hitNode;
    const Rect& bounds = hitNode->getBounds();

    f32 relX = (pos.x - bounds.x) / bounds.width;
    f32 relY = (pos.y - bounds.y) / bounds.height;

    if (relX < edgeThreshold_) return DockDropZone::Left;
    if (relX > (1.0f - edgeThreshold_)) return DockDropZone::Right;
    if (relY < edgeThreshold_) return DockDropZone::Top;
    if (relY > (1.0f - edgeThreshold_)) return DockDropZone::Bottom;

    return DockDropZone::Center;
}

// =============================================================================
// Zone Overlays
// =============================================================================

void DockZoneDetector::calculateZoneOverlays(DockNode* targetNode) {
    zoneOverlays_.clear();

    if (!targetNode) return;

    const Rect& bounds = targetNode->getBounds();
    f32 cx = bounds.x + bounds.width * 0.5f;
    f32 cy = bounds.y + bounds.height * 0.5f;
    f32 halfZone = zoneSize_ * 0.5f;
    f32 offset = zoneSize_ + 4.0f;

    DockZoneOverlay centerOverlay;
    centerOverlay.zone = DockDropZone::Center;
    centerOverlay.bounds = Rect{cx - halfZone, cy - halfZone, zoneSize_, zoneSize_};
    centerOverlay.hovered = (currentTarget_.zone == DockDropZone::Center);
    zoneOverlays_.push_back(centerOverlay);

    DockZoneOverlay leftOverlay;
    leftOverlay.zone = DockDropZone::Left;
    leftOverlay.bounds = Rect{cx - halfZone - offset, cy - halfZone, zoneSize_, zoneSize_};
    leftOverlay.hovered = (currentTarget_.zone == DockDropZone::Left);
    zoneOverlays_.push_back(leftOverlay);

    DockZoneOverlay rightOverlay;
    rightOverlay.zone = DockDropZone::Right;
    rightOverlay.bounds = Rect{cx + halfZone + 4.0f, cy - halfZone, zoneSize_, zoneSize_};
    rightOverlay.hovered = (currentTarget_.zone == DockDropZone::Right);
    zoneOverlays_.push_back(rightOverlay);

    DockZoneOverlay topOverlay;
    topOverlay.zone = DockDropZone::Top;
    topOverlay.bounds = Rect{cx - halfZone, cy - halfZone - offset, zoneSize_, zoneSize_};
    topOverlay.hovered = (currentTarget_.zone == DockDropZone::Top);
    zoneOverlays_.push_back(topOverlay);

    DockZoneOverlay bottomOverlay;
    bottomOverlay.zone = DockDropZone::Bottom;
    bottomOverlay.bounds = Rect{cx - halfZone, cy + halfZone + 4.0f, zoneSize_, zoneSize_};
    bottomOverlay.hovered = (currentTarget_.zone == DockDropZone::Bottom);
    zoneOverlays_.push_back(bottomOverlay);
}

Rect DockZoneDetector::calculatePreviewBounds(const DockDropTarget& target) {
    if (!target.targetNode) return {};

    const Rect& bounds = target.targetNode->getBounds();
    f32 ratio = target.splitRatio;

    switch (target.zone) {
        case DockDropZone::Left:
            return Rect{bounds.x, bounds.y, bounds.width * ratio, bounds.height};

        case DockDropZone::Right:
            return Rect{
                bounds.x + bounds.width * (1.0f - ratio),
                bounds.y,
                bounds.width * ratio,
                bounds.height
            };

        case DockDropZone::Top:
            return Rect{bounds.x, bounds.y, bounds.width, bounds.height * ratio};

        case DockDropZone::Bottom:
            return Rect{
                bounds.x,
                bounds.y + bounds.height * (1.0f - ratio),
                bounds.width,
                bounds.height * ratio
            };

        case DockDropZone::Center:
            return bounds;

        default:
            return {};
    }
}

// =============================================================================
// Rendering
// =============================================================================

void DockZoneDetector::render(UIBatchRenderer& renderer) {
    if (!dragging_) return;

    renderDropPreview(renderer);
    renderZoneOverlays(renderer);
}

void DockZoneDetector::renderDropPreview(UIBatchRenderer& renderer) {
    if (currentTarget_.zone == DockDropZone::None) return;

    UIContext* ctx = area_ ? area_->getContext() : nullptr;
    if (!ctx) return;

    glm::vec4 previewColor = ctx->getTheme().colors.accent;
    previewColor.a = previewAlpha_;

    renderer.drawRect(currentTarget_.previewBounds, previewColor);
}

void DockZoneDetector::renderZoneOverlays(UIBatchRenderer& renderer) {
    for (const auto& overlay : zoneOverlays_) {
        renderZoneButton(renderer, overlay);
    }
}

void DockZoneDetector::renderZoneButton(UIBatchRenderer& renderer, const DockZoneOverlay& overlay) {
    UIContext* ctx = area_ ? area_->getContext() : nullptr;
    if (!ctx) return;

    const Theme& theme = ctx->getTheme();

    glm::vec4 bgColor = overlay.hovered
                            ? theme.colors.accent
                            : glm::vec4{0.3f, 0.3f, 0.3f, 0.9f};

    glm::vec4 borderColor = theme.colors.accent;

    renderer.drawRoundedRect(overlay.bounds, bgColor, CornerRadii::all(4.0f));
    renderer.drawRoundedRectOutline(overlay.bounds, borderColor, CornerRadii::all(4.0f), 1.0f);

    glm::vec4 iconColor = overlay.hovered
                              ? theme.colors.textPrimary
                              : theme.colors.textSecondary;

    f32 cx = overlay.bounds.x + overlay.bounds.width * 0.5f;
    f32 cy = overlay.bounds.y + overlay.bounds.height * 0.5f;
    f32 iconSize = zoneSize_ * 0.4f;
    f32 halfIcon = iconSize * 0.5f;

    switch (overlay.zone) {
        case DockDropZone::Center: {
            Rect iconRect{cx - halfIcon, cy - halfIcon, iconSize, iconSize};
            renderer.drawRoundedRectOutline(iconRect, iconColor, CornerRadii::all(2.0f), 1.5f);
            break;
        }

        case DockDropZone::Left: {
            Rect leftRect{cx - halfIcon, cy - halfIcon, iconSize * 0.4f, iconSize};
            renderer.drawRect(leftRect, iconColor);
            Rect rightRect{cx - halfIcon + iconSize * 0.5f, cy - halfIcon, iconSize * 0.5f, iconSize};
            renderer.drawRoundedRectOutline(rightRect, iconColor, CornerRadii::all(1.0f), 1.0f);
            break;
        }

        case DockDropZone::Right: {
            Rect leftRect{cx - halfIcon, cy - halfIcon, iconSize * 0.5f, iconSize};
            renderer.drawRoundedRectOutline(leftRect, iconColor, CornerRadii::all(1.0f), 1.0f);
            Rect rightRect{cx + halfIcon - iconSize * 0.4f, cy - halfIcon, iconSize * 0.4f, iconSize};
            renderer.drawRect(rightRect, iconColor);
            break;
        }

        case DockDropZone::Top: {
            Rect topRect{cx - halfIcon, cy - halfIcon, iconSize, iconSize * 0.4f};
            renderer.drawRect(topRect, iconColor);
            Rect bottomRect{cx - halfIcon, cy - halfIcon + iconSize * 0.5f, iconSize, iconSize * 0.5f};
            renderer.drawRoundedRectOutline(bottomRect, iconColor, CornerRadii::all(1.0f), 1.0f);
            break;
        }

        case DockDropZone::Bottom: {
            Rect topRect{cx - halfIcon, cy - halfIcon, iconSize, iconSize * 0.5f};
            renderer.drawRoundedRectOutline(topRect, iconColor, CornerRadii::all(1.0f), 1.0f);
            Rect bottomRect{cx - halfIcon, cy + halfIcon - iconSize * 0.4f, iconSize, iconSize * 0.4f};
            renderer.drawRect(bottomRect, iconColor);
            break;
        }

        default:
            break;
    }
}

}  // namespace esengine::ui

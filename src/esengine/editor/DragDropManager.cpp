/**
 * @file    DragDropManager.cpp
 * @brief   Drag-and-drop manager implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "DragDropManager.hpp"

#include <cmath>

namespace esengine::editor {

// =============================================================================
// Drag Operations
// =============================================================================

void DragDropManager::beginDrag(const DragDropPayload& payload, const glm::vec2& startPos) {
    if (isDragging_) {
        return;
    }

    pendingPayload_ = payload;
    startPos_ = startPos;
    currentPos_ = startPos;
}

void DragDropManager::updateDrag(const glm::vec2& currentPos) {
    currentPos_ = currentPos;

    if (pendingPayload_.has_value() && !isDragging_) {
        f32 distance = glm::length(currentPos_ - startPos_);
        if (distance >= DRAG_THRESHOLD) {
            isDragging_ = true;
            activePayload_ = *pendingPayload_;
            pendingPayload_.reset();
            onDragStart.publish(activePayload_);
        }
    }

    if (isDragging_) {
        onDragMove.publish(activePayload_, currentPos_);
    }
}

void DragDropManager::endDrag(const glm::vec2& pos) {
    currentPos_ = pos;

    if (isDragging_) {
        onDragEnd.publish(activePayload_, pos);
        isDragging_ = false;
        activePayload_ = {};
    }

    pendingPayload_.reset();
}

void DragDropManager::cancelDrag() {
    if (isDragging_) {
        onDragCancel.publish();
    }

    isDragging_ = false;
    activePayload_ = {};
    pendingPayload_.reset();
}

// =============================================================================
// Accessors
// =============================================================================

const DragDropPayload* DragDropManager::getPayload() const {
    if (isDragging_) {
        return &activePayload_;
    }
    return nullptr;
}

}  // namespace esengine::editor

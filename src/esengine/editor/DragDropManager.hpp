#pragma once

#include "DragDropTypes.hpp"
#include "../events/Signal.hpp"

#include <glm/glm.hpp>

#include <optional>

namespace esengine::editor {

class DragDropManager {
public:
    static constexpr f32 DRAG_THRESHOLD = 5.0f;

    DragDropManager() = default;
    ~DragDropManager() = default;

    void beginDrag(const DragDropPayload& payload, const glm::vec2& startPos);
    void updateDrag(const glm::vec2& currentPos);
    void endDrag(const glm::vec2& pos);
    void cancelDrag();

    bool isDragging() const { return isDragging_; }
    bool hasPendingDrag() const { return pendingPayload_.has_value(); }

    const DragDropPayload* getPayload() const;
    glm::vec2 getDragPosition() const { return currentPos_; }
    glm::vec2 getDragStartPosition() const { return startPos_; }
    glm::vec2 getDragDelta() const { return currentPos_ - startPos_; }

    Signal<void(const DragDropPayload&)> onDragStart;
    Signal<void(const DragDropPayload&, const glm::vec2&)> onDragMove;
    Signal<void(const DragDropPayload&, const glm::vec2&)> onDragEnd;
    Signal<void()> onDragCancel;

private:
    bool isDragging_ = false;
    std::optional<DragDropPayload> pendingPayload_;
    DragDropPayload activePayload_;
    glm::vec2 startPos_{0.0f};
    glm::vec2 currentPos_{0.0f};
};

}  // namespace esengine::editor

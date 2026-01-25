/**
 * @file    Input.cpp
 * @brief   Input system implementation
 * @details Manages touch, mouse, and keyboard input state tracking.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Input.hpp"
#include "../../core/Log.hpp"

namespace esengine {

// Static member definitions
std::array<TouchState, MAX_TOUCH_POINTS> Input::touchStates_;
std::array<TouchState, MAX_TOUCH_POINTS> Input::prevTouchStates_;
std::unordered_map<u32, bool> Input::keyStates_;
std::unordered_map<u32, bool> Input::prevKeyStates_;
glm::vec2 Input::mousePosition_{0.0f};
glm::vec2 Input::scrollDelta_{0.0f};

void Input::init() {
    for (auto& state : touchStates_) {
        state = TouchState{};
    }
    for (auto& state : prevTouchStates_) {
        state = TouchState{};
    }
    keyStates_.clear();
    prevKeyStates_.clear();
    mousePosition_ = glm::vec2(0.0f);
    scrollDelta_ = glm::vec2(0.0f);

    ES_LOG_INFO("Input system initialized");
}

void Input::shutdown() {
    ES_LOG_INFO("Input system shutdown");
}

void Input::update() {
    // Store previous frame's state
    prevTouchStates_ = touchStates_;
    prevKeyStates_ = keyStates_;

    // Clear per-frame values
    scrollDelta_ = glm::vec2(0.0f);
}

// Touch input
bool Input::isTouchDown(u32 index) {
    if (index >= MAX_TOUCH_POINTS) return false;
    return touchStates_[index].active;
}

bool Input::isTouchPressed(u32 index) {
    if (index >= MAX_TOUCH_POINTS) return false;
    return touchStates_[index].active && !prevTouchStates_[index].active;
}

bool Input::isTouchReleased(u32 index) {
    if (index >= MAX_TOUCH_POINTS) return false;
    return !touchStates_[index].active && prevTouchStates_[index].active;
}

glm::vec2 Input::getTouchPosition(u32 index) {
    if (index >= MAX_TOUCH_POINTS) return glm::vec2(0.0f);
    return glm::vec2(touchStates_[index].x, touchStates_[index].y);
}

glm::vec2 Input::getTouchDelta(u32 index) {
    if (index >= MAX_TOUCH_POINTS) return glm::vec2(0.0f);
    const auto& state = touchStates_[index];
    return glm::vec2(state.x - state.startX, state.y - state.startY);
}

u32 Input::getTouchCount() {
    u32 count = 0;
    for (const auto& state : touchStates_) {
        if (state.active) ++count;
    }
    return count;
}

// Keyboard input
bool Input::isKeyDown(KeyCode key) {
    auto it = keyStates_.find(static_cast<u32>(key));
    return it != keyStates_.end() && it->second;
}

bool Input::isKeyPressed(KeyCode key) {
    u32 keyCode = static_cast<u32>(key);
    bool current = keyStates_.count(keyCode) && keyStates_[keyCode];
    bool previous = prevKeyStates_.count(keyCode) && prevKeyStates_[keyCode];
    return current && !previous;
}

bool Input::isKeyReleased(KeyCode key) {
    u32 keyCode = static_cast<u32>(key);
    bool current = keyStates_.count(keyCode) && keyStates_[keyCode];
    bool previous = prevKeyStates_.count(keyCode) && prevKeyStates_[keyCode];
    return !current && previous;
}

// Mouse input
glm::vec2 Input::getMousePosition() {
    return mousePosition_;
}

bool Input::isMouseButtonDown(u32 button) {
    // Mouse button 0 is treated as touch 0
    if (button == 0) {
        return isTouchDown(0);
    }
    return false;
}

// Event handlers
void Input::onTouchEvent(TouchType type, const TouchPoint& point) {
    // Find or allocate touch slot
    u32 index = MAX_TOUCH_POINTS;

    // Find existing touch with this ID
    for (u32 i = 0; i < MAX_TOUCH_POINTS; ++i) {
        if (touchStates_[i].active && static_cast<i32>(i) == point.id) {
            index = i;
            break;
        }
    }

    // If new touch, find empty slot
    if (index == MAX_TOUCH_POINTS && type == TouchType::Begin) {
        for (u32 i = 0; i < MAX_TOUCH_POINTS; ++i) {
            if (!touchStates_[i].active) {
                index = i;
                break;
            }
        }
    }

    if (index >= MAX_TOUCH_POINTS) return;

    auto& state = touchStates_[index];

    switch (type) {
    case TouchType::Begin:
        state.active = true;
        state.x = point.x;
        state.y = point.y;
        state.startX = point.x;
        state.startY = point.y;
        break;

    case TouchType::Move:
        state.x = point.x;
        state.y = point.y;
        break;

    case TouchType::End:
    case TouchType::Cancel:
        state.active = false;
        break;
    }

    // Also update mouse position for debugging
    if (index == 0) {
        mousePosition_ = glm::vec2(point.x, point.y);
    }
}

void Input::onKeyEvent(KeyCode key, bool pressed) {
    keyStates_[static_cast<u32>(key)] = pressed;
}

void Input::onScrollEvent(f32 deltaX, f32 deltaY) {
    scrollDelta_.x += deltaX;
    scrollDelta_.y += deltaY;
}

glm::vec2 Input::getScrollDelta() {
    return scrollDelta_;
}

}  // namespace esengine

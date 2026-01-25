/**
 * @file    UIEvent.hpp
 * @brief   UI event types for input handling
 * @details Defines event structures for mouse, keyboard, scroll, and focus
 *          events used by the UI widget system.
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
#include "../../platform/input/Input.hpp"
#include "../core/Types.hpp"

#include <glm/glm.hpp>

#include <string>

namespace esengine::ui {

// =============================================================================
// Event Phase
// =============================================================================

/**
 * @brief Phase of event propagation
 */
enum class EventPhase : u8 {
    Capture,
    Target,
    Bubble
};

// =============================================================================
// Base Event
// =============================================================================

/**
 * @brief Base class for all UI events
 */
struct UIEvent {
    EventPhase phase = EventPhase::Target;
    bool consumed = false;
    bool propagationStopped = false;

    void consume() { consumed = true; }
    void stopPropagation() { propagationStopped = true; }
};

// =============================================================================
// Mouse Events
// =============================================================================

/**
 * @brief Mouse button event (press/release)
 */
struct MouseButtonEvent : UIEvent {
    MouseButton button = MouseButton::Left;
    bool pressed = false;
    f32 x = 0.0f;
    f32 y = 0.0f;
    bool ctrl = false;
    bool shift = false;
    bool alt = false;

    glm::vec2 position() const { return {x, y}; }
};

/**
 * @brief Mouse movement event
 */
struct MouseMoveEvent : UIEvent {
    f32 x = 0.0f;
    f32 y = 0.0f;
    f32 deltaX = 0.0f;
    f32 deltaY = 0.0f;
    bool leftButton = false;
    bool rightButton = false;
    bool middleButton = false;

    glm::vec2 position() const { return {x, y}; }
    glm::vec2 delta() const { return {deltaX, deltaY}; }
};

/**
 * @brief Mouse enter/leave event
 */
struct MouseEnterEvent : UIEvent {
    f32 x = 0.0f;
    f32 y = 0.0f;

    glm::vec2 position() const { return {x, y}; }
};

/**
 * @brief Mouse leave event
 */
struct MouseLeaveEvent : UIEvent {};

/**
 * @brief Mouse scroll event
 */
struct ScrollEvent : UIEvent {
    f32 deltaX = 0.0f;
    f32 deltaY = 0.0f;
    f32 x = 0.0f;
    f32 y = 0.0f;
    bool ctrl = false;
    bool shift = false;

    glm::vec2 delta() const { return {deltaX, deltaY}; }
    glm::vec2 position() const { return {x, y}; }
};

// =============================================================================
// Keyboard Events
// =============================================================================

/**
 * @brief Key press/release event
 */
struct KeyEvent : UIEvent {
    KeyCode key = KeyCode::Unknown;
    bool pressed = false;
    bool repeat = false;
    bool ctrl = false;
    bool shift = false;
    bool alt = false;
};

/**
 * @brief Text input event (character typed)
 */
struct TextInputEvent : UIEvent {
    std::string text;
    u32 codepoint = 0;
};

// =============================================================================
// Focus Events
// =============================================================================

/**
 * @brief Focus gained event
 */
struct FocusEvent : UIEvent {};

/**
 * @brief Focus lost event
 */
struct BlurEvent : UIEvent {};

// =============================================================================
// Drag Events
// =============================================================================

/**
 * @brief Drag start event
 */
struct DragStartEvent : UIEvent {
    f32 x = 0.0f;
    f32 y = 0.0f;

    glm::vec2 position() const { return {x, y}; }
};

/**
 * @brief Drag move event
 */
struct DragMoveEvent : UIEvent {
    f32 x = 0.0f;
    f32 y = 0.0f;
    f32 deltaX = 0.0f;
    f32 deltaY = 0.0f;

    glm::vec2 position() const { return {x, y}; }
    glm::vec2 delta() const { return {deltaX, deltaY}; }
};

/**
 * @brief Drag end event
 */
struct DragEndEvent : UIEvent {
    f32 x = 0.0f;
    f32 y = 0.0f;

    glm::vec2 position() const { return {x, y}; }
};

}  // namespace esengine::ui

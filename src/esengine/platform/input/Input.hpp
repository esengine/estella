/**
 * @file    Input.hpp
 * @brief   Input state management for touch and keyboard
 * @details Provides a static interface for querying touch, keyboard, and
 *          mouse input state. Tracks current and previous frame states
 *          for detecting pressed/released transitions.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../../core/Types.hpp"
#include "../../math/Math.hpp"
#include "../Platform.hpp"

// Standard library
#include <array>
#include <unordered_map>

namespace esengine {

// =============================================================================
// Constants
// =============================================================================

/** @brief Maximum number of simultaneous touch points supported */
constexpr u32 MAX_TOUCH_POINTS = 10;

// =============================================================================
// Touch State
// =============================================================================

/**
 * @brief State of a single touch point
 *
 * @details Tracks the current position and starting position of a touch
 *          for calculating movement deltas.
 */
struct TouchState {
    /** @brief Whether this touch point is currently active */
    bool active = false;
    /** @brief Current X position */
    f32 x = 0.0f;
    /** @brief Current Y position */
    f32 y = 0.0f;
    /** @brief X position when touch began */
    f32 startX = 0.0f;
    /** @brief Y position when touch began */
    f32 startY = 0.0f;
};

// =============================================================================
// Input Class
// =============================================================================

/**
 * @brief Instance-based input state manager
 *
 * @details Provides query methods for touch, keyboard, and mouse input.
 *          State is updated each frame by calling update(). The platform
 *          layer feeds events via onTouchEvent() and onKeyEvent().
 *
 * @code
 * // Access through Application
 * Input& input = app.getInput();
 *
 * // In game loop
 * input.update();
 *
 * // Check touch input
 * if (input.isTouchPressed()) {
 *     glm::vec2 pos = input.getTouchPosition();
 *     // Handle tap at pos
 * }
 *
 * // Check keyboard
 * if (input.isKeyDown(KeyCode::Space)) {
 *     // Jump
 * }
 * @endcode
 */
class Input {
public:
    Input() = default;
    ~Input() = default;

    // Non-copyable
    Input(const Input&) = delete;
    Input& operator=(const Input&) = delete;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * @brief Initializes the input system
     * @details Clears all input state. Called automatically by Application.
     */
    void init();

    /**
     * @brief Shuts down the input system
     */
    void shutdown();

    /**
     * @brief Updates input state for new frame
     * @details Copies current state to previous state for edge detection.
     *          Must be called once per frame before checking input.
     */
    void update();

    // =========================================================================
    // Touch Input
    // =========================================================================

    /**
     * @brief Checks if a touch point is currently active
     * @param index Touch point index (0 = primary touch)
     * @return True if touch is down
     */
    bool isTouchDown(u32 index = 0) const;

    /**
     * @brief Checks if a touch just started this frame
     * @param index Touch point index
     * @return True if touch began this frame
     */
    bool isTouchPressed(u32 index = 0) const;

    /**
     * @brief Checks if a touch just ended this frame
     * @param index Touch point index
     * @return True if touch ended this frame
     */
    bool isTouchReleased(u32 index = 0) const;

    /**
     * @brief Gets the current position of a touch point
     * @param index Touch point index
     * @return Position in screen coordinates
     */
    glm::vec2 getTouchPosition(u32 index = 0) const;

    /**
     * @brief Gets the movement delta since touch began
     * @param index Touch point index
     * @return (current position - start position)
     */
    glm::vec2 getTouchDelta(u32 index = 0) const;

    /**
     * @brief Gets the number of active touch points
     * @return Count of currently active touches
     */
    u32 getTouchCount() const;

    // =========================================================================
    // Keyboard Input
    // =========================================================================

    /**
     * @brief Checks if a key is currently held down
     * @param key The key code
     * @return True if key is down
     */
    bool isKeyDown(KeyCode key) const;

    /**
     * @brief Checks if a key was just pressed this frame
     * @param key The key code
     * @return True if key was just pressed
     */
    bool isKeyPressed(KeyCode key) const;

    /**
     * @brief Checks if a key was just released this frame
     * @param key The key code
     * @return True if key was just released
     */
    bool isKeyReleased(KeyCode key) const;

    // =========================================================================
    // Mouse Input for web debugging
    // =========================================================================

    /**
     * @brief Gets the current mouse position
     * @return Mouse position in screen coordinates
     *
     * @note Primarily for web/desktop debugging. On touch devices,
     *       use getTouchPosition() instead.
     */
    glm::vec2 getMousePosition() const;

    /**
     * @brief Checks if a mouse button is held down
     * @param button Mouse button index (0 = left, 1 = right, 2 = middle)
     * @return True if button is down
     */
    bool isMouseButtonDown(u32 button = 0) const;

    // =========================================================================
    // Scroll Input
    // =========================================================================

    /**
     * @brief Gets the scroll delta for the current frame
     * @return Scroll delta (x = horizontal, y = vertical)
     */
    glm::vec2 getScrollDelta() const;

    // =========================================================================
    // Platform Interface for internal use
    // =========================================================================

    /**
     * @brief Called by platform on touch events
     * @param type Touch event type
     * @param point Touch point data
     * @note Internal use only - called by Platform implementation
     */
    void onTouchEvent(TouchType type, const TouchPoint& point);

    /**
     * @brief Called by platform on key events
     * @param key Key code
     * @param pressed True if pressed, false if released
     * @note Internal use only - called by Platform implementation
     */
    void onKeyEvent(KeyCode key, bool pressed);

    /**
     * @brief Called by platform on scroll events
     * @param deltaX Horizontal scroll delta
     * @param deltaY Vertical scroll delta
     * @note Internal use only - called by Platform implementation
     */
    void onScrollEvent(f32 deltaX, f32 deltaY);

private:
    /** @brief Current frame touch states */
    std::array<TouchState, MAX_TOUCH_POINTS> touchStates_;
    /** @brief Previous frame touch states */
    std::array<TouchState, MAX_TOUCH_POINTS> prevTouchStates_;

    /** @brief Current frame key states */
    std::unordered_map<u32, bool> keyStates_;
    /** @brief Previous frame key states */
    std::unordered_map<u32, bool> prevKeyStates_;

    /** @brief Current mouse position */
    glm::vec2 mousePosition_;

    /** @brief Current frame scroll delta */
    glm::vec2 scrollDelta_;
};

}  // namespace esengine

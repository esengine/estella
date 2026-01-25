#pragma once

#include "../../core/Types.hpp"
#include "../Platform.hpp"
#include <array>
#include <unordered_map>

namespace esengine {

// Maximum simultaneous touch points
constexpr u32 MAX_TOUCH_POINTS = 10;

// Input state for touch points
struct TouchState {
    bool active = false;
    f32 x = 0.0f;
    f32 y = 0.0f;
    f32 startX = 0.0f;
    f32 startY = 0.0f;
};

// Input manager - handles all input state
class Input {
public:
    static void init();
    static void shutdown();
    static void update();

    // Touch input
    static bool isTouchDown(u32 index = 0);
    static bool isTouchPressed(u32 index = 0);  // Just started this frame
    static bool isTouchReleased(u32 index = 0); // Just ended this frame

    static glm::vec2 getTouchPosition(u32 index = 0);
    static glm::vec2 getTouchDelta(u32 index = 0);  // Movement since touch began
    static u32 getTouchCount();

    // Keyboard input
    static bool isKeyDown(KeyCode key);
    static bool isKeyPressed(KeyCode key);
    static bool isKeyReleased(KeyCode key);

    // Mouse input (for web debugging)
    static glm::vec2 getMousePosition();
    static bool isMouseButtonDown(u32 button = 0);

    // Internal - called by platform
    static void onTouchEvent(TouchType type, const TouchPoint& point);
    static void onKeyEvent(KeyCode key, bool pressed);

private:
    static std::array<TouchState, MAX_TOUCH_POINTS> touchStates_;
    static std::array<TouchState, MAX_TOUCH_POINTS> prevTouchStates_;

    static std::unordered_map<u32, bool> keyStates_;
    static std::unordered_map<u32, bool> prevKeyStates_;

    static glm::vec2 mousePosition_;
};

}  // namespace esengine

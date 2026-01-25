#pragma once

#include "../core/Types.hpp"
#include <functional>

namespace esengine {

// Touch event types
enum class TouchType : u8 {
    Begin = 0,
    Move = 1,
    End = 2,
    Cancel = 3
};

// Touch point data
struct TouchPoint {
    i32 id;
    f32 x;
    f32 y;
};

// Key codes (subset for mobile/web)
enum class KeyCode : u32 {
    Unknown = 0,
    Space = 32,
    Enter = 13,
    Escape = 27,
    Left = 37,
    Up = 38,
    Right = 39,
    Down = 40,
    A = 65,
    D = 68,
    S = 83,
    W = 87
};

// Event callbacks
using TouchCallback = std::function<void(TouchType type, const TouchPoint& point)>;
using KeyCallback = std::function<void(KeyCode key, bool pressed)>;
using ResizeCallback = std::function<void(u32 width, u32 height)>;

// Platform abstraction interface
class Platform {
public:
    virtual ~Platform() = default;

    // Lifecycle
    virtual bool initialize(u32 width, u32 height) = 0;
    virtual void shutdown() = 0;

    // Frame handling
    virtual void pollEvents() = 0;
    virtual void swapBuffers() = 0;

    // Time
    virtual f64 getTime() const = 0;
    virtual f64 getDeltaTime() const = 0;

    // Window properties
    virtual u32 getWindowWidth() const = 0;
    virtual u32 getWindowHeight() const = 0;
    virtual f32 getAspectRatio() const = 0;
    virtual f32 getDevicePixelRatio() const = 0;

    // State
    virtual bool isRunning() const = 0;
    virtual void requestQuit() = 0;

    // Callbacks
    virtual void setTouchCallback(TouchCallback callback) = 0;
    virtual void setKeyCallback(KeyCallback callback) = 0;
    virtual void setResizeCallback(ResizeCallback callback) = 0;

    // Factory
    static Unique<Platform> create();
};

}  // namespace esengine

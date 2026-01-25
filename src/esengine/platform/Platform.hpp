/**
 * @file    Platform.hpp
 * @brief   Platform abstraction layer interface
 * @details Defines the abstract interface for platform-specific functionality
 *          including window management, event handling, and timing.
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
#include "../core/Types.hpp"

// Standard library
#include <functional>

namespace esengine {

// =============================================================================
// Touch Events
// =============================================================================

/**
 * @brief Types of touch events
 */
enum class TouchType : u8 {
    Begin = 0,   ///< Touch started (finger down)
    Move = 1,    ///< Touch moved (finger dragged)
    End = 2,     ///< Touch ended (finger lifted)
    Cancel = 3   ///< Touch cancelled (system interrupted)
};

/**
 * @brief Touch point data
 *
 * @details Contains the position and identifier for a single touch point.
 *          The ID is used to track individual fingers in multi-touch.
 */
struct TouchPoint {
    /** @brief Unique identifier for this touch (for multi-touch tracking) */
    i32 id;
    /** @brief X position in screen coordinates */
    f32 x;
    /** @brief Y position in screen coordinates */
    f32 y;
};

// =============================================================================
// Key Codes
// =============================================================================

/**
 * @brief Keyboard key codes
 *
 * @details Subset of key codes suitable for mobile/web platforms.
 *          Maps to standard JavaScript key codes for web compatibility.
 */
enum class KeyCode : u32 {
    Unknown = 0,
    Space = 32,          ///< Spacebar
    Enter = 13,          ///< Enter/Return
    Escape = 27,         ///< Escape key
    Left = 37,           ///< Left arrow
    Up = 38,             ///< Up arrow
    Right = 39,          ///< Right arrow
    Down = 40,           ///< Down arrow

    // Letter keys
    A = 65,              ///< A key
    D = 68,              ///< D key
    S = 83,              ///< S key
    W = 87,              ///< W key
    Y = 89,              ///< Y key
    Z = 90,              ///< Z key

    // Modifier keys
    LeftShift = 16,      ///< Left Shift key
    RightShift = 161,    ///< Right Shift key
    LeftControl = 17,    ///< Left Control key
    RightControl = 162,  ///< Right Control key
    LeftAlt = 18,        ///< Left Alt key
    RightAlt = 165       ///< Right Alt key
};

// =============================================================================
// Event Callbacks
// =============================================================================

/**
 * @brief Callback type for touch events
 * @param type The type of touch event
 * @param point Touch position and identifier
 */
using TouchCallback = std::function<void(TouchType type, const TouchPoint& point)>;

/**
 * @brief Callback type for keyboard events
 * @param key The key code
 * @param pressed True if pressed, false if released
 */
using KeyCallback = std::function<void(KeyCode key, bool pressed)>;

/**
 * @brief Callback type for window resize events
 * @param width New width in pixels
 * @param height New height in pixels
 */
using ResizeCallback = std::function<void(u32 width, u32 height)>;

// =============================================================================
// Platform Class
// =============================================================================

/**
 * @brief Abstract interface for platform-specific functionality
 *
 * @details Provides a common API for window management, event handling,
 *          and timing across different platforms (Web, Native, etc.).
 *          Implementations exist for specific platforms.
 *
 * @code
 * auto platform = Platform::create();
 * platform->initialize(800, 600);
 *
 * platform->setTouchCallback([](TouchType type, const TouchPoint& pt) {
 *     // Handle touch
 * });
 *
 * while (platform->isRunning()) {
 *     platform->pollEvents();
 *     // Update and render
 *     platform->swapBuffers();
 * }
 *
 * platform->shutdown();
 * @endcode
 */
class Platform {
public:
    /** @brief Virtual destructor for proper cleanup */
    virtual ~Platform() = default;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * @brief Initializes the platform
     * @param width Initial window width in pixels
     * @param height Initial window height in pixels
     * @return True on success
     *
     * @details Creates window/canvas and initializes graphics context.
     */
    virtual bool initialize(u32 width, u32 height) = 0;

    /**
     * @brief Shuts down the platform
     * @details Releases all platform resources and destroys window.
     */
    virtual void shutdown() = 0;

    // =========================================================================
    // Frame Handling
    // =========================================================================

    /**
     * @brief Polls and dispatches pending events
     * @details Should be called once per frame at the start of the loop.
     */
    virtual void pollEvents() = 0;

    /**
     * @brief Swaps front and back buffers
     * @details Presents the rendered frame. Should be called at end of loop.
     */
    virtual void swapBuffers() = 0;

    // =========================================================================
    // Time
    // =========================================================================

    /**
     * @brief Gets time since platform initialization
     * @return Time in seconds (high precision)
     */
    virtual f64 getTime() const = 0;

    /**
     * @brief Gets time since last frame
     * @return Delta time in seconds
     */
    virtual f64 getDeltaTime() const = 0;

    // =========================================================================
    // Window Properties
    // =========================================================================

    /**
     * @brief Gets the window/canvas width
     * @return Width in pixels
     */
    virtual u32 getWindowWidth() const = 0;

    /**
     * @brief Gets the window/canvas height
     * @return Height in pixels
     */
    virtual u32 getWindowHeight() const = 0;

    /**
     * @brief Gets the window aspect ratio
     * @return Width divided by height
     */
    virtual f32 getAspectRatio() const = 0;

    /**
     * @brief Gets the device pixel ratio
     * @return Ratio of physical pixels to CSS pixels (for high-DPI displays)
     */
    virtual f32 getDevicePixelRatio() const = 0;

    // =========================================================================
    // State
    // =========================================================================

    /**
     * @brief Checks if the application should continue running
     * @return True if running, false if quit was requested
     */
    virtual bool isRunning() const = 0;

    /**
     * @brief Requests the application to quit
     * @details Sets a flag that causes isRunning() to return false.
     */
    virtual void requestQuit() = 0;

    // =========================================================================
    // Event Callbacks
    // =========================================================================

    /**
     * @brief Sets the touch event callback
     * @param callback Function to call on touch events
     */
    virtual void setTouchCallback(TouchCallback callback) = 0;

    /**
     * @brief Sets the keyboard event callback
     * @param callback Function to call on key events
     */
    virtual void setKeyCallback(KeyCallback callback) = 0;

    /**
     * @brief Sets the window resize callback
     * @param callback Function to call on resize
     */
    virtual void setResizeCallback(ResizeCallback callback) = 0;

    // =========================================================================
    // Factory
    // =========================================================================

    /**
     * @brief Creates a platform-appropriate implementation
     * @return Unique pointer to the platform instance
     *
     * @details Returns WebPlatform for ES_PLATFORM_WEB, NativePlatform otherwise.
     */
    static Unique<Platform> create();
};

}  // namespace esengine

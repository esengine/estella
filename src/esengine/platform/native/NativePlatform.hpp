/**
 * @file    NativePlatform.hpp
 * @brief   Native desktop platform implementation using GLFW
 * @details Provides window management, OpenGL context, and input handling
 *          for native desktop platforms (Windows, macOS, Linux).
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

// Project includes
#include "../Platform.hpp"

// Forward declarations
struct GLFWwindow;

namespace esengine {

// =============================================================================
// NativePlatform Class
// =============================================================================

/**
 * @brief Native desktop platform implementation using GLFW and OpenGL
 *
 * @details Implements the Platform interface for native desktop environments.
 *          Uses GLFW for window management and event handling, and OpenGL 3.3
 *          Core profile for rendering.
 *
 * Features:
 * - Cross-platform window creation (Windows, macOS, Linux)
 * - OpenGL 3.3 Core profile context
 * - Keyboard and mouse input (mouse emulates touch)
 * - High-DPI display support
 * - VSync support
 *
 * @code
 * auto platform = Platform::create();  // Returns NativePlatform on native builds
 * platform->initialize(1280, 720);
 *
 * while (platform->isRunning()) {
 *     platform->pollEvents();
 *     // Render...
 *     platform->swapBuffers();
 * }
 *
 * platform->shutdown();
 * @endcode
 */
class NativePlatform : public Platform {
public:
    /**
     * @brief Default constructor
     */
    NativePlatform();

    /**
     * @brief Destructor - ensures proper cleanup
     */
    ~NativePlatform() override;

    // Non-copyable
    NativePlatform(const NativePlatform&) = delete;
    NativePlatform& operator=(const NativePlatform&) = delete;

    // =========================================================================
    // Platform Interface Implementation
    // =========================================================================

    /**
     * @brief Initializes GLFW and creates window with OpenGL context
     * @param width Initial window width in pixels
     * @param height Initial window height in pixels
     * @return True on success, false on failure
     */
    bool initialize(u32 width, u32 height) override;

    /**
     * @brief Shuts down GLFW and releases all resources
     */
    void shutdown() override;

    /**
     * @brief Polls GLFW events and dispatches callbacks
     */
    void pollEvents() override;

    /**
     * @brief Swaps front and back buffers
     */
    void swapBuffers() override;

    /**
     * @brief Gets time since initialization
     * @return Time in seconds
     */
    f64 getTime() const override;

    /**
     * @brief Gets time since last frame
     * @return Delta time in seconds
     */
    f64 getDeltaTime() const override;

    /**
     * @brief Gets window width
     * @return Width in pixels
     */
    u32 getWindowWidth() const override;

    /**
     * @brief Gets window height
     * @return Height in pixels
     */
    u32 getWindowHeight() const override;

    /**
     * @brief Gets aspect ratio
     * @return Width / height
     */
    f32 getAspectRatio() const override;

    /**
     * @brief Gets device pixel ratio for high-DPI displays
     * @return Pixel ratio (1.0 for standard, 2.0 for retina, etc.)
     */
    f32 getDevicePixelRatio() const override;

    /**
     * @brief Checks if application should continue running
     * @return True if running
     */
    bool isRunning() const override;

    /**
     * @brief Requests application to quit
     */
    void requestQuit() override;

    /**
     * @brief Sets touch event callback
     * @param callback Function to call on touch/mouse events
     */
    void setTouchCallback(TouchCallback callback) override;

    /**
     * @brief Sets keyboard event callback
     * @param callback Function to call on key events
     */
    void setKeyCallback(KeyCallback callback) override;

    /**
     * @brief Sets window resize callback
     * @param callback Function to call on resize
     */
    void setResizeCallback(ResizeCallback callback) override;

private:
    // =========================================================================
    // GLFW Callbacks
    // =========================================================================

    static void glfwErrorCallback(int error, const char* description);
    static void glfwKeyCallback(GLFWwindow* window, int key, int scancode, int action, int mods);
    static void glfwMouseButtonCallback(GLFWwindow* window, int button, int action, int mods);
    static void glfwCursorPosCallback(GLFWwindow* window, double xpos, double ypos);
    static void glfwScrollCallback(GLFWwindow* window, double xoffset, double yoffset);
    static void glfwFramebufferSizeCallback(GLFWwindow* window, int width, int height);
    static void glfwWindowCloseCallback(GLFWwindow* window);

    // =========================================================================
    // Helper Methods
    // =========================================================================

    /**
     * @brief Converts GLFW key code to ESEngine KeyCode
     */
    static KeyCode convertKeyCode(int glfwKey);

    // =========================================================================
    // Member Variables
    // =========================================================================

    GLFWwindow* window_ = nullptr;        ///< GLFW window handle

    u32 windowWidth_ = 0;                 ///< Window width in pixels
    u32 windowHeight_ = 0;                ///< Window height in pixels
    u32 framebufferWidth_ = 0;            ///< Framebuffer width (for high-DPI)
    u32 framebufferHeight_ = 0;           ///< Framebuffer height (for high-DPI)

    f64 startTime_ = 0.0;                 ///< Time at initialization
    f64 lastFrameTime_ = 0.0;             ///< Time of last frame
    f64 deltaTime_ = 0.0;                 ///< Delta time between frames

    bool running_ = false;                ///< Application running flag
    bool mousePressed_ = false;           ///< Mouse button state for touch emulation
    f64 mouseX_ = 0.0;                    ///< Current mouse X position
    f64 mouseY_ = 0.0;                    ///< Current mouse Y position

    TouchCallback touchCallback_;         ///< Touch/mouse event callback
    KeyCallback keyCallback_;             ///< Keyboard event callback
    ResizeCallback resizeCallback_;       ///< Window resize callback

    static NativePlatform* instance_;     ///< Singleton instance for callbacks
};

}  // namespace esengine

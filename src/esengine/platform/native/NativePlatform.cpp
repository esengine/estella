/**
 * @file    NativePlatform.cpp
 * @brief   Native desktop platform implementation using GLFW
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "NativePlatform.hpp"
#include "../../core/Log.hpp"

#include <glad/glad.h>
#include <GLFW/glfw3.h>

namespace esengine {

// =============================================================================
// Static Member Initialization
// =============================================================================

NativePlatform* NativePlatform::instance_ = nullptr;

// =============================================================================
// Platform Factory
// =============================================================================

Unique<Platform> Platform::create() {
    return makeUnique<NativePlatform>();
}

// =============================================================================
// Constructor / Destructor
// =============================================================================

NativePlatform::NativePlatform() {
    instance_ = this;
}

NativePlatform::~NativePlatform() {
    if (window_) {
        shutdown();
    }
    instance_ = nullptr;
}

// =============================================================================
// Lifecycle
// =============================================================================

bool NativePlatform::initialize(u32 width, u32 height) {
    ES_LOG_INFO("Initializing NativePlatform ({}x{})", width, height);

    // Set error callback before init
    glfwSetErrorCallback(glfwErrorCallback);

    // Initialize GLFW
    if (!glfwInit()) {
        ES_LOG_ERROR("Failed to initialize GLFW");
        return false;
    }

    // Configure OpenGL context
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
#ifdef ES_PLATFORM_MACOS
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
#endif

    // Window hints
    glfwWindowHint(GLFW_RESIZABLE, GLFW_TRUE);
    glfwWindowHint(GLFW_VISIBLE, GLFW_TRUE);
    glfwWindowHint(GLFW_FOCUSED, GLFW_TRUE);
    glfwWindowHint(GLFW_SCALE_TO_MONITOR, GLFW_TRUE);

    // Create window
    window_ = glfwCreateWindow(
        static_cast<int>(width),
        static_cast<int>(height),
        "ESEngine Editor",
        nullptr,
        nullptr
    );

    if (!window_) {
        ES_LOG_ERROR("Failed to create GLFW window");
        glfwTerminate();
        return false;
    }

    // Store window dimensions
    windowWidth_ = width;
    windowHeight_ = height;

    // Get framebuffer size (for high-DPI)
    int fbWidth, fbHeight;
    glfwGetFramebufferSize(window_, &fbWidth, &fbHeight);
    framebufferWidth_ = static_cast<u32>(fbWidth);
    framebufferHeight_ = static_cast<u32>(fbHeight);

    ES_LOG_DEBUG("Window size: {}x{}, Framebuffer size: {}x{}",
                 windowWidth_, windowHeight_, framebufferWidth_, framebufferHeight_);

    // Make OpenGL context current
    glfwMakeContextCurrent(window_);

    // Enable VSync
    glfwSwapInterval(1);

    // Load OpenGL functions via GLAD
    if (!gladLoadGLLoader(reinterpret_cast<GLADloadproc>(glfwGetProcAddress))) {
        ES_LOG_ERROR("Failed to initialize GLAD");
        glfwDestroyWindow(window_);
        glfwTerminate();
        return false;
    }

    // Log OpenGL info
    const auto* version = reinterpret_cast<const char*>(glGetString(GL_VERSION));
    const auto* renderer = reinterpret_cast<const char*>(glGetString(GL_RENDERER));
    ES_LOG_INFO("OpenGL Version: {}", version ? version : "unknown");
    ES_LOG_INFO("OpenGL Renderer: {}", renderer ? renderer : "unknown");

    // Set up callbacks
    glfwSetKeyCallback(window_, glfwKeyCallback);
    glfwSetMouseButtonCallback(window_, glfwMouseButtonCallback);
    glfwSetCursorPosCallback(window_, glfwCursorPosCallback);
    glfwSetScrollCallback(window_, glfwScrollCallback);
    glfwSetFramebufferSizeCallback(window_, glfwFramebufferSizeCallback);
    glfwSetWindowCloseCallback(window_, glfwWindowCloseCallback);

    // Store user pointer for callbacks
    glfwSetWindowUserPointer(window_, this);

    // Initialize timing
    startTime_ = glfwGetTime();
    lastFrameTime_ = startTime_;

    // Set initial viewport
    glViewport(0, 0, static_cast<GLsizei>(framebufferWidth_),
               static_cast<GLsizei>(framebufferHeight_));

    running_ = true;
    ES_LOG_INFO("NativePlatform initialized successfully");

    return true;
}

void NativePlatform::shutdown() {
    ES_LOG_INFO("Shutting down NativePlatform");

    running_ = false;

    if (window_) {
        glfwDestroyWindow(window_);
        window_ = nullptr;
    }

    glfwTerminate();
}

// =============================================================================
// Frame Handling
// =============================================================================

void NativePlatform::pollEvents() {
    // Update delta time
    f64 currentTime = glfwGetTime();
    deltaTime_ = currentTime - lastFrameTime_;
    lastFrameTime_ = currentTime;

    // Poll GLFW events
    glfwPollEvents();

    // Check if window should close
    if (glfwWindowShouldClose(window_)) {
        running_ = false;
    }
}

void NativePlatform::swapBuffers() {
    if (window_) {
        glfwSwapBuffers(window_);
    }
}

// =============================================================================
// Time
// =============================================================================

f64 NativePlatform::getTime() const {
    return glfwGetTime() - startTime_;
}

f64 NativePlatform::getDeltaTime() const {
    return deltaTime_;
}

// =============================================================================
// Window Properties
// =============================================================================

u32 NativePlatform::getWindowWidth() const {
    return windowWidth_;
}

u32 NativePlatform::getWindowHeight() const {
    return windowHeight_;
}

f32 NativePlatform::getAspectRatio() const {
    if (windowHeight_ == 0) return 1.0f;
    return static_cast<f32>(windowWidth_) / static_cast<f32>(windowHeight_);
}

f32 NativePlatform::getDevicePixelRatio() const {
    if (windowWidth_ == 0) return 1.0f;
    return static_cast<f32>(framebufferWidth_) / static_cast<f32>(windowWidth_);
}

// =============================================================================
// State
// =============================================================================

bool NativePlatform::isRunning() const {
    return running_;
}

void NativePlatform::requestQuit() {
    running_ = false;
    if (window_) {
        glfwSetWindowShouldClose(window_, GLFW_TRUE);
    }
}

// =============================================================================
// Event Callbacks
// =============================================================================

void NativePlatform::setTouchCallback(TouchCallback callback) {
    touchCallback_ = std::move(callback);
}

void NativePlatform::setKeyCallback(KeyCallback callback) {
    keyCallback_ = std::move(callback);
}

void NativePlatform::setResizeCallback(ResizeCallback callback) {
    resizeCallback_ = std::move(callback);
}

// =============================================================================
// GLFW Callbacks
// =============================================================================

void NativePlatform::glfwErrorCallback(int error, const char* description) {
    ES_LOG_ERROR("GLFW Error {}: {}", error, description);
}

void NativePlatform::glfwKeyCallback(GLFWwindow* window, int key, int scancode,
                                      int action, int mods) {
    (void)scancode;
    (void)mods;

    auto* platform = static_cast<NativePlatform*>(glfwGetWindowUserPointer(window));
    if (!platform || !platform->keyCallback_) return;

    KeyCode keyCode = convertKeyCode(key);
    if (keyCode != KeyCode::Unknown) {
        bool pressed = (action == GLFW_PRESS || action == GLFW_REPEAT);
        platform->keyCallback_(keyCode, pressed);
    }
}

void NativePlatform::glfwMouseButtonCallback(GLFWwindow* window, int button,
                                              int action, int mods) {
    (void)mods;

    auto* platform = static_cast<NativePlatform*>(glfwGetWindowUserPointer(window));
    if (!platform || !platform->touchCallback_) return;

    // Only handle left mouse button (emulate as touch)
    if (button == GLFW_MOUSE_BUTTON_LEFT) {
        TouchPoint point;
        point.id = 0;  // Mouse is always touch ID 0
        point.x = static_cast<f32>(platform->mouseX_);
        point.y = static_cast<f32>(platform->mouseY_);

        if (action == GLFW_PRESS) {
            platform->mousePressed_ = true;
            platform->touchCallback_(TouchType::Begin, point);
        } else if (action == GLFW_RELEASE) {
            platform->mousePressed_ = false;
            platform->touchCallback_(TouchType::End, point);
        }
    }
}

void NativePlatform::glfwCursorPosCallback(GLFWwindow* window, double xpos, double ypos) {
    auto* platform = static_cast<NativePlatform*>(glfwGetWindowUserPointer(window));
    if (!platform) return;

    platform->mouseX_ = xpos;
    platform->mouseY_ = ypos;

    // Emit move event if mouse is pressed (drag)
    if (platform->mousePressed_ && platform->touchCallback_) {
        TouchPoint point;
        point.id = 0;
        point.x = static_cast<f32>(xpos);
        point.y = static_cast<f32>(ypos);
        platform->touchCallback_(TouchType::Move, point);
    }
}

void NativePlatform::glfwScrollCallback(GLFWwindow* window, double xoffset, double yoffset) {
    (void)window;
    (void)xoffset;
    (void)yoffset;
    // TODO: Could be used for zoom or scroll in editor
}

void NativePlatform::glfwFramebufferSizeCallback(GLFWwindow* window, int width, int height) {
    auto* platform = static_cast<NativePlatform*>(glfwGetWindowUserPointer(window));
    if (!platform) return;

    platform->framebufferWidth_ = static_cast<u32>(width);
    platform->framebufferHeight_ = static_cast<u32>(height);

    // Also update window size
    int winWidth, winHeight;
    glfwGetWindowSize(window, &winWidth, &winHeight);
    platform->windowWidth_ = static_cast<u32>(winWidth);
    platform->windowHeight_ = static_cast<u32>(winHeight);

    // Update viewport
    glViewport(0, 0, width, height);

    // Notify callback
    if (platform->resizeCallback_) {
        platform->resizeCallback_(platform->windowWidth_, platform->windowHeight_);
    }

    ES_LOG_DEBUG("Window resized to {}x{} (framebuffer: {}x{})",
                 platform->windowWidth_, platform->windowHeight_,
                 platform->framebufferWidth_, platform->framebufferHeight_);
}

void NativePlatform::glfwWindowCloseCallback(GLFWwindow* window) {
    auto* platform = static_cast<NativePlatform*>(glfwGetWindowUserPointer(window));
    if (platform) {
        platform->running_ = false;
    }
}

// =============================================================================
// Key Code Conversion
// =============================================================================

KeyCode NativePlatform::convertKeyCode(int glfwKey) {
    switch (glfwKey) {
        case GLFW_KEY_SPACE:       return KeyCode::Space;
        case GLFW_KEY_ENTER:       return KeyCode::Enter;
        case GLFW_KEY_ESCAPE:      return KeyCode::Escape;
        case GLFW_KEY_LEFT:        return KeyCode::Left;
        case GLFW_KEY_UP:          return KeyCode::Up;
        case GLFW_KEY_RIGHT:       return KeyCode::Right;
        case GLFW_KEY_DOWN:        return KeyCode::Down;
        case GLFW_KEY_A:           return KeyCode::A;
        case GLFW_KEY_D:           return KeyCode::D;
        case GLFW_KEY_S:           return KeyCode::S;
        case GLFW_KEY_W:           return KeyCode::W;
        case GLFW_KEY_Y:           return KeyCode::Y;
        case GLFW_KEY_Z:           return KeyCode::Z;
        case GLFW_KEY_LEFT_SHIFT:  return KeyCode::LeftShift;
        case GLFW_KEY_RIGHT_SHIFT: return KeyCode::RightShift;
        case GLFW_KEY_LEFT_CONTROL:  return KeyCode::LeftControl;
        case GLFW_KEY_RIGHT_CONTROL: return KeyCode::RightControl;
        case GLFW_KEY_LEFT_ALT:    return KeyCode::LeftAlt;
        case GLFW_KEY_RIGHT_ALT:   return KeyCode::RightAlt;
        default:                   return KeyCode::Unknown;
    }
}

}  // namespace esengine

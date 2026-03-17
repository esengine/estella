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
#include "../input/Input.hpp"

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

    // Get actual window size (may differ from requested due to DPI scaling)
    int actualWidth, actualHeight;
    glfwGetWindowSize(window_, &actualWidth, &actualHeight);
    windowWidth_ = static_cast<u32>(actualWidth);
    windowHeight_ = static_cast<u32>(actualHeight);

    // Get framebuffer size (for high-DPI)
    int fbWidth, fbHeight;
    glfwGetFramebufferSize(window_, &fbWidth, &fbHeight);
    framebufferWidth_ = static_cast<u32>(fbWidth);
    framebufferHeight_ = static_cast<u32>(fbHeight);

    ES_LOG_DEBUG("Window: {}x{}, Framebuffer: {}x{}",
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
    glfwSetCharCallback(window_, glfwCharCallback);
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

void NativePlatform::setScrollCallback(ScrollCallback callback) {
    scrollCallback_ = std::move(callback);
}

void NativePlatform::setTextInputCallback(TextInputCallback callback) {
    textInputCallback_ = std::move(callback);
}

void NativePlatform::setMouseMoveCallback(MouseMoveCallback callback) {
    mouseMoveCallback_ = std::move(callback);
}

void NativePlatform::setMouseButtonCallback(MouseButtonCallback callback) {
    mouseButtonCallback_ = std::move(callback);
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
    if (!platform) return;

    f32 x = static_cast<f32>(platform->mouseX_);
    f32 y = static_cast<f32>(platform->mouseY_);
    bool pressed = (action == GLFW_PRESS);

    MouseButton mouseBtn;
    switch (button) {
        case GLFW_MOUSE_BUTTON_LEFT:   mouseBtn = MouseButton::Left; break;
        case GLFW_MOUSE_BUTTON_RIGHT:  mouseBtn = MouseButton::Right; break;
        case GLFW_MOUSE_BUTTON_MIDDLE: mouseBtn = MouseButton::Middle; break;
        default: return;
    }

    if (platform->mouseButtonCallback_) {
        platform->mouseButtonCallback_(mouseBtn, pressed, x, y);
    }

    if (button == GLFW_MOUSE_BUTTON_LEFT && platform->touchCallback_) {
        TouchPoint point;
        point.id = 0;
        point.x = x;
        point.y = y;

        if (pressed) {
            platform->mousePressed_ = true;
            platform->touchCallback_(TouchType::Begin, point);
        } else {
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

    if (platform->mouseMoveCallback_) {
        platform->mouseMoveCallback_(static_cast<f32>(xpos), static_cast<f32>(ypos));
    }

    if (platform->mousePressed_ && platform->touchCallback_) {
        TouchPoint point;
        point.id = 0;
        point.x = static_cast<f32>(xpos);
        point.y = static_cast<f32>(ypos);
        platform->touchCallback_(TouchType::Move, point);
    }
}

void NativePlatform::glfwScrollCallback(GLFWwindow* window, double xoffset, double yoffset) {
    auto* platform = static_cast<NativePlatform*>(glfwGetWindowUserPointer(window));
    if (!platform) return;

    if (platform->scrollCallback_) {
        platform->scrollCallback_(static_cast<f32>(xoffset), static_cast<f32>(yoffset),
                                   static_cast<f32>(platform->mouseX_),
                                   static_cast<f32>(platform->mouseY_));
    }
}

void NativePlatform::glfwCharCallback(GLFWwindow* window, unsigned int codepoint) {
    auto* platform = static_cast<NativePlatform*>(glfwGetWindowUserPointer(window));
    if (!platform || !platform->textInputCallback_) return;

    // Convert UTF-32 codepoint to UTF-8 string
    std::string utf8;
    if (codepoint < 0x80) {
        utf8 += static_cast<char>(codepoint);
    } else if (codepoint < 0x800) {
        utf8 += static_cast<char>(0xC0 | (codepoint >> 6));
        utf8 += static_cast<char>(0x80 | (codepoint & 0x3F));
    } else if (codepoint < 0x10000) {
        utf8 += static_cast<char>(0xE0 | (codepoint >> 12));
        utf8 += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F));
        utf8 += static_cast<char>(0x80 | (codepoint & 0x3F));
    } else {
        utf8 += static_cast<char>(0xF0 | (codepoint >> 18));
        utf8 += static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F));
        utf8 += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F));
        utf8 += static_cast<char>(0x80 | (codepoint & 0x3F));
    }

    platform->textInputCallback_(utf8);
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
        case GLFW_KEY_SPACE:         return KeyCode::Space;
        case GLFW_KEY_ENTER:         return KeyCode::Enter;
        case GLFW_KEY_ESCAPE:        return KeyCode::Escape;
        case GLFW_KEY_BACKSPACE:     return KeyCode::Backspace;
        case GLFW_KEY_DELETE:        return KeyCode::Delete;
        case GLFW_KEY_TAB:           return KeyCode::Tab;
        case GLFW_KEY_HOME:          return KeyCode::Home;
        case GLFW_KEY_END:           return KeyCode::End;
        case GLFW_KEY_LEFT:          return KeyCode::Left;
        case GLFW_KEY_UP:            return KeyCode::Up;
        case GLFW_KEY_RIGHT:         return KeyCode::Right;
        case GLFW_KEY_DOWN:          return KeyCode::Down;
        case GLFW_KEY_A:             return KeyCode::A;
        case GLFW_KEY_C:             return KeyCode::C;
        case GLFW_KEY_D:             return KeyCode::D;
        case GLFW_KEY_S:             return KeyCode::S;
        case GLFW_KEY_V:             return KeyCode::V;
        case GLFW_KEY_W:             return KeyCode::W;
        case GLFW_KEY_X:             return KeyCode::X;
        case GLFW_KEY_Y:             return KeyCode::Y;
        case GLFW_KEY_Z:             return KeyCode::Z;
        case GLFW_KEY_LEFT_SHIFT:    return KeyCode::LeftShift;
        case GLFW_KEY_RIGHT_SHIFT:   return KeyCode::RightShift;
        case GLFW_KEY_LEFT_CONTROL:  return KeyCode::LeftControl;
        case GLFW_KEY_RIGHT_CONTROL: return KeyCode::RightControl;
        case GLFW_KEY_LEFT_ALT:      return KeyCode::LeftAlt;
        case GLFW_KEY_RIGHT_ALT:     return KeyCode::RightAlt;
        default:                     return KeyCode::Unknown;
    }
}

}  // namespace esengine

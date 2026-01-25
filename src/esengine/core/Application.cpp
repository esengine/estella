/**
 * @file    Application.cpp
 * @brief   Application base class implementation
 * @details Manages the main game loop, platform integration, and subsystem lifecycle.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Application.hpp"
#include "Log.hpp"
#include "../platform/input/Input.hpp"

#ifdef ES_PLATFORM_WEB
    #include <emscripten.h>
#endif

namespace esengine {

Application* Application::instance_ = nullptr;

Application::Application(const ApplicationConfig& config)
    : config_(config) {
    ES_ASSERT(instance_ == nullptr, "Application already exists");
    instance_ = this;
}

Application::~Application() {
    instance_ = nullptr;
}

void Application::run() {
    init();

#ifdef ES_PLATFORM_WEB
    // Emscripten main loop
    emscripten_set_main_loop_arg(
        [](void* arg) {
            auto* app = static_cast<Application*>(arg);
            app->mainLoop();
        },
        this,
        0,  // Use requestAnimationFrame
        1   // Simulate infinite loop
    );
#else
    // Native main loop
    while (running_ && platform_->isRunning()) {
        mainLoop();
    }
    shutdown();
#endif
}

void Application::quit() {
    running_ = false;
    platform_->requestQuit();

#ifdef ES_PLATFORM_WEB
    emscripten_cancel_main_loop();
    shutdown();
#endif
}

void Application::init() {
    // Initialize logging
    Log::init();
    ES_LOG_INFO("Initializing ESEngine Application: {}", config_.title);

    // Create and initialize platform
    platform_ = Platform::create();
    if (!platform_->initialize(config_.width, config_.height)) {
        ES_LOG_FATAL("Failed to initialize platform");
        return;
    }

    // Set up platform callbacks
    platform_->setTouchCallback([this](TouchType type, const TouchPoint& point) {
        Input::onTouchEvent(type, point);
        onTouch(type, point);
    });

    platform_->setKeyCallback([this](KeyCode key, bool pressed) {
        Input::onKeyEvent(key, pressed);
        onKey(key, pressed);
    });

    platform_->setResizeCallback([this](u32 width, u32 height) {
        config_.width = width;
        config_.height = height;
        if (renderer_) {
            renderer_->setViewport(0, 0, width, height);
        }
        onResize(width, height);
    });

    // Initialize subsystems
    Input::init();

    // Initialize resource manager
    resourceManager_.init();

    // Initialize render context and renderer
    renderContext_ = makeUnique<RenderContext>();
    renderContext_->init();

    renderer_ = makeUnique<Renderer>(*renderContext_);
    renderer_->setViewport(0, 0, config_.width, config_.height);
    renderer_->setClearColor(glm::vec4(0.1f, 0.1f, 0.1f, 1.0f));

    // Initialize systems
    systems_.init(registry_);

    // Call user init
    onInit();

    running_ = true;
    ES_LOG_INFO("Application initialized successfully");
}

void Application::mainLoop() {
    // Update platform (events, timing)
    platform_->pollEvents();
    deltaTime_ = platform_->getDeltaTime();

    // Update input state
    Input::update();

    // Update systems
    systems_.update(registry_, static_cast<f32>(deltaTime_));

    // Call user update
    onUpdate(static_cast<f32>(deltaTime_));

    // Render
    renderer_->beginFrame();
    renderer_->clear();

    // Set up default 2D projection
    f32 width = static_cast<f32>(config_.width);
    f32 height = static_cast<f32>(config_.height);
    glm::mat4 projection = glm::ortho(0.0f, width, height, 0.0f, -1.0f, 1.0f);
    renderer_->beginScene(projection);

    // Call user render
    onRender();

    renderer_->endScene();
    renderer_->endFrame();

    // Swap buffers
    platform_->swapBuffers();
}

void Application::shutdown() {
    ES_LOG_INFO("Shutting down application");

    // Call user shutdown
    onShutdown();

    // Shutdown systems
    systems_.shutdown(registry_);

    // Clear registry
    registry_.clear();

    // Shutdown renderer and context
    renderer_.reset();
    renderContext_.reset();

    // Shutdown resource manager
    resourceManager_.shutdown();

    // Shutdown input
    Input::shutdown();

    // Shutdown platform
    platform_->shutdown();

    Log::shutdown();
}

}  // namespace esengine

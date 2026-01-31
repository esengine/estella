/**
 * @file    App.cpp
 * @brief   ECS-style application framework implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "App.hpp"
#include "../core/Log.hpp"
#include "../renderer/RenderPipeline.hpp"

#ifdef ES_PLATFORM_WEB
#include <emscripten.h>
#include <emscripten/html5.h>
#include <emscripten/val.h>
#endif

namespace esengine {

App* App::instance_ = nullptr;

// =============================================================================
// Constructor / Destructor
// =============================================================================

App::App() : App(AppConfig{}) {}

App::App(const AppConfig& config) : config_(config) {
    ES_ASSERT(instance_ == nullptr, "Only one App instance allowed");
    instance_ = this;
}

App::~App() {
    if (initialized_) {
        shutdown();
    }
    instance_ = nullptr;
}

// =============================================================================
// Builder Methods
// =============================================================================

App& App::setConfig(const AppConfig& config) {
    config_ = config;
    return *this;
}

App& App::addPlugin(Unique<Plugin> plugin) {
    plugins_.push_back(std::move(plugin));
    return *this;
}

App& App::addSystem(Schedule schedule, SystemFn system) {
    systems_[static_cast<usize>(schedule)].push_back(std::move(system));
    return *this;
}

App& App::addStartupSystem(SystemFn system) {
    return addSystem(Schedule::Startup, std::move(system));
}

// =============================================================================
// Lifecycle
// =============================================================================

void App::init() {
    if (initialized_) return;

    ES_LOG_INFO("App initializing...");

    platform_ = Platform::create();
    platform_->initialize(config_.width, config_.height);

    resourceManager_.init();

    renderContext_ = makeUnique<RenderContext>();
    renderContext_->init();

    renderer_ = makeUnique<Renderer>(*renderContext_);

    for (auto& plugin : plugins_) {
        plugin->build(*this);
    }

    initialized_ = true;
    ES_LOG_INFO("App initialized");
}

void App::shutdown() {
    if (!initialized_) return;

    ES_LOG_INFO("App shutting down...");

    renderer_.reset();

    renderContext_->shutdown();
    renderContext_.reset();

    resourceManager_.shutdown();

    platform_->shutdown();
    platform_.reset();

    initialized_ = false;
    ES_LOG_INFO("App shutdown complete");
}

void App::run() {
    init();
    running_ = true;

#ifdef ES_PLATFORM_WEB
    emscripten_set_main_loop_arg(
        [](void* arg) {
            static_cast<App*>(arg)->runFrame();
        },
        this, 0, 1);
#else
    while (running_) {
        runFrame();
    }
    shutdown();
#endif
}

void App::quit() {
    running_ = false;
#ifdef ES_PLATFORM_WEB
    emscripten_cancel_main_loop();
#endif
}

void App::runFrame() {
    static f64 lastTime = 0.0;
    f64 currentTime = platform_->getTime();
    f32 dt = static_cast<f32>(currentTime - lastTime);
    lastTime = currentTime;

    if (dt > 0.1f) dt = 0.1f;

    time_.delta = dt;
    time_.elapsed += dt;
    time_.frameCount++;

    platform_->pollEvents();
    input_.update();

    if (!startupRan_) {
        runSystems(Schedule::Startup);
#ifdef ES_PLATFORM_WEB
        runJSSystems(Schedule::Startup, dt);
#endif
        startupRan_ = true;
    }

    runSystems(Schedule::PreUpdate);

#ifdef ES_PLATFORM_WEB
    runJSSystems(Schedule::Update, dt);
#endif

    runSystems(Schedule::Update);
    runSystems(Schedule::PostUpdate);

    renderer_->beginFrame();
    runSystems(Schedule::PreRender);
    runSystems(Schedule::Render);
    runSystems(Schedule::PostRender);
    renderer_->endFrame();

    platform_->swapBuffers();
}

void App::runSystems(Schedule schedule) {
    auto& systems = systems_[static_cast<usize>(schedule)];
    for (auto& system : systems) {
        system(registry_, time_.delta);
    }
}

#ifdef ES_PLATFORM_WEB
void* App::jsSystemsCallback_ = nullptr;

void App::setJSSystemsCallback(void* callback) {
    jsSystemsCallback_ = callback;
}

void App::runJSSystems(Schedule schedule, f32 dt) {
    if (jsSystemsCallback_) {
        auto& callback = *static_cast<emscripten::val*>(jsSystemsCallback_);
        callback(static_cast<int>(schedule), dt);
    }
}
#endif

}  // namespace esengine

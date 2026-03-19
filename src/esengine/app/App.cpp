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
#include "../platform/FileSystem.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../renderer/GLDevice.hpp"
#include "../renderer/RenderCommand.hpp"

#include <glm/gtc/matrix_transform.hpp>

#ifdef ES_PLATFORM_WEB
#include <emscripten.h>
#include <emscripten/html5.h>
#include <emscripten/val.h>
#endif

namespace esengine {

// =============================================================================
// Constructor / Destructor
// =============================================================================

App::App() : App(AppConfig{}) {}

App::App(const AppConfig& config) : config_(config) {}

App::~App() {
    if (initialized_) {
        shutdown();
    }
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

App& App::addSystem(Schedule schedule, SystemFn system, i32 priority) {
    auto lambdaSys = makeUnique<LambdaSystem>(std::move(system));
    lambdaSys->setPriority(priority);
    system_groups_[static_cast<usize>(schedule)].addSystem(std::move(lambdaSys));
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

    Log::init();
    ES_LOG_INFO("App initializing...");

    FileSystem::init();

    platform_ = Platform::create();
    if (!platform_->initialize(config_.width, config_.height)) {
        ES_LOG_FATAL("Failed to initialize platform");
        return;
    }

    platform_->setTouchCallback([this](TouchType type, const TouchPoint& point) {
        input_.onTouchEvent(type, point);
    });

    platform_->setKeyCallback([this](KeyCode key, bool pressed) {
        input_.onKeyEvent(key, pressed);
    });

    platform_->setScrollCallback([this](f32 deltaX, f32 deltaY, f32 x, f32 y) {
        input_.onScrollEvent(deltaX, deltaY);
        (void)x; (void)y;
    });

    platform_->setResizeCallback([this](u32 width, u32 height) {
        config_.width = width;
        config_.height = height;
        if (renderer_) {
            renderer_->setViewport(0, 0, width, height);
        }
    });

    input_.init();

    resourceManager_.init();

    gfxDevice_ = makeUnique<GLDevice>();
    RenderCommand::setDevice(gfxDevice_.get());

    renderContext_ = makeUnique<RenderContext>();
    renderContext_->init();

    renderer_ = makeUnique<Renderer>(*renderContext_);
    renderer_->setViewport(0, 0, config_.width, config_.height);

    services_.registerService<Platform>(platform_.get());
    services_.registerService<ecs::Registry>(&registry_);
    services_.registerService<resource::ResourceManager>(&resourceManager_);
    services_.registerService<Input>(&input_);
    services_.registerService<GfxDevice>(gfxDevice_.get());
    services_.registerService<RenderContext>(renderContext_.get());
    services_.registerService<Renderer>(renderer_.get());

    for (auto& plugin : plugins_) {
        plugin->build(*this);
    }

    for (auto& group : system_groups_) {
        group.init(registry_);
    }

    initialized_ = true;
    ES_LOG_INFO("App initialized");
}

void App::shutdown() {
    if (!initialized_) return;

    ES_LOG_INFO("App shutting down...");

    for (auto& group : system_groups_) {
        group.shutdown(registry_);
    }

    renderer_.reset();

    renderContext_->shutdown();
    renderContext_.reset();

    RenderCommand::setDevice(nullptr);
    gfxDevice_.reset();

    resourceManager_.shutdown();

    registry_.clear();

    input_.shutdown();

    platform_->shutdown();
    platform_.reset();

    services_.clear();

    FileSystem::shutdown();

    initialized_ = false;
    ES_LOG_INFO("App shutdown complete");
    Log::shutdown();
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
    f64 currentTime = platform_->getTime();
    f32 dt = static_cast<f32>(currentTime - last_frame_time_);
    last_frame_time_ = currentTime;

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

    auto canvasView = registry_.view<ecs::Canvas>();
    if (!canvasView.empty()) {
        auto entity = *canvasView.begin();
        auto& canvas = registry_.get<ecs::Canvas>(entity);
        renderer_->setClearColor(canvas.backgroundColor);
    }

    renderer_->beginFrame();
    renderer_->clear();

    f32 w = static_cast<f32>(config_.width);
    f32 h = static_cast<f32>(config_.height);
    glm::mat4 projection = glm::ortho(0.0f, w, h, 0.0f, -1.0f, 1.0f);
    renderer_->beginScene(projection);

    runSystems(Schedule::PreRender);
    runSystems(Schedule::Render);
    runSystems(Schedule::PostRender);

    renderer_->endScene();
    renderer_->endFrame();

    platform_->swapBuffers();
}

void App::runSystems(Schedule schedule) {
    World world{registry_, services_, time_.delta};
    system_groups_[static_cast<usize>(schedule)].update(world);
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

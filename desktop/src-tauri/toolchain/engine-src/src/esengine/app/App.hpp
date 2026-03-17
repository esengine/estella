/**
 * @file    App.hpp
 * @brief   ECS-style application framework
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "Schedule.hpp"
#include "../core/Types.hpp"
#include "../ecs/Registry.hpp"
#include "../platform/Platform.hpp"
#include "../platform/input/Input.hpp"
#include "../resource/ResourceManager.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/Renderer.hpp"

#include <functional>
#include <string>
#include <vector>

namespace esengine {

// =============================================================================
// Forward Declarations
// =============================================================================

class App;
class Plugin;

// =============================================================================
// Type Aliases
// =============================================================================

using SystemFn = std::function<void(ecs::Registry&, f32)>;

// =============================================================================
// App Configuration
// =============================================================================

struct AppConfig {
    std::string title = "ESEngine";
    u32 width = 800;
    u32 height = 600;
    bool vsync = true;
};

// =============================================================================
// Resources (Global Singletons)
// =============================================================================

struct Time {
    f32 delta = 0.0f;
    f32 elapsed = 0.0f;
    u64 frameCount = 0;
};

// =============================================================================
// Plugin Interface
// =============================================================================

class Plugin {
public:
    virtual ~Plugin() = default;
    virtual void build(App& app) = 0;
};

// =============================================================================
// App Class
// =============================================================================

class App {
public:
    App();
    explicit App(const AppConfig& config);
    ~App();

    App(const App&) = delete;
    App& operator=(const App&) = delete;

    // =========================================================================
    // Builder Pattern
    // =========================================================================

    App& setConfig(const AppConfig& config);
    App& addPlugin(Unique<Plugin> plugin);

    template<typename T, typename... Args>
    App& addPlugin(Args&&... args) {
        return addPlugin(makeUnique<T>(std::forward<Args>(args)...));
    }

    App& addSystem(Schedule schedule, SystemFn system);
    App& addStartupSystem(SystemFn system);

    // =========================================================================
    // Lifecycle
    // =========================================================================

    void run();
    void quit();

    // =========================================================================
    // Accessors
    // =========================================================================

    ecs::Registry& registry() { return registry_; }
    const ecs::Registry& registry() const { return registry_; }

    resource::ResourceManager& resources() { return resourceManager_; }
    Input& input() { return input_; }
    const Time& time() const { return time_; }
    Renderer& renderer() { return *renderer_; }
    RenderContext& renderContext() { return *renderContext_; }

    u32 width() const { return config_.width; }
    u32 height() const { return config_.height; }

    static App& get() { return *instance_; }

    // =========================================================================
    // JS Interop (Web platform)
    // =========================================================================

#ifdef ES_PLATFORM_WEB
    void runJSSystems(Schedule schedule, f32 dt);
    static void setJSSystemsCallback(void* callback);
    static void* jsSystemsCallback_;
#endif

private:
    void init();
    void runFrame();
    void shutdown();

    void runSystems(Schedule schedule);

    AppConfig config_;

    Unique<Platform> platform_;
    Input input_;
    ecs::Registry registry_;
    resource::ResourceManager resourceManager_;
    Unique<RenderContext> renderContext_;
    Unique<Renderer> renderer_;

    Time time_;

    std::vector<Unique<Plugin>> plugins_;
    std::vector<SystemFn> systems_[SCHEDULE_COUNT];

    bool running_ = false;
    bool initialized_ = false;
    bool startupRan_ = false;

    static App* instance_;
};

}  // namespace esengine

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
#include "../core/World.hpp"
#include "../core/ServiceRegistry.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/System.hpp"
#include "../platform/Platform.hpp"
#include "../platform/input/Input.hpp"
#include "../resource/ResourceManager.hpp"
#include "../renderer/GfxDevice.hpp"
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

using SystemFn = std::function<void(World&)>;

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
// Resources
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

    App& addSystem(Schedule schedule, SystemFn system, i32 priority = 0);
    App& addStartupSystem(SystemFn system);

    // =========================================================================
    // Lifecycle
    // =========================================================================

    void run();
    void quit();

    // =========================================================================
    // Accessors
    // =========================================================================

    /**
     * @brief Convenience accessor via ServiceRegistry
     * @tparam T The service type
     * @return Reference to the service
     */
    template<typename T>
    T& require() { return services_.require<T>(); }

    ServiceRegistry& services() { return services_; }
    const Time& time() const { return time_; }

    u32 width() const { return config_.width; }
    u32 height() const { return config_.height; }

    // =========================================================================
    // JS Interop
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

    /** @brief Wraps a SystemFn lambda as a System for unified scheduling */
    class LambdaSystem : public ecs::System {
    public:
        explicit LambdaSystem(SystemFn fn) : fn_(std::move(fn)) {}
        void update(World& world) override { fn_(world); }
    private:
        SystemFn fn_;
    };

    AppConfig config_;
    ServiceRegistry services_;

    Unique<Platform> platform_;
    Input input_;
    ecs::Registry registry_;
    resource::ResourceManager resourceManager_;
    Unique<GfxDevice> gfxDevice_;
    Unique<RenderContext> renderContext_;
    Unique<Renderer> renderer_;

    Time time_;

    std::vector<Unique<Plugin>> plugins_;
    ecs::SystemGroup system_groups_[SCHEDULE_COUNT];

    bool running_ = false;
    bool initialized_ = false;
    bool startupRan_ = false;
    f64 last_frame_time_ = 0.0;
};

}  // namespace esengine

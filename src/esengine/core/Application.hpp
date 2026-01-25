#pragma once

#include "Types.hpp"
#include "../platform/Platform.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/System.hpp"

namespace esengine {

// Application configuration
struct ApplicationConfig {
    std::string title = "ESEngine Application";
    u32 width = 800;
    u32 height = 600;
    bool vsync = true;
};

// Base application class - users derive from this
class Application {
public:
    Application(const ApplicationConfig& config = {});
    virtual ~Application();

    // Non-copyable
    Application(const Application&) = delete;
    Application& operator=(const Application&) = delete;

    // Main entry point
    void run();

    // Request application to close
    void quit();

    // Accessors
    Platform& getPlatform() { return *platform_; }
    ecs::Registry& getRegistry() { return registry_; }

    u32 getWidth() const { return config_.width; }
    u32 getHeight() const { return config_.height; }
    f32 getDeltaTime() const { return static_cast<f32>(deltaTime_); }

    // Singleton access
    static Application& get() { return *instance_; }

protected:
    // Lifecycle hooks - override these in derived class
    virtual void onInit() {}
    virtual void onUpdate(f32 deltaTime) { (void)deltaTime; }
    virtual void onRender() {}
    virtual void onShutdown() {}

    // Event callbacks
    virtual void onTouch(TouchType type, const TouchPoint& point) {
        (void)type; (void)point;
    }
    virtual void onKey(KeyCode key, bool pressed) {
        (void)key; (void)pressed;
    }
    virtual void onResize(u32 width, u32 height) {
        (void)width; (void)height;
    }

    ApplicationConfig config_;
    Unique<Platform> platform_;
    ecs::Registry registry_;
    ecs::SystemGroup systems_;

private:
    void init();
    void mainLoop();
    void shutdown();

    f64 deltaTime_ = 0.0;
    bool running_ = false;

    static Application* instance_;
};

}  // namespace esengine

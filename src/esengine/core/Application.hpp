/**
 * @file    Application.hpp
 * @brief   Base application class for ESEngine applications
 * @details Provides the main application framework including lifecycle
 *          management, event handling, and access to engine subsystems.
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
#include "Types.hpp"
#include "../platform/Platform.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/System.hpp"
#include "../resource/ResourceManager.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/Renderer.hpp"

namespace esengine {

// =============================================================================
// Application Configuration
// =============================================================================

/**
 * @brief Configuration settings for Application initialization
 *
 * @details Controls window properties and rendering settings.
 *          Pass to Application constructor to customize behavior.
 *
 * @code
 * ApplicationConfig config;
 * config.title = "My Game";
 * config.width = 1280;
 * config.height = 720;
 * MyApp app(config);
 * @endcode
 */
struct ApplicationConfig {
    /** @brief Window title (native) or canvas title (web) */
    std::string title = "ESEngine Application";
    /** @brief Initial viewport width in pixels */
    u32 width = 800;
    /** @brief Initial viewport height in pixels */
    u32 height = 600;
    /** @brief Enable vertical sync */
    bool vsync = true;
};

// =============================================================================
// Application Class
// =============================================================================

/**
 * @brief Base class for ESEngine applications
 *
 * @details Users derive from this class and override lifecycle hooks
 *          to implement game logic. The Application manages:
 *          - Platform abstraction and window/context creation
 *          - Main game loop with fixed timestep
 *          - ECS Registry for entity/component management
 *          - Resource management (shaders, textures, buffers)
 *          - Rendering context and renderer
 *          - Event dispatching (input, resize, etc.)
 *
 * @code
 * class MyGame : public esengine::Application {
 * public:
 *     MyGame() : Application({.title = "My Game", .width = 1280}) {}
 *
 * protected:
 *     void onInit() override {
 *         // Load assets, create entities
 *         auto tex = getResourceManager().loadTexture("player.png");
 *     }
 *
 *     void onUpdate(f32 deltaTime) override {
 *         // Game logic, physics, AI
 *     }
 *
 *     void onRender() override {
 *         // Drawing code
 *         getRenderer().drawQuad({100, 100}, {50, 50}, {1, 0, 0, 1});
 *     }
 * };
 *
 * ES_MAIN(MyGame)
 * @endcode
 *
 * @note Application is a singleton - only one instance can exist.
 */
class Application {
public:
    /**
     * @brief Constructs the application with given configuration
     * @param config Application settings (window size, title, etc.)
     */
    Application(const ApplicationConfig& config = {});

    /** @brief Virtual destructor for proper cleanup */
    virtual ~Application();

    // Non-copyable
    Application(const Application&) = delete;
    Application& operator=(const Application&) = delete;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * @brief Starts the main application loop
     * @details Initializes subsystems, enters the main loop, and handles
     *          shutdown when complete. On web platforms, this sets up
     *          the Emscripten main loop.
     */
    void run();

    /**
     * @brief Requests the application to close
     * @details Sets a flag that causes the main loop to exit gracefully
     *          after the current frame completes.
     */
    void quit();

    // =========================================================================
    // Accessors
    // =========================================================================

    /**
     * @brief Gets the platform abstraction layer
     * @return Reference to the Platform instance
     */
    Platform& getPlatform() { return *platform_; }

    /**
     * @brief Gets the ECS registry
     * @return Reference to the Registry for entity/component management
     */
    ecs::Registry& getRegistry() { return registry_; }

    /**
     * @brief Gets the resource manager
     * @return Reference to the ResourceManager for asset loading
     */
    resource::ResourceManager& getResourceManager() { return resourceManager_; }

    /**
     * @brief Gets the render context
     * @return Reference to the RenderContext
     */
    RenderContext& getRenderContext() { return *renderContext_; }

    /**
     * @brief Gets the renderer
     * @return Reference to the Renderer for drawing
     */
    Renderer& getRenderer() { return *renderer_; }

    /** @brief Gets the current viewport width in pixels */
    u32 getWidth() const { return config_.width; }

    /** @brief Gets the current viewport height in pixels */
    u32 getHeight() const { return config_.height; }

    /**
     * @brief Gets the time elapsed since last frame
     * @return Delta time in seconds
     */
    f32 getDeltaTime() const { return static_cast<f32>(deltaTime_); }

    /**
     * @brief Gets the singleton Application instance
     * @return Reference to the current Application
     * @note Asserts if called before Application construction
     */
    static Application& get() { return *instance_; }

protected:
    // =========================================================================
    // Lifecycle Hooks
    // =========================================================================

    /**
     * @brief Called once after engine initialization
     * @details Override to load assets, create initial entities, etc.
     */
    virtual void onInit() {}

    /**
     * @brief Called every frame for game logic
     * @param deltaTime Time since last frame in seconds
     * @details Override to update game state, physics, AI, etc.
     */
    virtual void onUpdate(f32 deltaTime) { (void)deltaTime; }

    /**
     * @brief Called every frame for rendering
     * @details Override to submit draw calls. Called after onUpdate().
     */
    virtual void onRender() {}

    /**
     * @brief Called before application shutdown
     * @details Override to save state or cleanup resources.
     */
    virtual void onShutdown() {}

    // =========================================================================
    // Event Callbacks
    // =========================================================================

    /**
     * @brief Called on touch/mouse input
     * @param type The type of touch event (down, up, move)
     * @param point Touch position and identifier
     */
    virtual void onTouch(TouchType type, const TouchPoint& point) {
        (void)type; (void)point;
    }

    /**
     * @brief Called on keyboard input
     * @param key The key code
     * @param pressed True if pressed, false if released
     */
    virtual void onKey(KeyCode key, bool pressed) {
        (void)key; (void)pressed;
    }

    /**
     * @brief Called when viewport is resized
     * @param width New width in pixels
     * @param height New height in pixels
     */
    virtual void onResize(u32 width, u32 height) {
        (void)width; (void)height;
    }

    // =========================================================================
    // Protected Members
    // =========================================================================

    /** @brief Application configuration */
    ApplicationConfig config_;
    /** @brief Platform abstraction layer */
    Unique<Platform> platform_;
    /** @brief ECS entity/component registry */
    ecs::Registry registry_;
    /** @brief System execution group */
    ecs::SystemGroup systems_;
    /** @brief Resource manager for assets */
    resource::ResourceManager resourceManager_;
    /** @brief Rendering context with shared state */
    Unique<RenderContext> renderContext_;
    /** @brief Renderer instance */
    Unique<Renderer> renderer_;

private:
    void init();
    void mainLoop();
    void shutdown();

    f64 deltaTime_ = 0.0;
    bool running_ = false;

    static Application* instance_;
};

}  // namespace esengine

/**
 * @file    System.hpp
 * @brief   ECS System base class and execution group
 * @details Provides the System base class for implementing game logic
 *          and SystemGroup for organizing and executing systems in order.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Types.hpp"

// Standard library
#include <algorithm>

namespace esengine::ecs {

// Forward declaration
class Registry;

// =============================================================================
// System Base Class
// =============================================================================

/**
 * @brief Base class for all ECS systems
 *
 * @details Systems contain the logic that operates on entities with
 *          specific component configurations. Derive from this class
 *          and override update() to implement game logic.
 *
 * @code
 * class MovementSystem : public System {
 * public:
 *     void update(Registry& registry, f32 deltaTime) override {
 *         registry.each<Transform, Velocity>(
 *             [deltaTime](Entity e, Transform& t, Velocity& v) {
 *                 t.position += v.linear * deltaTime;
 *             });
 *     }
 * };
 *
 * // Usage:
 * systemGroup.createSystem<MovementSystem>();
 * @endcode
 */
class System {
public:
    /** @brief Virtual destructor for proper cleanup */
    virtual ~System() = default;

    /**
     * @brief Called once when the system is added to a group
     * @param registry Reference to the ECS registry
     *
     * @details Override to perform one-time initialization such as
     *          caching component pools or loading resources.
     */
    virtual void init(Registry& registry) { (void)registry; }

    /**
     * @brief Called every frame to execute system logic
     * @param registry Reference to the ECS registry
     * @param deltaTime Time since last frame in seconds
     *
     * @details Pure virtual - must be overridden. This is where
     *          the main system logic goes.
     */
    virtual void update(Registry& registry, f32 deltaTime) = 0;

    /**
     * @brief Called once when the system is removed
     * @param registry Reference to the ECS registry
     *
     * @details Override to cleanup resources allocated in init().
     */
    virtual void shutdown(Registry& registry) { (void)registry; }

    // =========================================================================
    // Enable/Disable
    // =========================================================================

    /**
     * @brief Enables or disables the system
     * @param enabled True to enable, false to disable
     *
     * @details Disabled systems are skipped during update().
     */
    void setEnabled(bool enabled) { enabled_ = enabled; }

    /**
     * @brief Checks if the system is enabled
     * @return True if enabled
     */
    bool isEnabled() const { return enabled_; }

    // =========================================================================
    // Priority
    // =========================================================================

    /**
     * @brief Sets the system's execution priority
     * @param priority Lower values execute first
     *
     * @details Systems in a SystemGroup are sorted by priority.
     *          Default priority is 0.
     */
    void setPriority(i32 priority) { priority_ = priority; }

    /**
     * @brief Gets the system's execution priority
     * @return The priority value
     */
    i32 getPriority() const { return priority_; }

protected:
    /** @brief Whether the system is enabled */
    bool enabled_ = true;
    /** @brief Execution priority (lower = earlier) */
    i32 priority_ = 0;
};

// =============================================================================
// System Group
// =============================================================================

/**
 * @brief Container for organizing and executing systems
 *
 * @details Manages a collection of systems, executing them in priority
 *          order during update. Systems with lower priority values
 *          execute first.
 *
 * @code
 * SystemGroup systems;
 *
 * // Create systems with different priorities
 * auto& physics = systems.createSystem<PhysicsSystem>();
 * physics.setPriority(0);  // Runs first
 *
 * auto& render = systems.createSystem<RenderSystem>();
 * render.setPriority(100); // Runs last
 *
 * // In game loop:
 * systems.init(registry);
 * while (running) {
 *     systems.update(registry, deltaTime);
 * }
 * systems.shutdown(registry);
 * @endcode
 */
class SystemGroup {
public:
    /**
     * @brief Adds an existing system to the group
     * @param system Unique pointer to the system (ownership transferred)
     *
     * @details The group takes ownership of the system. Systems are
     *          automatically sorted by priority after adding.
     */
    void addSystem(Unique<System> system) {
        systems_.push_back(std::move(system));
        sortSystems();
    }

    /**
     * @brief Creates and adds a system to the group
     * @tparam T The system type to create
     * @tparam Args Constructor argument types
     * @param args Arguments forwarded to T's constructor
     * @return Reference to the created system
     *
     * @code
     * auto& mySystem = group.createSystem<MySystem>(arg1, arg2);
     * mySystem.setPriority(10);
     * @endcode
     */
    template<typename T, typename... Args>
    T& createSystem(Args&&... args) {
        auto system = makeUnique<T>(std::forward<Args>(args)...);
        T& ref = *system;
        addSystem(std::move(system));
        return ref;
    }

    /**
     * @brief Initializes all systems in the group
     * @param registry Reference to the ECS registry
     *
     * @details Calls init() on each system in priority order.
     *          Should be called once before the main loop.
     */
    void init(Registry& registry) {
        for (auto& system : systems_) {
            system->init(registry);
        }
    }

    /**
     * @brief Updates all enabled systems
     * @param registry Reference to the ECS registry
     * @param deltaTime Time since last frame in seconds
     *
     * @details Calls update() on each enabled system in priority order.
     *          Disabled systems are skipped.
     */
    void update(Registry& registry, f32 deltaTime) {
        for (auto& system : systems_) {
            if (system->isEnabled()) {
                system->update(registry, deltaTime);
            }
        }
    }

    /**
     * @brief Shuts down all systems
     * @param registry Reference to the ECS registry
     *
     * @details Calls shutdown() on each system in priority order.
     *          Should be called once after the main loop.
     */
    void shutdown(Registry& registry) {
        for (auto& system : systems_) {
            system->shutdown(registry);
        }
    }

private:
    /**
     * @brief Sorts systems by priority (ascending)
     */
    void sortSystems() {
        std::sort(systems_.begin(), systems_.end(),
            [](const Unique<System>& a, const Unique<System>& b) {
                return a->getPriority() < b->getPriority();
            });
    }

    /** @brief Owned systems sorted by priority */
    std::vector<Unique<System>> systems_;
};

}  // namespace esengine::ecs

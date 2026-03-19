/**
 * @file    World.hpp
 * @brief   Unified context passed to all ECS systems
 * @details Bundles Registry, ServiceRegistry, and frame timing into a single
 *          object so systems can access any engine service without globals.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "Types.hpp"
#include "ServiceRegistry.hpp"

namespace esengine {

namespace ecs {
class Registry;
}

/**
 * @brief Context passed to every System::update call
 *
 * @details Provides access to the ECS registry, all registered services,
 *          and frame timing. Systems should use this instead of global state.
 *
 * @code
 * void update(World& world) override {
 *     auto& registry = world.registry;
 *     auto& input = world.services.require<Input>();
 *     f32 dt = world.deltaTime;
 * }
 * @endcode
 */
struct World {
    ecs::Registry& registry;       ///< ECS entity/component storage
    ServiceRegistry& services;     ///< All engine services
    f32 deltaTime;                 ///< Seconds since last frame

    /** @brief Convenience accessor for services */
    template<typename T>
    T& require() { return services.require<T>(); }
};

}  // namespace esengine

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "Registry.hpp"

#include <unordered_map>

namespace esengine::ecs {

/** Entity cleanup for a single simulation, including a system driven directly in C++. */
class RegistrySystem {
protected:
    virtual ~RegistrySystem() = default;

    void observe(Registry& registry) {
        if (!managed_ && !standalone_.isConnected()) {
            standalone_ = registry.onDestroy([this](Entity entity) { onEntityDestroyed(entity); });
        }
    }

private:
    template<class> friend class RegistrySystems;
    virtual void onEntityDestroyed(Entity entity) = 0;

    Connection attach(Registry& registry, Shared<RegistrySystem> owner) {
        auto connection = registry.onDestroy([owner = std::move(owner)](Entity entity) { owner->onEntityDestroyed(entity); });
        standalone_.disconnect();
        managed_ = true;
        return connection;
    }

    bool managed_ = false;
    Connection standalone_;
};

/** An engine's simulations, each owned by its registry's entity-destruction subscription. */
template<class System>
class RegistrySystems {
public:
    Shared<System> find(const Registry& registry) const {
        const auto it = systems_.find(registry.instanceId());
        return it == systems_.end() ? nullptr : it->second.system.lock();
    }

    template<class Factory>
    Shared<System> forRegistry(Registry& registry, Factory&& create) {
        if (auto system = find(registry)) return system;
        std::erase_if(systems_, [](const auto& entry) { return entry.second.system.expired(); });
        auto system = create();
        auto connection = system->attach(registry, system);
        systems_.emplace(registry.instanceId(), Entry{system, std::move(connection)});
        return system;
    }

    Shared<System> forRegistry(Registry& registry) {
        return forRegistry(registry, [] { return makeShared<System>(); });
    }

    template<class Fn>
    void forEach(Fn&& apply) const {
        for (const auto& [id, entry] : systems_) {
            if (auto system = entry.system.lock()) apply(*system);
        }
    }

private:
    // Destroying the engine disconnects these subscriptions. Destroying a registry
    // releases its callback and simulation immediately, including between frames.
    struct Entry { Weak<System> system; Connection despawn; };
    std::unordered_map<u64, Entry> systems_;
};

}  // namespace esengine::ecs

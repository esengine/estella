// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "Registry.hpp"

#include <unordered_map>

namespace esengine::ecs {

/** Entity and whole-registry cleanup for a simulation, including one driven directly in C++. */
class RegistrySystem {
public:
    u64 entitySetId() const {
        const auto id = entity_set_.lock();
        return id ? *id : 0;
    }

protected:
    virtual ~RegistrySystem() = default;

    void observe(Registry& registry) {
        if (managed_) return;
        if (standalone_.size() != 0) {
            if (entitySetId() == registry.entitySetId()) return;
            standalone_.disconnectAll();
            onRegistryCleared();
        }
        standalone_ = listen(registry, this);
    }

private:
    template<class> friend class RegistrySystems;
    virtual void onEntityDestroyed(Entity entity) = 0;
    virtual void onRegistryCleared() {}

    template<class Owner>
    static ConnectionHolder listen(Registry& registry, Owner owner) {
        ConnectionHolder subscriptions;
        subscriptions.add(registry.onDestroy([owner](Entity entity) { owner->onEntityDestroyed(entity); }));
        owner->entity_set_ = registry.observeEntitySet();
        subscriptions.add(sink(registry.on_system_reset_).connect([owner] { owner->onRegistryCleared(); }));
        return subscriptions;
    }

    ConnectionHolder attach(Registry& registry, Shared<RegistrySystem> owner) {
        auto subscriptions = listen(registry, std::move(owner));
        standalone_.disconnectAll();
        managed_ = true;
        return subscriptions;
    }

    bool managed_ = false;
    Weak<const u64> entity_set_;
    ConnectionHolder standalone_;
};

/** An engine's simulations, each owned by its registry's lifecycle subscriptions. */
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
        std::erase_if(systems_, [](const auto& entry) {
            const auto system = entry.second.system.lock();
            return !system || !system->entitySetId();
        });
        auto system = create();
        auto subscriptions = system->attach(registry, system);
        systems_.emplace(registry.instanceId(), Entry{system, std::move(subscriptions)});
        return system;
    }

    Shared<System> forRegistry(Registry& registry) {
        return forRegistry(registry, [] { return makeShared<System>(); });
    }

    template<class Fn>
    void forEach(Fn&& apply) const {
        for (const auto& [id, entry] : systems_) {
            if (auto system = entry.system.lock(); system && system->entitySetId()) apply(*system);
        }
    }

private:
    // Destroying the engine disconnects these subscriptions. Destroying a registry
    // releases its callback and simulation immediately, including between frames.
    struct Entry { Weak<System> system; ConnectionHolder subscriptions; };
    std::unordered_map<u64, Entry> systems_;
};

}  // namespace esengine::ecs

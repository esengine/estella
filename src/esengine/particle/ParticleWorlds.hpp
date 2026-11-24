// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "ParticleSystem.hpp"
#include "../core/RandomSource.hpp"

namespace esengine::particle {

/** One simulation per ECS registry sharing this engine and rendering device. */
class ParticleWorlds {
public:
    explicit ParticleWorlds(const RandomSource& seed) : seed_(seed) {}

    Shared<ParticleSystem> forRegistry(ecs::Registry& registry) {
        const u64 id = registry.instanceId();
        if (const auto it = worlds_.find(id); it != worlds_.end()) {
            if (auto system = it->second.system.lock()) return system;
        }
        std::erase_if(worlds_, [](const auto& pair) { return pair.second.system.expired(); });
        // A legacy caller can author a LUT before its first call carrying a registry.
        auto system = pending_ ? std::move(pending_) : makeSystem();
        auto connection = system->observe(registry, system);
        worlds_.emplace(id, Entry{system, std::move(connection)});
        return system;
    }

    Shared<ParticleSystem> select(ecs::Registry& registry) {
        auto system = forRegistry(registry);
        last_ = system;
        return system;
    }

    /** Compatibility for low-level calls which supplied only an entity or no owner. */
    Shared<ParticleSystem> legacy() {
        if (auto system = last_.lock()) return system;
        if (!pending_) pending_ = makeSystem();
        return pending_;
    }

    void reseedFrom(const RandomSource& seed) {
        seed_ = seed;
        forEach([&](ParticleSystem& system) { system.reseedFrom(seed); });
    }

    void setGpuAvailable(bool available) {
        if (gpuAvailable_ == available) return;
        gpuAvailable_ = available;
        forEach([&](ParticleSystem& system) { system.setGpuAvailable(available); });
    }

    void setParticleLimit(u32 limit) {
        if (limit_ == limit) return;
        limit_ = limit;
        forEach([&](ParticleSystem& system) { system.setParticleLimit(limit); });
    }

private:
    // The registry's despawn callback holds the simulation until either the registry
    // dies or this context disconnects. The lookup and legacy cursor cannot extend it.
    struct Entry { Weak<ParticleSystem> system; Connection despawn; };
    std::unordered_map<u64, Entry> worlds_;
    Weak<ParticleSystem> last_;
    Shared<ParticleSystem> pending_;
    RandomSource seed_;
    bool gpuAvailable_ = false;
    u32 limit_ = 0xffffffffu;

    Shared<ParticleSystem> makeSystem() const {
        auto system = makeShared<ParticleSystem>();
        system->reseedFrom(seed_);
        system->setGpuAvailable(gpuAvailable_);
        system->setParticleLimit(limit_);
        return system;
    }

    template<class Fn> void forEach(Fn&& apply) {
        if (pending_) apply(*pending_);
        for (const auto& [id, entry] : worlds_) {
            if (auto system = entry.system.lock()) apply(*system);
        }
    }
};

}  // namespace esengine::particle

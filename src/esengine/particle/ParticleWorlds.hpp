// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "ParticleSystem.hpp"
#include "../core/RandomSource.hpp"
#include "../ecs/RegistrySystems.hpp"

namespace esengine::particle {

/** One simulation per ECS registry sharing this engine and rendering device. */
class ParticleWorlds {
public:
    explicit ParticleWorlds(const RandomSource& seed) : seed_(seed) {}

    Shared<ParticleSystem> forRegistry(ecs::Registry& registry) {
        // A legacy caller can author a LUT before its first call carrying a registry.
        return worlds_.forRegistry(registry, [this] {
            return pending_ ? std::move(pending_) : makeSystem();
        });
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
    ecs::RegistrySystems<ParticleSystem> worlds_;
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
        worlds_.forEach(apply);
    }
};

}  // namespace esengine::particle

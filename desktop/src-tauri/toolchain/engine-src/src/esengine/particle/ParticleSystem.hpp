#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/ParticleEmitter.hpp"
#include "Particle.hpp"
#include "ParticleEasing.hpp"

#include <unordered_map>
#include <functional>
#include <random>

namespace esengine::particle {

struct EmitterState {
    ParticlePool pool;
    f32 emission_accumulator = 0.0f;
    f32 elapsed_time = 0.0f;
    f32 burst_timer = 0.0f;
    bool playing = false;
    bool first_update = true;

    explicit EmitterState(u32 capacity) : pool(capacity) {}
};

class ParticleSystem {
public:
    ParticleSystem();

    void update(ecs::Registry& registry, f32 dt);

    void play(Entity entity);
    void stop(Entity entity);
    void reset(Entity entity);

    u32 aliveCount(Entity entity) const;
    u32 totalAliveParticles() const;

    void forEachParticle(Entity entity, const std::function<void(const Particle&)>& fn) const;

    EmitterState* getState(Entity entity);
    const EmitterState* getState(Entity entity) const;

private:
    void emitParticles(const ecs::ParticleEmitter& emitter,
                       const ecs::Transform& transform,
                       EmitterState& state, u32 count);

    void updateParticles(const ecs::ParticleEmitter& emitter, EmitterState& state, f32 dt);
    f32 randomRange(f32 min, f32 max);
    glm::vec2 randomDirection(f32 angleMin, f32 angleMax);
    glm::vec2 randomShapeOffset(const ecs::ParticleEmitter& emitter);

    std::unordered_map<Entity, EmitterState> states_;
    std::mt19937 rng_;
    std::vector<Particle*> dead_particles_;
    u32 destroy_callback_id_ = 0;
};

}  // namespace esengine::particle

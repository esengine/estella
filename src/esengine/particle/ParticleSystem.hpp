// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
#include <array>

namespace esengine::particle {

// Resolution of the per-emitter over-life lookup tables (baked in TS from a
// gradient/curve, sampled here per particle). 32 keeps them smooth and small.
inline constexpr int kColorLutSize = 32;
using ColorLut = std::array<glm::vec4, kColorLutSize>;
// Size-over-life: a scalar multiplier curve × the particle's start size.
using SizeLut = std::array<f32, kColorLutSize>;

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

    /** Set (count == kColorLutSize) or clear (count == 0) an entity's color-over-life
     *  LUT. When set, particle color is sampled from it instead of start/end+easing. */
    void setColorLut(Entity entity, const f32* rgba, i32 count);
    /** Set/clear an entity's size-over-life multiplier LUT (× the particle's start size). */
    void setSizeLut(Entity entity, const f32* values, i32 count);

private:
    void emitParticles(const ecs::ParticleEmitter& emitter,
                       const ecs::Transform& transform,
                       EmitterState& state, u32 count);

    void updateParticles(const ecs::ParticleEmitter& emitter, EmitterState& state, f32 dt,
                         const ColorLut* colorLut, const SizeLut* sizeLut);
    f32 randomRange(f32 min, f32 max);
    glm::vec2 randomDirection(f32 angleMin, f32 angleMax);
    glm::vec2 randomShapeOffset(const ecs::ParticleEmitter& emitter);

    std::unordered_map<Entity, EmitterState> states_;
    std::unordered_map<Entity, ColorLut> colorLuts_;
    std::unordered_map<Entity, SizeLut> sizeLuts_;
    std::mt19937 rng_;
    std::vector<u32> dead_particle_indices_;
    // RAII: auto-unregisters from the registry's onDestroy when this system is
    // destroyed, so a torn-down system never leaves a dangling `this` behind.
    Connection destroyConn_;
};

}  // namespace esengine::particle

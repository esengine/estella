// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/ParticleEmitter.hpp"
#include "../ecs/components/ParticleForceField.hpp"
#include "Particle.hpp"
#include "ParticleEasing.hpp"

#include <unordered_map>
#include <unordered_set>
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

// Hard cap on a per-particle trail's recorded points (the ribbon has one segment
// less). Bounds the per-emitter history buffer; the component's trailPoints picks
// how many of these to actually keep.
inline constexpr int kMaxTrailPoints = 12;

// A scene force field flattened to what the per-particle inner loop needs, gathered
// once per update() so the hot loop touches no components.
struct ForceFieldInstance {
    i32 type = 0;
    glm::vec2 position{0.0f};
    glm::vec2 direction{1.0f, 0.0f};  // pre-normalized (Directional only)
    f32 strength = 0.0f;
    f32 radius = 0.0f;                 // 0 = unbounded
    f32 radiusSq = 0.0f;
    bool falloff = true;
};

struct EmitterState {
    ParticlePool pool;
    f32 emission_accumulator = 0.0f;
    f32 elapsed_time = 0.0f;
    f32 burst_timer = 0.0f;
    // Monotonic clock for the noise field's scroll — advances every update
    // regardless of play/stop so the turbulence never snaps when emission pauses.
    f32 noise_time = 0.0f;
    bool playing = false;
    bool first_update = true;

    // Per-particle trail history, keyed by pool index and only sized once an emitter
    // enables trails (free otherwise). trail_pos is a flat [capacity × kMaxTrailPoints]
    // ring of raw particle-space positions (oldest→newest); trail_count is how many
    // slots each particle has filled.
    std::vector<glm::vec2> trail_pos;
    std::vector<u8> trail_count;

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

    // Shared spawn core: seed `count` particles into `state` from `emitter`'s config,
    // originating at world `emitterPos`/`emitterAngle`, adding `velocityBias` to each
    // (used by sub-emitter bursts to inherit the parent particle's motion).
    // `allowBirthTrigger` records Birth events for a nested sub-emitter; false for a
    // sub-burst's own spawn so a drain can't re-enter the request buffer it's reading.
    void emitInto(const ecs::ParticleEmitter& emitter, EmitterState& state,
                  glm::vec2 emitterPos, f32 emitterAngle, bool isWorldSpace,
                  glm::vec2 velocityBias, u32 count, bool allowBirthTrigger);

    // Fire the referenced child emitter's burst at each pending sub-emit request.
    void drainSubEmitters(ecs::Registry& registry, Entity child,
                          f32 inheritVelocity, f32 chance);

    void updateParticles(const ecs::ParticleEmitter& emitter, EmitterState& state, f32 dt,
                         const ColorLut* colorLut, const SizeLut* sizeLut,
                         glm::vec2 emitterPos, f32 emitterAngle, bool isWorldSpace);
    f32 randomRange(f32 min, f32 max);
    glm::vec2 randomDirection(f32 angleMin, f32 angleMax);
    glm::vec2 randomShapeOffset(const ecs::ParticleEmitter& emitter);

    // A parent particle's birth/death position + velocity, queued during a parent's
    // update and drained into its child sub-emitter right after.
    struct SubEmitRequest { glm::vec2 position; glm::vec2 velocity; };
    std::vector<SubEmitRequest> subemit_requests_;

    std::unordered_map<Entity, EmitterState> states_;
    // A play() that arrives before the emitter's first update (its state isn't
    // created yet) is remembered here and applied on state creation, not dropped.
    std::unordered_set<Entity> pending_play_;
    std::unordered_map<Entity, ColorLut> colorLuts_;
    std::unordered_map<Entity, SizeLut> sizeLuts_;
    std::mt19937 rng_;
    std::vector<u32> dead_particle_indices_;
    // Active scene force fields, rebuilt each update() and applied to world-space
    // particles during integration.
    std::vector<ForceFieldInstance> force_fields_;
    // RAII: auto-unregisters from the registry's onDestroy when this system is
    // destroyed, so a torn-down system never leaves a dangling `this` behind.
    Connection destroyConn_;
};

}  // namespace esengine::particle

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
#include "ParticleBursts.hpp"
#include "ParticleEasing.hpp"
#include "ParticleShapes.hpp"

#include <unordered_map>
#include <unordered_set>
#include <functional>
#include <random>
#include <array>
#include <algorithm>
#include "../core/Reflection.hpp"

namespace esengine { class RandomSource; }

namespace esengine::particle {

// Resolution of the per-emitter over-life lookup tables (baked in TS from a
// gradient/curve, sampled here per particle). 32 keeps them smooth and small.
ES_CONST(ts=GRADIENT_LUT_SIZE)
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
    glm::vec3 position{0.0f};
    glm::vec3 direction{1.0f, 0.0f, 0.0f};  // pre-normalized (Directional only)
    f32 strength = 0.0f;
    f32 radius = 0.0f;                 // 0 = unbounded
    f32 radiusSq = 0.0f;
    bool falloff = true;
};

// Fixed-width batch records shared by Web and native heaps. Integers keep their
// bits (including generational entity IDs); they are not converted through float.
struct CollisionQuery {
    u32 emitter, slot, mode, mask;
    f32 ox, oy, oz, dx, dy, dz;
};
struct CollisionReply {
    u32 status, body; // 0 miss, 1 hit, 2 backend unavailable
    f32 x, y, z, nx, ny, nz;
};
struct CollisionEvent {
    u32 emitter, slot, body, mode;
    f32 x, y, z, nx, ny, nz, vx, vy, vz;
    u32 publish;
};
struct CollisionStats {
    u32 emitter = 0, queries = 0, hits = 0, budgetSkipped = 0, distanceSkipped = 0;
    u32 unavailable = 0, events = 0, eventDropped = 0, fallbacks = 0, mode = 0;
};
static_assert(sizeof(CollisionQuery) == 40 && sizeof(CollisionReply) == 32);
static_assert(sizeof(CollisionEvent) == 56 && sizeof(CollisionStats) == 40);

/// What one frame asks of a GPU-simulated emitter: how long to advance, how many to spawn and where in the ring they go.
struct GpuStep {
    f32 dt = 0.0f;
    f32 noiseTime = 0.0f;
    u32 capacity = 0;
    u32 firstIndex = 0;   ///< Absolute index of the first particle born this step (slot = index % capacity).
    u32 spawnCount = 0;   ///< Born this step: `smoothCount` spread across dt, then the rest as one burst.
    u32 smoothCount = 0;
    u32 drawCount = 0;    ///< Slots that may hold a live particle once this step has run.
    bool reset = false;   ///< Kill everything first (a reset() since the last step).
};

struct EmitterState {
    ParticlePool pool;
    f32 emission_accumulator = 0.0f;
    f32 elapsed_time = 0.0f;
    f32 burst_timer = 0.0f;
    /// Where the scheduled bursts last looked: the emitting clock of the previous step, below zero before the first.
    f32 burst_clock = -1.0f;
    // Monotonic clock for the noise field's scroll — advances every update
    // regardless of play/stop so the turbulence never snaps when emission pauses.
    f32 noise_time = 0.0f;
    bool playing = false;
    bool first_update = true;

    // Per-particle trail history, keyed by pool index and only sized once an emitter
    // enables trails (free otherwise). trail_pos is a flat [capacity × kMaxTrailPoints]
    // ring of raw particle-space positions (oldest→newest); trail_count is how many
    // slots each particle has filled.
    std::vector<glm::vec3> trail_pos;
    std::vector<u8> trail_count;

    u32 collisionCursor = 0, collisionOrdinal = 0;

    // GPU simulation: the emitter keeps its schedule here (rate, bursts, duration) and the particles live in
    // a GPU ring this state only counts. The pool stays empty, so a million-particle emitter costs no heap.
    bool gpu = false;
    u32 gpuCapacity = 0;
    f32 gpuDt = 0.0f;
    u32 gpuSmooth = 0, gpuBurst = 0;
    u32 gpuSpawned = 0;
    bool gpuReset = false;

    explicit EmitterState(u32 capacity) : pool(capacity) {}
};

class ParticleSystem {
public:
    /** The engine stream this system draws from — see core/RandomSource.hpp. */
    static constexpr const char* kRandomStream = "particles";

    ParticleSystem();

    /** Re-derive this system's generator from the engine's seed. Spawns after
     *  this point reproduce; particles already alive keep the values they got. */
    void reseedFrom(const esengine::RandomSource& source);

    void update(ecs::Registry& registry, f32 dt);

    /// Whether emitters that ask for GPU simulation get it. Set by the renderer, which knows the device; false
    /// means they run on the CPU, capped at kGpuFallbackCapacity.
    void setGpuAvailable(bool available) { gpu_available_ = available; }
    bool gpuAvailable() const { return gpu_available_; }
    static constexpr u32 kGpuMaxCapacity = 2'000'000;
    static constexpr u32 kGpuFallbackCapacity = 20'000;

    /// What a GPU emitter has to do to catch up: the time, the births, where in the ring they go. False when the entity
    /// is not simulated on the GPU. Nothing is consumed until commitGpuStep, so a step that was asked for and never run
    /// (a collect whose frame did not reach the graph) is asked for again next time rather than lost.
    bool peekGpuStep(Entity entity, GpuStep& out) const;
    /// The kernel ran this step: the time and births it covered are spent.
    void commitGpuStep(Entity entity, const GpuStep& step);
    const std::vector<ForceFieldInstance>& forceFields() const { return force_fields_; }

    // update() integrates; resolveCollisions() completes all queries in this same
    // frame before rendering. No reply survives into the next update.
    const std::vector<CollisionQuery>& collisionQueries() const { return collision_queries_; }
    const std::vector<CollisionEvent>& collisionEvents() const { return collision_events_; }
    const std::vector<CollisionStats>& collisionStats() const { return collision_stats_; }
    void setCollisionBudget(u32 queries, u32 events, bool debug = false) {
        collision_debug_ = debug;
        query_budget_ = std::min(queries, 65536u); event_budget_ = std::min(events, 16384u);
    }
    void resolveCollisions(ecs::Registry& registry, const CollisionReply* replies, u32 count);

    void play(Entity entity);
    void stop(Entity entity);
    void reset(Entity entity);

    u32 aliveCount(Entity entity) const;
    u32 totalAliveParticles() const;
    void setParticleLimit(u32 limit) { particle_limit_ = limit; }

    void forEachParticle(Entity entity, const std::function<void(const Particle&)>& fn) const;

    EmitterState* getState(Entity entity);
    const EmitterState* getState(Entity entity) const;

    /** Set (count == kColorLutSize) or clear (count == 0) an entity's color-over-life
     *  LUT. When set, particle color is sampled from it instead of start/end+easing. */
    void setColorLut(Entity entity, const f32* rgba, i32 count);
    /** Set/clear an entity's size-over-life multiplier LUT (× the particle's start size). */
    void setSizeLut(Entity entity, const f32* values, i32 count);

    /** Set/clear an entity's speed-over-life multiplier LUT. It scales how fast a
     *  particle travels along the trajectory it already has — it is not a force,
     *  and gravity, damping and noise still accumulate into velocity as before. */
    void setSpeedLut(Entity entity, const f32* values, i32 count);

    /** Set/clear an entity's burst schedule: `count` pairs of (seconds, particles) in `values`. Each fires once per
     *  pass of the emitter's clock over its time, and a looping emitter passes every duration. */
    void setBursts(Entity entity, const f32* values, i32 count);

    /// The over-life curves an entity was given, for the GPU kernel to read; null where none was set.
    const ColorLut* colorLut(Entity entity) const { auto it = colorLuts_.find(entity); return it == colorLuts_.end() ? nullptr : &it->second; }
    const SizeLut* sizeLut(Entity entity) const { auto it = sizeLuts_.find(entity); return it == sizeLuts_.end() ? nullptr : &it->second; }
    const SizeLut* speedLut(Entity entity) const { auto it = speedLuts_.find(entity); return it == speedLuts_.end() ? nullptr : &it->second; }

private:
    void emitParticles(const ecs::ParticleEmitter& emitter,
                       const ecs::Transform& transform,
                       EmitterState& state, u32 count);

    // Shared spawn core: seed `count` particles into `state` from `emitter`'s
    // config at `frame`, adding `velocityBias` to each (a sub-emitter burst
    // inherits the parent particle's motion that way).
    // `allowBirthTrigger` records Birth events for a nested sub-emitter; false for a
    // sub-burst's own spawn so a drain can't re-enter the request buffer it's reading.
    void emitInto(const ecs::ParticleEmitter& emitter, EmitterState& state,
                  const EmitterFrame& frame, bool isWorldSpace,
                  glm::vec3 velocityBias, u32 count, bool allowBirthTrigger, u32 depth = 0,
                  const EmitterFrame* storageFrame = nullptr);

    // Fire the referenced child emitter's burst at each pending sub-emit request.
    void drainSubEmitters(ecs::Registry& registry, Entity parent, Entity child,
                          f32 inheritVelocity, f32 chance);

    void updateParticles(const ecs::ParticleEmitter& emitter, EmitterState& state, f32 dt,
                         const ColorLut* colorLut, const SizeLut* sizeLut,
                         const SizeLut* speedLut,
                         const EmitterFrame& frame, bool isWorldSpace);
    void collisionStep(const ecs::ParticleEmitter&, EmitterState&, Particle&, glm::vec3 from,
                       const EmitterFrame&, bool world);
    void collide(const ecs::ParticleEmitter&, EmitterState&, Particle&, glm::vec3 point,
                 glm::vec3 normal, u32 body, const EmitterFrame&, bool world);
    void floorCollision(const ecs::ParticleEmitter&, EmitterState&, Particle&, const EmitterFrame&, bool world);
    f32 randomRange(f32 min, f32 max);



    // A parent particle's birth/death position + velocity, queued during a parent's
    // update and drained into its child sub-emitter right after.
    struct SubEmitRequest { glm::vec3 position; glm::vec3 velocity; u32 depth = 0; };
    std::vector<SubEmitRequest> subemit_requests_;

    struct PendingCollision { Entity emitter; u32 generation; EmitterFrame frame; bool world; std::size_t stats; };
    std::vector<CollisionQuery> collision_queries_;
    std::vector<PendingCollision> collision_pending_;
    std::vector<CollisionEvent> collision_events_;
    std::vector<CollisionStats> collision_stats_;
    std::vector<glm::vec3> collision_cameras_;
    Entity collision_emitter_{};
    std::size_t collision_stats_index_ = 0;
    u32 query_budget_ = 4096, event_budget_ = 1024, event_attempts_ = 0;
    u32 collision_child_bursts_ = 0;
    u32 collision_frame_ = 0;
    bool collision_debug_ = false;
    std::unordered_map<Entity, u32> collision_quotas_;
    std::unordered_map<Entity, EmitterState> states_;
    // A play() that arrives before the emitter's first update (its state isn't
    // created yet) is remembered here and applied on state creation, not dropped.
    std::unordered_set<Entity> pending_play_;
    std::unordered_map<Entity, ColorLut> colorLuts_;
    std::unordered_map<Entity, SizeLut> sizeLuts_;
    std::unordered_map<Entity, SizeLut> speedLuts_;
    std::unordered_map<Entity, std::vector<ScheduledBurst>> burstSchedules_;
    std::mt19937 rng_;
    bool gpu_available_ = false;
    u32 particle_limit_ = 0xffffffffu;
    std::vector<u32> dead_particle_indices_;
    // Active scene force fields, rebuilt each update() and applied to world-space
    // particles during integration.
    std::vector<ForceFieldInstance> force_fields_;
    // RAII: auto-unregisters from the registry's onDestroy when this system is
    // destroyed, so a torn-down system never leaves a dangling `this` behind.
    Connection destroyConn_;
};

}  // namespace esengine::particle

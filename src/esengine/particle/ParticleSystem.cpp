// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "ParticleSystem.hpp"
#include "ParticleNoise.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>

#include "../core/RandomSource.hpp"

namespace esengine::particle {

ParticleSystem::ParticleSystem() : rng_(RandomSource().stream(kRandomStream)) {
}

void ParticleSystem::reseedFrom(const esengine::RandomSource& source) {
    rng_ = source.stream(kRandomStream);
}

void ParticleSystem::update(ecs::Registry& registry, f32 dt) {
    if (!destroyConn_.isConnected()) {
        destroyConn_ = registry.onDestroy([this](Entity entity) {
            states_.erase(entity);
            pending_play_.erase(entity);
            colorLuts_.erase(entity);
            sizeLuts_.erase(entity);
            speedLuts_.erase(entity);
        });
    }

    // Flatten the active force fields once so the per-particle loop touches no
    // components. Fields are world objects, applied to world-space particles.
    force_fields_.clear();
    auto ffView = registry.view<ecs::Transform, ecs::ParticleForceField>();
    for (auto ffEntity : ffView) {
        const auto& ff = ffView.get<ecs::ParticleForceField>(ffEntity);
        if (!ff.enabled || ff.strength == 0.0f) continue;
        auto& ffTransform = ffView.get<ecs::Transform>(ffEntity);
        ffTransform.ensureDecomposed();
        f32 dl = std::sqrt(ff.direction.x * ff.direction.x + ff.direction.y * ff.direction.y
                           + ff.direction.z * ff.direction.z);
        ForceFieldInstance inst;
        inst.type = ff.type;
        inst.position = ffTransform.worldPosition;
        inst.direction = dl > 1e-6f ? ff.direction / dl : glm::vec3(1.0f, 0.0f, 0.0f);
        inst.strength = ff.strength;
        inst.radius = ff.radius;
        inst.radiusSq = ff.radius * ff.radius;
        inst.falloff = ff.falloff;
        force_fields_.push_back(inst);
    }

    auto view = registry.view<ecs::Transform, ecs::ParticleEmitter>();
    for (auto entity : view) {
        const auto& emitter = view.get<ecs::ParticleEmitter>(entity);
        const auto& transform = view.get<ecs::Transform>(entity);

        if (!emitter.enabled) {
            continue;
        }

        auto it = states_.find(entity);
        if (it == states_.end()) {
            auto [insertIt, _] = states_.emplace(
                entity,
                // Clamp defensively: maxParticles is inspector-constrained (min=1)
                // but a script, scene file, or replicated value bypasses that — a
                // negative cast to u32 (or a multi-billion count) would resize the
                // pool into a bad_alloc.
                EmitterState(static_cast<u32>(std::clamp(emitter.maxParticles, 0, 1'000'000)))
            );
            it = insertIt;
            if (emitter.playOnStart) {
                it->second.playing = true;
            }
            // Apply a play() that arrived before this first update (playOnStart=false
            // + an immediate trigger) instead of dropping it.
            if (pending_play_.erase(entity) > 0) {
                it->second.playing = true;
                it->second.elapsed_time = 0.0f;
            }
        }

        auto& state = it->second;

        // Size the per-particle trail history the first time this emitter uses
        // trails (kept free when they're off). Sized before emission so a spawn
        // this frame can reset its slot.
        if (emitter.trailEnabled && state.trail_count.size() != state.pool.capacity()) {
            state.trail_count.assign(state.pool.capacity(), 0);
            state.trail_pos.assign(static_cast<std::size_t>(state.pool.capacity()) * kMaxTrailPoints,
                                   glm::vec3(0.0f));
        }

        if (state.first_update && emitter.playOnStart) {
            state.playing = true;
            state.first_update = false;
        }

        bool emitting = state.playing;
        if (!emitter.looping && state.elapsed_time >= emitter.duration) {
            emitting = false;
        }

        if (emitting) {
            state.elapsed_time += dt;

            if (emitter.rate > 0.0f) {
                state.emission_accumulator += emitter.rate * dt;
                u32 toEmit = static_cast<u32>(state.emission_accumulator);
                if (toEmit > 0) {
                    state.emission_accumulator -= static_cast<f32>(toEmit);
                    emitParticles(emitter, transform, state, toEmit);
                }
            }

            if (emitter.burstCount > 0) {
                if (state.burst_timer <= 0.0f) {
                    emitParticles(emitter, transform, state,
                                  static_cast<u32>(emitter.burstCount));
                    state.burst_timer = emitter.burstInterval;
                }
                state.burst_timer -= dt;
            }
        }

        const EmitterFrame frame{transform.worldPosition, transform.worldRotation,
                                 transform.worldScale};
        bool isWorldSpace = emitter.simulationSpace ==
                            static_cast<i32>(ecs::SimulationSpace::World);

        auto lutIt = colorLuts_.find(entity);
        auto sizeIt = sizeLuts_.find(entity);
        auto speedIt = speedLuts_.find(entity);
        updateParticles(emitter, state, dt,
                        lutIt != colorLuts_.end() ? &lutIt->second : nullptr,
                        sizeIt != sizeLuts_.end() ? &sizeIt->second : nullptr,
                        speedIt != speedLuts_.end() ? &speedIt->second : nullptr,
                        frame, isWorldSpace);

        // Fire the child sub-emitter's burst at every birth/death queued this frame.
        if (emitter.subEmitter != 0 && !subemit_requests_.empty()) {
            drainSubEmitters(registry, Entity::fromRaw(emitter.subEmitter),
                             emitter.subEmitterInheritVelocity, emitter.subEmitterChance);
        }
    }
}

void ParticleSystem::play(Entity entity) {
    auto it = states_.find(entity);
    if (it != states_.end()) {
        it->second.playing = true;
        it->second.elapsed_time = 0.0f;
    } else {
        // State is created lazily on the first update; remember the trigger so it
        // isn't lost when play() runs before this emitter's first update.
        pending_play_.insert(entity);
    }
}

void ParticleSystem::stop(Entity entity) {
    pending_play_.erase(entity);
    auto it = states_.find(entity);
    if (it != states_.end()) {
        it->second.playing = false;
    }
}

void ParticleSystem::reset(Entity entity) {
    pending_play_.erase(entity);
    auto it = states_.find(entity);
    if (it != states_.end()) {
        it->second.pool.clear();
        it->second.emission_accumulator = 0.0f;
        it->second.elapsed_time = 0.0f;
        it->second.burst_timer = 0.0f;
        it->second.playing = false;
    }
}

void ParticleSystem::setColorLut(Entity entity, const f32* rgba, i32 count) {
    if (count != kColorLutSize || rgba == nullptr) {
        colorLuts_.erase(entity); // 0 (or a mismatched bake) clears → fall back to start/end
        return;
    }
    ColorLut& lut = colorLuts_[entity];
    for (std::size_t i = 0; i < kColorLutSize; ++i) {
        lut[i] = glm::vec4(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]);
    }
}

void ParticleSystem::setSizeLut(Entity entity, const f32* values, i32 count) {
    if (count != kColorLutSize || values == nullptr) {
        sizeLuts_.erase(entity);
        return;
    }
    SizeLut& lut = sizeLuts_[entity];
    for (std::size_t i = 0; i < kColorLutSize; ++i) lut[i] = values[i];
}

void ParticleSystem::setSpeedLut(Entity entity, const f32* values, i32 count) {
    if (count != kColorLutSize || values == nullptr) {
        speedLuts_.erase(entity);
        return;
    }
    SizeLut& lut = speedLuts_[entity];
    for (std::size_t i = 0; i < kColorLutSize; ++i) lut[i] = values[i];
}

u32 ParticleSystem::aliveCount(Entity entity) const {
    auto it = states_.find(entity);
    if (it != states_.end()) {
        return it->second.pool.aliveCount();
    }
    return 0;
}

u32 ParticleSystem::totalAliveParticles() const {
    u32 total = 0;
    for (const auto& [_, state] : states_) {
        total += state.pool.aliveCount();
    }
    return total;
}

void ParticleSystem::forEachParticle(Entity entity,
                                      const std::function<void(const Particle&)>& fn) const {
    auto it = states_.find(entity);
    if (it != states_.end()) {
        it->second.pool.forEachAlive(fn);
    }
}

EmitterState* ParticleSystem::getState(Entity entity) {
    auto it = states_.find(entity);
    return it != states_.end() ? &it->second : nullptr;
}

const EmitterState* ParticleSystem::getState(Entity entity) const {
    auto it = states_.find(entity);
    return it != states_.end() ? &it->second : nullptr;
}

void ParticleSystem::emitParticles(const ecs::ParticleEmitter& emitter,
                                    const ecs::Transform& transform,
                                    EmitterState& state, u32 count) {
    const EmitterFrame frame{transform.worldPosition, transform.worldRotation,
                             transform.worldScale};
    bool isWorldSpace = emitter.simulationSpace ==
                        static_cast<i32>(ecs::SimulationSpace::World);
    emitInto(emitter, state, frame, isWorldSpace, glm::vec3(0.0f), count,
             /*allowBirthTrigger=*/true);
}

void ParticleSystem::emitInto(const ecs::ParticleEmitter& emitter, EmitterState& state,
                              const EmitterFrame& frame, bool isWorldSpace,
                              glm::vec3 velocityBias, u32 count, bool allowBirthTrigger) {
    // Record each spawned particle for a Birth-triggered sub-emitter (in world
    // space, since a sub-burst is a world event).
    bool recordBirth = allowBirthTrigger &&
                       emitter.subEmitter != 0 &&
                       emitter.subEmitterTrigger ==
                           static_cast<i32>(ecs::SubEmitterTrigger::Birth);

    for (u32 i = 0; i < count; ++i) {
        Particle* p = state.pool.allocate();
        if (!p) {
            break;
        }

        // A reused pool slot must start with an empty trail, not the dead
        // particle's history.
        if (emitter.trailEnabled && !state.trail_count.empty()) {
            auto idx = static_cast<std::size_t>(p - state.pool.particles().data());
            if (idx < state.trail_count.size()) state.trail_count[idx] = 0;
        }

        p->lifetime = randomRange(emitter.lifetimeMin, emitter.lifetimeMax);
        p->age = 0.0f;

        p->start_size = randomRange(emitter.startSizeMin, emitter.startSizeMax);
        p->end_size = randomRange(emitter.endSizeMin, emitter.endSizeMax);
        p->size = p->start_size;

        p->start_color = emitter.startColor;
        p->end_color = emitter.endColor;
        p->color = p->start_color;

        p->rotation = randomRange(emitter.rotationMin, emitter.rotationMax);
        p->angular_velocity = randomRange(emitter.angularVelocityMin,
                                           emitter.angularVelocityMax);

        // ONE question to the shape, and the simulation asks nothing else: a new
        // shape cannot teach the integrator a new kind of aim.
        const SpawnSample sample =
            sampleShape(emitter, [this](f32 a, f32 b) { return randomRange(a, b); });

        p->position = isWorldSpace ? worldPointOf(sample.position, frame)
                                   : sample.position * frame.scale;

        const f32 speed = randomRange(emitter.speedMin, emitter.speedMax);
        const glm::vec3 dir = isWorldSpace ? worldDirOf(sample.direction, frame)
                                           : sample.direction;
        p->velocity = dir * speed + velocityBias;

        p->sprite_frame = 0;

        if (recordBirth) {
            glm::vec3 worldPos = isWorldSpace ? p->position
                                              : frame.position + frame.rotation * p->position;
            glm::vec3 worldVel = isWorldSpace ? p->velocity : frame.rotation * p->velocity;
            subemit_requests_.push_back({worldPos, worldVel});
        }
    }
}

void ParticleSystem::drainSubEmitters(ecs::Registry& registry, Entity child,
                                      f32 inheritVelocity, f32 chance) {
    // Take ownership of the queue up front: emitInto below spawns into the child
    // with allowBirthTrigger=false, so it never re-enters this buffer, but swapping
    // also leaves the member clean if the child reference is stale.
    std::vector<SubEmitRequest> requests;
    requests.swap(subemit_requests_);

    if (!registry.valid(child) || !registry.has<ecs::ParticleEmitter>(child)) {
        return;  // a deleted/retargeted child just drops its bursts
    }
    const auto& childEmitter = registry.get<ecs::ParticleEmitter>(child);

    // The child's own state may not exist yet (it's created lazily when the main
    // loop reaches it); make it on demand so a burst is never lost.
    auto it = states_.find(child);
    if (it == states_.end()) {
        auto [insertIt, _] = states_.emplace(
            child, EmitterState(static_cast<u32>(std::clamp(childEmitter.maxParticles, 0, 1'000'000))));
        it = insertIt;
    }
    EmitterState& childState = it->second;

    // The child's burstCount sizes each sub-burst (fall back to 1 so a misconfigured
    // template still shows something).
    u32 count = childEmitter.burstCount > 0 ? static_cast<u32>(childEmitter.burstCount) : 1;
    for (const auto& req : requests) {
        if (chance < 1.0f && randomRange(0.0f, 1.0f) >= chance) {
            continue;
        }
        // A sub-burst happens where the parent particle died, unrotated and
        // unscaled: the child's own shape is what aims it, and a particle carries
        // no orientation to inherit.
        emitInto(childEmitter, childState, EmitterFrame{req.position, glm::quat(1, 0, 0, 0),
                                                        glm::vec3(1.0f)}, /*isWorldSpace=*/true,
                 req.velocity * inheritVelocity, count, /*allowBirthTrigger=*/false);
    }
}

// Sample a baked color-over-life LUT at t∈[0,1] with linear interpolation between
// the two nearest entries — the editor authors a gradient, TS bakes it to this.
static glm::vec4 sampleColorLut(const ColorLut& lut, f32 t) {
    f32 f = std::clamp(t, 0.0f, 1.0f) * static_cast<f32>(kColorLutSize - 1);
    auto i = static_cast<std::size_t>(f);
    std::size_t j = std::min(i + 1, static_cast<std::size_t>(kColorLutSize - 1));
    return math::lerp(lut[i], lut[j], f - static_cast<f32>(i));
}

static f32 sampleSizeLut(const SizeLut& lut, f32 t) {
    f32 f = std::clamp(t, 0.0f, 1.0f) * static_cast<f32>(kColorLutSize - 1);
    auto i = static_cast<std::size_t>(f);
    std::size_t j = std::min(i + 1, static_cast<std::size_t>(kColorLutSize - 1));
    return math::lerp(lut[i], lut[j], f - static_cast<f32>(i));
}

// Fold one force field into a world-space particle's velocity.
static void applyForceField(const ForceFieldInstance& ff, Particle& p, f32 dt) {
    glm::vec3 toField = ff.position - p.position;  // field ← particle
    // The zone is a ball: a radius that drops depth pulls on particles a room away.
    f32 distSq = toField.x * toField.x + toField.y * toField.y + toField.z * toField.z;
    f32 factor = 1.0f;
    if (ff.radius > 0.0f) {
        if (distSq > ff.radiusSq) return;  // outside the zone
        if (ff.falloff) factor = 1.0f - std::sqrt(distSq) / ff.radius;
    }
    switch (static_cast<ecs::ForceFieldType>(ff.type)) {
        case ecs::ForceFieldType::Directional:
            p.velocity += ff.direction * (ff.strength * factor * dt);
            break;
        case ecs::ForceFieldType::Point: {
            f32 d = std::sqrt(distSq);
            if (d > 1e-4f) p.velocity += (toField / d) * (ff.strength * factor * dt);
            break;
        }
        case ecs::ForceFieldType::Vortex: {
            f32 d = std::sqrt(distSq);
            if (d > 1e-4f) {
                glm::vec3 radial = -toField / d;  // field → particle
                // A vortex needs an axis to swirl about, and the field's own
                // direction is the one it has; world up when it names none.
                glm::vec3 axis = glm::length(ff.direction) > 1e-6f
                    ? glm::normalize(ff.direction) : glm::vec3(0.0f, 0.0f, 1.0f);
                glm::vec3 perp = glm::cross(axis, radial);
                f32 pl = glm::length(perp);
                if (pl > 1e-6f) p.velocity += (perp / pl) * (ff.strength * factor * dt);
            }
            break;
        }
        case ecs::ForceFieldType::Drag:
            p.velocity *= (1.0f - std::min(ff.strength * factor * dt, 1.0f));
            break;
    }
}

void ParticleSystem::updateParticles(const ecs::ParticleEmitter& emitter,
                                      EmitterState& state, f32 dt,
                                      const ColorLut* colorLut, const SizeLut* sizeLut,
                                      const SizeLut* speedLut,
                                      const EmitterFrame& frame,
                                      bool isWorldSpace) {
    auto sizeEasing = static_cast<EasingType>(emitter.sizeEasing);
    auto colorEasing = static_cast<EasingType>(emitter.colorEasing);
    i32 totalFrames = emitter.spriteColumns * emitter.spriteRows;

    // Record dying particles for a Death-triggered sub-emitter (world space — a
    // sub-burst is a world event). cos/sin convert a local-space death to world.
    bool recordDeath = emitter.subEmitter != 0 &&
                       emitter.subEmitterTrigger ==
                           static_cast<i32>(ecs::SubEmitterTrigger::Death);

    // Noise/Turbulence: a curl-noise flow field advected onto position. Strength 0
    // samples nothing (the whole module is free when unused). The scroll offset
    // drifts the field over a monotonic clock so pausing emission never snaps it.
    state.noise_time += dt;
    bool noiseOn = emitter.noiseStrength > 0.0f && emitter.noiseFrequency > 0.0f;
    glm::vec2 noiseScroll(emitter.noiseScrollSpeed * state.noise_time *
                          emitter.noiseFrequency);

    bool trailOn = emitter.trailEnabled && !state.trail_count.empty();
    int trailKeep = std::clamp(emitter.trailPoints, 2, kMaxTrailPoints);
    f32 trailMinDistSq = emitter.trailMinDistance * emitter.trailMinDistance;

    bool collisionOn = emitter.collisionEnabled && isWorldSpace;

    dead_particle_indices_.clear();

    state.pool.forEachAlive([&](Particle& p) {
        p.age += dt;

        if (p.age >= p.lifetime) {
            if (recordDeath) {
                glm::vec3 worldPos = isWorldSpace ? p.position
                                                  : frame.position + frame.rotation * p.position;
                glm::vec3 worldVel = isWorldSpace ? p.velocity : frame.rotation * p.velocity;
                subemit_requests_.push_back({worldPos, worldVel});
            }
            u32 idx = static_cast<u32>(&p - &state.pool.particles()[0]);
            dead_particle_indices_.push_back(idx);
            return;
        }

        f32 t = p.age / p.lifetime;

        p.velocity += emitter.gravity * dt;
        if (isWorldSpace && !force_fields_.empty()) {
            for (const auto& ff : force_fields_) applyForceField(ff, p, dt);
        }
        if (emitter.damping > 0.0f) {
            p.velocity *= (1.0f - emitter.damping * dt);
        }
        // Applied to the STEP, not to velocity, so speed-over-life cannot become
        // a second force system: gravity, damping and noise still accumulate into
        // velocity exactly as before.
        p.position += p.velocity * (speedLut ? sampleSizeLut(*speedLut, t) : 1.0f) * dt;

        if (noiseOn) {
            // The curl field is a 2D flow, sampled on the plane the particle is
            // over. Depth passes through it: turbulence that also pushed on z
            // would be a different field, not this one read further.
            glm::vec2 sample = glm::vec2(p.position) * emitter.noiseFrequency + noiseScroll;
            glm::vec2 flow = noise::curl(sample, emitter.noiseOctaves);
            p.position += glm::vec3(flow, 0.0f) * emitter.noiseStrength * dt;
        }

        // Floor collision: a particle that has fallen through the floor plane while
        // moving down is snapped back and bounced, losing tangential speed to friction
        // and (optionally) some life. Done before the trail records so the streak
        // follows the bounce.
        if (collisionOn && p.position.y < emitter.collisionFloor && p.velocity.y < 0.0f) {
            p.position.y = emitter.collisionFloor;
            p.velocity.y = -p.velocity.y * emitter.collisionBounce;
            p.velocity.x *= (1.0f - emitter.collisionFriction);
            if (emitter.collisionLifetimeLoss > 0.0f) {
                p.age += emitter.collisionLifetimeLoss * p.lifetime;
            }
        }

        // Record the settled position into this particle's trail ring (oldest→newest),
        // gated by trailMinDistance so a slow particle doesn't pile up coincident points.
        if (trailOn) {
            auto idx = static_cast<std::size_t>(&p - state.pool.particles().data());
            u8& cnt = state.trail_count[idx];
            glm::vec3* ring = &state.trail_pos[idx * kMaxTrailPoints];
            bool record = cnt == 0;
            if (!record) {
                glm::vec3 d = p.position - ring[cnt - 1];
                record = glm::dot(d, d) >= trailMinDistSq;
            }
            if (record) {
                if (cnt < trailKeep) {
                    ring[cnt++] = p.position;
                } else {
                    for (int k = 1; k < trailKeep; ++k) ring[k - 1] = ring[k];
                    ring[trailKeep - 1] = p.position;
                }
            }
        }

        p.rotation += p.angular_velocity * dt;

        if (sizeLut) {
            p.size = p.start_size * sampleSizeLut(*sizeLut, t);
        } else {
            f32 sizeT = applyEasing(sizeEasing, t);
            p.size = math::lerp(p.start_size, p.end_size, sizeT);
        }

        if (colorLut) {
            p.color = sampleColorLut(*colorLut, t);
        } else {
            f32 colorT = applyEasing(colorEasing, t);
            p.color = math::lerp(p.start_color, p.end_color, colorT);
        }

        if (totalFrames > 1 && emitter.spriteFPS > 0.0f) {
            f32 frameDuration = 1.0f / emitter.spriteFPS;
            f32 rawFrame = p.age / frameDuration;
            // Compute the wrap on the float (fmod) so a looping sheet actually
            // cycles: clamping to [0,totalFrames-1] first would make the modulo an
            // identity and freeze every particle on the last frame after one pass.
            u16 frame;
            if (emitter.spriteLoop) {
                frame = static_cast<u16>(std::fmod(rawFrame, static_cast<f32>(totalFrames)));
            } else {
                frame = static_cast<u16>(std::min(rawFrame, static_cast<f32>(totalFrames - 1)));
            }
            p.sprite_frame = frame;
        }
    });

    for (u32 idx : dead_particle_indices_) {
        state.pool.deallocateByIndex(idx);
    }
}


f32 ParticleSystem::randomRange(f32 min, f32 max) {
    if (min >= max) {
        return min;
    }
    std::uniform_real_distribution<f32> dist(min, max);
    return dist(rng_);
}

// An aim in the emitter's own plane: an angle names a direction there, and the
// emitter's rotation is what turns the plane. Aiming out of it is the emitter's
// job to be turned, not this one's to invent a second angle nobody authored.
}  // namespace esengine::particle

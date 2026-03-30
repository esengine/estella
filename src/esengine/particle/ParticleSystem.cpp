#include "ParticleSystem.hpp"

#include <algorithm>
#include <chrono>

namespace esengine::particle {

ParticleSystem::ParticleSystem()
    : rng_(static_cast<u32>(std::chrono::steady_clock::now().time_since_epoch().count())) {
}

void ParticleSystem::update(ecs::Registry& registry, f32 dt) {
    if (destroy_callback_id_ == 0) {
        destroy_callback_id_ = registry.onDestroy([this](Entity entity) {
            states_.erase(entity);
        });
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
                EmitterState(static_cast<u32>(emitter.maxParticles))
            );
            it = insertIt;
            if (emitter.playOnStart) {
                it->second.playing = true;
            }
        }

        auto& state = it->second;

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

        updateParticles(emitter, state, dt);
    }
}

void ParticleSystem::play(Entity entity) {
    auto it = states_.find(entity);
    if (it != states_.end()) {
        it->second.playing = true;
        it->second.elapsed_time = 0.0f;
    }
}

void ParticleSystem::stop(Entity entity) {
    auto it = states_.find(entity);
    if (it != states_.end()) {
        it->second.playing = false;
    }
}

void ParticleSystem::reset(Entity entity) {
    auto it = states_.find(entity);
    if (it != states_.end()) {
        it->second.pool.clear();
        it->second.emission_accumulator = 0.0f;
        it->second.elapsed_time = 0.0f;
        it->second.burst_timer = 0.0f;
        it->second.playing = false;
    }
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
    glm::vec2 emitterPos(transform.worldPosition.x, transform.worldPosition.y);
    f32 emitterAngle = 0.0f;
    if (transform.worldRotation.w != 1.0f || transform.worldRotation.z != 0.0f) {
        emitterAngle = 2.0f * std::atan2(transform.worldRotation.z,
                                           transform.worldRotation.w);
    }

    for (u32 i = 0; i < count; ++i) {
        Particle* p = state.pool.allocate();
        if (!p) {
            break;
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

        glm::vec2 offset = randomShapeOffset(emitter);
        bool isWorldSpace = emitter.simulationSpace ==
                            static_cast<i32>(ecs::SimulationSpace::World);
        if (isWorldSpace) {
            p->position = emitterPos + offset;
        } else {
            p->position = offset;
        }

        f32 speed = randomRange(emitter.speedMin, emitter.speedMax);
        glm::vec2 dir;
        auto shape = static_cast<ecs::EmitterShape>(emitter.shape);
        switch (shape) {
            case ecs::EmitterShape::Circle: {
                f32 offsetLen = glm::length(offset);
                if (offsetLen > 0.001f) {
                    dir = offset / offsetLen;
                } else {
                    dir = randomDirection(0.0f, 360.0f);
                }
                break;
            }
            case ecs::EmitterShape::Rectangle:
                dir = glm::vec2(0.0f, 1.0f);
                break;
            case ecs::EmitterShape::Cone: {
                f32 halfAngle = emitter.shapeAngle * 0.5f * math::DEG_TO_RAD;
                f32 angle = randomRange(-halfAngle, halfAngle);
                dir = glm::vec2(std::sin(angle), std::cos(angle));
                break;
            }
            case ecs::EmitterShape::Point:
            default:
                dir = randomDirection(emitter.angleSpreadMin, emitter.angleSpreadMax);
                break;
        }
        if (isWorldSpace && std::abs(emitterAngle) > 0.001f) {
            f32 cosA = std::cos(emitterAngle);
            f32 sinA = std::sin(emitterAngle);
            dir = glm::vec2(dir.x * cosA - dir.y * sinA,
                            dir.x * sinA + dir.y * cosA);
        }
        p->velocity = dir * speed;

        p->sprite_frame = 0;
    }
}

void ParticleSystem::updateParticles(const ecs::ParticleEmitter& emitter,
                                      EmitterState& state, f32 dt) {
    auto sizeEasing = static_cast<EasingType>(emitter.sizeEasing);
    auto colorEasing = static_cast<EasingType>(emitter.colorEasing);
    i32 totalFrames = emitter.spriteColumns * emitter.spriteRows;

    dead_particle_indices_.clear();

    state.pool.forEachAlive([&](Particle& p) {
        p.age += dt;

        if (p.age >= p.lifetime) {
            u32 idx = static_cast<u32>(&p - &state.pool.particles()[0]);
            dead_particle_indices_.push_back(idx);
            return;
        }

        f32 t = p.age / p.lifetime;

        p.velocity += emitter.gravity * dt;
        if (emitter.damping > 0.0f) {
            p.velocity *= (1.0f - emitter.damping * dt);
        }
        p.position += p.velocity * dt;

        p.rotation += p.angular_velocity * dt;

        f32 sizeT = applyEasing(sizeEasing, t);
        p.size = math::lerp(p.start_size, p.end_size, sizeT);

        f32 colorT = applyEasing(colorEasing, t);
        p.color = math::lerp(p.start_color, p.end_color, colorT);

        if (totalFrames > 1 && emitter.spriteFPS > 0.0f) {
            f32 frameDuration = 1.0f / emitter.spriteFPS;
            u16 frame = static_cast<u16>(std::min(p.age / frameDuration, static_cast<f32>(totalFrames - 1)));
            if (emitter.spriteLoop) {
                frame = frame % static_cast<u16>(totalFrames);
            } else {
                frame = std::min(frame, static_cast<u16>(totalFrames - 1));
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

glm::vec2 ParticleSystem::randomDirection(f32 angleMin, f32 angleMax) {
    f32 angleDeg = randomRange(angleMin, angleMax);
    f32 angleRad = angleDeg * math::DEG_TO_RAD;
    return glm::vec2(std::cos(angleRad), std::sin(angleRad));
}

glm::vec2 ParticleSystem::randomShapeOffset(const ecs::ParticleEmitter& emitter) {
    auto shape = static_cast<ecs::EmitterShape>(emitter.shape);
    switch (shape) {
        case ecs::EmitterShape::Circle: {
            f32 angle = randomRange(0.0f, math::TWO_PI);
            f32 radius = randomRange(0.0f, emitter.shapeRadius);
            return glm::vec2(std::cos(angle) * radius, std::sin(angle) * radius);
        }
        case ecs::EmitterShape::Rectangle: {
            f32 x = randomRange(-emitter.shapeSize.x * 0.5f, emitter.shapeSize.x * 0.5f);
            f32 y = randomRange(-emitter.shapeSize.y * 0.5f, emitter.shapeSize.y * 0.5f);
            return glm::vec2(x, y);
        }
        case ecs::EmitterShape::Cone: {
            f32 halfAngle = emitter.shapeAngle * 0.5f * math::DEG_TO_RAD;
            f32 angle = randomRange(-halfAngle, halfAngle);
            return glm::vec2(std::sin(angle), std::cos(angle)) * randomRange(0.0f, emitter.shapeRadius);
        }
        case ecs::EmitterShape::Point:
        default:
            return glm::vec2(0.0f);
    }
}

}  // namespace esengine::particle

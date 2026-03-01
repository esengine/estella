#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/ESEngine.hpp>
#include <esengine/particle/Particle.hpp>
#include <esengine/particle/ParticleEasing.hpp>
#include <esengine/particle/ParticleSystem.hpp>
#include <cmath>

using namespace esengine;
using namespace esengine::particle;

// ============================================================================
// ParticlePool Tests
// ============================================================================

TEST_CASE("pool_initial_state") {
    ParticlePool pool(100);
    CHECK_EQ(pool.capacity(), 100u);
    CHECK_EQ(pool.aliveCount(), 0u);
}

TEST_CASE("pool_allocate_single") {
    ParticlePool pool(10);
    Particle* p = pool.allocate();
    CHECK(p != nullptr);
    CHECK_EQ(pool.aliveCount(), 1u);
}

TEST_CASE("pool_allocate_returns_null_when_full") {
    ParticlePool pool(2);
    Particle* p1 = pool.allocate();
    Particle* p2 = pool.allocate();
    Particle* p3 = pool.allocate();
    CHECK(p1 != nullptr);
    CHECK(p2 != nullptr);
    CHECK(p3 == nullptr);
    CHECK_EQ(pool.aliveCount(), 2u);
}

TEST_CASE("pool_deallocate") {
    ParticlePool pool(10);
    Particle* p = pool.allocate();
    CHECK_EQ(pool.aliveCount(), 1u);
    pool.deallocate(p);
    CHECK_EQ(pool.aliveCount(), 0u);
}

TEST_CASE("pool_reuse_after_deallocate") {
    ParticlePool pool(1);
    Particle* p1 = pool.allocate();
    pool.deallocate(p1);
    Particle* p2 = pool.allocate();
    CHECK(p2 != nullptr);
    CHECK_EQ(pool.aliveCount(), 1u);
}

TEST_CASE("pool_clear") {
    ParticlePool pool(10);
    pool.allocate();
    pool.allocate();
    pool.allocate();
    CHECK_EQ(pool.aliveCount(), 3u);
    pool.clear();
    CHECK_EQ(pool.aliveCount(), 0u);
}

TEST_CASE("pool_iterate_alive") {
    ParticlePool pool(10);
    Particle* p1 = pool.allocate();
    Particle* p2 = pool.allocate();
    Particle* p3 = pool.allocate();
    p1->age = 1.0f;
    p2->age = 2.0f;
    p3->age = 3.0f;

    f32 totalAge = 0.0f;
    pool.forEachAlive([&](Particle& p) {
        totalAge += p.age;
    });
    CHECK(totalAge == doctest::Approx(6.0f).epsilon(0.001f));
}

// ============================================================================
// ParticleEasing Tests
// ============================================================================

TEST_CASE("easing_linear") {
    CHECK(applyEasing(EasingType::Linear, 0.0f) == doctest::Approx(0.0f).epsilon(0.001f));
    CHECK(applyEasing(EasingType::Linear, 0.5f) == doctest::Approx(0.5f).epsilon(0.001f));
    CHECK(applyEasing(EasingType::Linear, 1.0f) == doctest::Approx(1.0f).epsilon(0.001f));
}

TEST_CASE("easing_ease_in") {
    f32 mid = applyEasing(EasingType::EaseIn, 0.5f);
    CHECK(mid < 0.5f);
    CHECK(applyEasing(EasingType::EaseIn, 0.0f) == doctest::Approx(0.0f).epsilon(0.001f));
    CHECK(applyEasing(EasingType::EaseIn, 1.0f) == doctest::Approx(1.0f).epsilon(0.001f));
}

TEST_CASE("easing_ease_out") {
    f32 mid = applyEasing(EasingType::EaseOut, 0.5f);
    CHECK(mid > 0.5f);
    CHECK(applyEasing(EasingType::EaseOut, 0.0f) == doctest::Approx(0.0f).epsilon(0.001f));
    CHECK(applyEasing(EasingType::EaseOut, 1.0f) == doctest::Approx(1.0f).epsilon(0.001f));
}

TEST_CASE("easing_ease_in_out") {
    CHECK(applyEasing(EasingType::EaseInOut, 0.0f) == doctest::Approx(0.0f).epsilon(0.001f));
    CHECK(applyEasing(EasingType::EaseInOut, 0.5f) == doctest::Approx(0.5f).epsilon(0.001f));
    CHECK(applyEasing(EasingType::EaseInOut, 1.0f) == doctest::Approx(1.0f).epsilon(0.001f));
    f32 quarter = applyEasing(EasingType::EaseInOut, 0.25f);
    CHECK(quarter < 0.25f);
}

// ============================================================================
// ParticleSystem Tests
// ============================================================================

TEST_CASE("system_no_emitters_no_crash") {
    ecs::Registry registry;
    ParticleSystem system;
    system.update(registry, 0.016f);
    CHECK_EQ(system.totalAliveParticles(), 0u);
}

TEST_CASE("system_emitter_spawns_particles") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 100.0f;
    emitter.lifetimeMin = 1.0f;
    emitter.lifetimeMax = 1.0f;
    emitter.maxParticles = 1000;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.1f);
    CHECK(system.totalAliveParticles() > 0u);
}

TEST_CASE("system_particles_die_after_lifetime") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 0.05f;
    emitter.lifetimeMax = 0.05f;
    emitter.maxParticles = 1000;
    emitter.enabled = true;
    emitter.playOnStart = true;
    emitter.looping = false;
    emitter.duration = 0.01f;

    system.update(registry, 0.01f);
    u32 alive = system.totalAliveParticles();
    CHECK(alive > 0u);

    system.update(registry, 0.06f);
    CHECK_EQ(system.totalAliveParticles(), 0u);
}

TEST_CASE("system_non_looping_stops_after_duration") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 100.0f;
    emitter.lifetimeMin = 0.5f;
    emitter.lifetimeMax = 0.5f;
    emitter.maxParticles = 1000;
    emitter.duration = 0.1f;
    emitter.looping = false;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.05f);
    u32 alive1 = system.totalAliveParticles();
    CHECK(alive1 > 0u);

    system.update(registry, 0.06f);
    u32 alive2 = system.totalAliveParticles();

    system.update(registry, 0.5f);
    CHECK_EQ(system.totalAliveParticles(), 0u);
}

TEST_CASE("system_disabled_emitter_no_spawn") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 100.0f;
    emitter.enabled = false;

    system.update(registry, 0.1f);
    CHECK_EQ(system.totalAliveParticles(), 0u);
}

TEST_CASE("system_gravity_affects_velocity") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 100;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f, -100.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);

    bool hasDownwardVelocity = false;
    system.forEachParticle(e, [&](const Particle& p) {
        if (p.velocity.y < -0.5f) {
            hasDownwardVelocity = true;
        }
    });
    CHECK(hasDownwardVelocity);
}

TEST_CASE("system_size_interpolation") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 1.0f;
    emitter.lifetimeMax = 1.0f;
    emitter.maxParticles = 100;
    emitter.startSizeMin = 10.0f;
    emitter.startSizeMax = 10.0f;
    emitter.endSizeMin = 0.0f;
    emitter.endSizeMax = 0.0f;
    emitter.sizeEasing = static_cast<i32>(EasingType::Linear);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    system.update(registry, 0.5f);

    bool hasShrunk = false;
    system.forEachParticle(e, [&](const Particle& p) {
        if (p.size < 9.0f && p.size > 0.0f) {
            hasShrunk = true;
        }
    });
    CHECK(hasShrunk);
}

TEST_CASE("system_cleanup_destroyed_entity") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 100.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 1000;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.1f);
    CHECK(system.totalAliveParticles() > 0u);

    registry.destroy(e);
    system.update(registry, 0.1f);
    CHECK_EQ(system.totalAliveParticles(), 0u);
}

TEST_CASE("system_play_stop_reset") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 100.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 1000;
    emitter.enabled = true;
    emitter.playOnStart = false;

    system.update(registry, 0.1f);
    CHECK_EQ(system.totalAliveParticles(), 0u);

    system.play(e);
    system.update(registry, 0.1f);
    CHECK(system.totalAliveParticles() > 0u);

    system.stop(e);
    u32 countAfterStop = system.totalAliveParticles();
    system.update(registry, 0.1f);
    CHECK(system.totalAliveParticles() <= countAfterStop);

    system.reset(e);
    CHECK_EQ(system.aliveCount(e), 0u);
}

TEST_CASE("system_burst_emission") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 0.0f;
    emitter.burstCount = 50;
    emitter.burstInterval = 0.5f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 1000;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK_EQ(system.aliveCount(e), 50u);

    system.update(registry, 0.1f);
    CHECK_EQ(system.aliveCount(e), 50u);

    system.update(registry, 0.5f);
    CHECK_EQ(system.aliveCount(e), 50u);

    system.update(registry, 0.01f);
    CHECK_EQ(system.aliveCount(e), 100u);
}

// ============================================================================
// Shape Tests
// ============================================================================

TEST_CASE("shape_point_spawns_at_origin") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Point);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 100;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    bool allAtOrigin = true;
    system.forEachParticle(e, [&](const Particle& p) {
        if (std::abs(p.position.x) > 0.001f || std::abs(p.position.y) > 0.001f) {
            allAtOrigin = false;
        }
    });
    CHECK(allAtOrigin);
}

TEST_CASE("shape_circle_within_radius") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Circle);
    emitter.shapeRadius = 5.0f;
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 200;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    bool allWithinRadius = true;
    bool hasSomeOffset = false;
    system.forEachParticle(e, [&](const Particle& p) {
        f32 dist = glm::length(p.position);
        if (dist > 5.0f + 0.001f) {
            allWithinRadius = false;
        }
        if (dist > 0.1f) {
            hasSomeOffset = true;
        }
    });
    CHECK(allWithinRadius);
    CHECK(hasSomeOffset);
}

TEST_CASE("shape_rectangle_within_bounds") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Rectangle);
    emitter.shapeSize = glm::vec2(10.0f, 6.0f);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 200;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    bool allWithinBounds = true;
    bool hasSomeOffset = false;
    constexpr f32 HALF_W = 5.0f;
    constexpr f32 HALF_H = 3.0f;
    system.forEachParticle(e, [&](const Particle& p) {
        if (std::abs(p.position.x) > HALF_W + 0.001f ||
            std::abs(p.position.y) > HALF_H + 0.001f) {
            allWithinBounds = false;
        }
        if (std::abs(p.position.x) > 0.1f || std::abs(p.position.y) > 0.1f) {
            hasSomeOffset = true;
        }
    });
    CHECK(allWithinBounds);
    CHECK(hasSomeOffset);
}

TEST_CASE("shape_cone_position_within_angle") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Cone);
    emitter.shapeAngle = 30.0f;
    emitter.shapeRadius = 5.0f;
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 200;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    constexpr f32 HALF_ANGLE_RAD = 15.0f * math::DEG_TO_RAD;
    f32 cosHalf = std::cos(HALF_ANGLE_RAD);

    bool allWithinCone = true;
    bool hasSomeOffset = false;
    system.forEachParticle(e, [&](const Particle& p) {
        f32 dist = glm::length(p.position);
        if (dist < 0.001f) return;
        hasSomeOffset = true;
        if (dist > 5.0f + 0.001f) {
            allWithinCone = false;
            return;
        }
        glm::vec2 dir = glm::normalize(p.position);
        if (dir.y < cosHalf - 0.01f) {
            allWithinCone = false;
        }
    });
    CHECK(allWithinCone);
    CHECK(hasSomeOffset);
}

// ============================================================================
// Color Interpolation Tests
// ============================================================================

TEST_CASE("system_color_interpolation") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 1.0f;
    emitter.lifetimeMax = 1.0f;
    emitter.maxParticles = 100;
    emitter.startColor = glm::vec4(1.0f, 0.0f, 0.0f, 1.0f);
    emitter.endColor = glm::vec4(0.0f, 0.0f, 1.0f, 0.0f);
    emitter.colorEasing = static_cast<i32>(EasingType::Linear);
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    system.update(registry, 0.5f);

    bool hasInterpolated = false;
    system.forEachParticle(e, [&](const Particle& p) {
        if (p.age > 0.3f && p.age < 0.7f) {
            if (p.color.r < 0.9f && p.color.b > 0.1f && p.color.a < 0.9f) {
                hasInterpolated = true;
            }
        }
    });
    CHECK(hasInterpolated);
}

// ============================================================================
// Rotation Tests
// ============================================================================

TEST_CASE("system_angular_velocity") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 100;
    emitter.rotationMin = 0.0f;
    emitter.rotationMax = 0.0f;
    emitter.angularVelocityMin = 90.0f;
    emitter.angularVelocityMax = 90.0f;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    system.update(registry, 1.0f);

    bool hasRotated = false;
    system.forEachParticle(e, [&](const Particle& p) {
        if (std::abs(p.rotation) > 45.0f) {
            hasRotated = true;
        }
    });
    CHECK(hasRotated);
}

// ============================================================================
// Damping Tests
// ============================================================================

TEST_CASE("system_damping_reduces_velocity") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 100;
    emitter.speedMin = 100.0f;
    emitter.speedMax = 100.0f;
    emitter.angleSpreadMin = 90.0f;
    emitter.angleSpreadMax = 90.0f;
    emitter.damping = 5.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);

    for (int i = 0; i < 20; ++i) {
        system.update(registry, 0.1f);
    }

    bool allSlowed = true;
    system.forEachParticle(e, [&](const Particle& p) {
        f32 speed = glm::length(p.velocity);
        if (speed > 50.0f) {
            allSlowed = false;
        }
    });
    CHECK(allSlowed);
}

// ============================================================================
// Sprite Animation Tests
// ============================================================================

TEST_CASE("system_sprite_animation_loop") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 10;
    emitter.spriteColumns = 4;
    emitter.spriteRows = 1;
    emitter.spriteFPS = 10.0f;
    emitter.spriteLoop = true;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    system.update(registry, 0.55f);

    bool hasWrapped = false;
    system.forEachParticle(e, [&](const Particle& p) {
        if (p.age > 0.4f && p.sprite_frame < 4) {
            hasWrapped = true;
        }
    });
    CHECK(hasWrapped);
}

TEST_CASE("system_sprite_animation_clamp") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 10;
    emitter.spriteColumns = 4;
    emitter.spriteRows = 1;
    emitter.spriteFPS = 10.0f;
    emitter.spriteLoop = false;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    system.update(registry, 2.0f);

    bool allClamped = true;
    system.forEachParticle(e, [&](const Particle& p) {
        if (p.sprite_frame != 3) {
            allClamped = false;
        }
    });
    CHECK(allClamped);
}

// ============================================================================
// Simulation Space Tests
// ============================================================================

TEST_CASE("system_local_space_ignores_emitter_position") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    auto& transform = registry.emplace<ecs::Transform>(e, glm::vec3(100.0f, 200.0f, 0.0f));
    transform.worldPosition = transform.position;
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.simulationSpace = static_cast<i32>(ecs::SimulationSpace::Local);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Point);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 100;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    bool allNearOrigin = true;
    system.forEachParticle(e, [&](const Particle& p) {
        if (std::abs(p.position.x) > 1.0f || std::abs(p.position.y) > 1.0f) {
            allNearOrigin = false;
        }
    });
    CHECK(allNearOrigin);
}

TEST_CASE("system_world_space_uses_emitter_position") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    auto& transform = registry.emplace<ecs::Transform>(e, glm::vec3(100.0f, 200.0f, 0.0f));
    transform.worldPosition = transform.position;
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.simulationSpace = static_cast<i32>(ecs::SimulationSpace::World);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Point);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 100;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    bool allNearEmitter = true;
    system.forEachParticle(e, [&](const Particle& p) {
        if (std::abs(p.position.x - 100.0f) > 1.0f ||
            std::abs(p.position.y - 200.0f) > 1.0f) {
            allNearEmitter = false;
        }
    });
    CHECK(allNearEmitter);
}

// ============================================================================
// Multiple Emitters / Max Particles / Looping Tests
// ============================================================================

TEST_CASE("system_multiple_emitters_independent") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e1 = registry.create();
    registry.emplace<ecs::Transform>(e1);
    auto& em1 = registry.emplace<ecs::ParticleEmitter>(e1);
    em1.rate = 100.0f;
    em1.lifetimeMin = 10.0f;
    em1.lifetimeMax = 10.0f;
    em1.maxParticles = 500;
    em1.enabled = true;
    em1.playOnStart = true;

    Entity e2 = registry.create();
    registry.emplace<ecs::Transform>(e2);
    auto& em2 = registry.emplace<ecs::ParticleEmitter>(e2);
    em2.rate = 200.0f;
    em2.lifetimeMin = 10.0f;
    em2.lifetimeMax = 10.0f;
    em2.maxParticles = 500;
    em2.enabled = true;
    em2.playOnStart = true;

    system.update(registry, 0.1f);

    u32 count1 = system.aliveCount(e1);
    u32 count2 = system.aliveCount(e2);
    CHECK(count1 > 0u);
    CHECK(count2 > 0u);
    CHECK(count2 > count1);
    CHECK_EQ(system.totalAliveParticles(), count1 + count2);
}

TEST_CASE("system_max_particles_cap") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 10000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 50;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 1.0f);
    CHECK(system.aliveCount(e) <= 50u);
}

TEST_CASE("system_looping_continues_past_duration") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 100.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 1000;
    emitter.duration = 0.1f;
    emitter.looping = true;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.05f);
    u32 countBefore = system.aliveCount(e);
    CHECK(countBefore > 0u);

    system.update(registry, 0.2f);
    u32 countAfter = system.aliveCount(e);
    CHECK(countAfter > countBefore);
}

// ============================================================================
// Angle Spread Tests
// ============================================================================

TEST_CASE("system_angle_spread_constrains_direction") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 200;
    emitter.speedMin = 100.0f;
    emitter.speedMax = 100.0f;
    emitter.angleSpreadMin = 80.0f;
    emitter.angleSpreadMax = 100.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.damping = 0.0f;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    bool allPositiveY = true;
    system.forEachParticle(e, [&](const Particle& p) {
        if (glm::length(p.velocity) < 0.001f) return;
        glm::vec2 dir = glm::normalize(p.velocity);
        if (dir.y < 0.0f) {
            allPositiveY = false;
        }
    });
    CHECK(allPositiveY);
}

// ============================================================================
// Shape Direction Tests (shape determines velocity direction)
// ============================================================================

TEST_CASE("shape_circle_direction_radial_outward") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Circle);
    emitter.shapeRadius = 5.0f;
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 200;
    emitter.speedMin = 10.0f;
    emitter.speedMax = 10.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.damping = 0.0f;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    bool allRadial = true;
    int checked = 0;
    system.forEachParticle(e, [&](const Particle& p) {
        f32 posDist = glm::length(p.position);
        if (posDist < 0.5f) return;
        f32 velLen = glm::length(p.velocity);
        if (velLen < 0.001f) return;
        glm::vec2 posDir = glm::normalize(p.position);
        glm::vec2 velDir = glm::normalize(p.velocity);
        if (glm::dot(posDir, velDir) < 0.7f) {
            allRadial = false;
        }
        checked++;
    });
    CHECK(checked > 0);
    CHECK(allRadial);
}

TEST_CASE("shape_rectangle_direction_upward") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Rectangle);
    emitter.shapeSize = glm::vec2(10.0f, 6.0f);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 200;
    emitter.speedMin = 10.0f;
    emitter.speedMax = 10.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.damping = 0.0f;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    bool allUpward = true;
    system.forEachParticle(e, [&](const Particle& p) {
        if (glm::length(p.velocity) < 0.001f) return;
        glm::vec2 dir = glm::normalize(p.velocity);
        if (dir.y < 0.95f) {
            allUpward = false;
        }
    });
    CHECK(allUpward);
}

TEST_CASE("shape_cone_direction_within_angle") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Cone);
    emitter.shapeAngle = 30.0f;
    emitter.shapeRadius = 0.0f;
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 200;
    emitter.speedMin = 10.0f;
    emitter.speedMax = 10.0f;
    emitter.gravity = glm::vec2(0.0f);
    emitter.damping = 0.0f;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    constexpr f32 HALF_ANGLE_RAD = 15.0f * math::DEG_TO_RAD;
    f32 cosHalf = std::cos(HALF_ANGLE_RAD);

    bool allWithinCone = true;
    system.forEachParticle(e, [&](const Particle& p) {
        if (glm::length(p.velocity) < 0.001f) return;
        glm::vec2 dir = glm::normalize(p.velocity);
        if (dir.y < cosHalf - 0.01f) {
            allWithinCone = false;
        }
    });
    CHECK(allWithinCone);
}

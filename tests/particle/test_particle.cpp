#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/ESEngine.hpp>
#include <esengine/particle/Particle.hpp>
#include <esengine/particle/ParticleEasing.hpp>
#include <esengine/particle/ParticleSystem.hpp>
#include <cmath>
#include <functional>

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

TEST_CASE("system_play_before_first_update_is_not_dropped") {
    // Emitter state is created lazily on the first update. A play() that fires
    // before that (playOnStart=false + an immediate script trigger) must be
    // remembered, not lost — otherwise the emitter stays off forever.
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
    emitter.playOnStart = false; // won't auto-play

    system.play(e);              // before any update — state doesn't exist yet
    system.update(registry, 0.1f);
    CHECK(system.totalAliveParticles() > 0u);
}

TEST_CASE("system_no_play_stays_idle_when_playOnStart_false") {
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
    emitter.playOnStart = false;

    system.update(registry, 0.1f); // no play() → nothing emits
    CHECK_EQ(system.totalAliveParticles(), 0u);
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

TEST_CASE("system_sprite_sheet_loops_instead_of_freezing") {
    // A looping sprite sheet must wrap back toward frame 0 after a full pass. A
    // pre-clamp regression made `frame % totalFrames` an identity, freezing every
    // particle on the last frame (index totalFrames-1) forever after one cycle.
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 500.0f;
    emitter.lifetimeMin = 100.0f;
    emitter.lifetimeMax = 100.0f;
    emitter.maxParticles = 1000;
    emitter.enabled = true;
    emitter.playOnStart = true;
    emitter.looping = false;
    emitter.duration = 0.02f;      // one short burst, then emission stops
    emitter.spriteColumns = 4;     // 4 frames total
    emitter.spriteRows = 1;
    emitter.spriteFPS = 1.0f;      // one 4-frame cycle every 4 s

    system.update(registry, 0.02f);   // spawn the burst (age ~0.02 s → frame 0)
    CHECK(system.totalAliveParticles() > 0u);

    system.update(registry, 4.1f);    // age ~4.12 s → past a full cycle, wrapped
    u32 checked = 0;
    system.forEachParticle(e, [&](const Particle& p) {
        CHECK(p.sprite_frame < 3);    // 3 = last frame; the bug froze here
        checked++;
    });
    CHECK(checked > 0u);
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

TEST_CASE("system_start_delay_holds_emission_back_then_runs_the_duration_from_its_end") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 100.0f;
    emitter.lifetimeMin = 5.0f;
    emitter.lifetimeMax = 5.0f;
    emitter.maxParticles = 1000;
    emitter.startDelay = 0.5f;
    emitter.duration = 0.1f;
    emitter.looping = false;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.2f);
    system.update(registry, 0.2f);
    CHECK_EQ(system.totalAliveParticles(), 0u);       // 0.4 s in: still inside the delay

    system.update(registry, 0.2f);                    // crosses 0.5 s: emission begins
    CHECK(system.totalAliveParticles() > 0u);
    const u32 started = system.totalAliveParticles();

    system.update(registry, 0.5f);                    // 0.6 s of play: the 0.1 s duration, counted from 0.5, has run out
    system.update(registry, 0.5f);
    CHECK_EQ(system.totalAliveParticles(), started);  // a stopped emitter adds nothing more
}

TEST_CASE("system_no_start_delay_emits_on_the_first_update_as_before") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 0.0f;
    emitter.burstCount = 7;
    emitter.lifetimeMin = 5.0f;
    emitter.lifetimeMax = 5.0f;
    emitter.maxParticles = 100;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.016f);
    CHECK_EQ(system.totalAliveParticles(), 7u);
}

TEST_CASE("system_added_velocity_moves_a_particle_that_gravity_and_damping_do_not_touch") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 0.0f;
    emitter.burstCount = 1;
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Point);
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 4;
    emitter.addedVelocityMin = {10.0f, 0.0f, 0.0f};
    emitter.addedVelocityMax = {10.0f, 0.0f, 0.0f};
    emitter.damping = 1.0f;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.016f);              // born
    system.update(registry, 0.5f);
    system.update(registry, 0.5f);
    auto* state = system.getState(e);
    REQUIRE(state != nullptr);
    f32 x = 0.0f;
    state->pool.forEachAlive([&](const Particle& p) { x = p.position.x; });
    CHECK(x == doctest::Approx(10.0f).epsilon(0.1));   // 10 per second for about a second, damping or not
}

TEST_CASE("system_speed_limit_holds_a_fast_particle_to_the_limit") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 0.0f;
    emitter.burstCount = 1;
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Point);
    emitter.angleSpreadMin = 0.0f;
    emitter.angleSpreadMax = 0.0f;
    emitter.speedMin = 100.0f;
    emitter.speedMax = 100.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 4;
    emitter.speedLimit = 10.0f;
    emitter.limitDampen = 1.0f;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.016f);
    system.update(registry, 0.016f);
    auto* state = system.getState(e);
    REQUIRE(state != nullptr);
    f32 speed = 0.0f;
    state->pool.forEachAlive([&](const Particle& p) { speed = glm::length(p.velocity); });
    CHECK(speed == doctest::Approx(10.0f).epsilon(0.01));
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
    emitter.gravity = glm::vec3(0.0f, -100.0f, 0.0f);
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

TEST_CASE("system_noise_off_leaves_ballistic_motion_untouched") {
    // With noiseStrength 0 the field is never sampled: a zero-velocity, zero-gravity
    // particle must stay exactly where it spawned, proving the module is truly inert
    // when off (no accidental jitter).
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 100;
    emitter.speedMin = emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec3(0.0f);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Point);
    emitter.noiseStrength = 0.0f;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);  // spawn at the origin
    for (int i = 0; i < 10; ++i) system.update(registry, 0.05f);

    bool allStill = true;
    system.forEachParticle(e, [&](const Particle& p) {
        if (glm::length(p.position) > 1e-4f) allStill = false;
    });
    CHECK(allStill);
}

TEST_CASE("system_noise_advects_otherwise_static_particles") {
    // Zero velocity + zero gravity: the ONLY thing that can move a particle is the
    // noise flow field, so any displacement proves the curl advection is wired in.
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 200;
    emitter.speedMin = emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec3(0.0f);
    // Spread the spawn across the field so particles sample varied, non-zero curl.
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Box);
    emitter.shapeSize = glm::vec3(800.0f, 800.0f, 0.0f);
    emitter.noiseStrength = 500.0f;
    emitter.noiseFrequency = 0.01f;
    emitter.noiseOctaves = 2;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);  // spawn spread across the rectangle

    std::vector<glm::vec3> spawnPos;
    system.forEachParticle(e, [&](const Particle& p) { spawnPos.push_back(p.position); });

    for (int i = 0; i < 20; ++i) system.update(registry, 0.05f);

    // At least one particle must have drifted well beyond its spawn footprint.
    bool anyMoved = false;
    std::size_t idx = 0;
    system.forEachParticle(e, [&](const Particle& p) {
        if (idx < spawnPos.size() && glm::length(p.position - spawnPos[idx]) > 5.0f) {
            anyMoved = true;
        }
        ++idx;
    });
    CHECK(anyMoved);
}

// Build a child "template" emitter that only fires when a sub-emitter triggers it
// (rate 0, no play-on-start), plus a parent wired to it. Returns {parent, child}.
static std::pair<Entity, Entity> makeSubEmitterPair(ecs::Registry& registry,
                                                    ecs::SubEmitterTrigger trigger,
                                                    f32 parentLifetime) {
    Entity child = registry.create();
    registry.emplace<ecs::Transform>(child);
    auto& childEmitter = registry.emplace<ecs::ParticleEmitter>(child);
    childEmitter.rate = 0.0f;
    childEmitter.playOnStart = false;
    childEmitter.burstCount = 8;
    childEmitter.lifetimeMin = childEmitter.lifetimeMax = 5.0f;
    childEmitter.maxParticles = 400;

    Entity parent = registry.create();
    registry.emplace<ecs::Transform>(parent);
    auto& parentEmitter = registry.emplace<ecs::ParticleEmitter>(parent);
    parentEmitter.rate = 80.0f;
    parentEmitter.lifetimeMin = parentEmitter.lifetimeMax = parentLifetime;
    parentEmitter.maxParticles = 60;
    parentEmitter.speedMin = parentEmitter.speedMax = 0.0f;
    parentEmitter.playOnStart = true;
    parentEmitter.subEmitter = child.id();
    parentEmitter.subEmitterTrigger = static_cast<i32>(trigger);
    return {parent, child};
}

TEST_CASE("system_subemitter_death_fires_child_burst") {
    ecs::Registry registry;
    ParticleSystem system;
    auto [parent, child] = makeSubEmitterPair(registry, ecs::SubEmitterTrigger::Death, 0.05f);

    system.update(registry, 0.02f);           // spawn parents; none have died yet
    CHECK_EQ(system.aliveCount(child), 0u);

    system.update(registry, 0.1f);            // parents age past 0.05 s → die → child bursts
    CHECK(system.aliveCount(child) > 0u);
}

TEST_CASE("system_subemitter_birth_fires_child_burst") {
    ecs::Registry registry;
    ParticleSystem system;
    // Long-lived parents so nothing dies — only births drive the child.
    auto [parent, child] = makeSubEmitterPair(registry, ecs::SubEmitterTrigger::Birth, 5.0f);

    system.update(registry, 0.1f);            // parents are born → child bursts on each birth
    CHECK(system.aliveCount(child) > 0u);
}

TEST_CASE("system_subemitter_none_leaves_child_empty") {
    ecs::Registry registry;
    ParticleSystem system;
    auto [parent, child] = makeSubEmitterPair(registry, ecs::SubEmitterTrigger::Death, 0.05f);
    // Detach the sub-emitter: the child must never receive a burst.
    registry.get<ecs::ParticleEmitter>(parent).subEmitter = 0;

    system.update(registry, 0.02f);
    system.update(registry, 0.2f);
    CHECK_EQ(system.aliveCount(child), 0u);
}

TEST_CASE("system_trail_records_history_for_moving_particles") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 200.0f;
    emitter.lifetimeMin = emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 50;
    emitter.speedMin = emitter.speedMax = 300.0f;  // fast → clears trailMinDistance each frame
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Point);
    emitter.trailEnabled = true;
    emitter.trailPoints = 6;
    emitter.trailMinDistance = 2.0f;
    emitter.playOnStart = true;

    for (int i = 0; i < 8; ++i) system.update(registry, 0.05f);

    const EmitterState* st = system.getState(e);
    REQUIRE(st != nullptr);
    bool anyTrail = false;
    for (std::size_t idx = 0; idx < st->pool.particles().size(); ++idx) {
        if (st->pool.particles()[idx].alive && st->trail_count[idx] >= 2) anyTrail = true;
    }
    CHECK(anyTrail);
}

TEST_CASE("system_trail_disabled_allocates_no_history") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 200.0f;
    emitter.lifetimeMin = emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 50;
    emitter.speedMin = emitter.speedMax = 300.0f;
    emitter.trailEnabled = false;
    emitter.playOnStart = true;

    for (int i = 0; i < 5; ++i) system.update(registry, 0.05f);

    const EmitterState* st = system.getState(e);
    REQUIRE(st != nullptr);
    CHECK(st->trail_count.empty());   // no history buffers when trails are off
}

TEST_CASE("system_trail_slot_reuse_starts_empty") {
    // A dead particle's slot reused by a new particle must not inherit its trail.
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 400.0f;
    emitter.lifetimeMin = emitter.lifetimeMax = 0.05f;  // die fast → slots recycle
    emitter.maxParticles = 8;
    emitter.speedMin = emitter.speedMax = 300.0f;
    emitter.trailEnabled = true;
    emitter.trailPoints = 6;
    emitter.trailMinDistance = 1.0f;
    emitter.playOnStart = true;

    // Many short frames so slots die and are reused repeatedly.
    for (int i = 0; i < 20; ++i) system.update(registry, 0.02f);

    const EmitterState* st = system.getState(e);
    REQUIRE(st != nullptr);
    // No freshly-recycled slot should report more points than the configured cap.
    for (std::size_t idx = 0; idx < st->pool.particles().size(); ++idx) {
        CHECK(st->trail_count[idx] <= 6);
    }
}

// A still emitter (no initial speed, no gravity) — only a force field can move its
// particles, so any velocity proves the field was applied.
static Entity makeStillEmitter(ecs::Registry& registry) {
    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 50;
    emitter.speedMin = emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec3(0.0f);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Point);
    emitter.playOnStart = true;
    return e;
}

TEST_CASE("system_force_field_directional_pushes_particles") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity field = registry.create();
    registry.emplace<ecs::Transform>(field);
    auto& ff = registry.emplace<ecs::ParticleForceField>(field);
    ff.type = static_cast<i32>(ecs::ForceFieldType::Directional);
    ff.strength = 500.0f;
    ff.direction = glm::vec3(1.0f, 0.0f, 0.0f);  // rightward wind, unbounded

    Entity e = makeStillEmitter(registry);
    system.update(registry, 0.05f);

    bool pushedRight = false;
    system.forEachParticle(e, [&](const Particle& p) {
        if (p.velocity.x > 1.0f && std::abs(p.velocity.y) < 0.5f) pushedRight = true;
    });
    CHECK(pushedRight);
}

TEST_CASE("system_force_field_point_attracts_toward_it") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity field = registry.create();
    auto& ft = registry.emplace<ecs::Transform>(field);
    // No transform system runs in this harness, so seed the world position directly
    // (the sim reads worldPosition, which is otherwise computed from the matrix).
    ft.worldPosition = glm::vec3(400.0f, 0.0f, 0.0f);  // to the right of the origin
    auto& ff = registry.emplace<ecs::ParticleForceField>(field);
    ff.type = static_cast<i32>(ecs::ForceFieldType::Point);
    ff.strength = 300.0f;  // positive = attract

    Entity e = makeStillEmitter(registry);  // particles spawn at the origin
    system.update(registry, 0.05f);

    bool pulledRight = false;
    system.forEachParticle(e, [&](const Particle& p) {
        if (p.velocity.x > 1.0f) pulledRight = true;  // toward the field at +x
    });
    CHECK(pulledRight);
}

TEST_CASE("system_force_field_radius_excludes_distant_particles") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity field = registry.create();
    auto& ft = registry.emplace<ecs::Transform>(field);
    ft.worldPosition = glm::vec3(5000.0f, 0.0f, 0.0f);  // far away (seeded directly)
    auto& ff = registry.emplace<ecs::ParticleForceField>(field);
    ff.type = static_cast<i32>(ecs::ForceFieldType::Directional);
    ff.strength = 500.0f;
    ff.direction = glm::vec3(1.0f, 0.0f, 0.0f);
    ff.radius = 100.0f;  // small zone the origin particles are outside of

    Entity e = makeStillEmitter(registry);
    system.update(registry, 0.05f);

    bool anyMoved = false;
    system.forEachParticle(e, [&](const Particle& p) {
        if (glm::length(p.velocity) > 0.01f) anyMoved = true;
    });
    CHECK_FALSE(anyMoved);  // out of range → untouched
}

// A downward-falling emitter at the origin with a floor below it. `collision`
// toggles the floor plane on/off.
static Entity makeFallingEmitter(ecs::Registry& registry, bool collision) {
    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 500.0f;
    emitter.lifetimeMin = emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 30;
    emitter.speedMin = emitter.speedMax = 0.0f;
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Point);  // spawn at (0,0)
    emitter.gravity = glm::vec3(0.0f, -600.0f, 0.0f);                  // fall down
    emitter.collisionEnabled = collision;
    emitter.collisionFloor = -100.0f;
    emitter.collisionBounce = 0.6f;
    emitter.playOnStart = true;
    return e;
}

TEST_CASE("system_collision_floor_keeps_particles_above") {
    ecs::Registry registry;
    ParticleSystem system;
    Entity e = makeFallingEmitter(registry, /*collision=*/true);

    system.update(registry, 0.02f);
    for (int i = 0; i < 30; ++i) system.update(registry, 0.05f);

    bool anyFarBelow = false;
    system.forEachParticle(e, [&](const Particle& p) {
        if (p.position.y < -160.0f) anyFarBelow = true;  // floor is at -100
    });
    CHECK_FALSE(anyFarBelow);
}

TEST_CASE("system_collision_disabled_particles_fall_through_floor") {
    ecs::Registry registry;
    ParticleSystem system;
    Entity e = makeFallingEmitter(registry, /*collision=*/false);

    system.update(registry, 0.02f);
    for (int i = 0; i < 30; ++i) system.update(registry, 0.05f);

    bool anyFarBelow = false;
    system.forEachParticle(e, [&](const Particle& p) {
        if (p.position.y < -400.0f) anyFarBelow = true;  // no floor → falls well past -100
    });
    CHECK(anyFarBelow);
}

TEST_CASE("system_collision_bounce_gives_upward_velocity") {
    ecs::Registry registry;
    ParticleSystem system;
    Entity e = makeFallingEmitter(registry, /*collision=*/true);

    // The small synchronized pool oscillates in phase, so sample every frame and
    // catch the upward leg of a bounce whenever it occurs.
    system.update(registry, 0.02f);
    bool bouncedUp = false;
    for (int i = 0; i < 40 && !bouncedUp; ++i) {
        system.update(registry, 0.03f);
        system.forEachParticle(e, [&](const Particle& p) {
            if (p.velocity.y > 1.0f) bouncedUp = true;  // reflected up off the floor
        });
    }
    CHECK(bouncedUp);
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
// GPU simulation: the schedule the kernel is handed (the kernel itself runs in the pixel gates)
// ============================================================================

namespace {
Entity makeGpuEmitter(ecs::Registry& registry, const std::function<void(ecs::ParticleEmitter&)>& tune) {
    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate = 0.0f;
    emitter.lifetimeMin = emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 1000;
    emitter.gpuSimulation = true;
    tune(emitter);
    return e;
}
}  // namespace

TEST_CASE("gpu_emitter_without_a_compute_device_runs_on_the_cpu_capped") {
    ecs::Registry registry;
    ParticleSystem system;
    Entity e = makeGpuEmitter(registry, [](ecs::ParticleEmitter& m) { m.burstCount = 50000; m.maxParticles = 200000; });
    system.update(registry, 0.01f);
    GpuStep step;
    CHECK_FALSE(system.peekGpuStep(e, step));
    // The capacity is what keeps a million-particle setup from taking the CPU down: it fills, and stops.
    CHECK_EQ(system.aliveCount(e), ParticleSystem::kGpuFallbackCapacity);
}

TEST_CASE("gpu_emitter_hands_over_a_step_and_keeps_no_pool") {
    ecs::Registry registry;
    ParticleSystem system;
    system.setGpuAvailable(true);
    Entity e = makeGpuEmitter(registry, [](ecs::ParticleEmitter& m) { m.burstCount = 500; m.maxParticles = 1'000'000; });
    system.update(registry, 0.01f);
    CHECK_EQ(system.getState(e)->pool.capacity(), 0u);

    GpuStep step;
    REQUIRE(system.peekGpuStep(e, step));
    CHECK_EQ(step.capacity, 1'000'000u);
    CHECK_EQ(step.spawnCount, 500u);
    CHECK_EQ(step.smoothCount, 0u);
    CHECK_EQ(step.firstIndex, 0u);
    CHECK_EQ(step.drawCount, 500u);

    // Nothing is spent until the kernel has run it: a step asked for twice is the same step.
    GpuStep again;
    REQUIRE(system.peekGpuStep(e, again));
    CHECK_EQ(again.spawnCount, 500u);
    CHECK_EQ(again.firstIndex, 0u);

    system.commitGpuStep(e, step);
    GpuStep next;
    REQUIRE(system.peekGpuStep(e, next));
    CHECK_EQ(next.spawnCount, 0u);
    CHECK_EQ(next.firstIndex, 500u);
    CHECK_EQ(next.drawCount, 500u);
    CHECK_EQ(system.aliveCount(e), 500u);
}

TEST_CASE("gpu_emitter_rate_births_are_the_smooth_ones") {
    ecs::Registry registry;
    ParticleSystem system;
    system.setGpuAvailable(true);
    Entity e = makeGpuEmitter(registry, [](ecs::ParticleEmitter& m) { m.rate = 1000.0f; m.burstCount = 7; m.burstInterval = 100.0f; });
    system.update(registry, 0.1f);
    GpuStep step;
    REQUIRE(system.peekGpuStep(e, step));
    CHECK_EQ(step.smoothCount, 100u);
    CHECK_EQ(step.spawnCount, 107u);
    CHECK(step.dt == doctest::Approx(0.1f));
}

TEST_CASE("gpu_emitter_ring_never_asks_for_more_than_it_holds") {
    ecs::Registry registry;
    ParticleSystem system;
    system.setGpuAvailable(true);
    Entity e = makeGpuEmitter(registry, [](ecs::ParticleEmitter& m) { m.burstCount = 250; m.maxParticles = 100; });
    system.update(registry, 0.01f);
    GpuStep step;
    REQUIRE(system.peekGpuStep(e, step));
    CHECK_EQ(step.spawnCount, 100u);
    CHECK_EQ(step.drawCount, 100u);
}

TEST_CASE("gpu_emitter_a_long_frame_is_not_one_huge_step") {
    ecs::Registry registry;
    ParticleSystem system;
    system.setGpuAvailable(true);
    Entity e = makeGpuEmitter(registry, [](ecs::ParticleEmitter&) {});
    system.update(registry, 1.0f);
    GpuStep step;
    REQUIRE(system.peekGpuStep(e, step));
    CHECK(step.dt == doctest::Approx(0.1f));
    system.commitGpuStep(e, step);
    REQUIRE(system.peekGpuStep(e, step));
    CHECK(step.dt == 0.0f);
}

TEST_CASE("gpu_emitter_reset_clears_the_ring_until_the_kernel_has_done_it") {
    ecs::Registry registry;
    ParticleSystem system;
    system.setGpuAvailable(true);
    Entity e = makeGpuEmitter(registry, [](ecs::ParticleEmitter& m) { m.burstCount = 40; });
    system.update(registry, 0.01f);
    GpuStep step;
    REQUIRE(system.peekGpuStep(e, step));
    system.commitGpuStep(e, step);
    CHECK_EQ(system.aliveCount(e), 40u);

    system.reset(e);
    CHECK_EQ(system.aliveCount(e), 0u);
    REQUIRE(system.peekGpuStep(e, step));
    CHECK(step.reset);
    CHECK_EQ(step.drawCount, 0u);
    system.commitGpuStep(e, step);
    REQUIRE(system.peekGpuStep(e, step));
    CHECK_FALSE(step.reset);
}

TEST_CASE("gpu_emitter_that_began_on_the_cpu_moves_over_without_firing_its_burst_twice") {
    ecs::Registry registry;
    ParticleSystem system;
    Entity e = makeGpuEmitter(registry, [](ecs::ParticleEmitter& m) { m.burstCount = 50; m.burstInterval = 100.0f; });
    // The device is only known once the renderer has run, a frame after the first update.
    system.update(registry, 0.01f);
    CHECK_EQ(system.aliveCount(e), 50u);

    system.setGpuAvailable(true);
    system.update(registry, 0.01f);
    GpuStep step;
    REQUIRE(system.peekGpuStep(e, step));
    CHECK_EQ(step.spawnCount, 50u);
    system.commitGpuStep(e, step);
    system.update(registry, 0.01f);
    REQUIRE(system.peekGpuStep(e, step));
    CHECK_EQ(step.spawnCount, 0u);
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
    emitter.gravity = glm::vec3(0.0f);
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
    emitter.gravity = glm::vec3(0.0f);
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
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Box);
    emitter.shapeSize = glm::vec3(10.0f, 6.0f, 0.0f);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 200;
    emitter.speedMin = 0.0f;
    emitter.speedMax = 0.0f;
    emitter.gravity = glm::vec3(0.0f);
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
    emitter.gravity = glm::vec3(0.0f);
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
        glm::vec3 dir = glm::normalize(p.position);
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
    emitter.gravity = glm::vec3(0.0f);
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
    emitter.gravity = glm::vec3(0.0f);
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
    emitter.gravity = glm::vec3(0.0f);
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
    emitter.gravity = glm::vec3(0.0f);
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
    emitter.gravity = glm::vec3(0.0f);
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
    emitter.gravity = glm::vec3(0.0f);
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
    emitter.gravity = glm::vec3(0.0f);
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
    emitter.gravity = glm::vec3(0.0f);
    emitter.damping = 0.0f;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    bool allPositiveY = true;
    system.forEachParticle(e, [&](const Particle& p) {
        if (glm::length(p.velocity) < 0.001f) return;
        glm::vec3 dir = glm::normalize(p.velocity);
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
    emitter.gravity = glm::vec3(0.0f);
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
        glm::vec3 posDir = glm::normalize(p.position);
        glm::vec3 velDir = glm::normalize(p.velocity);
        if (glm::dot(posDir, velDir) < 0.7f) {
            allRadial = false;
        }
        checked++;
    });
    CHECK(checked > 0);
    CHECK(allRadial);
}

TEST_CASE("shape_rectangle_direction_follows_angle_spread") {
    ecs::Registry registry;
    ParticleSystem system;

    Entity e = registry.create();
    registry.emplace<ecs::Transform>(e);
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(e);
    emitter.shape = static_cast<i32>(ecs::EmitterShape::Box);
    emitter.shapeSize = glm::vec3(10.0f, 6.0f, 0.0f);
    emitter.rate = 1000.0f;
    emitter.lifetimeMin = 10.0f;
    emitter.lifetimeMax = 10.0f;
    emitter.maxParticles = 200;
    emitter.speedMin = 10.0f;
    emitter.speedMax = 10.0f;
    // A rectangle is an area emitter: the shape spreads only WHERE particles
    // spawn; direction comes from angleSpread, exactly like a point. Aim down.
    emitter.angleSpreadMin = 260.0f;
    emitter.angleSpreadMax = 280.0f;
    emitter.gravity = glm::vec3(0.0f);
    emitter.damping = 0.0f;
    emitter.enabled = true;
    emitter.playOnStart = true;

    system.update(registry, 0.01f);
    CHECK(system.aliveCount(e) > 0u);

    bool allDownward = true;
    int checked = 0;
    system.forEachParticle(e, [&](const Particle& p) {
        if (glm::length(p.velocity) < 0.001f) return;
        glm::vec3 dir = glm::normalize(p.velocity);
        if (dir.y > -0.9f) {
            allDownward = false;
        }
        checked++;
    });
    CHECK(checked > 0);
    CHECK(allDownward);
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
    emitter.gravity = glm::vec3(0.0f);
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
        glm::vec3 dir = glm::normalize(p.velocity);
        if (dir.y < cosHalf - 0.01f) {
            allWithinCone = false;
        }
    });
    CHECK(allWithinCone);
}

// Scene collision is a synchronous two-stage batch: the physics adapters do not
// own integration, responses, event limits or particle lifetime.
static Entity makeSceneCollisionEmitter(ecs::Registry& registry, ParticleSystem& system, i32 mode=2, i32 capacity=4) {
    Entity e=registry.create(); registry.emplace<ecs::Transform>(e);
    auto& emitter=registry.emplace<ecs::ParticleEmitter>(e);
    emitter.rate=0;emitter.burstCount=0;emitter.maxParticles=capacity;
    emitter.gravity=glm::vec3(0);emitter.collisionEnabled=true;emitter.collisionMode=mode;
    emitter.collisionFallback=1;emitter.collisionBounce=.5f;emitter.collisionFriction=.25f;
    emitter.collisionEvents=true;emitter.collisionFloor=-1;
    system.update(registry,0);
    system.getState(e)->collisionCursor=0;
    return e;
}
static Particle* movingParticle(ParticleSystem& system, Entity e, glm::vec3 position={0,0,0}, glm::vec3 velocity={10,2,4}) {
    auto* p=system.getState(e)->pool.allocate();p->lifetime=10;p->position=position;p->velocity=velocity;return p;
}
TEST_CASE("particle_scene_segment_response_and_integer_entity_event") {
    ecs::Registry registry;ParticleSystem system;Entity e=makeSceneCollisionEmitter(registry,system);
    auto* p=movingParticle(system,e);system.update(registry,.5f);
    REQUIRE_EQ(system.collisionQueries().size(),1u);
    CHECK_EQ(system.collisionQueries()[0].dx,5);CHECK_EQ(system.collisionQueries()[0].dz,2);
    const CollisionReply hit{1,0xf1234567u,2,.4f,.8f,-1,0,0};system.resolveCollisions(registry,&hit,1);
    CHECK(p->position.x==doctest::Approx(1.9999f));CHECK(p->velocity.x==doctest::Approx(-5));
    CHECK(p->velocity.y==doctest::Approx(1.5f));CHECK(p->velocity.z==doctest::Approx(3));
    REQUIRE_EQ(system.collisionEvents().size(),1u);CHECK_EQ(system.collisionEvents()[0].body,0xf1234567u);
    CHECK_EQ(system.collisionEvents()[0].vx,10);CHECK_EQ(system.collisionStats()[0].hits,1u);
    system.resolveCollisions(registry,&hit,1);CHECK_EQ(system.collisionEvents().size(),1u);
}
TEST_CASE("particle_scene_miss_is_not_unavailable_or_floor_fallback") {
    ecs::Registry registry;ParticleSystem system;Entity e=makeSceneCollisionEmitter(registry,system);
    registry.get<ecs::ParticleEmitter>(e).collisionFallback=0;
    auto* p=movingParticle(system,e,{0,0,0},{0,-10,0});system.update(registry,.5f);
    const CollisionReply miss{0,0,0,0,0,0,0,0};system.resolveCollisions(registry,&miss,1);
    CHECK_EQ(p->position.y,-5);CHECK_EQ(system.collisionStats()[0].fallbacks,0u);CHECK_EQ(system.collisionStats()[0].unavailable,0u);
}
TEST_CASE("particle_scene_missing_provider_uses_explicit_floor_fallback") {
    ecs::Registry registry;ParticleSystem system;Entity e=makeSceneCollisionEmitter(registry,system);
    registry.get<ecs::ParticleEmitter>(e).collisionFallback=0;
    auto* p=movingParticle(system,e,{0,0,0},{0,-10,0});system.update(registry,.5f);system.resolveCollisions(registry,nullptr,0);
    CHECK_EQ(p->position.y,-1);CHECK_EQ(p->velocity.y,5);CHECK_EQ(system.collisionStats()[0].unavailable,1u);CHECK_EQ(system.collisionStats()[0].fallbacks,1u);
}
TEST_CASE("particle_scene_budget_and_nearest_camera_distance_are_bounded") {
    ecs::Registry registry;ParticleSystem system;Entity e=makeSceneCollisionEmitter(registry,system);
    auto& emitter=registry.get<ecs::ParticleEmitter>(e);emitter.collisionQueryBudget=0;
    movingParticle(system,e);system.update(registry,.1f);
    CHECK(system.collisionQueries().empty());CHECK_EQ(system.collisionStats()[0].budgetSkipped,1u);
    emitter.collisionQueryBudget=128;emitter.collisionMaxDistance=1;
    const auto camera=registry.create();registry.emplace<ecs::Camera>(camera).isActive=true;registry.emplace<ecs::Transform>(camera);
    system.getState(e)->pool.particles()[0].position={100,100,0};system.update(registry,.1f);
    CHECK(system.collisionQueries().empty());CHECK_EQ(system.collisionStats()[0].distanceSkipped,1u);
}
TEST_CASE("particle_scene_global_cap_rotates_between_emitters") {
    ecs::Registry registry;ParticleSystem system;
    Entity a=makeSceneCollisionEmitter(registry,system,2,1),b=makeSceneCollisionEmitter(registry,system,2,1);
    movingParticle(system,a);movingParticle(system,b);system.setCollisionBudget(1,32);
    system.update(registry,.1f);REQUIRE_EQ(system.collisionQueries().size(),1u);const auto first=system.collisionQueries()[0].emitter;
    system.resolveCollisions(registry,nullptr,0);system.update(registry,.1f);REQUIRE_EQ(system.collisionQueries().size(),1u);
    CHECK_NE(system.collisionQueries()[0].emitter,first);
}
TEST_CASE("particle_scene_partial_budget_rotates_pool_slots") {
    ecs::Registry registry;ParticleSystem system;Entity e=makeSceneCollisionEmitter(registry,system,2,2);
    registry.get<ecs::ParticleEmitter>(e).collisionQueryBudget=1;
    movingParticle(system,e);movingParticle(system,e);system.update(registry,.1f);
    REQUIRE_EQ(system.collisionQueries().size(),1u);const auto first=system.collisionQueries()[0].slot;
    system.resolveCollisions(registry,nullptr,0);system.update(registry,.1f);REQUIRE_EQ(system.collisionQueries().size(),1u);
    CHECK_NE(system.collisionQueries()[0].slot,first);
}
TEST_CASE("particle_scene_2d_retains_particle_depth_and_local_rotation") {
    ecs::Registry registry;ParticleSystem system;Entity e=makeSceneCollisionEmitter(registry,system,1);
    auto* p=movingParticle(system,e,{0,0,17},{10,0,5});system.update(registry,.5f);
    REQUIRE_EQ(system.collisionQueries().size(),1u);CHECK_EQ(system.collisionQueries()[0].dz,0);
    const CollisionReply hit{1,5,2,0,0,-1,0,0};system.resolveCollisions(registry,&hit,1);
    CHECK_EQ(p->position.z,19.5f);
    registry.get<ecs::ParticleEmitter>(e).collisionMode=2;
    registry.get<ecs::ParticleEmitter>(e).simulationSpace=static_cast<i32>(ecs::SimulationSpace::Local);
    auto& transform=registry.get<ecs::Transform>(e);transform.worldPosition={10,0,0};
    transform.worldRotation=glm::angleAxis(glm::radians(90.0f),glm::vec3(0,0,1));
    p->position={0,0,0};p->velocity={10,0,0};system.getState(e)->collisionCursor=0;system.update(registry,.5f);
    REQUIRE_EQ(system.collisionQueries().size(),1u);CHECK(system.collisionQueries()[0].dy==doctest::Approx(5));
    const CollisionReply localHit{1,5,10,2,0,0,-1,0};system.resolveCollisions(registry,&localHit,1);
    CHECK(p->position.x==doctest::Approx(1.9999f));CHECK(p->velocity.x==doctest::Approx(-5));
}
TEST_CASE("particle_scene_event_budget_lifetime_and_self_child_are_bounded") {
    ecs::Registry registry;ParticleSystem system;Entity e=makeSceneCollisionEmitter(registry,system,2,2);
    auto& emitter=registry.get<ecs::ParticleEmitter>(e);emitter.collisionEventBudget=1;emitter.collisionLifetimeLoss=1;
    emitter.subEmitter=e.raw;emitter.subEmitterTrigger=static_cast<i32>(ecs::SubEmitterTrigger::Collision);
    movingParticle(system,e);movingParticle(system,e);system.update(registry,.5f);
    const CollisionReply hits[2]={{1,5,2,.4f,.8f,-1,0,0},{1,5,2,.4f,.8f,-1,0,0}};system.resolveCollisions(registry,hits,2);
    CHECK_EQ(system.collisionEvents().size(),1u);CHECK_EQ(system.collisionStats()[0].eventDropped,1u);CHECK_EQ(system.aliveCount(e),0u);
}
TEST_CASE("particle_scene_stale_slot_and_invalid_hit_never_teleport") {
    ecs::Registry registry;ParticleSystem system;Entity e=makeSceneCollisionEmitter(registry,system);
    movingParticle(system,e);system.update(registry,.5f);system.reset(e);
    auto* p=movingParticle(system,e,{99,0,0});const CollisionReply hit{1,5,2,.4f,.8f,-1,0,0};system.resolveCollisions(registry,&hit,1);
    CHECK_EQ(p->position.x,99);CHECK(system.collisionEvents().empty());
    p->position={0,0,0};system.getState(e)->collisionCursor=0;system.update(registry,.5f);
    const CollisionReply invalid{1,5,1000,1000,1000,0,0,0};system.resolveCollisions(registry,&invalid,1);
    CHECK_EQ(p->position.x,5);CHECK_EQ(system.collisionStats()[0].unavailable,1u);
}
TEST_CASE("particle_scene_debug_contacts_do_not_publish_gameplay_events") {
    ecs::Registry registry;ParticleSystem system;Entity e=makeSceneCollisionEmitter(registry,system);
    registry.get<ecs::ParticleEmitter>(e).collisionEvents=false;system.setCollisionBudget(4096,1024,true);
    movingParticle(system,e);system.update(registry,.5f);const CollisionReply hit{1,5,2,.4f,.8f,-1,0,0};system.resolveCollisions(registry,&hit,1);
    REQUIRE_EQ(system.collisionEvents().size(),1u);CHECK_EQ(system.collisionEvents()[0].publish,0u);
}
TEST_CASE("particle_collision_child_uses_its_local_storage_frame") {
    ecs::Registry registry; ParticleSystem system;
    const Entity parent = makeSceneCollisionEmitter(registry, system);
    const Entity child = registry.create();
    auto& transform = registry.emplace<ecs::Transform>(child);
    transform.worldPosition = {100,20,0};
    transform.worldRotation = glm::angleAxis(glm::radians(90.0f), glm::vec3(0,0,1));
    auto& emitter = registry.emplace<ecs::ParticleEmitter>(child);
    emitter.simulationSpace = static_cast<i32>(ecs::SimulationSpace::Local);
    emitter.rate = 0; emitter.burstCount = 1; emitter.maxParticles = 4;
    emitter.shape = 0; emitter.speedMin = emitter.speedMax = 0;
    auto& source = registry.get<ecs::ParticleEmitter>(parent);
    source.subEmitter = child.raw;
    source.subEmitterTrigger = static_cast<i32>(ecs::SubEmitterTrigger::Collision);
    source.subEmitterInheritVelocity = .5f;
    movingParticle(system, parent); system.update(registry,.5f); system.reset(child);
    const CollisionReply hit{1,5,2,.4f,.8f,-1,0,0};
    system.resolveCollisions(registry,&hit,1);
    REQUIRE_EQ(system.aliveCount(child),1u);
    const auto& spawned = system.getState(child)->pool.particles()[0];
    const auto position = transform.worldPosition + transform.worldRotation * spawned.position;
    const auto velocity = transform.worldRotation * spawned.velocity;
    CHECK(position.x == doctest::Approx(1.9999f));
    CHECK(position.y == doctest::Approx(.4f).epsilon(.0001f));
    CHECK(velocity.x == doctest::Approx(-2.5f));
    CHECK_EQ(spawned.subEmitterDepth,1u);
}

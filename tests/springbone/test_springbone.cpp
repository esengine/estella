#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include "esengine/ecs/TransformSystem.hpp"
#include "esengine/ecs/components/SpringBone.hpp"
#include "esengine/springbone/SpringBoneSolver.hpp"
#include "esengine/springbone/SpringBoneSystem.hpp"
#include "esengine/springbone/SpringBoneWorlds.hpp"

#include <cmath>

using namespace esengine;
using namespace esengine::springbone;

namespace {

/** A chain hanging along -y from the origin: n particles `len` apart, the first the root. */
std::vector<Particle> hanging(int n, f32 len) {
    std::vector<Particle> chain(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) {
        chain[static_cast<size_t>(i)].parent = i - 1;
        chain[static_cast<size_t>(i)].target = glm::vec3(0.0f, -len * static_cast<f32>(i), 0.0f);
        chain[static_cast<size_t>(i)].restLength = i == 0 ? 0.0f : len;
    }
    reset(chain);
    return chain;
}

void follow(std::vector<Particle>& chain, const glm::vec3& root, f32 len) {
    for (size_t i = 0; i < chain.size(); ++i) chain[i].target = root + glm::vec3(0.0f, -len * static_cast<f32>(i), 0.0f);
}

f32 stretch(const std::vector<Particle>& chain) {
    f32 worst = 0.0f;
    for (size_t i = 1; i < chain.size(); ++i) {
        worst = std::max(worst, std::abs(glm::length(chain[i].position - chain[static_cast<size_t>(chain[i].parent)].position) - chain[i].restLength));
    }
    return worst;
}

}  // namespace

TEST_CASE("shortestArc turns one direction onto another") {
    const glm::vec3 pairs[][2] = {{{1, 0, 0}, {0, 1, 0}}, {{0, -1, 0}, {1, 1, 0}}, {{0, 0, 1}, {0, 0, -1}}, {{3, 0, 0}, {3, 0, 0}}};
    for (const auto& p : pairs) {
        const glm::quat q = shortestArc(p[0], p[1]);
        const glm::vec3 turned = q * glm::normalize(p[0]);
        const glm::vec3 want = glm::normalize(p[1]);
        CHECK(turned.x == doctest::Approx(want.x).epsilon(1e-4));
        CHECK(turned.y == doctest::Approx(want.y).epsilon(1e-4));
        CHECK(turned.z == doctest::Approx(want.z).epsilon(1e-4));
        CHECK(glm::length(q) == doctest::Approx(1.0f));
    }
    const glm::quat none = shortestArc(glm::vec3(0.0f), glm::vec3(1, 0, 0));
    CHECK(none.w == doctest::Approx(1.0f));
}

TEST_CASE("a chain at rest in its pose stays there with no gravity") {
    auto chain = hanging(5, 10.0f);
    StepParams params;
    params.gravity = glm::vec3(0.0f);
    for (int i = 0; i < 120; ++i) step(chain, params, {}, 1.0f / 60.0f);
    for (const auto& p : chain) CHECK(glm::length(p.position - p.target) < 1e-4f);
}

TEST_CASE("full stiffness is the animation, exactly") {
    auto chain = hanging(4, 10.0f);
    StepParams params;
    params.stiffness = 1.0f;
    for (int i = 0; i < 30; ++i) {
        follow(chain, glm::vec3(static_cast<f32>(i) * 3.0f, 0.0f, 0.0f), 10.0f);
        step(chain, params, {}, 1.0f / 60.0f);
    }
    for (const auto& p : chain) CHECK(glm::length(p.position - p.target) < 1e-3f);
}

TEST_CASE("a bone never stretches, whatever the chain is doing") {
    auto chain = hanging(6, 10.0f);
    StepParams params;
    params.stiffness = 0.05f;
    for (int i = 0; i < 240; ++i) {
        follow(chain, glm::vec3(std::sin(static_cast<f32>(i) * 0.2f) * 80.0f, 0.0f, 0.0f), 10.0f);
        step(chain, params, {}, 1.0f / 60.0f);
        CHECK(stretch(chain) < 1e-2f);
    }
}

TEST_CASE("the tip lags a moving root and catches up when it stops") {
    auto chain = hanging(5, 10.0f);
    StepParams params;
    params.gravity = glm::vec3(0.0f);
    follow(chain, glm::vec3(100.0f, 0.0f, 0.0f), 10.0f);
    step(chain, params, {}, 1.0f / 60.0f);
    const auto& tip = chain.back();
    CHECK(glm::length(tip.position - tip.target) > 20.0f);   // it did not jump with the root
    for (int i = 0; i < 400; ++i) step(chain, params, {}, 1.0f / 60.0f);
    CHECK(glm::length(tip.position - tip.target) < 0.5f);
}

TEST_CASE("the defaults do not ring: a body that walks a few bone lengths is overshot only a little") {
    auto chain = hanging(5, 10.0f);
    StepParams params;                      // the defaults a SpringBone starts with
    params.gravity = glm::vec3(0.0f);
    f32 over = 0.0f;
    for (int i = 0; i < 400; ++i) {
        follow(chain, glm::vec3(std::min(static_cast<f32>(i), 20.0f) * 2.0f, 0.0f, 0.0f), 10.0f);   // 40 units over a third of a second
        step(chain, params, {}, 1.0f / 60.0f);
        over = std::max(over, chain.back().position.x - chain.back().target.x);
    }
    CHECK(over < 4.0f);                     // a tenth of the move
    CHECK(glm::length(chain.back().position - chain.back().target) < 0.5f);
}

TEST_CASE("gravity hangs a free chain and the weight of stiffness holds it up") {
    // A chain posed out sideways.
    auto sideways = [](f32 stiffness) {
        std::vector<Particle> chain(5);
        for (int i = 0; i < 5; ++i) {
            chain[static_cast<size_t>(i)].parent = i - 1;
            chain[static_cast<size_t>(i)].target = glm::vec3(10.0f * static_cast<f32>(i), 0.0f, 0.0f);
            chain[static_cast<size_t>(i)].restLength = i == 0 ? 0.0f : 10.0f;
        }
        reset(chain);
        StepParams params;
        params.stiffness = stiffness;
        for (int i = 0; i < 600; ++i) step(chain, params, {}, 1.0f / 60.0f);
        return chain.back().position.y;
    };
    const f32 free = sideways(0.0f), held = sideways(0.5f);
    CHECK(free < -30.0f);            // hangs down
    CHECK(held > free + 10.0f);      // the pose holds it higher
    CHECK(held < 0.0f);              // but gravity still has its say
}

TEST_CASE("a collider keeps the chain out") {
    auto chain = hanging(6, 10.0f);
    StepParams params;
    params.gravity = glm::vec3(0.0f);
    // Off to one side, so the chain grazes it: a chain threaded dead through the middle has no side to go round.
    const Collider sphere{glm::vec3(8.0f, -30.0f, 0.0f), glm::vec3(8.0f, -30.0f, 0.0f), 12.0f};
    for (int i = 0; i < 120; ++i) step(chain, params, {sphere}, 1.0f / 60.0f);
    for (size_t i = 1; i < chain.size(); ++i) CHECK(glm::length(chain[i].position - sphere.a) >= 12.0f - 0.05f);
    CHECK(stretch(chain) < 0.5f);
}

TEST_CASE("a capsule pushes out along its length") {
    glm::vec3 p(2.0f, 0.0f, 0.0f);
    const Collider capsule{glm::vec3(0.0f, -10.0f, 0.0f), glm::vec3(0.0f, 10.0f, 0.0f), 5.0f};
    CHECK(pushOut(p, capsule, 0.0f));
    CHECK(p.x == doctest::Approx(5.0f));
    CHECK(p.y == doctest::Approx(0.0f));
    glm::vec3 distant(20.0f, 0.0f, 0.0f);
    CHECK_FALSE(pushOut(distant, capsule, 0.0f));
    glm::vec3 end(0.0f, 12.0f, 0.0f);   // inside the end cap
    CHECK(pushOut(end, capsule, 0.0f));
    CHECK(glm::length(end - capsule.b) == doctest::Approx(5.0f));
}

TEST_CASE("the same steps give the same chain, and the frame rate hardly matters") {
    auto run = [](int hz) {
        auto chain = hanging(5, 10.0f);
        StepParams params;
        params.gravity = glm::vec3(0.0f);
        for (int i = 0; i < hz; ++i) {
            const f32 t = static_cast<f32>(i) / static_cast<f32>(hz);
            follow(chain, glm::vec3(std::min(t, 0.3f) * 200.0f, 0.0f, 0.0f), 10.0f);
            step(chain, params, {}, 1.0f / static_cast<f32>(hz));
        }
        return chain.back().position;
    };
    const glm::vec3 a = run(60), b = run(60), c = run(120);
    CHECK(a == b);
    CHECK(glm::length(a - c) < 4.0f);
}

namespace {

struct Rig {
    ecs::Registry registry;
    ecs::TransformSystem transforms;
    SpringBoneSystem system;
    Entity root{}, b1{}, b2{};

    explicit Rig(f32 endLength = 0.0f, f32 stiffness = 0.2f) {
        root = registry.create();
        b1 = registry.create();
        b2 = registry.create();
        registry.emplace<ecs::Transform>(root);
        auto& t1 = registry.emplace<ecs::Transform>(b1);
        t1.position = {0.0f, -10.0f, 0.0f};
        auto& t2 = registry.emplace<ecs::Transform>(b2);
        t2.position = {0.0f, -10.0f, 0.0f};
        ecs::setParent(registry, b1, root);
        ecs::setParent(registry, b2, b1);
        auto& sb = registry.emplace<ecs::SpringBone>(root);
        sb.gravity = glm::vec3(0.0f);
        sb.endLength = endLength;
        sb.stiffness = stiffness;
        transforms.ensureComposed(registry);
    }

    void moveRoot(const glm::vec3& p) {
        registry.patch<ecs::Transform>(root).position = p;
        ecs::invalidateTransformComposition();
    }
    void frame(f32 dt = 1.0f / 60.0f) { system.update(registry, &transforms, dt); }
    f32 turned(Entity e) { return 2.0f * std::acos(std::min(std::abs(registry.get<ecs::Transform>(e).rotation.w), 1.0f)); }
};

}  // namespace

TEST_CASE("a chain in its pose is left alone") {
    Rig rig;
    for (int i = 0; i < 30; ++i) rig.frame();
    CHECK(rig.turned(rig.b1) < 1e-3f);
    CHECK(rig.system.simulated() == 1);
    // Positions are never written.
    CHECK(rig.registry.get<ecs::Transform>(rig.b1).position.y == doctest::Approx(-10.0f));
}

TEST_CASE("releasing a preview restores only that world's animated rotations") {
    SpringBoneWorlds worlds;
    Rig a(10), b(10);
    REQUIRE(a.root == b.root);
    auto first = worlds.forRegistry(a.registry);
    auto second = worlds.forRegistry(b.registry);
    const auto frame = [&] {
        first->update(a.registry, &a.transforms, 1.0f / 60.0f);
        second->update(b.registry, &b.transforms, 1.0f / 60.0f);
    };
    frame();
    a.moveRoot({60, 0, 0});
    b.moveRoot({-60, 0, 0});
    frame();
    REQUIRE(a.turned(a.b1) > 0.05f);
    REQUIRE(b.turned(b.b1) > 0.05f);
    const auto peerRotation = b.registry.get<ecs::Transform>(b.b1).rotation;
    first->release(a.registry, a.root);
    CHECK(a.turned(a.b1) < 1e-4f);
    CHECK(b.registry.get<ecs::Transform>(b.b1).rotation == peerRotation);
    CHECK_FALSE(first->chain(a.root));
    REQUIRE(second->chain(b.root));
    CHECK(second->chain(b.root)->front().position.x == -60);
    b.registry.destroy(b.root);
    CHECK_FALSE(second->chain(b.root));
}

TEST_CASE("moving the root swings the bones, and they settle back to the animated pose without drifting") {
    Rig rig;
    rig.frame();
    rig.moveRoot({60.0f, 0.0f, 0.0f});
    rig.frame();
    CHECK(rig.turned(rig.b1) > 0.05f);
    for (int i = 0; i < 600; ++i) rig.frame();
    // Nothing animated these bones in between, yet they returned to the pose, not to the last thing this system wrote.
    CHECK(rig.turned(rig.b1) < 0.01f);
    CHECK(rig.turned(rig.b2) < 0.01f);
}

TEST_CASE("an animated rotation is the new pose the chain springs toward") {
    Rig rig;
    rig.frame();
    const glm::quat pose = glm::angleAxis(0.5f, glm::vec3(0.0f, 0.0f, 1.0f));
    for (int i = 0; i < 300; ++i) {
        rig.registry.patch<ecs::Transform>(rig.b1).rotation = pose;   // the animation, every frame
        ecs::invalidateTransformComposition();
        rig.frame();
    }
    const glm::quat now = rig.registry.get<ecs::Transform>(rig.b1).rotation;
    CHECK(std::abs(glm::dot(now, pose)) > 0.999f);
}

TEST_CASE("an end length gives the last bone a tip to follow") {
    Rig without(0.0f), with(10.0f);
    for (Rig* r : {&without, &with}) {
        r->frame();
        r->moveRoot({80.0f, 0.0f, 0.0f});
        r->frame();
    }
    CHECK(without.turned(without.b2) < 1e-4f);   // a leaf with no tip is not simulated
    CHECK(with.turned(with.b2) > 0.02f);
}

TEST_CASE("a jump of the root is a teleport, not a whip") {
    Rig rig;
    rig.frame();
    rig.moveRoot({50000.0f, 0.0f, 0.0f});
    rig.frame();
    CHECK(rig.turned(rig.b1) < 1e-3f);
    CHECK(rig.turned(rig.b2) < 1e-3f);
}

TEST_CASE("switching the chain off gives the bones back as the animation had them") {
    Rig rig;
    rig.frame();
    rig.moveRoot({60.0f, 0.0f, 0.0f});
    rig.frame();
    CHECK(rig.turned(rig.b1) > 0.05f);
    rig.registry.get<ecs::SpringBone>(rig.root).enabled = false;
    rig.frame();
    CHECK(rig.turned(rig.b1) < 1e-4f);
    CHECK(rig.system.chain(rig.root) == nullptr);
}

TEST_CASE("releasing a chain gives its bones back at once and forgets it") {
    Rig rig;
    rig.frame();
    rig.moveRoot({60.0f, 0.0f, 0.0f});
    rig.frame();
    CHECK(rig.turned(rig.b1) > 0.05f);
    rig.system.release(rig.registry, rig.root);
    CHECK(rig.turned(rig.b1) < 1e-4f);
    CHECK(rig.system.chain(rig.root) == nullptr);
    // Releasing what is not there is nothing.
    rig.system.release(rig.registry, rig.root);
}

TEST_CASE("weight blends between the animation and the simulation") {
    Rig full, half;
    half.registry.get<ecs::SpringBone>(half.root).weight = 0.5f;
    f32 amounts[2];
    int k = 0;
    for (Rig* r : {&full, &half}) {
        r->frame();
        r->moveRoot({60.0f, 0.0f, 0.0f});
        r->frame();
        amounts[k++] = r->turned(r->b1);
    }
    CHECK(amounts[1] > 0.0f);
    CHECK(amounts[1] < amounts[0] * 0.7f);
}

TEST_CASE("destroying the root drops its chain") {
    Rig rig;
    rig.frame();
    CHECK(rig.system.chain(rig.root) != nullptr);
    rig.registry.destroy(rig.root);
    CHECK(rig.system.chain(rig.root) == nullptr);
}

TEST_CASE("a collider entity keeps the simulated bones out") {
    Rig rig;
    auto& sb = rig.registry.get<ecs::SpringBone>(rig.root);
    const Entity ball = rig.registry.create();
    rig.registry.emplace<ecs::Transform>(ball).position = {15.0f, -10.0f, 0.0f};
    auto& shape = rig.registry.emplace<ecs::SpringBoneCollider>(ball);
    shape.radius = 8.0f;
    sb.colliders.push_back(ball);
    rig.transforms.ensureComposed(rig.registry);
    rig.frame();
    rig.moveRoot({40.0f, 0.0f, 0.0f});
    for (int i = 0; i < 20; ++i) rig.frame();
    const auto* chain = rig.system.chain(rig.root);
    REQUIRE(chain != nullptr);
    for (size_t i = 1; i < chain->size(); ++i) CHECK(glm::length((*chain)[i].position - glm::vec3(15.0f, -10.0f, 0.0f)) >= 7.9f);
}

TEST_CASE("a steady wind holds a chain out downwind of its pose") {
    auto chain = hanging(5, 10.0f);
    StepParams params;
    params.gravity = glm::vec3(0.0f);
    params.stiffness = 0.05f;
    params.wind = glm::vec3(600.0f, 0.0f, 0.0f);
    for (int i = 0; i < 240; ++i) {
        params.time = static_cast<f32>(i) / 60.0f;
        step(chain, params, {}, 1.0f / 60.0f);
    }
    CHECK(chain.back().position.x > 3.0f);
    CHECK(std::abs(chain.back().position.z) < 1e-3f);
    CHECK(stretch(chain) < 1e-2f);
    // The root is what the body drives and the wind never moves it.
    CHECK(chain[0].position.x == doctest::Approx(0.0f));
}

TEST_CASE("without a wind the chain is as it was, gusts or not") {
    auto still = hanging(4, 10.0f);
    auto gusty = hanging(4, 10.0f);
    StepParams a;
    StepParams b;
    b.windGust = 1.0f;
    for (int i = 0; i < 60; ++i) {
        a.time = b.time = static_cast<f32>(i) / 60.0f;
        step(still, a, {}, 1.0f / 60.0f);
        step(gusty, b, {}, 1.0f / 60.0f);
    }
    for (size_t i = 0; i < still.size(); ++i) CHECK(glm::length(still[i].position - gusty[i].position) < 1e-5f);
}

TEST_CASE("gusts swing the wind's strength, within bounds and reproducibly") {
    CHECK(gustFactor(1.7f, 0.5f, 0.0f, 3) == doctest::Approx(1.0f));
    f32 lo = 10.0f, hi = -10.0f;
    for (int i = 0; i < 400; ++i) {
        const f32 f = gustFactor(static_cast<f32>(i) * 0.05f, 0.5f, 1.0f, 0);
        lo = std::min(lo, f);
        hi = std::max(hi, f);
        CHECK(f >= 0.0f);
        CHECK(f <= 2.0f);
    }
    CHECK(lo < 0.5f);
    CHECK(hi > 1.5f);
    CHECK(gustFactor(2.5f, 0.5f, 0.6f, 2) == gustFactor(2.5f, 0.5f, 0.6f, 2));
    // A bone further down meets the same gust later: the strand ripples.
    CHECK(gustFactor(2.5f, 0.5f, 1.0f, 0) != doctest::Approx(gustFactor(2.5f, 0.5f, 1.0f, 4)));
}

TEST_CASE("the chain's own clock makes a gusting chain repeatable") {
    auto run = [] {
        auto chain = hanging(5, 10.0f);
        StepParams p;
        p.gravity = glm::vec3(0.0f);
        p.wind = glm::vec3(400.0f, 0.0f, 100.0f);
        p.windGust = 0.8f;
        for (int i = 0; i < 180; ++i) {
            p.time = static_cast<f32>(i) / 60.0f;
            step(chain, p, {}, 1.0f / 60.0f);
        }
        return chain.back().position;
    };
    const glm::vec3 first = run();
    const glm::vec3 second = run();
    CHECK(first.x == second.x);
    CHECK(first.z == second.z);
}

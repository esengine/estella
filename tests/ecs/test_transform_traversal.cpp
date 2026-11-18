#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include "esengine/ecs/TransformSystem.hpp"
using namespace esengine;
using namespace esengine::ecs;

static void checkReconstructedTransform(const glm::mat4& matrix, bool planar) {
    Transform transform;
    transform.cachedMatrix_ = matrix;
    transform.decomposed_ = false;
    transform.ensureDecomposed();
    const auto rebuilt = glm::translate(glm::mat4(1), transform.worldPosition)
                       * glm::mat4_cast(transform.worldRotation)
                       * glm::scale(glm::mat4(1), transform.worldScale);
    CHECK(glm::length(transform.worldRotation) == doctest::Approx(1));
    if (planar) {
        CHECK(transform.worldRotation.x == doctest::Approx(0));
        CHECK(transform.worldRotation.y == doctest::Approx(0));
    }
    for (int col = 0; col < 4; ++col) for (int row = 0; row < 4; ++row) {
        CHECK(std::isfinite(rebuilt[col][row]));
        CHECK(rebuilt[col][row] == doctest::Approx(matrix[col][row]).epsilon(.0001));
    }
}

TEST_CASE("signed transforms reconstruct planar and spatial mirrors") {
    for (float x : {1.0f, -1.0f}) for (float y : {1.0f, -1.0f}) for (float z : {1.0f, -1.0f}) {
        for (bool planar : {false, true}) {
            const auto rotation = planar ? glm::angleAxis(.7f, glm::vec3(0, 0, 1))
                                         : glm::quat(glm::vec3(.3f, -.5f, .9f));
            const auto matrix = glm::translate(glm::mat4(1), glm::vec3(4, -7, 3))
                              * glm::mat4_cast(rotation) * glm::scale(glm::mat4(1), glm::vec3(2*x, 3*y, 4*z));
            checkReconstructedTransform(matrix, planar);
        }
    }
}

TEST_CASE("planar mirrors compose through parents and collapsed axes stay finite") {
    for (float x : {1.0f, -1.0f}) for (float y : {1.0f, -1.0f}) {
        Registry registry; TransformSystem system;
        const auto parent = registry.create(), child = registry.create();
        auto& p = registry.emplace<Transform>(parent);
        p.rotation = glm::angleAxis(.7f, glm::vec3(0, 0, 1));
        p.scale = {x, y, -1};
        auto& c = registry.emplace<Transform>(child);
        c.position = {3, 4, 0};
        c.rotation = glm::angleAxis(-.2f, glm::vec3(0, 0, 1));
        c.scale = {-2, 3, 1};
        setParent(registry, child, parent);
        system.ensureComposed(registry);
        checkReconstructedTransform(c.cachedMatrix_, true);
    }
    for (const glm::vec3 scale : {glm::vec3{0, 3, 4}, {2, 0, 4}, {0, -3, -4}, {0, 0, 0}}) {
        const auto matrix = glm::mat4_cast(glm::angleAxis(.7f, glm::vec3(0, 0, 1)))
                          * glm::scale(glm::mat4(1), scale);
        checkReconstructedTransform(matrix, true);
    }
}

TEST_CASE("transformless grouping nodes preserve descendant composition") {
    Registry r; TransformSystem system;
    const auto root = r.create(), group = r.create(), child = r.create();
    r.emplace<Transform>(child).position.x = 5;
    setParent(r, child, group);
    SUBCASE("grouping root") {
        system.ensureComposed(r);
        r.get<Transform>(child).ensureDecomposed();
        CHECK(r.get<Transform>(child).worldPosition.x == doctest::Approx(5));
    }
    SUBCASE("group between transformed ancestors and descendants") {
        r.emplace<Transform>(root).position.x = 10;
        r.get<Transform>(root).scale.x = 2;
        setParent(r, group, root);
        system.ensureComposed(r);
        r.get<Transform>(child).ensureDecomposed();
        CHECK(r.get<Transform>(child).worldPosition.x == doctest::Approx(20));
        r.get<Transform>(root).position.x = 30;
        r.emplace<TransformDirty>(root);
        invalidateTransformComposition(); system.ensureComposed(r);
        r.get<Transform>(child).ensureDecomposed();
        CHECK(r.get<Transform>(child).worldPosition.x == doctest::Approx(40));
    }
}

TEST_CASE("valid deep hierarchies compose every descendant") {
    Registry r; TransformSystem system;
    Entity parent = INVALID_ENTITY, leaf;
    for (int i = 0; i < 50000; ++i) {
        leaf = r.create();
        r.emplace<Transform>(leaf).position.x = 1;
        if (parent != INVALID_ENTITY) r.childOf().link(leaf, parent);
        parent = leaf;
    }
    system.ensureComposed(r);
    auto& t = r.get<Transform>(leaf); t.ensureDecomposed();
    CHECK(t.worldPosition.x == doctest::Approx(50000));
}

TEST_CASE("a Children component written by hand does not change what composes") {
    Registry r; TransformSystem system;
    auto root = r.create(), child = r.create();
    r.emplace<Transform>(root).position.x = 3;
    r.emplace<Transform>(child).position.x = 2;
    setParent(r, child, root);
    // The component is a copy of the relation: a duplicate or a back-edge written into it is not a link.
    r.get<Children>(root).entities.push_back(child);
    r.emplace<Children>(child).entities.push_back(root);
    system.setChangeTracking(true);
    system.ensureComposed(r);
    r.get<Transform>(child).ensureDecomposed();
    CHECK(r.get<Transform>(child).worldPosition.x == doctest::Approx(5));
    CHECK(system.visited() == 2);
}

TEST_CASE("static ancestors preserve cached matrices while dirty descendants update") {
    Registry r; TransformSystem system;
    auto root = r.create(), child = r.create(), leaf = r.create();
    r.emplace<Transform>(root).position.x = 10;
    r.emplace<Transform>(child).position.x = 3;
    r.emplace<Transform>(leaf).position.x = 2;
    setParent(r, child, root); setParent(r, leaf, child);
    system.ensureComposed(r);
    CHECK_FALSE(r.has<TransformDirty>(child));
    CHECK_FALSE(r.has<TransformDirty>(leaf));
    r.emplace<TransformStatic>(root); r.emplace<TransformStatic>(child);
    r.get<Transform>(child).position.x = 7;
    r.emplace<TransformDirty>(child);
    invalidateTransformComposition(); system.ensureComposed(r);
    r.get<Transform>(leaf).ensureDecomposed();
    CHECK(r.get<Transform>(leaf).worldPosition.x == doctest::Approx(19));
    CHECK_FALSE(r.has<TransformDirty>(child));
    const auto serial = system.compositionSerial();
    system.ensureComposed(r); CHECK(system.compositionSerial() == serial);
}

TEST_CASE("traversal stamps are independent across compositions and registries") {
    TransformSystem system;
    for (int i = 0; i < 3; ++i) {
        Registry r;
        auto root = r.create(), child = r.create();
        r.emplace<Transform>(root).position.x = i * 10;
        r.emplace<Transform>(child).position.x = 2;
        setParent(r, child, root);
        system.ensureComposed(r);
        r.get<Transform>(child).ensureDecomposed();
        CHECK(r.get<Transform>(child).worldPosition.x == doctest::Approx(i * 10 + 2));
        // Written the way every producer writes: stamped, so composition knows it changed.
        r.patch<Transform>(root).position.x += 5;
        invalidateTransformComposition(); system.ensureComposed(r);
        r.get<Transform>(child).ensureDecomposed();
        CHECK(r.get<Transform>(child).worldPosition.x == doctest::Approx(i * 10 + 7));
    }
}

TEST_CASE("a static childless root builds its matrix when its first child arrives") {
    Registry r; TransformSystem system;
    auto root = r.create(); r.emplace<Transform>(root).position.x = 10;
    system.ensureComposed(r);
    r.emplace<TransformStatic>(root);
    auto child = r.create(); r.emplace<Transform>(child).position.x = 3;
    setParent(r, child, root);
    system.ensureComposed(r);
    r.get<Transform>(child).ensureDecomposed();
    CHECK(r.get<Transform>(child).worldPosition.x == doctest::Approx(13));
    CHECK_FALSE(r.has<TransformDirty>(root));
    CHECK_FALSE(r.has<TransformDirty>(child));
}

TEST_CASE("siblings retain their own parent matrices during iterative traversal") {
    Registry r; TransformSystem system;
    auto root = r.create();
    r.emplace<Transform>(root).position.x = 10;
    r.get<Transform>(root).scale.x = 2;
    for (int offset : {1, 4}) {
        auto child = r.create(), leaf = r.create();
        r.emplace<Transform>(child).position.x = offset;
        r.emplace<Transform>(leaf).position.x = 3;
        setParent(r, child, root); setParent(r, leaf, child);
    }
    system.setChangeTracking(true);
    system.ensureComposed(r);
    const auto& siblings = r.get<Children>(root).entities;
    auto left = r.get<Children>(siblings[0]).entities[0];
    auto right = r.get<Children>(siblings[1]).entities[0];
    r.get<Transform>(left).ensureDecomposed(); r.get<Transform>(right).ensureDecomposed();
    CHECK(r.get<Transform>(left).worldPosition.x == doctest::Approx(18));
    CHECK(r.get<Transform>(right).worldPosition.x == doctest::Approx(24));
    const std::vector<Entity> expected{root, siblings[0], left, siblings[1], right};
    CHECK(system.pendingChanges() == expected);
}

// Composition recomposes only what was written since the last one. Whatever it skips must hold what a composition from
// scratch would give: a random forest is edited at random, frame after frame, and every entity's world position compared with
// one worked out from nothing but the local transforms.
TEST_CASE("composing only what changed gives what composing everything gives") {
    Registry r; TransformSystem system;
    std::vector<Entity> all;
    u32 seed = 12345;
    const auto random = [&seed](u32 n) { seed = seed * 1664525u + 1013904223u; return (seed >> 8) % n; };
    for (int i = 0; i < 400; ++i) {
        const auto e = r.create();
        // One in eight is a folder: no Transform of its own, its children compose through it.
        if (random(8) != 0) {
            auto& t = r.emplace<Transform>(e);
            t.position = {static_cast<f32>(random(100)), static_cast<f32>(random(100)), 0};
            t.rotation = glm::angleAxis(static_cast<f32>(random(628)) / 100.0f, glm::vec3(0, 0, 1));
        }
        if (!all.empty() && random(4) != 0) REQUIRE(setParent(r, e, all[random(static_cast<u32>(all.size()))]));
        all.push_back(e);
    }
    const auto expectedWorld = [&r](Entity e) {
        glm::mat4 world{1.0f};
        std::vector<Entity> chain;
        for (Entity at = e; at.isValid(); at = r.childOf().target(at)) chain.push_back(at);
        for (auto it = chain.rbegin(); it != chain.rend(); ++it) {
            if (const auto* t = r.tryGet<Transform>(*it)) world = world * math::compose(t->position, t->rotation, t->scale);
        }
        return glm::vec3(world[3]);
    };
    const auto compare = [&]() {
        for (const auto e : all) {
            auto* t = r.tryGet<Transform>(e);
            if (!t) continue;
            t->ensureDecomposed();
            const auto want = expectedWorld(e);
            CHECK(t->worldPosition.x == doctest::Approx(want.x).epsilon(1e-3));
            CHECK(t->worldPosition.y == doctest::Approx(want.y).epsilon(1e-3));
        }
    };
    system.ensureComposed(r);
    compare();
    for (int frame = 0; frame < 60; ++frame) {
        // A few local writes through the stamping path, and now and then a dirty tag with no write.
        for (int k = 0; k < 5; ++k) {
            const auto e = all[random(static_cast<u32>(all.size()))];
            if (!r.has<Transform>(e)) continue;
            r.patch<Transform>(e).position.x += static_cast<f32>(random(20)) - 10.0f;
        }
        if (random(3) == 0) {
            const auto e = all[random(static_cast<u32>(all.size()))];
            if (!r.has<TransformDirty>(e)) r.emplace<TransformDirty>(e);
        }
        // A few reparents: under another entity (refused where it would make a cycle), or detached to a root.
        for (int k = 0; k < 3; ++k) {
            const auto e = all[random(static_cast<u32>(all.size()))];
            const auto to = random(5) == 0 ? INVALID_ENTITY : all[random(static_cast<u32>(all.size()))];
            setParent(r, e, to);
        }
        // Now and then an entity is destroyed: its children become roots, its tree is rebuilt without it.
        if (random(4) == 0 && all.size() > 50) {
            const usize at = random(static_cast<u32>(all.size()));
            r.destroy(all[at]);
            all.erase(all.begin() + static_cast<std::ptrdiff_t>(at));
        }
        invalidateTransformComposition();
        system.ensureComposed(r);
        compare();
    }
}

TEST_CASE("a reparent recomposes the moved subtree, not the world") {
    Registry r; TransformSystem system;
    std::vector<Entity> roots;
    for (int t = 0; t < 10; ++t) {
        const auto root = r.create();
        r.emplace<Transform>(root).position.x = static_cast<f32>(t * 100);
        roots.push_back(root);
        for (int i = 0; i < 20; ++i) {
            const auto leaf = r.create();
            r.emplace<Transform>(leaf).position.y = 1;
            REQUIRE(setParent(r, leaf, root));
        }
    }
    // A childless root that is about to become a parent: it has never built the matrix its child composes under.
    const auto lone = r.create();
    r.emplace<Transform>(lone).position.x = 7;
    system.setChangeTracking(true);
    system.ensureComposed(r);
    system.takeChanges();
    const auto moved = r.childOf().first(roots[3]);
    REQUIRE(setParent(r, moved, lone));
    system.ensureComposed(r);
    CHECK(system.visited() == 1);
    auto& t = r.get<Transform>(moved);
    t.ensureDecomposed();
    CHECK(t.worldPosition.x == doctest::Approx(7));
    CHECK(t.worldPosition.y == doctest::Approx(1));
    // Destroying a parent leaves its children roots: their world is their local transform now.
    const auto orphan = r.childOf().first(roots[5]);
    r.destroy(roots[5]);
    system.ensureComposed(r);
    auto& o = r.get<Transform>(orphan);
    o.ensureDecomposed();
    CHECK(o.worldPosition.x == doctest::Approx(0));
    CHECK(o.worldPosition.y == doctest::Approx(1));
}

TEST_CASE("a frame that wrote one leaf recomposes that leaf, not the tree") {
    Registry r; TransformSystem system;
    const auto root = r.create();
    r.emplace<Transform>(root);
    std::vector<Entity> leaves;
    for (int i = 0; i < 100; ++i) {
        const auto leaf = r.create();
        r.emplace<Transform>(leaf).position.x = static_cast<f32>(i);
        REQUIRE(setParent(r, leaf, root));
        leaves.push_back(leaf);
    }
    system.setChangeTracking(true);
    system.ensureComposed(r);
    system.takeChanges();
    r.patch<Transform>(leaves[7]).position.x = 500;
    invalidateTransformComposition();
    system.ensureComposed(r);
    CHECK(system.visited() == 1);
    CHECK(system.pendingChanges() == std::vector<Entity>{leaves[7]});
    auto& t = r.get<Transform>(leaves[7]);
    t.ensureDecomposed();
    CHECK(t.worldPosition.x == doctest::Approx(500));
    // A write to the root moves all of them.
    system.takeChanges();
    r.patch<Transform>(root).position.y = 3;
    invalidateTransformComposition();
    system.ensureComposed(r);
    CHECK(system.visited() == 101);
}

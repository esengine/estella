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
        if (parent != INVALID_ENTITY) {
            r.emplace<Parent>(leaf).entity = parent;
            r.emplace<Children>(parent).entities.push_back(leaf);
        }
        parent = leaf;
    }
    system.ensureComposed(r);
    auto& t = r.get<Transform>(leaf); t.ensureDecomposed();
    CHECK(t.worldPosition.x == doctest::Approx(50000));
}

TEST_CASE("corrupted child links cannot repeat a traversal forever") {
    Registry r; TransformSystem system;
    auto root = r.create(), child = r.create();
    r.emplace<Transform>(root).position.x = 3;
    r.emplace<Transform>(child).position.x = 2;
    setParent(r, child, root);
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
        r.get<Transform>(root).position.x += 5;
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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include "esengine/ecs/TransformSystem.hpp"

using namespace esengine;
using namespace esengine::ecs;

TEST_CASE("rejected hierarchy edits preserve the existing link") {
    Registry r;
    const auto root = r.create(), child = r.create(), leaf = r.create();
    REQUIRE(setParent(r, child, root));
    REQUIRE(setParent(r, leaf, child));
    const auto epoch = transformMutationEpoch();
    CHECK_FALSE(setParent(r, child, child));
    CHECK_FALSE(setParent(r, child, leaf));
    const auto stale = r.create();
    r.destroy(stale);
    CHECK_FALSE(setParent(r, child, stale));
    CHECK_FALSE(setParent(r, stale, root));
    CHECK(r.get<Parent>(child).entity == root);
    CHECK(r.get<Children>(root).entities == std::vector<Entity>{child});
    CHECK(transformMutationEpoch() == epoch);
}

TEST_CASE("repeated parenting does not reorder siblings or invalidate composition") {
    Registry r;
    const auto root = r.create(), a = r.create(), b = r.create();
    REQUIRE(setParent(r, a, root));
    REQUIRE(setParent(r, b, root));
    const auto epoch = transformMutationEpoch();
    CHECK(setParent(r, a, root));
    CHECK(r.get<Children>(root).entities == std::vector<Entity>{a, b});
    CHECK(transformMutationEpoch() == epoch);
}

TEST_CASE("both wire null representations detach") {
    Registry r;
    const auto root = r.create(), child = r.create();
    for (const Entity sentinel : {Entity::fromRaw(0), INVALID_ENTITY}) {
        REQUIRE(setParent(r, child, root));
        CHECK(setParent(r, child, sentinel));
        CHECK_FALSE(r.has<Parent>(child));
        CHECK(r.get<Children>(root).entities.empty());
    }
}

TEST_CASE("the hierarchy is the ChildOf relation, and a Parent written as a component links nothing") {
    Registry r;
    const auto a = r.create(), b = r.create(), child = r.create();
    // The relation is the authority; the components are its copy. A raw component write cannot make a link, so it cannot
    // make the cycle the components once could hold.
    r.emplace<Parent>(a, b);
    r.emplace<Parent>(b, a);
    CHECK_FALSE(r.childOf().hasTarget(a));
    CHECK(setParent(r, child, a));
    CHECK(r.childOf().target(child) == a);
    CHECK(r.get<Children>(a).entities == std::vector<Entity>{child});
}

TEST_CASE("removing a sibling keeps the others in order") {
    Registry r;
    const auto root = r.create(), a = r.create(), b = r.create(), c = r.create();
    for (const auto e : {a, b, c}) REQUIRE(setParent(r, e, root));
    REQUIRE(setParent(r, a, INVALID_ENTITY));
    CHECK(r.get<Children>(root).entities == std::vector<Entity>{b, c});
    r.destroy(b);
    CHECK(r.childOf().first(root) == c);
    CHECK(r.childOf().count(root) == 1);
}

TEST_CASE("a destroyed parent leaves its children roots") {
    Registry r;
    const auto root = r.create(), child = r.create(), leaf = r.create();
    REQUIRE(setParent(r, child, root));
    REQUIRE(setParent(r, leaf, child));
    r.destroy(root);
    CHECK_FALSE(r.childOf().hasTarget(child));
    CHECK(r.childOf().depth(child) == 0);
    CHECK(r.childOf().depth(leaf) == 1);
    // The slot is reused by a new entity, which owns none of the old one's links.
    const auto fresh = r.create();
    CHECK_FALSE(r.childOf().hasSources(fresh));
    CHECK(setParent(r, child, INVALID_ENTITY));
    CHECK_FALSE(r.has<Parent>(child));
}

TEST_CASE("subtree destruction is iterative and children precede their parents") {
    Registry r;
    std::vector<Entity> ids, events;
    constexpr usize count = 20000;
    ids.reserve(count);
    for (usize i = 0; i < count; ++i) {
        const auto e = r.create();
        ids.push_back(e);
        if (i != 0) {
            // A valid chain linked directly so this test measures teardown,
            // not the separate ancestry checks charged by setParent.
            r.childOf().link(e, ids[i - 1]);
        }
    }
    auto connection = r.onDestroy([&](Entity e) { events.push_back(e); });
    destroyWithChildren(r, ids.front());
    CHECK(r.entityCount() == 0);
    std::reverse(ids.begin(), ids.end());
    CHECK(events == ids);
}

TEST_CASE("subtree callbacks cannot recursively destroy ancestors or attach children to them") {
    Registry r;
    const auto root = r.create(), child = r.create(), survivor = r.create();
    REQUIRE(setParent(r, child, root));
    std::vector<Entity> events;
    auto connection = r.onDestroy([&](Entity e) {
        events.push_back(e);
        if (e == child) {
            destroyWithChildren(r, root);
            CHECK(r.valid(root)); // reserved, still waiting for this child's callbacks
            CHECK_FALSE(setParent(r, survivor, root));
        }
    });
    destroyWithChildren(r, root);
    CHECK(events == std::vector<Entity>{child, root});
    CHECK(r.entityCount() == 1);
    CHECK_FALSE(r.has<Parent>(survivor));
    CHECK(r.valid(survivor));
}

TEST_CASE("a corrupt child back-edge is destroyed once and reservations do not survive teardown") {
    Registry r;
    const auto root = r.create(), child = r.create();
    REQUIRE(setParent(r, child, root));
    r.emplace<Children>(child).entities.push_back(root);
    usize callbacks = 0;
    auto connection = r.onDestroy([&](Entity) { ++callbacks; });
    destroyWithChildren(r, root);
    CHECK(r.entityCount() == 0);
    CHECK(callbacks == 2);
    CHECK_FALSE(r.destructionPending(root));
    CHECK_FALSE(r.destructionPending(child));
    const auto a = r.create(), b = r.create();
    CHECK(setParent(r, b, a));
}

TEST_CASE("an old teardown owner cannot release a new generation's reservation") {
    Registry r;
    const auto old = r.create();
    REQUIRE(r.reserveDestruction(old));
    CHECK_FALSE(r.reserveDestruction(old));
    r.destroy(old);
    const auto fresh = r.create();
    REQUIRE(fresh.index() == old.index());
    REQUIRE(fresh != old);
    REQUIRE(r.reserveDestruction(fresh));
    r.releaseDestruction(old);
    CHECK(r.destructionPending(fresh));
    const auto parent = r.create();
    CHECK_FALSE(setParent(r, fresh, parent));
    r.releaseDestruction(fresh);
    CHECK(setParent(r, fresh, parent));
    CHECK_FALSE(r.reserveDestruction(old));
    CHECK_FALSE(r.reserveDestruction(INVALID_ENTITY));
}

TEST_CASE("subtree finalization preserves a nested reservation in a reused child slot") {
    Registry r;
    const auto root = r.create(), child = r.create();
    REQUIRE(setParent(r, child, root));
    Entity fresh = INVALID_ENTITY;
    auto connection = r.onDestroy([&](Entity e) {
        if (e != root) return;
        fresh = r.create();
        REQUIRE(fresh.index() == child.index());
        CHECK(r.reserveDestruction(fresh));
    });
    destroyWithChildren(r, root);
    CHECK(r.valid(fresh));
    CHECK(r.destructionPending(fresh));
    r.releaseDestruction(fresh);
    CHECK_FALSE(r.destructionPending(fresh));
}

TEST_CASE("the cascade lists every tree parent first, siblings in order, and follows every edit") {
    Registry r;
    const auto root = r.create(), a = r.create(), b = r.create(), a1 = r.create(), a2 = r.create(), lone = r.create();
    REQUIRE(setParent(r, a, root));
    REQUIRE(setParent(r, b, root));
    REQUIRE(setParent(r, a1, a));
    REQUIRE(setParent(r, a2, a));
    const auto check = [&](std::vector<Entity> expected) {
        const auto& order = r.childOf().cascade();
        std::vector<Entity> got;
        for (usize i = 0; i < order.size(); ++i) {
            got.push_back(order[i].entity);
            const Entity parent = r.childOf().target(order[i].entity);
            if (parent.isValid()) {
                REQUIRE(order[i].parent < i);
                CHECK(order[order[i].parent].entity == parent);
            } else {
                CHECK(order[i].parent == ExclusiveRelation::NONE);
            }
        }
        CHECK(got == expected);
    };
    // An entity in no tree is not listed.
    (void)lone;
    check({root, a, a1, a2, b});
    REQUIRE(setParent(r, b, a1));
    check({root, a, a1, b, a2});
    const Entity order[] = {a2, a1};
    applySceneEntityOrder(r, order, 2);
    check({root, a, a2, a1, b});
    r.destroy(a);
    // The destroyed parent's children are roots of their own trees now; a2 has no children, so only a1's tree remains.
    const auto& left = r.childOf().cascade();
    CHECK(left.size() == 2);
    CHECK(left[0].entity == a1);
    CHECK(left[1].entity == b);
}

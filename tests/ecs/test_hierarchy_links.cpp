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
        if (i != 0) REQUIRE(setParent(r, e, ids[i - 1]));
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

TEST_CASE("clearing inside subtree destruction leaves the replacement hierarchy and its reservations intact") {
    Registry registry;
    const Entity root = registry.create(), child = registry.create();
    REQUIRE(setParent(registry, child, root));
    const auto originalSet = registry.entitySetId();
    const auto originalRegistry = registry.instanceId();
    int calls = 0;
    auto replace = registry.onDestroy([&](Entity entity) {
        REQUIRE(entity.raw == child.raw);
        ++calls;
        registry.clear();
        CHECK_FALSE(registry.destructionPending(root));
        registry.releaseDestruction(child);
        REQUIRE(registry.create().raw == root.raw);
        REQUIRE(registry.create().raw == child.raw);
        REQUIRE(setParent(registry, child, root));
        REQUIRE(registry.reserveDestruction(root));
    });
    destroyWithChildren(registry, root);
    CHECK(calls == 1);
    CHECK(registry.entitySetId() != originalSet);
    CHECK(registry.instanceId() == originalRegistry);
    CHECK(registry.identity() == originalRegistry);
    CHECK(registry.entityCount() == 2);
    CHECK(registry.destructionPending(root));
    CHECK(registry.childOf().target(child).raw == root.raw);
    CHECK(registry.get<Children>(root).entities.size() == 1);
    registry.releaseDestruction(root);
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
        std::vector<Entity> got;
        for (const auto& tree : r.childOf().cascade()) {
            if (!tree.alive) continue;
            const auto& order = tree.entries;
            for (usize i = 0; i < order.size(); ++i) {
                got.push_back(order[i].entity);
                const auto at = r.childOf().cascadeAt(order[i].entity);
                CHECK(order[at.slot].entity == order[i].entity);
                const Entity parent = r.childOf().target(order[i].entity);
                if (parent.isValid()) {
                    REQUIRE(order[i].parent < i);
                    CHECK(order[order[i].parent].entity == parent);
                } else {
                    CHECK(order[i].parent == ExclusiveRelation::NONE);
                }
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
    check({a1, b});
}

TEST_CASE("batched moves, splits and reused roots agree with a fresh walk of the forest") {
    Registry r;
    std::vector<Entity> ids(16);
    for (auto& e : ids) e = r.create();
    auto& rel = r.childOf();
    const auto checkForest = [&] {
        const auto& trees = rel.cascade();
        usize roots = 0;
        for (const auto e : ids) {
            std::vector<Entity> ancestors;
            for (Entity p = rel.target(e); p.isValid(); p = rel.target(p)) {
                REQUIRE(ancestors.size() < ids.size());
                ancestors.push_back(p);
            }
            CHECK(rel.depth(e) == ancestors.size());
            for (const auto candidate : ids) {
                const bool onPath = std::find(ancestors.begin(), ancestors.end(), candidate) != ancestors.end();
                CHECK(rel.isDescendantOf(e, candidate) == onPath);
            }
            if (!ancestors.empty()) continue;
            const auto at = rel.cascadeAt(e);
            if (!rel.hasSources(e)) {
                CHECK(at.tree == ExclusiveRelation::NONE);
                continue;
            }
            ++roots;
            REQUIRE(at.tree < trees.size());
            const auto& tree = trees[at.tree];
            REQUIRE(tree.alive);
            REQUIRE(tree.root == e);
            u32 cursor = 0;
            const auto visit = [&](auto&& self, Entity child, u32 parent) -> void {
                const u32 slot = cursor++;
                REQUIRE(slot < tree.entries.size());
                const auto& entry = tree.entries[slot];
                CHECK(entry.entity == child);
                CHECK(entry.parent == parent);
                CHECK(rel.cascadeAt(child).tree == at.tree);
                CHECK(rel.cascadeAt(child).slot == slot);
                rel.eachSource(child, [&](Entity next) { self(self, next, slot); });
                CHECK(entry.end == cursor);
            };
            visit(visit, e, ExclusiveRelation::NONE);
            CHECK(cursor == tree.entries.size());
        }
        const auto alive = std::count_if(trees.begin(), trees.end(), [](const auto& tree) { return tree.alive; });
        CHECK(static_cast<usize>(alive) == roots);
    };
    checkForest();
    const auto link = [&](int child, int parent) { REQUIRE(setParent(r, ids[child], ids[parent])); };
    link(1, 0); link(2, 1); link(3, 2);
    link(5, 4); link(6, 5);
    link(8, 7);
    checkForest();

    link(2, 5); link(5, 9); link(10, 2);
    REQUIRE(setParent(r, ids[2], INVALID_ENTITY));
    link(3, 11); link(2, 1);
    const auto retired = ids[0];
    r.destroy(retired);
    ids[0] = r.create();
    REQUIRE(ids[0].index() == retired.index());
    link(12, 0); link(1, 12);
    CHECK_FALSE(rel.isDescendantOf(ids[2], retired));
    checkForest();

    // Several edits between reads exercise both endpoints against the same old snapshot.
    u32 seed = 85213;
    const auto next = [&]() {
        seed = seed * 1664525u + 1013904223u;
        return (seed >> 8) % ids.size();
    };
    for (int batch = 0; batch < 32; ++batch) {
        for (int edit = 0; edit < 9; ++edit) {
            const auto i = next(), j = next();
            if (edit == 0) {
                r.destroy(ids[i]);
                ids[i] = r.create();
            } else if (edit == 1) {
                REQUIRE(setParent(r, ids[i], INVALID_ENTITY));
            } else {
                // Reconstruct the cycle check independently, including rejected reparentings.
                bool allowed = ids[i] != ids[j];
                for (auto p = rel.target(ids[j]); p.isValid(); p = rel.target(p)) {
                    if (p == ids[i]) allowed = false;
                }
                CHECK(setParent(r, ids[i], ids[j]) == allowed);
            }
        }
        checkForest();
    }
}

TEST_CASE("many newly rooted trees survive one cascade refresh") {
    Registry r;
    auto& rel = r.childOf();
    rel.cascade();
    std::vector<Entity> roots(1100);
    for (auto& root : roots) {
        root = r.create();
        REQUIRE(setParent(r, r.create(), root));
    }
    const auto& trees = rel.cascade();
    for (const auto root : roots) {
        const auto t = rel.cascadeAt(root).tree;
        REQUIRE(t < trees.size());
        CHECK(trees[t].root == root);
        REQUIRE(trees[t].entries.size() == 2);
        CHECK(trees[t].entries[1].entity == rel.first(root));
    }
}

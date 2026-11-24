// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include "esengine/ecs/RegistrySystems.hpp"
#include "esengine/ecs/TransformSystem.hpp"
#include "esengine/trail/TrailSystem.hpp"

using namespace esengine;
using namespace esengine::trail;

namespace {
Entity emitter(ecs::Registry& registry, f32 x) {
    const Entity entity = registry.create();
    registry.emplace<ecs::Transform>(entity).worldPosition.x = x;
    registry.emplace<ecs::TrailRenderer>(entity).minVertexDistance = 0.1f;
    return entity;
}
}

TEST_CASE("trail anchors, time and entity teardown belong to the registry that recorded them") {
    ecs::RegistrySystems<TrailSystem> worlds;
    ecs::Registry left, right;
    const Entity a = emitter(left, -3), b = emitter(right, 7);
    REQUIRE(a == b);
    REQUIRE_FALSE(worlds.find(right));
    auto first = worlds.forRegistry(left), second = worlds.forRegistry(right);
    first->update(left, 0.125f);
    second->update(right, 0.25f);
    left.get<ecs::Transform>(a).worldPosition.x = -2;
    first->update(left, 0.125f);
    REQUIRE(first->getState(a));
    REQUIRE(second->getState(b));
    CHECK(first->getState(a)->points.size() == 2);
    CHECK(first->getState(a)->points.front().position.x == -3);
    CHECK(second->getState(b)->points.front().position.x == 7);
    CHECK(second->getState(b)->points.front().birth_time == 0.25f);
    left.get<ecs::TrailRenderer>(a).emitting = false;
    first->update(left, 10.0f);
    CHECK_FALSE(first->getState(a));
    CHECK(second->now() == 0.25f);
    first->clear(a);
    left.destroy(a);
    CHECK(second->getState(b));
    right.destroy(b);
    CHECK_FALSE(second->getState(b));
}

TEST_CASE("closing either owner drops trail history before a replacement world reuses its entity IDs") {
    ecs::Registry surviving;
    const auto entity = emitter(surviving, 1);
    Weak<TrailSystem> known, retired;
    {
        ecs::RegistrySystems<TrailSystem> worlds;
        known = worlds.forRegistry(surviving);
        {
            ecs::Registry temporary;
            CHECK(emitter(temporary, 2) == entity);
            auto system = worlds.forRegistry(temporary);
            system->update(temporary, 1.0f);
            retired = system;
        }
        CHECK(retired.expired());
        ecs::Registry fresh;
        REQUIRE(emitter(fresh, 5) == entity);
        CHECK_FALSE(worlds.find(fresh));
        CHECK_FALSE(worlds.forRegistry(fresh)->getState(entity));
        CHECK_FALSE(known.expired());
    }
    CHECK(known.expired());
    surviving.destroy(entity);
}

TEST_CASE("a trail records its newly composed parent transform before rendering") {
    ecs::Registry world;
    ecs::TransformSystem transforms;
    TrailSystem trail;
    const auto parent = world.create(), child = emitter(world, 0);
    world.emplace<ecs::Transform>(parent).position.x = 5;
    world.patch<ecs::Transform>(child).position.x = -1;
    ecs::setParent(world, child, parent);
    trail.update(world, 0.01f, &transforms);
    world.patch<ecs::Transform>(parent).position.x = 9;
    ecs::invalidateTransformComposition();
    trail.update(world, 0.01f, &transforms);
    REQUIRE(trail.getState(child));
    const auto& points = trail.getState(child)->points;
    REQUIRE(points.size() == 2);
    CHECK(points.front().position.x == 4);
    CHECK(points.back().position.x == 8);
}

TEST_CASE("a temporary engine created during despawn releases its trail simulation after dispatch") {
    ecs::Registry registry;
    Weak<TrailSystem> retired;
    auto listener = registry.onDestroy([&](Entity) {
        ecs::RegistrySystems<TrailSystem> temporary;
        retired = temporary.forRegistry(registry);
    });
    registry.destroy(registry.create());
    CHECK(retired.expired());
}

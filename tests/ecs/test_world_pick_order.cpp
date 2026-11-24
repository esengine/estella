// SPDX-License-Identifier: Apache-2.0
#include <doctest.h>
#include <esengine/ecs/TransformSystem.hpp>
#include <esengine/ecs/components/Hierarchy.hpp>
#include <esengine/ecs/components/Interactable.hpp>
#include <esengine/ecs/components/Sprite.hpp>
#include <esengine/ecs/components/Transform.hpp>
#include <esengine/ui/UISystem.hpp>

using namespace esengine;
using namespace esengine::ecs;

TEST_CASE("world picks follow directly authored child lists, including missing and duplicate entries") {
    Registry registry;
    UISystem ui;
    const Entity parent = registry.create();
    std::vector<Entity> children;
    for (u32 i = 0; i < 256; ++i) {
        const Entity child = registry.create();
        registry.emplace<Transform>(child);
        registry.emplace<Sprite>(child);
        registry.emplace<Interactable>(child);
        setParent(registry, child, parent);
        children.push_back(child);
    }
    TransformSystem transforms;
    transforms.ensureComposed(registry);
    const auto pick = [&] {
        ui.hitTestUpdate(registry, PickRay{{0, 0, 10}, {0, 0, -1}}, nullptr);
        return ui.hitResult.hit_entity;
    };

    auto& listed = registry.get<Children>(parent).entities;
    for (usize i = 0; i < children.size(); ++i) listed[i] = children[(i * 73) % children.size()];
    const Entity last = listed.back();
    listed.push_back(listed.front());
    CHECK_EQ(pick().raw, last.raw);

    // An unlisted child ranks past the list; a stale handle is a different child.
    const Entity omitted = listed[3];
    listed[3] = Entity::make(omitted.index(), omitted.generation() + 1);
    CHECK_EQ(pick().raw, omitted.raw);
    registry.remove<Children>(parent);
    CHECK_EQ(pick().raw, children.back().raw);
    registry.get<Parent>(children.front()).entity = Entity::make(parent.index(), parent.generation() + 1);
    CHECK_EQ(pick().raw, children.front().raw);
}

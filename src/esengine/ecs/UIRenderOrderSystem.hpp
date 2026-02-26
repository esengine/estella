#pragma once

#include "Registry.hpp"
#include "components/Hierarchy.hpp"
#include "components/UIRect.hpp"
#include "components/Sprite.hpp"
#include "components/Canvas.hpp"

namespace esengine::ecs {

inline i32 assignRenderOrder(Registry& registry, Entity entity, i32 counter) {
    if (registry.has<Sprite>(entity) && registry.has<UIRect>(entity)) {
        auto& sprite = registry.get<Sprite>(entity);
        if (sprite.layer != counter) {
            sprite.layer = counter;
        }
        counter++;
    }

    auto* children = registry.tryGet<Children>(entity);
    if (!children) return counter;

    for (Entity child : children->entities) {
        if (registry.valid(child)) {
            counter = assignRenderOrder(registry, child, counter);
        }
    }
    return counter;
}

inline void uiRenderOrderUpdate(Registry& registry) {
    i32 counter = 0;
    registry.each<Canvas>([&](Entity entity, Canvas&) {
        counter = assignRenderOrder(registry, entity, counter);
    });
}

}  // namespace esengine::ecs

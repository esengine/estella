// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../ecs/Registry.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/UIVisual.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/ParticleEmitter.hpp"

namespace esengine::ecs {

inline i32 assignRenderOrder(Registry& registry, Entity entity, i32 counter, u32 cullBit) {
    if (registry.has<UINode>(entity)) {
        auto* uiVisual = registry.tryGet<UIVisual>(entity);
        if (uiVisual) {
            uiVisual->uiOrder = counter;
            uiVisual->uiCullBit = cullBit;
            counter++;
        } else if (registry.has<Sprite>(entity)) {
            auto& sprite = registry.get<Sprite>(entity);
            if (sprite.layer != counter) {
                sprite.layer = counter;
            }
            counter++;
        } else if (auto* emitter = registry.tryGet<ParticleEmitter>(entity)) {
            // An emitter in the UI tree draws where the tree says it does, like the
            // Sprite above: without this it keeps its authored layer and a UI effect
            // lands under (or over) the whole panel instead of between two of its
            // elements — the reason Unity needs a UIParticle extension at all.
            if (emitter->layer != counter) {
                emitter->layer = counter;
            }
            counter++;
        }
    }

    auto* children = registry.tryGet<Children>(entity);
    if (!children) return counter;

    for (Entity child : children->entities) {
        if (registry.valid(child)) {
            counter = assignRenderOrder(registry, child, counter, cullBit);
        }
    }
    return counter;
}

inline void uiRenderOrderUpdate(Registry& registry) {
    i32 counter = 0;
    registry.each<Canvas>([&](Entity entity, Canvas& canvas) {
        const u32 bit = (canvas.layer < 0 || canvas.layer >= 32) ? 0u : (1u << canvas.layer);
        counter = assignRenderOrder(registry, entity, counter, bit);
    });
}

}  // namespace esengine::ecs

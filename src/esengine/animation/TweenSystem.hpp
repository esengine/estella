// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "../ecs/Registry.hpp"
#include "TweenData.hpp"

#include <vector>

namespace esengine::animation {

class TweenSystem {
public:
    void update(ecs::Registry& registry, f32 deltaTime);

    Entity createTween(ecs::Registry& registry, Entity targetEntity,
                       TweenTarget property, f32 from, f32 to,
                       f32 duration, EasingType easing = EasingType::Linear);

    void cancelTween(ecs::Registry& registry, Entity tweenEntity);
    void cancelAllTweens(ecs::Registry& registry, Entity targetEntity);
    void pauseTween(ecs::Registry& registry, Entity tweenEntity);
    void resumeTween(ecs::Registry& registry, Entity tweenEntity);

private:
    void applyValue(ecs::Registry& registry, const TweenData& tween, f32 value);
    f32 evaluateEasing(const TweenData& tween, f32 t);

    std::vector<Entity> pending_remove_;
    // UINode entities whose anim_override_ flags were set this frame; cleared at
    // the start of the next update so layout regains the field once a tween ends.
    std::vector<Entity> ui_flagged_;
};

}  // namespace esengine::animation

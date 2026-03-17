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
};

}  // namespace esengine::animation

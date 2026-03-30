#include "TweenSystem.hpp"
#include "EasingFunctions.hpp"
#include "AnimPropertyApply.hpp"

#include <algorithm>

namespace esengine::animation {

void TweenSystem::update(ecs::Registry& registry, f32 deltaTime) {
    pending_remove_.clear();

    for (auto entity : registry.view<TweenData>()) {
        auto& tween = registry.get<TweenData>(entity);

        if (tween.state != TweenState::Running) {
            if (tween.state == TweenState::Completed || tween.state == TweenState::Cancelled) {
                pending_remove_.push_back(entity);
            }
            continue;
        }

        if (tween.delay > 0.0f) {
            tween.delay -= deltaTime;
            if (tween.delay > 0.0f) {
                continue;
            }
            deltaTime = -tween.delay;
            tween.delay = 0.0f;
        }

        tween.elapsed += deltaTime;
        f32 rawT = (tween.duration > 0.0f)
            ? glm::clamp(tween.elapsed / tween.duration, 0.0f, 1.0f)
            : 1.0f;
        f32 easedT = evaluateEasing(tween, rawT);
        f32 value = glm::mix(tween.from_value, tween.to_value, easedT);

        applyValue(registry, tween, value);

        if (rawT >= 1.0f) {
            if (tween.loop_mode == LoopMode::None) {
                tween.state = TweenState::Completed;
                if (tween.sequence_next != INVALID_ENTITY) {
                    if (auto* next = registry.tryGet<TweenData>(tween.sequence_next)) {
                        next->state = TweenState::Running;
                    }
                }
                pending_remove_.push_back(entity);
            } else if (tween.loop_mode == LoopMode::Restart) {
                tween.elapsed = 0.0f;
                if (tween.loops_remaining > 0) {
                    tween.loops_remaining--;
                    if (tween.loops_remaining == 0) {
                        tween.state = TweenState::Completed;
                        pending_remove_.push_back(entity);
                    }
                }
            } else if (tween.loop_mode == LoopMode::PingPong) {
                tween.elapsed = 0.0f;
                std::swap(tween.from_value, tween.to_value);
                if (tween.loops_remaining > 0) {
                    tween.loops_remaining--;
                    if (tween.loops_remaining == 0) {
                        tween.state = TweenState::Completed;
                        pending_remove_.push_back(entity);
                    }
                }
            }
        }
    }

    for (auto entity : pending_remove_) {
        registry.destroy(entity);
    }
}

Entity TweenSystem::createTween(ecs::Registry& registry, Entity targetEntity,
                                 TweenTarget property, f32 from, f32 to,
                                 f32 duration, EasingType easing) {
    Entity tweenEntity = registry.create();
    auto& tween = registry.emplace<TweenData>(tweenEntity);
    tween.target_entity = targetEntity;
    tween.target_property = property;
    tween.from_value = from;
    tween.to_value = to;
    tween.duration = duration;
    tween.easing = easing;
    tween.state = TweenState::Running;
    return tweenEntity;
}

void TweenSystem::cancelTween(ecs::Registry& registry, Entity tweenEntity) {
    if (auto* tween = registry.tryGet<TweenData>(tweenEntity)) {
        tween->state = TweenState::Cancelled;
    }
}

void TweenSystem::cancelAllTweens(ecs::Registry& registry, Entity targetEntity) {
    for (auto entity : registry.view<TweenData>()) {
        auto& tween = registry.get<TweenData>(entity);
        if (tween.target_entity == targetEntity && tween.state == TweenState::Running) {
            tween.state = TweenState::Cancelled;
        }
    }
}

void TweenSystem::pauseTween(ecs::Registry& registry, Entity tweenEntity) {
    if (auto* tween = registry.tryGet<TweenData>(tweenEntity)) {
        if (tween->state == TweenState::Running) {
            tween->state = TweenState::Paused;
        }
    }
}

void TweenSystem::resumeTween(ecs::Registry& registry, Entity tweenEntity) {
    if (auto* tween = registry.tryGet<TweenData>(tweenEntity)) {
        if (tween->state == TweenState::Paused) {
            tween->state = TweenState::Running;
        }
    }
}

constexpr AnimTargetField TWEEN_TO_ANIM_FIELD[] = {
    AnimTargetField::TransformPositionX,
    AnimTargetField::TransformPositionY,
    AnimTargetField::TransformPositionZ,
    AnimTargetField::TransformScaleX,
    AnimTargetField::TransformScaleY,
    AnimTargetField::TransformRotationZ,
    AnimTargetField::SpriteColorR,
    AnimTargetField::SpriteColorG,
    AnimTargetField::SpriteColorB,
    AnimTargetField::SpriteColorA,
    AnimTargetField::SpriteSizeX,
    AnimTargetField::SpriteSizeY,
    AnimTargetField::CameraOrthoSize,
};

void TweenSystem::applyValue(ecs::Registry& registry, const TweenData& tween, f32 value) {
    Entity target = tween.target_entity;
    if (!registry.valid(target)) {
        return;
    }

    auto idx = static_cast<u8>(tween.target_property);
    if (idx < static_cast<u8>(TweenTarget::COUNT)) {
        applyAnimatedValue(registry, target, TWEEN_TO_ANIM_FIELD[idx], value);
    }
}

f32 TweenSystem::evaluateEasing(const TweenData& tween, f32 t) {
    if (tween.easing == EasingType::CubicBezier) {
        return cubicBezier(t, tween.bezier_p1x, tween.bezier_p1y,
                           tween.bezier_p2x, tween.bezier_p2y);
    }
    auto fn = getEasingFunction(tween.easing);
    return fn(t);
}

}  // namespace esengine::animation

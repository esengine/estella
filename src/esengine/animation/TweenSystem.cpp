#include "TweenSystem.hpp"
#include "EasingFunctions.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/Camera.hpp"

#include <glm/glm.hpp>
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
            continue;
        }

        tween.elapsed += deltaTime;
        f32 rawT = glm::clamp(tween.elapsed / tween.duration, 0.0f, 1.0f);
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

void TweenSystem::applyValue(ecs::Registry& registry, const TweenData& tween, f32 value) {
    Entity target = tween.target_entity;
    if (!registry.valid(target)) {
        return;
    }

    switch (tween.target_property) {
        case TweenTarget::TransformPositionX:
            if (auto* t = registry.tryGet<ecs::Transform>(target)) {
                t->position.x = value;
            }
            break;
        case TweenTarget::TransformPositionY:
            if (auto* t = registry.tryGet<ecs::Transform>(target)) {
                t->position.y = value;
            }
            break;
        case TweenTarget::TransformPositionZ:
            if (auto* t = registry.tryGet<ecs::Transform>(target)) {
                t->position.z = value;
            }
            break;
        case TweenTarget::TransformScaleX:
            if (auto* t = registry.tryGet<ecs::Transform>(target)) {
                t->scale.x = value;
            }
            break;
        case TweenTarget::TransformScaleY:
            if (auto* t = registry.tryGet<ecs::Transform>(target)) {
                t->scale.y = value;
            }
            break;
        case TweenTarget::TransformRotationZ: {
            if (auto* t = registry.tryGet<ecs::Transform>(target)) {
                f32 halfAngle = value * 0.5f;
                t->rotation.w = std::cos(halfAngle);
                t->rotation.x = 0.0f;
                t->rotation.y = 0.0f;
                t->rotation.z = std::sin(halfAngle);
            }
            break;
        }
        case TweenTarget::SpriteColorR:
            if (auto* s = registry.tryGet<ecs::Sprite>(target)) {
                s->color.r = value;
            }
            break;
        case TweenTarget::SpriteColorG:
            if (auto* s = registry.tryGet<ecs::Sprite>(target)) {
                s->color.g = value;
            }
            break;
        case TweenTarget::SpriteColorB:
            if (auto* s = registry.tryGet<ecs::Sprite>(target)) {
                s->color.b = value;
            }
            break;
        case TweenTarget::SpriteColorA:
            if (auto* s = registry.tryGet<ecs::Sprite>(target)) {
                s->color.a = value;
            }
            break;
        case TweenTarget::SpriteSizeX:
            if (auto* s = registry.tryGet<ecs::Sprite>(target)) {
                s->size.x = value;
            }
            break;
        case TweenTarget::SpriteSizeY:
            if (auto* s = registry.tryGet<ecs::Sprite>(target)) {
                s->size.y = value;
            }
            break;
        case TweenTarget::CameraOrthoSize:
            if (auto* c = registry.tryGet<ecs::Camera>(target)) {
                c->orthoSize = value;
            }
            break;
        default:
            break;
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

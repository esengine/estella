// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TweenSystem.hpp"
#include "EasingFunctions.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/UIRect.hpp"

#include <glm/glm.hpp>
#include <cmath>
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

// Tween owns the writes for its fixed 13 targets (was routed through the generic
// animTargets `applyAnimatedValue`; REARCH_ANIMATION P4b decouples it so the
// generic enum+switch can be deleted with the C++ timeline in P4c). Mirrors the
// per-field semantics exactly: rotation.z → half-angle quaternion, and the UIRect
// `anim_override_` flags so UI layout doesn't clobber animated Transform fields.
static void applyTweenValue(ecs::Registry& registry, Entity entity, TweenTarget target, f32 value) {
    switch (target) {
        case TweenTarget::TransformPositionX:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->position.x = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::ANIM_POS_X;
            }
            break;
        case TweenTarget::TransformPositionY:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->position.y = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::ANIM_POS_Y;
            }
            break;
        case TweenTarget::TransformPositionZ:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) c->position.z = value;
            break;
        case TweenTarget::TransformScaleX:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->scale.x = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::ANIM_SCALE_X;
            }
            break;
        case TweenTarget::TransformScaleY:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->scale.y = value;
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::ANIM_SCALE_Y;
            }
            break;
        case TweenTarget::TransformRotationZ:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                f32 h = value * 0.5f;
                c->rotation = glm::quat(std::cos(h), 0.0f, 0.0f, std::sin(h));
                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::ANIM_ROT_Z;
            }
            break;
        case TweenTarget::SpriteColorR:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->color.r = value;
            break;
        case TweenTarget::SpriteColorG:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->color.g = value;
            break;
        case TweenTarget::SpriteColorB:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->color.b = value;
            break;
        case TweenTarget::SpriteColorA:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->color.a = value;
            break;
        case TweenTarget::SpriteSizeX:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->size.x = value;
            break;
        case TweenTarget::SpriteSizeY:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->size.y = value;
            break;
        case TweenTarget::CameraOrthoSize:
            if (auto* c = registry.tryGet<ecs::Camera>(entity)) c->orthoSize = value;
            break;
        default:
            break;
    }
}

void TweenSystem::applyValue(ecs::Registry& registry, const TweenData& tween, f32 value) {
    Entity target = tween.target_entity;
    if (!registry.valid(target)) {
        return;
    }
    applyTweenValue(registry, target, tween.target_property, value);
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

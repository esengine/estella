// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "../ecs/TransformSystem.hpp"
#include "TweenSystem.hpp"
#include "EasingFunctions.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/UINode.hpp"

#include <glm/glm.hpp>
#include <cmath>
#include <algorithm>
#include <limits>

namespace esengine::animation {

void TweenSystem::update(ecs::Registry& registry, f32 deltaTime) {
    pending_remove_.clear();

    for (auto entity : ui_flagged_) {
        if (auto* n = registry.tryGet<ecs::UINode>(entity)) {
            n->anim_override_ = 0;
            registry.markChanged<ecs::UINode>(entity);
        }
    }
    ui_flagged_.clear();

    for (auto entity : registry.view<TweenData>()) {
        auto& tween = registry.get<TweenData>(entity);

        if (tween.state != TweenState::Running) {
            if (tween.state == TweenState::Completed || tween.state == TweenState::Cancelled) {
                pending_remove_.push_back(entity);
            }
            continue;
        }
        if (!registry.isEntityActive(entity) || !registry.isEntityActive(tween.target_entity)) continue;
        // A running tween moves its own clock every frame: its record is written whatever it drives.
        registry.markChanged<TweenData>(entity);
        f32 tweenDelta = deltaTime;

        if (tween.delay > 0.0f) {
            tween.delay -= deltaTime;
            if (tween.delay > 0.0f) {
                // HOLD the start value while waiting, rather than leaving the target
                // wherever it was. `from` is what the caller said the tween starts at,
                // and a delay is "start later", not "start elsewhere" — without this a
                // staggered entrance sits in its final place and only then jumps out to
                // animate in. It also keeps UI layout off the animated axis for the
                // whole wait, since the override flag is set by the write.
                applyValue(registry, tween, tween.from_value);
                continue;
            }
            tweenDelta = -tween.delay;
            tween.delay = 0.0f;
        }

        tween.elapsed = static_cast<f32>(std::min(
            static_cast<double>(tween.elapsed) + tweenDelta,
            static_cast<double>(std::numeric_limits<f32>::max())));
        if (tween.loop_mode != LoopMode::None && tween.duration > 0.0f && tween.elapsed > tween.duration) {
            const double elapsed = tween.elapsed;
            const double duration = tween.duration;
            const double remainder = std::fmod(elapsed, duration);
            double skipped = std::floor(elapsed / duration) - (remainder == 0.0 ? 1.0 : 0.0);
            bool reverse = (std::fmod(elapsed, duration * 2.0) >= duration) != (remainder == 0.0);
            if (tween.loops_remaining > 0 && skipped >= tween.loops_remaining) {
                skipped = tween.loops_remaining - 1;
                reverse = static_cast<i32>(skipped) % 2 != 0;
                tween.elapsed = tween.duration;
            } else {
                // Keep exact boundaries at the endpoint of the preceding cycle.
                tween.elapsed = static_cast<f32>(remainder == 0.0 ? duration : remainder);
            }
            if (tween.loops_remaining > 0) tween.loops_remaining -= static_cast<i32>(skipped);
            if (tween.loop_mode == LoopMode::PingPong && reverse) {
                std::swap(tween.from_value, tween.to_value);
            }
        }
        f32 rawT = (tween.duration > 0.0f)
            ? glm::clamp(tween.elapsed / tween.duration, 0.0f, 1.0f)
            : 1.0f;
        f32 easedT = evaluateEasing(tween, rawT);
        f32 value = glm::mix(tween.from_value, tween.to_value, easedT);

        applyValue(registry, tween, value);

        if (rawT >= 1.0f) {
            if (tween.loop_mode == LoopMode::None) {
                tween.state = TweenState::Completed;
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
        if (tween.state == TweenState::Completed && tween.sequence_next != INVALID_ENTITY) {
            if (auto* next = registry.tryGet<TweenData>(tween.sequence_next);
                next && next->state == TweenState::Paused) {
                next->state = TweenState::Running;
                registry.markChanged<TweenData>(tween.sequence_next);
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
    // Take the start value NOW, not on the next update: a tween created after this
    // frame's tween pass would otherwise leave one frame showing the target where it
    // was — and for an entrance, where it was IS where the tween is taking it, so the
    // motion appears to play, stop, and play again.
    applyValue(registry, tween, from);
    return tweenEntity;
}

void TweenSystem::cancelTween(ecs::Registry& registry, Entity tweenEntity) {
    if (auto* tween = registry.tryGet<TweenData>(tweenEntity)) {
        tween->state = TweenState::Cancelled;
        registry.markChanged<TweenData>(tweenEntity);
    }
}

void TweenSystem::cancelAllTweens(ecs::Registry& registry, Entity targetEntity) {
    for (auto entity : registry.view<TweenData>()) {
        auto& tween = registry.get<TweenData>(entity);
        if (tween.target_entity == targetEntity && tween.state == TweenState::Running) {
            tween.state = TweenState::Cancelled;
            registry.markChanged<TweenData>(entity);
        }
    }
}

void TweenSystem::pauseTween(ecs::Registry& registry, Entity tweenEntity) {
    if (auto* tween = registry.tryGet<TweenData>(tweenEntity)) {
        if (tween->state == TweenState::Running) {
            tween->state = TweenState::Paused;
            registry.markChanged<TweenData>(tweenEntity);
        }
    }
}

void TweenSystem::resumeTween(ecs::Registry& registry, Entity tweenEntity) {
    if (auto* tween = registry.tryGet<TweenData>(tweenEntity)) {
        if (tween->state == TweenState::Paused) {
            tween->state = TweenState::Running;
            registry.markChanged<TweenData>(tweenEntity);
        }
    }
}

// Tween owns the writes for its fixed 13 targets (was routed through the generic
// animTargets `applyAnimatedValue`; decoupled so the generic enum+switch could be
// deleted with the C++ timeline). Mirrors the
// per-field semantics exactly: rotation.z → half-angle quaternion, and the UINode
// `anim_override_` flags so UI layout doesn't clobber animated Transform fields.
// Flag the entity's UINode so the layout pass leaves the tween-driven Transform
// field alone this frame; `flagged` remembers the entity for next frame's clear.
static void markUIAnimOverride(ecs::Registry& registry, Entity entity, u8 flag,
                               std::vector<Entity>& flagged) {
    if (auto* n = registry.tryGet<ecs::UINode>(entity)) {
        if (n->anim_override_ == 0) flagged.push_back(entity);
        n->anim_override_ |= flag;
        registry.markChanged<ecs::UINode>(entity);
    }
}

static void applyTweenValue(ecs::Registry& registry, Entity entity, TweenTarget target, f32 value,
                            std::vector<Entity>& flagged) {
    // Position, scale and rotation targets write local Transform fields.
    // Notifying for colour targets too costs one recompose that changes
    // nothing, where missing one leaves the world reading a stale transform.
    ecs::invalidateTransformComposition();
    switch (target) {
        case TweenTarget::PositionX:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->position.x = value;
                markUIAnimOverride(registry, entity, ecs::UINode::ANIM_POS_X, flagged);
            }
            break;
        case TweenTarget::PositionY:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->position.y = value;
                markUIAnimOverride(registry, entity, ecs::UINode::ANIM_POS_Y, flagged);
            }
            break;
        case TweenTarget::PositionZ:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) c->position.z = value;
            break;
        case TweenTarget::ScaleX:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->scale.x = value;
                markUIAnimOverride(registry, entity, ecs::UINode::ANIM_SCALE_X, flagged);
            }
            break;
        case TweenTarget::ScaleY:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                c->scale.y = value;
                markUIAnimOverride(registry, entity, ecs::UINode::ANIM_SCALE_Y, flagged);
            }
            break;
        case TweenTarget::RotationZ:
            if (auto* c = registry.tryGet<ecs::Transform>(entity)) {
                f32 h = value * 0.5f;
                c->rotation = glm::quat(std::cos(h), 0.0f, 0.0f, std::sin(h));
                markUIAnimOverride(registry, entity, ecs::UINode::ANIM_ROT_Z, flagged);
            }
            break;
        case TweenTarget::ColorR:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->color.r = value;
            break;
        case TweenTarget::ColorG:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->color.g = value;
            break;
        case TweenTarget::ColorB:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->color.b = value;
            break;
        case TweenTarget::ColorA:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->color.a = value;
            break;
        case TweenTarget::SizeX:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->size.x = value;
            break;
        case TweenTarget::SizeY:
            if (auto* c = registry.tryGet<ecs::Sprite>(entity)) c->size.y = value;
            break;
        case TweenTarget::CameraOrthoSize:
            if (auto* c = registry.tryGet<ecs::Camera>(entity)) c->orthoSize = value;
            break;
        default:
            break;
    }
    // Said once, for the component the target names: a write a reader of changes (the renderer) has to see.
    switch (target) {
        case TweenTarget::PositionX: case TweenTarget::PositionY: case TweenTarget::PositionZ:
        case TweenTarget::ScaleX: case TweenTarget::ScaleY: case TweenTarget::RotationZ:
            registry.markChanged<ecs::Transform>(entity);
            break;
        case TweenTarget::ColorR: case TweenTarget::ColorG: case TweenTarget::ColorB: case TweenTarget::ColorA:
        case TweenTarget::SizeX: case TweenTarget::SizeY:
            registry.markChanged<ecs::Sprite>(entity);
            break;
        case TweenTarget::CameraOrthoSize:
            registry.markChanged<ecs::Camera>(entity);
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
    applyTweenValue(registry, target, tween.target_property, value, ui_flagged_);
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

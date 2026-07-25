// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimationBindings.cpp
 * @brief   The tween entry points the SDK's Tween API drives.
 * @details Moved out of WebSDKEntry.cpp — the emscripten entry TU — which is the
 *          only reason they were web-only: the bodies just reach the engine through
 *          activeCtx() and the registry, both portable. A device now compiles this
 *          TU and registers the same functions from generated QuickJS wrappers, so
 *          tweens run there on the same implementation.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "AnimationBindings.hpp"

#include "ActiveContext.hpp"
#include "../animation/TweenSystem.hpp"

namespace esengine {

// The active context, spelled as every other binding TU spells it.
static EstellaContext& ctx() { return activeCtx(); }

u32 anim_createTween(ecs::Registry& registry, u32 entity, u32 targetProp,
                     f32 from, f32 to, f32 duration,
                     u32 easing, f32 delay,
                     u32 loopMode, i32 loopCount) {
    auto* sys = ctx().tryGet<animation::TweenSystem>();
    if (!sys) {
        return INVALID_ENTITY.id();
    }
    auto tweenEntity = sys->createTween(
        registry, Entity::fromRaw(entity),
        static_cast<animation::TweenTarget>(targetProp),
        from, to, duration,
        static_cast<animation::EasingType>(easing));

    auto& tween = registry.get<animation::TweenData>(tweenEntity);
    tween.delay = delay;
    tween.loop_mode = static_cast<animation::LoopMode>(loopMode);
    tween.loop_count = loopCount;
    tween.loops_remaining = loopCount;
    return tweenEntity.id();
}

void anim_cancelTween(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->cancelTween(registry, Entity::fromRaw(tweenEntity));
    }
}

void anim_cancelAllTweens(ecs::Registry& registry, u32 targetEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->cancelAllTweens(registry, Entity::fromRaw(targetEntity));
    }
}

void anim_pauseTween(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->pauseTween(registry, Entity::fromRaw(tweenEntity));
    }
}

void anim_resumeTween(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->resumeTween(registry, Entity::fromRaw(tweenEntity));
    }
}

void anim_setTweenBezier(ecs::Registry& registry, u32 tweenEntity,
                          f32 p1x, f32 p1y, f32 p2x, f32 p2y) {
    if (auto* tween = registry.tryGet<animation::TweenData>(Entity::fromRaw(tweenEntity))) {
        tween->easing = animation::EasingType::CubicBezier;
        tween->bezier_p1x = p1x;
        tween->bezier_p1y = p1y;
        tween->bezier_p2x = p2x;
        tween->bezier_p2y = p2y;
    }
}

void anim_setSequenceNext(ecs::Registry& registry, u32 tweenEntity, u32 nextEntity) {
    if (auto* tween = registry.tryGet<animation::TweenData>(Entity::fromRaw(tweenEntity))) {
        tween->sequence_next = Entity::fromRaw(nextEntity);
    }
}

void anim_updateTweens(ecs::Registry& registry, f32 deltaTime) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->update(registry, deltaTime);
    }
}

i32 anim_getTweenState(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* tween = registry.tryGet<animation::TweenData>(Entity::fromRaw(tweenEntity))) {
        return static_cast<i32>(tween->state);
    }
    return static_cast<i32>(animation::TweenState::Completed);
}

}  // namespace esengine

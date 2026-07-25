// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimationBindings.hpp
 * @brief   The tween entry points, declared once for both registration layers.
 * @details The SDK's `Tween` API creates and drives tweens as ECS entities through
 *          these. They were defined inside the emscripten entry TU, which made them
 *          web-only by construction even though the bodies are portable; declaring
 *          them here is what lets embind register them for the web and EHT generate
 *          the QuickJS wrappers for a device, from one source.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../core/Types.hpp"
#include "../ecs/Registry.hpp"

namespace esengine {

/** Create a tween entity animating @p targetProp of @p entity. Returns the tween
 *  entity's raw id (the invalid id when no tween system is installed). */
u32 anim_createTween(ecs::Registry& registry, u32 entity, u32 targetProp,
                     f32 from, f32 to, f32 duration,
                     u32 easing, f32 delay,
                     u32 loopMode, i32 loopCount);
void anim_cancelTween(ecs::Registry& registry, u32 tweenEntity);
void anim_cancelAllTweens(ecs::Registry& registry, u32 targetEntity);
void anim_pauseTween(ecs::Registry& registry, u32 tweenEntity);
void anim_resumeTween(ecs::Registry& registry, u32 tweenEntity);
void anim_setTweenBezier(ecs::Registry& registry, u32 tweenEntity,
                         f32 p1x, f32 p1y, f32 p2x, f32 p2y);
/** Chain @p nextEntity to run when @p tweenEntity completes. */
void anim_setSequenceNext(ecs::Registry& registry, u32 tweenEntity, u32 nextEntity);
void anim_updateTweens(ecs::Registry& registry, f32 deltaTime);
/** The tween's `animation::TweenState`, or Completed when it no longer exists. */
i32 anim_getTweenState(ecs::Registry& registry, u32 tweenEntity);

}  // namespace esengine

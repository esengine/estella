// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    UIBindings.hpp
 * @brief   The UI entry points the SDK drives: the Yoga layout pass, hit testing,
 *          draw order, and the computed-box queries.
 * @details These were defined inline in WebSDKEntry.cpp, which made them
 *          web-only by accident of where they sat — the implementations use
 *          nothing but `activeCtx()` and the registry. Declared here (like
 *          RendererBindings), they are registered with embind by WebSDKEntry on
 *          the web and wrapped for QuickJS by the EHT-generated native bindings,
 *          from THIS file's declarations. One implementation, two registrations.
 */
#pragma once

#include "../core/Types.hpp"

namespace esengine {

namespace ecs {
    class Registry;
}

/** Solve the UI layout tree against the world-space box UI lives in — its size
 *  is the available area, its center is where screen roots are placed.
 *  `propertyDirty` is the SDK's O(1) "an authored UINode/FlexContainer field
 *  changed" signal. */
void uiLayout_update(ecs::Registry& registry, f32 boxLeft, f32 boxBottom, f32 boxRight, f32 boxTop,
                     bool propertyDirty);

void uiHitTest_update(ecs::Registry& registry, f32 mouseWorldX, f32 mouseWorldY,
                      bool mouseDown, bool mousePressed, bool mouseReleased);
u32 uiHitTest_getHitEntity();
u32 uiHitTest_getHitEntityPrev();
u32 uiHitTest_pick(ecs::Registry& registry, f32 worldX, f32 worldY);
u32 uiHitTest_pickAll(ecs::Registry& registry, f32 worldX, f32 worldY);
u32 uiHitTest_pickResult(u32 index);

/** Resolved (Yoga-pass) pixel size of a UI node, for the editor's selection
 *  outline. The node's world box is this size, pivot-centered on its Transform. */
f32 uiNode_computedWidth(ecs::Registry& registry, u32 entity);
f32 uiNode_computedHeight(ecs::Registry& registry, u32 entity);

void uiRenderOrder_update(ecs::Registry& registry);

/** An entity's UI draw order, so the SDF text path can interleave glyph quads
 *  with UI quads. -1 = not a UI node. */
i32 ui_getRenderOrder(ecs::Registry& registry, u32 entity);


/** UINode computed state that is not embind-readable off the component. */
bool getUINodeHiddenInTree(ecs::Registry& registry, u32 entity);
/** Subtree opacity resolved by the layout pass (UINode.opacity multiplied down). */
f32 getUINodeAlphaInTree(ecs::Registry& registry, u32 entity);
/** True when this node or an ancestor set pointerEvents = None. */
bool getUINodePointerBlockedInTree(ecs::Registry& registry, u32 entity);
f32 getUINodeComputedWidth(ecs::Registry& registry, u32 entity);
f32 getUINodeComputedHeight(ecs::Registry& registry, u32 entity);

/** Compose world transforms now (the UI layout pass reads them). */
void transform_update(ecs::Registry& registry);
void transform_patchPosition(ecs::Registry& registry, u32 entity, f32 x, f32 y, f32 z);

}  // namespace esengine

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    UIBindings.cpp
 * @brief   Implements the UI entry points (see UIBindings.hpp).
 * @details Moved out of WebSDKEntry.cpp, which is the emscripten ENTRY point:
 *          these implementations only ever needed the active context and the
 *          registry, so keeping them there made them web-only for no reason. As
 *          their own TU they compile for a native build too, and the generated
 *          QuickJS wrappers call the same code embind registers.
 */
#include "UIBindings.hpp"

#include "ActiveContext.hpp"
#include "../core/EstellaContext.hpp"
#include "../core/World.hpp"
#include "../ecs/Registry.hpp"
#include "../ui/UISystem.hpp"
#include "../ui/UIRenderOrderSystem.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/UIVisual.hpp"

namespace esengine {

static EstellaContext& ctx() { return activeCtx(); }


void uiLayout_update(ecs::Registry& registry, f32 camLeft, f32 camBottom, f32 camRight, f32 camTop,
                     bool propertyDirty) {
    ctx().require<ecs::UISystem>().layoutUpdate(registry, camLeft, camBottom, camRight, camTop, propertyDirty);
}

void uiHitTest_update(ecs::Registry& registry, f32 mouseWorldX, f32 mouseWorldY,
                       bool mouseDown, bool mousePressed, bool mouseReleased) {
    ctx().require<ecs::UISystem>().hitTestUpdate(registry, mouseWorldX, mouseWorldY, mouseDown, mousePressed, mouseReleased);
}

u32 uiHitTest_getHitEntity() {
    return ctx().require<ecs::UISystem>().getHitEntity();
}

u32 uiHitTest_getHitEntityPrev() {
    return ctx().require<ecs::UISystem>().getPrevHitEntity();
}

u32 uiHitTest_pick(ecs::Registry& registry, f32 worldX, f32 worldY) {
    return ctx().require<ecs::UISystem>().pick(registry, worldX, worldY);
}

u32 uiHitTest_pickAll(ecs::Registry& registry, f32 worldX, f32 worldY) {
    return ctx().require<ecs::UISystem>().pickAll(registry, worldX, worldY);
}

u32 uiHitTest_pickResult(u32 index) {
    return ctx().require<ecs::UISystem>().pickResult(index);
}

// Resolved (Yoga-pass) pixel size of a UI node, for the editor's selection outline.
// The node's world box is this size, pivot-centered on its Transform.
f32 uiNode_computedWidth(ecs::Registry& r, u32 e) {
    auto* n = r.tryGet<ecs::UINode>(Entity::fromRaw(e));
    return n ? n->computed_size_.x : 0.0f;
}
f32 uiNode_computedHeight(ecs::Registry& r, u32 e) {
    auto* n = r.tryGet<ecs::UINode>(Entity::fromRaw(e));
    return n ? n->computed_size_.y : 0.0f;
}

void uiRenderOrder_update(ecs::Registry& registry) {
    ecs::uiRenderOrderUpdate(registry);
}

// The SDF text path (TS) reads an entity's UI
// draw order so glyph quads interleave with UI quads. uiRenderOrderUpdate
// assigns uiOrder to every UIVisual in the UI tree (text nodes carry a
// visualType=None UIVisual purely to be ordered). -1 = not a UI node.
i32 ui_getRenderOrder(ecs::Registry& registry, u32 entity) {
    auto* ui = registry.tryGet<ecs::UIVisual>(Entity::fromRaw(entity));
    return ui ? ui->uiOrder : -1;
}

// UINode (CSS box) computed size — its internal computed_size_ is not
// embind-readable, so expose it for TS uiHelpers.
bool getUINodeHiddenInTree(ecs::Registry& registry, u32 entity) {
    auto* node = registry.tryGet<ecs::UINode>(Entity::fromRaw(entity));
    return node && node->hidden_in_tree_;
}

// Subtree opacity / pointer gate, resolved by the layout pass. Same reason as
// the hidden bit: computed state is not embind-readable, and the TS text
// renderer + input router need it to behave like the C++ visuals do.
f32 getUINodeAlphaInTree(ecs::Registry& registry, u32 entity) {
    auto* node = registry.tryGet<ecs::UINode>(Entity::fromRaw(entity));
    return node ? node->alpha_in_tree_ : 1.0f;
}

bool getUINodePointerBlockedInTree(ecs::Registry& registry, u32 entity) {
    auto* node = registry.tryGet<ecs::UINode>(Entity::fromRaw(entity));
    return node && node->pointer_blocked_in_tree_;
}

f32 getUINodeComputedWidth(ecs::Registry& registry, u32 entity) {
    auto* node = registry.tryGet<ecs::UINode>(Entity::fromRaw(entity));
    if (!node) return 0.0f;
    return node->computed_size_.x;
}

f32 getUINodeComputedHeight(ecs::Registry& registry, u32 entity) {
    auto* node = registry.tryGet<ecs::UINode>(Entity::fromRaw(entity));
    if (!node) return 0.0f;
    return node->computed_size_.y;
}

void transform_update(ecs::Registry& registry) {
    esengine::World world{registry, ctx().services(), 0.0f};
    if (auto* ts = ctx().tryGet<ecs::TransformSystem>()) {
        ts->update(world);
    } else {
        ecs::TransformSystem fallback;
        fallback.update(world);
    }
}

void transform_patchPosition(ecs::Registry& registry, u32 entity,
                             f32 x, f32 y, f32 z) {
    auto* transform = registry.tryGet<ecs::Transform>(Entity::fromRaw(entity));
    if (!transform) return;
    transform->position = {x, y, z};
}

}  // namespace esengine

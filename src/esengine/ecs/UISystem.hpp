// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    UISystem.hpp
 * @brief   UI subsystem owning layout tree and hit-test state
 * @details Consolidates UITree and UIHitTestResult into a single service
 *          registered on EstellaContext. Replaces the previous file-level
 *          static globals (s_ui_tree, s_hit_test_result).
 *
 * @author  ESEngine Team
 * @date    2026
 */
#pragma once

#include "../core/Types.hpp"
#include "Entity.hpp"
#include "Registry.hpp"
#include "UITree.hpp"

#include <memory>
#include <vector>

namespace esengine::ecs {

// Retained Yoga node cache — persists YGNodes across frames so a stable UI tree
// is not reallocated every solve. Defined in UILayoutSystem.cpp (holds Yoga
// types, kept out of this header).
struct LayoutCache;

/**
 * @brief Result of the most recent hit-test pass
 */
struct UIHitTestResult {
    Entity hit_entity{INVALID_ENTITY};
    Entity prev_hit_entity{INVALID_ENTITY};
};

/**
 * @brief UI subsystem: owns layout tree + hit-test state
 *
 * @details Registered as a service on EstellaContext. All UI layout and
 *          hit-test state lives on this instance; no file-level globals.
 *
 * @code
 * auto& ui = ctx.require<ecs::UISystem>();
 * ui.layoutUpdate(registry, -960, -540, 960, 540);
 * ui.hitTestUpdate(registry, mouseX, mouseY, false, true, false);
 * auto hitEntity = ui.getHitEntity();
 * @endcode
 */
class UISystem {
public:
    UISystem();
    ~UISystem();  // out-of-line: layoutCache_ holds an incomplete LayoutCache here.

    UISystem(const UISystem&) = delete;
    UISystem& operator=(const UISystem&) = delete;

    // ---- State (public by design: thin wrapper over data) ----

    UITree tree;
    UIHitTestResult hitResult;
    std::unique_ptr<LayoutCache> layoutCache_;

    // ---- Layout pass (defined in UILayoutSystem.cpp) ----

    /** @brief Rebuild layout tree and apply layout to all dirty nodes.
     *  @param tsPropertyDirty  Set by the TS driver when any UINode/FlexContainer
     *         changed since the last pass (via change-tracking). Combined with the
     *         C++-detected structure/camera/animation signals to skip the whole
     *         rebuild+solve on a fully static frame. */
    void layoutUpdate(Registry& registry,
                      f32 camLeft, f32 camBottom, f32 camRight, f32 camTop,
                      bool tsPropertyDirty);

    /** @brief Mark the tree structure as dirty (forces full rebuild next update) */
    void treeMarkStructureDirty();

    /** @brief Mark a single entity's layout as dirty */
    void treeMarkDirty(Entity entity);

    // ---- Hit test pass (defined in UISystem.cpp) ----

    /** @brief Run point-vs-UI hit-test, updating hitResult */
    void hitTestUpdate(Registry& registry,
                       f32 mouseWorldX, f32 mouseWorldY,
                       bool mouseDown, bool mousePressed, bool mouseReleased);

    /** @brief Editor pick: the most specific UI entity under the point. Unlike
     *         hitTestUpdate it ignores Interactable and mutates no state. */
    u32 pick(Registry& registry, f32 worldX, f32 worldY);

    /** @brief All UI entities under the point, most specific first. Returns the
     *         count; read entries via pickResult. */
    u32 pickAll(Registry& registry, f32 worldX, f32 worldY);

    /** @brief Entry `index` of the last pickAll (or INVALID_ENTITY). */
    u32 pickResult(u32 index) const {
        return index < pickResults_.size() ? pickResults_[index].id() : INVALID_ENTITY.id();
    }

    /** @brief Entity hit by the most recent hitTestUpdate (or INVALID_ENTITY) */
    u32 getHitEntity() const { return hitResult.hit_entity.id(); }

    /** @brief Entity hit by the previous frame's hitTestUpdate */
    u32 getPrevHitEntity() const { return hitResult.prev_hit_entity.id(); }

private:
    std::vector<Entity> pickResults_;

    // ---- Layout skip-when-clean gate (see layoutUpdate) ----
    // Snapshot of the last solved frame; a pass whose inputs match all of these
    // (and no tween activity) reuses the retained YGNodes and computed output.
    u64 lastSig_{0};
    f32 lastCamL_{0}, lastCamB_{0}, lastCamR_{0}, lastCamT_{0};
    bool lastAnimActive_{false};
    bool layoutPrimed_{false};  // force a solve on the very first pass
};

}  // namespace esengine::ecs

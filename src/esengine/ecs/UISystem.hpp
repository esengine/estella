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

#include <vector>

namespace esengine::ecs {

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
    UISystem() = default;
    ~UISystem() = default;

    UISystem(const UISystem&) = delete;
    UISystem& operator=(const UISystem&) = delete;

    // ---- State (public by design: thin wrapper over data) ----

    UITree tree;
    UIHitTestResult hitResult;

    // ---- Layout pass (defined in UILayoutSystem.cpp) ----

    /** @brief Rebuild layout tree and apply layout to all dirty nodes */
    void layoutUpdate(Registry& registry,
                      f32 camLeft, f32 camBottom, f32 camRight, f32 camTop);

    /** @brief Mark the tree structure as dirty (forces full rebuild next update) */
    void treeMarkStructureDirty();

    /** @brief Mark a single entity's layout as dirty */
    void treeMarkDirty(Entity entity);

    // ---- Hit test pass (defined in UISystem.cpp) ----

    /** @brief Run point-vs-UI hit-test, updating hitResult */
    void hitTestUpdate(Registry& registry,
                       f32 mouseWorldX, f32 mouseWorldY,
                       bool mouseDown, bool mousePressed, bool mouseReleased);

    /**
     * @brief Editor pick: the most specific UI entity whose layout box contains
     *        the point (hierarchy depth desc, draw order breaking ties).
     *
     * Unlike hitTestUpdate this ignores Interactable — plain text and panels
     * are selectable — and mutates no interaction state.
     */
    u32 pick(Registry& registry, f32 worldX, f32 worldY);

    /**
     * @brief Editor pick list: ALL UI entities under the point, most specific
     *        first. Returns the count; read entries via pickResult (the list
     *        backs click-through cycling).
     */
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
};

}  // namespace esengine::ecs

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
#include "../ecs/Entity.hpp"
#include "../ecs/Registry.hpp"
#include "./UITree.hpp"
#include "./UIHitTestSystem.hpp"

#include <memory>
#include <unordered_set>
#include <vector>

namespace esengine::resource { class ResourceManager; }

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
 * ui.hitTestUpdate(registry, PickRay{cameraPos, pointerDir}, &resources);
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
     *  The four bounds are the world-space box UI is laid out within: its size is
     *  what Yoga solves against, its center is where screen roots are placed.
     *  @param tsPropertyDirty  Set by the TS driver when any UINode/FlexContainer
     *         changed since the last pass (via change-tracking). Combined with the
     *         C++-detected structure/box/animation signals to skip the whole
     *         rebuild+solve on a fully static frame. */
    void layoutUpdate(Registry& registry,
                      f32 boxLeft, f32 boxBottom, f32 boxRight, f32 boxTop,
                      bool tsPropertyDirty);

    // ---- Hit test pass (defined in UISystem.cpp) ----

    /**
     * @brief Run ray-vs-content hit-test, updating hitResult. A query: what a
     *        press or a hover MEANS is the interaction system's, and it is in TS.
     * @details UI wins any overlap, topmost first; below it world content ranks
     *          by distance along the ray, sorting layer breaking a flat scene's
     *          tie. Without @p resources only inline mesh geometry can be hit.
     */
    void hitTestUpdate(Registry& registry, const PickRay& ray,
                       const resource::ResourceManager* resources = nullptr);

    /**
     * @brief The same, with a ray per DOMAIN.
     *
     * @details A pixel is in no domain until it is projected into one, so screen
     *          UI answers @p screenRay and world content @p worldRay — each
     *          entity through the projection it is DRAWN with. One ray for both
     *          draws the HUD where it should be and clicks somewhere else.
     */
    void hitTestUpdate(Registry& registry, const PickRay& worldRay, const PickRay& screenRay,
                       const resource::ResourceManager* resources);

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

    /**
     * @brief Every entity that belongs to the SCREEN, as opposed to the world.
     *
     * @details Resolved once at a subtree's root and inherited by all of it: a
     *          Canvas with no Transform parent IS the screen. The whole Transform
     *          subtree, not just the laid-out nodes — what decides the domain is
     *          where a transform composes FROM. Rebuilt by every layout pass.
     */
    const std::unordered_set<u32>& screenDomain() const { return screen_domain_; }

private:
    /** @brief World-space pick for entities outside the layout tree (see .cpp) */
    void hitWorldContent(Registry& registry, const PickRay& ray,
                         const resource::ResourceManager* resources);

    std::vector<Entity> pickResults_;

    // ---- Layout skip-when-clean gate (see layoutUpdate) ----
    // Snapshot of the last solved frame; a pass whose inputs match all of these
    // (and no tween activity) reuses the retained YGNodes and computed output.
    u64 lastSig_{0};
    // Size and center are tracked apart: a resized box needs a new solve, a moved
    // box needs only the screen roots replaced (see layoutUpdate).
    f32 lastBoxW_{0}, lastBoxH_{0}, lastBoxCX_{0}, lastBoxCY_{0};
    bool lastAnimActive_{false};
    bool layoutPrimed_{false};  // force a solve on the very first pass
    // Which registry the retained Yoga nodes belong to — entity ids restart with
    // each one, so they mean nothing across registries (Registry::instanceId).
    u64 lastRegistryId_{0};

    std::unordered_set<u32> screen_domain_;
};

}  // namespace esengine::ecs

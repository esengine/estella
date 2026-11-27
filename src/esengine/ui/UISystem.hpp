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
#include "./UIRenderData.hpp"
#include "./UIHitTestSystem.hpp"

#include <memory>
#include <unordered_set>
#include <unordered_map>
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
/** The natural size of a leaf node's content (a Text's lines), as the SDK measured it. */
struct UIContentSize {
    f32 width;
    f32 height;
};

struct UIHitTestResult {
    Entity hit_entity{INVALID_ENTITY};
    Entity prev_hit_entity{INVALID_ENTITY};
};

/** Retained data for one registry. The active state is exposed by UISystem for
 *  direct C++ tree access. Inactive registries keep their own state. */
class UIWorldState {
public:
    UITree tree;
    UIHitTestResult hitResult;
    std::unique_ptr<LayoutCache> layoutCache_;

private:
    friend class UISystem;
    UIWorldState();
    ~UIWorldState();
    UIWorldState& operator=(UIWorldState&&) noexcept;
    UIWorldState(const UIWorldState&) = delete;
    UIWorldState& operator=(const UIWorldState&) = delete;

    struct InheritedState {
        bool hidden = false;
        f32 alpha = 1.0f;
        bool blocked = false;
    };
    struct InheritedMemo {
        u64 stamp = 0;
        bool resolving = false;
        InheritedState state;
    };
    std::unordered_map<Entity, InheritedMemo> inherited_cache_;
    std::vector<Entity> inherited_path_;
    u64 inherited_stamp_ = 0;
    std::vector<Entity> pickResults_;

    bool hit_inputs_read_{false};
    u32 hit_activity_{0};
    u32 hit_tick_{0};
    u64 hit_meshes_{0};

    // ---- Layout skip-when-clean gate (see layoutUpdate) ----
    // Snapshot of the last solved frame; a pass whose inputs match all of these
    // (and no tween activity) reuses the retained YGNodes and computed output.
    u64 lastSig_{0};
    // Size and center are tracked apart: a resized box needs a new solve, a moved
    // box needs only the screen roots replaced (see layoutUpdate).
    f32 lastBoxW_{0}, lastBoxH_{0}, lastBoxCX_{0}, lastBoxCY_{0};
    bool lastAnimActive_{false};
    bool layoutPrimed_{false};  // force a solve on the very first pass
    std::vector<u32> screenMembers_, nextScreenMembers_;
    std::vector<Entity> screenPending_;
    Shared<UIRenderData> render_;
    // What the SDK measured for leaves that size to their content (see setContentSize); a change re-solves the next pass.
    std::unordered_map<Entity, UIContentSize> contentSizes_;
    bool contentSizesChanged_{false};
};

/**
 * @brief UI subsystem: owns layout tree + hit-test state
 *
 * @details Registered as a service on EstellaContext. All UI layout and
 *          hit-test state lives on this instance; no file-level globals.
 *
 * @code
 * auto& ui = ctx.require<ecs::UISystem>();
 * ui.layoutUpdate(registry, -960, -540, 960, 540, true);
 * ui.hitTestUpdate(registry, PickRay{cameraPos, pointerDir}, &resources);
 * auto hitEntity = ui.getHitEntity();
 * @endcode
 */
class UISystem : public UIWorldState {
public:
    UISystem();
    ~UISystem();

    UISystem(const UISystem&) = delete;
    UISystem& operator=(const UISystem&) = delete;

    // ---- Layout pass (defined in UILayoutSystem.cpp) ----

    /** @brief Rebuild layout tree and apply layout to all dirty nodes.
     *  The four bounds are the world-space box UI is laid out within: its size is
     *  what Yoga solves against, its center is where screen roots are placed.
     *  @param tsPropertyDirty  Set by the TS driver when any UINode/FlexContainer
     *         changed since the last pass (via change-tracking). Combined with the
     *         C++-detected structure/box/animation signals to skip the whole
     *         rebuild+solve on a fully static frame. */
    bool layoutUpdate(Registry& registry,
                      f32 boxLeft, f32 boxBottom, f32 boxRight, f32 boxTop,
                      bool tsPropertyDirty);

    /** @brief The natural size of @p entity's content: a Text's lines, measured by the SDK, which lays the glyphs out.
     *  A UINode leaf whose width or height is auto takes it on that axis, as a CSS box takes its text's size, so a
     *  label in a flex row or column holds its place instead of collapsing to nothing. A negative width forgets it. */
    void setContentSize(Registry& registry, u32 entity, f32 width, f32 height);

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

    bool hitInputsChanged(Registry& registry, const resource::ResourceManager* resources);

    /** @brief Editor pick: the most specific UI entity under the point. Unlike
     *         hitTestUpdate it ignores Interactable and mutates no state. */
    u32 pick(Registry& registry, f32 worldX, f32 worldY);

    /** @brief All UI entities under the point, most specific first. Returns the
     *         count; read entries via pickResult. */
    u32 pickAll(Registry& registry, f32 worldX, f32 worldY);

    /** @brief Entry `index` of the last pickAll (or INVALID_ENTITY). */
    u32 pickResult(u32 index) const;
    u32 pickResult(const Registry& registry, u32 index) const;

    /** The most recent hit of the selected registry, or of the last hit test. */
    u32 getHitEntity(const Registry& registry) const;
    u32 getHitEntity() const;
    u32 getPrevHitEntity() const;

    /** Published tables remain alive for the render pass that selected them. */
    Shared<const UIRenderData> renderData(const Registry& registry) const;
    void updateRenderOrder(Registry& registry, i32 base);

    /**
     * @brief Every entity that belongs to the SCREEN, as opposed to the world.
     *
     * @details Resolved once at a subtree's root and inherited by all of it: a
     *          Canvas with no Transform parent IS the screen. The whole Transform
     *          subtree, not just the laid-out nodes — what decides the domain is
     *          where a transform composes FROM. Refreshed by every layout pass.
     */
    const std::unordered_set<u32>& screenDomain() const { return lastLayout().domain; }

    /** @brief The screen's root Canvases, in the order the UI tree draws them (each Canvas in its pool's order, as canvasRoots
     *         walks them). Rebuilt with the domain. */
    const std::vector<u32>& screenRoots() const { return lastLayout().roots; }
    /** @brief screenRootOf for every entity at once, by entity index, for a reader that asks of many. */
    const std::vector<u32>& screenRootByIndex() const { return lastLayout().rootByIndex; }

    /** @brief Which screen root @p entity (an id in screenDomain()) draws under; for one outside the domain, nothing it says. */
    u32 screenRootOf(u32 entity) const {
        const u32 index = Entity::fromRaw(entity).index();
        const auto& roots = screenRootByIndex();
        return index < roots.size() ? roots[index] : 0;
    }

    bool hasLayoutFor(const Registry& registry) const;
    bool isScreenDomain(const Registry& registry, u32 entity) const;

private:
    struct Slot;
    struct Worlds;
    Unique<Worlds> worlds_;
    Shared<Slot> select(Registry& registry);
    UIRenderData& selectLayout(Registry& registry);
    void selectHit(Registry& registry);
    void selectPick(Registry& registry);
    const UIRenderData& lastLayout() const;
    void propagateDetachedUIState(Registry& registry);
    /** @brief World-space pick for entities outside the layout tree (see .cpp) */
    void hitWorldContent(Registry& registry, const PickRay& ray,
                         const resource::ResourceManager* resources);
};

}  // namespace esengine::ecs

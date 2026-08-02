// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./UILayoutSystem.hpp"
#include "./UISystem.hpp"

#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/FlexContainer.hpp"
#include "../ecs/components/UINode.hpp"   // UINode + AlignSelf

#include <yoga/Yoga.h>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <algorithm>

namespace esengine::ecs {

// Reused across frames so the per-frame inherited walk allocates nothing.
static std::vector<f32> inherited_alpha_stack_;
static std::vector<u8> inherited_block_stack_;

// Retained Yoga node cache: one YGNode per UI entity, kept alive across frames.
// A stable UI tree reuses its allocations instead of YGNodeNew/FreeRecursive
// every solve; entities that leave the tree are reaped. The hierarchy + style
// are still rebuilt each frame here (Stage 1) — dirty-gating that avoids the
// rebuild/solve when nothing changed is layered on top separately.
struct LayoutCache {
    std::unordered_map<Entity, YGNodeRef> nodes;

    ~LayoutCache() {
        for (auto& [entity, node] : nodes) YGNodeFree(node);
    }

    YGNodeRef getOrCreate(Entity entity) {
        auto it = nodes.find(entity);
        if (it != nodes.end()) return it->second;
        YGNodeRef node = YGNodeNew();
        nodes.emplace(entity, node);
        return node;
    }

    // Free the YGNodes of entities no longer in the tree. YGNodeFree disconnects
    // each from its owner/children, so order is irrelevant (live nodes hold only
    // live children after the pass, so none point at a reaped node).
    void reap(const std::unordered_set<Entity>& live) {
        for (auto it = nodes.begin(); it != nodes.end();) {
            if (live.find(it->first) == live.end()) {
                YGNodeFree(it->second);
                it = nodes.erase(it);
            } else {
                ++it;
            }
        }
    }
};

namespace {

// =============================================================================
// Flex enum → Yoga mappers (shared by the UINode container + item styling)
// =============================================================================

YGFlexDirection toYGFlexDirection(FlexDirection dir) {
    switch (dir) {
        case FlexDirection::Row:            return YGFlexDirectionRow;
        case FlexDirection::Column:         return YGFlexDirectionColumn;
        case FlexDirection::RowReverse:     return YGFlexDirectionRowReverse;
        case FlexDirection::ColumnReverse:  return YGFlexDirectionColumnReverse;
    }
    return YGFlexDirectionRow;
}

YGWrap toYGWrap(FlexWrap wrap) {
    switch (wrap) {
        case FlexWrap::NoWrap: return YGWrapNoWrap;
        case FlexWrap::Wrap:   return YGWrapWrap;
    }
    return YGWrapNoWrap;
}

YGJustify toYGJustify(JustifyContent jc) {
    switch (jc) {
        case JustifyContent::Start:        return YGJustifyFlexStart;
        case JustifyContent::Center:       return YGJustifyCenter;
        case JustifyContent::End:          return YGJustifyFlexEnd;
        case JustifyContent::SpaceBetween: return YGJustifySpaceBetween;
        case JustifyContent::SpaceAround:  return YGJustifySpaceAround;
        case JustifyContent::SpaceEvenly:  return YGJustifySpaceEvenly;
    }
    return YGJustifyFlexStart;
}

YGAlign toYGAlign(AlignItems ai) {
    switch (ai) {
        case AlignItems::Start:   return YGAlignFlexStart;
        case AlignItems::Center:  return YGAlignCenter;
        case AlignItems::End:     return YGAlignFlexEnd;
        case AlignItems::Stretch: return YGAlignStretch;
    }
    return YGAlignStretch;
}

YGAlign toYGAlignContent(AlignContent ac) {
    switch (ac) {
        case AlignContent::Start:        return YGAlignFlexStart;
        case AlignContent::Center:       return YGAlignCenter;
        case AlignContent::End:          return YGAlignFlexEnd;
        case AlignContent::Stretch:      return YGAlignStretch;
        case AlignContent::SpaceBetween: return YGAlignSpaceBetween;
        case AlignContent::SpaceAround:  return YGAlignSpaceAround;
    }
    return YGAlignFlexStart;
}

YGAlign toYGAlignSelf(AlignSelf as) {
    switch (as) {
        case AlignSelf::Auto:    return YGAlignAuto;
        case AlignSelf::Start:   return YGAlignFlexStart;
        case AlignSelf::Center:  return YGAlignCenter;
        case AlignSelf::End:     return YGAlignFlexEnd;
        case AlignSelf::Stretch: return YGAlignStretch;
    }
    return YGAlignAuto;
}

// =============================================================================
// UINode (CSS box) → single-pass Yoga (the single layout model)
// =============================================================================
//
// A UINode subtree is laid out by ONE Yoga solve: each entity becomes a YGNode,
// the hierarchy is mirrored, the root is sized to its available box, and one
// YGNodeCalculateLayout resolves the whole subtree. Output is written as the
// engine's center-based, y-up local Transform (implicit pivot 0.5, matching
// UIElementPlugin) plus UINode.computed_size_ (read by the renderer/hit-test).

// Dimension.unit codes — mirror the TS DimensionUnit enum.
constexpr u8 DIM_PX = 0, DIM_PERCENT = 1, DIM_AUTO = 2;

void applyWidth(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetWidthPercent(n, d.value);
    else if (d.unit == DIM_AUTO) YGNodeStyleSetWidthAuto(n);
    else YGNodeStyleSetWidth(n, d.value);
}
void applyHeight(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetHeightPercent(n, d.value);
    else if (d.unit == DIM_AUTO) YGNodeStyleSetHeightAuto(n);
    else YGNodeStyleSetHeight(n, d.value);
}
// min/max have no Yoga "auto"; Auto means "no constraint" → leave unset.
void applyMinWidth(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetMinWidthPercent(n, d.value);
    else if (d.unit == DIM_PX) YGNodeStyleSetMinWidth(n, d.value);
}
void applyMinHeight(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetMinHeightPercent(n, d.value);
    else if (d.unit == DIM_PX) YGNodeStyleSetMinHeight(n, d.value);
}
void applyMaxWidth(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetMaxWidthPercent(n, d.value);
    else if (d.unit == DIM_PX) YGNodeStyleSetMaxWidth(n, d.value);
}
void applyMaxHeight(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetMaxHeightPercent(n, d.value);
    else if (d.unit == DIM_PX) YGNodeStyleSetMaxHeight(n, d.value);
}
void applyFlexBasis(YGNodeRef n, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetFlexBasisPercent(n, d.value);
    else if (d.unit == DIM_AUTO) YGNodeStyleSetFlexBasisAuto(n);
    else YGNodeStyleSetFlexBasis(n, d.value);
}
void applyMargin(YGNodeRef n, YGEdge edge, const Dimension& d) {
    if (d.unit == DIM_PERCENT) YGNodeStyleSetMarginPercent(n, edge, d.value);
    else if (d.unit == DIM_AUTO) YGNodeStyleSetMarginAuto(n, edge);
    else YGNodeStyleSetMargin(n, edge, d.value);
}
void applyInset(YGNodeRef n, YGEdge edge, const Dimension& d) {
    // Auto = that edge is unconstrained; leave it unset so size/flow decides.
    if (d.unit == DIM_PERCENT) YGNodeStyleSetPositionPercent(n, edge, d.value);
    else if (d.unit == DIM_PX) YGNodeStyleSetPosition(n, edge, d.value);
}

void applyUINodeStyle(Registry& registry, Entity entity, YGNodeRef yg) {
    auto& n = registry.get<UINode>(entity);
    YGNodeStyleSetDisplay(yg, n.display == UIDisplay::None
        ? YGDisplayNone : YGDisplayFlex);
    YGNodeStyleSetPositionType(yg, n.position == UIPositionType::Absolute
        ? YGPositionTypeAbsolute : YGPositionTypeRelative);
    applyInset(yg, YGEdgeLeft, n.insetLeft);
    applyInset(yg, YGEdgeTop, n.insetTop);
    applyInset(yg, YGEdgeRight, n.insetRight);
    applyInset(yg, YGEdgeBottom, n.insetBottom);
    applyWidth(yg, n.width);
    applyHeight(yg, n.height);
    applyMinWidth(yg, n.minWidth);
    applyMinHeight(yg, n.minHeight);
    applyMaxWidth(yg, n.maxWidth);
    applyMaxHeight(yg, n.maxHeight);
    YGNodeStyleSetFlexGrow(yg, n.flexGrow);
    YGNodeStyleSetFlexShrink(yg, n.flexShrink);
    applyFlexBasis(yg, n.flexBasis);
    YGNodeStyleSetAlignSelf(yg, toYGAlignSelf(n.alignSelf));
    applyMargin(yg, YGEdgeLeft, n.marginLeft);
    applyMargin(yg, YGEdgeTop, n.marginTop);
    applyMargin(yg, YGEdgeRight, n.marginRight);
    applyMargin(yg, YGEdgeBottom, n.marginBottom);

    // Container properties still come from FlexContainer (folded into UILayout in F4).
    //
    // The absent case is written out rather than skipped: this runs against a
    // node that KEEPS its style between frames, so "no FlexContainer" has to
    // actively say Yoga's defaults. Leaving them alone would let a removed
    // FlexContainer's padding and justify go on laying the node out forever —
    // the one thing a total style application must not do.
    if (auto* fc = registry.tryGet<FlexContainer>(entity)) {
        YGNodeStyleSetFlexDirection(yg, toYGFlexDirection(fc->direction));
        YGNodeStyleSetFlexWrap(yg, toYGWrap(fc->wrap));
        YGNodeStyleSetJustifyContent(yg, toYGJustify(fc->justifyContent));
        YGNodeStyleSetAlignItems(yg, toYGAlign(fc->alignItems));
        YGNodeStyleSetAlignContent(yg, toYGAlignContent(fc->alignContent));
        YGNodeStyleSetGap(yg, YGGutterColumn, fc->gap.x);
        YGNodeStyleSetGap(yg, YGGutterRow, fc->gap.y);
        YGNodeStyleSetPadding(yg, YGEdgeLeft, fc->padding.left);
        YGNodeStyleSetPadding(yg, YGEdgeTop, fc->padding.top);
        YGNodeStyleSetPadding(yg, YGEdgeRight, fc->padding.right);
        YGNodeStyleSetPadding(yg, YGEdgeBottom, fc->padding.bottom);
    } else {
        YGNodeStyleSetFlexDirection(yg, YGFlexDirectionColumn);
        YGNodeStyleSetFlexWrap(yg, YGWrapNoWrap);
        YGNodeStyleSetJustifyContent(yg, YGJustifyFlexStart);
        YGNodeStyleSetAlignItems(yg, YGAlignStretch);
        YGNodeStyleSetAlignContent(yg, YGAlignFlexStart);
        YGNodeStyleSetGap(yg, YGGutterColumn, 0.0f);
        YGNodeStyleSetGap(yg, YGGutterRow, 0.0f);
        YGNodeStyleSetPadding(yg, YGEdgeLeft, 0.0f);
        YGNodeStyleSetPadding(yg, YGEdgeTop, 0.0f);
        YGNodeStyleSetPadding(yg, YGEdgeRight, 0.0f);
        YGNodeStyleSetPadding(yg, YGEdgeBottom, 0.0f);
    }
}

// Lay out the UINode subtree rooted at tree index `rootIdx` in one Yoga solve.
// `availW/H` + `parentPivot*` describe the available box the root sits in.
void layoutUINodeSubtree(
    Registry& registry, UITree& tree, LayoutCache& cache, i32 rootIdx,
    f32 availW, f32 availH, f32 parentPivotX, f32 parentPivotY,
    bool structureChanged, bool forceWriteback
) {
    i32 begin = rootIdx;
    i32 end = rootIdx + tree.nodes_[rootIdx].subtree_size;

    std::vector<YGNodeRef> yg(static_cast<usize>(end - begin), nullptr);
    std::unordered_map<Entity, i32> slotOf;  // entity → local slot index
    // The retained YGNode KEEPS its style between frames, and re-applying it is
    // how Yoga is told what moved: every YGNodeStyleSet* is `if (old != new)
    // { set; markDirtyAndPropagate(); }`, so a field that did not change costs
    // one comparison and dirties nothing. Resetting first (as this used to) made
    // every field look changed, which dirtied every node and threw away the
    // incremental solve the retained nodes exist for.
    for (i32 k = begin; k < end; ++k) {
        Entity e = tree.nodes_[k].entity;
        if (!registry.has<UINode>(e)) continue;  // tree is homogeneously UINode
        YGNodeRef node = cache.getOrCreate(e);
        applyUINodeStyle(registry, e, node);
        yg[static_cast<usize>(k - begin)] = node;
        slotOf[e] = k - begin;
    }
    YGNodeRef rootYG = yg[0];
    if (!rootYG) return;

    // Parenting is rebuilt only when the tree's shape actually changed. Yoga's
    // own child list is the retained hierarchy the rest of the time — and
    // re-inserting an unchanged child would dirty it for nothing.
    if (structureChanged) {
        for (i32 k = begin; k < end; ++k) {
            YGNodeRef node = yg[static_cast<usize>(k - begin)];
            if (node) YGNodeRemoveAllChildren(node);
        }
        for (i32 k = begin + 1; k < end; ++k) {
            YGNodeRef child = yg[static_cast<usize>(k - begin)];
            if (!child) continue;
            auto it = slotOf.find(tree.nodes_[k].parent);
            if (it == slotOf.end()) continue;
            YGNodeRef parentYG = yg[static_cast<usize>(it->second)];
            YGNodeInsertChild(parentYG, child, YGNodeGetChildCount(parentYG));
        }
    }

    // The root fills the available box on axes it leaves auto.
    auto& rootNode = registry.get<UINode>(tree.nodes_[begin].entity);
    if (rootNode.width.unit == DIM_AUTO) YGNodeStyleSetWidth(rootYG, availW);
    if (rootNode.height.unit == DIM_AUTO) YGNodeStyleSetHeight(rootYG, availH);

    YGNodeCalculateLayout(rootYG, availW, availH, YGDirectionLTR);

    // Which nodes' own box changed, by local slot. A node whose PARENT resized
    // has to be written even when Yoga left its own box alone: the local
    // position below is expressed against the parent's computed size, so the
    // same Yoga offset inside a resized parent is a different world position.
    // DFS order guarantees a parent's entry is filled before its children read it.
    std::vector<u8> resized(static_cast<usize>(end - begin), 0);

    for (i32 k = begin; k < end; ++k) {
        YGNodeRef node = yg[static_cast<usize>(k - begin)];
        if (!node) continue;
        Entity e = tree.nodes_[k].entity;

        bool parentResized = false;
        if (k != begin) {
            auto it = slotOf.find(tree.nodes_[k].parent);
            if (it != slotOf.end()) parentResized = resized[static_cast<usize>(it->second)] != 0;
        }
        // Yoga tells us what it recomputed; everything else still holds the
        // output of the last solve, which is still correct.
        if (!forceWriteback && !YGNodeGetHasNewLayout(node) && !parentResized) {
            tree.nodes_[k].flags &= ~(LAYOUT_DIRTY | HAS_DIRTY_CHILD);
            continue;
        }
        YGNodeSetHasNewLayout(node, false);

        auto& un = registry.get<UINode>(e);
        f32 fw = YGNodeLayoutGetWidth(node);
        f32 fh = YGNodeLayoutGetHeight(node);
        resized[static_cast<usize>(k - begin)] =
            (un.computed_size_.x != fw || un.computed_size_.y != fh) ? 1 : 0;
        un.computed_size_.x = fw;
        un.computed_size_.y = fh;

        // Position frame = the parent box (root's available box, else the parent
        // UINode whose computed_size_ is already set — DFS order guarantees it).
        f32 pw, ph, ppx, ppy;
        if (k == begin) {
            pw = availW; ph = availH; ppx = parentPivotX; ppy = parentPivotY;
        } else {
            auto& pn = registry.get<UINode>(tree.nodes_[k].parent);
            pw = pn.computed_size_.x; ph = pn.computed_size_.y; ppx = 0.5f; ppy = 0.5f;
        }
        f32 yl = YGNodeLayoutGetLeft(node);
        f32 yt = YGNodeLayoutGetTop(node);

        // An absolute child centres an axis when both its insets AND both its
        // margins on that axis are `auto`. A pivot-less CSS box can't otherwise
        // centre an out-of-flow node: Yoga's abspos centring keys off the
        // parent's justifyContent, so it can't differ per sibling under one
        // Canvas. Overriding the Yoga offset makes centring a self-contained
        // per-node anchor, independent of the parent and of which axis is main.
        if (k != begin && un.position == UIPositionType::Absolute) {
            auto axisCentred = [](const Dimension& a, const Dimension& b,
                                  const Dimension& m0, const Dimension& m1) {
                return a.unit == DIM_AUTO && b.unit == DIM_AUTO &&
                       m0.unit == DIM_AUTO && m1.unit == DIM_AUTO;
            };
            if (axisCentred(un.insetLeft, un.insetRight, un.marginLeft, un.marginRight))
                yl = 0.5f * (pw - fw);
            if (axisCentred(un.insetTop, un.insetBottom, un.marginTop, un.marginBottom))
                yt = 0.5f * (ph - fh);
        }

        // Center-based, y-up local position (implicit pivot 0.5).
        f32 localX = -ppx * pw + yl + 0.5f * fw;
        f32 localY = (1.0f - ppy) * ph - yt - 0.5f * fh;

        if (auto* t = registry.tryGet<Transform>(e)) {
            // Leave tween-driven position axes alone (see TweenSystem anim_override_).
            if (!(un.anim_override_ & UINode::ANIM_POS_X)) t->position.x = localX;
            if (!(un.anim_override_ & UINode::ANIM_POS_Y)) t->position.y = localY;
        }
        tree.nodes_[k].flags &= ~(LAYOUT_DIRTY | HAS_DIRTY_CHILD);
    }

    // Retained nodes are not freed here — layoutUpdate reaps entities that left
    // the tree and the LayoutCache frees the rest on teardown.
}

// Resolve display:none hierarchically over the DFS-ordered tree: a node with
// display None hides its whole subtree. Rendering, text and hit-testing read
// the resulting UINode.hidden_in_tree_ bit so they never need tree knowledge.
void propagateHiddenInTree(Registry& registry, UITree& tree) {
    auto& nodes = tree.nodes_;
    for (i32 i = 0; i < static_cast<i32>(nodes.size()); ) {
        auto* n = registry.tryGet<UINode>(nodes[i].entity);
        if (n && n->display == UIDisplay::None) {
            i32 end = i + nodes[i].subtree_size;
            for (i32 k = i; k < end; ++k) {
                if (auto* c = registry.tryGet<UINode>(nodes[k].entity)) c->hidden_in_tree_ = true;
            }
            i = end;
        } else {
            if (n) n->hidden_in_tree_ = false;
            ++i;
        }
    }
}

// Resolve opacity and pointer-events hierarchically over the same DFS-ordered
// tree: opacity multiplies down (CSS `opacity`), pointer-events latches off
// (CSS `pointer-events: none` on an ancestor is not overridable by a child).
// Rendering and hit-testing read the resulting UINode bits, so neither needs
// tree knowledge — the contract propagateHiddenInTree already established.
//
// `depth` is monotonic in DFS order, so one running stack indexed by depth
// carries each node's inherited value to its children without a second walk.
void propagateInheritedUIState(Registry& registry, UITree& tree) {
    auto& nodes = tree.nodes_;
    if (nodes.empty()) return;

    inherited_alpha_stack_.assign(nodes.size() + 1, 1.0f);
    inherited_block_stack_.assign(nodes.size() + 1, static_cast<u8>(0));

    for (usize i = 0; i < nodes.size(); ++i) {
        const u16 depth = nodes[i].depth;
        const f32 parentAlpha = depth == 0 ? 1.0f : inherited_alpha_stack_[depth - 1];
        const bool parentBlocked = depth == 0 ? false : inherited_block_stack_[depth - 1] != 0;

        auto* n = registry.tryGet<UINode>(nodes[i].entity);
        if (!n) {
            inherited_alpha_stack_[depth] = parentAlpha;
            inherited_block_stack_[depth] = static_cast<u8>(parentBlocked);
            continue;
        }
        const f32 alpha = parentAlpha * std::clamp(n->opacity, 0.0f, 1.0f);
        const bool blocked = parentBlocked || n->pointerEvents == UIPointerEvents::None;
        n->alpha_in_tree_ = alpha;
        n->pointer_blocked_in_tree_ = blocked;
        inherited_alpha_stack_[depth] = alpha;
        inherited_block_stack_[depth] = static_cast<u8>(blocked);
    }
}

// A tween drives Transform fields directly in C++ (TweenSystem), invisible to the
// TS change-tracking that feeds tsPropertyDirty. Scan the UINode anim_override_
// bits so the gate keeps solving while any tween is active — and, via the caller's
// lastAnimActive_, once more on the frame a tween ends (override already cleared)
// so layout reclaims the position it had ceded.
bool anyUIAnimActive(Registry& registry) {
    bool active = false;
    registry.eachLive<UINode>([&](Entity, UINode& n) {
        if (n.anim_override_ != 0) active = true;
    });
    return active;
}

void unifiedLayoutPass(Registry& registry, UITree& tree, LayoutCache& cache,
                       const LayoutRect& cameraRect, bool structureChanged,
                       bool forceWriteback) {
    for (i32 i = 0; i < static_cast<i32>(tree.nodes_.size()); ) {
        auto& node = tree.nodes_[i];

        if (!(node.flags & (LAYOUT_DIRTY | HAS_DIRTY_CHILD))) {
            i += node.subtree_size;
            continue;
        }

        // Every node is a UINode. A subtree root (its parent is not a UINode —
        // a top-level UI element / Canvas) is resolved in one Yoga solve over its
        // whole subtree; skip past it. The available box is the camera rect.
        bool parentIsUINode = node.parent != INVALID_ENTITY && registry.has<UINode>(node.parent);
        if (!parentIsUINode) {
            f32 availW = cameraRect.right - cameraRect.left;
            f32 availH = cameraRect.top - cameraRect.bottom;
            layoutUINodeSubtree(registry, tree, cache, i, availW, availH, 0.5f, 0.5f,
                                structureChanged, forceWriteback);
        }
        i += node.subtree_size;
    }
}

}  // anonymous namespace

// =============================================================================
// UISystem layout entry (defined here to share the anon-namespace helpers)
// =============================================================================

void UISystem::layoutUpdate(
    Registry& registry,
    f32 camLeft, f32 camBottom, f32 camRight, f32 camTop,
    bool tsPropertyDirty
) {
    // The retained nodes are keyed by entity, and entity ids restart with each
    // registry — so a scene reload or an editor play/stop would otherwise hand
    // the new world the previous world's layout. This is only load-bearing now
    // that styles persist between frames: the old pass reset every node it
    // touched, which hid the aliasing by throwing the stale state away.
    if (layoutCache_ && lastRegistryId_ != registry.instanceId()) layoutCache_.reset();
    lastRegistryId_ = registry.instanceId();
    if (!layoutCache_) {
        layoutCache_ = std::make_unique<LayoutCache>();
        layoutPrimed_ = false;  // a fresh cache has no hierarchy to reuse
    }

    // Rebuild the DFS node list every pass: it is O(N) pointer-walking (no Yoga)
    // and yields the structure signature that detects spawn/despawn/reparent —
    // the reliable structural signal we don't otherwise have. The expensive part
    // (orphan + propagateHidden + Yoga solve + reap) is what the gate below skips.
    tree.rebuild(registry);

    bool animNow = anyUIAnimActive(registry);
    bool sigChanged = tree.structure_sig_ != lastSig_;
    bool rectChanged = camLeft != lastCamL_ || camBottom != lastCamB_
                    || camRight != lastCamR_ || camTop != lastCamT_;
    bool wasAnimActive = lastAnimActive_;

    lastSig_ = tree.structure_sig_;
    lastCamL_ = camLeft; lastCamB_ = camBottom; lastCamR_ = camRight; lastCamT_ = camTop;
    lastAnimActive_ = animNow;

    // A fully static frame — no structural, camera, property, or tween change since
    // the last solve — leaves the retained YGNodes and every UINode's computed
    // output valid, so the whole solve is safely skipped. `wasAnimActive` forces
    // one more solve on the frame a tween just ended (see anyUIAnimActive).
    bool first = !layoutPrimed_;
    bool dirty = first || sigChanged || rectChanged || tsPropertyDirty
              || animNow || wasAnimActive;
    layoutPrimed_ = true;
    if (!dirty) return;

    // Two signals, because they answer different questions. The hierarchy has to
    // be rebuilt when the tree's SHAPE changed. Output has to be written for
    // every node when the ROOT'S FRAME changed — a subtree root positions itself
    // against the camera box, so the same Yoga result inside a resized box is a
    // different world position, and Yoga would rightly report no new layout.
    bool structureChanged = first || sigChanged;
    bool forceWriteback = structureChanged || rectChanged;

    // The retained hierarchy is rebuilt only when the tree's shape changed —
    // which is exactly when an entity may still be owned by the parent it had
    // last frame. Orphaning unconditionally (as this used to) dirtied every
    // Yoga node on every pass, so no solve could ever be partial.
    propagateHiddenInTree(registry, tree);
    propagateInheritedUIState(registry, tree);
    LayoutRect cameraRect{ camLeft, camBottom, camRight, camTop };
    unifiedLayoutPass(registry, tree, *layoutCache_, cameraRect, structureChanged, forceWriteback);

    // Reaping is likewise a structural concern: with the same set of entities in
    // the tree there is nothing to free, and building the live set is a hash
    // insert per node.
    if (structureChanged) {
        std::unordered_set<Entity> live;
        live.reserve(tree.nodes_.size());
        for (auto& node : tree.nodes_) live.insert(node.entity);
        layoutCache_->reap(live);
    }
}

// Out-of-line so LayoutCache is complete here (it holds Yoga types kept out of
// the header). Defaulted — the unique_ptr frees the cache, whose destructor
// frees the retained YGNodes.
UISystem::UISystem() = default;
UISystem::~UISystem() = default;

void UISystem::treeMarkStructureDirty() {
    tree.structure_dirty_ = true;
}

void UISystem::treeMarkDirty(Entity entity) {
    tree.markDirty(entity);
}

}  // namespace esengine::ecs

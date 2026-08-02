// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../ecs/Registry.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/Transform.hpp"

#include <vector>

namespace esengine::ecs {

/**
 * The DFS view of the UI hierarchy, rebuilt each pass.
 *
 * It carries no dirty state of its own. It used to — a per-node LAYOUT_DIRTY
 * with a HAS_DIRTY_CHILD walk up to the root — but nothing ever produced those
 * marks except the rebuild itself, which set every node dirty every frame, so
 * the gate reading them was always open. What is actually dirty is now Yoga's
 * own answer, tracked per style field on the retained nodes it already owns
 * (UILayoutSystem.cpp); a second set of marks beside it would only be a second
 * thing to keep true.
 */
struct UITree {
    struct Node {
        Entity entity;
        Entity parent;
        u16 depth;
        u16 subtree_size;
    };

    std::vector<Node> nodes_;
    // FNV-1a hash of the (entity, parent) pairs in DFS order — a compact
    // fingerprint of the tree's shape. It changes on any spawn/despawn/reparent,
    // sibling reorder, or UINode/Canvas add-remove, which is how a pass knows to
    // rebuild the retained Yoga hierarchy rather than reuse it.
    u64 structure_sig_{0};

    void rebuild(Registry& reg) {
        nodes_.clear();
        reg.each<Canvas>([&](Entity entity, Canvas&) {
            if (!reg.has<UINode>(entity) || !reg.has<Transform>(entity)) return;
            buildDFS(reg, entity, INVALID_ENTITY, 0);
        });

        u64 h = 1469598103934665603ULL;  // FNV-1a offset basis
        for (const auto& n : nodes_) {
            h = (h ^ n.entity.id()) * 1099511628211ULL;
            h = (h ^ n.parent.id()) * 1099511628211ULL;
        }
        structure_sig_ = h;
    }

private:
    void buildDFS(Registry& reg, Entity entity, Entity layoutParent, u16 depth) {
        // A layout node is any UINode (the single CSS-box layout model).
        bool isLayoutNode = reg.has<UINode>(entity);
        i32 nodeIndex = -1;

        if (isLayoutNode) {
            nodeIndex = static_cast<i32>(nodes_.size());
            nodes_.push_back({entity, layoutParent, depth, 1});
            layoutParent = entity;
            depth++;
        }

        auto* children = reg.tryGet<Children>(entity);
        if (children) {
            for (Entity child : children->entities) {
                if (reg.valid(child)) {
                    buildDFS(reg, child, layoutParent, depth);
                }
            }
        }

        if (isLayoutNode && nodeIndex >= 0) {
            nodes_[nodeIndex].subtree_size = static_cast<u16>(nodes_.size() - nodeIndex);
        }
    }
};

}  // namespace esengine::ecs

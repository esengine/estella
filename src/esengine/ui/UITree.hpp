// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../ecs/Registry.hpp"
#include "../core/Hash.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/Transform.hpp"
#include "CanvasRoots.hpp"

#include <vector>
#include <algorithm>

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
        u32 depth;
        u32 subtree_size;
    };

    std::vector<Node> nodes_;
    // FNV-1a hash of the (entity, parent) pairs in DFS order — a compact
    // fingerprint of the tree's shape. It changes on any spawn/despawn/reparent,
    // sibling reorder, or UINode/Canvas add-remove, which is how a pass knows to
    // rebuild the retained Yoga hierarchy rather than reuse it.
    u64 structure_sig_{0};

    bool builtFor(const Registry& registry) const { return entity_set_ == registry.entitySetId(); }

    void rebuild(Registry& reg) {
        entity_set_ = reg.entitySetId();
        nodes_.clear();
        structure_sig_ = hash::kFnv64Offset;
        for (Entity entity : canvasRoots(reg, true)) {
            buildDFS(reg, entity, INVALID_ENTITY, 0);
        }
    }

private:
    u64 entity_set_{0};
    struct Frame {
        const Children* children;
        Entity layoutParent;
        u32 depth;
        i32 nodeIndex;
        usize nextChild;
    };
    std::vector<Frame> pending_;
    std::vector<u32> visit_stamps_;
    u32 visit_stamp_{0};

    void buildDFS(Registry& reg, Entity entity, Entity layoutParent, u32 depth) {
        if (++visit_stamp_ == 0) {
            std::fill(visit_stamps_.begin(), visit_stamps_.end(), 0);
            ++visit_stamp_;
        }
        pending_.clear();
        const auto enter = [&](Entity current, Entity parent, u32 currentDepth) {
            const auto index = current.index();
            if (index >= visit_stamps_.size()) visit_stamps_.resize(index + 1, 0);
            if (visit_stamps_[index] == visit_stamp_) return;
            visit_stamps_[index] = visit_stamp_;
            i32 nodeIndex = -1;
            if (reg.has<UINode>(current)) {
                nodeIndex = static_cast<i32>(nodes_.size());
                nodes_.push_back({current, parent, currentDepth, 1});
                structure_sig_ = hash::fnv1aWord(hash::fnv1aWord(structure_sig_, current.id()), parent.id());
                parent = current;
                ++currentDepth;
            }
            // The registry is read-only during the walk, so the component stays
            // valid while this frame visits each of its children.
            pending_.push_back({reg.tryGet<Children>(current), parent, currentDepth, nodeIndex, 0});
        };
        enter(entity, layoutParent, depth);
        while (!pending_.empty()) {
            auto& frame = pending_.back();
            if (frame.children && frame.nextChild < frame.children->entities.size()) {
                Entity child = frame.children->entities[frame.nextChild++];
                if (reg.valid(child)) enter(child, frame.layoutParent, frame.depth);
                continue;
            }
            if (frame.nodeIndex >= 0) {
                nodes_[frame.nodeIndex].subtree_size = static_cast<u32>(nodes_.size() - frame.nodeIndex);
            }
            pending_.pop_back();
        }
    }
};

}  // namespace esengine::ecs

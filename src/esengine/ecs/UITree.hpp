// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "Registry.hpp"
#include "components/Hierarchy.hpp"
#include "components/UINode.hpp"
#include "components/Canvas.hpp"
#include "components/Transform.hpp"

#include <vector>

namespace esengine::ecs {

constexpr u8 LAYOUT_DIRTY = 0x01;
constexpr u8 HAS_DIRTY_CHILD = 0x02;

struct UITree {
    struct Node {
        Entity entity;
        Entity parent;
        u16 depth;
        u16 subtree_size;
        u8 flags;
    };

    std::vector<Node> nodes_;
    bool structure_dirty_{true};

    void rebuild(Registry& reg) {
        nodes_.clear();
        reg.each<Canvas>([&](Entity entity, Canvas&) {
            if (!reg.has<UINode>(entity) || !reg.has<Transform>(entity)) return;
            buildDFS(reg, entity, INVALID_ENTITY, 0);
        });
        structure_dirty_ = false;
    }

    void rebuildIfDirty(Registry& reg) {
        if (structure_dirty_) {
            rebuild(reg);
        }
    }

    void markDirty(Entity entity) {
        i32 idx = indexOf(entity);
        if (idx < 0) return;

        nodes_[idx].flags |= LAYOUT_DIRTY;

        Entity parent = nodes_[idx].parent;
        while (parent != INVALID_ENTITY) {
            i32 parentIdx = indexOf(parent);
            if (parentIdx < 0) break;
            if (nodes_[parentIdx].flags & HAS_DIRTY_CHILD) break;
            nodes_[parentIdx].flags |= HAS_DIRTY_CHILD;
            parent = nodes_[parentIdx].parent;
        }
    }

    void markAllDirty() {
        for (auto& node : nodes_) {
            node.flags |= LAYOUT_DIRTY | HAS_DIRTY_CHILD;
        }
    }

    i32 indexOf(Entity entity) const {
        for (i32 i = 0; i < static_cast<i32>(nodes_.size()); i++) {
            if (nodes_[i].entity == entity) return i;
        }
        return -1;
    }

    void clearFlags() {
        for (auto& node : nodes_) {
            node.flags = 0;
        }
    }

private:
    void buildDFS(Registry& reg, Entity entity, Entity layoutParent, u16 depth) {
        // A layout node is any UINode (the single CSS-box layout model).
        bool isLayoutNode = reg.has<UINode>(entity);
        i32 nodeIndex = -1;

        if (isLayoutNode) {
            nodeIndex = static_cast<i32>(nodes_.size());
            nodes_.push_back({entity, layoutParent, depth, 1, LAYOUT_DIRTY});
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

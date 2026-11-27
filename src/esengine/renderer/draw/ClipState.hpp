// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "./RenderItem.hpp"
#include "./DrawCommand.hpp"
#include "../store/ClipConstants.hpp"

#include <unordered_map>

namespace esengine {

class ClipState {
public:
    struct Entry {
        u16 flags = 0;
        ScissorRect scissor;
        i32 stencil_ref = 0;
        u16 stencil_depth = 0;
        /// A soft edge inside the scissor (a UIMask with softness); all-zero edges are none.
        ClipConstants soft;
    };

    /// Fades @p entity's draws in from the edges of @p soft.rect, over @p soft.edge pixels, inside whatever hard clip it has.
    void setSoftClip(u32 entity, const ClipConstants& soft) { entries_[entity].soft = soft; }

    void setScissor(u32 entity, i32 x, i32 y, i32 w, i32 h) {
        auto& e = entries_[entity];
        e.flags |= CMD_STATE_SCISSOR;
        e.scissor = {x, y, w, h};
    }

    void setStencilMask(u32 entity, i32 refValue) {
        auto& e = entries_[entity];
        e.flags |= CMD_STATE_STENCIL_WRITE;
        e.flags &= ~(CMD_STATE_STENCIL_TEST | CMD_STATE_STENCIL_OUT | CMD_STATE_UI_STENCIL);
        e.stencil_ref = refValue;
        e.stencil_depth = 0;
    }

    void setUIStencilMask(u32 entity, i32 depth) {
        setStencilMask(entity, depth);
        entries_[entity].flags |= CMD_STATE_UI_STENCIL;
        entries_[entity].stencil_depth = static_cast<u16>(depth);
    }

    void setUIStencilTest(u32 entity, i32 depth) {
        setStencilTest(entity, depth);
        entries_[entity].flags |= CMD_STATE_UI_STENCIL;
        entries_[entity].stencil_depth = static_cast<u16>(depth);
    }

    bool reserveSpriteStencilReferences(i32 count) {
        bool overflow = false;
        for (auto& [entity, entry] : entries_) {
            if (!(entry.flags & CMD_STATE_UI_STENCIL)) continue;
            entry.stencil_ref += count;
            if (entry.stencil_ref > 255) {
                overflow = true;
                entry.flags = CMD_STATE_SCISSOR;
                entry.scissor = {0, 0, 0, 0};
            }
        }
        return overflow;
    }

    bool isStencilMask(Entity entity) const {
        const auto it = entries_.find(entity.id());
        return it != entries_.end() && (it->second.flags & CMD_STATE_STENCIL_WRITE) != 0;
    }

    void setStencilTest(u32 entity, i32 refValue) {
        auto& e = entries_[entity];
        e.flags |= CMD_STATE_STENCIL_TEST;
        e.flags &= ~(CMD_STATE_STENCIL_WRITE | CMD_STATE_STENCIL_OUT | CMD_STATE_UI_STENCIL);
        e.stencil_ref = refValue;
        e.stencil_depth = 0;
    }

    /// Drawn only where the mask is NOT — the hole, rather than the window.
    void setStencilTestOutside(u32 entity, i32 refValue) {
        auto& e = entries_[entity];
        e.flags |= CMD_STATE_STENCIL_TEST | CMD_STATE_STENCIL_OUT;
        e.flags &= ~(CMD_STATE_STENCIL_WRITE | CMD_STATE_UI_STENCIL);
        e.stencil_ref = refValue;
        e.stencil_depth = 0;
    }

    void applyTo(Entity entity, DrawCommand& cmd) const {
        auto it = entries_.find(entity.id());
        if (it != entries_.end()) {
            cmd.state_flags = it->second.flags;
            cmd.scissor = it->second.scissor;
            cmd.stencil_ref = it->second.stencil_ref;
            cmd.stencil_depth = it->second.stencil_depth;
        }
    }

    bool hasEntry(u32 entity) const {
        return entries_.count(entity) > 0;
    }

    const Entry* getEntry(u32 entity) const {
        auto it = entries_.find(entity);
        return it != entries_.end() ? &it->second : nullptr;
    }

    bool isEmptyScissor(Entity entity) const {
        if (entries_.empty()) return false;
        const auto* entry = getEntry(entity.id());
        return entry && (entry->flags & CMD_STATE_SCISSOR)
            && (entry->scissor.w <= 0 || entry->scissor.h <= 0);
    }

    void clear() { entries_.clear(); }
    bool empty() const { return entries_.empty(); }

private:
    std::unordered_map<u32, Entry> entries_;
};

}  // namespace esengine

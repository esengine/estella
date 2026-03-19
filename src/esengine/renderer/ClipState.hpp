#pragma once

#include "../core/Types.hpp"
#include "RenderItem.hpp"
#include "DrawCommand.hpp"

#include <unordered_map>

namespace esengine {

class ClipState {
public:
    struct Entry {
        u16 flags = 0;
        ScissorRect scissor;
        i32 stencil_ref = 0;
    };

    void setScissor(u32 entity, i32 x, i32 y, i32 w, i32 h) {
        auto& e = entries_[entity];
        e.flags |= CMD_STATE_SCISSOR;
        e.scissor = {x, y, w, h};
    }

    void setStencilMask(u32 entity, i32 refValue) {
        auto& e = entries_[entity];
        e.flags |= CMD_STATE_STENCIL_WRITE;
        e.flags &= ~CMD_STATE_STENCIL_TEST;
        e.stencil_ref = refValue;
    }

    void setStencilTest(u32 entity, i32 refValue) {
        auto& e = entries_[entity];
        e.flags |= CMD_STATE_STENCIL_TEST;
        e.flags &= ~CMD_STATE_STENCIL_WRITE;
        e.stencil_ref = refValue;
    }

    void applyTo(Entity entity, DrawCommand& cmd) const {
        auto it = entries_.find(entity.id());
        if (it != entries_.end()) {
            cmd.state_flags = it->second.flags;
            cmd.scissor = it->second.scissor;
            cmd.stencil_ref = it->second.stencil_ref;
        }
    }

    bool hasEntry(u32 entity) const {
        return entries_.count(entity) > 0;
    }

    const Entry* getEntry(u32 entity) const {
        auto it = entries_.find(entity);
        return it != entries_.end() ? &it->second : nullptr;
    }

    void clear() { entries_.clear(); }
    bool empty() const { return entries_.empty(); }

private:
    std::unordered_map<u32, Entry> entries_;
};

}  // namespace esengine

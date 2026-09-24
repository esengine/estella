// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./FrameCapture.hpp"

#include <algorithm>

namespace esengine {

void FrameCapture::beginFrame() {
    pass_ = -1;
    if (!capture_next_) return;
    capture_next_ = false;
    records_.clear();
    entities_.clear();
    textures_.clear();
    pass_count_ = 0;
    has_data_ = false;
    capturing_ = true;
}

void FrameCapture::endFrame() {
    if (!capturing_) return;
    capturing_ = false;
    has_data_ = !records_.empty();
    pass_count_ = static_cast<u32>(pass_ + 1);
}

void FrameCapture::beginPass(CapturePass kind) {
    ++pass_;
    pass_kind_ = kind;
}

void FrameCapture::record(const DrawCommand& cmd, std::span<const Entity> entities) {
    if (!capturing_) return;

    DrawCallRecord r;
    r.index = static_cast<u32>(records_.size());
    r.pass = static_cast<u32>(std::max(pass_, 0));
    r.pass_kind = pass_kind_;
    r.stage = cmd.stage;
    r.type = cmd.type;
    r.blend_mode = cmd.blend_mode;
    r.texture_id = cmd.texture_count > 0 ? cmd.texture_ids[0] : 0;
    r.material_id = cmd.material_id;
    r.shader_id = cmd.shader_id;
    r.index_count = cmd.index_count;
    r.instance_count = cmd.instance_count;
    r.triangle_count = cmd.index_count / 3 * std::max(cmd.instance_count, 1u);
    r.layer = cmd.layer;
    r.break_reason = cmd.break_reason;
    r.scissor = cmd.scissor;
    r.scissor_enabled = (cmd.state_flags & CMD_STATE_SCISSOR) != 0;
    r.stencil_write = (cmd.state_flags & CMD_STATE_STENCIL_WRITE) != 0;
    r.stencil_test = (cmd.state_flags & CMD_STATE_STENCIL_TEST) != 0;
    r.stencil_ref = cmd.stencil_ref;
    r.texture_slot_usage = cmd.texture_count;
    r.texture_offset = static_cast<u32>(textures_.size());
    textures_.insert(textures_.end(), cmd.texture_ids, cmd.texture_ids + cmd.texture_count);
    r.entity_offset = static_cast<u32>(entities_.size());
    r.entity_count = static_cast<u32>(entities.size());
    entities_.insert(entities_.end(), entities.begin(), entities.end());
    records_.push_back(r);
}

u32 FrameCapture::recordsInPass(i32 pass) const {
    return static_cast<u32>(std::count_if(records_.begin(), records_.end(),
        [pass](const DrawCallRecord& r) { return static_cast<i32>(r.pass) == pass; }));
}

void FrameCapture::setReplayMode(i32 limit) {
    replay_mode_ = true;
    replay_counter_ = 0;
    replay_limit_ = limit;
}

void FrameCapture::clearReplayMode() {
    replay_mode_ = false;
    replay_counter_ = 0;
    replay_limit_ = -1;
}

}  // namespace esengine

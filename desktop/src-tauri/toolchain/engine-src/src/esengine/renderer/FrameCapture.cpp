#include "FrameCapture.hpp"

namespace esengine {

void FrameCapture::reset() {
    records_.clear();
    entities_.clear();
    pending_entities_.clear();
    camera_index_ = 0;
    camera_count_ = 0;
    has_data_ = false;
}

void FrameCapture::beginCapture() {
    if (capture_next_) {
        reset();
        capturing_ = true;
        capture_next_ = false;
    }
}

void FrameCapture::endCapture() {
    if (capturing_) {
        capturing_ = false;
        has_data_ = !records_.empty();
        camera_count_ = camera_index_ + 1;
    }
}

void FrameCapture::recordDrawCall(RenderStage stage, RenderType type, BlendMode blend_mode,
                                   u32 texture_id, u32 material_id, u32 shader_id,
                                   u32 vertex_count, u32 triangle_count, i32 layer,
                                   FlushReason reason, const ScissorRect& scissor,
                                   bool scissor_enabled, bool stencil_write, bool stencil_test,
                                   i32 stencil_ref, u8 texture_slot_usage) {
    if (replay_mode_) {
        replay_counter_++;
        return;
    }

    if (!capturing_) return;

    flushPendingEntities();

    DrawCallRecord record;
    record.index = static_cast<u32>(records_.size());
    record.camera_index = camera_index_;
    record.stage = stage;
    record.type = type;
    record.blend_mode = blend_mode;
    record.texture_id = texture_id;
    record.material_id = material_id;
    record.shader_id = shader_id;
    record.vertex_count = vertex_count;
    record.triangle_count = triangle_count;
    record.layer = layer;
    record.flush_reason = reason;
    record.scissor = scissor;
    record.scissor_enabled = scissor_enabled;
    record.stencil_write = stencil_write;
    record.stencil_test = stencil_test;
    record.stencil_ref = stencil_ref;
    record.texture_slot_usage = texture_slot_usage;

    records_.push_back(record);
}

void FrameCapture::addPendingEntity(Entity entity) {
    if (!capturing_) return;
    pending_entities_.push_back(entity);
}

void FrameCapture::flushPendingEntities() {
    if (!capturing_ || records_.empty()) return;

    auto& last = records_.back();
    last.entity_offset = static_cast<u32>(entities_.size());
    last.entity_count = static_cast<u32>(pending_entities_.size());

    entities_.insert(entities_.end(), pending_entities_.begin(), pending_entities_.end());
    pending_entities_.clear();
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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../draw/RenderItem.hpp"
#include "./RenderStage.hpp"
#include "../draw/BlendMode.hpp"
#include "../draw/DrawCommand.hpp"

#include <vector>

namespace esengine {

struct DrawCallRecord {
    u32 index = 0;
    u32 camera_index = 0;
    RenderStage stage = RenderStage::Transparent;
    RenderType type = RenderType::Sprite;
    BlendMode blend_mode = BlendMode::Normal;
    u32 texture_id = 0;
    u32 material_id = 0;
    u32 shader_id = 0;
    u32 vertex_count = 0;
    u32 triangle_count = 0;
    u32 entity_count = 0;
    u32 entity_offset = 0;
    i32 layer = 0;
    BatchBreak break_reason = BatchBreak::RunStart;
    ScissorRect scissor;
    bool scissor_enabled = false;
    bool stencil_write = false;
    bool stencil_test = false;
    i32 stencil_ref = -1;
    u8 texture_slot_usage = 0;
};

static_assert(sizeof(DrawCallRecord) == 76, "DrawCallRecord size must match TS decoder");

class FrameCapture {
public:
    void reset();
    void setCameraIndex(u32 index) { camera_index_ = index; }

    void beginCapture();
    void endCapture();
    bool isCapturing() const { return capturing_; }
    bool hasCapturedData() const { return has_data_; }

    void setCaptureNextFrame(bool v) { capture_next_ = v; }
    bool shouldCaptureNextFrame() const { return capture_next_; }

    void recordDrawCall(RenderStage stage, RenderType type, BlendMode blend_mode,
                        u32 texture_id, u32 material_id, u32 shader_id,
                        u32 vertex_count, u32 triangle_count, i32 layer,
                        BatchBreak reason, const ScissorRect& scissor,
                        bool scissor_enabled, bool stencil_write, bool stencil_test,
                        i32 stencil_ref, u8 texture_slot_usage);

    void addPendingEntity(Entity entity);
    void flushPendingEntities();

    u32 getRecordCount() const { return static_cast<u32>(records_.size()); }
    const DrawCallRecord* getRecords() const { return records_.data(); }
    const Entity* getEntities() const { return entities_.data(); }
    u32 getEntityCount() const { return static_cast<u32>(entities_.size()); }
    u32 getCameraCount() const { return camera_count_; }

    void setReplayMode(i32 limit);
    void clearReplayMode();
    bool isReplaying() const { return replay_mode_; }
    bool shouldStop() const { return replay_mode_ && replay_counter_ >= replay_limit_; }

private:
    std::vector<DrawCallRecord> records_;
    std::vector<Entity> entities_;
    std::vector<Entity> pending_entities_;
    u32 camera_index_ = 0;
    u32 camera_count_ = 0;
    bool capturing_ = false;
    bool capture_next_ = false;
    bool has_data_ = false;

    bool replay_mode_ = false;
    i32 replay_counter_ = 0;
    i32 replay_limit_ = -1;
};

}  // namespace esengine

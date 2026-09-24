// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  FrameCapture.hpp
 * @brief One frame's draw calls as the device received them, for the frame debugger.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../draw/RenderItem.hpp"
#include "./RenderStage.hpp"
#include "../draw/BlendMode.hpp"
#include "../draw/DrawCommand.hpp"

#include <cstddef>
#include <span>
#include <vector>

namespace esengine {

/** What a pass of the frame draws: a camera's scene, or the screen-space overlay. */
enum class CapturePass : u8 {
    Scene = 0,
    Overlay = 1,
};

struct DrawCallRecord {
    u32 index = 0;
    u32 pass = 0;
    RenderStage stage = RenderStage::Transparent;
    RenderType type = RenderType::Sprite;
    BlendMode blend_mode = BlendMode::Normal;
    CapturePass pass_kind = CapturePass::Scene;
    u32 texture_id = 0;
    u32 material_id = 0;
    u32 shader_id = 0;
    u32 index_count = 0;
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
    u32 instance_count = 0;
};

// The TS decoder (sdk/src/render/frameCapture.ts) reads these offsets.
static_assert(sizeof(DrawCallRecord) == 80, "DrawCallRecord size must match TS decoder");
static_assert(offsetof(DrawCallRecord, pass_kind) == 11, "DrawCallRecord layout must match TS decoder");
static_assert(offsetof(DrawCallRecord, instance_count) == 76, "DrawCallRecord layout must match TS decoder");

/**
 * A capture spans beginFrame to endFrame, so every camera and the overlay land in
 * it, numbered by pass in the order they ran. Passes are counted on every frame,
 * captured or not: a replay names its pass by that number on a later frame.
 */
class FrameCapture {
public:
    /** Drops the last capture: until the next frame lands, there is none to read. */
    void requestCapture() {
        capture_next_ = true;
        has_data_ = false;
    }

    void beginFrame();
    void endFrame();
    void beginPass(CapturePass kind);
    i32 currentPass() const { return pass_; }

    bool isCapturing() const { return capturing_; }
    bool hasCapturedData() const { return has_data_; }

    /** @p entities are the ones the draw merged, in draw order. */
    void record(const DrawCommand& cmd, std::span<const Entity> entities);

    u32 getRecordCount() const { return static_cast<u32>(records_.size()); }
    const DrawCallRecord* getRecords() const { return records_.data(); }
    const Entity* getEntities() const { return entities_.data(); }
    u32 getEntityCount() const { return static_cast<u32>(entities_.size()); }
    u32 getPassCount() const { return pass_count_; }
    /** How many draws the captured frame's pass @p pass made. */
    u32 recordsInPass(i32 pass) const;

    void setReplayMode(i32 limit);
    void clearReplayMode();
    bool isReplaying() const { return replay_mode_; }
    /** Counts one replayed draw; true once the replay has drawn its last. */
    bool stepReplay() { return ++replay_counter_ >= replay_limit_; }

private:
    std::vector<DrawCallRecord> records_;
    std::vector<Entity> entities_;
    i32 pass_ = -1;
    CapturePass pass_kind_ = CapturePass::Scene;
    u32 pass_count_ = 0;
    bool capturing_ = false;
    bool capture_next_ = false;
    bool has_data_ = false;

    bool replay_mode_ = false;
    i32 replay_counter_ = 0;
    i32 replay_limit_ = -1;
};

}  // namespace esengine

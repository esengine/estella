// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "./DrawCommand.hpp"
#include "../rhi/GfxDevice.hpp"
#include "../rhi/TransientBufferPool.hpp"
#include "../frame/FrameCapture.hpp"

#include <vector>

namespace esengine {

class MaterialStore;

class DrawList {
public:
    void clear();
    void push(const DrawCommand& cmd);

    // Sorts, then coalesces contiguous compatible commands — combining up to 8 textures
    // into one multi-texture batch and stamping each command's per-vertex sampler slot
    // (hence the pool, whose staging it rewrites; call before upload()).
    void finalize(TransientBufferPool& pool);

    // Each merged command resolves to an immutable pipeline (program + layout + blend +
    // depth + stencil + cull) bound via GfxDevice::setPipeline; per-draw dynamic state
    // (scissor, stencil ref, textures) is applied directly. Per-frame constants come from
    // the FrameConstants UBO bound by RenderContext; per-material constants from each
    // command's material UBO, bound here via MaterialStore::bindForDraw.
    // white_texture_id fills a Batch draw's unused sampler slots — a STABLE texture
    // so those slots stay pinned across draws and the bind cache dedups them
    // (filling with the draw's own tex re-pointed all 8 units on every tex change).
    void execute(GfxDevice& device, TransientBufferPool& buffers,
                 MaterialStore& materials, u32 white_texture_id = 0,
                 FrameCapture* capture = nullptr);

    u32 commandCount() const { return static_cast<u32>(commands_.size()); }
    u32 mergedDrawCallCount() const { return merged_draw_calls_; }

    const DrawCommand* commands() const { return commands_.data(); }
    const DrawCommand& command(u32 index) const { return commands_[index]; }

    // Bit i set ⇒ layer i (0..31) sorts by world Y within the layer (top-down
    // occlusion) instead of material/depth. Lives here so pushBatchDraw — the one
    // key-building site — consults it for every render path uniformly.
    void setYSortMask(u32 mask) { ysort_mask_ = mask; }
    u32 ySortMask() const { return ysort_mask_; }

private:
    struct SortEntry {
        u64 key;
        u32 index;
    };

    std::vector<DrawCommand> commands_;
    std::vector<SortEntry> sort_entries_;
    std::vector<DrawCommand> sorted_scratch_;  // reused across frames to avoid a
                                               // per-frame heap alloc in finalize()
    u32 merged_draw_calls_ = 0;
    u32 ysort_mask_ = 0;
};

}  // namespace esengine

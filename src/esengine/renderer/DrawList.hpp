// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "DrawCommand.hpp"
#include "GfxDevice.hpp"
#include "TransientBufferPool.hpp"
#include "FrameCapture.hpp"

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
    void execute(GfxDevice& device, TransientBufferPool& buffers,
                 MaterialStore& materials, FrameCapture* capture = nullptr);

    u32 commandCount() const { return static_cast<u32>(commands_.size()); }
    u32 mergedDrawCallCount() const { return merged_draw_calls_; }

    const DrawCommand* commands() const { return commands_.data(); }
    const DrawCommand& command(u32 index) const { return commands_[index]; }

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
};

}  // namespace esengine

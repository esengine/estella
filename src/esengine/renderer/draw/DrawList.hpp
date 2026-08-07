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

    // Bit i set ⇒ layer i resolves its contents by real depth: opaque draws write
    // the depth buffer and sort front-to-back, blended ones test against it without
    // writing and stay in painter's order. This is the 2.5D opt-in.
    void setDepthMask(u32 mask) { depth_mask_ = mask; }
    u32 depthMask() const { return depth_mask_; }

    // Bit i set ⇒ the camera being rendered draws layer i. A camera property, not a
    // scene one, so it is set per camera (RenderFrame::begin clears the list each time).
    void setCullingMask(u32 mask) { culling_mask_ = mask; }
    u32 cullingMask() const { return culling_mask_; }

    /** @brief Whether a draw belonging to @p layerBit survives this camera's mask.
     *         Bit 0 means "no layer" (outside 0..31) and is visible to every camera. */
    bool layerVisible(u32 layerBit) const {
        return layerBit == 0 || (culling_mask_ & layerBit) != 0;
    }

    /** @brief The mask bit of a sorting layer, or 0 when it has none (outside 0..31). */
    static u32 layerBit(i32 layer) {
        return (layer < 0 || layer >= 32) ? 0u : (1u << layer);
    }

    /** @brief How one sorting layer resolves the draws inside it. */
    enum class LayerOrder : u8 { Painter, YSort, Depth };

    /**
     * @brief The one answer for @p layer, from two masks that are two spellings of
     *        the same question.
     *
     * @details Y-sort is a depth PROJECTED from world Y and depth is the real thing;
     *          a layer declaring both has said two contradictory things, and there is
     *          no order that satisfies them. Y-sort wins so that a project which had
     *          it before renders exactly as it did — the resolution belongs here, in
     *          one pure function, rather than in each caller's idea of precedence.
     *          Layers outside 0..31 have no bit and are therefore painter-ordered.
     */
    LayerOrder layerOrder(i32 layer) const {
        if (layer < 0 || layer >= 32) return LayerOrder::Painter;
        const u32 bit = 1u << layer;
        if (ysort_mask_ & bit) return LayerOrder::YSort;
        if (depth_mask_ & bit) return LayerOrder::Depth;
        return LayerOrder::Painter;
    }

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
    u32 depth_mask_ = 0;
    u32 culling_mask_ = 0xFFFFFFFFu;  // every layer, until a camera says otherwise
};

}  // namespace esengine

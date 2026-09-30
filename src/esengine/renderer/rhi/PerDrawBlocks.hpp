// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PerDrawBlocks.hpp
 * @brief   A uniform range per draw, so two draws never write into one block.
 *
 * @details A queue write lands where the pass is SUBMITTED, not where it was
 *          called, so a block shared between two draws is read by both with what
 *          the last wrote. Ranges are handed out per FRAME and not per pass: one
 *          submission stands behind a frame's several passes.
 *
 *          The ranges are carved from a few large pages rather than a buffer each,
 *          and a pass stages all of its draws' blocks before it uploads them once
 *          per page: creating a buffer costs the GPU process far more than writing
 *          one, and a first frame of eight thousand draws once spent half a minute
 *          creating them.
 */
#pragma once

#include "../../core/Types.hpp"
#include "./GfxDevice.hpp"

#include <algorithm>
#include <cstring>
#include <vector>

namespace esengine {

class PerDrawBlocks {
public:
    /** @brief Where one draw's block was staged; a default one binds the zero block. */
    struct Range {
        u32 page = NONE;
        u32 offset = 0;
    };

    /** @brief Claims the pool for blocks of @p blockSize bytes, plus the zero one. */
    void init(GfxDevice& device, u32 blockSize) {
        device_ = &device;
        blockSize_ = blockSize;
        pageBytes_ = std::max(PAGE_BYTES, alignUp(blockSize));
        pages_.clear();
        page_ = 0;
        cursor_ = 0;
        used_ = 0;
        const std::vector<u8> zeros(blockSize, 0);
        zero_ = device.createBuffer({GfxBufferUsage::Uniform, blockSize, /*dynamic=*/false},
                                    GfxContent::retained(), zeros.data());
    }

    /** @brief Hands every range back. Called once per FRAME — see the file note. */
    void beginFrame() {
        page_ = 0;
        cursor_ = 0;
        used_ = 0;
    }

    /**
     * @brief Copies @p size bytes of @p bytes into a range of this frame's, to reach
     *        the GPU at the next upload(); a block it cannot hold stages nothing.
     *
     * @details The next range starts after the bytes staged: a draw reads only
     *          what it was given, so the rest of its binding may be the next
     *          draw's. Grows rather than wraps, which would share a range.
     */
    Range stage(const void* bytes, u32 size) {
        if (!device_ || !bytes || size == 0 || size > blockSize_) return {};
        if (page_ < pages_.size() && cursor_ + blockSize_ > pageBytes_) {
            ++page_;
            cursor_ = 0;
        }
        if (page_ == pages_.size()) {
            Page page;
            page.buffer = device_->createBuffer(
                {GfxBufferUsage::Uniform, pageBytes_, /*dynamic=*/true}, GfxContent::transient(),
                nullptr);
            page.bytes.assign(pageBytes_, 0);
            pages_.push_back(std::move(page));
        }
        Page& page = pages_[page_];
        std::memcpy(page.bytes.data() + cursor_, bytes, size);
        page.dirtyFrom = std::min(page.dirtyFrom, cursor_);
        page.dirtyTo = std::max(page.dirtyTo, cursor_ + size);
        const Range range{static_cast<u32>(page_), cursor_};
        cursor_ += alignUp(size);
        ++used_;
        return range;
    }

    /** @brief Sends what was staged since the last upload, one write per page. */
    void upload() {
        for (Page& page : pages_) {
            if (page.dirtyFrom >= page.dirtyTo) continue;
            device_->updateBuffer(page.buffer, page.dirtyFrom, page.bytes.data() + page.dirtyFrom,
                                  page.dirtyTo - page.dirtyFrom);
            page.dirtyFrom = NONE;
            page.dirtyTo = 0;
        }
    }

    /** @brief Binds @p range to @p slot — the zero block for a range staging refused. */
    void bind(u32 slot, Range range) const {
        if (!device_) return;
        if (range.page >= pages_.size()) {
            bindZero(slot);
            return;
        }
        device_->setUniformBuffer(slot, pages_[range.page].buffer, range.offset, blockSize_);
    }

    /** @brief Binds what a draw with nothing to say reads: zeroed once and never
     *         written, so "none" is an object rather than an erasure. */
    void bindZero(u32 slot) const {
        if (device_) device_->setUniformBuffer(slot, zero_);
    }

    /** @brief Ranges this frame has handed out — a per-frame cost, for the profile. */
    u32 used() const { return used_; }

private:
    static constexpr u32 NONE = 0xFFFFFFFFu;
    static constexpr u32 PAGE_BYTES = 128 * 1024;
    static u32 alignUp(u32 n) {
        return (n + GFX_UNIFORM_OFFSET_ALIGNMENT - 1) / GFX_UNIFORM_OFFSET_ALIGNMENT *
               GFX_UNIFORM_OFFSET_ALIGNMENT;
    }

    struct Page {
        BufferHandle buffer = BufferHandle::Invalid;
        std::vector<u8> bytes;
        u32 dirtyFrom = NONE;
        u32 dirtyTo = 0;
    };

    GfxDevice* device_ = nullptr;
    u32 blockSize_ = 0;
    u32 pageBytes_ = 0;
    std::vector<Page> pages_;
    usize page_ = 0;
    u32 cursor_ = 0;
    u32 used_ = 0;
    BufferHandle zero_ = BufferHandle::Invalid;
};

/**
 * @brief The uniform blocks a draw rewrites immediately before it.
 *
 * @details One parameter and not four: every caller passes the same set from the
 *          same owner, so a block added to the vocabulary reaches the draw loop
 *          without every call site having to learn its name.
 */
struct PerDrawBlockSet {
    PerDrawBlocks* skin = nullptr;
    PerDrawBlocks* morph = nullptr;
    PerDrawBlocks* probe = nullptr;
    PerDrawBlocks* instance = nullptr;
};

}  // namespace esengine

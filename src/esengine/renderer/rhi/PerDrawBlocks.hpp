// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PerDrawBlocks.hpp
 * @brief   A uniform buffer per draw, so two draws never write into one block.
 *
 * @details A queue write lands where the pass is SUBMITTED, not where it was
 *          called, so a block shared between two draws is read by both with what
 *          the last wrote. Buffers are handed out per FRAME and not per pass: one
 *          submission stands behind a frame's several passes.
 */
#pragma once

#include "../../core/Types.hpp"
#include "./GfxDevice.hpp"

#include <vector>

namespace esengine {

class PerDrawBlocks {
public:
    /** @brief Claims the pool for blocks of @p blockSize bytes, plus the zero one.
     *         Also what a device loss runs: old handles are DROPPED, not deleted,
     *         since freeing an id would read metadata the backend just wiped. */
    void init(GfxDevice& device, u32 blockSize) {
        device_ = &device;
        blockSize_ = blockSize;
        pool_.clear();
        used_ = 0;
        const std::vector<u8> zeros(blockSize, 0);
        zero_ = device.createBuffer({GfxBufferUsage::Uniform, blockSize, /*dynamic=*/false},
                                    zeros.data());
    }

    /** @brief Hands every buffer back. Called once per FRAME — see the file note. */
    void beginFrame() { used_ = 0; }

    /** @brief A buffer of this frame's holding @p size bytes of @p bytes. Grows
     *         rather than wraps: wrapping hands one buffer to two draws. */
    BufferHandle write(const void* bytes, u32 size) {
        if (!device_ || !bytes || size == 0 || size > blockSize_) return BufferHandle::Invalid;
        if (used_ == pool_.size()) {
            const std::vector<u8> zeros(blockSize_, 0);
            pool_.push_back(device_->createBuffer(
                {GfxBufferUsage::Uniform, blockSize_, /*dynamic=*/true}, zeros.data()));
        }
        const BufferHandle handle = pool_[used_++];
        if (handle != BufferHandle::Invalid) device_->updateBuffer(handle, 0, bytes, size);
        return handle;
    }

    /** @brief What a draw with nothing to say reads: zeroed once and never
     *         written, so "none" is an object rather than an erasure. */
    BufferHandle zero() const { return zero_; }

    /** @brief Buffers this frame has handed out — a per-frame cost, for the profile. */
    u32 used() const { return used_; }

private:
    GfxDevice* device_ = nullptr;
    u32 blockSize_ = 0;
    std::vector<BufferHandle> pool_;
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

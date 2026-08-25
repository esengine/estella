// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TargetPool.hpp
 * @brief   The render targets a frame borrows from, keyed by shape — owned by
 *          the frame, not by any one graph that draws from it.
 *
 * A RenderGraph is a CHAIN, and a frame holds several of them: one per camera
 * and one for the screen-level stack. While the pool lived inside the graph,
 * every `begin()` handed every target back, so nothing could be borrowed across
 * two chains — which is why the shadow atlas had to be a framebuffer of its own,
 * created on the first shadowed frame and held for the rest of the run.
 *
 * Splitting it out makes the lifetime the borrower's to state: a chain's
 * transient goes back at its last read, the atlas goes back at the end of the
 * frame, and both come out of the same physical targets on the next one.
 *
 * Handles carry a generation. A slot outlives the target in it — evicting frees
 * the memory and leaves the slot to be refilled — so an index alone would let a
 * handle taken before an eviction name whatever landed in that slot afterwards,
 * and a frame holding the atlas across a window resize would draw its shadows
 * into a post-process target. The generation makes a stale handle name nothing.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../rhi/Framebuffer.hpp"
#include "../rhi/GfxEnums.hpp"

#include <vector>

namespace esengine {

class GfxDevice;

namespace rg {

/**
 * @brief A borrowed target: a slot index, and the generation of what is in it.
 *
 * @details Opaque — pack and unpack are the pool's. Compare it, hold it, hand it
 *          back; a handle whose target has since been freed resolves to nothing
 *          rather than to the next thing that took the slot.
 */
using TargetHandle = u32;
constexpr TargetHandle kNoTarget = static_cast<TargetHandle>(-1);

/** What a borrower asks for. Sizes are pixels — a scale is the caller's to resolve. */
struct TargetShape {
    u32 width = 0;
    u32 height = 0;
    GfxPixelFormat format = GfxPixelFormat::RGBA8;
    bool linearFilter = true;
    bool depthStencil = false;
};

class TargetPool {
public:
    explicit TargetPool(GfxDevice& device);
    ~TargetPool();

    TargetPool(const TargetPool&) = delete;
    TargetPool& operator=(const TargetPool&) = delete;

    /**
     * @brief Borrow a target of this shape, reusing one or creating it.
     * @return kNoTarget if the device could not make one.
     */
    TargetHandle acquire(const TargetShape& shape);

    /** Give one back. Borrowing again may hand out the same physical target. */
    void release(TargetHandle handle);

    /** Whether a handle still names a live target — false once it was freed. */
    bool holds(TargetHandle handle) const;

    FramebufferHandle framebufferOf(TargetHandle handle) const;
    TextureHandle textureOf(TargetHandle handle) const;

    /**
     * @brief One tick of the clock every borrowed target is aged against.
     *
     * @details Called once per graph. A target out on loan does not age; one
     *          nothing has borrowed for {@link kIdleTicksBeforeEvict} ticks is
     *          memory held against a chain that was turned off, or a scene that
     *          stopped casting shadows, and is destroyed.
     */
    void age();

    /** Drop everything. For shutdown and for device loss, after which the
     *  handles the pool holds name nothing. */
    void clear();

    /** Physical targets currently allocated. Diagnostics and tests. */
    u32 count() const;

    /** What they cost in GPU memory, so a budget reads bytes rather than a
     *  count of things with no common size. */
    u64 bytes() const;

    /**
     * @brief Ticks a target may go unborrowed before the pool destroys it.
     *
     * @details High on purpose: acquire() resets it, so this bounds only how
     *          long a target NOTHING asks for is kept against being asked for
     *          again. At a small number a target used by one of several chains
     *          would thrash on the ticks the others take.
     */
    static constexpr u32 kIdleTicksBeforeEvict = 120;

private:
    struct Entry {
        Unique<Framebuffer> fbo;
        TargetShape shape;
        bool inUse = false;
        /// Ticks since anything borrowed it; age() adds, acquire() zeroes.
        u32 idle = 0;
        /// Bumped whenever the target in this slot is freed, which is what makes
        /// every handle to it stale.
        u32 generation = 0;
    };

    /// Slots live in the low bits so the count is what bounds them, not the
    /// generation: 64K slots is far past any frame, and a generation that wraps
    /// would need the same slot freed 64K times while one handle survived.
    static constexpr u32 kSlotBits = 16;
    static constexpr u32 kSlotMask = (1u << kSlotBits) - 1;

    /// The entry a handle names, or nullptr if it names one that has been freed.
    const Entry* resolve(TargetHandle handle) const;

    GfxDevice& device_;
    std::vector<Entry> entries_;
};

}  // namespace rg
}  // namespace esengine

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TargetPool.cpp
 * @brief   Borrow, return and age the frame's render targets. See TargetPool.hpp.
 */
#include "TargetPool.hpp"

#include "../../core/Log.hpp"
#include "../rhi/GfxDevice.hpp"

namespace esengine::rg {

namespace {

/** Bytes one texel of a target costs, colour and depth counted separately. */
u64 texelBytes(const TargetShape& shape) {
    // A colour attachment stored as RGB8 still occupies four bytes on both
    // backends (WebGPU has no 24-bit colour target and WebGL2 pads), so the
    // upload-side gfxBytesPerPixel would under-report a target by a quarter.
    u64 bytes = shape.format == GfxPixelFormat::RGBA16F ? 8u : 4u;
    // Depth24Stencil8 is what a depth-stencil attachment costs; the colour above
    // is separate storage, not a second view of it.
    if (shape.depthStencil) bytes += 4u;
    // A multisampled target is that many times over, PLUS the single-sample
    // attachments it resolves into — it is two targets in one object, and a
    // budget that counted only the shape would under-report it fivefold.
    if (shape.samples > 1) bytes *= (shape.samples + 1);
    return bytes;
}

bool sameShape(const TargetShape& a, const TargetShape& b) {
    return a.width == b.width && a.height == b.height && a.format == b.format
           && a.linearFilter == b.linearFilter && a.depthStencil == b.depthStencil
           && a.samples == b.samples && a.gbuffer == b.gbuffer && a.storage == b.storage;
}

}  // namespace

TargetPool::TargetPool(GfxDevice& device) : device_(device) {}

TargetPool::~TargetPool() = default;

const TargetPool::Entry* TargetPool::resolve(TargetHandle handle) const {
    if (handle == kNoTarget) return nullptr;
    const u32 slot = handle & kSlotMask;
    if (slot >= entries_.size()) return nullptr;
    const Entry& entry = entries_[slot];
    // The generation is what tells a live handle from one whose target was freed
    // and whose slot something else has since taken.
    if (!entry.fbo || entry.generation != (handle >> kSlotBits)) return nullptr;
    return &entry;
}

TargetHandle TargetPool::acquire(const TargetShape& shape) {
    auto handleFor = [&](usize slot) {
        return static_cast<TargetHandle>((entries_[slot].generation << kSlotBits)
                                         | static_cast<u32>(slot));
    };

    for (usize i = 0; i < entries_.size(); ++i) {
        Entry& entry = entries_[i];
        if (entry.inUse || !entry.fbo || !sameShape(entry.shape, shape)) continue;
        entry.inUse = true;
        // Borrowed, so it is not idle. The only place age is reset.
        entry.idle = 0;
        return handleFor(i);
    }

    FramebufferSpec spec;
    spec.width = shape.width;
    spec.height = shape.height;
    spec.depthStencil = shape.depthStencil;
    spec.linearFilter = shape.linearFilter;
    spec.colorFormat = shape.format;
    spec.samples = shape.samples;
    spec.gbuffer = shape.gbuffer;
    spec.storage = shape.storage;
    auto fbo = Framebuffer::create(device_, spec);
    if (!fbo) {
        ES_LOG_ERROR("TargetPool: failed to create a {}x{} target", shape.width, shape.height);
        return kNoTarget;
    }

    // An emptied slot is refilled before a new one is appended: the generation
    // in it has already moved on, so no handle from its last occupant matches.
    for (usize i = 0; i < entries_.size(); ++i) {
        if (entries_[i].fbo) continue;
        entries_[i].fbo = std::move(fbo);
        entries_[i].shape = shape;
        entries_[i].inUse = true;
        entries_[i].idle = 0;
        return handleFor(i);
    }

    if (entries_.size() > kSlotMask) {
        ES_LOG_ERROR("TargetPool: {} targets is past what a handle can name", entries_.size());
        return kNoTarget;
    }

    Entry entry;
    entry.fbo = std::move(fbo);
    entry.shape = shape;
    entry.inUse = true;
    entries_.push_back(std::move(entry));
    return handleFor(entries_.size() - 1);
}

void TargetPool::release(TargetHandle handle) {
    if (!resolve(handle)) return;
    entries_[handle & kSlotMask].inUse = false;
}

bool TargetPool::holds(TargetHandle handle) const {
    return resolve(handle) != nullptr;
}

FramebufferHandle TargetPool::framebufferOf(TargetHandle handle) const {
    const Entry* entry = resolve(handle);
    return entry ? entry->fbo->handle() : FramebufferHandle::Default;
}

TextureHandle TargetPool::textureOf(TargetHandle handle) const {
    const Entry* entry = resolve(handle);
    return entry ? entry->fbo->getColorAttachment() : TextureHandle::Invalid;
}

TextureHandle TargetPool::depthTextureOf(TargetHandle handle) const {
    const Entry* entry = resolve(handle);
    return entry ? entry->fbo->getDepthAttachment() : TextureHandle::Invalid;
}

TextureHandle TargetPool::gbufferTextureOf(TargetHandle handle) const {
    const Entry* entry = resolve(handle);
    return entry ? entry->fbo->getGBufferAttachment() : TextureHandle::Invalid;
}

TextureHandle TargetPool::albedoTextureOf(TargetHandle handle) const {
    const Entry* entry = resolve(handle);
    return entry ? entry->fbo->getAlbedoAttachment() : TextureHandle::Invalid;
}

void TargetPool::age() {
    for (auto& entry : entries_) {
        if (!entry.fbo || entry.inUse) continue;
        if (++entry.idle >= kIdleTicksBeforeEvict) {
            // The slot stays and the generation moves on: the memory goes, and
            // every handle that named it stops naming anything.
            entry.fbo.reset();
            entry.idle = 0;
            ++entry.generation;
        }
    }
    // A viewport that is being resized borrows a new shape every tick and leaves the last one idle: two seconds of that is a hundred
    // sets of targets. What sits idle past the budget goes at once, the longest idle first, whatever its age. Only what has really been
    // left: everything a frame borrows has just been given back when this runs, so counting that too destroyed and rebuilt a frame's own
    // targets every frame once they added up past the budget (a 4096 shadow atlas and a 4x scene target at 2670x1200: 40 ms on a phone).
    u64 idleBytes = 0;
    for (const auto& entry : entries_) {
        if (entry.fbo && !entry.inUse && entry.idle >= kBudgetGraceTicks) idleBytes += static_cast<u64>(entry.shape.width) * entry.shape.height * texelBytes(entry.shape);
    }
    while (idleBytes > kIdleByteBudget) {
        Entry* oldest = nullptr;
        for (auto& entry : entries_) {
            if (entry.fbo && !entry.inUse && entry.idle >= kBudgetGraceTicks && (!oldest || entry.idle > oldest->idle)) oldest = &entry;
        }
        if (!oldest) break;
        idleBytes -= static_cast<u64>(oldest->shape.width) * oldest->shape.height * texelBytes(oldest->shape);
        oldest->fbo.reset();
        oldest->idle = 0;
        ++oldest->generation;
    }
}

void TargetPool::clear() {
    // Same bargain as an eviction, for every slot at once. The slots themselves
    // are kept — a handle held across a device loss has to come back stale, not
    // come back naming whatever refills its index.
    for (auto& entry : entries_) {
        if (!entry.fbo) continue;
        entry.fbo.reset();
        entry.inUse = false;
        entry.idle = 0;
        ++entry.generation;
    }
}

u32 TargetPool::count() const {
    u32 live = 0;
    for (const auto& entry : entries_) {
        if (entry.fbo) ++live;
    }
    return live;
}

u64 TargetPool::bytes() const {
    u64 total = 0;
    for (const auto& entry : entries_) {
        if (!entry.fbo) continue;
        total += static_cast<u64>(entry.shape.width) * entry.shape.height * texelBytes(entry.shape);
    }
    return total;
}

}  // namespace esengine::rg

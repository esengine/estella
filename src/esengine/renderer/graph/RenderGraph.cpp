// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    RenderGraph.cpp
 * @brief   Compile and run a frame's full-screen passes. See RenderGraph.hpp.
 */
#include "RenderGraph.hpp"

#include "../../core/Log.hpp"
#include "../rhi/GfxDevice.hpp"

#include <algorithm>

namespace esengine::rg {

RenderGraph::RenderGraph(GfxDevice& device, TargetPool& pool)
    : device_(device), pool_(pool) {}

RenderGraph::RenderGraph(GfxDevice& device)
    : device_(device), ownedPool_(makeUnique<TargetPool>(device)), pool_(*ownedPool_) {}

RenderGraph::~RenderGraph() = default;

void RenderGraph::begin(u32 refWidth, u32 refHeight) {
    // Kept, not freed: the vectors' capacity is the whole point of reusing one
    // graph across frames.
    resources_.clear();
    passes_.clear();
    inputScratch_.clear();
    finalTarget_ = kNoResource;

    // Only what THIS graph borrowed goes back: the pool is shared with the
    // frame's other chains and with whatever holds a target across them.
    for (const TargetHandle handle : borrowed_) pool_.release(handle);
    borrowed_.clear();
    // The pool's OWNER ticks its clock. A borrowed one is ticked once per frame
    // by the frame; ticking it per chain would age a target faster on a scene
    // that happens to have more cameras.
    if (ownedPool_) pool_.age();

    refWidth_ = refWidth;
    refHeight_ = refHeight;
    executed_ = 0;
}

ResourceId RenderGraph::importTexture(TextureHandle texture, u32 width, u32 height) {
    Resource res;
    res.kind = Kind::ImportedTexture;
    res.texture = texture;
    res.width = width;
    res.height = height;
    resources_.push_back(res);
    return static_cast<ResourceId>(resources_.size() - 1);
}

ResourceId RenderGraph::importTarget(FramebufferHandle target, u32 width, u32 height) {
    Resource res;
    res.kind = Kind::ImportedTarget;
    res.target = target;
    res.width = width;
    res.height = height;
    resources_.push_back(res);
    finalTarget_ = static_cast<ResourceId>(resources_.size() - 1);
    return finalTarget_;
}

ResourceId RenderGraph::createTarget(const TargetDesc& desc) {
    Resource res;
    res.kind = Kind::Transient;
    res.desc = desc;
    resolveSize(res);
    resources_.push_back(res);
    return static_cast<ResourceId>(resources_.size() - 1);
}

ResourceId RenderGraph::createExternalTarget(const TargetDesc& desc) {
    const ResourceId id = createTarget(desc);
    Resource& res = resources_[id];
    res.pooled = acquire(res);
    if (res.pooled == kNoTarget) return kNoResource;
    res.texture = pool_.textureOf(res.pooled);
    return id;
}

FramebufferHandle RenderGraph::framebufferOf(ResourceId id) const {
    if (id >= resources_.size()) return FramebufferHandle::Default;
    const Resource& res = resources_[id];
    if (res.kind == Kind::ImportedTarget) return res.target;
    if (res.pooled == kNoTarget) return FramebufferHandle::Default;
    return pool_.framebufferOf(res.pooled);
}

void RenderGraph::addPass(PassDesc pass) {
    passes_.push_back(std::move(pass));
}

void RenderGraph::resolveSize(Resource& res) const {
    // An absolute size is the target saying its texels are its own — a shadow
    // atlas divides into tiles of a fixed size, so a fraction of the window
    // would change how many maps fit when the window changed.
    if (res.desc.width > 0 && res.desc.height > 0) {
        res.width = res.desc.width;
        res.height = res.desc.height;
        return;
    }
    const f32 scale = res.desc.scale > 0.0f ? res.desc.scale : 1.0f;
    res.width = std::max(1u, static_cast<u32>(static_cast<f32>(refWidth_) * scale));
    res.height = std::max(1u, static_cast<u32>(static_cast<f32>(refHeight_) * scale));
}

void RenderGraph::cull(std::vector<bool>& live) const {
    live.assign(passes_.size(), false);
    if (finalTarget_ == kNoResource) return;

    // Walk back from the final target: a resource is wanted if the image needs
    // it, and a pass is live if it writes one. Reverse order because a pass can
    // only be fed by a pass before it — the graph is built in submission order.
    std::vector<bool> wanted(resources_.size(), false);
    wanted[finalTarget_] = true;
    for (i32 i = static_cast<i32>(passes_.size()) - 1; i >= 0; --i) {
        const PassDesc& pass = passes_[static_cast<usize>(i)];
        if (pass.write >= resources_.size() || !wanted[pass.write]) continue;
        live[static_cast<usize>(i)] = true;
        for (ResourceId read : pass.reads) {
            if (read < resources_.size()) wanted[read] = true;
        }
        // A dependency is wanted on the same terms as a read: the pass that
        // produces it contributed to the image even though nothing binds it.
        for (ResourceId dep : pass.dependencies) {
            if (dep < resources_.size()) wanted[dep] = true;
        }
    }
}

TargetHandle RenderGraph::acquire(const Resource& res) {
    TargetShape shape;
    shape.width = res.width;
    shape.height = res.height;
    shape.format = res.desc.format;
    shape.linearFilter = res.desc.linearFilter;
    shape.depthStencil = res.desc.depthStencil;
    const TargetHandle handle = pool_.acquire(shape);
    if (handle != kNoTarget) borrowed_.push_back(handle);
    return handle;
}

void RenderGraph::release(Resource& res) {
    if (res.pooled == kNoTarget) return;
    pool_.release(res.pooled);
    res.pooled = kNoTarget;
    res.texture = TextureHandle::Invalid;
}

void RenderGraph::execute() {
    std::vector<bool> live;
    cull(live);

    // Last read decides when a target goes back to the pool. A transient nobody
    // reads is still written, so its life ends at the pass that wrote it.
    for (auto& res : resources_) res.lastRead = -1;
    for (usize i = 0; i < passes_.size(); ++i) {
        if (!live[i]) continue;
        for (ResourceId read : passes_[i].reads) {
            if (read < resources_.size()) resources_[read].lastRead = static_cast<i32>(i);
        }
        for (ResourceId dep : passes_[i].dependencies) {
            if (dep < resources_.size()) resources_[dep].lastRead = static_cast<i32>(i);
        }
    }

    for (usize i = 0; i < passes_.size(); ++i) {
        if (!live[i]) continue;
        PassDesc& pass = passes_[i];
        Resource& target = resources_[pass.write];

        if (target.kind == Kind::ImportedTexture) {
            ES_LOG_ERROR("RenderGraph: pass '{}' writes an imported texture", pass.name);
            continue;
        }

        FramebufferHandle fbo = FramebufferHandle::Default;
        if (target.kind == Kind::Transient) {
            if (target.pooled == kNoTarget) {
                target.pooled = acquire(target);
                if (target.pooled == kNoTarget) continue;
                target.texture = pool_.textureOf(target.pooled);
            }
            fbo = pool_.framebufferOf(target.pooled);
        } else {
            fbo = target.target;
        }

        RenderPassDesc rp{};
        rp.target = fbo;
        rp.clearColor = pass.clear;
        rp.clearDepth = pass.clearDepth;
        if (pass.clear) {
            for (u32 c = 0; c < 4; ++c) rp.clearColorValue[c] = pass.clearColor[c];
        }
        device_.beginRenderPass(rp);
        if (pass.viewportW > 0 && pass.viewportH > 0) {
            device_.setViewport(pass.viewportX, pass.viewportY, pass.viewportW, pass.viewportH);
        } else {
            device_.setViewport(0, 0, target.width, target.height);
        }

        inputScratch_.clear();
        for (u32 unit = 0; unit < pass.reads.size(); ++unit) {
            const ResourceId id = pass.reads[unit];
            const TextureHandle tex = textureOf(id);
            device_.bindTexture(unit, tex);
            inputScratch_.push_back(tex);
        }

        if (pass.execute) {
            PassContext ctx;
            ctx.width = target.width;
            ctx.height = target.height;
            ctx.inputs = &inputScratch_;
            pass.execute(ctx);
        }
        ++executed_;

        // Recycled after the pass that last read it, which is what lets a linear
        // chain run on two physical targets without anyone arranging it.
        for (auto& res : resources_) {
            if (res.kind == Kind::Transient && res.lastRead == static_cast<i32>(i)) release(res);
        }
    }
}

TextureHandle RenderGraph::textureOf(ResourceId id) const {
    if (id >= resources_.size()) return TextureHandle::Invalid;
    return resources_[id].texture;
}

TextureHandle RenderGraph::depthTextureOf(ResourceId id) const {
    if (id >= resources_.size()) return TextureHandle::Invalid;
    const Resource& res = resources_[id];
    if (res.kind != Kind::Transient || res.pooled == kNoTarget) return TextureHandle::Invalid;
    return pool_.depthTextureOf(res.pooled);
}

void RenderGraph::releasePool() {
    for (auto& res : resources_) {
        res.pooled = kNoTarget;
        if (res.kind == Kind::Transient) res.texture = TextureHandle::Invalid;
    }
    borrowed_.clear();
    pool_.clear();
}

}  // namespace esengine::rg

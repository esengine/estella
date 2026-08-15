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

RenderGraph::RenderGraph(GfxDevice& device) : device_(device) {}

RenderGraph::~RenderGraph() = default;

void RenderGraph::begin(u32 refWidth, u32 refHeight) {
    // Kept, not freed: the vectors' capacity is the whole point of reusing one
    // graph across frames.
    resources_.clear();
    passes_.clear();
    inputScratch_.clear();
    for (auto& entry : pool_) entry.inUse = false;
    finalTarget_ = kNoResource;
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

void RenderGraph::addPass(PassDesc pass) {
    passes_.push_back(std::move(pass));
}

void RenderGraph::resolveSize(Resource& res) const {
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
    }
}

u32 RenderGraph::acquire(const Resource& res) {
    for (u32 i = 0; i < pool_.size(); ++i) {
        PooledTarget& entry = pool_[i];
        if (entry.inUse || !entry.fbo) continue;
        if (entry.width != res.width || entry.height != res.height) continue;
        if (entry.format != res.desc.format || entry.linearFilter != res.desc.linearFilter) continue;
        if (entry.depthStencil != res.desc.depthStencil) continue;
        entry.inUse = true;
        return i;
    }

    FramebufferSpec spec;
    spec.width = res.width;
    spec.height = res.height;
    spec.depthStencil = res.desc.depthStencil;
    spec.linearFilter = res.desc.linearFilter;
    spec.colorFormat = res.desc.format;
    auto fbo = Framebuffer::create(device_, spec);
    if (!fbo) {
        ES_LOG_ERROR("RenderGraph: failed to create a {}x{} target", res.width, res.height);
        return kNoPooled;
    }

    PooledTarget entry;
    entry.fbo = std::move(fbo);
    entry.width = res.width;
    entry.height = res.height;
    entry.format = res.desc.format;
    entry.linearFilter = res.desc.linearFilter;
    entry.depthStencil = res.desc.depthStencil;
    entry.inUse = true;
    pool_.push_back(std::move(entry));
    return static_cast<u32>(pool_.size() - 1);
}

void RenderGraph::release(Resource& res) {
    if (res.pooled == kNoPooled) return;
    pool_[res.pooled].inUse = false;
    res.pooled = kNoPooled;
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
            if (target.pooled == kNoPooled) {
                target.pooled = acquire(target);
                if (target.pooled == kNoPooled) continue;
                target.texture = pool_[target.pooled].fbo->getColorAttachment();
            }
            fbo = pool_[target.pooled].fbo->handle();
        } else {
            fbo = target.target;
        }

        RenderPassDesc rp{};
        rp.target = fbo;
        rp.clearColor = pass.clear;
        if (pass.clear) {
            for (u32 c = 0; c < 4; ++c) rp.clearColorValue[c] = pass.clearColor[c];
        }
        device_.beginRenderPass(rp);
        device_.setViewport(0, 0, target.width, target.height);

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

void RenderGraph::releasePool() {
    for (auto& res : resources_) {
        res.pooled = kNoPooled;
        if (res.kind == Kind::Transient) res.texture = TextureHandle::Invalid;
    }
    pool_.clear();
}

}  // namespace esengine::rg

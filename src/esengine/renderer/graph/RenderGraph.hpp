// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    RenderGraph.hpp
 * @brief   Full-screen passes as a declared graph: what each one reads, what it
 *          writes, and at what size — the graph decides the rest.
 *
 * The chain it replaces was two fixed framebuffers ping-ponged in order, which
 * fixes three things it should not: every pass runs at full resolution, a pass
 * can only read the one before it (plus the scene, wired to a hard-coded unit),
 * and a disabled pass still costs its target. Here a pass names its inputs and
 * its output's SCALE, so a blur chain runs at a quarter size, a composite reads
 * both the blur and the scene, and a pass nothing reaches is never run.
 *
 * Physical targets come from a pool keyed by shape and handed back the moment a
 * resource is last read, so the two-buffer ping-pong is what the allocator does
 * on its own for a linear chain rather than something the caller arranges.
 *
 * The graph does NOT own scene geometry: the scene is rendered into an imported
 * texture by the frame, and the graph runs over it. See PostProcessPipeline.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../rhi/Framebuffer.hpp"
#include "../rhi/GfxEnums.hpp"
#include "TargetPool.hpp"

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace esengine {

class GfxDevice;

namespace rg {

/** Index into the graph's resource table. */
using ResourceId = u32;
constexpr ResourceId kNoResource = static_cast<ResourceId>(-1);

/**
 * @brief Shape of a target the graph allocates.
 *
 * @details Size is a fraction of the graph's reference size rather than pixels:
 *          a half-size blur stays half-size when the window resizes, and the
 *          pool can hand the same physical target to any pass asking for that
 *          fraction.
 *
 *          `width`/`height` name pixels directly instead, for a target whose
 *          texels are its own: a shadow atlas is 2048² because that is how many
 *          its tiling divides, and as a `scale` it would be a different resource
 *          on every monitor. Zero (the default) follows `scale`.
 */
struct TargetDesc {
    f32 scale = 1.0f;
    u32 width = 0;
    u32 height = 0;
    GfxPixelFormat format = GfxPixelFormat::RGBA8;
    bool linearFilter = true;
    bool depthStencil = false;
};

/** What a pass's execute() is told: where it is drawing and what it may read. */
struct PassContext {
    u32 width = 0;
    u32 height = 0;
    /// The pass's declared reads, already bound to units 0..n-1, in order.
    const std::vector<TextureHandle>* inputs = nullptr;

    TextureHandle input(u32 i) const {
        return (inputs && i < inputs->size()) ? (*inputs)[i] : TextureHandle::Invalid;
    }
};

/**
 * @brief One full-screen pass.
 *
 * @details `reads` are bound to texture units in declaration order, so a pass
 *          that wants the scene as its second sampler declares it second — the
 *          wiring is the declaration, not a convention the shader has to know.
 */
struct PassDesc {
    std::string name;
    std::vector<ResourceId> reads;
    ResourceId write = kNoResource;
    bool clear = false;
    f32 clearColor[4] = {0.0f, 0.0f, 0.0f, 1.0f};
    /**
     * @brief The rect of its target this pass draws into. Zero width = all of it.
     *
     * @details Opening a render pass resets the viewport, so a pass that does
     *          not cover its whole target has to carry the rect: a fullscreen
     *          effect always covers its own, a camera's scene covers whatever
     *          slice of a shared target that camera was given.
     */
    u32 viewportX = 0;
    u32 viewportY = 0;
    u32 viewportW = 0;
    u32 viewportH = 0;
    std::function<void(const PassContext&)> execute;
};

/**
 * @brief A frame's full-screen passes, compiled and run.
 *
 * @details One instance is reused across frames: the graph is rebuilt every
 *          frame (cheap — a handful of passes) while the target pool it draws
 *          from persists, which is what makes reuse possible at all.
 *
 *          The pool is BORROWED, not owned: a graph is one chain and a frame
 *          holds several (per camera, plus the screen stack), so a pool inside
 *          the graph could hold nothing across two of them. Given one, every
 *          chain draws from the same targets, and so can a frame-lived resource.
 */
class RenderGraph {
public:
    /** Borrows the caller's pool: a frame's chains share one. */
    RenderGraph(GfxDevice& device, TargetPool& pool);
    /** Owns a pool of its own — for a lone chain and for tests. */
    explicit RenderGraph(GfxDevice& device);
    ~RenderGraph();

    RenderGraph(const RenderGraph&) = delete;
    RenderGraph& operator=(const RenderGraph&) = delete;

    /** Starts a new graph. `refWidth`/`refHeight` are what `scale` is a fraction of. */
    void begin(u32 refWidth, u32 refHeight);

    /** A texture the graph reads but does not own — the scene capture. */
    ResourceId importTexture(TextureHandle texture, u32 width, u32 height);

    /**
     * @brief The framebuffer the graph must end in (the screen, an editor FBO).
     *
     * @details Also what culling works back from: a pass no path reaches from
     *          here did not contribute to the image and is dropped.
     */
    ResourceId importTarget(FramebufferHandle target, u32 width, u32 height);

    /** A target the graph allocates from the pool and recycles after its last read. */
    ResourceId createTarget(const TargetDesc& desc);

    /**
     * @brief A pooled target filled by a producer OUTSIDE any pass callback.
     *
     * @details The scene cannot be written from inside execute(): a frame reaches
     *          the host as several calls with the geometry drawn between them, so
     *          its target has to exist first. Pooled and recycled at its last read
     *          like any transient — the exception is WHEN it is filled, not who owns it.
     */
    ResourceId createExternalTarget(const TargetDesc& desc);

    /** The framebuffer behind a resource, for an external target to be drawn into. */
    FramebufferHandle framebufferOf(ResourceId id) const;

    void addPass(PassDesc pass);

    /** Culls, assigns physical targets, and runs what survives. */
    void execute();

    /** The texture behind a resource — valid for imports, and for a transient
     *  only while it holds a physical target. */
    TextureHandle textureOf(ResourceId id) const;

    /** Its depth attachment, for a resource declared with one. Invalid for an
     *  import (the graph did not make it) and for a target without depth. */
    TextureHandle depthTextureOf(ResourceId id) const;

    /** Drops every pooled target. For shutdown and for device loss, after which
     *  the handles the pool holds name nothing. */
    void releasePool();

    /** The targets this graph draws from — shared with the frame's other chains
     *  when one was given, its own otherwise. */
    TargetPool& pool() { return pool_; }

    /** How many physical targets the pool is holding. Diagnostics and tests. */
    u32 pooledTargetCount() const { return pool_.count(); }

    /** What those targets cost in GPU memory, so the number a budget reads is
     *  bytes rather than a count of things with no common size. */
    u64 pooledTargetBytes() const { return pool_.bytes(); }

    /** Passes the last execute() ran, after culling. Diagnostics and tests. */
    u32 lastExecutedPassCount() const { return executed_; }

private:
    enum class Kind : u8 { ImportedTexture, ImportedTarget, Transient };

    struct Resource {
        Kind kind = Kind::Transient;
        TargetDesc desc;
        TextureHandle texture = TextureHandle::Invalid;
        FramebufferHandle target = FramebufferHandle::Default;
        u32 width = 0;
        u32 height = 0;
        /// The pool target a transient holds; kNoTarget when it holds none.
        TargetHandle pooled = kNoTarget;
        i32 lastRead = -1;
    };


    void resolveSize(Resource& res) const;
    TargetHandle acquire(const Resource& res);
    void release(Resource& res);
    /// Marks the passes that reach the imported target; false for everything else.
    void cull(std::vector<bool>& live) const;

    GfxDevice& device_;
    /// Set only by the pool-owning constructor; pool_ refers into it.
    Unique<TargetPool> ownedPool_;
    TargetPool& pool_;
    std::vector<Resource> resources_;
    std::vector<PassDesc> passes_;
    /// What this graph has borrowed and still owes back, released at the next
    /// begin() — a transient nothing reads is never released mid-execute, and
    /// the pool is no longer the graph's to reset wholesale.
    std::vector<TargetHandle> borrowed_;
    std::vector<TextureHandle> inputScratch_;
    ResourceId finalTarget_ = kNoResource;
    u32 refWidth_ = 0;
    u32 refHeight_ = 0;
    u32 executed_ = 0;
};

}  // namespace rg
}  // namespace esengine

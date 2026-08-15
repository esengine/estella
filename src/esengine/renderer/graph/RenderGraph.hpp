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

#include <functional>
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
 */
struct TargetDesc {
    f32 scale = 1.0f;
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
    std::function<void(const PassContext&)> execute;
};

/**
 * @brief A frame's full-screen passes, compiled and run.
 *
 * @details One instance is reused across frames: the graph is rebuilt every
 *          frame (cheap — a handful of passes) while the target pool it draws
 *          from persists, which is what makes reuse possible at all.
 */
class RenderGraph {
public:
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

    void addPass(PassDesc pass);

    /** Culls, assigns physical targets, and runs what survives. */
    void execute();

    /** The texture behind a resource — valid for imports, and for a transient
     *  only while it holds a physical target. */
    TextureHandle textureOf(ResourceId id) const;

    /** Drops every pooled target. For shutdown and for device loss, after which
     *  the handles the pool holds name nothing. */
    void releasePool();

    /** How many physical targets the pool is holding. Diagnostics and tests. */
    u32 pooledTargetCount() const { return static_cast<u32>(pool_.size()); }

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
        /// Index into pool_ while a transient holds one; kNoPooled otherwise.
        u32 pooled = kNoPooled;
        i32 lastRead = -1;
    };

    struct PooledTarget {
        Unique<Framebuffer> fbo;
        u32 width = 0;
        u32 height = 0;
        GfxPixelFormat format = GfxPixelFormat::RGBA8;
        bool linearFilter = true;
        bool depthStencil = false;
        bool inUse = false;
    };

    static constexpr u32 kNoPooled = static_cast<u32>(-1);

    void resolveSize(Resource& res) const;
    u32 acquire(const Resource& res);
    void release(Resource& res);
    /// Marks the passes that reach the imported target; false for everything else.
    void cull(std::vector<bool>& live) const;

    GfxDevice& device_;
    std::vector<Resource> resources_;
    std::vector<PassDesc> passes_;
    std::vector<PooledTarget> pool_;
    std::vector<TextureHandle> inputScratch_;
    ResourceId finalTarget_ = kNoResource;
    u32 refWidth_ = 0;
    u32 refHeight_ = 0;
    u32 executed_ = 0;
};

}  // namespace rg
}  // namespace esengine

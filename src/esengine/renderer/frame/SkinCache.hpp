// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SkinCache.hpp
 * @brief   Skinned meshes posed once a frame by a compute shader, into vertices every pass then draws as they are.
 *
 * @details Without it a skinned mesh is posed in the vertex stage of every draw of it: each shadow cascade, the depth prepass,
 *          the colour pass. With it a compute shader poses the mesh once, before the frame's passes, into a copy of its own
 *          vertices in which the position, the normal and the tangent are rewritten in world space; every pass then draws that
 *          copy as unskinned geometry, so any program a static mesh has draws it, a material's included, and a skin of any
 *          number of bones is one draw. A device without compute (WebGL2) poses in the vertex stage as before.
 *
 *          The project decides which meshes go through it (SkinCacheSettings: on or off, every mesh unless it opts out or none
 *          unless it opts in) and how much memory it may hold; a mesh's own MeshSkin says Auto, Disabled or Enabled. Meshes
 *          enter first come, first served, and one that would take the cache past its budget is posed in the vertex stage.
 *          The motion pass still poses in the vertex stage: it needs last frame's pose beside this one.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../ecs/Entity.hpp"
#include "../../math/Math.hpp"
#include "../rhi/GfxEnums.hpp"

#include <memory>
#include <unordered_map>
#include <vector>

namespace esengine {

class GfxDevice;
class Mesh;

/** @brief Which skinned meshes go through the cache when their own MeshSkin says Auto. */
enum class SkinCacheBehavior : u8 {
    /** Every one, unless it says Disabled. */
    Inclusive = 0,
    /** None, unless it says Enabled. */
    Exclusive = 1,
};

/** @brief A mesh's own word on the cache (MeshSkin::skinCache). */
enum class SkinCacheUsage : u8 { Auto = 0, Disabled = 1, Enabled = 2 };

/** @brief The project's skin cache settings. */
struct SkinCacheSettings {
    bool enabled = true;
    SkinCacheBehavior behavior = SkinCacheBehavior::Inclusive;
    /** What the cache may hold per world, in megabytes: the posed copies and what they are posed from. */
    f32 maxMegabytes = 128.0f;
};

class SkinCache {
public:
    explicit SkinCache(GfxDevice& device);
    ~SkinCache();
    SkinCache(const SkinCache&) = delete;
    SkinCache& operator=(const SkinCache&) = delete;

    void setSettings(const SkinCacheSettings& settings) { settings_ = settings; }
    const SkinCacheSettings& settings() const { return settings_; }

    /** Whether anything can go through it: the project turned it on and the device computes. */
    bool active() const;

    /** Whether a mesh whose MeshSkin says @p usage goes through it, by the settings. */
    bool wants(SkinCacheUsage usage) const;

    /** Opens a frame's schedule. An entry no frame has asked for in a while is released. */
    void beginFrame(u64 frame);

    /**
     * @brief Schedules @p entity's skin for this frame, posed by @p pose (one matrix a joint: joint world times inverse bind).
     * @return The buffer its draws read this frame, or Invalid where it is posed in the vertex stage instead: the cache is
     *         not active, the mesh carries no source, or it would take the cache past its budget.
     */
    BufferHandle schedule(Entity entity, const Mesh& mesh, const glm::mat4* pose, u32 joints);

    /** The buffer @p entity's draws read this frame; Invalid when it was not scheduled this frame. */
    BufferHandle bufferFor(Entity entity) const;

    /** Whether this frame scheduled anything to pose. */
    bool hasWork() const { return scheduled_ > 0; }

    /** Uploads this frame's poses and dispatches the kernel for each. Outside a render pass. */
    void run();

    u64 bytesUsed() const { return bytes_; }
    u32 entryCount() const { return static_cast<u32>(entries_.size()); }
    /** Meshes this frame that wanted the cache and were refused by the budget. */
    u32 refusedThisFrame() const { return refused_; }
    /** Meshes this frame posed by the cache. */
    u32 scheduledThisFrame() const { return scheduled_; }
    /** A draw this frame read a posed copy instead of posing its mesh itself. */
    void noteDraw() { ++drawn_; }
    u32 drawsThisFrame() const { return drawn_; }

private:
    struct Entry {
        u64 meshRevision = 0;
        std::shared_ptr<const std::vector<u8>> source;
        BufferHandle sourceBuffer = BufferHandle::Invalid;
        BufferHandle output = BufferHandle::Invalid;
        BufferHandle boneBase = BufferHandle::Invalid;
        BufferHandle bones = BufferHandle::Invalid;
        BufferHandle pose = BufferHandle::Invalid;
        BufferHandle params = BufferHandle::Invalid;
        u32 poseCapacity = 0;
        u32 vertexCount = 0;
        u64 bytes = 0;
        u64 lastFrame = 0;
        bool scheduled = false;
        std::vector<glm::mat4> pendingPose;
    };

    bool build(Entry& entry, const Mesh& mesh);
    void release(Entry& entry);

    GfxDevice& device_;
    SkinCacheSettings settings_;
    std::unordered_map<u32, Entry> entries_;
    ComputeHandle kernel_ = ComputeHandle::Invalid;
    bool kernelFailed_ = false;
    u64 frame_ = 0;
    u64 bytes_ = 0;
    u32 scheduled_ = 0;
    u32 refused_ = 0;
    u32 drawn_ = 0;
};

}  // namespace esengine

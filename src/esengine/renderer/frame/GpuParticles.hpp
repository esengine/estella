// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GpuParticles.hpp
 * @brief   Particles simulated by a compute kernel, drawn from the buffer the kernel wrote (WebGPU).
 *
 * @details An emitter that asks for it keeps its particles in a ring of GPU slots: a state buffer the kernel advances and an
 *          instance buffer it writes in the layout the particle draw already reads. The CPU decides only how many are born
 *          and how long the step is, so what costs a CPU emitter per particle per frame costs this one a dispatch: hundreds
 *          of thousands of particles are an ordinary emitter. Nothing is read back; the draw binds the instance buffer as it
 *          lies, which is why a storage buffer here is also a vertex buffer.
 *
 *          One compute pass per frame, declared into the render graph ahead of the scene pass it feeds. It carries every
 *          emitter the frame's collect asked to step, each with its own block of parameters.
 *
 *          It can collide with what the camera last saw (the depth a frame leaves is copied where next frame's kernel can read
 *          it, with the view it was seen by) and with the distance functions of ParticleCollider. It can tell other kernels:
 *          what an emitter fires is appended to a buffer, and a child emitter's kernel spawns from it with no trip to the CPU.
 *
 *          What it is not: the particles are not sorted (an additive or cut-out look is exact, a deep alpha-blended pile
 *          draws in slot order), and a scene query is not something a kernel can ask. Where the device cannot compute,
 *          ParticleSystem simulates the same emitter on the CPU, capped.
 */
#pragma once

#include "../../core/Types.hpp"

#include "../graph/RenderGraph.hpp"
#include "../rhi/GfxEnums.hpp"
#include "../../math/Math.hpp"

#include <unordered_map>
#include <vector>

namespace esengine {

class GfxDevice;

namespace ecs { struct ParticleEmitter; struct Transform; }
namespace particle { class ParticleSystem; struct GpuStep; }

class GpuParticles {
public:
    explicit GpuParticles(GfxDevice& device);
    ~GpuParticles();

    GpuParticles(const GpuParticles&) = delete;
    GpuParticles& operator=(const GpuParticles&) = delete;

    /// Whether the device can run the kernel at all.
    bool available() const;

    /// A new frame: the previous frame's jobs are gone, and a slot nobody asked for in a while is given back.
    void beginFrame();

    /**
     * @brief Queues the step an emitter needs and says where its particles are. The step is committed to the emitter only
     *        once the kernel has run it; an emitter already queued this frame is not queued twice.
     * @param drawCount How many slots may hold a live particle once the step has run.
     * @param eye Where the frame is seen from, as FrameConstants::camera has it: what a trail's quads are turned to face.
     * @param instances The buffer to draw them from.
     * @param segments The buffer to draw its trails from, and how many; untouched where it has none.
     * @return false when there is nothing to draw (no compute, no memory).
     */
    bool submit(Entity entity, const ecs::ParticleEmitter& emitter, const ecs::Transform& transform,
                particle::ParticleSystem& system, const particle::GpuStep& step, const glm::vec4& eye,
                BufferHandle& instances, BufferHandle& segments, u32& segmentCount);

    /// An emitter collided with the depth last frame, so the scene must draw into a target whose depth can be read.
    bool wantsDepth() const { return wantsDepth_; }

    /// Copies the scene's depth for next frame's kernel, once a frame. @p clip is the view that drew it, in the device's clip range.
    void declareDepthCopy(rg::RenderGraph& graph, rg::ResourceId scene, u32 sceneW, u32 sceneH, const glm::mat4& clip);

    /// Adds the compute pass for what was submitted. The resource it writes must be named by the pass that draws the result.
    rg::ResourceId declare(rg::RenderGraph& graph);

    void release();

    /// Slots live right now, for the stats.
    u32 slotCount() const { return static_cast<u32>(slots_.size()); }
    u32 lastDispatches() const { return lastDispatches_; }
    /// Particle slots handed to a draw this frame, over every emitter and camera: what the GPU is asked to draw.
    u32 drawnSlots() const { return drawn_; }

private:
    struct Slot {
        BufferHandle state = BufferHandle::Invalid;
        BufferHandle instances = BufferHandle::Invalid;
        BufferHandle events = BufferHandle::Invalid;
        BufferHandle trail = BufferHandle::Invalid;
        BufferHandle segments = BufferHandle::Invalid;
        u32 capacity = 0;
        u32 eventBytes = 0;
        u32 trailPoints = 0;
        u64 lastUsed = 0;
        ReadbackHandle readback = ReadbackHandle::Invalid;
        u32 readbackBytes = 0;
        u32 collisionMode = 0;
        particle::ParticleSystem* system = nullptr;
    };
    struct Job;

    bool ensureKernel();
    bool ensureEventKernels();
    void ensureEmpties();
    void pollReadbacks();
    Slot* ensureSlot(Entity entity, u32 capacity);
    void freeSlot(Slot& slot);
    void run();

    GfxDevice& device_;
    ComputeHandle kernel_ = ComputeHandle::Invalid;
    ComputeHandle beginEvents_ = ComputeHandle::Invalid;
    ComputeHandle finishEvents_ = ComputeHandle::Invalid;
    ComputeHandle depthCopy_ = ComputeHandle::Invalid;
    BufferHandle params_ = BufferHandle::Invalid;
    u32 paramsCapacity_ = 0;
    BufferHandle control_ = BufferHandle::Invalid;
    u32 controlCapacity_ = 0;
    BufferHandle emptyRead_ = BufferHandle::Invalid;
    BufferHandle emptyEvents_ = BufferHandle::Invalid;
    BufferHandle emptyTrail_ = BufferHandle::Invalid;
    BufferHandle emptySegments_ = BufferHandle::Invalid;
    BufferHandle colliders_ = BufferHandle::Invalid;
    u32 collidersCapacity_ = 0;
    BufferHandle depthGrid_ = BufferHandle::Invalid;
    BufferHandle depthParams_ = BufferHandle::Invalid;
    u32 depthW_ = 0, depthH_ = 0;
    bool depthValid_ = false;
    bool depthCopied_ = false;
    bool wantsDepth_ = false;
    bool wantsDepthNext_ = false;
    glm::mat4 depthClip_{1.0f};
    glm::mat4 depthWorld_{1.0f};
    glm::vec3 depthOrigin_{0.0f};
    bool failed_ = false;
    u64 frame_ = 0;
    u32 lastDispatches_ = 0;
    u32 drawn_ = 0;
    std::unordered_map<u32, Slot> slots_;
    std::vector<Job> jobs_;
};

}  // namespace esengine

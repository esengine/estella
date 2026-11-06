// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    VoxelGI.hpp
 * @brief   Diffuse global illumination from a world-space voxel cache, run as compute passes (WebGPU).
 *
 * @details What a frame can see of the scene, remembered in the world. A grid of voxels follows the camera (addressed
 *          toroidally, so it does not move with it): every frame the lit picture is injected into the voxels its visible
 *          surfaces stand in — their average radiance and the way they face — and what was there before fades. Light then
 *          is gathered the way a path tracer would, but through the grid: from each visible surface a few cosine-weighted
 *          rays are marched cell by cell (a DDA walk), and where one meets a voxel that faces it, that voxel's radiance is
 *          the light it brings. Because the grid keeps what it has seen, a red wall that has left the screen still tints the
 *          floor beside it, and a surface lit only by another is lit — which a screen-space pass cannot do.
 *
 *          It is not a trace of the scene's geometry: the grid holds the surfaces the camera has seen, at the voxel's size,
 *          so a surface it has not seen sends no light and a thin one is as thick as a cell. That is the price of needing no
 *          mesh voxelization, and the reason the result is called what it is.
 *
 *          Four compute passes per frame, declared into the frame's render graph: maintain (age the grid, hand cells that
 *          moved into the window back as empty), inject (the picture into the grid), gather (rays through the grid, at a
 *          fraction of the picture's size) and apply (the gathered light over the picture, upsampled with the depth).
 *          Needs a device with a compute stage; elsewhere the pass is left out of the chain.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../graph/RenderGraph.hpp"
#include "../rhi/GfxEnums.hpp"

#include <glm/glm.hpp>
#include <string>
#include <unordered_map>

namespace esengine {

class GfxDevice;
class RenderContext;

/** What the effect is asked for, from the pass's uniforms. */
struct VoxelGIParams {
    /// How much of the gathered light is added over the picture.
    f32 intensity = 1.0f;
    /// Rays per surface point.
    u32 rays = 8;
    /// World size of one voxel.
    f32 voxelSize = 40.0f;
    /// How far a ray looks, in voxels.
    f32 range = 48.0f;
    /// The brightest a surface is taken to give out, so one lamp does not light the street from a single pixel.
    f32 maxBounce = 3.0f;
    /// What the grid keeps each frame of what it held: 0 forgets at once, 1 never.
    f32 decay = 0.93f;
    /// How far off its own voxel a ray starts, in voxels, so a surface is not lit by itself.
    f32 bias = 1.2f;
    /// The gather runs at 1 / this of the picture's size per axis.
    u32 divisor = 2;
    /// 1 shows the gathered light alone.
    f32 debug = 0.0f;
    /// How much of each frame's gather goes into the picture the next frame builds on (the rest is what the last frames agreed on).
    f32 blend = 0.2f;
    /// The albedo a surface the sun lights is taken to have where the camera does not see it (the shadow map holds no colour);
    /// 0 leaves the sun out of the cache, which then knows only what the picture shows.
    f32 sunAlbedo = 0.6f;
    /// How much of the light the last gather found on a surface it gives off again (the bounces after the first): 0 is one bounce.
    f32 bounceFeedback = 1.0f;
};

class VoxelGI {
public:
    VoxelGI(GfxDevice& device, RenderContext& context);
    ~VoxelGI();

    VoxelGI(const VoxelGI&) = delete;
    VoxelGI& operator=(const VoxelGI&) = delete;

    /**
     * @brief Declares the four passes onto @p graph, reading @p input and the scene's depth and G-buffer.
     * @param scene The scene's resource, kept alive through the passes (they read its depth and G-buffer).
     * @return The resource holding @p input with the gathered light added; @p input itself when there is nothing to do.
     */
    rg::ResourceId declare(rg::RenderGraph& graph, rg::ResourceId input, rg::ResourceId scene, const VoxelGIParams& params,
                           u32 width, u32 height, TextureHandle shadowAtlas = TextureHandle::Invalid,
                           rg::ResourceId shadowResource = rg::kNoResource);

    /** Samples a side of each sun shadow tile the sun kernel reads back into the grid. */
    static constexpr u32 kSunSamples = 256;

    /** Frees the device objects (the grid, the programs). */
    void release();

    /** The grid's size in voxels per axis: the window the cache covers is this many voxels across. */
    static constexpr u32 kDimsX = 128;
    static constexpr u32 kDimsY = 64;
    static constexpr u32 kDimsZ = 128;
    static_assert((kDimsX & (kDimsX - 1)) == 0 && (kDimsY & (kDimsY - 1)) == 0 && (kDimsZ & (kDimsZ - 1)) == 0,
                  "the kernels wrap a cell into the grid with a mask");

private:
    struct Programs;
    bool ensure();
    /// The two pictures the gathers accumulate into, made again when their size changes.
    bool ensureHistory(u32 width, u32 height);
    void writeParams(const VoxelGIParams& p);
    /// Fills the sun block from the frame lights; the number of shadow tiles it carries, 0 when there is no sun with a map.
    u32 writeSun(const VoxelGIParams& p);

    GfxDevice& device_;
    RenderContext& context_;
    BufferHandle grid_ = BufferHandle::Invalid;
    BufferHandle tags_ = BufferHandle::Invalid;
    BufferHandle params_ = BufferHandle::Invalid;
    BufferHandle sun_ = BufferHandle::Invalid;
    ComputeHandle maintain_ = ComputeHandle::Invalid;
    ComputeHandle inject_ = ComputeHandle::Invalid;
    ComputeHandle gather_ = ComputeHandle::Invalid;
    ComputeHandle apply_ = ComputeHandle::Invalid;
    ComputeHandle sunInject_ = ComputeHandle::Invalid;
    bool failed_ = false;
    u32 frame_ = 0;
    TextureHandle history_[2] = {TextureHandle::Invalid, TextureHandle::Invalid};
    u32 historyWidth_ = 0;
    u32 historyHeight_ = 0;
    /// Whether the picture the other one holds is a gather of the view the last frame saw, to blend with.
    bool historyValid_ = false;
    f32 previousViewProjection_[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    /// The render origin that view-projection was made for.
    glm::dvec3 previousOrigin_{0.0};
    f32 previousVoxelSize_ = 0.0f;
    /// The window's origin, in cells, as of the frame being drawn.
    i32 origin_[3] = {0, 0, 0};
};

}  // namespace esengine

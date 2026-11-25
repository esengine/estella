// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DynamicGI.hpp
 * @brief   Diffuse global illumination from the scene's distance field and surface cache, run as compute passes (WebGPU).
 *
 * @details The design is docs/GI_LUMEN_DESIGN.md and the CPU reference is sdk/src/gi (globalSdf, surfaceCache, screenProbes), checked against
 *          Cycles in pipeline/tests/gi-lab.test.ts. This is the GPU form of that reference.
 *
 *          What the scene is comes from script: the SDK composes the scene's distance field and lays out its surface cards, and hands
 *          them over through `setScene` (the bindings' gi_setScene) whenever they change. The engine keeps them in storage buffers and
 *          runs three passes a frame:
 *            card light   every card pixel: the sun (shadowed by a ray through the field) plus the light 64 rays bring from the other
 *                         cards, times its albedo, plus what it emits. Run every frame, it converges on many bounces.
 *            probe        one probe per 8 x 8 pixels of the picture: 64 rays from the surface there through the field into the cards,
 *                         reduced to the vector that integrates them against any normal (see kProbe).
 *            apply        every pixel takes the light of the four probes around it, weighted by depth and normal, times its albedo.
 *          Needs a device with a compute stage; elsewhere the pass is left out of the chain, as the voxel GI is.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../graph/RenderGraph.hpp"
#include "../rhi/GfxEnums.hpp"

#include <glm/glm.hpp>

namespace esengine {

class GfxDevice;
class RenderContext;

/** What the effect is asked for, from the pass's uniforms. */
struct DynamicGIParams {
    /// How much of the gathered light is added over the picture.
    f32 intensity = 1.0f;
    /// How much of each frame's card lighting replaces what the card held (the rest is history, which is what smooths the noise).
    f32 blend = 0.15f;
    /// The cards are relit a slice at a time over this many frames (their light changes slowly; the cost is in proportion).
    u32 cardSlices = 4;
    /// One in this many of a probe rays is traced each frame, alternating, so the history fills the rest in.
    u32 probeStride = 2;
    /// For measuring: skip the cards (1), the probes (2) or the apply (4), to read what the rest of the frame costs.
    u32 skip = 0;
    /// Pixels between probes: 0 picks about 160 x 90 probes whatever the picture size.
    u32 probeSpacing = 0;
    /// The probes are asked by one pixel in four and the rest take the light of the four round them: about half the reads of a pixel, for
    /// light that runs a pixel or two across an edge two surfaces share. What a quality level below the highest runs.
    bool halfRes = false;
    /// How many of the rows of probes the picture would have are kept, 0.25 to 1 (it acts where `probeSpacing` is 0).
    f32 probeDensity = 1.0f;
    u32 probeRows = 90;
};

class DynamicGI {
public:
    DynamicGI(GfxDevice& device, RenderContext& context);
    ~DynamicGI();

    DynamicGI(const DynamicGI&) = delete;
    DynamicGI& operator=(const DynamicGI&) = delete;

    /** Declares the passes onto @p graph; returns the picture with the light added, or @p input when there is nothing to do. */
    rg::ResourceId declare(rg::RenderGraph& graph, rg::ResourceId input, rg::ResourceId scene, const DynamicGIParams& params, u32 width, u32 height);

    void release();

private:
    bool ensure();
    bool upload();
    bool ensureProbes(u32 tilesX, u32 tilesY);

    GfxDevice& device_;
    RenderContext& context_;
    BufferHandle params_ = BufferHandle::Invalid;
    BufferHandle sdf_ = BufferHandle::Invalid;
    BufferHandle instances_ = BufferHandle::Invalid;
    BufferHandle pixels_ = BufferHandle::Invalid;
    BufferHandle radiance_[2] = {BufferHandle::Invalid, BufferHandle::Invalid};
    u32 sdfBytes_ = 0, instanceBytes_ = 0, pixelBytes_ = 0, radianceBytes_ = 0;
    TextureHandle probes_[2] = {TextureHandle::Invalid, TextureHandle::Invalid};
    /// Where each probe stands and faces (two full-float texels a probe), written by the probe pass and read by the apply.
    TextureHandle probeGeo_ = TextureHandle::Invalid;
    u32 probeTilesX_ = 0, probeTilesY_ = 0;
    ComputeHandle cardLight_ = ComputeHandle::Invalid;
    ComputeHandle probe_ = ComputeHandle::Invalid;
    ComputeHandle apply_ = ComputeHandle::Invalid;
    ComputeHandle gather_ = ComputeHandle::Invalid;
    ComputeHandle composite_ = ComputeHandle::Invalid;
    u32 uploadedVersion_ = 0;
    bool failed_ = false;
    u32 frame_ = 0;
    u32 pixelCount_ = 0;
    /// Pixels between probes, chosen from the height of the picture.
    u32 probeSpacing_ = 8;
};

}  // namespace esengine

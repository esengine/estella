// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include <vector>

namespace esengine {

/**
 * The scene as the SDK lays it out. All of it is plain numbers; the layouts are in DynamicGI.cpp (kLayout) and sdk/src/gi/gpuScene.ts.
 */
struct DynamicGIScene {
    /// Header: sdf dim, cell size, origin x y z (cells), reach, instance count, card pixel count, sun (toLight xyz, on), sun radiance rgb, bias, range, tolerance, sky rgb.
    std::vector<f32> header;
    /// The distance field, dim^3 cells, toroidal.
    std::vector<f32> sdf;
    /// 80 floats an instance.
    std::vector<f32> instances;
    /// 4 words a card pixel.
    std::vector<u32> pixels;
    u32 version = 0;
    /// What changed since the GPU copy was made: everything (a whole scene was set), or only the floats [dirtyBegin, dirtyEnd) of the field and the header
    /// (a camera moved; the cards and their light are the same, and are not touched).
    bool full = true;
    u32 dirtyBegin = 0, dirtyEnd = 0;
};

/**
 * What the last frame's passes were asked to do, counted where they are dispatched. The cost of the effect is these numbers times what a
 * ray, a texel and a byte cost on a device, and only the first factor is the engine's: a gate (tools/gi/check-gi-cost.mjs) holds them to
 * budgets on any machine, so a change that doubles the rays, or makes every pixel read twice as much, is caught where the GPU is fast.
 */
struct DynamicGIStats {
    f32 width = 0, height = 0;
    /// Pixels between probes, and how many probes there are.
    f32 probeSpacing = 0, probes = 0;
    /// Rays traced this frame by the probes (a probe has 64, one in `stride` of them a frame) and by the cards.
    f32 probeRays = 0, cardPixels = 0, cardPixelsRelit = 0, cardRays = 0;
    /// Pixels the apply pass visits, and the texture reads it makes of each (the four nearest probes; twelve more only where those fail).
    f32 applyPixels = 0, applyLoadsPerPixel = 0;
    /// What the scene pass writes only because this effect is on: the G-buffer (8 bytes a pixel) and the albedo target (4).
    f32 forcedAttachmentBytes = 0;
    /// What the effect keeps in video memory.
    f32 residentBytes = 0;
    f32 levels = 0, lights = 0, instances = 0, frame = 0;
};
constexpr u32 kDynamicGIStatFloats = 16;

/** Scene input and counters belong to the renderer that received the upload. */
struct DynamicGIState {
    DynamicGIScene scene;
    DynamicGIStats stats;

    void clear() {
        const u32 nextVersion = scene.version + 1;
        scene = {};
        scene.version = nextVersion;
        stats = {};
    }
};

}  // namespace esengine

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Shot.cpp
 * @brief   The frame capture and its verdict. See Shot.hpp for what and why.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Shot.hpp"

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "Runtime.hpp"   // ESHOST_LOGI / ESHOST_LOGE
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"

namespace eshost {

using esengine::u32;
using esengine::u64;
using esengine::u8;

namespace {

/** The capture in flight, and what it is for. */
struct ShotState {
    bool asked = false;
    bool started = false;
    bool done = false;
    u64 atFrame = 60;
    bool quitAfter = false;
    std::string outPath;
    esengine::ReadbackHandle handle = esengine::ReadbackHandle::Invalid;
    u32 width = 0;
    u32 height = 0;
};

ShotState& state() {
    static ShotState s = [] {
        ShotState init;
        const char* out = std::getenv("ESTELLA_SHOT");
        const char* at = std::getenv("ESTELLA_SHOT_FRAME");
        const char* quit = std::getenv("ESTELLA_SHOT_QUIT");
        // The frame number alone is enough to ask for a capture: the verdict is the
        // point, and the file is only there for a human to look at afterwards.
        init.asked = (out && out[0]) || (at && at[0]);
        if (out) init.outPath = out;
        if (at && at[0]) {
            const long n = std::strtol(at, nullptr, 10);
            if (n > 0) init.atFrame = static_cast<u64>(n);
        }
        init.quitAfter = quit && quit[0] == '1';
        return init;
    }();
    return s;
}

/**
 * The verdict, computed exactly as the web render checks compute it.
 *
 * `spread` is the sum of each channel's max-minus-min over the frame; above 16
 * counts as drawn. A frame cleared to one colour spreads zero however bright it
 * is, which is the case that matters: rendering nothing still presents a clear.
 */
void logVerdict(const std::vector<u8>& rgba, u32 w, u32 h, bool bgra) {
    int lo[3] = {255, 255, 255};
    int hi[3] = {0, 0, 0};
    u64 nonZero = 0;
    for (size_t i = 0; i + 3 < rgba.size(); i += 4) {
        for (int k = 0; k < 3; ++k) {
            const int v = rgba[i + k];
            if (v < lo[k]) lo[k] = v;
            if (v > hi[k]) hi[k] = v;
        }
        if (rgba[i] | rgba[i + 1] | rgba[i + 2]) ++nonZero;
    }
    // Report in RGB order whatever the surface's byte order is, so the numbers mean
    // the same thing on Metal (BGRA) and Vulkan (RGBA).
    const int r = bgra ? 2 : 0, b = bgra ? 0 : 2;
    const int spread = (hi[r] - lo[r]) + (hi[1] - lo[1]) + (hi[b] - lo[b]);
    const u64 total = static_cast<u64>(w) * h;
    ESHOST_LOGI("shot verdict: {\"w\":%u,\"h\":%u,\"totalPixels\":%llu,\"nonZeroPixels\":%llu,"
                "\"min\":[%d,%d,%d],\"max\":[%d,%d,%d],\"spread\":%d,\"rendered\":%s}",
                w, h, (unsigned long long)total, (unsigned long long)nonZero,
                lo[r], lo[1], lo[b], hi[r], hi[1], hi[b], spread, spread > 16 ? "true" : "false");
}

}  // namespace

bool shotWanted() { return state().asked; }

void shotBeforeFrame(esengine::WebGPUDevice& gfx, u64 frame, u32 w, u32 h) {
    ShotState& s = state();
    if (!s.asked || s.started || s.done || frame < s.atFrame || w == 0 || h == 0) return;
    s.started = true;
    s.width = w;
    s.height = h;
    // Booked, not taken: the copy happens inside the renderer's endFrame, which is
    // the only point at which this frame is both finished and still ours.
    s.handle = gfx.captureNextFrame(w, h);
    if (s.handle == esengine::ReadbackHandle::Invalid) {
        ESHOST_LOGE("shot: the swapchain cannot be captured — see the WebGPU error above");
        s.done = true;
    }
}

bool shotAfterPresent(esengine::WebGPUDevice& gfx) {
    ShotState& s = state();
    if (!s.started || s.done) return false;

    const esengine::GfxReadbackStatus status = gfx.pollReadback(s.handle);
    if (status == esengine::GfxReadbackStatus::Pending) return false;
    s.done = true;
    if (status != esengine::GfxReadbackStatus::Ready) {
        ESHOST_LOGE("shot: readback failed");
        return s.quitAfter;
    }

    std::vector<u8> rgba(static_cast<size_t>(s.width) * s.height * 4);
    if (!gfx.takeReadback(s.handle, rgba.data(), rgba.size())) {
        ESHOST_LOGE("shot: takeReadback refused the destination");
        return s.quitAfter;
    }

    logVerdict(rgba, s.width, s.height, gfx.surfaceBytesAreBGRA());

    // Raw bytes, not an image format: the verdict above is what decides anything,
    // and an encoder compiled into every shipped binary to serve a debugging aid
    // is weight for nothing. `tools/shot-to-png.mjs` turns this into a PNG.
    if (!s.outPath.empty()) {
        if (std::FILE* f = std::fopen(s.outPath.c_str(), "wb")) {
            std::fwrite(rgba.data(), 1, rgba.size(), f);
            std::fclose(f);
            ESHOST_LOGI("shot: %ux%u %s bottom-up RGBA -> %s",
                        s.width, s.height, gfx.surfaceBytesAreBGRA() ? "BGRA" : "RGBA",
                        s.outPath.c_str());
        } else {
            ESHOST_LOGE("shot: cannot write %s", s.outPath.c_str());
        }
    }
    return s.quitAfter;
}

}  // namespace eshost

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Shot.hpp
 * @brief   Read one presented frame back out of the GPU and judge it — the native
 *          host's answer to "did it actually draw anything?".
 * @details Counting frames answers nothing: a host that renders nothing at all
 *          still reaches `real-SDK frame 360`. Until now the only evidence a
 *          native frame had pixels in it was a screenshot of a simulator, which
 *          an OS dialog sitting on top of the app quietly turns into a lie.
 *
 *          So the host reads its own swapchain and reports the SAME verdict the
 *          web render checks compute (desktop/scripts/headless-verify.mjs):
 *          min/max per channel, their spread, and `rendered = spread > 16`. One
 *          rule, one threshold — a second one calibrated separately is two
 *          answers to one question.
 *
 *          Driven by the environment, so nothing about a shipped game changes:
 *          - `ESTELLA_SHOT`        raw RGBA output path (optional; the verdict is
 *                                  logged either way). Bottom-up rows, matching
 *                                  GfxDevice::takeReadback.
 *          - `ESTELLA_SHOT_FRAME`  which frame to capture (default 60 — enough
 *                                  for a first scene to have loaded its assets).
 *          - `ESTELLA_SHOT_QUIT`   `1` to exit once the verdict is out, which is
 *                                  what a CI run wants.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "esengine/core/Types.hpp"

namespace esengine { class WebGPUDevice; }

namespace eshost {

/** Whether a capture was asked for. Read at device creation, because the
 *  swapchain has to be configured for copying BEFORE it exists. */
bool shotWanted();

/** Book the capture if @p frame is the one asked for. Call BEFORE the frame is
 *  rendered: the copy itself is performed inside the renderer's endFrame, since
 *  that is the last instant the swapchain image belongs to us. */
void shotBeforeFrame(esengine::WebGPUDevice& gfx, esengine::u64 frame, esengine::u32 w, esengine::u32 h);

/** Resolve an in-flight capture: write it, log the verdict.
 *  @return true when the host was asked to quit and the verdict is out. */
bool shotAfterPresent(esengine::WebGPUDevice& gfx);

}  // namespace eshost

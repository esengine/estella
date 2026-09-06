// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once


#include "../core/Types.hpp"
#include <string>

namespace esengine {

bool postprocess_init(u32 width, u32 height);
void postprocess_shutdown();
void postprocess_resize(u32 width, u32 height);
u32 postprocess_addPass(const std::string& name, u32 shaderHandle);
/** The project's multisampling request for the scene target; 1 = off. Clamped
 *  by what the device supports — the device answers capability, not policy. */
void postprocess_setMsaaSamples(u32 samples);
/// What the scene target is actually multisampled at, and the most this device
/// can do. Separate because a request and a capability are different facts, and
/// only saying both tells a typo from a machine. 0 = nothing here can answer.
u32 postprocess_effectiveMsaaSamples();
u32 postprocess_maxMsaaSamples();

/**
 * @brief The format decision the last frame COMMITTED to, into four floats at
 *        @p outPtr: requested, effective, refusal, linear.
 *
 * @details The frame's own answer, not the capability re-asked. `linear` false is
 *          a project that never asked for HDR, which is not a fallback. Returns 0
 *          before a frame has committed a format.
 */
i32 postprocess_hdrFormat(uintptr_t outPtr);

/** @brief The last committed decision as words: "requested|effective|reason".
 *  Empty before a frame has committed one. The names come from the engine so no
 *  reader has to hold a second spelling of the format enum's order. */
std::string postprocess_hdrFormatNames();
/** Draw a pass at a fraction of the chain size; the next pass upsamples it. */
void postprocess_setPassScale(const std::string& passName, f32 scale);
void postprocess_setUniformFloat(const std::string& passName,
                                  const std::string& uniform, f32 value);
void postprocess_setPassTexture(const std::string& passName,
                                const std::string& uniform, u32 textureHandle);
void postprocess_setUniformVec4(const std::string& passName,
                                 const std::string& uniform,
                                 f32 x, f32 y, f32 z, f32 w);
void postprocess_begin();
void postprocess_end();
bool postprocess_isInitialized();
void postprocess_setBypass(bool bypass);
/** The curve the chain applies on the way out: 0 = none, 1 = ACES filmic. */
void postprocess_setOutputTransform(u32 transform);
void postprocess_clearPasses();
void postprocess_setOutputViewport(u32 x, u32 y, u32 w, u32 h);
/** Say the frame needs a present even when the two rects look alike; see
 *  PostProcessPipeline::setPresentRequired. */
void postprocess_setPresentRequired(bool required);

void postprocess_beginScreenCapture();
void postprocess_endScreenCapture();
void postprocess_executeScreenPasses();
u32 postprocess_addScreenPass(const std::string& name, u32 shaderHandle);
void postprocess_clearScreenPasses();
void postprocess_setScreenUniformFloat(const std::string& passName,
                                        const std::string& uniform, f32 value);
void postprocess_setScreenUniformVec4(const std::string& passName,
                                       const std::string& uniform,
                                       f32 x, f32 y, f32 z, f32 w);

}  // namespace esengine


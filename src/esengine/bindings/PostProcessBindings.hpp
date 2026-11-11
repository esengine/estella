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
/**
 * @brief Adds a pass that is a WGSL compute shader over the picture (see PostProcessPipeline::addComputePass).
 * @param params The names of the f32 params the shader's block holds, in order, comma separated.
 * @details On a device with no compute stage the pass is left out of the chain and the picture goes through as it was.
 */
u32 postprocess_addComputePass(const std::string& name, const std::string& wgsl, const std::string& params,
                               u32 workgroupX, u32 workgroupY);
/** @brief Whether compute passes run on this device: WebGPU yes, WebGL2 no. */
bool postprocess_supportsCompute();
/**
 * @brief Adds a pass the engine implements itself ("voxelGI"); its parameters are set by name like any pass's.
 * @details On a device with no compute stage the pass is left out of the chain and the picture goes through as it was.
 */
u32 postprocess_addNativePass(const std::string& name, const std::string& kind);
/**
 * @brief Hands the dynamic GI the scene it traces: the header, the distance field, the instances and the card pixels, laid out as
 *        sdk/src/gi/gpuScene.ts writes them (see DynamicGI.hpp). The engine copies them; the pointers are free after the call.
 * @return false when a count does not match what the header says.
 */
bool postprocess_setGIScene(uintptr_t headerPtr, u32 headerCount, uintptr_t sdfPtr, u32 sdfCount, uintptr_t instancesPtr, u32 instanceCount,
                            uintptr_t pixelsPtr, u32 pixelCount);
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
/** A later pass of a multi-pass effect: it composites over that effect's input. */
void postprocess_setPassContinuesEffect(const std::string& passName);
/** Draw @p passName once more next frame into a width x height RGBA8 panorama, its `u_skyCapture` param at 1. */
void postprocess_requestSkyCapture(const std::string& passName, u32 width, u32 height);
/** 0 = not yet, 1 = ready to take, 2 = nothing asked for or it failed. Call between frames. */
i32 postprocess_pollSkyCapture();
/** Copies the ready capture (RGBA8, rows bottom-up) to @p dst; false when it does not fit @p bytes or is not ready. */
bool postprocess_takeSkyCapture(uintptr_t dst, u32 bytes);
/** The dynamic GI's last-frame work counters (DynamicGIStats), written as floats to @p dst; returns how many, 0 when @p capacity is short. */
u32 postprocess_giStats(uintptr_t dst, u32 capacity);
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
/** A graded look the last pass applies to the picture as the display shows it: a 1024x32 table (texture handle, 0 for none) and how far, 0 to 1. Let go with the passes. */
void postprocess_setDisplayLut(u32 textureHandle, f32 amount);
/** The editor view's exposure in stops (EV); 0 is exact identity. View state, never saved. */
void postprocess_setViewExposure(f32 ev);
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


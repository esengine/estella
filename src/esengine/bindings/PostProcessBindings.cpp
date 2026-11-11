// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#ifdef ES_ENABLE_POSTPROCESS

#include "PostProcessBindings.hpp"
#include "ActiveContext.hpp"
#include "BoundarySpan.hpp"
#include "../renderer/rhi/GfxDevice.hpp"
#include "../renderer/frame/PostProcessPipeline.hpp"
#include "../renderer/frame/DynamicGI.hpp"
#include "../renderer/frame/RenderContext.hpp"
#include "../renderer/frame/RenderFrame.hpp"
#include "../renderer/draw/ImmediateDraw.hpp"
#include "../renderer/draw/CustomGeometry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"

#include <glm/glm.hpp>
#include <cstring>

namespace esengine {

static EstellaContext& ctx() { return activeCtx(); }

#define g_device (ctx().tryGet<GfxDevice>())
#define g_initialized (ctx().state().initialized)
#define g_renderContext (ctx().tryGet<RenderContext>())
#define g_resourceManager (ctx().tryGet<resource::ResourceManager>())
#define g_postProcessPipeline (ctx().tryGet<PostProcessPipeline>())

bool postprocess_init(u32 width, u32 height) {
    if (!g_initialized || !g_renderContext || !g_resourceManager) return false;

    if (!g_postProcessPipeline) {
        ctx().services().registerOwned<PostProcessPipeline>(
            makeUnique<PostProcessPipeline>(ctx().require<GfxDevice>(), *g_renderContext, *g_resourceManager));
    }

    g_postProcessPipeline->init(width, height);
    g_device->endRenderPass();

    return g_postProcessPipeline->isInitialized();
}

void postprocess_shutdown() {
    if (g_postProcessPipeline) {
        // Tear down the passes/FBOs/blit shader, but KEEP the service registered.
        // The pipeline is owned by RenderFrame (registered as a bare-pointer service
        // and the very object RenderFrame::begin renders through). Unregistering it
        // here orphaned it on a warm re-play: `postprocess_init` then saw no service,
        // built a *separate* owned duplicate, and RenderFrame kept using its own —
        // now permanently un-initialized — pipeline, so `usePostProcess` went false
        // and a linear-space scene rendered without the mandatory linear→sRGB encode
        // (i.e. black). Leaving it registered lets the lazy re-init (_applyForCamera →
        // init → resize) restore the SAME pipeline RenderFrame draws with.
        g_postProcessPipeline->shutdown();
    }
}

void postprocess_resize(u32 width, u32 height) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->resize(width, height);
    }
}

u32 postprocess_addPass(const std::string& name, u32 shaderHandle) {
    if (!g_postProcessPipeline) return 0;
    return g_postProcessPipeline->addPass(name, resource::ShaderHandle(shaderHandle));
}

u32 postprocess_addComputePass(const std::string& name, const std::string& wgsl, const std::string& params,
                               u32 workgroupX, u32 workgroupY) {
    if (!g_postProcessPipeline) return 0;
    std::vector<std::string> names;
    usize start = 0;
    while (start <= params.size() && !params.empty()) {
        const usize comma = params.find(',', start);
        const usize end = comma == std::string::npos ? params.size() : comma;
        if (end > start) names.push_back(params.substr(start, end - start));
        if (comma == std::string::npos) break;
        start = comma + 1;
    }
    return g_postProcessPipeline->addComputePass(name, wgsl, names, workgroupX, workgroupY);
}

u32 postprocess_addNativePass(const std::string& name, const std::string& kind) {
    if (!g_postProcessPipeline) return 0;
    return g_postProcessPipeline->addNativePass(name, kind);
}

bool postprocess_setGIScene(uintptr_t headerPtr, u32 headerCount, uintptr_t sdfPtr, u32 sdfCount, uintptr_t instancesPtr, u32 instanceCount,
                            uintptr_t pixelsPtr, u32 pixelCount) {
    const f32* header = boundarySpan<f32>(headerPtr, headerCount, "postprocess_setGIScene.header");
    const f32* sdf = boundarySpan<f32>(sdfPtr, sdfCount, "postprocess_setGIScene.sdf");
    const f32* instances = boundarySpan<f32>(instancesPtr, instanceCount, "postprocess_setGIScene.instances");
    const u32* pixels = boundarySpan<u32>(pixelsPtr, pixelCount, "postprocess_setGIScene.pixels");
    if (!header || !sdf || !instances || !pixels || headerCount < 22) return false;
    DynamicGIScene& scene = dynamicGIScene();
    scene.header.assign(header, header + headerCount);
    scene.sdf.assign(sdf, sdf + sdfCount);
    scene.instances.assign(instances, instances + instanceCount);
    scene.pixels.assign(pixels, pixels + pixelCount);
    scene.full = true;
    ++scene.version;
    return true;
}

bool postprocess_updateGIField(uintptr_t headerPtr, u32 headerCount, uintptr_t sdfPtr, u32 sdfOffset, u32 sdfCount) {
    DynamicGIScene& scene = dynamicGIScene();
    if (scene.sdf.empty() || scene.header.size() < 22 || headerCount != scene.header.size() || static_cast<u64>(sdfOffset) + sdfCount > scene.sdf.size()) return false;
    const f32* header = boundarySpan<f32>(headerPtr, headerCount, "postprocess_updateGIField.header");
    const f32* sdf = boundarySpan<f32>(sdfPtr, sdfCount, "postprocess_updateGIField.sdf");
    if (!header || !sdf) return false;
    std::copy(header, header + headerCount, scene.header.begin());
    std::copy(sdf, sdf + sdfCount, scene.sdf.begin() + sdfOffset);
    if (!scene.full) {
        scene.dirtyBegin = scene.dirtyEnd == scene.dirtyBegin ? sdfOffset : std::min(scene.dirtyBegin, sdfOffset);
        scene.dirtyEnd = std::max(scene.dirtyEnd, sdfOffset + sdfCount);
    }
    ++scene.version;
    return true;
}

bool postprocess_supportsCompute() {
    return g_postProcessPipeline ? g_postProcessPipeline->supportsCompute() : (g_device && g_device->supportsCompute());
}

void postprocess_setMsaaSamples(u32 samples) {
    if (g_postProcessPipeline) g_postProcessPipeline->setRequestedSamples(samples);
}

u32 postprocess_effectiveMsaaSamples() {
    return g_postProcessPipeline ? g_postProcessPipeline->sceneSamples() : 0u;
}

u32 postprocess_maxMsaaSamples() {
    return g_device ? g_device->maxSamples() : 0u;
}

i32 postprocess_hdrFormat(uintptr_t outPtr) {
    auto* out = boundarySpanMut<f32>(outPtr, 4, "postprocess_hdrFormat.out");
    if (!out) return 0;
    for (u32 i = 0; i < 4; ++i) out[i] = 0.0f;
    if (!g_postProcessPipeline) return 0;
    const HdrFormatDecision& d = g_postProcessPipeline->hdrFormat();
    out[0] = static_cast<f32>(static_cast<u8>(d.requested));
    out[1] = static_cast<f32>(static_cast<u8>(d.effective));
    out[2] = static_cast<f32>(static_cast<u8>(d.refusal));
    out[3] = d.linear ? 1.0f : 0.0f;
    return 1;
}

std::string postprocess_hdrFormatNames() {
    if (!g_postProcessPipeline) return {};
    const HdrFormatDecision& d = g_postProcessPipeline->hdrFormat();
    return std::string(pixelFormatName(d.requested)) + '|' + pixelFormatName(d.effective)
         + '|' + hdrRefusalName(d.refusal);
}

void postprocess_setPassScale(const std::string& passName, f32 scale) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setPassScale(passName, scale);
    }
}

void postprocess_requestSkyCapture(const std::string& passName, u32 width, u32 height) {
    if (g_postProcessPipeline) g_postProcessPipeline->requestSkyCapture(passName, width, height);
}

i32 postprocess_pollSkyCapture() {
    return g_postProcessPipeline ? g_postProcessPipeline->pollSkyCapture() : 2;
}

u32 postprocess_giStats(uintptr_t dst, u32 capacity) {
    if (capacity < kDynamicGIStatFloats) return 0;
    f32* out = boundarySpanMut<f32>(dst, kDynamicGIStatFloats, "postprocess_giStats.out");
    if (!out) return 0;
    const DynamicGIStats& s = dynamicGIStats();
    const f32 v[kDynamicGIStatFloats] = {s.width, s.height, s.probeSpacing, s.probes, s.probeRays, s.cardPixels, s.cardPixelsRelit, s.cardRays,
                                         s.applyPixels, s.applyLoadsPerPixel, s.forcedAttachmentBytes, s.residentBytes, s.levels, s.lights, s.instances, s.frame};
    std::memcpy(out, v, sizeof(v));
    return kDynamicGIStatFloats;
}

bool postprocess_takeSkyCapture(uintptr_t dst, u32 bytes) {
    if (!g_postProcessPipeline || dst == 0) return false;
    const std::vector<u8>& px = g_postProcessPipeline->skyCapturePixels();
    if (px.empty() || px.size() > bytes) return false;
    std::memcpy(reinterpret_cast<void*>(dst), px.data(), px.size());
    return true;
}

void postprocess_setPassContinuesEffect(const std::string& passName) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setPassContinuesEffect(passName);
    }
}

void postprocess_setUniformFloat(const std::string& passName,
                                  const std::string& uniform, f32 value) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setPassUniformFloat(passName, uniform, value);
    }
}

void postprocess_setPassTexture(const std::string& passName,
                                const std::string& uniform, u32 textureHandle) {
    if (!g_postProcessPipeline) return;
    u32 glId = 0;
    if (textureHandle != 0) {
        if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
            if (auto* tex = rm->getTexture(resource::TextureHandle(textureHandle))) {
                glId = tex->getId();
            }
        }
    }
    g_postProcessPipeline->setPassTexture(passName, uniform, glId);
}

void postprocess_setUniformVec4(const std::string& passName,
                                 const std::string& uniform,
                                 f32 x, f32 y, f32 z, f32 w) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setPassUniformVec4(passName, uniform, glm::vec4(x, y, z, w));
    }
}

void postprocess_begin() {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->begin();
    }
}

void postprocess_end() {
    // The chain itself ran inside Renderer.end(), declared to the frame's graph
    // beside the scene pass that feeds it. This closes the capture.
    if (g_postProcessPipeline) {
        g_postProcessPipeline->chainDone();
    }
}

bool postprocess_isInitialized() {
    if (!g_postProcessPipeline) return false;
    return g_postProcessPipeline->isInitialized();
}

void postprocess_setBypass(bool bypass) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setBypass(bypass);
    }
}

void postprocess_setOutputTransform(u32 transform) {
    if (!g_postProcessPipeline) return;
    // An unknown value is the identity, not a guess: a project built against a
    // newer curve list must not get a different one silently.
    g_postProcessPipeline->setOutputTransform(transform == 1 ? OutputTransform::ACES
                                              : transform == 2 ? OutputTransform::Neutral
                                                               : OutputTransform::None);
}

void postprocess_setDisplayLut(u32 textureHandle, f32 amount) {
    if (!g_postProcessPipeline) return;
    u32 glId = 0;
    if (textureHandle != 0) {
        if (auto* rm = ctx().tryGet<resource::ResourceManager>()) {
            if (auto* tex = rm->getTexture(resource::TextureHandle(textureHandle))) glId = tex->getId();
        }
    }
    g_postProcessPipeline->setDisplayLut(glId, amount);
}

void postprocess_setViewExposure(f32 ev) {
    if (g_postProcessPipeline) g_postProcessPipeline->setViewExposure(ev);
}

void postprocess_clearPasses() {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->clearPasses();
    }
}

void postprocess_setOutputViewport(u32 x, u32 y, u32 w, u32 h) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setOutputViewport(x, y, w, h);
    }
}

void postprocess_setPresentRequired(bool required) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setPresentRequired(required);
    }
}

void postprocess_beginScreenCapture() {
    if (!g_postProcessPipeline) return;
    g_postProcessPipeline->beginScreenCapture();
}

void postprocess_endScreenCapture() {
    if (!g_postProcessPipeline) return;
    g_postProcessPipeline->endScreenCapture();
}

void postprocess_executeScreenPasses() {
    if (!g_postProcessPipeline) return;
    g_postProcessPipeline->executeScreenPasses();
}

u32 postprocess_addScreenPass(const std::string& name, u32 shaderHandle) {
    if (!g_postProcessPipeline) return 0;
    return g_postProcessPipeline->addScreenPass(name, resource::ShaderHandle(shaderHandle));
}

void postprocess_clearScreenPasses() {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->clearScreenPasses();
    }
}

void postprocess_setScreenUniformFloat(const std::string& passName,
                                        const std::string& uniform, f32 value) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setScreenPassUniformFloat(passName, uniform, value);
    }
}

void postprocess_setScreenUniformVec4(const std::string& passName,
                                       const std::string& uniform,
                                       f32 x, f32 y, f32 z, f32 w) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setScreenPassUniformVec4(passName, uniform, glm::vec4(x, y, z, w));
    }
}

}  // namespace esengine

#endif  // ES_ENABLE_POSTPROCESS

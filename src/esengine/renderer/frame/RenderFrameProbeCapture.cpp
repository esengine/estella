// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    RenderFrameProbeCapture.cpp
 * @brief   The scene as seen from a point, all round, for a probe volume filled at run time.
 *
 * @details Six faces, one a frame: each is the scene collected and drawn from the point (as the planar reflection draws
 *          it from a mirrored camera), lit as the frame lights it, with no post-processing, into a small target of its own;
 *          then packed as RGBM into its slot of one 8-bit atlas the SDK reads back. One a frame because a frame writes its
 *          transient vertices and its frame constants once: six faces in one frame would all draw what the last wrote.
 *          A pixel nothing was drawn on (the sky, which post-processing paints) keeps alpha 0 for the reader to fill.
 */
#include "RenderFrame.hpp"
#ifdef ES_ENABLE_POSTPROCESS
#include "PostProcessPipeline.hpp"
#endif
#include "../../core/FrameProfiler.hpp"
#include "../../core/Log.hpp"

#include <glm/gtc/constants.hpp>
#include <glm/gtc/matrix_transform.hpp>

namespace esengine {

namespace {

// Toward each face, and its up: the SDK's probeCapture.ts builds the same bases to read the faces back.
constexpr glm::vec3 kFaceDir[6] = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};
constexpr glm::vec3 kFaceUp[6] = {{0, 1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1}, {0, 1, 0}, {0, 1, 0}};

}  // namespace

void RenderFrame::requestProbeCapture(const glm::vec3& position, u32 face) {
    ProbeCapture& c = probe_capture_;
    c.position = position;
    c.face = std::clamp(face, 8u, 128u);
    c.next = 0;
    c.state = ProbeCapture::State::Capturing;
    c.readback = ReadbackHandle::Invalid;
}

i32 RenderFrame::pollProbeCapture() {
    ProbeCapture& c = probe_capture_;
    switch (c.state) {
        case ProbeCapture::State::Idle: return 2;
        case ProbeCapture::State::Capturing: return 0;
        case ProbeCapture::State::Drawn:
            c.readback = c.atlas ? device_.requestReadback(c.atlas->handle(), c.face * 6, c.face) : ReadbackHandle::Invalid;
            if (c.readback == ReadbackHandle::Invalid) { c.state = ProbeCapture::State::Idle; return 2; }
            c.state = ProbeCapture::State::Reading;
            [[fallthrough]];
        case ProbeCapture::State::Reading: {
            const GfxReadbackStatus status = device_.pollReadback(c.readback);
            if (status == GfxReadbackStatus::Pending) return 0;
            c.state = ProbeCapture::State::Idle;
            if (status != GfxReadbackStatus::Ready) return 2;
            c.pixels.resize(static_cast<usize>(c.face) * 6 * c.face * 4);
            return device_.takeReadback(c.readback, c.pixels.data(), c.pixels.size()) ? 1 : 2;
        }
    }
    return 2;
}

void RenderFrame::declareProbeCapture(ecs::Registry& registry) {
#ifdef ES_ENABLE_POSTPROCESS
    ProbeCapture& c = probe_capture_;
    // One face a frame, whichever camera's collect comes first.
    if (c.state != ProbeCapture::State::Capturing || c.frame == planar_frame_ || !post_process_) return;
    c.frame = planar_frame_;
    const u32 n = c.face;
    const GfxPixelFormat format = linear_color_ && device_.supportsFloatTargets() && !planar_float_refused_
        ? GfxPixelFormat::RGBA16F : GfxPixelFormat::RGBA8;
    const u32 f = std::min(c.next, 5u);
    auto& target = c.faces[f];
    if (!target || target->getWidth() != n || target->getSpecification().colorFormat != format) {
        FramebufferSpec spec;
        spec.width = n; spec.height = n; spec.linearFilter = false;
        spec.depthStencil = true; spec.colorFormat = format;
        target = Framebuffer::create(device_, spec);
    }
    if (!c.atlas || c.atlas->getWidth() != n * 6 || c.atlas->getHeight() != n) {
        FramebufferSpec spec;
        spec.width = n * 6; spec.height = n; spec.linearFilter = false;
        spec.depthStencil = false; spec.colorFormat = GfxPixelFormat::RGBA8;
        c.atlas = Framebuffer::create(device_, spec);
    }
    if (!target || !c.atlas) {
        ES_LOG_ERROR("Probe capture: could not make its {}x{} targets", n, n);
        c.state = ProbeCapture::State::Idle;
        return;
    }

    const f32 metre = world_units_per_meter_;
    const glm::vec3 at = rebased(c.position);
    c.viewProjection = glm::perspective(glm::half_pi<f32>(), 1.0f, 0.05f * metre, 4000.0f * metre)
                     * glm::lookAt(at, at + kFaceDir[f], kFaceUp[f]);

    rg::PassDesc face;
    face.name = "probe-capture-face";
    face.write = graph_.importTarget(target->handle(), n, n, /*output=*/false, target->getColorAttachment());
    face.clear = face.clearDepth = true;
    for (u32 i = 0; i < 4; ++i) face.clearColor[i] = 0.0f;
    face.keep = true;
    if (shadow_resource_ != rg::kNoResource) face.dependencies.push_back(shadow_resource_);
    face.execute = [this, &registry](const rg::PassContext&) { executeProbeFace(registry); };
    const rg::ResourceId faceResource = face.write;
    graph_.addPass(std::move(face));

    rg::PassDesc pack;
    pack.name = "probe-capture-pack";
    pack.reads = {faceResource};
    pack.write = graph_.importTarget(c.atlas->handle(), n * 6, n, /*output=*/false, c.atlas->getColorAttachment());
    pack.keep = true;
    pack.viewportX = f * n;
    pack.viewportY = 0;
    pack.viewportW = n;
    pack.viewportH = n;
    // The face counts as done when it is DRAWN, not when it is declared: a frame whose graph is built and not run would
    // otherwise skip it for good, and the last one would leave the capture waiting for ever.
    pack.execute = [this, f](const rg::PassContext&) {
        post_process_->encodeRgbm();
        ProbeCapture& done = probe_capture_;
        if (done.state != ProbeCapture::State::Capturing || done.next != f) return;
        done.next = f + 1;
        if (f == 5) done.state = ProbeCapture::State::Drawn;
    };
    graph_.addPass(std::move(pack));
#else
    (void)registry;
#endif
}

void RenderFrame::executeProbeFace(ecs::Registry& registry) {
    ProbeCapture& c = probe_capture_;
    if (c.frameUbo == BufferHandle::Invalid) {
        c.frameUbo = device_.createBuffer({GfxBufferUsage::Uniform, RenderContext::frameConstantsSize(), true},
                                          GfxContent::transient(), nullptr);
    }
    if (c.frameUbo == BufferHandle::Invalid) return;
    probe_pool_.beginFrame();
    probe_list_.clear();
    probe_list_.setCullingMask(0xFFFFFFFFu);
    probe_list_.setDepthMask(draw_list_.depthMask());
    probe_list_.setYSortMask(draw_list_.ySortMask());
    auto ctx = makeContext();
    ctx.view_projection = c.viewProjection;
    Frustum frustum;
    frustum.extractFromMatrix(ctx.view_projection);
    RenderCollectContext collect{registry, frustum, clip_state_, probe_pool_, probe_list_, ctx,
                                 computeCameraView(ctx.view_projection)};
    collect.screen_ui = screen_domain_;
    collect.ui_tree_layers = ui_tree_layers_;
    collectSky(collect);
    // The scene as lit, and nothing after it: no post-processing, overlays or HUD.
    for (auto& plugin : plugins_) plugin->collect(collect);
    probe_list_.finalize(probe_pool_);
    probe_pool_.upload();
    context_.useFrameConstants(c.frameUbo, toClipDepthRange(c.viewProjection, device_.clipDepthRange()));
    // The lights as the frame packed them; a light past the sixteen direct slots keeps the main view's tiles.
    context_.lights().uploadAndBind();
    submitColorList(probe_list_, probe_pool_, nullptr, DrawList::Phase::All, "render.probe.draws");
    ES_PROFILE_COUNTER("render.probe.draws", probe_list_.mergedDrawCallCount());
    device_.invalidatePipelineCache();
}

void RenderFrame::setProbeVolumeOverride(u32 entity, resource::ProbeVolumeHandle grid) {
    if (grid.isValid()) probe_overrides_[entity] = grid;
    else probe_overrides_.erase(entity);
}

}  // namespace esengine

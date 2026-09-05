// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    RenderFrameOverlay.cpp
 * @brief   The frame's screen-space overlay — one graph pass, no camera.
 *
 * @details The geometry is already in the layout domain when it arrives here
 *          (UILayoutSystem places screen roots in pixels about the origin); this
 *          pass says only how that domain reaches the framebuffer, and it is
 *          TOLD — the projection is an input, so no camera can leak in.
 *
 *          It runs inside the RenderGraph like every other pass. Drawing after
 *          graph_.execute() would be simpler and would break the one rule that
 *          keeps this renderer explicable: the graph is the whole frame.
 */
#include "./RenderFrame.hpp"
#include "../../core/FrameProfiler.hpp"

#include <algorithm>

namespace esengine {

void RenderFrame::beginScreenOverlay(const glm::mat4& projection,
                                     i32 vpX, i32 vpY, u32 vpW, u32 vpH) {
    if (overlay_active_ || !device_.isDeviceUsable()) return;

    overlay_projection_ = projection;
    overlay_vp_x_ = vpX;
    overlay_vp_y_ = vpY;
    overlay_vp_w_ = vpW;
    overlay_vp_h_ = vpH;
    overlay_active_ = true;

    // The frame's own scratch, reused: every camera has drawn AND had its graph
    // run by the time this opens, so what is being reset is spent.
    pool_.beginFrame();
    draw_list_.clear();
    // Every layer until the caller says otherwise: which layers a frame shows is
    // the caller's to decide, and a host that never says shows all of them.
    draw_list_.setCullingMask(0xFFFFFFFFu);
    clip_state_.clear();
}

void RenderFrame::submitScreenOverlay(ecs::Registry& registry) {
    if (!overlay_active_) return;

    ES_PROFILE_SCOPE("render.overlay.collect");

    // Masks resolve in the overlay's OWN projection: a scissor rect is pixels,
    // and which pixels a UI box covers is a question only the projection that
    // draws it can answer.
    processMasks(registry, overlay_projection_, overlay_vp_x_, overlay_vp_y_,
                 static_cast<i32>(overlay_vp_w_), static_cast<i32>(overlay_vp_h_));
    buildClipState();

    auto ctx = makeContext();
    ctx.view_projection = overlay_projection_;
    ctx.purpose = RenderPurpose::ScreenOverlay;

    // Extracted for completeness of the context, never consulted: the overlay
    // does not cull (RenderCollectContext::visible short-circuits on the purpose).
    // A screen element is on the screen by construction.
    Frustum overlayFrustum;
    overlayFrustum.extractFromMatrix(overlay_projection_);

    RenderCollectContext collectCtx{registry, overlayFrustum, clip_state_, pool_, draw_list_,
                                    ctx, computeCameraView(overlay_projection_)};
    collectCtx.screen_ui = screen_domain_;
    // Only the plugins that can draw an entity out of a UI tree. Everything else
    // draws world content, which by definition is not what this pass is for —
    // and would land in it at layout-pixel coordinates.
    for (auto& plugin : plugins_) {
        if (plugin->drawsScreenUI()) plugin->collect(collectCtx);
    }
    stats_.culled += collectCtx.culled;
}

void RenderFrame::drawScreenOverlay() {
    context_.updateCameraConstants(overlay_projection_);
    {
        ES_PROFILE_SCOPE("render.overlay.submit");
        draw_list_.execute(device_, pool_, context_.materials(), context_.getWhiteTextureId(),
                           &frame_capture_, context_.skinUbo());
    }
    device_.invalidatePipelineCache();
    device_.setScissorTest(false);
}

void RenderFrame::endScreenOverlay(RenderTargetManager::Handle target) {
    if (!overlay_active_) return;
    overlay_active_ = false;
    if (!device_.isDeviceUsable()) return;
    // Nothing to draw is not the same as nothing to do elsewhere, but here it is:
    // a pass that would write no pixel is one the graph would run anyway.
    if (draw_list_.commandCount() == 0) return;

    {
        ES_PROFILE_SCOPE("render.overlay.finalize");
        draw_list_.finalize(pool_);
        pool_.upload();
    }
    accumulateStats(draw_list_);

    FramebufferHandle fbo = FramebufferHandle::Default;
    if (target != RenderTargetManager::INVALID_HANDLE) {
        if (auto* rt = target_manager_.get(target)) fbo = rt->getFramebuffer();
    }

    device_.invalidatePipelineCache();
    device_.setScissorTest(false);

    // Its own graph and its own run, on the same terms as the screen post stack:
    // this composes what every camera drew and happens after the last of them
    // ended, so no frame is declaring here.
    ES_PROFILE_SCOPE("render.overlay.graph");
    graph_.begin(width_, height_);
    rg::PassDesc pass;
    pass.name = "screen-ui";
    pass.write = graph_.importTarget(fbo, width_, height_);
    // Never clears. The HUD lands ON the frame; clearing here would be the pass
    // deciding the scene was not worth keeping.
    pass.clear = false;
    pass.viewportX = static_cast<u32>(std::max(overlay_vp_x_, 0));
    pass.viewportY = static_cast<u32>(std::max(overlay_vp_y_, 0));
    pass.viewportW = overlay_vp_w_;
    pass.viewportH = overlay_vp_h_;
    pass.execute = [this](const rg::PassContext&) { drawScreenOverlay(); };
    graph_.addPass(std::move(pass));
    graph_.execute();

    device_.endRenderPass();
    device_.invalidatePipelineCache();
}

}  // namespace esengine

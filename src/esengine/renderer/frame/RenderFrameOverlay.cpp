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
#include "../draw/ImmediateDraw.hpp"
#include "../../core/FrameProfiler.hpp"

#include <algorithm>
#include <unordered_map>

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
    draw_list_.setLayerlessVisible(true);
    overlay_effect_ = 0;
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
    collectCtx.ui_tree_layers = ui_tree_layers_;
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
                           &frame_capture_, context_.perDrawBlocks());
    }
    device_.invalidatePipelineCache();
    device_.setScissorTest(false);
}

bool RenderFrame::grabOverlayBackdrop(FramebufferHandle source) {
#ifdef ES_ENABLE_POSTPROCESS
    if (!post_process_ || width_ == 0 || height_ == 0) return false;
    if (overlay_grab_ == TextureHandle::Invalid || overlay_grab_w_ != width_ || overlay_grab_h_ != height_) {
        releaseOverlayBackdrop();
        TextureDesc desc;
        desc.width = width_;
        desc.height = height_;
        desc.format = GfxPixelFormat::RGB8;
        overlay_grab_ = device_.createTexture(desc, GfxContent::transient(), nullptr);
        FramebufferSpec spec;
        spec.width = width_;
        spec.height = height_;
        spec.depthStencil = false;
        spec.linearFilter = true;
        spec.mipmaps = true;
        overlay_backdrop_ = Framebuffer::create(device_, spec);
        overlay_grab_w_ = width_;
        overlay_grab_h_ = height_;
    }
    if (overlay_grab_ == TextureHandle::Invalid || !overlay_backdrop_) return false;
    if (!device_.copyFramebufferColor(source, overlay_grab_)) return false;

    device_.invalidatePipelineCache();
    device_.setScissorTest(false);
    graph_.begin(width_, height_);
    rg::PassDesc copy;
    copy.name = "screen-ui-grab";
    copy.reads = {graph_.importTexture(overlay_grab_, width_, height_)};
    copy.write = graph_.importTarget(overlay_backdrop_->handle(), width_, height_);
    copy.execute = [this](const rg::PassContext&) { post_process_->grabScene(); };
    graph_.addPass(std::move(copy));
    graph_.execute();
    device_.endRenderPass();
    device_.generateMipmaps(overlay_backdrop_->getColorAttachment());
    device_.invalidatePipelineCache();
    return true;
#else
    (void)source;
    return false;
#endif
}

void RenderFrame::releaseOverlayBackdrop() {
    if (overlay_grab_ != TextureHandle::Invalid) device_.deleteTexture(overlay_grab_);
    overlay_grab_ = TextureHandle::Invalid;
    overlay_backdrop_.reset();
    overlay_grab_w_ = overlay_grab_h_ = 0;
}

void RenderFrame::setScreenOverlayEffect(u32 material) {
    if (!overlay_active_) return;
    overlay_effect_ = material;
    draw_list_.setLayerlessVisible(material == 0);
}

void RenderFrame::endScreenOverlay(RenderTargetManager::Handle target) {
    if (!overlay_active_) return;
    overlay_active_ = false;
    const u32 effect = overlay_effect_;
    overlay_effect_ = 0;
    draw_list_.setLayerlessVisible(true);
    if (!device_.isDeviceUsable()) return;
    // Nothing to draw is not the same as nothing to do elsewhere, but here it is:
    // a pass that would write no pixel is one the graph would run anyway.
    if (draw_list_.commandCount() == 0) return;
    frame_capture_.beginPass(CapturePass::Overlay);

    if (linear_color_) {
        std::unordered_map<u32, u32> shown;
        draw_list_.remapPrograms([&](u32 program) {
            auto it = shown.find(program);
            if (it == shown.end()) it = shown.emplace(program, displayProgram(program)).first;
            return it->second;
        });
    }

    {
        ES_PROFILE_SCOPE("render.overlay.finalize");
        draw_list_.finalize(pool_);
        pool_.upload();
    }
    accumulateStats(draw_list_);
    tallyPass(draw_list_);

    FramebufferHandle fbo = FramebufferHandle::Default;
    if (target != RenderTargetManager::INVALID_HANDLE) {
        if (auto* rt = target_manager_.get(target)) fbo = rt->getFramebuffer();
    }

    device_.invalidatePipelineCache();
    device_.setScissorTest(false);

    bool layered = false;
    bool backdrop = false;
#ifdef ES_ENABLE_POSTPROCESS
    layered = effect != 0 && post_process_ && post_process_->canDrawMaterialOver(effect);
    if (draw_list_.anyUsesScreenColor(context_.materials())
        || (layered && context_.materials().usesScreenColor(effect))) {
        ES_PROFILE_SCOPE("render.overlay.grab");
        backdrop = grabOverlayBackdrop(fbo);
    }
#else
    (void)effect;
#endif
    draw_list_.setDeferScreenColor(false);
    draw_list_.setLayerAlpha(layered);
    const TextureHandle behind = backdrop ? overlay_backdrop_->getColorAttachment() : TextureHandle::Invalid;

    ES_PROFILE_SCOPE("render.overlay.graph");
    graph_.begin(width_, height_);
    rg::PassDesc pass;
    pass.name = layered ? "screen-ui-layer" : "screen-ui";
    pass.viewportX = static_cast<u32>(std::max(overlay_vp_x_, 0));
    pass.viewportY = static_cast<u32>(std::max(overlay_vp_y_, 0));
    pass.viewportW = overlay_vp_w_;
    pass.viewportH = overlay_vp_h_;
    rg::ResourceId layer = rg::kNoResource;
    if (layered) {
        rg::TargetDesc desc;
        desc.depthStencil = true;
        layer = graph_.createTarget(desc);
        pass.write = layer;
        pass.clear = true;
        pass.clearDepth = true;
        pass.clearColor[0] = pass.clearColor[1] = pass.clearColor[2] = pass.clearColor[3] = 0.0f;
    } else {
        pass.write = graph_.importTarget(fbo, width_, height_);
        pass.clear = false;
    }
    pass.execute = [this, layered, behind](const rg::PassContext&) {
        if (layered) device_.clearStencil(0);
        context_.materials().setScreenColor(behind);
        drawScreenOverlay();
        context_.materials().setScreenColor(TextureHandle::Invalid);
    };
    graph_.addPass(std::move(pass));
#ifdef ES_ENABLE_POSTPROCESS
    if (layered) {
        rg::PassDesc compose;
        compose.name = "screen-ui";
        compose.reads = {layer};
        compose.write = graph_.importTarget(fbo, width_, height_);
        compose.clear = false;
        compose.execute = [this, effect, behind](const rg::PassContext&) {
            context_.materials().setScreenColor(behind);
            post_process_->drawMaterialOver(effect);
            context_.materials().setScreenColor(TextureHandle::Invalid);
        };
        graph_.addPass(std::move(compose));
    }
#endif
    graph_.execute();
    draw_list_.setLayerAlpha(false);

    device_.endRenderPass();
    device_.invalidatePipelineCache();
    runPendingReplay(overlay_projection_, overlay_vp_w_, overlay_vp_h_);
}

void RenderFrame::drawOverScreen(i32 vpX, i32 vpY, u32 vpW, u32 vpH, RenderTargetManager::Handle target) {
    ImmediateDraw* draw = presented_overlay_draw_;
    if (!draw || !draw->hasDeferred() || !device_.isDeviceUsable() || vpW == 0 || vpH == 0) return;

    FramebufferHandle fbo = FramebufferHandle::Default;
    if (target != RenderTargetManager::INVALID_HANDLE) {
        if (auto* rt = target_manager_.get(target)) fbo = rt->getFramebuffer();
    }
    // The pixels are the display's by now, past the post chain and the screen's UI: a
    // linear frame's colours go through the variant that encodes them, as the overlay's do.
    const ShaderHandle program = linear_color_ ? ShaderHandle{batchProgram(BatchVariant::DisplayOutput)} : ShaderHandle::Invalid;
    const glm::mat4 viewProjection = draw->viewProjection();

    device_.invalidatePipelineCache();
    device_.setScissorTest(false);
    graph_.begin(width_, height_);
    rg::PassDesc pass;
    pass.name = "over-screen";
    pass.viewportX = static_cast<u32>(std::max(vpX, 0));
    pass.viewportY = static_cast<u32>(std::max(vpY, 0));
    pass.viewportW = vpW;
    pass.viewportH = vpH;
    pass.write = graph_.importTarget(fbo, width_, height_);
    pass.clear = false;
    pass.execute = [this, draw, program, viewProjection](const rg::PassContext&) {
        context_.updateCameraConstants(viewProjection);
        draw->flushDeferred(program);
    };
    graph_.addPass(std::move(pass));
    graph_.execute();
    device_.endRenderPass();
    device_.invalidatePipelineCache();
}

}  // namespace esengine

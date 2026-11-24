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
#include "../../core/Hash.hpp"
#include <glm/gtc/type_ptr.hpp>
#include "../../core/Log.hpp"
#include "../../ecs/components/ParticleEmitter.hpp"
#include "../../resource/ResourceManager.hpp"

#include <algorithm>
#include <unordered_map>

namespace esengine {

void RenderFrame::swapOverlayIn() {
    if (overlay_swapped_) return;
    if (!overlay_hold_) {
        overlay_hold_ = std::make_unique<OverlayHold>(device_);
        overlay_hold_->pool.init();
    }
    pool_.swap(overlay_hold_->pool);
    std::swap(draw_list_, overlay_hold_->list);
    // The overlay drew with the frame's list before it had its own: it takes how the frame has that list set.
    draw_list_.copySettingsFrom(overlay_hold_->list);
    overlay_swapped_ = true;
}

void RenderFrame::swapOverlayOut() {
    if (!overlay_swapped_) return;
    pool_.swap(overlay_hold_->pool);
    std::swap(draw_list_, overlay_hold_->list);
    overlay_swapped_ = false;
}

void RenderFrame::resetOverlayContents() {
    overlay_reset_pending_ = false;
    // The overlay's own pool and list (swapped in): what they held is spent once a pass is built in them.
    pool_.beginFrame();
    draw_list_.clear();
    overlay_valid_ = false;
}

void RenderFrame::beginScreenOverlay(const glm::mat4& projection,
                                     i32 vpX, i32 vpY, u32 vpW, u32 vpH) {
    if (overlay_active_ || !device_.isDeviceUsable()) return;
    swapOverlayIn();
    ++overlay_passes_;
    overlay_kept_ = false;
    overlay_reset_pending_ = true;
    overlay_would_keep_ = false;

    overlay_projection_ = projection;
    overlay_vp_x_ = vpX;
    overlay_vp_y_ = vpY;
    overlay_vp_w_ = vpW;
    overlay_vp_h_ = vpH;
    overlay_active_ = true;

    // Emptied by the first collect (resetOverlayContents), not here: keepScreenOverlay may yet find what is held still stands.
    // Every layer until the caller says otherwise: which layers a frame shows is
    // the caller's to decide, and a host that never says shows all of them.
    draw_list_.setCullingMask(0xFFFFFFFFu);
    draw_list_.setLayerlessVisible(true);
    overlay_effect_ = 0;
    clip_state_.clear();
}

/** What a held overlay pass was built from besides the registry's components: a pass keyed alike draws alike. */
u64 RenderFrame::overlayInputs(ecs::Registry& registry, bool whole) const {
    u64 h = hash::kFnv64Offset;
    const auto mix = [&h](u64 v) { h = hash::combine(h, v); };
    h = hash::combineWords(h, &overlay_projection_, sizeof(overlay_projection_));
    mix(static_cast<u32>(overlay_vp_x_));
    mix(static_cast<u32>(overlay_vp_y_));
    mix(overlay_vp_w_);
    mix(overlay_vp_h_);
    mix(draw_list_.cullingMask());
    mix(draw_list_.ySortMask());
    mix(draw_list_.treeMask());
    mix(draw_list_.depthMask());
    mix(overlay_effect_);
    mix(linear_color_ ? 1 : 0);
    mix(registry.entitySetId());
    mix(device_.deviceGeneration());
    mix(device_.textureShapes());
    mix(resource_manager_.textureMetadataRevision());
    mix(resource_manager_.meshesRevision());
    mix(context_.materials().revision());
    mix(batch_shader_id_);
    // A segment answers for its own labels and its own share of the domain (keepSegments); the whole overlay, for all of them.
    if (!whole) return h;
    // The labels it draws from the store, when it draws them itself.
    mix(retained_text_collected_ ? retained_text_.revision() : 0);
    // The domain itself, order-free: an entity that left it (or was destroyed in it) leaves nothing stamped behind.
    u64 domain = 0;
    if (screen_domain_) {
        for (const u32 id : *screen_domain_) domain += hash::combine(0x5bd1e995ull, id);
        mix(screen_domain_->size());
    }
    mix(domain);
    return h;
}

/** Whether a component of an entity the overlay draws was written, added or removed since the held pass was built. */
bool RenderFrame::overlayRegistryMoved(ecs::Registry& registry) {
    const auto inDomain = [this](u32 id) { return screen_domain_ && screen_domain_->count(id) != 0; };
    if (registry.anyComponentChangedSinceWhere(overlay_tick_, [&](Entity e) { return inDomain(e.id()); })) return true;
    // Structure: an add, a remove, a switch on or off. History is kept only while watched, so a journal that cannot say is a change.
    static std::vector<ecs::EntityChangeRow> rows(ecs::ENTITY_CHANGE_CAPACITY);
    const i32 count = registry.readEntityChanges(overlay_journal_, rows);
    if (count < 0) return true;
    for (i32 i = 0; i < count; ++i) {
        const auto& row = rows[static_cast<usize>(i)];
        if ((row.flags & ecs::ENTITY_CHANGE_RESET) || row.entity == INVALID_ENTITY.id() || inDomain(row.entity)) return true;
    }
    return false;
}

bool RenderFrame::keepScreenOverlay(ecs::Registry& registry, bool hostStill) {
    if (!overlay_active_ || !overlay_reset_pending_) return false;
    if (overlay_watched_ != registry.instanceId()) {
        overlay_watched_ = registry.instanceId();
        overlay_reader_ = registry.watchEntityChanges();
        overlay_valid_ = false;
    }
    overlay_registry_ = &registry;
    const bool segmentable = hostStill && retained_text_collected_ && overlay_passes_ == 1 && overlay_effect_ == 0
        && screen_roots_ && screen_root_by_index_ && !screen_roots_->empty()
        && !(segments_refused_ && segments_refused_roots_ == screenRootsHash());
    if (segmentable) return keepSegments(registry);
    segments_trusted_ = false;
    retained_text_.takeChanged([](u32) {});

    u32 why = 0;
    const u64 key = overlayInputs(registry, true);
    if (!hostStill) why |= 1;
    if (!overlay_valid_) why |= 2;
    else if (key != overlay_key_) why |= 4;
    if (overlay_passes_ > 1) why |= 8;
    bool particles = false;
    if (screen_domain_ && !screen_domain_->empty()) {
        registry.each<ecs::ParticleEmitter>([&](Entity e, ecs::ParticleEmitter&) {
            if (screen_domain_->count(e.id()) != 0) particles = true;
        });
    }
    if (particles) why |= 32;
    if (why == 0 && overlayRegistryMoved(registry)) why |= 16;
    overlay_why_ = why;

    // The tick and the journal row this pass is read at: a write after this is a change to the next.
    overlay_pending_key_ = key;
    overlay_pending_tick_ = registry.beginChangeRead();
    overlay_pending_journal_ = registry.entityChangeSequence();

    if (why == 0 && !registry.changeAuditEnabled()) {
        overlay_kept_ = true;
        overlay_reset_pending_ = false;
        overlay_tick_ = overlay_pending_tick_;
        overlay_journal_ = overlay_pending_journal_;
        ++overlay_kept_total_;
        return true;
    }
    overlay_would_keep_ = why == 0;
    resetOverlayContents();
    return false;
}

void RenderFrame::submitScreenOverlay(ecs::Registry& registry) {
    if (!overlay_active_ || overlay_kept_) return;
    if (overlay_segmented_) {
        ES_PROFILE_SCOPE("render.overlay.collect");
        processMasks(registry, overlay_projection_, overlay_vp_x_, overlay_vp_y_,
                     static_cast<i32>(overlay_vp_w_), static_cast<i32>(overlay_vp_h_));
        buildClipState();
        for (auto& segment : segments_) {
            if (!segment.dirty) continue;
            segmentIn(segment);
            pool_.beginFrame();
            draw_list_.clear();
            collectScreenOverlayInto(registry, segment.root);
            segmentOut(segment);
        }
        return;
    }
    if (overlay_reset_pending_) {
        // A host that does not ask keepScreenOverlay builds every pass, as before; one that asks has had its answer.
        resetOverlayContents();
        overlay_pending_key_ = 0;
        overlay_pending_tick_ = registry.beginChangeRead();
        overlay_pending_journal_ = -1;
    }

    ES_PROFILE_SCOPE("render.overlay.collect");

    // Masks resolve in the overlay's OWN projection: a scissor rect is pixels,
    // and which pixels a UI box covers is a question only the projection that
    // draws it can answer.
    processMasks(registry, overlay_projection_, overlay_vp_x_, overlay_vp_y_,
                 static_cast<i32>(overlay_vp_w_), static_cast<i32>(overlay_vp_h_));
    buildClipState();
    collectScreenOverlayInto(registry, 0);
}

/** The overlay's renderables into the list open now: every screen entity, or with @p onlyRoot those under that root. */
void RenderFrame::collectScreenOverlayInto(ecs::Registry& registry, u32 onlyRoot) {
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
    collectCtx.screen_root_by_index = screen_root_by_index_;
    collectCtx.only_root = onlyRoot;
    // Only the plugins that can draw an entity out of a UI tree. Everything else
    // draws world content, which by definition is not what this pass is for —
    // and would land in it at layout-pixel coordinates.
    for (auto& plugin : plugins_) {
        if (plugin->drawsScreenUI()) plugin->collect(collectCtx);
    }
    if (retained_text_collected_) submitRetainedText(registry, true, glm::value_ptr(overlay_projection_), onlyRoot);
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
    executeOverlayGraph();
    device_.endRenderPass();
    device_.generateMipmaps(overlay_backdrop_->getColorAttachment());
    device_.invalidatePipelineCache();
    return true;
#else
    (void)source;
    return false;
#endif
}

void RenderFrame::executeOverlayGraph() {
    rg::PassTimer* timer = gpu_frame_open_ && gpu_frame_passes_ ? pass_timer_.get() : nullptr;
    graph_.setPassTimer(timer);
    graph_.execute();
    graph_.setPassTimer(nullptr);
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
    if (overlay_segmented_) {
        endSegmentedOverlay(target);
        return;
    }
    // Every way out of the pass gives the frame its own pool and list back.
    struct SwapBack {
        RenderFrame& frame;
        ~SwapBack() { frame.swapOverlayOut(); }
    } swapBack{*this};
    overlay_active_ = false;
    const u32 effect = overlay_effect_;
    overlay_effect_ = 0;
    draw_list_.setLayerlessVisible(true);
    const bool kept = overlay_kept_;
    overlay_kept_ = false;
    if (overlay_reset_pending_) {
        // Opened and closed with nothing collected or asked: an empty pass, held by nobody.
        resetOverlayContents();
        overlay_pending_key_ = 0;
    }
    ES_PROFILE_COUNTER("render.overlay.kept", kept ? 1u : 0u);
    ES_PROFILE_COUNTER("render.overlay.keptTotal", overlay_kept_total_);
    ES_PROFILE_COUNTER("render.overlay.why", overlay_why_);
    ES_PROFILE_COUNTER("render.overlay.stale", overlay_stale_);
    if (!device_.isDeviceUsable()) {
        overlay_valid_ = false;
        return;
    }

    if (!kept) {
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
        // Held from here; a pass keyed 0 (from a host that never asked) is never matched.
        overlay_valid_ = overlay_pending_key_ != 0;
        overlay_key_ = overlay_pending_key_;
        overlay_tick_ = overlay_pending_tick_;
        overlay_journal_ = overlay_pending_journal_;
        if (overlay_valid_) {
            u64 content = draw_list_.contentHash(hash::kFnv64Offset);
            for (u32 l = 0; l < LAYOUT_COUNT; ++l) {
                const auto layout = static_cast<LayoutId>(l);
                const u32 bytes = pool_.vertexBytesUsed(layout);
                if (bytes) content = hash::combineWords(content, pool_.vertexData(layout), bytes);
                const u32 indices = pool_.indicesUsed(layout);
                if (indices) content = hash::combineWords(content, pool_.indexData(layout), indices * sizeof(u32));
            }
            if (overlay_would_keep_ && content != overlay_content_) {
                ++overlay_stale_;
                if (!warned_overlay_stale_) {
                    warned_overlay_stale_ = true;
                    ES_LOG_WARN("change audit: the screen overlay would have been held while what it draws had changed");
                }
            }
            overlay_content_ = content;
        }
    }
    overlay_would_keep_ = false;

    // Nothing to draw is not the same as nothing to do elsewhere, but here it is:
    // a pass that would write no pixel is one the graph would run anyway.
    if (draw_list_.commandCount() == 0) return;
    frame_capture_.beginPass(CapturePass::Overlay);

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
        compose.name = "screen-ui-effect";
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
    executeOverlayGraph();
    draw_list_.setLayerAlpha(false);

    device_.endRenderPass();
    device_.invalidatePipelineCache();
    runPendingReplay(overlay_projection_, overlay_vp_w_, overlay_vp_h_);
}

// =============================================================================
// Segments: one held share of the overlay per screen root
// =============================================================================

u32 RenderFrame::screenRootAt(u32 entity) const {
    if (!screen_root_by_index_) return 0;
    const u32 index = Entity::fromRaw(entity).index();
    return index < screen_root_by_index_->size() ? (*screen_root_by_index_)[index] : 0;
}

u64 RenderFrame::screenRootsHash() const {
    u64 h = hash::kFnv64Offset;
    if (screen_roots_) for (const u32 root : *screen_roots_) h = hash::combine(h, root);
    return h;
}

void RenderFrame::segmentIn(OverlaySegment& segment) {
    if (!segment.hold) {
        segment.hold = std::make_unique<OverlayHold>(device_);
        segment.hold->pool.init();
    }
    pool_.swap(segment.hold->pool);
    std::swap(draw_list_, segment.hold->list);
    // How this pass was set (its layers, whether layerless content shows) went to the one-list hold, opened by beginScreenOverlay.
    draw_list_.copySettingsFrom(overlay_hold_->list);
}

void RenderFrame::segmentOut(OverlaySegment& segment) {
    pool_.swap(segment.hold->pool);
    std::swap(draw_list_, segment.hold->list);
}

/**
 * The segmented answer of keepScreenOverlay: which roots' segments must be built again. A segment stands while the pass's inputs
 * are those it was built with, its share of the domain is the same, and no entity of that share was written, added, removed or
 * given new glyphs since the pass that last read them; a particle emitter under it rebuilds it every pass.
 */
bool RenderFrame::keepSegments(ecs::Registry& registry) {
    overlay_segmented_ = true;
    overlay_reset_pending_ = false;
    // The one-list hold is left as it was: this pass draws from the segments.
    swapOverlayOut();

    std::vector<OverlaySegment> next;
    next.reserve(screen_roots_->size());
    for (const u32 root : *screen_roots_) {
        OverlaySegment segment;
        for (auto& held : segments_) {
            if (held.root == root && held.hold) { segment = std::move(held); break; }
        }
        segment.root = root;
        next.push_back(std::move(segment));
    }
    std::vector<std::unique_ptr<OverlayHold>> spare;
    for (auto& left : segments_) if (left.hold) spare.push_back(std::move(left.hold));
    for (auto& segment : next) {
        if (segment.hold || spare.empty()) continue;
        segment.hold = std::move(spare.back());
        spare.pop_back();
    }
    for (auto& hold : spare) hold->pool.shutdown();
    segments_ = std::move(next);

    std::unordered_map<u32, usize> index;
    index.reserve(segments_.size());
    for (usize i = 0; i < segments_.size(); ++i) index.emplace(segments_[i].root, i);
    const auto inDomain = [this](u32 id) { return screen_domain_ && screen_domain_->count(id) != 0; };
    const auto mark = [&](u32 id) {
        if (!inDomain(id)) return;
        const auto found = index.find(screenRootAt(id));
        if (found != index.end()) segments_[found->second].dirty = true;
    };

    const u64 key = overlayInputs(registry, false);
    const bool fresh = !segments_trusted_ || key != segments_key_;
    std::vector<u64> domains(segments_.size(), 0);
    std::vector<u64> counts(segments_.size(), 0);
    if (screen_domain_) {
        for (const u32 id : *screen_domain_) {
            const auto found = index.find(screenRootAt(id));
            if (found == index.end()) continue;
            domains[found->second] += hash::combine(0x5bd1e995ull, id);
            ++counts[found->second];
        }
    }
    for (usize i = 0; i < segments_.size(); ++i) {
        auto& segment = segments_[i];
        const u64 domain = hash::combine(domains[i], counts[i]);
        segment.dirty = fresh || !segment.valid || segment.domain != domain;
        segment.domain = domain;
    }
    bool every = fresh;
    if (!fresh) {
        registry.anyComponentChangedSinceWhere(segments_tick_, [&](Entity e) { mark(e.id()); return false; });
        static std::vector<ecs::EntityChangeRow> rows(ecs::ENTITY_CHANGE_CAPACITY);
        const i32 count = registry.readEntityChanges(segments_journal_, rows);
        if (count < 0) every = true;
        for (i32 i = 0; i < count && !every; ++i) {
            const auto& row = rows[static_cast<usize>(i)];
            if ((row.flags & ecs::ENTITY_CHANGE_RESET) || row.entity == INVALID_ENTITY.id()) every = true;
            else mark(row.entity);
        }
    }
    if (!retained_text_.takeChanged(mark)) every = true;
    if (screen_domain_ && !screen_domain_->empty()) {
        registry.each<ecs::ParticleEmitter>([&](Entity e, ecs::ParticleEmitter&) { mark(e.id()); });
    }
    const bool audit = registry.changeAuditEnabled();
    overlay_segments_rebuilt_ = 0;
    for (auto& segment : segments_) {
        if (every) segment.dirty = true;
        segment.wouldKeep = !segment.dirty;
        if (audit) segment.dirty = true;
        if (segment.dirty) ++overlay_segments_rebuilt_;
    }

    // Read here: a write after this is a change to the next pass.
    segments_key_ = key;
    segments_tick_ = registry.beginChangeRead();
    segments_journal_ = registry.entityChangeSequence();
    segments_trusted_ = true;
    overlay_why_ = overlay_segments_rebuilt_ ? 64u : 0u;
    if (overlay_segments_rebuilt_ == 0) {
        overlay_kept_ = true;
        ++overlay_kept_total_;
        return true;
    }
    return false;
}

void RenderFrame::endSegmentedOverlay(RenderTargetManager::Handle target) {
    overlay_active_ = false;
    overlay_segmented_ = false;
    overlay_effect_ = 0;
    const bool kept = overlay_kept_;
    overlay_kept_ = false;
    ES_PROFILE_COUNTER("render.overlay.kept", kept ? 1u : 0u);
    ES_PROFILE_COUNTER("render.overlay.keptTotal", overlay_kept_total_);
    ES_PROFILE_COUNTER("render.overlay.why", overlay_why_);
    ES_PROFILE_COUNTER("render.overlay.stale", overlay_stale_);
    ES_PROFILE_COUNTER("render.overlay.segments", static_cast<u32>(segments_.size()));
    ES_PROFILE_COUNTER("render.overlay.rebuilt", kept ? 0u : overlay_segments_rebuilt_);
    if (!kept) overlay_rebuilt_last_ = overlay_segments_rebuilt_;
    ES_PROFILE_COUNTER("render.overlay.rebuiltLast", overlay_rebuilt_last_);
    if (!device_.isDeviceUsable()) {
        segments_trusted_ = false;
        return;
    }

    if (!kept) {
        ES_PROFILE_SCOPE("render.overlay.finalize");
        for (auto& segment : segments_) {
            if (!segment.dirty) continue;
            segmentIn(segment);
            if (linear_color_) {
                std::unordered_map<u32, u32> shown;
                draw_list_.remapPrograms([&](u32 program) {
                    auto it = shown.find(program);
                    if (it == shown.end()) it = shown.emplace(program, displayProgram(program)).first;
                    return it->second;
                });
            }
            draw_list_.finalize(pool_);
            pool_.upload();
            u64 content = draw_list_.contentHash(hash::kFnv64Offset);
            for (u32 l = 0; l < LAYOUT_COUNT; ++l) {
                const auto layout = static_cast<LayoutId>(l);
                const u32 bytes = pool_.vertexBytesUsed(layout);
                if (bytes) content = hash::combineWords(content, pool_.vertexData(layout), bytes);
                const u32 indices = pool_.indicesUsed(layout);
                if (indices) content = hash::combineWords(content, pool_.indexData(layout), indices * sizeof(u32));
            }
            if (segment.wouldKeep && segment.valid && content != segment.content) {
                ++overlay_stale_;
                if (!warned_overlay_stale_) {
                    warned_overlay_stale_ = true;
                    ES_LOG_WARN("change audit: a screen root's overlay segment would have been held while what it draws had changed");
                }
            }
            segment.content = content;
            segment.valid = true;
            segment.dirty = false;
            segmentOut(segment);
        }

        // Drawn one after another they draw as one list would only if no key of a later root sorts at or before one of an earlier
        // root's, and none reads the screen's colour (which the one-list pass grabs once). If not, this pass is drawn as one list,
        // and so is every pass until the roots change.
        bool ordered = true;
        bool any = false;
        u64 previous = 0;
        for (auto& segment : segments_) {
            u64 lo = 0, hi = 0;
            if (!segment.hold || !segment.hold->list.sortKeyRange(lo, hi)) continue;
            if ((any && lo <= previous) || segment.hold->list.anyUsesScreenColor(context_.materials())) ordered = false;
            previous = hi;
            any = true;
        }
        if (!ordered && overlay_registry_) {
            segments_refused_ = true;
            segments_refused_roots_ = screenRootsHash();
            segments_trusted_ = false;
            swapOverlayIn();
            resetOverlayContents();
            collectScreenOverlayInto(*overlay_registry_, 0);
            overlay_pending_key_ = 0;
            overlay_would_keep_ = false;
            overlay_active_ = true;
            endScreenOverlay(target);
            return;
        }
    }

    u32 commands = 0;
    for (auto& segment : segments_) if (segment.hold) commands += segment.hold->list.commandCount();
    if (commands == 0) return;
    frame_capture_.beginPass(CapturePass::Overlay);
    for (auto& segment : segments_) {
        if (!segment.hold) continue;
        accumulateStats(segment.hold->list);
        tallyPass(segment.hold->list);
        segment.hold->list.setDeferScreenColor(false);
        segment.hold->list.setLayerAlpha(false);
    }

    FramebufferHandle fbo = FramebufferHandle::Default;
    if (target != RenderTargetManager::INVALID_HANDLE) {
        if (auto* rt = target_manager_.get(target)) fbo = rt->getFramebuffer();
    }
    device_.invalidatePipelineCache();
    device_.setScissorTest(false);

    ES_PROFILE_SCOPE("render.overlay.graph");
    graph_.begin(width_, height_);
    rg::PassDesc pass;
    pass.name = "screen-ui";
    pass.viewportX = static_cast<u32>(std::max(overlay_vp_x_, 0));
    pass.viewportY = static_cast<u32>(std::max(overlay_vp_y_, 0));
    pass.viewportW = overlay_vp_w_;
    pass.viewportH = overlay_vp_h_;
    pass.write = graph_.importTarget(fbo, width_, height_);
    pass.clear = false;
    pass.execute = [this](const rg::PassContext&) {
        context_.materials().setScreenColor(TextureHandle::Invalid);
        context_.updateCameraConstants(overlay_projection_);
        ES_PROFILE_SCOPE("render.overlay.submit");
        // In the roots' order, each from its own buffers: a mask's stencil is back at zero when its list leaves the mask.
        for (auto& segment : segments_) {
            if (!segment.hold || segment.hold->list.commandCount() == 0) continue;
            segment.hold->list.execute(device_, segment.hold->pool, context_.materials(), context_.getWhiteTextureId(),
                                       &frame_capture_, context_.perDrawBlocks());
        }
        device_.invalidatePipelineCache();
        device_.setScissorTest(false);
    };
    graph_.addPass(std::move(pass));
    executeOverlayGraph();
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

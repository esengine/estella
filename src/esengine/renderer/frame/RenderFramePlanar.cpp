// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "RenderFrame.hpp"
#include "../../ecs/components/PlanarReflection.hpp"
#include "../../ecs/components/MeshRenderer.hpp"
#include "../../resource/Mesh.hpp"
#include "../../core/FrameProfiler.hpp"
#include "../../core/Log.hpp"
#include <glm/gtc/type_ptr.hpp>
#include <string>

namespace esengine {
void RenderFrame::setPlanarQuality(f32 scale, u32 maxSize, f32 rate) {
    planar_scale_ = std::isfinite(scale) ? std::clamp(scale, 0.125f, 1.0f) : 0.5f;
    planar_max_size_ = std::clamp(maxSize, 64u, 4096u);
    planar_rate_ = std::isfinite(rate) ? std::clamp(rate, 0.0f, 120.0f) : 0.0f;
}

void RenderFrame::releasePlanarCaptures() {
    for (auto& [view, capture] : planar_captures_) {
        if (capture.frameUbo != BufferHandle::Invalid) device_.deleteBuffer(capture.frameUbo);
    }
    planar_captures_.clear();
    planar_receiver_ = INVALID_ENTITY;
    planar_texture_ = 0;
    planar_resource_ = rg::kNoResource;
}

void RenderFrame::declarePlanarReflection(ecs::Registry& registry) {
    planar_receiver_ = INVALID_ENTITY;
    planar_texture_ = 0;
    planar_resource_ = rg::kNoResource;
    if (scene_resource_ == rg::kNoResource) return;
    auto surfaces = registry.activeView<ecs::Transform, ecs::MeshRenderer, ecs::PlanarReflection>();
    Entity selected = INVALID_ENTITY;
    PlanarReflectionCamera camera;
    u32 eligible = 0;
    for (const Entity entity : surfaces) {
        if (screen_domain_ && screen_domain_->count(entity.id()) != 0) continue;
        const auto& surface = surfaces.get<ecs::PlanarReflection>(entity);
        const auto& mesh = surfaces.get<ecs::MeshRenderer>(entity);
        if (!surface.enabled || !mesh.enabled || !mesh.mesh.isValid()
            || !draw_list_.layerVisible(DrawList::layerBit(mesh.layer))) continue;
        const Mesh* geometry = resource_manager_.getMesh(mesh.mesh);
        if (!geometry || !geometry->isDrawable()) continue;
        auto& transform = surfaces.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        glm::vec3 centre, half;
        orientedWorldAabb(rebased(transform.worldPosition), transform.worldRotation, transform.worldScale,
                          geometry->localMin, geometry->localMax, centre, half);
        if (!frustum_.intersectsAABB(centre, half)) continue;
        const u32 axis = static_cast<u32>(surface.axis);
        if (axis > 2 || std::abs(transform.worldScale[axis]) < 1e-6f) continue;
        glm::vec3 normal(0.0f); normal[axis] = 1.0f;
        PlanarReflectionCamera candidate;
        if (!planarReflectionCamera(view_projection_, rebased(transform.worldPosition),
                                    transform.worldRotation * normal, surface.clipOffset, candidate)) continue;
        ++eligible;
        // A stable winner, independent of sparse-set iteration and camera movement.
        if (selected != INVALID_ENTITY && selected.id() < entity.id()) continue;
        selected = entity;
        camera = candidate;
    }
    if (selected == INVALID_ENTITY) {
        const auto previous = planar_captures_.find(view_id_);
        if (previous != planar_captures_.end()) {
            if (previous->second.frameUbo != BufferHandle::Invalid) device_.deleteBuffer(previous->second.frameUbo);
            planar_captures_.erase(previous);
        }
        return;
    }
    const auto& surface = registry.get<ecs::PlanarReflection>(selected);
    auto& capture = planar_captures_[view_id_];
    capture.lastSeen = planar_frame_;
    capture.rejected = eligible - 1;
    const bool project = surface.quality == ecs::ReflectionQuality::Project;
    const f32 requestedScale = project ? planar_scale_ : surface.resolutionScale;
    const f32 scale = std::isfinite(requestedScale) ? std::clamp(requestedScale, 0.125f, 1.0f) : 0.5f;
    const u32 limit = std::clamp(project ? planar_max_size_ : surface.maxSize, 64u, 4096u);
    u32 sourceW = scene_viewport_.w ? scene_viewport_.w : width_;
    u32 sourceH = scene_viewport_.h ? scene_viewport_.h : height_;
    if (auto* target = target_manager_.get(current_target_); target && !scene_viewport_.w) {
        sourceW = target->getWidth(); sourceH = target->getHeight();
    }
    const f32 ratio = std::min(scale, static_cast<f32>(limit) / std::max({sourceW, sourceH, 1u}));
    const u32 w = std::max(1u, static_cast<u32>(std::round(sourceW * ratio)));
    const u32 h = std::max(1u, static_cast<u32>(std::round(sourceH * ratio)));
    GfxPixelFormat format = linear_color_ && device_.supportsFloatTargets()
        ? GfxPixelFormat::RGBA16F : GfxPixelFormat::RGBA8;
    // A driver can claim float targets and still refuse this one; remember that and stay with 8 bits.
    if (planar_float_refused_) format = GfxPixelFormat::RGBA8;
    const bool generationChanged = capture.generation != device_.deviceGeneration();
    if (!capture.target || capture.target->getWidth() != w || capture.target->getHeight() != h
        || capture.target->getSpecification().colorFormat != format) {
        FramebufferSpec spec;
        spec.width = w; spec.height = h; spec.linearFilter = true;
        spec.depthStencil = true; spec.colorFormat = format;
        capture.target = Framebuffer::create(device_, spec);
        if (!capture.target && format == GfxPixelFormat::RGBA16F) {
            ES_LOG_WARN("Planar reflection: a {}x{} float capture target was refused, falling back to RGBA8", w, h);
            planar_float_refused_ = true;
            format = GfxPixelFormat::RGBA8;
            spec.colorFormat = format;
            capture.target = Framebuffer::create(device_, spec);
        }
        capture.valid = false;
    }
    if (!capture.target) return;
    const auto policy = project ? (planar_rate_ > 0 ? ecs::ReflectionUpdate::FixedRate : ecs::ReflectionUpdate::EveryFrame) : surface.update;
    const f32 requestedRate = project ? planar_rate_ : surface.updatesPerSecond;
    const f32 rate = std::isfinite(requestedRate) ? std::clamp(requestedRate, 1.0f, 120.0f) : 30.0f;
    const bool due = !capture.valid || generationChanged || capture.receiver != selected
        || capture.revision != surface.revision || capture.mask != surface.cullingMask
        || policy == ecs::ReflectionUpdate::EveryFrame
        || (policy == ecs::ReflectionUpdate::FixedRate && (planar_elapsed_ < capture.lastTime
            || planar_elapsed_ - capture.lastTime >= 1.0f / rate));
    const auto resource = graph_.importTarget(capture.target->handle(), w, h, /*output=*/false);
    if (due) {
        capture.receiver = selected;
        capture.camera = camera;
        capture.mask = surface.cullingMask;
        capture.revision = surface.revision;
        capture.generation = device_.deviceGeneration();
        rg::PassDesc pass;
        pass.name = "planar-reflection";
        pass.write = resource;
        pass.clear = pass.clearDepth = true;
        for (u32 i = 0; i < 4; ++i) pass.clearColor[i] = scene_clear_[i];
        if (shadow_resource_ != rg::kNoResource) pass.dependencies.push_back(shadow_resource_);
        const u32 view = view_id_;
        pass.execute = [this, &registry, view](const rg::PassContext&) { executePlanarReflection(registry, view); };
        graph_.addPass(std::move(pass));
    }
    // Imported targets do not publish a texture until explicitly named.
    planar_resource_ = resource;
    planar_receiver_ = selected;
    planar_texture_ = static_cast<u32>(capture.target->getColorAttachment());
    planar_constants_.projection = capture.camera.samplingProjection;
    planar_constants_.params = {1.0f,
        device_.textureOriginTopLeft() ? -1.0f : 1.0f,
        1.0f / w, 1.0f / h};
}

void RenderFrame::executePlanarReflection(ecs::Registry& registry, u32 view) {
    auto& capture = planar_captures_.at(view);
    if (capture.frameUbo == BufferHandle::Invalid) {
        capture.frameUbo = device_.createBuffer({GfxBufferUsage::Uniform, RenderContext::frameConstantsSize(), true}, GfxContent::transient(), nullptr);
    }
    if (capture.frameUbo == BufferHandle::Invalid) return;
    planar_pool_.beginFrame();
    planar_list_.clear();
    planar_list_.setCullingMask(capture.mask);
    planar_list_.setDepthMask(draw_list_.depthMask());
    planar_list_.setYSortMask(draw_list_.ySortMask());
    auto ctx = makeContext();
    ctx.view_projection = capture.camera.projection;
    Frustum frustum;
    frustum.extractFromMatrix(ctx.view_projection);
    RenderCollectContext collect{registry, frustum, clip_state_, planar_pool_, planar_list_, ctx,
                                 computeCameraView(ctx.view_projection)};
    collect.screen_ui = screen_domain_;
    collect.excluded = capture.receiver;
    collectSky(collect);
    // No recursive frame/scene collect, post-processing, host overlays or HUD.
    for (auto& plugin : plugins_) plugin->collect(collect);
    planar_list_.finalize(planar_pool_);
    planar_pool_.upload();
    context_.useFrameConstants(capture.frameUbo,
        toClipDepthRange(capture.camera.projection, device_.clipDepthRange()));
    // The tiled lights' masks are for the camera the scene is seen from; this one looks from the mirror.
    context_.lights().suspendTiled(true);
    context_.lights().uploadAndBind();
    planar_list_.execute(device_, planar_pool_, context_.materials(),
                         context_.getWhiteTextureId(), nullptr, context_.perDrawBlocks());
    context_.lights().suspendTiled(false);
    capture.valid = true;
    capture.lastTime = planar_elapsed_;
    capture.draws = planar_list_.mergedDrawCallCount();
    accumulateStats(planar_list_);
    tallyPass(planar_list_);
    ES_PROFILE_COUNTER("render.planar.draws", capture.draws);
    ES_PROFILE_COUNTER("render.planar.rejected", capture.rejected);
    device_.invalidatePipelineCache();
}

std::string RenderFrame::planarStatus(u32 view, u32 entity) const {
    const auto found = planar_captures_.find(view);
    if (found == planar_captures_.end()) return "{\"state\":\"inactive\"}";
    const auto& c = found->second;
    if (c.receiver.id() != entity) return "{\"state\":\"budget-excluded\"}";
    if (!c.valid || !c.target) return "{\"state\":\"unavailable\"}";
    const auto& spec = c.target->getSpecification();
    const u64 bytes = static_cast<u64>(spec.width) * spec.height * (spec.colorFormat == GfxPixelFormat::RGBA16F ? 12u : 8u);
    return "{\"state\":\"ready\",\"width\":" + std::to_string(spec.width) + ",\"height\":" + std::to_string(spec.height)
        + ",\"draws\":" + std::to_string(c.draws) + ",\"bytes\":" + std::to_string(bytes)
        + ",\"rejected\":" + std::to_string(c.rejected) + ",\"updated\":" + (c.lastTime == planar_elapsed_ ? "true" : "false") + "}";
}
} // namespace esengine

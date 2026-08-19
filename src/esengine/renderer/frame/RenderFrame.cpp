// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./RenderFrame.hpp"
#include "../rhi/Shader.hpp"
#include "../rhi/ShaderEmbeds.generated.hpp"
#include "../store/LightStore.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Light2D.hpp"
#include "../../ecs/components/ShadowCaster2D.hpp"
#include "../../ecs/components/Mesh2D.hpp"
#include "../../resource/ShaderParser.hpp"
#include "../../core/Log.hpp"
#include "../../core/FrameProfiler.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>

namespace esengine {

glm::vec3 srgbToLinearCpu(const glm::vec3& c);

void GpuTimer::begin(GfxDevice& device) {
    if (state_ == 0) {
        // Lazy probe: the device reports timer support by whether it can create a query.
        queries_[0] = device.createTimerQuery();
        if (queries_[0] != 0) {
            for (int i = 1; i < kRing; ++i) queries_[i] = device.createTimerQuery();
            state_ = 1;
        } else {
            state_ = 2;
        }
    }
    if (state_ != 1 || inflight_[write_]) return;
    device.beginTimerQuery(queries_[write_]);
    active_ = true;
}

void GpuTimer::end(GfxDevice& device) {
    if (!active_) return;
    device.endTimerQuery();
    inflight_[write_] = true;
    write_ = (write_ + 1) % kRing;
    active_ = false;
}

void GpuTimer::poll(GfxDevice& device) {
    if (state_ != 1) return;
    if (device.timerDisjoint()) { // timing disturbed — drop everything in flight
        for (int i = 0; i < kRing; ++i) inflight_[i] = false;
        read_ = write_;
        return;
    }
    while (inflight_[read_]) {
        u64 ns = 0;
        if (!device.getTimerQueryNs(queries_[read_], &ns)) break;
        last_ms_ = static_cast<f32>(ns) / 1.0e6f;
        inflight_[read_] = false;
        read_ = (read_ + 1) % kRing;
    }
}

f32 Plane::signedDistance(const glm::vec3& point) const {
    return glm::dot(normal, point) + distance;
}

void Frustum::extractFromMatrix(const glm::mat4& vp) {
    const f32* m = glm::value_ptr(vp);

    planes[0].normal = glm::vec3(m[3] + m[0], m[7] + m[4], m[11] + m[8]);
    planes[0].distance = m[15] + m[12];

    planes[1].normal = glm::vec3(m[3] - m[0], m[7] - m[4], m[11] - m[8]);
    planes[1].distance = m[15] - m[12];

    planes[2].normal = glm::vec3(m[3] + m[1], m[7] + m[5], m[11] + m[9]);
    planes[2].distance = m[15] + m[13];

    planes[3].normal = glm::vec3(m[3] - m[1], m[7] - m[5], m[11] - m[9]);
    planes[3].distance = m[15] - m[13];

    planes[4].normal = glm::vec3(m[3] + m[2], m[7] + m[6], m[11] + m[10]);
    planes[4].distance = m[15] + m[14];

    planes[5].normal = glm::vec3(m[3] - m[2], m[7] - m[6], m[11] - m[10]);
    planes[5].distance = m[15] - m[14];

    for (u32 i = 0; i < 6; ++i) {
        f32 len = glm::length(planes[i].normal);
        if (len > 1e-7f) {
            planes[i].normal /= len;
            planes[i].distance /= len;
        }
    }
}

bool Frustum::intersectsAABB(const glm::vec3& center, const glm::vec3& halfExtents) const {
    for (u32 i = 0; i < 6; ++i) {
        f32 r = halfExtents.x * std::abs(planes[i].normal.x) +
                halfExtents.y * std::abs(planes[i].normal.y) +
                halfExtents.z * std::abs(planes[i].normal.z);

        f32 dist = planes[i].signedDistance(center);

        if (dist < -r) {
            return false;
        }
    }
    return true;
}

RenderFrame::RenderFrame(GfxDevice& device, RenderContext& context,
                         resource::ResourceManager& resource_manager)
    : device_(device)
    , context_(context)
    , resource_manager_(resource_manager)
    , pool_(device) {
    target_manager_.setDevice(device);
}

RenderFrame::~RenderFrame() {
    shutdown();
}

void RenderFrame::init(u32 width, u32 height) {
    width_ = width;
    height_ = height;

    // state_tracker_ is inited once by EstellaContext (its owner); flush()/replay
    // reset() it each frame, so no per-RenderFrame init is needed here.

    // Adopt the boot-declared color space before any shader compiles below —
    // renderer_setColorSpace may run before this frame exists (pre-init).
    linear_color_ = resource::ShaderParser::linearColorSpace();

#ifdef ES_ENABLE_POSTPROCESS
    post_process_ = makeUnique<PostProcessPipeline>(device_, context_, resource_manager_);
    post_process_->setLinearOutput(linear_color_);
    // Depth layers may have been declared before the pipeline existed (the mask
    // arrives with the project, init happens on the first frame).
    post_process_->setSceneNeedsDepth(draw_list_.depthMask() != 0);
    post_process_->init(width, height);
#endif

    pool_.init();
    batch_shader_id_ = initBatchShader();

    RenderFrameContext initCtx{
        context_,
        resource_manager_,
        context_.getWhiteTextureId(),
        batch_shader_id_,
        RenderStage::Transparent,
        glm::mat4(1.0f),
        nullptr,
        this
    };
    for (auto& plugin : plugins_) {
        plugin->init(initCtx);
    }
}

void RenderFrame::shutdown() {
    for (auto& plugin : plugins_) {
        plugin->shutdown();
    }
    plugins_.clear();
    pool_.shutdown();

#ifdef ES_ENABLE_POSTPROCESS
    if (post_process_) {
        post_process_->shutdown();
        post_process_.reset();
    }
#endif

    ES_LOG_INFO("RenderFrame shutdown");
}

void RenderFrame::recreateGpuResources() {
    pool_.recreateGpuResources();
    target_manager_.recreateGpuResources();
    // The variant handles are unchanged; this re-reads the program ids behind them.
    batch_shader_id_ = initBatchShader();
#ifdef ES_ENABLE_POSTPROCESS
    if (post_process_) post_process_->recreateGpuResources();
#endif

    // Plugins cache the batch program id at init, and that id died with the
    // device — a collect pass would keep keying draws to a program the restored
    // context rejects. init() is where they take it, so init() is what runs.
    RenderFrameContext ctx{
        context_,
        resource_manager_,
        context_.getWhiteTextureId(),
        batch_shader_id_,
        RenderStage::Transparent,
        glm::mat4(1.0f),
        nullptr,
        this
    };
    for (auto& plugin : plugins_) {
        plugin->init(ctx);
    }
}

void RenderFrame::resize(u32 width, u32 height) {
    width_ = width;
    height_ = height;

#ifdef ES_ENABLE_POSTPROCESS
    if (post_process_) {
        post_process_->resize(width, height);
    }
#endif
}

void RenderFrame::begin(const glm::mat4& view_projection, RenderTargetManager::Handle target) {
    begin(view_projection, target, PassClear{});
}

void RenderFrame::begin(const glm::mat4& view_projection, RenderTargetManager::Handle target,
                        const PassClear& clear) {
    // A lost device makes the whole frame meaningless, so it is refused here
    // rather than discovered by each pass and readback failing separately.
    // in_frame_ stays false, which makes end() a no-op too: no half-frame.
    if (!device_.beginDeviceFrame()) {
        in_frame_ = false;
        return;
    }

    view_projection_ = view_projection;
    frustum_.extractFromMatrix(view_projection);
    current_target_ = target;
    current_stage_ = RenderStage::Transparent;
    in_frame_ = true;
    frame_capture_.beginCapture();

    stats_ = Stats{};

    pool_.beginFrame();
    draw_list_.clear();
    clip_state_.clear();

    openPass(clear, target);
}

// Opening the frame's target: the load-op clear, the post-process capture when one is
// engaged, the default surface otherwise. Its own method because the shadow pass draws
// through a target of its own and has to hand this one back when it is done.
void RenderFrame::openPass(const PassClear& clear, RenderTargetManager::Handle target) {
#ifdef ES_ENABLE_POSTPROCESS
    // Linear mode keeps the capture+blit engaged even with zero passes: the
    // final blit is where the mandatory linear->sRGB encode lives (the WebGL2
    // canvas framebuffer cannot be made sRGB).
    bool usePostProcess = post_process_ && post_process_->isInitialized() &&
                          ((!post_process_->isBypassed() && post_process_->getPassCount() > 0)
                           || linear_color_);
#else
    bool usePostProcess = false;
#endif

    // The pass's load-op clear, values carried in the desc (never sticky device
    // state). Region-scoped when the caller renders one camera's viewport of a
    // shared target.
    RenderPassDesc pass{};
    pass.clearColor = clear.color;
    pass.clearDepth = clear.depth;
    // Authored clear colors are sRGB; the linear frame clears in linear light.
    const glm::vec3 clearRgb = linear_color_
        ? srgbToLinearCpu({clear.colorValue.r, clear.colorValue.g, clear.colorValue.b})
        : glm::vec3{clear.colorValue.r, clear.colorValue.g, clear.colorValue.b};
    pass.clearColorValue[0] = clearRgb.r;
    pass.clearColorValue[1] = clearRgb.g;
    pass.clearColorValue[2] = clearRgb.b;
    pass.clearColorValue[3] = clear.colorValue.a;
    pass.clearX = clear.x;
    pass.clearY = clear.y;
    pass.clearW = clear.w;
    pass.clearH = clear.h;

    if (usePostProcess) {
#ifdef ES_ENABLE_POSTPROCESS
        if (target != RenderTargetManager::INVALID_HANDLE) {
            auto* rt = target_manager_.get(target);
            if (rt) {
                post_process_->setOutputTarget(rt->getFramebuffer());
            }
        }
        // Fresh begin: colors the capture's own load-op clear. When TS already
        // began the capture (renderCamera drives pp.begin first) this no-ops...
        post_process_->begin(pass.clearColorValue);
        // ...so apply the camera's (possibly region-scoped) clear to the active
        // capture surface explicitly.
        if (pass.clearColor || pass.clearDepth) {
            pass.target = post_process_->currentSceneFBO();
            device_.beginRenderPass(pass);
        }
#endif
    } else if (target != RenderTargetManager::INVALID_HANDLE) {
        auto* rt = target_manager_.get(target);
        if (rt) {
            pass.target = rt->getFramebuffer();
            device_.beginRenderPass(pass);
        }
    } else {
        // The scene may be rendering into the TS screen-capture FBO (screen post
        // stack without a per-camera stack): the clear must land on that surface —
        // blind-rebinding the default target here would break the capture.
#ifdef ES_ENABLE_POSTPROCESS
        if (post_process_) pass.target = post_process_->currentSceneFBO();
#endif
        device_.beginRenderPass(pass);
    }
}

void RenderFrame::flush() {
    if (!in_frame_ || flushed_) return;

    flushed_ = true;

    // The device can still die between begin() and here — a GL error check, a
    // spontaneous WebGPU callback. Marked flushed above first, so end() does not
    // come back for a second attempt at a frame that has nowhere to go.
    if (!device_.isDeviceUsable()) return;

    // Drop any pipeline a prior phase left bound, so the first draw re-applies its state.
    device_.invalidatePipelineCache();

    // finalize() sorts + coalesces and rewrites per-vertex texIndex into the staging, so it
    // must run before upload() ships that staging to the GPU.
    {
        ES_PROFILE_SCOPE("render.finalize");
        draw_list_.finalize(pool_);
        pool_.upload();
    }

    context_.updateFrameConstants(view_projection_);
    context_.lights().uploadAndBind();

    gpu_timer_.poll(device_);
    {
        ES_PROFILE_SCOPE("render.submit");
        gpu_timer_.begin(device_);
        draw_list_.execute(device_, pool_, context_.materials(), context_.getWhiteTextureId(),
                       &frame_capture_, context_.skinUbo());
        gpu_timer_.end(device_);
    }
    FrameProfiler::get().gpuScope("submit", gpu_timer_.lastMs());

    stats_.draw_calls = draw_list_.mergedDrawCallCount();
    for (u32 i = 0; i < draw_list_.commandCount(); ++i) {
        const auto& cmd = draw_list_.command(i);
        stats_.triangles += cmd.index_count / 3;
        switch (cmd.type) {
        case RenderType::Sprite:
        case RenderType::UIElement:
            stats_.sprites += cmd.entity_count; break;
        case RenderType::Text:     stats_.text += cmd.entity_count; break;
        case RenderType::Mesh:
        case RenderType::ExternalMesh:
        case RenderType::Trail:
            stats_.meshes += cmd.entity_count; break;
#ifdef ES_ENABLE_PARTICLES
        case RenderType::Particle: stats_.particles += cmd.entity_count; break;
#endif
        case RenderType::Shape:    stats_.shapes += cmd.entity_count; break;
#ifdef ES_ENABLE_SPINE
        case RenderType::Spine:    stats_.spine += cmd.entity_count; break;
#endif
        default: break;
        }
    }

    ES_PROFILE_COUNTER("render.culled", stats_.culled);
    ES_PROFILE_COUNTER("render.sprites", stats_.sprites);
    ES_PROFILE_COUNTER("render.text", stats_.text);
    ES_PROFILE_COUNTER("render.shapes", stats_.shapes);
#ifdef ES_ENABLE_PARTICLES
    ES_PROFILE_COUNTER("render.particles", stats_.particles);
#endif
}

void RenderFrame::end() {
    if (!in_frame_) return;

    if (!flushed_) {
        flush();
    }

#ifdef ES_ENABLE_POSTPROCESS
    // Linear mode keeps the capture+blit engaged even with zero passes: the
    // final blit is where the mandatory linear->sRGB encode lives (the WebGL2
    // canvas framebuffer cannot be made sRGB).
    bool usePostProcess = post_process_ && post_process_->isInitialized() &&
                          ((!post_process_->isBypassed() && post_process_->getPassCount() > 0)
                           || linear_color_);
#else
    bool usePostProcess = false;
#endif

    if (usePostProcess) {
#ifdef ES_ENABLE_POSTPROCESS
        ES_PROFILE_SCOPE("render.postprocess");
        gpu_timer_pp_.poll(device_);
        gpu_timer_pp_.begin(device_);
        post_process_->end();
        gpu_timer_pp_.end(device_);
        FrameProfiler::get().gpuScope("postprocess", gpu_timer_pp_.lastMs());
#endif
    } else if (current_target_ != RenderTargetManager::INVALID_HANDLE) {
        auto* rt = target_manager_.get(current_target_);
        if (rt) {
            rt->unbind();
        }
    }

    const f32 submitMs = gpu_timer_.lastMs();
    const f32 ppMs = usePostProcess ? gpu_timer_pp_.lastMs() : 0.0f;
    stats_.gpu_time_ms = submitMs < 0.0f ? -1.0f : submitMs + (ppMs > 0.0f ? ppMs : 0.0f);

    // The frame's pass closes HERE, not at the next begin: a WebGPU backend
    // submits on endRenderPass, and a surface texture acquired this task must
    // not ride into the next one (the swapchain recycles it at task end). On
    // GL this is just the default-framebuffer rebind.
    device_.endRenderPass();
    // ...and the frame itself ends here, which is when a borrowed swapchain
    // image goes back. Not at the pass: this frame may have opened several.
    device_.endFrame();

    frame_capture_.endCapture();
    in_frame_ = false;
    flushed_ = false;

    // Render is the frame's last C++ work: earlier scopes are already accumulated.
    FrameProfiler::get().commit();
}

void RenderFrame::replayToDrawCall(i32 stopAtDrawCall) {
    if (draw_list_.commandCount() == 0 || stopAtDrawCall < 0) return;

    if (replay_rt_ == 0) {
        replay_rt_ = target_manager_.create(width_, height_, false, false);
    } else {
        auto* rt = target_manager_.get(replay_rt_);
        if (rt && (rt->getWidth() != width_ || rt->getHeight() != height_)) {
            rt->resize(width_, height_);
        }
    }

    auto* rt = target_manager_.get(replay_rt_);
    if (!rt) return;

    RenderPassDesc replayPass{rt->getFramebuffer(), /*clearColor=*/true};
    replayPass.clearColorValue[3] = 0.0f;  // transparent black
    device_.beginRenderPass(replayPass);
    device_.setViewport(0, 0, width_, height_);

    frame_capture_.setReplayMode(stopAtDrawCall + 1);

    context_.updateFrameConstants(view_projection_);
    context_.lights().uploadAndBind();
    draw_list_.execute(device_, pool_, context_.materials(), context_.getWhiteTextureId(),
                       &frame_capture_, context_.skinUbo());

    // Leave scissor disabled for whatever renders next; invalidate so the next
    // setPipeline re-applies its full state (stencil included).
    device_.setScissorTest(false);
    device_.invalidatePipelineCache();

    frame_capture_.clearReplayMode();

    rt->unbind();

    // Async readback seam: the pass is closed first (WebGPU records the copy
    // outside a pass); pollSnapshotReadback() lands the pixels.
    if (snapshot_readback_ != ReadbackHandle::Invalid) device_.discardReadback(snapshot_readback_);
    snapshot_w_ = width_;
    snapshot_h_ = height_;
    snapshot_pixels_.clear();
    snapshot_readback_ = device_.requestReadback(rt->getFramebuffer(), width_, height_);
}

void RenderFrame::renderToTarget(ecs::Registry& registry, const glm::mat4& viewProjection, u32 w, u32 h) {
    if (w == 0 || h == 0) return;
    if (!device_.isDeviceUsable()) return;

    if (preview_rt_ == 0) {
        preview_rt_ = target_manager_.create(w, h, /*depth=*/false, /*linearFilter=*/false);
    } else if (auto* existing = target_manager_.get(preview_rt_);
               existing && (existing->getWidth() != w || existing->getHeight() != h)) {
        existing->resize(w, h);
    }
    auto* rt = target_manager_.get(preview_rt_);
    if (!rt) return;

    RenderPassDesc previewPass{rt->getFramebuffer(), /*clearColor=*/true};
    previewPass.clearColorValue[3] = 0.0f;  // transparent black
    device_.beginRenderPass(previewPass);
    device_.setViewport(0, 0, w, h);

    // A self-contained collect (begin()'s setup minus post-process) + execute (flush()'s body),
    // drawn to the bound preview target. Reuses the real collect+material+execute path so a
    // preview is pixel-identical to the viewport.
    view_projection_ = viewProjection;
    frustum_.extractFromMatrix(viewProjection);
    current_stage_ = RenderStage::Transparent;
    pool_.beginFrame();
    draw_list_.clear();
    clip_state_.clear();
    frame_capture_.beginCapture();

    collectAll(registry);

    draw_list_.finalize(pool_);
    pool_.upload();
    context_.updateFrameConstants(viewProjection);
    context_.lights().uploadAndBind();
    draw_list_.execute(device_, pool_, context_.materials(), context_.getWhiteTextureId(),
                       &frame_capture_, context_.skinUbo());
    frame_capture_.endCapture();

    rt->unbind();
    device_.invalidatePipelineCache();

    // Async readback seam (same shape as the replay snapshot above).
    if (preview_readback_ != ReadbackHandle::Invalid) device_.discardReadback(preview_readback_);
    preview_w_ = w;
    preview_h_ = h;
    preview_pixels_.clear();
    preview_readback_ = device_.requestReadback(rt->getFramebuffer(), w, h);
}

i32 RenderFrame::pollSnapshotReadback() {
    return pollReadback(snapshot_readback_, snapshot_pixels_, snapshot_w_, snapshot_h_);
}

i32 RenderFrame::pollPreviewReadback() {
    return pollReadback(preview_readback_, preview_pixels_, preview_w_, preview_h_);
}

i32 RenderFrame::pollReadback(ReadbackHandle& handle, std::vector<u8>& pixels, u32 w, u32 h) {
    if (handle == ReadbackHandle::Invalid) {
        // No readback in flight: the last landed pixels (if any) stay available.
        return pixels.empty() ? 2 : 1;
    }
    switch (device_.pollReadback(handle)) {
        case GfxReadbackStatus::Pending:
            return 0;
        case GfxReadbackStatus::Ready: {
            pixels.resize(static_cast<usize>(w) * h * 4);
            const bool ok = device_.takeReadback(handle, pixels.data(), pixels.size());
            handle = ReadbackHandle::Invalid;
            if (!ok) pixels.clear();
            return ok ? 1 : 2;
        }
        case GfxReadbackStatus::Failed:
        default:
            handle = ReadbackHandle::Invalid;
            pixels.clear();
            return 2;
    }
}

void RenderFrame::setEntityClipRect(u32 entity, i32 x, i32 y, i32 w, i32 h) {
    clip_rects_[entity] = ScissorRect{x, y, w, h};
}

void RenderFrame::clearEntityClipRect(u32 entity) {
    clip_rects_.erase(entity);
}

void RenderFrame::clearAllClipRects() {
    clip_rects_.clear();
}

void RenderFrame::setEntityStencilMask(u32 entity, i32 refValue) {
    stencil_masks_[entity] = {refValue, true};
}

void RenderFrame::setEntityStencilTest(u32 entity, i32 refValue) {
    stencil_masks_[entity] = {refValue, false};
}

void RenderFrame::clearEntityStencilMask(u32 entity) {
    stencil_masks_.erase(entity);
}

void RenderFrame::clearAllStencilMasks() {
    stencil_masks_.clear();
}

// ─── Mask Processing ── see RenderFrameMask.cpp ─────────────────────────────

// ─── Tile/Spine Submit ── see RenderFrameSubmit.cpp ──────────────────────────

// ============================================================================
// Plugin Pipeline
// ============================================================================

void RenderFrame::addPlugin(std::unique_ptr<RenderTypePlugin> plugin) {
    plugins_.push_back(std::move(plugin));
}

void RenderFrame::buildClipState() {
    clip_state_.clear();

    for (const auto& [entity, rect] : clip_rects_) {
        clip_state_.setScissor(entity, rect.x, rect.y, rect.w, rect.h);
    }

    for (const auto& [entity, info] : stencil_masks_) {
        if (info.is_mask) {
            clip_state_.setStencilMask(entity, info.ref_value);
        } else {
            clip_state_.setStencilTest(entity, info.ref_value);
        }
    }
}

RenderFrameContext RenderFrame::makeContext() {
    return {
        context_,
        resource_manager_,
        context_.getWhiteTextureId(),
        batch_shader_id_,
        current_stage_,
        view_projection_,
        &context_.materials(),
        this,
        false,
        shadow_texture_id_,
        environment_texture_id_
    };
}

/// Where a light aims: the entity's forward, its rotation applied to -Z. A light
/// without a Transform aims the way an unrotated one does, which is into the screen —
/// where a 2D scene's light comes from.
static glm::vec3 lightForward(ecs::Transform* transform) {
    if (!transform) return glm::vec3(0.0f, 0.0f, -1.0f);
    transform->ensureDecomposed();
    return transform->worldRotation * glm::vec3(0.0f, 0.0f, -1.0f);
}

void RenderFrame::collectLights(ecs::Registry& registry) {
    LightStore& lights = context_.lights();
    lights.clear();
    shadow_light_slot_ = -1;
    environment_texture_id_ = 0;
    draw_sky_ = false;

    // Gather non-ambient lights, then (if over the UBO's cap) keep the most intense — the
    // brightest contribute most, and an explicit importance cull beats silently dropping
    // whichever happened to come last in iteration order. Ambient lights sum without a cap.
    std::vector<CollectedLight>& collected = light_scratch_;
    collected.clear();

    // A light's Transform need is type-dependent. Ambient is a flat scene-wide term and
    // reads none of it; Directional takes only the rotation, so it works without one and
    // aims into the screen; Point/Spot need a position and are skipped without one.
    auto view = registry.view<ecs::Light2D>();
    for (auto entity : view) {
        const auto& light = view.get(entity);
        if (!light.enabled || light.intensity <= 0.0f) continue;

        const auto type = static_cast<ecs::Light2DType>(light.type);
        // color.a is unused; intensity carries the strength. Authored sRGB ->
        // linear when the frame lights in linear space.
        const glm::vec3 rgb = linear_color_ ? srgbToLinearCpu(glm::vec3{light.color})
                                            : glm::vec3{light.color};
        if (type == ecs::Light2DType::Ambient) {
            // An environment REPLACES this light's flat term rather than adding to
            // it: its coefficients already carry the same colour, and summing both
            // would light the scene twice from one source.
            if (collectEnvironment(light, rgb * light.intensity)) continue;
            lights.addAmbient(rgb * light.intensity);
            continue;
        }

        GpuLight2D gpu;
        bool castsMeshShadow = false;
        gpu.color = glm::vec4(rgb, light.intensity);
        // shadow.x = penumbra softness (all types); shadow.y = directional march distance (only the
        // directional branch of shadowFactor2D reads it; 0 keeps directional shadows off).
        gpu.shadow = glm::vec4(std::max(light.shadowSoftness, 0.0f),
                               std::max(light.shadowDistance, 0.0f), 0.0f, 0.0f);
        if (type == ecs::Light2DType::Directional) {
            // z=1 flags directional (no attenuation) in the shader; w carries the aim's third
            // component, which only a directional light has a use for — point and spot spend
            // that slot on their falloff radius.
            const glm::vec3 aim = lightForward(registry.tryGet<ecs::Transform>(entity));
            gpu.posDir = glm::vec4(aim.x, aim.y, 1.0f, aim.z);
            if (light.meshShadows && shadow_light_slot_ < 0) {
                castsMeshShadow = true;
                shadow_light_dir_ = aim;
                shadow_light_extent_ = std::max(light.shadowExtent, 0.0f);
            }
        } else {  // Point / Spot — world position from the Transform, w=falloff radius.
            auto* transform = registry.tryGet<ecs::Transform>(entity);
            if (!transform) continue;  // a positional light with no position casts nothing
            transform->ensureDecomposed();
            const glm::vec3 p = transform->worldPosition;
            const f32 typeId = (type == ecs::Light2DType::Spot) ? 2.0f : 0.0f;
            gpu.posDir = glm::vec4(p.x, p.y, typeId, light.radius);
            // The height a surface with real geometry measures against. A sprite has no
            // depth of its own and keeps the plane's convention, so this reaches only the
            // MESH_NORMALS half of the lighting loop.
            gpu.shadow.z = p.z;
            if (type == ecs::Light2DType::Spot) {
                // Split across two slots because the two shading halves read different
                // parts: the plane's xy, and the whole of it in three.
                const glm::vec3 aim = lightForward(transform);
                // A cone aimed straight into the screen has no axis IN the plane, and the
                // plane's half of the shading has nowhere else to read one from — so it
                // keeps the direction an unrotated spot has always lit along.
                glm::vec2 planar(aim.x, aim.y);
                if (glm::dot(planar, planar) <= 1e-8f) planar = glm::vec2(0.0f, -1.0f);
                gpu.spot = glm::vec4(planar.x, planar.y,
                                     std::cos(glm::radians(light.innerAngle * 0.5f)),
                                     std::cos(glm::radians(light.outerAngle * 0.5f)));
                gpu.shadow.w = aim.z;
            }
        }
        collected.push_back({gpu, castsMeshShadow});
    }

    if (collected.size() > MAX_LIGHTS_2D) {
        std::partial_sort(collected.begin(), collected.begin() + MAX_LIGHTS_2D, collected.end(),
                          [](const CollectedLight& a, const CollectedLight& b) {
                              return a.gpu.color.a > b.gpu.color.a;
                          });
        ES_LOG_WARN("collectLights: {} lights exceed the {}-light cap; keeping the brightest",
                    collected.size(), MAX_LIGHTS_2D);
        collected.resize(MAX_LIGHTS_2D);
    }
    for (u32 slot = 0; slot < collected.size(); ++slot) {
        if (collected[slot].castsMeshShadow) shadow_light_slot_ = static_cast<i32>(slot);
        lights.addLight(collected[slot].gpu);
    }

    // Shadow occluders: each enabled ShadowCaster2D becomes a world-space AABB (centered on its
    // Transform, `size` wide/tall). The injected shadowFactor2D blocks point/spot light at any
    // fragment whose segment to the light crosses a box. Past the cap are silently dropped.
    auto occluders = registry.view<ecs::Transform, ecs::ShadowCaster2D>();
    for (auto entity : occluders) {
        const auto& caster = occluders.get<ecs::ShadowCaster2D>(entity);
        if (!caster.enabled) continue;
        auto& transform = occluders.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        const glm::vec3 p = transform.worldPosition;
        const f32 hx = caster.size.x * 0.5f;
        const f32 hy = caster.size.y * 0.5f;
        lights.addOccluder(glm::vec4(p.x - hx, p.y - hy, p.x + hx, p.y + hy));
    }
}

bool RenderFrame::collectEnvironment(const ecs::Light2D& light, const glm::vec3& scale) {
    if (!light.environment.isValid()) return false;
    const Environment* environment = resource_manager_.getEnvironment(light.environment);
    if (!environment) return false;

    u32 textureId = 0;
    if (environment->hasSpecular()) {
        if (Texture* atlas = resource_manager_.getTexture(environment->specular)) {
            textureId = atlas->getId();
        }
    }
    const glm::vec4 params{textureId != 0 ? 1.0f : 0.0f, environment->maxRange,
                           static_cast<f32>(environment->mipCount) - 1.0f,
                           environment->faceSize};
    if (!context_.lights().setEnvironment(environment->irradiance.data(), params, scale)) {
        return false;
    }
    environment_texture_id_ = textureId;
    // Only a reflection can be looked at directly: the nine coefficients are the
    // sky averaged over every direction, which as a background is one flat colour.
    draw_sky_ = light.drawEnvironment && textureId != 0;
    return true;
}

/// Side length of ONE cascade. One size for every scene: the coverage adapts to the
/// camera instead, so the texel density a scene gets is a property of how far it asked
/// the light to reach rather than of a knob nobody can calibrate.
static constexpr u32 kShadowMapSize = 1024;

/// The atlas holding them, 2x2. The RHI has no array textures — the same reason the
/// environment reflection is an atlas — so a cascade is a quadrant of one texture.
static constexpr u32 kShadowAtlasSize = kShadowMapSize * 2;

/// Depth bias in the map's own [0,1] units. Large enough for a 1024 map over a
/// camera-sized area to stop shadowing itself, small enough not to detach contact.
static constexpr f32 kShadowBias = 0.0015f;

/// The world box every GPU-resident mesh occupies, or false when none does — what
/// a shadow map has to cover, casters and receivers alike. Rotation is ignored,
/// the same approximation MeshPlugin's own cull uses.
bool RenderFrame::meshWorldBounds(ecs::Registry& registry, glm::vec3& outMin, glm::vec3& outMax) {
    auto meshes = registry.view<ecs::Transform, ecs::Mesh2D>();
    bool any = false;
    for (auto entity : meshes) {
        const auto& mesh = meshes.get<ecs::Mesh2D>(entity);
        if (!mesh.enabled || !mesh.mesh.isValid()) continue;
        const Mesh* resident = resource_manager_.getMesh(mesh.mesh);
        if (!resident) continue;
        auto& transform = meshes.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        const glm::vec3 scale = transform.worldScale;
        const glm::vec3 centre = transform.worldPosition
                               + (resident->localMin + resident->localMax) * 0.5f * scale;
        const glm::vec3 half = glm::abs((resident->localMax - resident->localMin) * 0.5f * scale);
        outMin = any ? glm::min(outMin, centre - half) : centre - half;
        outMax = any ? glm::max(outMax, centre + half) : centre + half;
        any = true;
    }
    return any;
}

/// The camera frustum's eight world corners, near plane first (GL clip z in [-1,1],
/// which both backends' shared projection helpers write).
static void frustumCorners(const glm::mat4& invVP, glm::vec3 out[8]) {
    u32 at = 0;
    for (f32 z : {-1.0f, 1.0f}) {
        for (f32 y : {-1.0f, 1.0f}) {
            for (f32 x : {-1.0f, 1.0f}) {
                const glm::vec4 p = invVP * glm::vec4(x, y, z, 1.0f);
                out[at++] = glm::vec3(p) / p.w;
            }
        }
    }
}

/// Where cascade boundary @p i falls along near..far, as a fraction. Logarithmic is
/// the split that gives every cascade equal texel density, uniform keeps the near one
/// from collapsing when near is small; 0.75 is the standard mix of the two.
static f32 splitFraction(u32 i, u32 count, f32 nearDist, f32 farDist) {
    const f32 t = static_cast<f32>(i) / static_cast<f32>(count);
    const f32 logSplit = nearDist * std::pow(farDist / nearDist, t);
    const f32 uniform = nearDist + (farDist - nearDist) * t;
    const f32 d = uniform + 0.75f * (logSplit - uniform);
    return (d - nearDist) / std::max(farDist - nearDist, 1e-6f);
}

void RenderFrame::renderShadowMap(ecs::Registry& registry) {
    shadow_texture_id_ = 0;
    // Zeroed params first: a matrix that outlived its map would shadow the scene
    // against geometry from a frame that no longer exists.
    context_.lights().setShadow(nullptr, 0, glm::vec4(0.0f), glm::vec4(0.0f));
    if (!in_frame_ || shadow_light_slot_ < 0 || !device_.isDeviceUsable()) return;

    if (shadow_rt_ == 0) {
        shadow_rt_ = target_manager_.create(kShadowAtlasSize, kShadowAtlasSize,
                                            /*depth=*/true, /*linearFilter=*/false);
    }
    auto* rt = target_manager_.get(shadow_rt_);
    if (!rt) return;

    const glm::mat4 invVP = glm::inverse(view_projection_);
    // Clip's z axis back in world: w != 0 is an eye point, w == 0 says the projection
    // is orthographic and there is none. Cascades only pay off under perspective —
    // an orthographic view already spends its texels evenly over what it can see.
    const glm::vec4 eye = invVP * glm::vec4(0.0f, 0.0f, 1.0f, 0.0f);
    const bool perspective = std::abs(eye.w) > 1e-6f;
    // A fixed reach is the author saying what the map covers; splitting it would
    // hand three quarters of the atlas to slices they never asked for.
    const u32 cascades = (perspective && shadow_light_extent_ <= 0.0f) ? MAX_SHADOW_CASCADES : 1;

    glm::vec3 corners[8];
    frustumCorners(invVP, corners);
    glm::vec3 boundsMin(0.0f), boundsMax(0.0f);
    const bool haveBounds = meshWorldBounds(registry, boundsMin, boundsMax);

    f32 nearDist = 0.0f, farDist = 1.0f;
    if (perspective) {
        const glm::vec3 eyePos = glm::vec3(eye) / eye.w;
        nearDist = glm::length((corners[0] + corners[3]) * 0.5f - eyePos);
        farDist = glm::length((corners[4] + corners[7]) * 0.5f - eyePos);
        // A near plane at zero would make the logarithmic split infinite, and one far
        // behind the far plane is a camera nothing can be seen through.
        nearDist = std::max(nearDist, 1e-3f);
        farDist = std::max(farDist, nearDist * 1.001f);
    }

    // The shader lights a surface from normalize(-aim), so rays travel the other way.
    const glm::vec3 toLight = glm::normalize(-shadow_light_dir_);
    // An up that cannot be parallel to it, whichever way the light points.
    const glm::vec3 up = std::abs(toLight.z) > 0.99f ? glm::vec3(0.0f, 1.0f, 0.0f)
                                                     : glm::vec3(0.0f, 0.0f, 1.0f);
    // Rotation only, for snapping a centre to the map's grid in the light's own axes.
    const glm::mat4 lightRot = glm::lookAt(glm::vec3(0.0f), -toLight, up);
    const glm::mat4 lightRotInv = glm::inverse(lightRot);

    const glm::mat4 sceneVP = view_projection_;
    const GfxDevice::Viewport sceneViewport = device_.viewport();
    glm::mat4 matrices[MAX_SHADOW_CASCADES];
    glm::vec4 bias(0.0f);

    for (u32 c = 0; c < cascades; ++c) {
        glm::vec3 centre(0.0f);
        f32 radius = 1.0f;
        if (cascades == 1) {
            // What the map covers: the 3D geometry, unless the light asked for a fixed
            // reach. A radius, so coverage does not change as the light turns.
            const CameraWorldRect view = computeCameraWorldRect(sceneVP);
            const f32 fitted = haveBounds
                ? 0.5f * glm::length(boundsMax - boundsMin)
                : 0.5f * glm::length(glm::vec2(view.right - view.left, view.top - view.bottom));
            radius = shadow_light_extent_ > 0.0f ? shadow_light_extent_ : std::max(fitted, 1.0f);
            centre = haveBounds ? (boundsMin + boundsMax) * 0.5f
                                : glm::vec3(view.center.x, view.center.y, 0.0f);
        } else {
            // This slice of the view, as a sphere: a box would grow and shrink as the
            // light turns, and the texel density with it.
            const f32 t0 = splitFraction(c, cascades, nearDist, farDist);
            const f32 t1 = splitFraction(c + 1, cascades, nearDist, farDist);
            glm::vec3 slice[8];
            for (u32 i = 0; i < 4; ++i) {
                const glm::vec3 ray = corners[i + 4] - corners[i];
                slice[i] = corners[i] + ray * t0;
                slice[i + 4] = corners[i] + ray * t1;
            }
            for (const glm::vec3& p : slice) centre += p;
            centre *= 0.125f;
            for (const glm::vec3& p : slice) radius = std::max(radius, glm::length(p - centre));
            // Snap to the map's own texel grid, in the light's axes: without it the
            // cascade slides continuously with the camera and every shadow edge
            // crawls along the geometry a texel at a time.
            const f32 texel = (radius * 2.0f) / static_cast<f32>(kShadowMapSize);
            glm::vec3 inLight = glm::vec3(lightRot * glm::vec4(centre, 1.0f));
            inLight.x = std::floor(inLight.x / texel) * texel;
            inLight.y = std::floor(inLight.y / texel) * texel;
            centre = glm::vec3(lightRotInv * glm::vec4(inLight, 1.0f));
        }

        // ★ How far back the near plane goes. A cascade covers a slice of the VIEW,
        // but what shadows it can stand anywhere between the slice and the light —
        // clip at the slice and the caster is not drawn, and nothing says why.
        f32 castDistance = radius * 2.0f;
        if (haveBounds) {
            for (u32 i = 0; i < 8; ++i) {
                const glm::vec3 corner((i & 1) ? boundsMax.x : boundsMin.x,
                                       (i & 2) ? boundsMax.y : boundsMin.y,
                                       (i & 4) ? boundsMax.z : boundsMin.z);
                castDistance = std::max(castDistance, glm::dot(corner - centre, toLight));
            }
        }
        const glm::mat4 lightView = glm::lookAt(centre + toLight * castDistance, centre, up);
        // Zero-to-one depth on purpose: the engine's shared ortho() is the GL convention
        // (z in [-1,1]) and WebGPU clips everything below 0 of it. Written out here rather
        // than reused, because this matrix is the one place the choice is free.
        glm::mat4 lightProj(1.0f);
        const f32 range = castDistance + radius * 2.0f;
        lightProj[0][0] = 1.0f / radius;
        lightProj[1][1] = 1.0f / radius;
        lightProj[2][2] = -1.0f / range;
        lightProj[3][2] = 0.0f;
        matrices[c] = lightProj * lightView;
        // Scaled by what a texel is worth AND by what a unit of packed depth spans:
        // the number stopping the near cascade shadowing itself would let a coarser
        // one detach from whatever casts into it.
        bias[static_cast<int>(c)] = kShadowBias * std::max(radius, 1.0f)
                                  / (0.5f * static_cast<f32>(kShadowMapSize))
                                  * (4.0f * std::max(radius, 1.0f) / std::max(range, 1.0f));

        // A self-contained pass, in the shape renderToTarget uses: swap what the frame is
        // looking through, collect only what casts, draw, and hand the target back.
        RenderPassDesc pass{rt->getFramebuffer(), /*clearColor=*/c == 0};
        // Depth too: the map keeps the NEAREST occluder, which is the depth buffer's job,
        // and last frame's contents would reject this frame's geometry outright.
        pass.clearDepth = true;
        // White is depth 1 unpacked — "nothing here", so an untouched texel never shadows.
        pass.clearColorValue[0] = pass.clearColorValue[1] = pass.clearColorValue[2] = 1.0f;
        pass.clearColorValue[3] = 1.0f;
        device_.beginRenderPass(pass);
        // This cascade's quadrant, in the order cascadeOrigin() reads them back: 0
        // lower-left, 1 lower-right, 2 upper-left, 3 upper-right.
        device_.setViewport((c % 2) * kShadowMapSize, (c / 2) * kShadowMapSize,
                            kShadowMapSize, kShadowMapSize);

        view_projection_ = matrices[c];
        frustum_.extractFromMatrix(matrices[c]);
        pool_.beginFrame();
        draw_list_.clear();

        auto ctx = makeContext();
        ctx.shadow_pass = true;
        RenderCollectContext collectCtx{registry, frustum_, clip_state_, pool_, draw_list_, ctx,
                                        computeCameraWorldRect(matrices[c])};
        for (auto& plugin : plugins_) plugin->collect(collectCtx);

        draw_list_.finalize(pool_);
        pool_.upload();
        context_.updateFrameConstants(matrices[c]);
        // The depth variant is still a Lit2D shader and still declares the light block,
        // and a draw whose declared UBO is unbound is undefined behaviour that draws
        // nothing — the whole pass came back empty for exactly this.
        context_.lights().uploadAndBind();
        draw_list_.execute(device_, pool_, context_.materials(), context_.getWhiteTextureId(),
                           nullptr, context_.skinUbo());
    }

    rt->unbind();
    device_.invalidatePipelineCache();

    shadow_texture_id_ = static_cast<u32>(rt->getColorTexture());
    context_.lights().setShadow(
        matrices, cascades,
        glm::vec4(1.0f, static_cast<f32>(cascades), 1.0f / static_cast<f32>(kShadowAtlasSize),
                  static_cast<f32>(shadow_light_slot_)),
        bias);

    // Back to the frame's own target and camera. The scene has drawn nothing yet, so
    // re-opening the pass costs a load rather than the frame's contents.
    view_projection_ = sceneVP;
    frustum_.extractFromMatrix(sceneVP);
    pool_.beginFrame();
    draw_list_.clear();
    openPass(PassClear{}, current_target_);
    device_.setViewport(sceneViewport.x, sceneViewport.y, sceneViewport.w, sceneViewport.h);
}

/**
 * The background an environment is, as a quad on the far plane. Not a plugin and
 * not an entity: a sky belongs to no transform and is culled by nothing. Its
 * corners are the far plane's, unprojected, so a fragment's direction is the one
 * from the eye through it — which viewDirection() already answers.
 */
void RenderFrame::collectSky(RenderCollectContext& ctx) {
    if (!draw_sky_ || environment_texture_id_ == 0) return;
    if (!sky_compiled_) {
        sky_compiled_ = true;
        auto parsed = resource::ShaderParser::parse(ShaderEmbeds::SKY);
        const auto target = resource_manager_.preferredShaderTarget();
        const std::vector<std::string> features{"ES_ENV_MAP"};
        resource::ShaderHandle handle = resource_manager_.createShaderWithBindings(
            resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "",
                                                  features, target),
            resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "",
                                                  features, target),
            {}, resource_manager_.preferredShaderLanguage());
        if (auto* shader = resource_manager_.getShader(handle)) sky_program_ = shader->getProgramId();
    }
    if (sky_program_ == 0) return;

    // The far plane's four corners in world space. Clip z = 1 is that plane under
    // both backends' shared projection, and w divides out whichever it is.
    const glm::mat4 invVP = glm::inverse(ctx.frame_context.view_projection);
    glm::vec3 corners[4];
    const glm::vec2 ndc[4] = {{-1.0f, -1.0f}, {1.0f, -1.0f}, {1.0f, 1.0f}, {-1.0f, 1.0f}};
    for (u32 i = 0; i < 4; ++i) {
        const glm::vec4 p = invVP * glm::vec4(ndc[i], 1.0f, 1.0f);
        corners[i] = glm::vec3(p) / p.w;
    }

    BatchDrawKey key{};
    key.stage = RenderStage::Background;
    key.layer = std::numeric_limits<i32>::min();
    key.shaderId = sky_program_;
    key.blend = BlendMode::None;
    key.layoutId = LayoutId::Sky;
    // Slot 0 is filled with white and never sampled: the atlas rides the unit the
    // shaders pin it to, and the fill is what the slot walk below it expects.
    key.textureId = ctx.frame_context.white_texture_id;
    key.envTextureId = environment_texture_id_;
    key.type = RenderType::Mesh;
    // Neither tested nor written: the sky is behind everything by being first, and
    // depth of its own would fight the geometry that draws over it.
    key.depthTest = false;
    key.depthWrite = false;
    appendIndexedDraw(ctx.buffer_pool, ctx.draw_list, ctx.clip_state, corners, 4,
                      BATCH_QUAD_INDICES, 6, key);
}

void RenderFrame::collectAll(ecs::Registry& registry, u32 skipFlags) {
    ES_PROFILE_SCOPE("render.collect");
    buildClipState();
    collectLights(registry);
    renderShadowMap(registry);

    auto ctx = makeContext();

    RenderCollectContext collectCtx{registry, frustum_, clip_state_, pool_, draw_list_, ctx,
                                    computeCameraWorldRect(ctx.view_projection)};
    collectSky(collectCtx);
    for (auto& plugin : plugins_) {
        if (skipFlags != 0 && (skipFlags & plugin->skipFlag()) != 0) continue;
        plugin->collect(collectCtx);
    }
}

glm::vec3 srgbToLinearCpu(const glm::vec3& c) {
    auto conv = [](f32 v) {
        return v <= 0.04045f ? v / 12.92f : std::pow((v + 0.055f) / 1.055f, 2.4f);
    };
    return {conv(c.r), conv(c.g), conv(c.b)};
}

void RenderFrame::setColorSpace(bool linear) {
    linear_color_ = linear;
    resource::ShaderParser::setLinearColorSpace(linear);
#ifdef ES_ENABLE_POSTPROCESS
    if (post_process_) post_process_->setLinearOutput(linear);
#endif
}

u32 RenderFrame::initBatchShader() {
    // The default (featureless) batch program; seeds the variant cache.
    return batchProgram({});
}

u32 RenderFrame::batchProgram(const std::vector<std::string>& features) {
    const std::string key = resource::ShaderParser::variantKey(features);
    auto it = batch_variants_.find(key);
    if (it == batch_variants_.end()) {
        it = batch_variants_.emplace(key, compileBatchVariant(features)).first;
    }
    // Resolved per lookup rather than cached: the program id is what the device
    // replaces on a rebuild, and the handle is what survives it.
    Shader* shader = resource_manager_.getShader(it->second);
    return shader ? shader->getProgramId() : 0;
}

resource::ShaderHandle RenderFrame::compileBatchVariant(const std::vector<std::string>& features) {
    // The batch shader is authored as a single .esshader with its WGSL twin,
    // embedded for the web build. Parse it and assemble the two stages for the
    // preferred target (single source of truth), injecting the requested
    // feature permutation — GLSL as #defines, WGSL through the assembly-time
    // preprocessor.
    const auto target = resource_manager_.preferredShaderTarget();
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::BATCH);
    // LIT is a Lit2D-domain variant: the domain drives the lighting injection,
    // same path as Lit2D material shaders.
    if (std::find(features.begin(), features.end(), "LIT") != features.end()) {
        parsed.domain = "Lit2D";
    }
    resource::ShaderHandle handle = resource_manager_.createShaderWithBindings(
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", features, target),
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", features, target),
        {{0, "a_position"}, {1, "a_color"}, {2, "a_texCoord"}},
        resource_manager_.preferredShaderLanguage());

    Shader* shader = resource_manager_.getShader(handle);
    if (shader && shader->isValid()) {
        shader->bind();
        // Bind the 8 multi-texture samplers to units 0..7 (per-program, set once).
        for (i32 i = 0; i < 8; ++i) {
            i32 loc = device_.getUniformLocation(shader->handle(),
                                                 ("u_textures[" + std::to_string(i) + "]").c_str());
            if (loc >= 0) device_.setUniform1i(loc, i);
        }
        shader->unbind();
        return handle;
    }

    const std::string vk = resource::ShaderParser::variantKey(features);
    ES_LOG_ERROR("Failed to create batch shader variant '{}'", vk.empty() ? "default" : vk.c_str());
    return {};
}

}  // namespace esengine

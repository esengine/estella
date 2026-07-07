// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "RenderFrame.hpp"
#include "Shader.hpp"
#include "ShaderEmbeds.generated.hpp"
#include "webgpu/WGSLTwins.hpp"
#include "LightStore.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Light2D.hpp"
#include "../ecs/components/ShadowCaster2D.hpp"
#include "../resource/ShaderParser.hpp"
#include "../core/Log.hpp"
#include "../core/FrameProfiler.hpp"

#include <glm/gtc/type_ptr.hpp>

#include <algorithm>
#include <cmath>
#include <vector>

namespace esengine {

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

#ifdef ES_ENABLE_POSTPROCESS
    post_process_ = makeUnique<PostProcessPipeline>(device_, context_, resource_manager_);
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

#ifdef ES_ENABLE_POSTPROCESS
    bool usePostProcess = post_process_ && post_process_->isInitialized() &&
                          !post_process_->isBypassed() && post_process_->getPassCount() > 0;
#else
    bool usePostProcess = false;
#endif

    // The pass's load-op clear, values carried in the desc (never sticky device
    // state). Region-scoped when the caller renders one camera's viewport of a
    // shared target.
    RenderPassDesc pass{};
    pass.clearColor = clear.color;
    pass.clearDepth = clear.depth;
    pass.clearColorValue[0] = clear.colorValue.r;
    pass.clearColorValue[1] = clear.colorValue.g;
    pass.clearColorValue[2] = clear.colorValue.b;
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
        draw_list_.execute(device_, pool_, context_.materials(), &frame_capture_);
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
    bool usePostProcess = post_process_ && post_process_->isInitialized() &&
                          !post_process_->isBypassed() && post_process_->getPassCount() > 0;
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
    draw_list_.execute(device_, pool_, context_.materials(), &frame_capture_);

    // Leave scissor disabled for whatever renders next; invalidate so the next
    // setPipeline re-applies its full state (stencil included).
    device_.setScissorTest(false);
    device_.invalidatePipelineCache();

    frame_capture_.clearReplayMode();

    u32 pixelCount = width_ * height_ * 4;
    snapshot_pixels_.resize(pixelCount);
    device_.readPixels(0, 0, width_, height_, GfxPixelFormat::RGBA8, snapshot_pixels_.data());

    rt->unbind();
}

void RenderFrame::renderToTarget(ecs::Registry& registry, const glm::mat4& viewProjection, u32 w, u32 h) {
    if (w == 0 || h == 0) return;

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
    draw_list_.execute(device_, pool_, context_.materials(), &frame_capture_);
    frame_capture_.endCapture();

    preview_w_ = w;
    preview_h_ = h;
    preview_pixels_.resize(static_cast<usize>(w) * h * 4);
    device_.readPixels(0, 0, w, h, GfxPixelFormat::RGBA8, preview_pixels_.data());

    rt->unbind();
    device_.invalidatePipelineCache();
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
        this
    };
}

void RenderFrame::collectLights(ecs::Registry& registry) {
    LightStore& lights = context_.lights();
    lights.clear();

    // Gather non-ambient lights, then (if over the UBO's cap) keep the most intense — the
    // brightest contribute most, and an explicit importance cull beats silently dropping
    // whichever happened to come last in iteration order. Ambient lights sum without a cap.
    std::vector<GpuLight2D> collected;

    // A light's Transform need is type-dependent: Ambient (a flat scene-wide term) and
    // Directional (parallel rays; direction is intrinsic) have no spatial anchor and work
    // without one — only Point/Spot sample a world position.
    auto view = registry.view<ecs::Light2D>();
    for (auto entity : view) {
        const auto& light = view.get(entity);
        if (!light.enabled || light.intensity <= 0.0f) continue;

        const auto type = static_cast<ecs::Light2DType>(light.type);
        const glm::vec3 rgb{light.color};  // color.a is unused; intensity carries the strength
        if (type == ecs::Light2DType::Ambient) {
            lights.addAmbient(rgb * light.intensity);
            continue;
        }

        GpuLight2D gpu;
        gpu.color = glm::vec4(rgb, light.intensity);
        // shadow.x = penumbra softness (all types); shadow.y = directional march distance (only the
        // directional branch of shadowFactor2D reads it; 0 keeps directional shadows off).
        gpu.shadow = glm::vec4(std::max(light.shadowSoftness, 0.0f),
                               std::max(light.shadowDistance, 0.0f), 0.0f, 0.0f);
        if (type == ecs::Light2DType::Directional) {
            // Direction in the 2D plane; z=1 flags directional (no attenuation) in the shader.
            gpu.posDir = glm::vec4(light.direction.x, light.direction.y, 1.0f, 0.0f);
        } else {  // Point / Spot — world position from the Transform, w=falloff radius.
            auto* transform = registry.tryGet<ecs::Transform>(entity);
            if (!transform) continue;  // a positional light with no position casts nothing
            transform->ensureDecomposed();
            const glm::vec3 p = transform->worldPosition;
            const f32 typeId = (type == ecs::Light2DType::Spot) ? 2.0f : 0.0f;
            gpu.posDir = glm::vec4(p.x, p.y, typeId, light.radius);
            if (type == ecs::Light2DType::Spot) {
                glm::vec2 aim = light.direction;
                aim = (glm::dot(aim, aim) > 1e-8f) ? glm::normalize(aim) : glm::vec2(0.0f, -1.0f);
                gpu.spot = glm::vec4(aim.x, aim.y,
                                     std::cos(glm::radians(light.innerAngle * 0.5f)),
                                     std::cos(glm::radians(light.outerAngle * 0.5f)));
            }
        }
        collected.push_back(gpu);
    }

    if (collected.size() > MAX_LIGHTS_2D) {
        std::partial_sort(collected.begin(), collected.begin() + MAX_LIGHTS_2D, collected.end(),
                          [](const GpuLight2D& a, const GpuLight2D& b) { return a.color.a > b.color.a; });
        ES_LOG_WARN("collectLights: {} lights exceed the {}-light cap; keeping the brightest",
                    collected.size(), MAX_LIGHTS_2D);
        collected.resize(MAX_LIGHTS_2D);
    }
    for (const auto& gpu : collected) lights.addLight(gpu);

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

void RenderFrame::collectAll(ecs::Registry& registry, u32 skipFlags) {
    ES_PROFILE_SCOPE("render.collect");
    buildClipState();
    collectLights(registry);

    auto ctx = makeContext();

    RenderCollectContext collectCtx{registry, frustum_, clip_state_, pool_, draw_list_, ctx,
                                    computeCameraWorldRect(ctx.view_projection)};
    for (auto& plugin : plugins_) {
        if (skipFlags != 0 && (skipFlags & plugin->skipFlag()) != 0) continue;
        plugin->collect(collectCtx);
    }
}

u32 RenderFrame::initBatchShader() {
    // The default (featureless) batch program; seeds the variant cache.
    return batchProgram({});
}

u32 RenderFrame::batchProgram(const std::vector<std::string>& features) {
    const std::string key = resource::ShaderParser::variantKey(features);
    auto it = batch_variants_.find(key);
    if (it != batch_variants_.end()) return it->second;
    const u32 prog = compileBatchVariant(features);
    batch_variants_.emplace(key, prog);
    return prog;
}

u32 RenderFrame::compileBatchVariant(const std::vector<std::string>& features) {
    resource::ShaderHandle handle;
    if (resource_manager_.preferredShaderLanguage() == GfxShaderLanguage::WGSL) {
        // Only the default variant has a hand-written twin; the SDF/LIT feature
        // variants arrive with the Phase 3 dual-language emitter.
        if (!features.empty()) {
            const std::string vk = resource::ShaderParser::variantKey(features);
            ES_LOG_ERROR("Batch shader variant '{}' has no WGSL twin yet", vk.c_str());
            return 0;
        }
        handle = resource_manager_.createShaderWithBindings(
            webgpu::kBatchWGSL_Vertex, webgpu::kBatchWGSL_Fragment,
            {}, GfxShaderLanguage::WGSL);
    } else {
        // The batch shader is authored as a single .esshader, embedded for the web build.
        // Parse it and assemble the two GLSL ES 3.00 stages (single source of truth),
        // injecting the requested feature #defines (e.g. SDF).
        auto parsed = resource::ShaderParser::parse(ShaderEmbeds::BATCH);
        // LIT is a Lit2D-domain variant: the domain drives the lighting injection,
        // same path as Lit2D material shaders.
        if (std::find(features.begin(), features.end(), "LIT") != features.end()) {
            parsed.domain = "Lit2D";
        }
        handle = resource_manager_.createShaderWithBindings(
            resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", features),
            resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", features),
            {{0, "a_position"}, {1, "a_color"}, {2, "a_texCoord"}}
        );
    }

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
        return shader->getProgramId();
    }

    const std::string vk = resource::ShaderParser::variantKey(features);
    ES_LOG_ERROR("Failed to create batch shader variant '{}'", vk.empty() ? "default" : vk.c_str());
    return 0;
}

}  // namespace esengine

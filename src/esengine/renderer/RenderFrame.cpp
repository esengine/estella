// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "RenderFrame.hpp"
#include "Shader.hpp"
#include "ShaderEmbeds.generated.hpp"
#include "LightStore.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Light2D.hpp"
#include "../resource/ShaderParser.hpp"
#include "../core/Log.hpp"

#include <glm/gtc/type_ptr.hpp>

#include <algorithm>
#include <cmath>
#include <vector>

namespace esengine {

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
        glm::mat4(1.0f)
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

    if (usePostProcess) {
#ifdef ES_ENABLE_POSTPROCESS
        if (target != RenderTargetManager::INVALID_HANDLE) {
            auto* rt = target_manager_.get(target);
            if (rt) {
                post_process_->setOutputTarget(rt->getFramebufferId());
            }
        }
        post_process_->begin();
#endif
    } else if (target != RenderTargetManager::INVALID_HANDLE) {
        auto* rt = target_manager_.get(target);
        if (rt) {
            rt->bind();
        }
    }
}

void RenderFrame::flush() {
    if (!in_frame_ || flushed_) return;

    flushed_ = true;

    // Drop any pipeline a prior phase left bound, so the first draw re-applies its state.
    device_.invalidatePipelineCache();

    // finalize() sorts + coalesces and rewrites per-vertex texIndex into the staging, so it
    // must run before upload() ships that staging to the GPU.
    draw_list_.finalize(pool_);
    pool_.upload();

    context_.updateFrameConstants(view_projection_);
    context_.lights().uploadAndBind();
    draw_list_.execute(device_, pool_, context_.materials(), &frame_capture_);

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
        post_process_->end();
#endif
    } else if (current_target_ != RenderTargetManager::INVALID_HANDLE) {
        auto* rt = target_manager_.get(current_target_);
        if (rt) {
            rt->unbind();
        }
    }

    frame_capture_.endCapture();
    in_frame_ = false;
    flushed_ = false;
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

    rt->bind();
    device_.setViewport(0, 0, width_, height_);
    device_.setClearColor(0.0f, 0.0f, 0.0f, 0.0f);
    device_.clear(true, false, false);

    device_.invalidatePipelineCache();

    frame_capture_.setReplayMode(stopAtDrawCall + 1);

    context_.updateFrameConstants(view_projection_);
    context_.lights().uploadAndBind();
    draw_list_.execute(device_, pool_, context_.materials(), &frame_capture_);

    // Leave scissor/stencil disabled for whatever renders next; invalidate so the next
    // setPipeline re-applies (we changed stencil/scissor outside the pipeline here).
    device_.setScissorTest(false);
    device_.setStencilTest(false);
    device_.setStencilMask(0xFF);
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

    rt->bind();
    device_.setViewport(0, 0, w, h);
    device_.setClearColor(0.0f, 0.0f, 0.0f, 0.0f);
    device_.clear(true, false, false);
    device_.invalidatePipelineCache();

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
        &context_.materials()
    };
}

void RenderFrame::collectLights(ecs::Registry& registry) {
    LightStore& lights = context_.lights();
    lights.clear();

    // Gather non-ambient lights, then (if over the UBO's cap) keep the most intense — the
    // brightest contribute most, and an explicit importance cull beats silently dropping
    // whichever happened to come last in iteration order. Ambient lights sum without a cap.
    std::vector<GpuLight2D> collected;

    auto view = registry.view<ecs::Transform, ecs::Light2D>();
    for (auto entity : view) {
        const auto& light = view.get<ecs::Light2D>(entity);
        if (!light.enabled || light.intensity <= 0.0f) continue;

        const auto type = static_cast<ecs::Light2DType>(light.type);
        const glm::vec3 rgb{light.color};  // color.a is unused; intensity carries the strength
        if (type == ecs::Light2DType::Ambient) {
            lights.addAmbient(rgb * light.intensity);
            continue;
        }

        GpuLight2D gpu;
        gpu.color = glm::vec4(rgb, light.intensity);
        if (type == ecs::Light2DType::Directional) {
            // Direction in the 2D plane; z=1 flags directional (no attenuation) in the shader.
            gpu.posDir = glm::vec4(light.direction.x, light.direction.y, 1.0f, 0.0f);
        } else {  // Point / Spot — world position from the Transform, w=falloff radius.
            auto& transform = view.get<ecs::Transform>(entity);
            transform.ensureDecomposed();
            const glm::vec3 p = transform.worldPosition;
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
}

void RenderFrame::collectAll(ecs::Registry& registry, u32 skipFlags) {
    buildClipState();
    collectLights(registry);

    auto ctx = makeContext();

    RenderCollectContext collectCtx{registry, frustum_, clip_state_, pool_, draw_list_, ctx};
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
    // The batch shader is authored as a single .esshader, embedded for the web build.
    // Parse it and assemble the two GLSL ES 3.00 stages (single source of truth),
    // injecting the requested feature #defines (e.g. SDF).
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::BATCH);
    resource::ShaderHandle handle = resource_manager_.createShaderWithBindings(
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", features),
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", features),
        {{0, "a_position"}, {1, "a_color"}, {2, "a_texCoord"}}
    );

    Shader* shader = resource_manager_.getShader(handle);
    if (shader && shader->isValid()) {
        u32 prog = shader->getProgramId();
        shader->bind();
        // Bind the 8 multi-texture samplers to units 0..7 (per-program, set once).
        for (i32 i = 0; i < 8; ++i) {
            i32 loc = device_.getUniformLocation(prog, ("u_textures[" + std::to_string(i) + "]").c_str());
            if (loc >= 0) device_.setUniform1i(loc, i);
        }
        shader->unbind();
        return prog;
    }

    const std::string vk = resource::ShaderParser::variantKey(features);
    ES_LOG_ERROR("Failed to create batch shader variant '{}'", vk.empty() ? "default" : vk.c_str());
    return 0;
}

}  // namespace esengine

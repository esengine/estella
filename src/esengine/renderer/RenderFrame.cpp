#include "RenderFrame.hpp"
#include "Shader.hpp"
#include "ShaderEmbeds.generated.hpp"
#include "../resource/ShaderParser.hpp"
#include "../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#include <glm/gtc/type_ptr.hpp>

#include <cmath>

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
        planes[i].normal /= len;
        planes[i].distance /= len;
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

RenderFrame::RenderFrame(RenderContext& context, resource::ResourceManager& resource_manager)
    : context_(context)
    , resource_manager_(resource_manager) {
}

RenderFrame::~RenderFrame() {
    shutdown();
}

void RenderFrame::init(u32 width, u32 height) {
    width_ = width;
    height_ = height;

    state_tracker_.init();

#ifdef ES_ENABLE_POSTPROCESS
    post_process_ = makeUnique<PostProcessPipeline>(context_, resource_manager_);
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

    state_tracker_.reset();
    state_tracker_.setBlendEnabled(true);
    state_tracker_.setBlendMode(BlendMode::Normal);
    state_tracker_.setDepthTest(false);

    pool_.upload();
    draw_list_.finalize();

    auto ctx = makeContext();

    auto customDrawFn = [this, &ctx](const DrawCommand& cmd, StateTracker& state,
                                     TransientBufferPool& buffers) {
        for (auto& plugin : plugins_) {
            if (plugin->needsCustomDraw() && plugin->handlesType(cmd.type)) {
                plugin->customDraw(cmd, state, buffers, ctx);
                return;
            }
        }
    };

    draw_list_.execute(state_tracker_, pool_, view_projection_, &frame_capture_, customDrawFn);

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
    state_tracker_.setViewport(0, 0, width_, height_);
    glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    state_tracker_.reset();
    state_tracker_.setBlendEnabled(true);
    state_tracker_.setBlendMode(BlendMode::Normal);
    state_tracker_.setDepthTest(false);

    frame_capture_.setReplayMode(stopAtDrawCall + 1);

    draw_list_.execute(state_tracker_, pool_, view_projection_, &frame_capture_);

    state_tracker_.setScissorEnabled(false);
    state_tracker_.endStencilTest();

    frame_capture_.clearReplayMode();

    u32 pixelCount = width_ * height_ * 4;
    snapshot_pixels_.resize(pixelCount);
    glReadPixels(0, 0, static_cast<GLsizei>(width_), static_cast<GLsizei>(height_),
                 GL_RGBA, GL_UNSIGNED_BYTE, snapshot_pixels_.data());

    rt->unbind();
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

void RenderFrame::beginStencilWrite([[maybe_unused]] i32 refValue) {
#ifdef ES_PLATFORM_WEB
    state_tracker_.beginStencilWrite(refValue);
#endif
}

void RenderFrame::endStencilWrite() {
#ifdef ES_PLATFORM_WEB
    state_tracker_.endStencilWrite();
#endif
}

void RenderFrame::beginStencilTest([[maybe_unused]] i32 refValue) {
#ifdef ES_PLATFORM_WEB
    state_tracker_.beginStencilTest(refValue);
#endif
}

void RenderFrame::endStencilTest() {
#ifdef ES_PLATFORM_WEB
    state_tracker_.endStencilTest();
#endif
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
        view_projection_
    };
}

void RenderFrame::collectAll(ecs::Registry& registry, u32 skipFlags) {
    buildClipState();

    auto ctx = makeContext();

    for (auto& plugin : plugins_) {
        if (skipFlags != 0 && (skipFlags & plugin->skipFlag()) != 0) continue;
        plugin->collect(registry, frustum_, clip_state_, pool_, draw_list_, ctx);
    }
}

u32 RenderFrame::initBatchShader() {
#ifndef ES_PLATFORM_WEB
    auto handle = resource_manager_.loadEngineShader("batch");
#else
    resource::ShaderHandle handle;
#endif
    if (!handle.isValid()) {
        handle = resource_manager_.createShaderWithBindings(
            ShaderSources::BATCH_VERTEX,
            ShaderSources::BATCH_FRAGMENT,
            {{0, "a_position"}, {1, "a_color"}, {2, "a_texCoord"}}
        );
    }

    Shader* shader = resource_manager_.getShader(handle);
    if (!shader || !shader->isValid()) {
        ES_LOG_WARN("GLSL ES 3.0 batch shader failed, trying GLSL ES 1.0 fallback");
        auto parsed = resource::ShaderParser::parse(ShaderEmbeds::BATCH);
        handle = resource_manager_.createShaderWithBindings(
            resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex),
            resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment),
            {{0, "a_position"}, {1, "a_color"}, {2, "a_texCoord"}}
        );
        shader = resource_manager_.getShader(handle);
    }

    if (shader && shader->isValid()) {
        shader->bind();
        GLint texLoc = glGetUniformLocation(shader->getProgramId(), "u_texture");
        if (texLoc >= 0) {
            glUniform1i(texLoc, 0);
        }
        shader->unbind();
        return shader->getProgramId();
    }

    ES_LOG_ERROR("Failed to create batch shader");
    return 0;
}

}  // namespace esengine

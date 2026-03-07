#include "RenderFrame.hpp"
#include "Shader.hpp"
#include "ShaderEmbeds.generated.hpp"
#include "../resource/ShaderParser.hpp"
#include "../core/Log.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/UIRect.hpp"
#include "../ecs/components/UIMask.hpp"
#include "../ecs/components/Hierarchy.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#include <algorithm>
#include <cmath>
#include <unordered_set>

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

    post_process_ = makeUnique<PostProcessPipeline>(context_, resource_manager_);
    post_process_->init(width, height);

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

    if (post_process_) {
        post_process_->shutdown();
        post_process_.reset();
    }

    ES_LOG_INFO("RenderFrame shutdown");
}

void RenderFrame::resize(u32 width, u32 height) {
    width_ = width;
    height_ = height;

    if (post_process_) {
        post_process_->resize(width, height);
    }
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

    bool usePostProcess = post_process_ && post_process_->isInitialized() &&
                          !post_process_->isBypassed() && post_process_->getPassCount() > 0;

    if (usePostProcess) {
        if (target != RenderTargetManager::INVALID_HANDLE) {
            auto* rt = target_manager_.get(target);
            if (rt) {
                post_process_->setOutputTarget(rt->getFramebufferId());
            }
        }
        post_process_->begin();
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
    draw_list_.execute(state_tracker_, pool_, view_projection_, &frame_capture_);
}

void RenderFrame::end() {
    if (!in_frame_) return;

    if (!flushed_) {
        flush();
    }

    bool usePostProcess = post_process_ && post_process_->isInitialized() &&
                          !post_process_->isBypassed() && post_process_->getPassCount() > 0;

    if (usePostProcess) {
        post_process_->end();
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

// ─── Mask Processing ─────────────────────────────────────────────────────────

namespace {

struct ScreenRect {
    i32 x = 0, y = 0, w = 0, h = 0;
};

ScreenRect intersectRects(const ScreenRect& a, const ScreenRect& b) {
    i32 x1 = std::max(a.x, b.x);
    i32 y1 = std::max(a.y, b.y);
    i32 x2 = std::min(a.x + a.w, b.x + b.w);
    i32 y2 = std::min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return {0, 0, 0, 0};
    return {x1, y1, x2 - x1, y2 - y1};
}

glm::vec2 worldToScreen(f32 wx, f32 wy, const glm::mat4& vp,
                         i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    glm::vec4 clip = vp * glm::vec4(wx, wy, 0.0f, 1.0f);
    f32 ndcX = clip.x / clip.w;
    f32 ndcY = clip.y / clip.w;
    f32 sx = static_cast<f32>(vpX) + (ndcX * 0.5f + 0.5f) * static_cast<f32>(vpW);
    f32 sy = static_cast<f32>(vpY) + (ndcY * 0.5f + 0.5f) * static_cast<f32>(vpH);
    return {sx, sy};
}

ScreenRect computeMaskScreenRect(
    ecs::Registry& registry, Entity entity,
    const glm::mat4& vp, i32 vpX, i32 vpY, i32 vpW, i32 vpH
) {
    if (!registry.has<ecs::UIRect>(entity) || !registry.has<ecs::Transform>(entity)) {
        return {0, 0, 0, 0};
    }
    const auto& uiRect = registry.get<ecs::UIRect>(entity);
    const auto& transform = registry.get<ecs::Transform>(entity);

    f32 sizeX = uiRect.computed_size_.x > 0 ? uiRect.computed_size_.x : uiRect.size.x;
    f32 sizeY = uiRect.computed_size_.y > 0 ? uiRect.computed_size_.y : uiRect.size.y;
    f32 worldW = sizeX * transform.worldScale.x;
    f32 worldH = sizeY * transform.worldScale.y;
    f32 cx = transform.worldPosition.x;
    f32 cy = transform.worldPosition.y;
    f32 px = uiRect.pivot.x;
    f32 py = uiRect.pivot.y;

    f32 localLeft = -worldW * px;
    f32 localRight = worldW * (1.0f - px);
    f32 localBottom = -worldH * py;
    f32 localTop = worldH * (1.0f - py);

    f32 angle = 2.0f * std::atan2(transform.worldRotation.z, transform.worldRotation.w);
    f32 cosA = std::cos(angle);
    f32 sinA = std::sin(angle);

    glm::vec2 corners[4] = {
        {cx + localLeft  * cosA - localBottom * sinA, cy + localLeft  * sinA + localBottom * cosA},
        {cx + localRight * cosA - localBottom * sinA, cy + localRight * sinA + localBottom * cosA},
        {cx + localRight * cosA - localTop    * sinA, cy + localRight * sinA + localTop    * cosA},
        {cx + localLeft  * cosA - localTop    * sinA, cy + localLeft  * sinA + localTop    * cosA},
    };

    f32 minX = std::numeric_limits<f32>::max();
    f32 minY = std::numeric_limits<f32>::max();
    f32 maxX = std::numeric_limits<f32>::lowest();
    f32 maxY = std::numeric_limits<f32>::lowest();
    for (const auto& c : corners) {
        glm::vec2 s = worldToScreen(c.x, c.y, vp, vpX, vpY, vpW, vpH);
        minX = std::min(minX, s.x);
        minY = std::min(minY, s.y);
        maxX = std::max(maxX, s.x);
        maxY = std::max(maxY, s.y);
    }

    return {
        static_cast<i32>(std::round(minX)),
        static_cast<i32>(std::round(minY)),
        static_cast<i32>(std::round(maxX - minX)),
        static_cast<i32>(std::round(maxY - minY)),
    };
}

bool hasAncestorScissorMask(ecs::Registry& registry, Entity entity,
                             const std::unordered_set<u32>& maskSet) {
    Entity current = entity;
    while (registry.has<ecs::Parent>(current)) {
        Entity parent = registry.get<ecs::Parent>(current).entity;
        if (parent == INVALID_ENTITY) break;
        if (maskSet.count(static_cast<u32>(parent))) {
            const auto& parentMask = registry.get<ecs::UIMask>(parent);
            if (parentMask.mode == ecs::MaskMode::Scissor) return true;
        }
        current = parent;
    }
    return false;
}

bool hasAncestorStencilMask(ecs::Registry& registry, Entity entity,
                             const std::unordered_set<u32>& stencilSet) {
    Entity current = entity;
    while (registry.has<ecs::Parent>(current)) {
        Entity parent = registry.get<ecs::Parent>(current).entity;
        if (parent == INVALID_ENTITY) break;
        if (stencilSet.count(static_cast<u32>(parent))) return true;
        current = parent;
    }
    return false;
}

void applyScissorToDescendants(
    ecs::Registry& registry, RenderFrame& frame, Entity entity,
    const ScreenRect& clipRect, const std::unordered_set<u32>& maskSet,
    const glm::mat4& vp, i32 vpX, i32 vpY, i32 vpW, i32 vpH
) {
    if (!registry.has<ecs::Children>(entity)) return;
    const auto& children = registry.get<ecs::Children>(entity);
    for (auto child : children.entities) {
        ScreenRect childClip = clipRect;

        if (maskSet.count(static_cast<u32>(child))) {
            const auto& childMask = registry.get<ecs::UIMask>(child);
            if (childMask.mode == ecs::MaskMode::Scissor) {
                ScreenRect childRect = computeMaskScreenRect(registry, child, vp, vpX, vpY, vpW, vpH);
                childClip = intersectRects(clipRect, childRect);
            }
        }

        frame.setEntityClipRect(static_cast<u32>(child), childClip.x, childClip.y, childClip.w, childClip.h);
        applyScissorToDescendants(registry, frame, child, childClip, maskSet, vp, vpX, vpY, vpW, vpH);
    }
}

static constexpr i32 MAX_STENCIL_REF = 255;

void applyStencilDescendants(ecs::Registry& registry, RenderFrame& frame,
                              Entity entity, i32 refValue,
                              const std::unordered_set<u32>& stencilSet, i32& nextRef, bool& overflowed);

void applyStencilHierarchy(ecs::Registry& registry, RenderFrame& frame,
                            Entity entity, i32 refValue,
                            const std::unordered_set<u32>& stencilSet, i32& nextRef, bool& overflowed) {
    if (overflowed) return;
    frame.setEntityStencilMask(static_cast<u32>(entity), refValue);

    if (!registry.has<ecs::Children>(entity)) return;
    const auto& children = registry.get<ecs::Children>(entity);
    for (auto child : children.entities) {
        if (overflowed) return;
        if (stencilSet.count(static_cast<u32>(child))) {
            if (nextRef > MAX_STENCIL_REF) { overflowed = true; return; }
            applyStencilHierarchy(registry, frame, child, nextRef++, stencilSet, nextRef, overflowed);
        } else {
            frame.setEntityStencilTest(static_cast<u32>(child), refValue);
            applyStencilDescendants(registry, frame, child, refValue, stencilSet, nextRef, overflowed);
        }
    }
}

void applyStencilDescendants(ecs::Registry& registry, RenderFrame& frame,
                              Entity entity, i32 refValue,
                              const std::unordered_set<u32>& stencilSet, i32& nextRef, bool& overflowed) {
    if (overflowed) return;
    if (!registry.has<ecs::Children>(entity)) return;
    const auto& children = registry.get<ecs::Children>(entity);
    for (auto child : children.entities) {
        if (overflowed) return;
        if (stencilSet.count(static_cast<u32>(child))) {
            if (nextRef > MAX_STENCIL_REF) { overflowed = true; return; }
            applyStencilHierarchy(registry, frame, child, nextRef++, stencilSet, nextRef, overflowed);
        } else {
            frame.setEntityStencilTest(static_cast<u32>(child), refValue);
            applyStencilDescendants(registry, frame, child, refValue, stencilSet, nextRef, overflowed);
        }
    }
}

}  // anonymous namespace

void RenderFrame::processMasks(ecs::Registry& registry, i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    clearAllClipRects();
    clearAllStencilMasks();

    auto maskView = registry.view<ecs::UIMask>();
    std::vector<Entity> scissorMasks;
    std::vector<Entity> stencilMasks;
    std::unordered_set<u32> maskSet;
    std::unordered_set<u32> stencilSet;

    for (auto entity : maskView) {
        const auto& mask = registry.get<ecs::UIMask>(entity);
        if (!mask.enabled) continue;
        maskSet.insert(static_cast<u32>(entity));
        if (mask.mode == ecs::MaskMode::Stencil) {
            stencilMasks.push_back(entity);
            stencilSet.insert(static_cast<u32>(entity));
        } else {
            scissorMasks.push_back(entity);
        }
    }

    if (scissorMasks.empty() && stencilMasks.empty()) return;

    if (!scissorMasks.empty()) {
        std::vector<Entity> rootScissors;
        for (auto entity : scissorMasks) {
            if (!hasAncestorScissorMask(registry, entity, maskSet)) {
                rootScissors.push_back(entity);
            }
        }

        for (auto entity : rootScissors) {
            ScreenRect rect = computeMaskScreenRect(registry, entity, view_projection_, vpX, vpY, vpW, vpH);
            applyScissorToDescendants(registry, *this, entity, rect, maskSet, view_projection_, vpX, vpY, vpW, vpH);
        }
    }

    if (!stencilMasks.empty()) {
#ifdef ES_PLATFORM_WEB
        glClearStencil(0);
        glClear(GL_STENCIL_BUFFER_BIT);
#endif

        std::vector<Entity> rootStencils;
        for (auto entity : stencilMasks) {
            if (!hasAncestorStencilMask(registry, entity, stencilSet)) {
                rootStencils.push_back(entity);
            }
        }

        i32 nextRef = 1;
        bool overflowed = false;
        for (auto entity : rootStencils) {
            if (overflowed) break;
            if (nextRef > MAX_STENCIL_REF) break;
            applyStencilHierarchy(registry, *this, entity, nextRef++, stencilSet, nextRef, overflowed);
        }

        if (overflowed) {
            ES_LOG_WARN("Stencil mask overflow: too many nested masks (>255)");
        }
    }
}


// ============================================================================
// Tile quad submit (used by tilemap)
// ============================================================================

namespace {
struct TileVertex {
    glm::vec2 position;
    u32 color;
    glm::vec2 texCoord;
};
static constexpr u16 TILE_QUAD_IDX[6] = { 0, 1, 2, 2, 3, 0 };

static u32 packColor(const glm::vec4& c) {
    u8 r = static_cast<u8>(c.r * 255.0f + 0.5f);
    u8 g = static_cast<u8>(c.g * 255.0f + 0.5f);
    u8 b = static_cast<u8>(c.b * 255.0f + 0.5f);
    u8 a = static_cast<u8>(c.a * 255.0f + 0.5f);
    return static_cast<u32>(r) | (static_cast<u32>(g) << 8)
         | (static_cast<u32>(b) << 16) | (static_cast<u32>(a) << 24);
}
}  // namespace

void RenderFrame::submitTileQuad(
    const glm::vec2& position, const glm::vec2& size,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    const glm::vec4& color, u32 textureId,
    Entity entity, i32 layer, f32 depth
) {
    f32 hw = size.x * 0.5f;
    f32 hh = size.y * 0.5f;
    u32 pc = packColor(color);

    TileVertex verts[4];
    verts[0] = { {position.x - hw, position.y - hh}, pc, uvOffset };
    verts[1] = { {position.x + hw, position.y - hh}, pc, {uvOffset.x + uvScale.x, uvOffset.y} };
    verts[2] = { {position.x + hw, position.y + hh}, pc, {uvOffset.x + uvScale.x, uvOffset.y + uvScale.y} };
    verts[3] = { {position.x - hw, position.y + hh}, pc, {uvOffset.x, uvOffset.y + uvScale.y} };

    u32 vOff = pool_.appendVertices(verts, sizeof(verts));
    u32 baseVertex = vOff / sizeof(TileVertex);

    u16 indices[6];
    for (u32 i = 0; i < 6; ++i) {
        indices[i] = static_cast<u16>(baseVertex + TILE_QUAD_IDX[i]);
    }
    u32 iOff = pool_.appendIndices(indices, 6);

    DrawCommand cmd{};
    cmd.sort_key = DrawCommand::buildSortKey(
        current_stage_, layer, batch_shader_id_, BlendMode::Normal, 0, textureId, depth);
    cmd.index_offset = iOff;
    cmd.index_count = 6;
    cmd.vertex_byte_offset = vOff;
    cmd.shader_id = batch_shader_id_;
    cmd.blend_mode = BlendMode::Normal;
    cmd.layout_id = LayoutId::Batch;
    cmd.texture_count = 1;
    cmd.texture_ids[0] = textureId;
    cmd.entity = entity;
    cmd.type = RenderType::Sprite;
    cmd.layer = layer;

    clip_state_.applyTo(entity, cmd);

    draw_list_.push(cmd);
}

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

void RenderFrame::collectAll(ecs::Registry& registry) {
    buildClipState();

    RenderFrameContext ctx{
        context_,
        resource_manager_,
        context_.getWhiteTextureId(),
        batch_shader_id_,
        current_stage_,
        view_projection_
    };

    for (auto& plugin : plugins_) {
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

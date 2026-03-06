#include "RenderFrame.hpp"
#include "Renderer.hpp"
#include "RenderCommand.hpp"
#include "Texture.hpp"
#include "CustomGeometry.hpp"
#include "ShaderEmbeds.generated.hpp"
#include "../resource/ShaderParser.hpp"
#include "../core/Log.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/UIRect.hpp"
#include "../ecs/components/UIRenderer.hpp"
#include "../ecs/components/BitmapText.hpp"
#include "../ecs/components/ShapeRenderer.hpp"
#include "../ecs/components/UIMask.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../text/BitmapFont.hpp"
#ifdef ES_ENABLE_SPINE
#include "../ecs/components/SpineAnimation.hpp"
#include "../spine/SpineSystem.hpp"
#include <spine/spine.h>
#include <spine/RegionAttachment.h>
#include <spine/MeshAttachment.h>
#include <spine/ClippingAttachment.h>
#include <spine/Atlas.h>
#endif

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#include <algorithm>
#include <vector>
#include <unordered_set>
#include <cstring>

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

#ifdef ES_PLATFORM_WEB
extern bool getMaterialData(u32 materialId, u32& shaderId, u32& blendMode);
extern bool getMaterialDataWithUniforms(u32 materialId, u32& shaderId, u32& blendMode,
                                        std::vector<MaterialUniformData>& uniforms);
extern void clearMaterialCache();
#else
bool getMaterialData(u32 /*materialId*/, u32& /*shaderId*/, u32& /*blendMode*/) {
    return false;
}
bool getMaterialDataWithUniforms(u32 /*materialId*/, u32& /*shaderId*/, u32& /*blendMode*/,
                                 std::vector<MaterialUniformData>& /*uniforms*/) {
    return false;
}
void clearMaterialCache() {}
#endif

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

    batcher_ = makeUnique<BatchRenderer2D>(context_, resource_manager_);
    batcher_->init();

    post_process_ = makeUnique<PostProcessPipeline>(context_, resource_manager_);
    post_process_->init(width, height);

    items_.reserve(1024);
    sprite_data_.reserve(512);
    text_data_.reserve(64);
    ext_data_.reserve(32);
#ifdef ES_ENABLE_SPINE
    spine_data_.reserve(32);
#endif

#ifdef ES_ENABLE_SPINE
    spine_vertices_.reserve(1024);
    spine_indices_.reserve(2048);
    spine_world_vertices_.reserve(1024);

    glGenVertexArrays(1, &spine_vao_);
    glGenBuffers(1, &spine_vbo_);
    glGenBuffers(1, &spine_ebo_);

    glBindVertexArray(spine_vao_);
    glBindBuffer(GL_ARRAY_BUFFER, spine_vbo_);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, spine_ebo_);

    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(SpineVertex),
                          reinterpret_cast<void*>(offsetof(SpineVertex, position)));
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, sizeof(SpineVertex),
                          reinterpret_cast<void*>(offsetof(SpineVertex, color)));
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, sizeof(SpineVertex),
                          reinterpret_cast<void*>(offsetof(SpineVertex, uv)));
    glEnableVertexAttribArray(3);
    glVertexAttribPointer(3, 1, GL_FLOAT, GL_FALSE, sizeof(SpineVertex),
                          reinterpret_cast<void*>(offsetof(SpineVertex, texIndex)));

    glBindVertexArray(0);
    spine_vbo_capacity_ = 0;
    spine_ebo_capacity_ = 0;

    spine_shader_handle_ = resource_manager_.createShaderWithBindings(
        ShaderSources::BATCH_VERTEX,
        ShaderSources::BATCH_FRAGMENT,
        {{0, "a_position"}, {1, "a_color"}, {2, "a_texCoord"}, {3, "a_texIndex"}}
    );
    Shader* spineShader = resource_manager_.getShader(spine_shader_handle_);
    if (!spineShader || !spineShader->isValid()) {
        auto batchParsed = resource::ShaderParser::parse(ShaderEmbeds::BATCH);
        spine_shader_handle_ = resource_manager_.createShaderWithBindings(
            resource::ShaderParser::assembleStage(batchParsed, resource::ShaderStage::Vertex),
            resource::ShaderParser::assembleStage(batchParsed, resource::ShaderStage::Fragment),
            {{0, "a_position"}, {1, "a_color"}, {2, "a_texCoord"}, {3, "a_texIndex"}}
        );
        spineShader = resource_manager_.getShader(spine_shader_handle_);
    }
    if (spineShader && spineShader->isValid()) {
        spineShader->bind();
        GLint baseLoc = glGetUniformLocation(spineShader->getProgramId(), "u_textures[0]");
        if (baseLoc >= 0) {
            for (i32 i = 0; i < static_cast<i32>(SPINE_MAX_TEXTURE_SLOTS); ++i) {
                glUniform1i(baseLoc + i, i);
            }
        }
    }

    spine_tex_slots_.init(context_.getWhiteTextureId());
#endif

    glGenVertexArrays(1, &ext_mesh_vao_);
    glGenBuffers(1, &ext_mesh_vbo_);
    glGenBuffers(1, &ext_mesh_ebo_);

    glBindVertexArray(ext_mesh_vao_);
    glBindBuffer(GL_ARRAY_BUFFER, ext_mesh_vbo_);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ext_mesh_ebo_);

    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8 * sizeof(f32),
                          reinterpret_cast<void*>(0));
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 8 * sizeof(f32),
                          reinterpret_cast<void*>(2 * sizeof(f32)));
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, 8 * sizeof(f32),
                          reinterpret_cast<void*>(4 * sizeof(f32)));

    glBindVertexArray(0);
    ext_mesh_vbo_capacity_ = 0;
    ext_mesh_ebo_capacity_ = 0;

    glGenVertexArrays(1, &mat_sprite_vao_);
    glGenBuffers(1, &mat_sprite_vbo_);
    glGenBuffers(1, &mat_sprite_ebo_);
    mat_sprite_vbo_capacity_ = 0;
    mat_sprite_ebo_capacity_ = 0;

#ifdef ES_PLATFORM_WEB
    glGenVertexArrays(1, &particle_vao_);
    glGenBuffers(1, &particle_quad_vbo_);
    glGenBuffers(1, &particle_instance_vbo_);
    glGenBuffers(1, &particle_ebo_);

    glBindVertexArray(particle_vao_);

    static constexpr f32 QUAD_VERTICES[] = {
        -0.5f, -0.5f,  0.0f, 0.0f,
         0.5f, -0.5f,  1.0f, 0.0f,
         0.5f,  0.5f,  1.0f, 1.0f,
        -0.5f,  0.5f,  0.0f, 1.0f,
    };
    static constexpr u16 QUAD_INDICES[] = { 0, 1, 2, 2, 3, 0 };

    glBindBuffer(GL_ARRAY_BUFFER, particle_quad_vbo_);
    glBufferData(GL_ARRAY_BUFFER, sizeof(QUAD_VERTICES), QUAD_VERTICES, GL_STATIC_DRAW);

    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(f32),
                          reinterpret_cast<void*>(0));
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(f32),
                          reinterpret_cast<void*>(2 * sizeof(f32)));

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, particle_ebo_);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(QUAD_INDICES), QUAD_INDICES, GL_STATIC_DRAW);

    glBindBuffer(GL_ARRAY_BUFFER, particle_instance_vbo_);
    constexpr u32 INITIAL_PARTICLE_CAPACITY = 1024;
    glBufferData(GL_ARRAY_BUFFER,
                 INITIAL_PARTICLE_CAPACITY * sizeof(ParticleInstanceData),
                 nullptr, GL_DYNAMIC_DRAW);
    particle_instance_capacity_ = INITIAL_PARTICLE_CAPACITY;

    constexpr u32 STRIDE = sizeof(ParticleInstanceData);
    u32 offset = 0;

    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, STRIDE,
                          reinterpret_cast<void*>(offset));
    glVertexAttribDivisor(2, 1);
    offset += sizeof(glm::vec2);

    glEnableVertexAttribArray(3);
    glVertexAttribPointer(3, 2, GL_FLOAT, GL_FALSE, STRIDE,
                          reinterpret_cast<void*>(offset));
    glVertexAttribDivisor(3, 1);
    offset += sizeof(glm::vec2);

    glEnableVertexAttribArray(4);
    glVertexAttribPointer(4, 1, GL_FLOAT, GL_FALSE, STRIDE,
                          reinterpret_cast<void*>(offset));
    glVertexAttribDivisor(4, 1);
    offset += sizeof(f32);

    glEnableVertexAttribArray(5);
    glVertexAttribPointer(5, 4, GL_FLOAT, GL_FALSE, STRIDE,
                          reinterpret_cast<void*>(offset));
    glVertexAttribDivisor(5, 1);
    offset += sizeof(glm::vec4);

    glEnableVertexAttribArray(6);
    glVertexAttribPointer(6, 2, GL_FLOAT, GL_FALSE, STRIDE,
                          reinterpret_cast<void*>(offset));
    glVertexAttribDivisor(6, 1);
    offset += sizeof(glm::vec2);

    glEnableVertexAttribArray(7);
    glVertexAttribPointer(7, 2, GL_FLOAT, GL_FALSE, STRIDE,
                          reinterpret_cast<void*>(offset));
    glVertexAttribDivisor(7, 1);

    glBindVertexArray(0);

    particle_shader_handle_ = resource_manager_.createShader(
        ShaderSources::PARTICLE_INSTANCE_VERTEX,
        ShaderSources::PARTICLE_INSTANCE_FRAGMENT
    );
    Shader* particleShader = resource_manager_.getShader(particle_shader_handle_);
    if (particleShader && particleShader->isValid()) {
        particleShader->bind();
        particleShader->setUniform("u_texture", 0);
    }

    particle_instances_.reserve(INITIAL_PARTICLE_CAPACITY);
#endif

    shape_vertices_.reserve(256);
    shape_indices_.reserve(384);

    glGenVertexArrays(1, &shape_vao_);
    glGenBuffers(1, &shape_vbo_);
    glGenBuffers(1, &shape_ebo_);

    glBindVertexArray(shape_vao_);
    glBindBuffer(GL_ARRAY_BUFFER, shape_vbo_);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, shape_ebo_);

    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(ShapeVertex),
                          reinterpret_cast<void*>(offsetof(ShapeVertex, px)));
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, sizeof(ShapeVertex),
                          reinterpret_cast<void*>(offsetof(ShapeVertex, ux)));
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, sizeof(ShapeVertex),
                          reinterpret_cast<void*>(offsetof(ShapeVertex, cr)));
    glEnableVertexAttribArray(3);
    glVertexAttribPointer(3, 4, GL_FLOAT, GL_FALSE, sizeof(ShapeVertex),
                          reinterpret_cast<void*>(offsetof(ShapeVertex, shapeType)));

    glBindVertexArray(0);
    shape_vbo_capacity_ = 0;
    shape_ebo_capacity_ = 0;

    auto shapeParsed = resource::ShaderParser::parse(ShaderEmbeds::SHAPE);
    shape_shader_handle_ = resource_manager_.createShaderWithBindings(
        resource::ShaderParser::assembleStage(shapeParsed, resource::ShaderStage::Vertex),
        resource::ShaderParser::assembleStage(shapeParsed, resource::ShaderStage::Fragment),
        {{0, "a_position"}, {1, "a_texCoord"}, {2, "a_color"}, {3, "a_shapeInfo"}}
    );

}

void RenderFrame::shutdown() {
    if (batcher_) {
        batcher_->shutdown();
        batcher_.reset();
    }

    if (post_process_) {
        post_process_->shutdown();
        post_process_.reset();
    }

#ifdef ES_ENABLE_SPINE
    if (spine_shader_handle_.isValid()) {
        resource_manager_.releaseShader(spine_shader_handle_);
    }
    if (spine_ebo_) { glDeleteBuffers(1, &spine_ebo_); spine_ebo_ = 0; }
    if (spine_vbo_) { glDeleteBuffers(1, &spine_vbo_); spine_vbo_ = 0; }
    if (spine_vao_) { glDeleteVertexArrays(1, &spine_vao_); spine_vao_ = 0; }
    spine_vbo_capacity_ = 0;
    spine_ebo_capacity_ = 0;
#endif

    if (ext_mesh_ebo_) { glDeleteBuffers(1, &ext_mesh_ebo_); ext_mesh_ebo_ = 0; }
    if (ext_mesh_vbo_) { glDeleteBuffers(1, &ext_mesh_vbo_); ext_mesh_vbo_ = 0; }
    if (ext_mesh_vao_) { glDeleteVertexArrays(1, &ext_mesh_vao_); ext_mesh_vao_ = 0; }
    ext_mesh_vbo_capacity_ = 0;
    ext_mesh_ebo_capacity_ = 0;

    if (mat_sprite_ebo_) { glDeleteBuffers(1, &mat_sprite_ebo_); mat_sprite_ebo_ = 0; }
    if (mat_sprite_vbo_) { glDeleteBuffers(1, &mat_sprite_vbo_); mat_sprite_vbo_ = 0; }
    if (mat_sprite_vao_) { glDeleteVertexArrays(1, &mat_sprite_vao_); mat_sprite_vao_ = 0; }
    mat_sprite_vbo_capacity_ = 0;
    mat_sprite_ebo_capacity_ = 0;

#ifdef ES_PLATFORM_WEB
    if (particle_shader_handle_.isValid()) {
        resource_manager_.releaseShader(particle_shader_handle_);
    }
    if (particle_ebo_) { glDeleteBuffers(1, &particle_ebo_); particle_ebo_ = 0; }
    if (particle_instance_vbo_) { glDeleteBuffers(1, &particle_instance_vbo_); particle_instance_vbo_ = 0; }
    if (particle_quad_vbo_) { glDeleteBuffers(1, &particle_quad_vbo_); particle_quad_vbo_ = 0; }
    if (particle_vao_) { glDeleteVertexArrays(1, &particle_vao_); particle_vao_ = 0; }
    particle_instance_capacity_ = 0;
#endif

    if (shape_shader_handle_.isValid()) {
        resource_manager_.releaseShader(shape_shader_handle_);
    }
    if (shape_ebo_) { glDeleteBuffers(1, &shape_ebo_); shape_ebo_ = 0; }
    if (shape_vbo_) { glDeleteBuffers(1, &shape_vbo_); shape_vbo_ = 0; }
    if (shape_vao_) { glDeleteVertexArrays(1, &shape_vao_); shape_vao_ = 0; }
    shape_vbo_capacity_ = 0;
    shape_ebo_capacity_ = 0;

    items_.clear();
    sprite_data_.clear();
    text_data_.clear();
    ext_data_.clear();
    particle_data_.clear();
    shape_data_.clear();
#ifdef ES_ENABLE_SPINE
    spine_data_.clear();
#endif
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

    items_.clear();
    sprite_data_.clear();
    text_data_.clear();
    ext_data_.clear();
    particle_data_.clear();
    shape_data_.clear();
#ifdef ES_ENABLE_SPINE
    spine_data_.clear();
#endif
    ext_storage_count_ = 0;
    ext_submit_order_ = 0;
    mat_sprite_last_shader_ = 0;
    stats_ = Stats{};

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

    sortAndBucket();

    glEnable(GL_BLEND);
    glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    RenderCommand::resetBlendState();
    glDisable(GL_DEPTH_TEST);

    executeStage(RenderStage::Background);
    executeStage(RenderStage::Opaque);
    executeStage(RenderStage::Transparent);
    executeStage(RenderStage::Overlay);
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

    in_frame_ = false;
    flushed_ = false;
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
    glEnable(GL_STENCIL_TEST);
    glStencilFunc(GL_ALWAYS, refValue, 0xFF);
    glStencilOp(GL_KEEP, GL_KEEP, GL_REPLACE);
    glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE);
    glStencilMask(0xFF);
#endif
}

void RenderFrame::endStencilWrite() {
#ifdef ES_PLATFORM_WEB
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glStencilMask(0x00);
#endif
}

void RenderFrame::beginStencilTest([[maybe_unused]] i32 refValue) {
#ifdef ES_PLATFORM_WEB
    glEnable(GL_STENCIL_TEST);
    glStencilFunc(GL_EQUAL, refValue, 0xFF);
    glStencilOp(GL_KEEP, GL_KEEP, GL_KEEP);
    glStencilMask(0x00);
#endif
}

void RenderFrame::endStencilTest() {
#ifdef ES_PLATFORM_WEB
    glDisable(GL_STENCIL_TEST);
    glStencilMask(0xFF);
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

void RenderFrame::submitSprites(ecs::Registry& registry) {
    auto spriteView = registry.view<ecs::Transform, ecs::Sprite>();

    for (auto entity : spriteView) {
        const auto& sprite = spriteView.get<ecs::Sprite>(entity);
        if (!sprite.enabled) continue;

        if (registry.has<ecs::UIRect>(entity)) continue;

        auto& transform = spriteView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        glm::vec3 position = transform.worldPosition;
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;

        glm::vec3 halfExtents = glm::vec3(sprite.size.x * scale.x, sprite.size.y * scale.y, 0.0f) * 0.5f;
        if (!frustum_.intersectsAABB(position, halfExtents)) {
            stats_.culled++;
            continue;
        }

        RenderItemBase base;
        base.entity = entity;
        base.type = RenderType::Sprite;
        base.stage = current_stage_;

        base.world_position = position;
        base.world_scale = glm::vec2(scale);
        f32 sinHalfAngle = rotation.z;
        f32 cosHalfAngle = rotation.w;
        base.world_angle = 2.0f * std::atan2(sinHalfAngle, cosHalfAngle);

        base.layer = sprite.layer;
        base.depth = position.z;
        base.color = sprite.color;

        base.texture_id = context_.getWhiteTextureId();

        SpriteData sd;
        sd.size = sprite.size;
        sd.uv_offset = sprite.uvOffset;
        sd.uv_scale = sprite.uvScale;
        sd.flip_x = sprite.flipX;
        sd.flip_y = sprite.flipY;
        sd.material_id = sprite.material;

        if (sprite.material != 0) {
            sd.transform = glm::mat4(1.0f);
            sd.transform = glm::translate(sd.transform, position);
            sd.transform *= glm::mat4_cast(rotation);
            sd.transform = glm::scale(sd.transform, scale);
        }

        if (sprite.texture.isValid()) {
            Texture* tex = resource_manager_.getTexture(sprite.texture);
            if (tex) {
                base.texture_id = tex->getId();
                sd.texture_size = glm::vec2(
                    static_cast<f32>(tex->getWidth()),
                    static_cast<f32>(tex->getHeight())
                );

                const auto* metadata = resource_manager_.getTextureMetadata(sprite.texture);
                if (metadata && metadata->sliceBorder.hasSlicing()) {
                    sd.use_nine_slice = true;
                    sd.slice_border = glm::vec4(
                        metadata->sliceBorder.left,
                        metadata->sliceBorder.right,
                        metadata->sliceBorder.top,
                        metadata->sliceBorder.bottom
                    );
                }
            }
        }

        if (!clip_rects_.empty()) {
            auto it = clip_rects_.find(static_cast<u32>(entity));
            if (it != clip_rects_.end()) {
                base.scissor_enabled = true;
                base.scissor = it->second;
            }
        }

        base.data_index = static_cast<u32>(sprite_data_.size());
        sprite_data_.push_back(sd);
        base.cached_sort_key_ = base.sortKey();
        items_.push_back(base);
        stats_.sprites++;
    }
}

void RenderFrame::submitUIElements(ecs::Registry& registry) {
    constexpr i32 UI_BASE_LAYER = 1000;

    auto uiView = registry.view<ecs::Transform, ecs::UIRenderer, ecs::UIRect>();

    for (auto entity : uiView) {
        const auto& renderer = uiView.get<ecs::UIRenderer>(entity);
        if (!renderer.enabled || renderer.visualType == ecs::UIVisualType::None) continue;

        auto& transform = uiView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        const auto& rect = uiView.get<ecs::UIRect>(entity);

        glm::vec3 position = transform.worldPosition;
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;

        f32 w = rect.computed_size_.x;
        f32 h = rect.computed_size_.y;
        if (w <= 0.0f && h <= 0.0f) continue;

        f32 dx = (0.5f - rect.pivot.x) * w * scale.x;
        f32 dy = (0.5f - rect.pivot.y) * h * scale.y;
        f32 sinHalf = rotation.z;
        if (sinHalf * sinHalf > 1e-6f) {
            f32 cosHalf = rotation.w;
            f32 s = 2.0f * sinHalf * cosHalf;
            f32 c = cosHalf * cosHalf - sinHalf * sinHalf;
            f32 rdx = dx * c - dy * s;
            f32 rdy = dx * s + dy * c;
            dx = rdx;
            dy = rdy;
        }
        position.x += dx;
        position.y += dy;

        glm::vec3 halfExtents = glm::vec3(w * scale.x, h * scale.y, 0.0f) * 0.5f;
        if (!frustum_.intersectsAABB(position, halfExtents)) {
            stats_.culled++;
            continue;
        }

        RenderItemBase base;
        base.entity = entity;
        base.type = RenderType::UIElement;
        base.stage = current_stage_;

        base.world_position = position;
        base.world_scale = glm::vec2(scale);
        f32 sinHalfAngle = rotation.z;
        f32 cosHalfAngle = rotation.w;
        base.world_angle = 2.0f * std::atan2(sinHalfAngle, cosHalfAngle);

        base.layer = UI_BASE_LAYER + renderer.uiOrder;
        base.depth = position.z;
        base.color = renderer.color;

        base.texture_id = context_.getWhiteTextureId();

        SpriteData sd;
        sd.size = rect.computed_size_;
        sd.uv_offset = renderer.uvOffset;
        sd.uv_scale = renderer.uvScale;
        sd.material_id = renderer.material;

        if (renderer.material != 0) {
            sd.transform = glm::mat4(1.0f);
            sd.transform = glm::translate(sd.transform, position);
            sd.transform *= glm::mat4_cast(rotation);
            sd.transform = glm::scale(sd.transform, scale);
        }

        if (renderer.texture.isValid()) {
            Texture* tex = resource_manager_.getTexture(renderer.texture);
            if (tex) {
                base.texture_id = tex->getId();
                sd.texture_size = glm::vec2(
                    static_cast<f32>(tex->getWidth()),
                    static_cast<f32>(tex->getHeight())
                );

                const auto* metadata = resource_manager_.getTextureMetadata(renderer.texture);
                if (metadata && metadata->sliceBorder.hasSlicing()) {
                    sd.use_nine_slice = true;
                    sd.slice_border = glm::vec4(
                        metadata->sliceBorder.left,
                        metadata->sliceBorder.right,
                        metadata->sliceBorder.top,
                        metadata->sliceBorder.bottom
                    );
                }
            }
        }

        if (renderer.visualType == ecs::UIVisualType::NineSlice) {
            sd.use_nine_slice = true;
            if (sd.slice_border == glm::vec4(0.0f)) {
                sd.slice_border = renderer.sliceBorder;
            }
        }

        if (!clip_rects_.empty()) {
            auto it = clip_rects_.find(static_cast<u32>(entity));
            if (it != clip_rects_.end()) {
                base.scissor_enabled = true;
                base.scissor = it->second;
            }
        }

        base.data_index = static_cast<u32>(sprite_data_.size());
        sprite_data_.push_back(sd);
        base.cached_sort_key_ = base.sortKey();
        items_.push_back(base);
        stats_.sprites++;
    }
}

void RenderFrame::submitBitmapText(ecs::Registry& registry) {
    auto textView = registry.view<ecs::Transform, ecs::BitmapText>();

    for (auto entity : textView) {
        const auto& bt = textView.get<ecs::BitmapText>(entity);
        if (!bt.enabled) continue;
        if (bt.text.empty() || !bt.font.isValid()) {
            continue;
        }

        auto* font = resource_manager_.getBitmapFont(bt.font);
        if (!font) {
            continue;
        }

        auto* tex = resource_manager_.getTexture(font->getTexture());
        if (!tex) {
            continue;
        }

        auto& transform = textView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        const auto& position = transform.worldPosition;
        const auto& scale = transform.worldScale;

        auto textMetrics = font->measureText(bt.text, bt.fontSize, bt.spacing);
        glm::vec3 halfExtents = glm::vec3(
            textMetrics.width * scale.x * 0.5f,
            textMetrics.height * scale.y * 0.5f,
            0.0f
        );
        if (!frustum_.intersectsAABB(position, halfExtents)) {
            stats_.culled++;
            continue;
        }

        RenderItemBase base;
        base.entity = entity;
        base.type = RenderType::Text;
        base.stage = current_stage_;

        base.world_position = position;
        base.world_scale = glm::vec2(scale);
        base.layer = bt.layer;
        base.depth = position.z;
        base.color = bt.color;
        base.texture_id = tex->getId();

        TextData td;
        td.font_data = font;
        td.text_data = bt.text.c_str();
        td.text_length = static_cast<u16>(bt.text.size());
        td.font_size = bt.fontSize;
        td.text_align = static_cast<u8>(bt.align);
        td.text_spacing = bt.spacing;

        if (!clip_rects_.empty()) {
            auto it = clip_rects_.find(static_cast<u32>(entity));
            if (it != clip_rects_.end()) {
                base.scissor_enabled = true;
                base.scissor = it->second;
            }
        }

        base.data_index = static_cast<u32>(text_data_.size());
        text_data_.push_back(td);
        base.cached_sort_key_ = base.sortKey();
        items_.push_back(base);
        stats_.text++;
    }
}

#ifdef ES_ENABLE_SPINE
void RenderFrame::submitSpine(ecs::Registry& registry, spine::SpineSystem& spine_system) {
    auto view = registry.view<ecs::SpineAnimation>();

    for (auto entity : view) {
        auto& comp = registry.get<ecs::SpineAnimation>(entity);
        if (!comp.enabled) continue;
        auto* instance = spine_system.getInstance(entity);

        if (!instance || !instance->skeleton) continue;

        glm::vec3 position{0.0f};
        glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};
        glm::vec3 scale{1.0f};

        if (registry.has<ecs::Transform>(entity)) {
            auto& t = registry.get<ecs::Transform>(entity);
            t.ensureDecomposed();
            position = t.worldPosition;
            rotation = t.worldRotation;
            scale = t.worldScale;
        }

        RenderItemBase base;
        base.entity = entity;
        base.type = RenderType::Spine;
        base.stage = current_stage_;

        base.world_position = position;
        base.world_scale = glm::vec2(scale);
        base.layer = comp.layer;
        base.depth = position.z;

        SpineData sd;
        sd.transform = glm::mat4(1.0f);
        sd.transform = glm::translate(sd.transform, position);
        sd.transform *= glm::mat4_cast(rotation);
        sd.transform = glm::scale(sd.transform, scale);
        sd.skeleton = instance->skeleton.get();
        sd.tint_color = comp.color;
        sd.material_id = comp.material;

        base.data_index = static_cast<u32>(spine_data_.size());
        spine_data_.push_back(sd);
        base.cached_sort_key_ = base.sortKey();
        items_.push_back(base);
        stats_.spine++;
    }
}
#endif

void RenderFrame::submit(const RenderItemBase& item, const SpriteData& data) {
    RenderItemBase copy = item;
    if (copy.stage == RenderStage::Transparent && copy.stage != current_stage_) {
        copy.stage = current_stage_;
    }

    copy.data_index = static_cast<u32>(sprite_data_.size());
    sprite_data_.push_back(data);
    copy.cached_sort_key_ = copy.sortKey();
    items_.push_back(copy);

    switch (copy.type) {
        case RenderType::Sprite: stats_.sprites++; break;
#ifdef ES_ENABLE_SPINE
        case RenderType::Spine: stats_.spine++; break;
#endif
        case RenderType::Mesh: stats_.meshes++; break;
        case RenderType::Text: stats_.text++; break;
        case RenderType::Particle: stats_.particles++; break;
        default: break;
    }
}

void RenderFrame::submitExternalTriangles(
    const f32* vertices, i32 vertexCount,
    const u16* indices, i32 indexCount,
    u32 textureId, i32 blendMode,
    const f32* transform16) {

    i32 floatCount = vertexCount * 8;

    if (ext_storage_count_ < ext_vertex_storage_.size()) {
        auto& vbuf = ext_vertex_storage_[ext_storage_count_];
        vbuf.assign(vertices, vertices + floatCount);
        auto& ibuf = ext_index_storage_[ext_storage_count_];
        ibuf.assign(indices, indices + indexCount);
    } else {
        ext_vertex_storage_.emplace_back(vertices, vertices + floatCount);
        ext_index_storage_.emplace_back(indices, indices + indexCount);
    }
    u32 storageIdx = ext_storage_count_++;

    RenderItemBase base;
    base.type = RenderType::ExternalMesh;
    base.stage = current_stage_;
    base.texture_id = 0;
    base.depth = 1.0f - static_cast<f32>(ext_submit_order_++) * 0.0001f;
    base.blend_mode = static_cast<BlendMode>(blendMode);

    ExternalMeshData ed;
    ed.ext_bind_texture = textureId;
    ed.ext_vertices = ext_vertex_storage_[storageIdx].data();
    ed.ext_vertex_count = vertexCount;
    ed.ext_indices = ext_index_storage_[storageIdx].data();
    ed.ext_index_count = indexCount;

    if (transform16) {
        ed.transform = glm::make_mat4(transform16);
    }

    base.data_index = static_cast<u32>(ext_data_.size());
    ext_data_.push_back(ed);
    base.cached_sort_key_ = base.sortKey();
    items_.push_back(base);
}

void RenderFrame::sortAndBucket() {
    u32 n = static_cast<u32>(items_.size());

    std::sort(items_.begin(), items_.end(),
        [](const RenderItemBase& a, const RenderItemBase& b) {
            return a.cached_sort_key_ < b.cached_sort_key_;
        });

    for (auto& sb : stage_boundaries_) {
        sb.begin = 0;
        sb.end = 0;
    }

    if (n == 0) return;

    u32 i = 0;
    while (i < n) {
        auto stage = items_[i].stage;
        u32 stageIdx = static_cast<u32>(stage);
        if (stageIdx < STAGE_COUNT) {
            stage_boundaries_[stageIdx].begin = i;
            while (i < n && items_[i].stage == stage) {
                ++i;
            }
            stage_boundaries_[stageIdx].end = i;
        } else {
            ++i;
        }
    }
}

void RenderFrame::executeStage(RenderStage stage) {
    u32 stageIdx = static_cast<u32>(stage);
    if (stageIdx >= STAGE_COUNT) return;

    auto& sb = stage_boundaries_[stageIdx];
    if (sb.begin >= sb.end) return;

    u32 batchStart = sb.begin;
    RenderType currentType = items_[batchStart].type;

    auto flushBatch = [&](u32 begin, u32 end) {
        switch (currentType) {
            case RenderType::Sprite:
                renderSprites(begin, end);
                break;
#ifdef ES_ENABLE_SPINE
            case RenderType::Spine:
                renderSpine(begin, end);
                break;
#endif
            case RenderType::Mesh:
                renderMeshes(begin, end);
                break;
            case RenderType::ExternalMesh:
                renderExternalMeshes(begin, end);
                break;
            case RenderType::Text:
                renderText(begin, end);
                break;
            case RenderType::Particle:
                renderParticles(begin, end);
                break;
            case RenderType::Shape:
                renderShapes(begin, end);
                break;
            case RenderType::UIElement:
                renderSprites(begin, end);
                break;
            default:
                break;
        }
    };

    for (u32 i = sb.begin; i < sb.end; ++i) {
        if (items_[i].type != currentType) {
            flushBatch(batchStart, i);
            batchStart = i;
            currentType = items_[i].type;
        }
    }

    flushBatch(batchStart, sb.end);
}

void RenderFrame::renderSprites(u32 begin, u32 end) {
    batcher_->setProjection(view_projection_);
    batcher_->beginBatch();

    bool curScissorOn = false;
    ScissorRect curRect{};
    bool stencilTestActive = false;
    bool stencilWriteActive = false;
    i32 curStencilRef = -1;

    for (u32 i = begin; i < end; ++i) {
        const auto& base = items_[i];
        const auto& sd = sprite_data_[base.data_index];

        if (base.scissor_enabled != curScissorOn ||
            (base.scissor_enabled && base.scissor != curRect)) {
            if (stencilWriteActive) {
                batcher_->flush();
                endStencilWrite();
                stencilWriteActive = false;
            }
            batcher_->flush();
            if (base.scissor_enabled) {
                glEnable(GL_SCISSOR_TEST);
                glScissor(base.scissor.x, base.scissor.y,
                          base.scissor.w, base.scissor.h);
            } else {
                glDisable(GL_SCISSOR_TEST);
            }
            curScissorOn = base.scissor_enabled;
            curRect = base.scissor;
        }

        if (!stencil_masks_.empty()) {
            auto stIt = stencil_masks_.find(static_cast<u32>(base.entity));
            if (stIt != stencil_masks_.end()) {
                if (stIt->second.is_mask) {
                    if (!stencilWriteActive || curStencilRef != stIt->second.ref_value) {
                        if (stencilWriteActive) {
                            batcher_->flush();
                            endStencilWrite();
                        } else {
                            batcher_->flush();
                        }
                        beginStencilWrite(stIt->second.ref_value);
                        stencilWriteActive = true;
                        curStencilRef = stIt->second.ref_value;
                    }

                    glm::vec2 position(base.world_position);
                    glm::vec2 finalSize = sd.size * base.world_scale;
                    f32 angle = base.world_angle;

                    if (std::abs(angle) > 0.001f) {
                        batcher_->drawRotatedQuad(position, finalSize, angle,
                            base.texture_id, base.color, sd.uv_offset, sd.uv_scale);
                    } else {
                        batcher_->drawQuad(glm::vec3(position.x, position.y, base.depth),
                            finalSize, base.texture_id, base.color, sd.uv_offset, sd.uv_scale);
                    }

                    continue;
                } else {
                    if (stencilWriteActive) {
                        batcher_->flush();
                        endStencilWrite();
                        stencilWriteActive = false;
                    }
                    if (!stencilTestActive || curStencilRef != stIt->second.ref_value) {
                        batcher_->flush();
                        beginStencilTest(stIt->second.ref_value);
                        stencilTestActive = true;
                        curStencilRef = stIt->second.ref_value;
                    }
                }
            } else {
                if (stencilWriteActive) {
                    batcher_->flush();
                    endStencilWrite();
                    stencilWriteActive = false;
                }
                if (stencilTestActive) {
                    batcher_->flush();
                    endStencilTest();
                    stencilTestActive = false;
                    curStencilRef = -1;
                }
            }
        }

        if (sd.material_id != 0) {
            batcher_->flush();
            accumulateMaterialSprite(base, sd);
            continue;
        }
        flushMaterialBatch();

        glm::vec2 position(base.world_position);
        glm::vec2 finalSize = sd.size * base.world_scale;
        f32 angle = base.world_angle;

        glm::vec2 uvOff = sd.uv_offset;
        glm::vec2 uvSc = sd.uv_scale;
        if (sd.flip_x) {
            uvOff.x += uvSc.x;
            uvSc.x = -uvSc.x;
        }
        if (sd.flip_y) {
            uvOff.y += uvSc.y;
            uvSc.y = -uvSc.y;
        }

        if (sd.use_nine_slice) {
            resource::SliceBorder border;
            border.left = sd.slice_border.x;
            border.right = sd.slice_border.y;
            border.top = sd.slice_border.z;
            border.bottom = sd.slice_border.w;

            batcher_->drawNineSlice(
                position,
                finalSize,
                base.texture_id,
                sd.texture_size,
                border,
                base.color,
                angle,
                uvOff,
                uvSc
            );
        } else if (std::abs(angle) > 0.001f) {
            batcher_->drawRotatedQuad(
                position,
                finalSize,
                angle,
                base.texture_id,
                base.color,
                uvOff,
                uvSc
            );
        } else {
            batcher_->drawQuad(
                glm::vec3(position.x, position.y, base.depth),
                finalSize,
                base.texture_id,
                base.color,
                uvOff,
                uvSc
            );
        }
    }

    flushMaterialBatch();

    if (stencilWriteActive) {
        batcher_->flush();
        endStencilWrite();
    }

    if (stencilTestActive) {
        batcher_->flush();
        endStencilTest();
    }

    if (curScissorOn) {
        batcher_->flush();
        glDisable(GL_SCISSOR_TEST);
    }

    batcher_->endBatch();
    stats_.draw_calls += batcher_->getDrawCallCount();
    stats_.triangles += batcher_->getQuadCount() * 2;
}

#ifdef ES_ENABLE_SPINE
void RenderFrame::renderSpine(u32 begin, u32 end) {
    spine_vertices_.clear();
    spine_indices_.clear();
    spine_tex_slots_.reset();
    spine_current_blend_ = BlendMode::Normal;

    static ::spine::SkeletonClipping clipper;

    for (u32 idx = begin; idx < end; ++idx) {
        const auto& base = items_[idx];
        const auto& sd = spine_data_[base.data_index];
        auto* skeleton = static_cast<::spine::Skeleton*>(sd.skeleton);
        if (!skeleton) continue;

        auto& drawOrder = skeleton->getDrawOrder();

        for (size_t i = 0; i < drawOrder.size(); ++i) {
            ::spine::Slot* slot = drawOrder[i];
            if (!slot) continue;

            ::spine::Attachment* attachment = slot->getAttachment();
            if (!attachment) continue;

            if (!slot->getData().isVisible()) continue;

            if (attachment->getRTTI().isExactly(::spine::ClippingAttachment::rtti)) {
                auto* clip = static_cast<::spine::ClippingAttachment*>(attachment);
                clipper.clipStart(*slot, clip);
                continue;
            }

            u32 textureId = context_.getWhiteTextureId();
            BlendMode blendMode = BlendMode::Normal;

            auto spineBlend = slot->getData().getBlendMode();
            switch (spineBlend) {
                case ::spine::BlendMode_Normal: blendMode = BlendMode::Normal; break;
                case ::spine::BlendMode_Additive: blendMode = BlendMode::Additive; break;
                case ::spine::BlendMode_Multiply: blendMode = BlendMode::Multiply; break;
                case ::spine::BlendMode_Screen: blendMode = BlendMode::Screen; break;
            }

            auto& skelColor = skeleton->getColor();
            auto& slotColor = slot->getColor();

            if (attachment->getRTTI().isExactly(::spine::RegionAttachment::rtti)) {
                auto* region = static_cast<::spine::RegionAttachment*>(attachment);

                if (spine_world_vertices_.size() < 8) {
                    spine_world_vertices_.resize(8);
                }
                region->computeWorldVertices(*slot, spine_world_vertices_.data(), 0, 2);

                auto* regionData = region->getRegion();
                if (!regionData) continue;

                if (regionData->rendererObject) {
                    u32 handleId = static_cast<u32>(reinterpret_cast<uintptr_t>(regionData->rendererObject)) - 1;
                    auto* tex = resource_manager_.getTexture(resource::TextureHandle(handleId));
                    if (tex) textureId = tex->getId();
                }

                auto* atlasRegion = static_cast<::spine::AtlasRegion*>(regionData);
                if (atlasRegion->page && atlasRegion->page->pma) {
                    if (blendMode == BlendMode::Normal) blendMode = BlendMode::PremultipliedAlpha;
                    else if (blendMode == BlendMode::Additive) blendMode = BlendMode::PmaAdditive;
                }

                if (blendMode != spine_current_blend_) {
                    flushSpineBatch();
                    spine_current_blend_ = blendMode;
                    RenderCommand::setBlendMode(blendMode);
                }

                f32 texIndex = spine_tex_slots_.findOrAllocate(textureId);
                if (texIndex < 0.0f) {
                    flushSpineBatch();
                    texIndex = spine_tex_slots_.findOrAllocate(textureId);
                    if (texIndex < 0.0f) {
                        ES_LOG_WARN("TextureSlotAllocator: failed after flush for spine region");
                        continue;
                    }
                }

                if (spine_vertices_.size() + 4 > 65535) {
                    flushSpineBatch();
                }

                auto& uvs = region->getUVs();
                auto& attachColor = region->getColor();

                f32 a = skelColor.a * slotColor.a * attachColor.a * sd.tint_color.a;
                f32 r = skelColor.r * slotColor.r * attachColor.r * sd.tint_color.r;
                f32 g = skelColor.g * slotColor.g * attachColor.g * sd.tint_color.g;
                f32 b = skelColor.b * slotColor.b * attachColor.b * sd.tint_color.b;

                if (blendMode == BlendMode::PremultipliedAlpha || blendMode == BlendMode::PmaAdditive) {
                    r *= a;
                    g *= a;
                    b *= a;
                }

                u16 baseIndex = static_cast<u16>(spine_vertices_.size());

                for (size_t j = 0; j < 4; ++j) {
                    glm::vec4 pos(spine_world_vertices_[j * 2], spine_world_vertices_[j * 2 + 1], 0.0f, 1.0f);
                    pos = sd.transform * pos;

                    SpineVertex vertex;
                    vertex.position = glm::vec3(pos.x, pos.y, base.depth);
                    vertex.color = glm::vec4(r, g, b, a);
                    vertex.uv = glm::vec2(uvs[j * 2], uvs[j * 2 + 1]);
                    vertex.texIndex = texIndex;
                    spine_vertices_.push_back(vertex);
                }

                spine_indices_.push_back(baseIndex);
                spine_indices_.push_back(baseIndex + 1);
                spine_indices_.push_back(baseIndex + 2);
                spine_indices_.push_back(baseIndex + 2);
                spine_indices_.push_back(baseIndex + 3);
                spine_indices_.push_back(baseIndex);

            } else if (attachment->getRTTI().isExactly(::spine::MeshAttachment::rtti)) {
                auto* mesh = static_cast<::spine::MeshAttachment*>(attachment);

                size_t vertexCount = mesh->getWorldVerticesLength() / 2;
                size_t worldVertLen = mesh->getWorldVerticesLength();
                if (spine_world_vertices_.size() < worldVertLen) {
                    spine_world_vertices_.resize(worldVertLen);
                }
                mesh->computeWorldVertices(*slot, 0, mesh->getWorldVerticesLength(),
                                           spine_world_vertices_.data(), 0, 2);

                auto* regionData = mesh->getRegion();
                if (!regionData) continue;

                if (regionData->rendererObject) {
                    u32 handleId = static_cast<u32>(reinterpret_cast<uintptr_t>(regionData->rendererObject)) - 1;
                    auto* tex = resource_manager_.getTexture(resource::TextureHandle(handleId));
                    if (tex) textureId = tex->getId();
                }

                auto* atlasRegion = static_cast<::spine::AtlasRegion*>(regionData);
                if (atlasRegion->page && atlasRegion->page->pma) {
                    if (blendMode == BlendMode::Normal) blendMode = BlendMode::PremultipliedAlpha;
                    else if (blendMode == BlendMode::Additive) blendMode = BlendMode::PmaAdditive;
                }

                if (blendMode != spine_current_blend_) {
                    flushSpineBatch();
                    spine_current_blend_ = blendMode;
                    RenderCommand::setBlendMode(blendMode);
                }

                f32 texIndex = spine_tex_slots_.findOrAllocate(textureId);
                if (texIndex < 0.0f) {
                    flushSpineBatch();
                    texIndex = spine_tex_slots_.findOrAllocate(textureId);
                    if (texIndex < 0.0f) {
                        ES_LOG_WARN("TextureSlotAllocator: failed after flush for spine mesh");
                        continue;
                    }
                }

                if (spine_vertices_.size() + vertexCount > 65535) {
                    flushSpineBatch();
                }

                auto& uvs = mesh->getUVs();
                auto& triangles = mesh->getTriangles();
                auto& attachColor = mesh->getColor();

                f32 a = skelColor.a * slotColor.a * attachColor.a * sd.tint_color.a;
                f32 r = skelColor.r * slotColor.r * attachColor.r * sd.tint_color.r;
                f32 g = skelColor.g * slotColor.g * attachColor.g * sd.tint_color.g;
                f32 b = skelColor.b * slotColor.b * attachColor.b * sd.tint_color.b;

                if (blendMode == BlendMode::PremultipliedAlpha || blendMode == BlendMode::PmaAdditive) {
                    r *= a;
                    g *= a;
                    b *= a;
                }

                u16 baseIndex = static_cast<u16>(spine_vertices_.size());

                for (size_t j = 0; j < vertexCount; ++j) {
                    glm::vec4 pos(spine_world_vertices_[j * 2], spine_world_vertices_[j * 2 + 1], 0.0f, 1.0f);
                    pos = sd.transform * pos;

                    SpineVertex vertex;
                    vertex.position = glm::vec3(pos.x, pos.y, base.depth);
                    vertex.color = glm::vec4(r, g, b, a);
                    vertex.uv = glm::vec2(uvs[j * 2], uvs[j * 2 + 1]);
                    vertex.texIndex = texIndex;
                    spine_vertices_.push_back(vertex);
                }

                for (size_t j = 0; j < triangles.size(); ++j) {
                    spine_indices_.push_back(static_cast<u16>(baseIndex + triangles[j]));
                }
            }

            clipper.clipEnd(*slot);
        }

        clipper.clipEnd();
    }

    flushSpineBatch();
    RenderCommand::setBlendMode(BlendMode::Normal);
}

void RenderFrame::flushSpineBatch() {
    if (spine_vertices_.empty() || spine_indices_.empty()) return;

    auto* shader = resource_manager_.getShader(spine_shader_handle_);
    if (!shader) {
        spine_vertices_.clear();
        spine_indices_.clear();
        return;
    }

    spine_tex_slots_.bindAll();

    shader->bind();
    shader->setUniform(shader->getUniformLocation("u_projection"), view_projection_);

    glBindVertexArray(spine_vao_);

    auto vboBytes = static_cast<GLsizeiptr>(spine_vertices_.size() * sizeof(SpineVertex));
    glBindBuffer(GL_ARRAY_BUFFER, spine_vbo_);
    if (static_cast<u32>(vboBytes) > spine_vbo_capacity_) {
        spine_vbo_capacity_ = static_cast<u32>(vboBytes) * 2;
        glBufferData(GL_ARRAY_BUFFER, spine_vbo_capacity_, nullptr, GL_STREAM_DRAW);
    }
    glBufferSubData(GL_ARRAY_BUFFER, 0, vboBytes, spine_vertices_.data());

    auto eboBytes = static_cast<GLsizeiptr>(spine_indices_.size() * sizeof(u16));
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, spine_ebo_);
    if (static_cast<u32>(eboBytes) > spine_ebo_capacity_) {
        spine_ebo_capacity_ = static_cast<u32>(eboBytes) * 2;
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, spine_ebo_capacity_, nullptr, GL_STREAM_DRAW);
    }
    glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, 0, eboBytes, spine_indices_.data());

    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(spine_indices_.size()),
                   GL_UNSIGNED_SHORT, nullptr);

    glBindVertexArray(0);

    stats_.triangles += static_cast<u32>(spine_indices_.size() / 3);
    stats_.draw_calls++;

    spine_vertices_.clear();
    spine_indices_.clear();
    spine_tex_slots_.reset();
}
#endif

void RenderFrame::renderExternalMeshes(u32 begin, u32 end) {
    auto* shader = context_.getExtMeshShader();
    if (!shader) shader = context_.getTextureShader();
    if (!shader) return;

    i32 locProjection = shader->getUniformLocation("u_projection");
    i32 locModel = shader->getUniformLocation("u_model");
    i32 locTexture = shader->getUniformLocation("u_texture");

    for (u32 idx = begin; idx < end; ++idx) {
        const auto& base = items_[idx];
        const auto& ed = ext_data_[base.data_index];
        if (!ed.ext_vertices || !ed.ext_indices ||
            ed.ext_vertex_count <= 0 || ed.ext_index_count <= 0) {
            continue;
        }

        RenderCommand::setBlendMode(base.blend_mode);

        shader->bind();
        shader->setUniform(locProjection, view_projection_);
        shader->setUniform(locModel, ed.transform);

        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, ed.ext_bind_texture);
        shader->setUniform(locTexture, 0);

        glBindVertexArray(ext_mesh_vao_);

        auto vboBytes = static_cast<GLsizeiptr>(
            ed.ext_vertex_count * 8 * sizeof(f32));
        glBindBuffer(GL_ARRAY_BUFFER, ext_mesh_vbo_);
        if (static_cast<u32>(vboBytes) > ext_mesh_vbo_capacity_) {
            ext_mesh_vbo_capacity_ = static_cast<u32>(vboBytes) * 2;
            glBufferData(GL_ARRAY_BUFFER, ext_mesh_vbo_capacity_,
                         nullptr, GL_STREAM_DRAW);
        }
        glBufferSubData(GL_ARRAY_BUFFER, 0, vboBytes, ed.ext_vertices);

        auto eboBytes = static_cast<GLsizeiptr>(
            ed.ext_index_count * sizeof(u16));
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ext_mesh_ebo_);
        if (static_cast<u32>(eboBytes) > ext_mesh_ebo_capacity_) {
            ext_mesh_ebo_capacity_ = static_cast<u32>(eboBytes) * 2;
            glBufferData(GL_ELEMENT_ARRAY_BUFFER, ext_mesh_ebo_capacity_,
                         nullptr, GL_STREAM_DRAW);
        }
        glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, 0, eboBytes, ed.ext_indices);

        glDrawElements(GL_TRIANGLES, ed.ext_index_count,
                       GL_UNSIGNED_SHORT, nullptr);

        glBindVertexArray(0);

        stats_.triangles += static_cast<u32>(ed.ext_index_count / 3);
        stats_.draw_calls++;
    }

    RenderCommand::setBlendMode(BlendMode::Normal);
}

void RenderFrame::renderMeshes(u32 begin, u32 end) {
    for (u32 i = begin; i < end; ++i) {
        const auto& base = items_[i];
        const auto& sd = sprite_data_[base.data_index];
        if (!sd.geometry || !sd.shader) continue;

        auto* geom = static_cast<CustomGeometry*>(sd.geometry);
        auto* shader = static_cast<Shader*>(sd.shader);
        if (!geom->isValid()) continue;

        shader->bind();
        shader->setUniform("u_projection", view_projection_);
        shader->setUniform("u_model", sd.transform);

        geom->bind();
        if (geom->hasIndices()) {
            auto* ib = geom->getVAO() ? geom->getVAO()->getIndexBuffer().get() : nullptr;
            if (ib) {
                GLenum type = ib->is16Bit() ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT;
                glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(geom->getIndexCount()), type, nullptr);
            }
        } else {
            glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(geom->getVertexCount()));
        }
        geom->unbind();

        stats_.draw_calls++;
        stats_.triangles += geom->hasIndices()
            ? static_cast<u32>(geom->getIndexCount() / 3)
            : static_cast<u32>(geom->getVertexCount() / 3);
    }
}

static u32 decodeUtf8(const char* data, u16 length, u16& pos) {
    u8 b0 = static_cast<u8>(data[pos]);
    if (b0 < 0x80) {
        return b0;
    }
    if ((b0 & 0xE0) == 0xC0 && pos + 1 < length) {
        u32 cp = (b0 & 0x1F) << 6;
        cp |= (static_cast<u8>(data[pos + 1]) & 0x3F);
        pos += 1;
        return cp;
    }
    if ((b0 & 0xF0) == 0xE0 && pos + 2 < length) {
        u32 cp = (b0 & 0x0F) << 12;
        cp |= (static_cast<u8>(data[pos + 1]) & 0x3F) << 6;
        cp |= (static_cast<u8>(data[pos + 2]) & 0x3F);
        pos += 2;
        return cp;
    }
    if ((b0 & 0xF8) == 0xF0 && pos + 3 < length) {
        u32 cp = (b0 & 0x07) << 18;
        cp |= (static_cast<u8>(data[pos + 1]) & 0x3F) << 12;
        cp |= (static_cast<u8>(data[pos + 2]) & 0x3F) << 6;
        cp |= (static_cast<u8>(data[pos + 3]) & 0x3F);
        pos += 3;
        return cp;
    }
    return b0;
}

void RenderFrame::renderText(u32 begin, u32 end) {
    batcher_->setProjection(view_projection_);
    batcher_->beginBatch();

    bool curScissorOn = false;
    ScissorRect curRect{};
    bool stencilTestActive = false;
    i32 curStencilRef = -1;

    for (u32 i = begin; i < end; ++i) {
        const auto& base = items_[i];
        const auto& td = text_data_[base.data_index];

        if (base.scissor_enabled != curScissorOn ||
            (base.scissor_enabled && base.scissor != curRect)) {
            batcher_->flush();
            if (base.scissor_enabled) {
                glEnable(GL_SCISSOR_TEST);
                glScissor(base.scissor.x, base.scissor.y,
                          base.scissor.w, base.scissor.h);
            } else {
                glDisable(GL_SCISSOR_TEST);
            }
            curScissorOn = base.scissor_enabled;
            curRect = base.scissor;
        }

        if (!stencil_masks_.empty()) {
            auto stIt = stencil_masks_.find(static_cast<u32>(base.entity));
            if (stIt != stencil_masks_.end() && !stIt->second.is_mask) {
                if (!stencilTestActive || curStencilRef != stIt->second.ref_value) {
                    batcher_->flush();
                    if (stencilTestActive) {
                        endStencilTest();
                    }
                    beginStencilTest(stIt->second.ref_value);
                    stencilTestActive = true;
                    curStencilRef = stIt->second.ref_value;
                }
            } else if (stencilTestActive) {
                batcher_->flush();
                endStencilTest();
                stencilTestActive = false;
                curStencilRef = -1;
            }
        }

        auto* font = static_cast<const text::BitmapFont*>(td.font_data);
        if (!font || !td.text_data || td.text_length == 0) {
            continue;
        }

        f32 texW = static_cast<f32>(font->getTexWidth());
        f32 texH = static_cast<f32>(font->getTexHeight());
        if (texW == 0 || texH == 0) {
            continue;
        }

        auto* tex = resource_manager_.getTexture(font->getTexture());
        u32 textureId = tex ? tex->getId() : 0;
        if (textureId == 0) {
            continue;
        }

        f32 scale = td.font_size * base.world_scale.x;
        f32 spacing = td.text_spacing;
        f32 fontBase = font->getBase();

        f32 totalWidth = 0;
        if (td.text_align != 0) {
            u32 prevChar = 0;
            for (u16 j = 0; j < td.text_length; ++j) {
                u32 charCode = decodeUtf8(td.text_data, td.text_length, j);
                auto* glyph = font->getGlyph(charCode);
                if (!glyph) {
                    continue;
                }
                if (prevChar) {
                    totalWidth += font->getKerning(prevChar, charCode) * scale;
                }
                totalWidth += (glyph->xAdvance + spacing) * scale;
                prevChar = charCode;
            }
        }

        f32 alignOffset = 0;
        if (td.text_align == 1) {
            alignOffset = -totalWidth * 0.5f;
        } else if (td.text_align == 2) {
            alignOffset = -totalWidth;
        }

        f32 cursorX = base.world_position.x + alignOffset;
        f32 baseY = base.world_position.y;

        u32 prevChar = 0;
        for (u16 j = 0; j < td.text_length; ++j) {
            u32 charCode = decodeUtf8(td.text_data, td.text_length, j);
            auto* glyph = font->getGlyph(charCode);
            if (!glyph) {
                continue;
            }

            if (prevChar) {
                cursorX += font->getKerning(prevChar, charCode) * scale;
            }

            if (glyph->width > 0 && glyph->height > 0) {
                f32 glyphW = glyph->width * scale;
                f32 glyphH = glyph->height * scale;

                f32 posX = cursorX + (glyph->xOffset + glyph->width * 0.5f) * scale;
                f32 posY = baseY + (fontBase - glyph->yOffset - glyph->height * 0.5f) * scale;

                f32 uvY = glyph->y / texH;
                f32 uvH = glyph->height / texH;
                glm::vec2 uvOffset(glyph->x / texW, uvY + uvH);
                glm::vec2 uvScale(glyph->width / texW, -uvH);

                batcher_->drawQuad(
                    glm::vec2(posX, posY),
                    glm::vec2(glyphW, glyphH),
                    textureId,
                    base.color,
                    uvOffset,
                    uvScale
                );
            }

            cursorX += (glyph->xAdvance + spacing) * scale;
            prevChar = charCode;
        }
    }

    if (stencilTestActive) {
        batcher_->flush();
        endStencilTest();
    }

    if (curScissorOn) {
        batcher_->flush();
        glDisable(GL_SCISSOR_TEST);
    }

    batcher_->endBatch();
    stats_.draw_calls += batcher_->getDrawCallCount();
    stats_.triangles += batcher_->getQuadCount() * 2;
}

void RenderFrame::accumulateMaterialSprite(const RenderItemBase& base, const SpriteData& sd) {
    bool needFlush = mat_batch_.material_id != 0 &&
        (mat_batch_.material_id != sd.material_id ||
         mat_batch_.texture_id != base.texture_id ||
         mat_batch_.color != base.color);

    if (needFlush) {
        flushMaterialBatch();
    }

    mat_batch_.material_id = sd.material_id;
    mat_batch_.texture_id = base.texture_id;
    mat_batch_.color = base.color;

    glm::vec2 halfSize = sd.size * 0.5f;
    glm::vec2 uvMin = sd.uv_offset;
    glm::vec2 uvMax = sd.uv_offset + sd.uv_scale;
    if (sd.flip_x) { std::swap(uvMin.x, uvMax.x); }
    if (sd.flip_y) { std::swap(uvMin.y, uvMax.y); }

    glm::vec4 corners[4] = {
        sd.transform * glm::vec4(-halfSize.x, -halfSize.y, 0.0f, 1.0f),
        sd.transform * glm::vec4( halfSize.x, -halfSize.y, 0.0f, 1.0f),
        sd.transform * glm::vec4( halfSize.x,  halfSize.y, 0.0f, 1.0f),
        sd.transform * glm::vec4(-halfSize.x,  halfSize.y, 0.0f, 1.0f),
    };

    auto baseIdx = static_cast<u16>(mat_batch_.vertices.size());

    mat_batch_.vertices.push_back({corners[0].x, corners[0].y, uvMin.x, uvMax.y, base.color.r, base.color.g, base.color.b, base.color.a});
    mat_batch_.vertices.push_back({corners[1].x, corners[1].y, uvMax.x, uvMax.y, base.color.r, base.color.g, base.color.b, base.color.a});
    mat_batch_.vertices.push_back({corners[2].x, corners[2].y, uvMax.x, uvMin.y, base.color.r, base.color.g, base.color.b, base.color.a});
    mat_batch_.vertices.push_back({corners[3].x, corners[3].y, uvMin.x, uvMin.y, base.color.r, base.color.g, base.color.b, base.color.a});

    mat_batch_.indices.push_back(baseIdx);
    mat_batch_.indices.push_back(baseIdx + 1);
    mat_batch_.indices.push_back(baseIdx + 2);
    mat_batch_.indices.push_back(baseIdx + 2);
    mat_batch_.indices.push_back(baseIdx + 3);
    mat_batch_.indices.push_back(baseIdx);
}

void RenderFrame::flushMaterialBatch() {
    if (mat_batch_.vertices.empty()) return;

    u32 shaderId = 0;
    u32 blendMode = 0;
    mat_uniforms_.clear();

    if (!getMaterialDataWithUniforms(mat_batch_.material_id, shaderId, blendMode, mat_uniforms_)) {
        mat_batch_.vertices.clear();
        mat_batch_.indices.clear();
        mat_batch_.material_id = 0;
        return;
    }

    Shader* shader = resource_manager_.getShader(resource::ShaderHandle(shaderId));
    if (!shader) {
        mat_batch_.vertices.clear();
        mat_batch_.indices.clear();
        mat_batch_.material_id = 0;
        return;
    }

    shader->bind();

    shader->setUniform(shader->getUniformLocation("u_projection"), view_projection_);
    shader->setUniform(shader->getUniformLocation("u_model"), glm::mat4(1.0f));
    shader->setUniform(shader->getUniformLocation("u_color"), mat_batch_.color);

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, mat_batch_.texture_id);
    shader->setUniform(shader->getUniformLocation("u_texture"), 0);

    for (const auto& ud : mat_uniforms_) {
        i32 loc = shader->getUniformLocation(ud.name);
        switch (ud.type) {
            case 0:
                shader->setUniform(loc, ud.values[0]);
                break;
            case 1:
                shader->setUniform(loc, glm::vec2(ud.values[0], ud.values[1]));
                break;
            case 2:
                shader->setUniform(loc, glm::vec3(ud.values[0], ud.values[1], ud.values[2]));
                break;
            case 3:
                shader->setUniform(loc, glm::vec4(ud.values[0], ud.values[1], ud.values[2], ud.values[3]));
                break;
        }
    }

    RenderCommand::setBlendMode(static_cast<BlendMode>(blendMode));

    glBindVertexArray(mat_sprite_vao_);
    glBindBuffer(GL_ARRAY_BUFFER, mat_sprite_vbo_);

    auto vboSize = static_cast<u32>(mat_batch_.vertices.size() * sizeof(MatSpriteVertex));
    if (vboSize > mat_sprite_vbo_capacity_) {
        glBufferData(GL_ARRAY_BUFFER, vboSize, mat_batch_.vertices.data(), GL_STREAM_DRAW);
        mat_sprite_vbo_capacity_ = vboSize;
    } else {
        glBufferSubData(GL_ARRAY_BUFFER, 0, vboSize, mat_batch_.vertices.data());
    }

    u32 programId = shader->getProgramId();
    if (programId != mat_sprite_last_shader_) {
        mat_sprite_last_shader_ = programId;

        GLint attrPos = shader->getAttribLocation("a_position");
        if (attrPos >= 0) {
            glEnableVertexAttribArray(attrPos);
            glVertexAttribPointer(attrPos, 2, GL_FLOAT, GL_FALSE, sizeof(MatSpriteVertex),
                                  reinterpret_cast<void*>(0));
        }

        GLint attrTex = shader->getAttribLocation("a_texCoord");
        if (attrTex >= 0) {
            glEnableVertexAttribArray(attrTex);
            glVertexAttribPointer(attrTex, 2, GL_FLOAT, GL_FALSE, sizeof(MatSpriteVertex),
                                  reinterpret_cast<void*>(2 * sizeof(f32)));
        }

        GLint attrColor = shader->getAttribLocation("a_color");
        if (attrColor >= 0) {
            glEnableVertexAttribArray(attrColor);
            glVertexAttribPointer(attrColor, 4, GL_FLOAT, GL_FALSE, sizeof(MatSpriteVertex),
                                  reinterpret_cast<void*>(4 * sizeof(f32)));
        }
    }

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, mat_sprite_ebo_);
    auto eboSize = static_cast<u32>(mat_batch_.indices.size() * sizeof(u16));
    if (eboSize > mat_sprite_ebo_capacity_) {
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, eboSize, mat_batch_.indices.data(), GL_STREAM_DRAW);
        mat_sprite_ebo_capacity_ = eboSize;
    } else {
        glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, 0, eboSize, mat_batch_.indices.data());
    }

    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(mat_batch_.indices.size()), GL_UNSIGNED_SHORT, nullptr);

    glBindVertexArray(0);
    RenderCommand::setBlendMode(BlendMode::Normal);

    stats_.draw_calls++;
    stats_.triangles += static_cast<u32>(mat_batch_.indices.size()) / 3;

    mat_batch_.vertices.clear();
    mat_batch_.indices.clear();
    mat_batch_.material_id = 0;
}

// ============================================================================
// Particle Rendering
// ============================================================================

void RenderFrame::submitParticles(ecs::Registry& registry,
                                   particle::ParticleSystem& particle_system) {
    auto emitterView = registry.view<ecs::Transform, ecs::ParticleEmitter>();

    for (auto entity : emitterView) {
        const auto& emitter = emitterView.get<ecs::ParticleEmitter>(entity);
        if (!emitter.enabled) continue;

        auto& transform = emitterView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();

        const auto* state = particle_system.getState(entity);
        if (!state) continue;

        u32 textureId = context_.getWhiteTextureId();
        if (emitter.texture.isValid()) {
            Texture* tex = resource_manager_.getTexture(emitter.texture);
            if (tex) {
                textureId = tex->getId();
            }
        }

        i32 cols = std::max(emitter.spriteColumns, 1);
        i32 rows = std::max(emitter.spriteRows, 1);
        f32 uvScaleX = 1.0f / static_cast<f32>(cols);
        f32 uvScaleY = 1.0f / static_cast<f32>(rows);

        bool isLocalSpace = emitter.simulationSpace ==
                            static_cast<i32>(ecs::SimulationSpace::Local);
        glm::vec3 emitterWorldPos = transform.worldPosition;
        f32 emitterAngle = 0.0f;
        glm::vec2 emitterScale(transform.worldScale);
        if (isLocalSpace) {
            const auto& rot = transform.worldRotation;
            emitterAngle = 2.0f * std::atan2(rot.z, rot.w);
        }

        state->pool.forEachAlive([&](const particle::Particle& p) {
            RenderItemBase base;
            base.entity = entity;
            base.type = RenderType::Particle;
            base.stage = current_stage_;
            base.blend_mode = static_cast<BlendMode>(emitter.blendMode);
            base.layer = emitter.layer;
            base.color = p.color;
            base.texture_id = textureId;

            if (isLocalSpace) {
                glm::vec2 worldPos = glm::vec2(emitterWorldPos) +
                    glm::vec2(p.position.x * emitterScale.x, p.position.y * emitterScale.y);
                if (std::abs(emitterAngle) > 0.001f) {
                    f32 cosA = std::cos(emitterAngle);
                    f32 sinA = std::sin(emitterAngle);
                    glm::vec2 rel = p.position * emitterScale;
                    worldPos = glm::vec2(emitterWorldPos) +
                        glm::vec2(rel.x * cosA - rel.y * sinA,
                                  rel.x * sinA + rel.y * cosA);
                }
                base.world_position = glm::vec3(worldPos, emitterWorldPos.z);
                base.world_scale = emitterScale;
            } else {
                base.world_position = glm::vec3(p.position, emitterWorldPos.z);
                base.world_scale = glm::vec2(1.0f);
            }

            base.world_angle = p.rotation;
            base.depth = base.world_position.z;

            ParticleRenderData pd;
            pd.size = glm::vec2(p.size);

            if (cols > 1 || rows > 1) {
                i32 col = p.sprite_frame % cols;
                i32 row = p.sprite_frame / cols;
                pd.uv_offset = glm::vec2(static_cast<f32>(col) * uvScaleX,
                                          static_cast<f32>(row) * uvScaleY);
                pd.uv_scale = glm::vec2(uvScaleX, uvScaleY);
            }

            pd.material_id = emitter.material;

            if (!clip_rects_.empty()) {
                auto it = clip_rects_.find(static_cast<u32>(entity));
                if (it != clip_rects_.end()) {
                    base.scissor_enabled = true;
                    base.scissor = it->second;
                }
            }

            base.data_index = static_cast<u32>(particle_data_.size());
            particle_data_.push_back(pd);
            base.cached_sort_key_ = base.sortKey();
            items_.push_back(base);
            stats_.particles++;
        });
    }
}

void RenderFrame::renderParticles(u32 begin, u32 end) {
    if (begin >= end) return;

#ifdef ES_PLATFORM_WEB
    Shader* defaultShader = resource_manager_.getShader(particle_shader_handle_);
    if (!defaultShader || !defaultShader->isValid()) return;

    glBindVertexArray(particle_vao_);

    bool curScissorOn = false;
    ScissorRect curScissorRect{};

    u32 batchStart = begin;
    const auto& firstBase = items_[begin];
    const auto& firstPd = particle_data_[firstBase.data_index];
    u32 batchTexture = firstBase.texture_id;
    BlendMode batchBlend = firstBase.blend_mode;
    u32 batchMaterial = firstPd.material_id;

    auto flushParticleBatch = [&](u32 bStart, u32 bEnd) {
        u32 count = bEnd - bStart;
        if (count == 0) return;

        particle_instances_.clear();
        particle_instances_.reserve(count);

        for (u32 i = bStart; i < bEnd; ++i) {
            const auto& base = items_[i];
            const auto& pd = particle_data_[base.data_index];

            ParticleInstanceData inst;
            inst.position = glm::vec2(base.world_position);
            inst.size = pd.size * base.world_scale;
            inst.rotation = base.world_angle;
            inst.color = base.color;
            inst.uv_offset = pd.uv_offset;
            inst.uv_scale = pd.uv_scale;
            particle_instances_.push_back(inst);
        }

        glBindBuffer(GL_ARRAY_BUFFER, particle_instance_vbo_);
        if (count > particle_instance_capacity_) {
            while (particle_instance_capacity_ < count) {
                particle_instance_capacity_ *= 2;
            }
        }
        glBufferData(GL_ARRAY_BUFFER,
                     particle_instance_capacity_ * sizeof(ParticleInstanceData),
                     nullptr, GL_DYNAMIC_DRAW);
        glBufferSubData(GL_ARRAY_BUFFER, 0,
                        count * sizeof(ParticleInstanceData),
                        particle_instances_.data());

        Shader* activeShader = defaultShader;

        if (batchMaterial != 0) {
            u32 shaderId = 0;
            u32 matBlendMode = 0;
            mat_uniforms_.clear();
            if (getMaterialDataWithUniforms(batchMaterial, shaderId, matBlendMode, mat_uniforms_)) {
                Shader* customShader = resource_manager_.getShader(resource::ShaderHandle(shaderId));
                if (customShader && customShader->isValid()) {
                    activeShader = customShader;
                    RenderCommand::setBlendMode(static_cast<BlendMode>(matBlendMode));
                } else {
                    RenderCommand::setBlendMode(batchBlend);
                }
            } else {
                RenderCommand::setBlendMode(batchBlend);
            }
        } else {
            RenderCommand::setBlendMode(batchBlend);
        }

        activeShader->bind();
        activeShader->setUniform("u_projection", view_projection_);

        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, batchTexture);
        activeShader->setUniform("u_texture", 0);

        if (batchMaterial != 0) {
            for (const auto& ud : mat_uniforms_) {
                i32 loc = activeShader->getUniformLocation(ud.name);
                if (loc < 0) continue;
                switch (ud.type) {
                    case 0: activeShader->setUniform(loc, ud.values[0]); break;
                    case 1: activeShader->setUniform(loc, glm::vec2(ud.values[0], ud.values[1])); break;
                    case 2: activeShader->setUniform(loc, glm::vec3(ud.values[0], ud.values[1], ud.values[2])); break;
                    case 3: activeShader->setUniform(loc, glm::vec4(ud.values[0], ud.values[1], ud.values[2], ud.values[3])); break;
                }
            }
        }

        glDrawElementsInstanced(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT,
                                nullptr, static_cast<i32>(count));
        stats_.draw_calls++;
        stats_.triangles += count * 2;
    };

    for (u32 i = begin; i < end; ++i) {
        const auto& base = items_[i];
        const auto& pd = particle_data_[base.data_index];

        bool scissorChanged = base.scissor_enabled != curScissorOn ||
            (base.scissor_enabled && base.scissor != curScissorRect);

        if (base.texture_id != batchTexture || base.blend_mode != batchBlend
            || pd.material_id != batchMaterial || scissorChanged) {
            flushParticleBatch(batchStart, i);

            if (scissorChanged) {
                if (base.scissor_enabled) {
                    glEnable(GL_SCISSOR_TEST);
                    glScissor(base.scissor.x, base.scissor.y,
                              base.scissor.w, base.scissor.h);
                } else {
                    glDisable(GL_SCISSOR_TEST);
                }
                curScissorOn = base.scissor_enabled;
                curScissorRect = base.scissor;
            }

            batchStart = i;
            batchTexture = base.texture_id;
            batchBlend = base.blend_mode;
            batchMaterial = pd.material_id;
        }
    }
    flushParticleBatch(batchStart, end);

    if (curScissorOn) {
        glDisable(GL_SCISSOR_TEST);
    }

    glBindVertexArray(0);
    RenderCommand::setBlendMode(BlendMode::Normal);
#else
    batcher_->setProjection(view_projection_);
    batcher_->beginBatch();

    for (u32 i = begin; i < end; ++i) {
        const auto& base = items_[i];
        const auto& pd = particle_data_[base.data_index];

        glm::vec2 position(base.world_position);
        glm::vec2 finalSize = pd.size * base.world_scale;
        f32 angle = base.world_angle;

        if (std::abs(angle) > 0.001f) {
            batcher_->drawRotatedQuad(position, finalSize, angle,
                base.texture_id, base.color, pd.uv_offset, pd.uv_scale);
        } else {
            batcher_->drawQuad(glm::vec3(position.x, position.y, base.depth),
                finalSize, base.texture_id, base.color, pd.uv_offset, pd.uv_scale);
        }
    }

    batcher_->endBatch();
    batcher_->flush();
    RenderCommand::setBlendMode(BlendMode::Normal);
#endif
}

// ============================================================================
// Shape Rendering
// ============================================================================

void RenderFrame::submitShapes(ecs::Registry& registry) {
    auto shapeView = registry.view<ecs::Transform, ecs::ShapeRenderer>();

    for (auto entity : shapeView) {
        const auto& shape = shapeView.get<ecs::ShapeRenderer>(entity);
        if (!shape.enabled) continue;

        auto& transform = shapeView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        glm::vec3 position = transform.worldPosition;
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;

        glm::vec3 halfExtents = glm::vec3(shape.size.x * scale.x, shape.size.y * scale.y, 0.0f) * 0.5f;
        if (!frustum_.intersectsAABB(position, halfExtents)) {
            stats_.culled++;
            continue;
        }

        RenderItemBase base;
        base.entity = entity;
        base.type = RenderType::Shape;
        base.stage = current_stage_;

        base.world_position = position;
        base.world_scale = glm::vec2(scale);
        f32 sinHalfAngle = rotation.z;
        f32 cosHalfAngle = rotation.w;
        base.world_angle = 2.0f * std::atan2(sinHalfAngle, cosHalfAngle);

        base.layer = shape.layer;
        base.depth = position.z;
        base.color = shape.color;
        base.texture_id = 0;

        ShapeData sd;
        sd.size = shape.size;
        sd.params = glm::vec3(
            static_cast<f32>(shape.shapeType),
            shape.cornerRadius,
            0.0f
        );

        base.data_index = static_cast<u32>(shape_data_.size());
        shape_data_.push_back(sd);
        base.cached_sort_key_ = base.sortKey();
        items_.push_back(base);
        stats_.shapes++;
    }
}

void RenderFrame::renderShapes(u32 begin, u32 end) {
    if (begin >= end) return;

    Shader* shader = resource_manager_.getShader(shape_shader_handle_);
    if (!shader || !shader->isValid()) return;

    shape_vertices_.clear();
    shape_indices_.clear();

    for (u32 i = begin; i < end; ++i) {
        const auto& base = items_[i];
        const auto& sd = shape_data_[base.data_index];

        glm::vec2 halfSize = sd.size * base.world_scale * 0.5f;
        f32 shapeType = sd.params.x;
        f32 cornerRadius = sd.params.y;

        f32 cosA = std::cos(base.world_angle);
        f32 sinA = std::sin(base.world_angle);

        glm::vec2 pos(base.world_position);

        glm::vec2 localCorners[4] = {
            {-halfSize.x, -halfSize.y},
            { halfSize.x, -halfSize.y},
            { halfSize.x,  halfSize.y},
            {-halfSize.x,  halfSize.y},
        };

        glm::vec2 uvCorners[4] = {
            {-1.0f, -1.0f},
            { 1.0f, -1.0f},
            { 1.0f,  1.0f},
            {-1.0f,  1.0f},
        };

        auto baseIdx = static_cast<u16>(shape_vertices_.size());

        for (u32 v = 0; v < 4; ++v) {
            f32 rx = localCorners[v].x * cosA - localCorners[v].y * sinA;
            f32 ry = localCorners[v].x * sinA + localCorners[v].y * cosA;

            ShapeVertex sv;
            sv.px = pos.x + rx;
            sv.py = pos.y + ry;
            sv.ux = uvCorners[v].x;
            sv.uy = uvCorners[v].y;
            sv.cr = base.color.r;
            sv.cg = base.color.g;
            sv.cb = base.color.b;
            sv.ca = base.color.a;
            sv.shapeType = shapeType;
            sv.halfW = halfSize.x;
            sv.halfH = halfSize.y;
            sv.cornerRadius = cornerRadius;
            shape_vertices_.push_back(sv);
        }

        shape_indices_.push_back(baseIdx);
        shape_indices_.push_back(baseIdx + 1);
        shape_indices_.push_back(baseIdx + 2);
        shape_indices_.push_back(baseIdx + 2);
        shape_indices_.push_back(baseIdx + 3);
        shape_indices_.push_back(baseIdx);
    }

    shader->bind();
    shader->setUniform("u_projection", view_projection_);

    RenderCommand::setBlendMode(BlendMode::Normal);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    glBindVertexArray(shape_vao_);
    glBindBuffer(GL_ARRAY_BUFFER, shape_vbo_);

    auto vboSize = static_cast<u32>(shape_vertices_.size() * sizeof(ShapeVertex));
    if (vboSize > shape_vbo_capacity_) {
        shape_vbo_capacity_ = vboSize * 2;
        glBufferData(GL_ARRAY_BUFFER, shape_vbo_capacity_, nullptr, GL_STREAM_DRAW);
    }
    glBufferSubData(GL_ARRAY_BUFFER, 0, vboSize, shape_vertices_.data());

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, shape_ebo_);
    auto eboSize = static_cast<u32>(shape_indices_.size() * sizeof(u16));
    if (eboSize > shape_ebo_capacity_) {
        shape_ebo_capacity_ = eboSize * 2;
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, shape_ebo_capacity_, nullptr, GL_STREAM_DRAW);
    }
    glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, 0, eboSize, shape_indices_.data());

    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(shape_indices_.size()), GL_UNSIGNED_SHORT, nullptr);

    glBindVertexArray(0);

    stats_.draw_calls++;
    stats_.triangles += static_cast<u32>(shape_indices_.size()) / 3;
}

}  // namespace esengine

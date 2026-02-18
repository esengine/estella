#include "RenderFrame.hpp"
#include "Renderer.hpp"
#include "RenderCommand.hpp"
#include "Texture.hpp"
#include "../core/Log.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/BitmapText.hpp"
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

struct UniformData {
    char name[32];
    u32 type;
    f32 values[4];
};

#ifdef ES_PLATFORM_WEB
extern bool getMaterialData(u32 materialId, u32& shaderId, u32& blendMode);
extern bool getMaterialDataWithUniforms(u32 materialId, u32& shaderId, u32& blendMode,
                                        std::vector<UniformData>& uniforms);
#else
bool getMaterialData(u32 /*materialId*/, u32& /*shaderId*/, u32& /*blendMode*/) {
    return false;
}
bool getMaterialDataWithUniforms(u32 /*materialId*/, u32& /*shaderId*/, u32& /*blendMode*/,
                                 std::vector<UniformData>& /*uniforms*/) {
    return false;
}
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
    sorted_indices_.reserve(1024);
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

    spine_shader_handle_ = resource_manager_.createShader(
        ShaderSources::BATCH_VERTEX,
        ShaderSources::BATCH_FRAGMENT
    );
    Shader* spineShader = resource_manager_.getShader(spine_shader_handle_);
    if (!spineShader || !spineShader->isValid()) {
        spine_shader_handle_ = resource_manager_.createShader(
            ShaderSources::BATCH_VERTEX_COMPAT,
            ShaderSources::BATCH_FRAGMENT_COMPAT
        );
        spineShader = resource_manager_.getShader(spine_shader_handle_);
    }
    if (spineShader && spineShader->isValid()) {
        GLuint prog = spineShader->getProgramId();
        glBindAttribLocation(prog, 0, "a_position");
        glBindAttribLocation(prog, 1, "a_color");
        glBindAttribLocation(prog, 2, "a_texCoord");
        glBindAttribLocation(prog, 3, "a_texIndex");
        glLinkProgram(prog);

        GLint linkStatus;
        glGetProgramiv(prog, GL_LINK_STATUS, &linkStatus);
        if (linkStatus) {
            spineShader->bind();
            GLint baseLoc = glGetUniformLocation(prog, "u_textures[0]");
            if (baseLoc >= 0) {
                for (i32 i = 0; i < static_cast<i32>(SPINE_MAX_TEXTURE_SLOTS); ++i) {
                    glUniform1i(baseLoc + i, i);
                }
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
    mat_sprite_ebo_initialized_ = false;

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
    mat_sprite_ebo_initialized_ = false;

    items_.clear();
    sorted_indices_.clear();
    sprite_data_.clear();
    text_data_.clear();
    ext_data_.clear();
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
    sorted_indices_.clear();
    sprite_data_.clear();
    text_data_.clear();
    ext_data_.clear();
#ifdef ES_ENABLE_SPINE
    spine_data_.clear();
#endif
    ext_storage_count_ = 0;
    ext_submit_order_ = 0;
    stats_ = Stats{};

    bool usePostProcess = post_process_ && post_process_->isInitialized() &&
                          !post_process_->isBypassed() && post_process_->getPassCount() > 0;

    if (usePostProcess) {
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

void RenderFrame::beginStencilWrite(i32 refValue) {
    glEnable(GL_STENCIL_TEST);
    glStencilFunc(GL_ALWAYS, refValue, 0xFF);
    glStencilOp(GL_KEEP, GL_KEEP, GL_REPLACE);
    glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE);
    glStencilMask(0xFF);
}

void RenderFrame::endStencilWrite() {
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glStencilMask(0x00);
}

void RenderFrame::beginStencilTest(i32 refValue) {
    glEnable(GL_STENCIL_TEST);
    glStencilFunc(GL_EQUAL, refValue, 0xFF);
    glStencilOp(GL_KEEP, GL_KEEP, GL_KEEP);
    glStencilMask(0x00);
}

void RenderFrame::endStencilTest() {
    glDisable(GL_STENCIL_TEST);
    glStencilMask(0xFF);
}

void RenderFrame::submitSprites(ecs::Registry& registry) {
    auto spriteView = registry.view<ecs::LocalTransform, ecs::Sprite>();

    for (auto entity : spriteView) {
        const auto& sprite = spriteView.get<ecs::Sprite>(entity);
        if (!sprite.enabled) continue;

        glm::vec3 position;
        glm::quat rotation;
        glm::vec3 scale;

        if (registry.has<ecs::WorldTransform>(entity)) {
            const auto& world = registry.get<ecs::WorldTransform>(entity);
            position = world.position;
            rotation = world.rotation;
            scale = world.scale;
        } else {
            const auto& local = spriteView.get<ecs::LocalTransform>(entity);
            position = local.position;
            rotation = local.rotation;
            scale = local.scale;
        }

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
        items_.push_back(base);
        stats_.sprites++;
    }
}

void RenderFrame::submitBitmapText(ecs::Registry& registry) {
    auto textView = registry.view<ecs::LocalTransform, ecs::BitmapText>();

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

        glm::vec3 position;
        glm::vec3 scale{1.0f};

        if (registry.has<ecs::WorldTransform>(entity)) {
            const auto& world = registry.get<ecs::WorldTransform>(entity);
            position = world.position;
            scale = world.scale;
        } else {
            const auto& local = textView.get<ecs::LocalTransform>(entity);
            position = local.position;
            scale = local.scale;
        }

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

        if (registry.has<ecs::WorldTransform>(entity)) {
            const auto& world = registry.get<ecs::WorldTransform>(entity);
            position = world.position;
            rotation = world.rotation;
            scale = world.scale;
        } else if (registry.has<ecs::LocalTransform>(entity)) {
            const auto& local = registry.get<ecs::LocalTransform>(entity);
            position = local.position;
            rotation = local.rotation;
            scale = local.scale;
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
    items_.push_back(copy);

    switch (copy.type) {
        case RenderType::Sprite: stats_.sprites++; break;
#ifdef ES_ENABLE_SPINE
        case RenderType::Spine: stats_.spine++; break;
#endif
        case RenderType::Mesh: stats_.meshes++; break;
        case RenderType::Text: stats_.text++; break;
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
    items_.push_back(base);
}

void RenderFrame::sortAndBucket() {
    u32 n = static_cast<u32>(items_.size());
    sorted_indices_.resize(n);
    for (u32 i = 0; i < n; ++i) {
        sorted_indices_[i] = i;
    }

    std::sort(sorted_indices_.begin(), sorted_indices_.end(),
        [this](u32 a, u32 b) {
            return items_[a].sortKey() < items_[b].sortKey();
        });

    for (auto& sb : stage_boundaries_) {
        sb.begin = 0;
        sb.end = 0;
    }

    if (n == 0) return;

    u32 i = 0;
    while (i < n) {
        auto stage = items_[sorted_indices_[i]].stage;
        u32 stageIdx = static_cast<u32>(stage);
        if (stageIdx < STAGE_COUNT) {
            stage_boundaries_[stageIdx].begin = i;
            while (i < n && items_[sorted_indices_[i]].stage == stage) {
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
    RenderType currentType = items_[sorted_indices_[batchStart]].type;

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
            default:
                break;
        }
    };

    for (u32 i = sb.begin; i < sb.end; ++i) {
        if (items_[sorted_indices_[i]].type != currentType) {
            flushBatch(batchStart, i);
            batchStart = i;
            currentType = items_[sorted_indices_[i]].type;
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
    i32 curStencilRef = -1;

    for (u32 i = begin; i < end; ++i) {
        const auto& base = items_[sorted_indices_[i]];
        const auto& sd = sprite_data_[base.data_index];

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
            if (stIt != stencil_masks_.end()) {
                if (stIt->second.is_mask) {
                    batcher_->flush();
                    beginStencilWrite(stIt->second.ref_value);

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

                    batcher_->flush();
                    endStencilWrite();
                    continue;
                } else {
                    if (!stencilTestActive || curStencilRef != stIt->second.ref_value) {
                        batcher_->flush();
                        beginStencilTest(stIt->second.ref_value);
                        stencilTestActive = true;
                        curStencilRef = stIt->second.ref_value;
                    }
                }
            } else if (stencilTestActive) {
                batcher_->flush();
                endStencilTest();
                stencilTestActive = false;
                curStencilRef = -1;
            }
        }

        if (sd.material_id != 0) {
            batcher_->flush();
            renderSpriteWithMaterial(base, sd);
            continue;
        }

        glm::vec2 position(base.world_position);
        glm::vec2 finalSize = sd.size * base.world_scale;
        f32 angle = base.world_angle;

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
                sd.uv_offset,
                sd.uv_scale
            );
        } else if (std::abs(angle) > 0.001f) {
            batcher_->drawRotatedQuad(
                position,
                finalSize,
                angle,
                base.texture_id,
                base.color,
                sd.uv_offset,
                sd.uv_scale
            );
        } else {
            batcher_->drawQuad(
                glm::vec3(position.x, position.y, base.depth),
                finalSize,
                base.texture_id,
                base.color,
                sd.uv_offset,
                sd.uv_scale
            );
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

#ifdef ES_ENABLE_SPINE
void RenderFrame::renderSpine(u32 begin, u32 end) {
    spine_vertices_.clear();
    spine_indices_.clear();
    spine_tex_slots_.reset();

    static ::spine::SkeletonClipping clipper;

    for (u32 idx = begin; idx < end; ++idx) {
        const auto& base = items_[sorted_indices_[idx]];
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
        const auto& base = items_[sorted_indices_[idx]];
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
}

void RenderFrame::renderMeshes(u32 begin, u32 end) {
    for (u32 i = begin; i < end; ++i) {
        const auto& base = items_[sorted_indices_[i]];
        const auto& sd = sprite_data_[base.data_index];
        if (!sd.geometry || !sd.shader) continue;
        stats_.draw_calls++;
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
        const auto& base = items_[sorted_indices_[i]];
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

void RenderFrame::renderSpriteWithMaterial(const RenderItemBase& base, const SpriteData& sd) {
    u32 shaderId = 0;
    u32 blendMode = 0;
    static std::vector<UniformData> uniforms;
    uniforms.clear();

    if (!getMaterialDataWithUniforms(sd.material_id, shaderId, blendMode, uniforms)) {
        return;
    }

    Shader* shader = resource_manager_.getShader(resource::ShaderHandle(shaderId));
    if (!shader) return;

    shader->bind();

    i32 locProj = shader->getUniformLocation("u_projection");
    i32 locModel = shader->getUniformLocation("u_model");
    i32 locColor = shader->getUniformLocation("u_color");
    i32 locTex = shader->getUniformLocation("u_texture");

    shader->setUniform(locProj, view_projection_);
    shader->setUniform(locModel, sd.transform);
    shader->setUniform(locColor, base.color);

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, base.texture_id);
    shader->setUniform(locTex, 0);

    for (const auto& ud : uniforms) {
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

    glm::vec2 halfSize = sd.size * 0.5f;

    struct MatSpriteVertex {
        f32 px, py;
        f32 tx, ty;
        f32 cr, cg, cb, ca;
    };

    MatSpriteVertex vertices[4] = {
        { -halfSize.x, -halfSize.y, 0.0f, 1.0f, base.color.r, base.color.g, base.color.b, base.color.a },
        {  halfSize.x, -halfSize.y, 1.0f, 1.0f, base.color.r, base.color.g, base.color.b, base.color.a },
        {  halfSize.x,  halfSize.y, 1.0f, 0.0f, base.color.r, base.color.g, base.color.b, base.color.a },
        { -halfSize.x,  halfSize.y, 0.0f, 0.0f, base.color.r, base.color.g, base.color.b, base.color.a },
    };

    glBindVertexArray(mat_sprite_vao_);

    glBindBuffer(GL_ARRAY_BUFFER, mat_sprite_vbo_);
    if (!mat_sprite_vbo_allocated_) {
        glBufferData(GL_ARRAY_BUFFER, sizeof(MatSpriteVertex) * 4, nullptr, GL_STREAM_DRAW);
        mat_sprite_vbo_allocated_ = true;
    }
    glBufferSubData(GL_ARRAY_BUFFER, 0, sizeof(vertices), vertices);

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

    if (!mat_sprite_ebo_initialized_) {
        u16 indices[] = { 0, 1, 2, 2, 3, 0 };
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, mat_sprite_ebo_);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), indices, GL_STATIC_DRAW);
        mat_sprite_ebo_initialized_ = true;
    } else {
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, mat_sprite_ebo_);
    }

    glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, nullptr);

    if (attrPos >= 0) glDisableVertexAttribArray(attrPos);
    if (attrTex >= 0) glDisableVertexAttribArray(attrTex);
    if (attrColor >= 0) glDisableVertexAttribArray(attrColor);

    glBindVertexArray(0);

    stats_.draw_calls++;
    stats_.triangles += 2;
}

}  // namespace esengine

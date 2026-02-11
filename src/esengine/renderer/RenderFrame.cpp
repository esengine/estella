#include "RenderFrame.hpp"
#include "Renderer.hpp"
#include "RenderCommand.hpp"
#include "Texture.hpp"
#include "../core/Log.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
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

struct UniformData {
    std::string name;
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
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(SpineVertex),
                          reinterpret_cast<void*>(offsetof(SpineVertex, position)));
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, sizeof(SpineVertex),
                          reinterpret_cast<void*>(offsetof(SpineVertex, uv)));
    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, sizeof(SpineVertex),
                          reinterpret_cast<void*>(offsetof(SpineVertex, color)));

    glBindVertexArray(0);
    spine_vbo_capacity_ = 0;
    spine_ebo_capacity_ = 0;
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

    ES_LOG_INFO("RenderFrame initialized ({}x{})", width, height);
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
    current_target_ = target;
    current_stage_ = RenderStage::Transparent;
    in_frame_ = true;

    items_.clear();
    ext_vertex_storage_.clear();
    ext_index_storage_.clear();
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
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
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

void RenderFrame::submitSprites(ecs::Registry& registry) {
    auto spriteView = registry.view<ecs::LocalTransform, ecs::Sprite>();

    for (auto entity : spriteView) {
        const auto& sprite = spriteView.get<ecs::Sprite>(entity);

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

        RenderItem item;
        item.entity = entity;
        item.type = RenderType::Sprite;
        item.stage = current_stage_;

        item.world_position = position;
        item.world_scale = glm::vec2(scale);
        f32 sinHalfAngle = rotation.z;
        f32 cosHalfAngle = rotation.w;
        item.world_angle = 2.0f * std::atan2(sinHalfAngle, cosHalfAngle);

        if (sprite.material != 0) {
            item.transform = glm::mat4(1.0f);
            item.transform = glm::translate(item.transform, position);
            item.transform *= glm::mat4_cast(rotation);
            item.transform = glm::scale(item.transform, scale);
        }

        item.layer = sprite.layer;
        item.depth = position.z;
        item.size = sprite.size;
        item.color = sprite.color;
        item.uv_offset = sprite.uvOffset;
        item.uv_scale = sprite.uvScale;
        item.flip_x = sprite.flipX;
        item.flip_y = sprite.flipY;

        item.texture_id = context_.getWhiteTextureId();
        if (sprite.texture.isValid()) {
            Texture* tex = resource_manager_.getTexture(sprite.texture);
            if (tex) {
                item.texture_id = tex->getId();
                item.texture_size = glm::vec2(
                    static_cast<f32>(tex->getWidth()),
                    static_cast<f32>(tex->getHeight())
                );

                const auto* metadata = resource_manager_.getTextureMetadata(sprite.texture);
                if (metadata && metadata->sliceBorder.hasSlicing()) {
                    item.use_nine_slice = true;
                    item.slice_border = glm::vec4(
                        metadata->sliceBorder.left,
                        metadata->sliceBorder.right,
                        metadata->sliceBorder.top,
                        metadata->sliceBorder.bottom
                    );
                }
            }
        }

        item.material_id = sprite.material;

        items_.push_back(item);
        stats_.sprites++;
    }
}

#ifdef ES_ENABLE_SPINE
void RenderFrame::submitSpine(ecs::Registry& registry, spine::SpineSystem& spine_system) {
    auto view = registry.view<ecs::SpineAnimation>();

    for (auto entity : view) {
        auto& comp = registry.get<ecs::SpineAnimation>(entity);
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

        RenderItem item;
        item.entity = entity;
        item.type = RenderType::Spine;
        item.stage = current_stage_;

        item.transform = glm::mat4(1.0f);
        item.transform = glm::translate(item.transform, position);
        item.transform *= glm::mat4_cast(rotation);
        item.transform = glm::scale(item.transform, scale);

        item.world_position = position;
        item.world_scale = glm::vec2(scale);

        item.layer = comp.layer;
        item.depth = position.z;
        item.skeleton = instance->skeleton.get();
        item.tint_color = comp.color;
        item.material_id = comp.material;

        items_.push_back(item);
        stats_.spine++;
    }
}
#endif

void RenderFrame::submit(const RenderItem& item) {
    RenderItem copy = item;
    if (copy.stage == RenderStage::Transparent && copy.stage != current_stage_) {
        copy.stage = current_stage_;
    }
    items_.push_back(copy);

    switch (copy.type) {
        case RenderType::Sprite: stats_.sprites++; break;
#ifdef ES_ENABLE_SPINE
        case RenderType::Spine: stats_.spine++; break;
#endif
        case RenderType::Mesh: stats_.meshes++; break;
        default: break;
    }
}

void RenderFrame::submitExternalTriangles(
    const f32* vertices, i32 vertexCount,
    const u16* indices, i32 indexCount,
    u32 textureId, i32 blendMode,
    const f32* transform16) {

    i32 floatCount = vertexCount * 8;
    ext_vertex_storage_.emplace_back(vertices, vertices + floatCount);
    ext_index_storage_.emplace_back(indices, indices + indexCount);

    RenderItem item;
    item.type = RenderType::ExternalMesh;
    item.stage = current_stage_;
    item.ext_bind_texture = textureId;
    item.texture_id = 0;
    item.depth = 1.0f - static_cast<f32>(ext_submit_order_++) * 0.0001f;
    item.blend_mode = static_cast<BlendMode>(blendMode);
    item.ext_vertices = ext_vertex_storage_.back().data();
    item.ext_vertex_count = vertexCount;
    item.ext_indices = ext_index_storage_.back().data();
    item.ext_index_count = indexCount;

    if (transform16) {
        item.transform = glm::make_mat4(transform16);
    }

    items_.push_back(item);
}

void RenderFrame::sortAndBucket() {
    std::sort(items_.begin(), items_.end(),
        [](const RenderItem& a, const RenderItem& b) {
            return a.sortKey() < b.sortKey();
        });

    for (auto& sb : stage_boundaries_) {
        sb.begin = 0;
        sb.end = 0;
    }

    if (items_.empty()) return;

    u32 n = static_cast<u32>(items_.size());
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

    for (u32 i = begin; i < end; ++i) {
        auto* item = &items_[i];

        if (item->material_id != 0) {
            batcher_->flush();
            renderSpriteWithMaterial(item);
            continue;
        }

        glm::vec2 position(item->world_position);
        glm::vec2 finalSize = item->size * item->world_scale;
        f32 angle = item->world_angle;

        if (item->use_nine_slice) {
            resource::SliceBorder border;
            border.left = item->slice_border.x;
            border.right = item->slice_border.y;
            border.top = item->slice_border.z;
            border.bottom = item->slice_border.w;

            batcher_->drawNineSlice(
                position,
                finalSize,
                item->texture_id,
                item->texture_size,
                border,
                item->color,
                angle,
                item->uv_offset,
                item->uv_scale
            );
        } else if (std::abs(angle) > 0.001f) {
            batcher_->drawRotatedQuad(
                position,
                finalSize,
                angle,
                item->texture_id,
                item->color,
                item->uv_offset,
                item->uv_scale
            );
        } else {
            batcher_->drawQuad(
                glm::vec3(position.x, position.y, item->depth),
                finalSize,
                item->texture_id,
                item->color,
                item->uv_offset,
                item->uv_scale
            );
        }
    }

    batcher_->endBatch();
    stats_.draw_calls += batcher_->getDrawCallCount();
    stats_.triangles += batcher_->getQuadCount() * 2;
}

#ifdef ES_ENABLE_SPINE
void RenderFrame::renderSpine(u32 begin, u32 end) {
    spine_vertices_.clear();
    spine_indices_.clear();
    spine_current_texture_ = 0;

    static ::spine::SkeletonClipping clipper;

    for (u32 idx = begin; idx < end; ++idx) {
        auto* item = &items_[idx];
        auto* skeleton = static_cast<::spine::Skeleton*>(item->skeleton);
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

                spine_world_vertices_.resize(8);
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

                bool needFlush = textureId != spine_current_texture_ || blendMode != spine_current_blend_;
                if (!needFlush && spine_vertices_.size() + 4 > 65535) {
                    needFlush = true;
                }

                if (needFlush) {
                    flushSpineBatch();
                    spine_current_texture_ = textureId;
                    spine_current_blend_ = blendMode;
                    RenderCommand::setBlendMode(blendMode);
                }

                auto& uvs = region->getUVs();
                auto& attachColor = region->getColor();

                f32 r = skelColor.r * slotColor.r * attachColor.r * item->tint_color.r;
                f32 g = skelColor.g * slotColor.g * attachColor.g * item->tint_color.g;
                f32 b = skelColor.b * slotColor.b * attachColor.b * item->tint_color.b;
                f32 a = skelColor.a * slotColor.a * attachColor.a * item->tint_color.a;

                u16 baseIndex = static_cast<u16>(spine_vertices_.size());

                for (size_t j = 0; j < 4; ++j) {
                    glm::vec4 pos(spine_world_vertices_[j * 2], spine_world_vertices_[j * 2 + 1], 0.0f, 1.0f);
                    pos = item->transform * pos;

                    SpineVertex vertex;
                    vertex.position = glm::vec2(pos.x, pos.y);
                    vertex.uv = glm::vec2(uvs[j * 2], uvs[j * 2 + 1]);
                    vertex.color = glm::vec4(r, g, b, a);
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
                spine_world_vertices_.resize(mesh->getWorldVerticesLength());
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

                bool needFlush = textureId != spine_current_texture_ || blendMode != spine_current_blend_;
                if (!needFlush && spine_vertices_.size() + vertexCount > 65535) {
                    needFlush = true;
                }

                if (needFlush) {
                    flushSpineBatch();
                    spine_current_texture_ = textureId;
                    spine_current_blend_ = blendMode;
                    RenderCommand::setBlendMode(blendMode);
                }

                auto& uvs = mesh->getUVs();
                auto& triangles = mesh->getTriangles();
                auto& attachColor = mesh->getColor();

                f32 r = skelColor.r * slotColor.r * attachColor.r * item->tint_color.r;
                f32 g = skelColor.g * slotColor.g * attachColor.g * item->tint_color.g;
                f32 b = skelColor.b * slotColor.b * attachColor.b * item->tint_color.b;
                f32 a = skelColor.a * slotColor.a * attachColor.a * item->tint_color.a;

                u16 baseIndex = static_cast<u16>(spine_vertices_.size());

                for (size_t j = 0; j < vertexCount; ++j) {
                    glm::vec4 pos(spine_world_vertices_[j * 2], spine_world_vertices_[j * 2 + 1], 0.0f, 1.0f);
                    pos = item->transform * pos;

                    SpineVertex vertex;
                    vertex.position = glm::vec2(pos.x, pos.y);
                    vertex.uv = glm::vec2(uvs[j * 2], uvs[j * 2 + 1]);
                    vertex.color = glm::vec4(r, g, b, a);
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

    auto* shader = context_.getTextureShader();
    if (!shader) {
        spine_vertices_.clear();
        spine_indices_.clear();
        return;
    }

    shader->bind();
    shader->setUniform("u_projection", view_projection_);
    shader->setUniform("u_model", glm::mat4(1.0f));
    shader->setUniform("u_color", glm::vec4(1.0f));

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, spine_current_texture_);
    shader->setUniform("u_texture", 0);

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
}
#endif

void RenderFrame::renderExternalMeshes(u32 begin, u32 end) {
    auto* shader = context_.getExtMeshShader();
    if (!shader) shader = context_.getTextureShader();
    if (!shader) return;

    for (u32 idx = begin; idx < end; ++idx) {
        auto* item = &items_[idx];
        if (!item->ext_vertices || !item->ext_indices ||
            item->ext_vertex_count <= 0 || item->ext_index_count <= 0) {
            continue;
        }

        RenderCommand::setBlendMode(item->blend_mode);

        shader->bind();
        shader->setUniform("u_projection", view_projection_);
        shader->setUniform("u_model", item->transform);

        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, item->ext_bind_texture);
        shader->setUniform("u_texture", 0);

        glBindVertexArray(ext_mesh_vao_);

        auto vboBytes = static_cast<GLsizeiptr>(
            item->ext_vertex_count * 8 * sizeof(f32));
        glBindBuffer(GL_ARRAY_BUFFER, ext_mesh_vbo_);
        if (static_cast<u32>(vboBytes) > ext_mesh_vbo_capacity_) {
            ext_mesh_vbo_capacity_ = static_cast<u32>(vboBytes) * 2;
            glBufferData(GL_ARRAY_BUFFER, ext_mesh_vbo_capacity_,
                         nullptr, GL_STREAM_DRAW);
        }
        glBufferSubData(GL_ARRAY_BUFFER, 0, vboBytes, item->ext_vertices);

        auto eboBytes = static_cast<GLsizeiptr>(
            item->ext_index_count * sizeof(u16));
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ext_mesh_ebo_);
        if (static_cast<u32>(eboBytes) > ext_mesh_ebo_capacity_) {
            ext_mesh_ebo_capacity_ = static_cast<u32>(eboBytes) * 2;
            glBufferData(GL_ELEMENT_ARRAY_BUFFER, ext_mesh_ebo_capacity_,
                         nullptr, GL_STREAM_DRAW);
        }
        glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, 0, eboBytes, item->ext_indices);

        glDrawElements(GL_TRIANGLES, item->ext_index_count,
                       GL_UNSIGNED_SHORT, nullptr);

        glBindVertexArray(0);

        stats_.triangles += static_cast<u32>(item->ext_index_count / 3);
        stats_.draw_calls++;
    }
}

void RenderFrame::renderMeshes(u32 begin, u32 end) {
    for (u32 i = begin; i < end; ++i) {
        auto* item = &items_[i];
        if (!item->geometry || !item->shader) continue;
        stats_.draw_calls++;
    }
}

void RenderFrame::renderSpriteWithMaterial(RenderItem* item) {
    u32 shaderId = 0;
    u32 blendMode = 0;
    std::vector<UniformData> uniforms;

    if (!getMaterialDataWithUniforms(item->material_id, shaderId, blendMode, uniforms)) {
        return;
    }

    Shader* shader = resource_manager_.getShader(resource::ShaderHandle(shaderId));
    if (!shader) return;

    shader->bind();
    shader->setUniform("u_projection", view_projection_);
    shader->setUniform("u_model", item->transform);
    shader->setUniform("u_color", item->color);

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, item->texture_id);
    shader->setUniform("u_texture", 0);

    for (const auto& ud : uniforms) {
        switch (ud.type) {
            case 0:
                shader->setUniform(ud.name, ud.values[0]);
                break;
            case 1:
                shader->setUniform(ud.name, glm::vec2(ud.values[0], ud.values[1]));
                break;
            case 2:
                shader->setUniform(ud.name, glm::vec3(ud.values[0], ud.values[1], ud.values[2]));
                break;
            case 3:
                shader->setUniform(ud.name, glm::vec4(ud.values[0], ud.values[1], ud.values[2], ud.values[3]));
                break;
        }
    }

    RenderCommand::setBlendMode(static_cast<BlendMode>(blendMode));

    glm::vec2 halfSize = item->size * 0.5f;

    struct MatSpriteVertex {
        f32 px, py;
        f32 tx, ty;
        f32 cr, cg, cb, ca;
    };

    MatSpriteVertex vertices[4] = {
        { -halfSize.x, -halfSize.y, 0.0f, 1.0f, item->color.r, item->color.g, item->color.b, item->color.a },
        {  halfSize.x, -halfSize.y, 1.0f, 1.0f, item->color.r, item->color.g, item->color.b, item->color.a },
        {  halfSize.x,  halfSize.y, 1.0f, 0.0f, item->color.r, item->color.g, item->color.b, item->color.a },
        { -halfSize.x,  halfSize.y, 0.0f, 0.0f, item->color.r, item->color.g, item->color.b, item->color.a },
    };

    glBindVertexArray(mat_sprite_vao_);

    glBindBuffer(GL_ARRAY_BUFFER, mat_sprite_vbo_);
    glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STREAM_DRAW);

    GLint locPos = shader->getAttribLocation("a_position");
    if (locPos >= 0) {
        glEnableVertexAttribArray(locPos);
        glVertexAttribPointer(locPos, 2, GL_FLOAT, GL_FALSE, sizeof(MatSpriteVertex),
                              reinterpret_cast<void*>(0));
    }

    GLint locTex = shader->getAttribLocation("a_texCoord");
    if (locTex >= 0) {
        glEnableVertexAttribArray(locTex);
        glVertexAttribPointer(locTex, 2, GL_FLOAT, GL_FALSE, sizeof(MatSpriteVertex),
                              reinterpret_cast<void*>(2 * sizeof(f32)));
    }

    GLint locColor = shader->getAttribLocation("a_color");
    if (locColor >= 0) {
        glEnableVertexAttribArray(locColor);
        glVertexAttribPointer(locColor, 4, GL_FLOAT, GL_FALSE, sizeof(MatSpriteVertex),
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

    if (locPos >= 0) glDisableVertexAttribArray(locPos);
    if (locTex >= 0) glDisableVertexAttribArray(locTex);
    if (locColor >= 0) glDisableVertexAttribArray(locColor);

    glBindVertexArray(0);

    stats_.draw_calls++;
    stats_.triangles += 2;
}

}  // namespace esengine

#include "RenderFrame.hpp"
#include "Renderer.hpp"
#include "RenderCommand.hpp"
#include "Texture.hpp"
#include "../core/Log.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/SpineAnimation.hpp"
#include "../spine/SpineSystem.hpp"

#include <spine/spine.h>
#include <spine/RegionAttachment.h>
#include <spine/MeshAttachment.h>
#include <spine/ClippingAttachment.h>

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
    spine_vertices_.reserve(1024);
    spine_indices_.reserve(2048);
    spine_world_vertices_.reserve(1024);

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

void RenderFrame::end() {
    if (!in_frame_) return;

    sortItems();

    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDisable(GL_DEPTH_TEST);

    executeStage(RenderStage::Background);
    executeStage(RenderStage::Opaque);
    executeStage(RenderStage::Transparent);
    executeStage(RenderStage::Overlay);

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

        item.transform = glm::mat4(1.0f);
        item.transform = glm::translate(item.transform, position);
        item.transform *= glm::mat4_cast(rotation);
        item.transform = glm::scale(item.transform, scale);

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

        item.layer = comp.layer;
        item.depth = position.z;
        item.skeleton = instance->skeleton.get();
        item.tint_color = comp.color;
        item.material_id = comp.material;

        items_.push_back(item);
        stats_.spine++;
    }
}

void RenderFrame::submit(const RenderItem& item) {
    RenderItem copy = item;
    if (copy.stage == RenderStage::Transparent && copy.stage != current_stage_) {
        copy.stage = current_stage_;
    }
    items_.push_back(copy);

    switch (copy.type) {
        case RenderType::Sprite: stats_.sprites++; break;
        case RenderType::Spine: stats_.spine++; break;
        case RenderType::Mesh: stats_.meshes++; break;
    }
}

void RenderFrame::sortItems() {
    std::sort(items_.begin(), items_.end(),
        [](const RenderItem& a, const RenderItem& b) {
            return a.sortKey() < b.sortKey();
        });
}

void RenderFrame::executeStage(RenderStage stage) {
    std::vector<RenderItem*> stageItems;

    for (auto& item : items_) {
        if (item.stage == stage) {
            stageItems.push_back(&item);
        }
    }

    if (stageItems.empty()) return;

    std::vector<RenderItem*> currentBatch;
    RenderType currentType = stageItems[0]->type;

    auto flushCurrentBatch = [&]() {
        if (currentBatch.empty()) return;

        switch (currentType) {
            case RenderType::Sprite:
                renderSprites(currentBatch);
                break;
            case RenderType::Spine:
                renderSpine(currentBatch);
                break;
            case RenderType::Mesh:
                renderMeshes(currentBatch);
                break;
        }
        currentBatch.clear();
    };

    for (auto* item : stageItems) {
        if (item->type != currentType) {
            flushCurrentBatch();
            currentType = item->type;
        }
        currentBatch.push_back(item);
    }

    flushCurrentBatch();
}

void RenderFrame::renderSprites(const std::vector<RenderItem*>& items) {
    batcher_->setProjection(view_projection_);
    batcher_->beginBatch();

    for (auto* item : items) {
        if (item->material_id != 0) {
            batcher_->flush();
            renderSpriteWithMaterial(item);
            continue;
        }

        glm::vec3 position = glm::vec3(item->transform[3]);
        glm::vec3 scale = glm::vec3(
            glm::length(glm::vec3(item->transform[0])),
            glm::length(glm::vec3(item->transform[1])),
            glm::length(glm::vec3(item->transform[2]))
        );

        glm::vec2 finalSize = item->size * glm::vec2(scale);

        glm::mat3 rotMat = glm::mat3(item->transform);
        rotMat[0] /= scale.x;
        rotMat[1] /= scale.y;
        rotMat[2] /= scale.z;
        glm::quat rotation = glm::quat_cast(rotMat);

        f32 angle = glm::angle(rotation);
        glm::vec3 axis = glm::axis(rotation);
        if (axis.z < 0) angle = -angle;

        if (item->use_nine_slice) {
            resource::SliceBorder border;
            border.left = item->slice_border.x;
            border.right = item->slice_border.y;
            border.top = item->slice_border.z;
            border.bottom = item->slice_border.w;

            batcher_->drawNineSlice(
                glm::vec2(position),
                finalSize,
                item->texture_id,
                item->texture_size,
                border,
                item->color,
                angle
            );
        } else if (std::abs(angle) > 0.001f) {
            batcher_->drawRotatedQuad(
                glm::vec2(position),
                finalSize,
                angle,
                item->texture_id,
                item->color
            );
        } else {
            batcher_->drawQuad(
                glm::vec3(position.x, position.y, item->depth),
                finalSize,
                item->texture_id,
                item->color
            );
        }
    }

    batcher_->endBatch();
    stats_.draw_calls += batcher_->getDrawCallCount();
    stats_.triangles += batcher_->getQuadCount() * 2;
}

void RenderFrame::renderSpine(const std::vector<RenderItem*>& items) {
    spine_vertices_.clear();
    spine_indices_.clear();
    spine_current_texture_ = 0;

    static ::spine::SkeletonClipping clipper;

    for (auto* item : items) {
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
                auto* regionData = region->getRegion();
                if (!regionData) continue;

                if (regionData->rendererObject) {
                    u32 handleId = static_cast<u32>(reinterpret_cast<uintptr_t>(regionData->rendererObject)) - 1;
                    auto* tex = resource_manager_.getTexture(resource::TextureHandle(handleId));
                    if (tex) textureId = tex->getId();
                }

                if (textureId != spine_current_texture_ || blendMode != spine_current_blend_) {
                    flushSpineBatch();
                    spine_current_texture_ = textureId;
                    spine_current_blend_ = blendMode;
                    RenderCommand::setBlendMode(blendMode);
                }

                spine_world_vertices_.resize(8);
                region->computeWorldVertices(*slot, spine_world_vertices_.data(), 0, 2);

                auto& uvs = region->getUVs();
                auto& attachColor = region->getColor();

                f32 r = skelColor.r * slotColor.r * attachColor.r * item->tint_color.r;
                f32 g = skelColor.g * slotColor.g * attachColor.g * item->tint_color.g;
                f32 b = skelColor.b * slotColor.b * attachColor.b * item->tint_color.b;
                f32 a = skelColor.a * slotColor.a * attachColor.a * item->tint_color.a;

                u32 baseIndex = static_cast<u32>(spine_vertices_.size());

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
                auto* regionData = mesh->getRegion();
                if (!regionData) continue;

                if (regionData->rendererObject) {
                    u32 handleId = static_cast<u32>(reinterpret_cast<uintptr_t>(regionData->rendererObject)) - 1;
                    auto* tex = resource_manager_.getTexture(resource::TextureHandle(handleId));
                    if (tex) textureId = tex->getId();
                }

                if (textureId != spine_current_texture_ || blendMode != spine_current_blend_) {
                    flushSpineBatch();
                    spine_current_texture_ = textureId;
                    spine_current_blend_ = blendMode;
                    RenderCommand::setBlendMode(blendMode);
                }

                size_t vertexCount = mesh->getWorldVerticesLength() / 2;
                spine_world_vertices_.resize(mesh->getWorldVerticesLength());
                mesh->computeWorldVertices(*slot, 0, mesh->getWorldVerticesLength(),
                                           spine_world_vertices_.data(), 0, 2);

                auto& uvs = mesh->getUVs();
                auto& triangles = mesh->getTriangles();
                auto& attachColor = mesh->getColor();

                f32 r = skelColor.r * slotColor.r * attachColor.r * item->tint_color.r;
                f32 g = skelColor.g * slotColor.g * attachColor.g * item->tint_color.g;
                f32 b = skelColor.b * slotColor.b * attachColor.b * item->tint_color.b;
                f32 a = skelColor.a * slotColor.a * attachColor.a * item->tint_color.a;

                u32 baseIndex = static_cast<u32>(spine_vertices_.size());

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
                    spine_indices_.push_back(baseIndex + triangles[j]);
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

    u32 vao, vbo, ebo;
    glGenVertexArrays(1, &vao);
    glGenBuffers(1, &vbo);
    glGenBuffers(1, &ebo);

    glBindVertexArray(vao);

    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER,
                 static_cast<GLsizeiptr>(spine_vertices_.size() * sizeof(SpineVertex)),
                 spine_vertices_.data(), GL_STREAM_DRAW);

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER,
                 static_cast<GLsizeiptr>(spine_indices_.size() * sizeof(u32)),
                 spine_indices_.data(), GL_STREAM_DRAW);

    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(SpineVertex),
                          reinterpret_cast<void*>(offsetof(SpineVertex, position)));

    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, sizeof(SpineVertex),
                          reinterpret_cast<void*>(offsetof(SpineVertex, uv)));

    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, sizeof(SpineVertex),
                          reinterpret_cast<void*>(offsetof(SpineVertex, color)));

    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(spine_indices_.size()),
                   GL_UNSIGNED_INT, nullptr);

    stats_.triangles += static_cast<u32>(spine_indices_.size() / 3);
    stats_.draw_calls++;

    glDeleteBuffers(1, &ebo);
    glDeleteBuffers(1, &vbo);
    glDeleteVertexArrays(1, &vao);

    spine_vertices_.clear();
    spine_indices_.clear();
}

void RenderFrame::renderMeshes(const std::vector<RenderItem*>& items) {
    for (auto* item : items) {
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

    f32 positions[] = {
        -halfSize.x, -halfSize.y,
         halfSize.x, -halfSize.y,
         halfSize.x,  halfSize.y,
        -halfSize.x,  halfSize.y,
    };

    f32 texCoords[] = {
        0.0f, 1.0f,
        1.0f, 1.0f,
        1.0f, 0.0f,
        0.0f, 0.0f,
    };

    f32 colors[] = {
        item->color.r, item->color.g, item->color.b, item->color.a,
        item->color.r, item->color.g, item->color.b, item->color.a,
        item->color.r, item->color.g, item->color.b, item->color.a,
        item->color.r, item->color.g, item->color.b, item->color.a,
    };

    u32 indices[] = { 0, 1, 2, 2, 3, 0 };

    u32 vao, vbo_pos, vbo_tex, vbo_color, ebo;
    glGenVertexArrays(1, &vao);
    glGenBuffers(1, &vbo_pos);
    glGenBuffers(1, &vbo_tex);
    glGenBuffers(1, &vbo_color);
    glGenBuffers(1, &ebo);

    glBindVertexArray(vao);

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), indices, GL_STREAM_DRAW);

    GLint locPos = shader->getAttribLocation("a_position");
    if (locPos >= 0) {
        glBindBuffer(GL_ARRAY_BUFFER, vbo_pos);
        glBufferData(GL_ARRAY_BUFFER, sizeof(positions), positions, GL_STREAM_DRAW);
        glEnableVertexAttribArray(locPos);
        glVertexAttribPointer(locPos, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
    }

    GLint locTex = shader->getAttribLocation("a_texCoord");
    if (locTex >= 0) {
        glBindBuffer(GL_ARRAY_BUFFER, vbo_tex);
        glBufferData(GL_ARRAY_BUFFER, sizeof(texCoords), texCoords, GL_STREAM_DRAW);
        glEnableVertexAttribArray(locTex);
        glVertexAttribPointer(locTex, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
    }

    GLint locColor = shader->getAttribLocation("a_color");
    if (locColor >= 0) {
        glBindBuffer(GL_ARRAY_BUFFER, vbo_color);
        glBufferData(GL_ARRAY_BUFFER, sizeof(colors), colors, GL_STREAM_DRAW);
        glEnableVertexAttribArray(locColor);
        glVertexAttribPointer(locColor, 4, GL_FLOAT, GL_FALSE, 0, nullptr);
    }

    glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_INT, nullptr);

    if (locPos >= 0) glDisableVertexAttribArray(locPos);
    if (locTex >= 0) glDisableVertexAttribArray(locTex);
    if (locColor >= 0) glDisableVertexAttribArray(locColor);

    glDeleteBuffers(1, &ebo);
    glDeleteBuffers(1, &vbo_color);
    glDeleteBuffers(1, &vbo_tex);
    glDeleteBuffers(1, &vbo_pos);
    glDeleteVertexArrays(1, &vao);

    stats_.draw_calls++;
    stats_.triangles += 2;
}

}  // namespace esengine

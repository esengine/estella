/**
 * @file    SpineRenderer.cpp
 * @brief   Spine skeleton renderer implementation
 */

// =============================================================================
// Includes
// =============================================================================

#include "SpineRenderer.hpp"
#include "../core/Log.hpp"
#include "../ecs/components/SpineAnimation.hpp"
#include "../ecs/components/Transform.hpp"
#include "../renderer/Renderer.hpp"
#include "../renderer/RenderCommand.hpp"

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

namespace esengine::spine {

// =============================================================================
// SpineRenderer Implementation
// =============================================================================

SpineRenderer::SpineRenderer(RenderContext& context,
                             resource::ResourceManager& resourceManager,
                             SpineSystem& spineSystem)
    : context_(context)
    , resource_manager_(resourceManager)
    , spine_system_(spineSystem) {
}

SpineRenderer::~SpineRenderer() {
    if (initialized_) {
        shutdown();
    }
}

void SpineRenderer::init() {
    if (initialized_) return;

    vertices_.reserve(1024);
    indices_.reserve(2048);
    world_vertices_.reserve(1024);

    initialized_ = true;
    ES_LOG_INFO("SpineRenderer initialized");
}

void SpineRenderer::shutdown() {
    if (!initialized_) return;

    vertices_.clear();
    indices_.clear();
    world_vertices_.clear();

    initialized_ = false;
    ES_LOG_INFO("SpineRenderer shutdown");
}

void SpineRenderer::begin(const glm::mat4& viewProjection) {
    view_projection_ = viewProjection;
    triangle_count_ = 0;
    draw_call_count_ = 0;

    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDisable(GL_DEPTH_TEST);
}

void SpineRenderer::submit(ecs::Registry& registry) {
    auto view = registry.view<ecs::SpineAnimation>();

    for (auto entity : view) {
        auto& comp = registry.get<ecs::SpineAnimation>(entity);
        auto* instance = spine_system_.getInstance(entity);

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

        renderSkeleton(instance->skeleton.get(), position, rotation, scale,
                       comp.color, comp.layer);
    }
}

void SpineRenderer::renderSkeleton(::spine::Skeleton* skeleton,
                                    const glm::vec3& position,
                                    const glm::quat& rotation,
                                    const glm::vec3& scale,
                                    const glm::vec4& tintColor,
                                    i32 layer) {
    if (!skeleton) return;

    glm::mat4 transform = glm::mat4(1.0f);
    transform = glm::translate(transform, position);
    transform *= glm::mat4_cast(rotation);
    transform = glm::scale(transform, scale);

    auto& drawOrder = skeleton->getDrawOrder();
    for (size_t i = 0; i < drawOrder.size(); ++i) {
        ::spine::Slot* slot = drawOrder[i];
        if (!slot) continue;

        ::spine::Attachment* attachment = slot->getAttachment();
        if (!attachment) continue;

        if (!slot->getData().isVisible()) continue;

        if (attachment->getRTTI().isExactly(::spine::ClippingAttachment::rtti)) {
            auto* clip = static_cast<::spine::ClippingAttachment*>(attachment);
            clipper_.clipStart(*slot, clip);
            continue;
        }

        if (attachment->getRTTI().isExactly(::spine::RegionAttachment::rtti)) {
            auto* region = static_cast<::spine::RegionAttachment*>(attachment);
            renderRegionAttachment(region, *slot, transform, tintColor);
        } else if (attachment->getRTTI().isExactly(::spine::MeshAttachment::rtti)) {
            auto* mesh = static_cast<::spine::MeshAttachment*>(attachment);
            renderMeshAttachment(mesh, *slot, transform, tintColor);
        }

        clipper_.clipEnd(*slot);
    }

    clipper_.clipEnd();
    flushBatch();
}

void SpineRenderer::renderRegionAttachment(::spine::RegionAttachment* attachment,
                                            ::spine::Slot& slot,
                                            const glm::mat4& transform,
                                            const glm::vec4& tintColor) {
    auto* region = attachment->getRegion();
    if (!region) return;

    world_vertices_.resize(8);
    attachment->computeWorldVertices(slot, world_vertices_.data(), 0, 2);

    auto& uvs = attachment->getUVs();
    auto& attachColor = attachment->getColor();
    auto& slotColor = slot.getColor();
    auto& skelColor = slot.getSkeleton().getColor();

    f32 r = skelColor.r * slotColor.r * attachColor.r * tintColor.r;
    f32 g = skelColor.g * slotColor.g * attachColor.g * tintColor.g;
    f32 b = skelColor.b * slotColor.b * attachColor.b * tintColor.b;
    f32 a = skelColor.a * slotColor.a * attachColor.a * tintColor.a;

    u32 textureId = getTextureId(region->rendererObject);
    auto blendMode = slot.getData().getBlendMode();

    if (textureId != current_texture_id_ || blendMode != current_blend_mode_) {
        flushBatch();
        current_texture_id_ = textureId;
        current_blend_mode_ = blendMode;
        setBlendMode(blendMode);
    }

    u32 baseIndex = static_cast<u32>(vertices_.size());

    for (int j = 0; j < 4; ++j) {
        glm::vec4 pos(world_vertices_[j * 2], world_vertices_[j * 2 + 1], 0.0f, 1.0f);
        pos = transform * pos;

        SpineRenderVertex vertex;
        vertex.position = glm::vec2(pos.x, pos.y);
        vertex.uv = glm::vec2(uvs[j * 2], uvs[j * 2 + 1]);
        vertex.color = glm::vec4(r, g, b, a);
        vertices_.push_back(vertex);
    }

    indices_.push_back(baseIndex);
    indices_.push_back(baseIndex + 1);
    indices_.push_back(baseIndex + 2);
    indices_.push_back(baseIndex + 2);
    indices_.push_back(baseIndex + 3);
    indices_.push_back(baseIndex);
}

void SpineRenderer::renderMeshAttachment(::spine::MeshAttachment* attachment,
                                          ::spine::Slot& slot,
                                          const glm::mat4& transform,
                                          const glm::vec4& tintColor) {
    auto* region = attachment->getRegion();
    if (!region) return;

    size_t vertexCount = attachment->getWorldVerticesLength() / 2;
    world_vertices_.resize(attachment->getWorldVerticesLength());
    attachment->computeWorldVertices(slot, 0, attachment->getWorldVerticesLength(),
                                      world_vertices_.data(), 0, 2);

    auto& uvs = attachment->getUVs();
    auto& triangles = attachment->getTriangles();
    auto& attachColor = attachment->getColor();
    auto& slotColor = slot.getColor();
    auto& skelColor = slot.getSkeleton().getColor();

    f32 r = skelColor.r * slotColor.r * attachColor.r * tintColor.r;
    f32 g = skelColor.g * slotColor.g * attachColor.g * tintColor.g;
    f32 b = skelColor.b * slotColor.b * attachColor.b * tintColor.b;
    f32 a = skelColor.a * slotColor.a * attachColor.a * tintColor.a;

    u32 textureId = getTextureId(region->rendererObject);
    auto blendMode = slot.getData().getBlendMode();

    if (textureId != current_texture_id_ || blendMode != current_blend_mode_) {
        flushBatch();
        current_texture_id_ = textureId;
        current_blend_mode_ = blendMode;
        setBlendMode(blendMode);
    }

    u32 baseIndex = static_cast<u32>(vertices_.size());

    if (clipper_.isClipping()) {
        clipper_.clipTriangles(world_vertices_.data(),
                               const_cast<unsigned short*>(triangles.buffer()),
                               triangles.size(),
                               uvs.buffer(), 2);

        auto& clippedVerts = clipper_.getClippedVertices();
        auto& clippedUVs = clipper_.getClippedUVs();
        auto& clippedTris = clipper_.getClippedTriangles();

        size_t clippedVertCount = clippedVerts.size() / 2;
        for (size_t j = 0; j < clippedVertCount; ++j) {
            glm::vec4 pos(clippedVerts[j * 2], clippedVerts[j * 2 + 1], 0.0f, 1.0f);
            pos = transform * pos;

            SpineRenderVertex vertex;
            vertex.position = glm::vec2(pos.x, pos.y);
            vertex.uv = glm::vec2(clippedUVs[j * 2], clippedUVs[j * 2 + 1]);
            vertex.color = glm::vec4(r, g, b, a);
            vertices_.push_back(vertex);
        }

        for (size_t j = 0; j < clippedTris.size(); ++j) {
            indices_.push_back(baseIndex + clippedTris[j]);
        }
    } else {
        for (size_t j = 0; j < vertexCount; ++j) {
            glm::vec4 pos(world_vertices_[j * 2], world_vertices_[j * 2 + 1], 0.0f, 1.0f);
            pos = transform * pos;

            SpineRenderVertex vertex;
            vertex.position = glm::vec2(pos.x, pos.y);
            vertex.uv = glm::vec2(uvs[j * 2], uvs[j * 2 + 1]);
            vertex.color = glm::vec4(r, g, b, a);
            vertices_.push_back(vertex);
        }

        for (size_t j = 0; j < triangles.size(); ++j) {
            indices_.push_back(baseIndex + triangles[j]);
        }
    }
}

u32 SpineRenderer::getTextureId(void* spineTexture) {
    if (!spineTexture) {
        return context_.getWhiteTextureId();
    }

    u32 handleId = static_cast<u32>(reinterpret_cast<uintptr_t>(spineTexture)) - 1;
    resource::TextureHandle handle(handleId);

    auto* texture = resource_manager_.getTexture(handle);
    if (texture) {
        return texture->getId();
    }

    return context_.getWhiteTextureId();
}

void SpineRenderer::setBlendMode(::spine::BlendMode mode) {
    switch (mode) {
        case ::spine::BlendMode_Normal:
            glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
            break;
        case ::spine::BlendMode_Additive:
            glBlendFunc(GL_SRC_ALPHA, GL_ONE);
            break;
        case ::spine::BlendMode_Multiply:
            glBlendFunc(GL_DST_COLOR, GL_ONE_MINUS_SRC_ALPHA);
            break;
        case ::spine::BlendMode_Screen:
            glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_COLOR);
            break;
    }
}

void SpineRenderer::flushBatch() {
    if (vertices_.empty() || indices_.empty()) {
        return;
    }

    auto* shader = context_.getTextureShader();
    if (!shader) {
        vertices_.clear();
        indices_.clear();
        return;
    }

    shader->bind();
    shader->setUniform("u_projection", view_projection_);
    shader->setUniform("u_model", glm::mat4(1.0f));
    shader->setUniform("u_color", glm::vec4(1.0f));

    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, current_texture_id_);
    shader->setUniform("u_texture", 0);

    u32 vao, vbo, ebo;
    glGenVertexArrays(1, &vao);
    glGenBuffers(1, &vbo);
    glGenBuffers(1, &ebo);

    glBindVertexArray(vao);

    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER,
                 static_cast<GLsizeiptr>(vertices_.size() * sizeof(SpineRenderVertex)),
                 vertices_.data(), GL_STREAM_DRAW);

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER,
                 static_cast<GLsizeiptr>(indices_.size() * sizeof(u32)),
                 indices_.data(), GL_STREAM_DRAW);

    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(SpineRenderVertex),
                          reinterpret_cast<void*>(offsetof(SpineRenderVertex, position)));

    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, sizeof(SpineRenderVertex),
                          reinterpret_cast<void*>(offsetof(SpineRenderVertex, uv)));

    glEnableVertexAttribArray(2);
    glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, sizeof(SpineRenderVertex),
                          reinterpret_cast<void*>(offsetof(SpineRenderVertex, color)));

    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(indices_.size()),
                   GL_UNSIGNED_INT, nullptr);

    triangle_count_ += static_cast<u32>(indices_.size() / 3);
    draw_call_count_++;

    glDeleteBuffers(1, &ebo);
    glDeleteBuffers(1, &vbo);
    glDeleteVertexArrays(1, &vao);

    vertices_.clear();
    indices_.clear();
}

void SpineRenderer::end() {
    flushBatch();
}

}  // namespace esengine::spine

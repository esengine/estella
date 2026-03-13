#include "SpinePlugin.hpp"

#ifdef ES_ENABLE_SPINE

#include "../RenderContext.hpp"
#include "../Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/SpineAnimation.hpp"
#include "../../spine/SpineSystem.hpp"

#include <spine/RegionAttachment.h>
#include <spine/MeshAttachment.h>
#include <spine/ClippingAttachment.h>

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

namespace esengine {

void SpinePlugin::init(RenderFrameContext& ctx) {
    batch_shader_id_ = ctx.batch_shader_id;
    vertices_.reserve(512);
    indices_.reserve(1024);
    world_vertices_.reserve(512);
}

u32 SpinePlugin::getTextureId(void* spineTexture, RenderFrameContext& ctx) {
    if (!spineTexture) {
        return ctx.white_texture_id;
    }
    u32 handleId = static_cast<u32>(reinterpret_cast<uintptr_t>(spineTexture)) - 1;
    resource::TextureHandle handle(handleId);
    auto* texture = ctx.resources.getTexture(handle);
    if (texture) {
        return texture->getId();
    }
    return ctx.white_texture_id;
}

BlendMode SpinePlugin::mapBlendMode(::spine::BlendMode mode) {
    switch (mode) {
        case ::spine::BlendMode_Additive: return BlendMode::Additive;
        case ::spine::BlendMode_Multiply: return BlendMode::Multiply;
        case ::spine::BlendMode_Screen:   return BlendMode::Screen;
        default: return BlendMode::Normal;
    }
}

void SpinePlugin::emitBatch(
    u32 textureId, BlendMode blend,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    const ClipState& clips,
    Entity entity, i32 layer, f32 depth,
    RenderFrameContext& ctx
) {
    if (vertices_.empty() || indices_.empty()) return;

    u32 vBytes = static_cast<u32>(vertices_.size()) * sizeof(BatchVertex);
    u32 vOff = buffers.appendVertices(vertices_.data(), vBytes);
    u32 baseVertex = vOff / sizeof(BatchVertex);

    for (auto& idx : indices_) {
        idx = static_cast<u16>(idx + baseVertex);
    }
    u32 iOff = buffers.appendIndices(indices_.data(), static_cast<u32>(indices_.size()));

    DrawCommand cmd{};
    cmd.sort_key = DrawCommand::buildSortKey(
        ctx.current_stage, layer, batch_shader_id_, blend, 0, textureId, depth);
    cmd.index_offset = iOff;
    cmd.index_count = static_cast<u32>(indices_.size());
    cmd.vertex_byte_offset = vOff;
    cmd.shader_id = batch_shader_id_;
    cmd.blend_mode = blend;
    cmd.layout_id = LayoutId::Batch;
    cmd.texture_count = 1;
    cmd.texture_ids[0] = textureId;
    cmd.entity = entity;
    cmd.type = RenderType::Spine;
    cmd.layer = layer;

    clips.applyTo(entity, cmd);
    draw_list.push(cmd);

    vertices_.clear();
    indices_.clear();
}

void SpinePlugin::emitRegionAttachment(
    ::spine::RegionAttachment* attachment,
    ::spine::Slot& slot,
    const glm::mat4& transform,
    const glm::vec4& tintColor,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    const ClipState& clips,
    Entity entity, i32 layer, f32 depth,
    RenderFrameContext& ctx
) {
    auto* region = attachment->getRegion();
    if (!region) return;

    u32 textureId = getTextureId(region->rendererObject, ctx);
    BlendMode blend = mapBlendMode(slot.getData().getBlendMode());

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
    u32 pc = packColor(r, g, b, a);

    u16 base = static_cast<u16>(vertices_.size());

    for (int j = 0; j < 4; ++j) {
        glm::vec4 pos(world_vertices_[j * 2], world_vertices_[j * 2 + 1], 0.0f, 1.0f);
        pos = transform * pos;
        vertices_.push_back({
            glm::vec2(pos.x, pos.y),
            pc,
            glm::vec2(uvs[j * 2], uvs[j * 2 + 1])
        });
    }

    indices_.push_back(base);
    indices_.push_back(base + 1);
    indices_.push_back(base + 2);
    indices_.push_back(base + 2);
    indices_.push_back(base + 3);
    indices_.push_back(base);

    emitBatch(textureId, blend, buffers, draw_list, clips, entity, layer, depth, ctx);
}

void SpinePlugin::emitMeshAttachment(
    ::spine::MeshAttachment* attachment,
    ::spine::Slot& slot,
    const glm::mat4& transform,
    const glm::vec4& tintColor,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    const ClipState& clips,
    Entity entity, i32 layer, f32 depth,
    RenderFrameContext& ctx
) {
    auto* region = attachment->getRegion();
    if (!region) return;

    u32 textureId = getTextureId(region->rendererObject, ctx);
    BlendMode blend = mapBlendMode(slot.getData().getBlendMode());

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
    u32 pc = packColor(r, g, b, a);

    u16 base = static_cast<u16>(vertices_.size());

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
            vertices_.push_back({
                glm::vec2(pos.x, pos.y),
                pc,
                glm::vec2(clippedUVs[j * 2], clippedUVs[j * 2 + 1])
            });
        }

        for (size_t j = 0; j < clippedTris.size(); ++j) {
            indices_.push_back(static_cast<u16>(base + clippedTris[j]));
        }
    } else {
        for (size_t j = 0; j < vertexCount; ++j) {
            glm::vec4 pos(world_vertices_[j * 2], world_vertices_[j * 2 + 1], 0.0f, 1.0f);
            pos = transform * pos;
            vertices_.push_back({
                glm::vec2(pos.x, pos.y),
                pc,
                glm::vec2(uvs[j * 2], uvs[j * 2 + 1])
            });
        }

        for (size_t j = 0; j < triangles.size(); ++j) {
            indices_.push_back(static_cast<u16>(base + triangles[j]));
        }
    }

    emitBatch(textureId, blend, buffers, draw_list, clips, entity, layer, depth, ctx);
}

void SpinePlugin::collect(
    ecs::Registry& registry,
    const Frustum& /* frustum */,
    const ClipState& clips,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    RenderFrameContext& ctx
) {
    if (!spine_system_) return;

    auto view = registry.view<ecs::SpineAnimation>();

    for (auto entity : view) {
        auto& comp = registry.get<ecs::SpineAnimation>(entity);
        if (!comp.enabled) continue;
        auto* instance = spine_system_->getInstance(entity);
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

        glm::mat4 transform = glm::mat4(1.0f);
        transform = glm::translate(transform, position);
        transform *= glm::mat4_cast(rotation);
        transform = glm::scale(transform, scale);

        auto* skeleton = instance->skeleton.get();
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
                emitRegionAttachment(
                    static_cast<::spine::RegionAttachment*>(attachment),
                    *slot, transform, comp.color,
                    buffers, draw_list, clips, entity, comp.layer, position.z, ctx);
            } else if (attachment->getRTTI().isExactly(::spine::MeshAttachment::rtti)) {
                emitMeshAttachment(
                    static_cast<::spine::MeshAttachment*>(attachment),
                    *slot, transform, comp.color,
                    buffers, draw_list, clips, entity, comp.layer, position.z, ctx);
            }

            clipper_.clipEnd(*slot);
        }

        clipper_.clipEnd();
    }
}

}  // namespace esengine

#endif

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ImmediateDraw.cpp
 * @brief   Immediate mode 2D drawing implementation
 * @details Generates BatchVertex geometry into a TransientBufferPool and draws it
 *          through a GfxDevice pipeline — the same path RenderFrame uses. Primitives
 *          are batched per texture and flushed in submission order.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "./ImmediateDraw.hpp"
#include "../rhi/GfxDevice.hpp"
#include "../frame/RenderContext.hpp"
#include "../rhi/Shader.hpp"
#include "../rhi/ShaderEmbeds.generated.hpp"
#include "./BatchVertex.hpp"
#include "../../resource/ShaderParser.hpp"
#include "../../resource/ResourceManager.hpp"
#include "../../core/Log.hpp"

#include <glm/gtc/constants.hpp>
#include <glm/gtc/type_ptr.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <string>

namespace esengine {

namespace {

constexpr glm::vec2 QUAD_LOCAL[4] = {
    {-0.5f, -0.5f}, {0.5f, -0.5f}, {0.5f, 0.5f}, {-0.5f, 0.5f}
};
constexpr glm::vec2 QUAD_UV[4] = {
    {0.0f, 0.0f}, {1.0f, 0.0f}, {1.0f, 1.0f}, {0.0f, 1.0f}
};

constexpr f32 NEAR_CLIP_NUDGE = 1e-4f;

/** Cut a world segment against the canonical clip-space near plane (z >= -w). */
bool clipLineToNearPlane(glm::vec3& from, glm::vec3& to, const glm::mat4& viewProjection) {
    const auto side = [&viewProjection](const glm::vec3& point) {
        const glm::vec4 clip = viewProjection * glm::vec4(point, 1.0f);
        return clip.z + clip.w;
    };
    const f32 fromSide = side(from);
    const f32 toSide = side(to);
    if (!std::isfinite(fromSide) || !std::isfinite(toSide)) return false;
    if (fromSide >= 0.0f && toSide >= 0.0f) return true;
    if (fromSide < 0.0f && toSide < 0.0f) return false;

    const f32 crossing = fromSide / (fromSide - toSide);
    const f32 t = fromSide >= 0.0f
        ? crossing * (1.0f - NEAR_CLIP_NUDGE)
        : crossing + (1.0f - crossing) * NEAR_CLIP_NUDGE;
    const glm::vec3 cut = glm::mix(from, to, t);
    if (fromSide >= 0.0f) to = cut;
    else from = cut;
    return true;
}

/** Unproject one framebuffer-pixel offset at an anchor's clip depth. */
bool screenOffsetPoint(const glm::mat4& inverseViewProjection,
                       const glm::vec4& clipAnchor,
                       const glm::vec2& offset,
                       f32 viewportWidth, f32 viewportHeight,
                       glm::vec3& point) {
    const glm::vec4 clip = clipAnchor + glm::vec4(
        2.0f * offset.x * clipAnchor.w / viewportWidth,
        2.0f * offset.y * clipAnchor.w / viewportHeight,
        0.0f, 0.0f);
    const glm::vec4 world = inverseViewProjection * clip;
    if (!std::isfinite(world.x) || !std::isfinite(world.y)
        || !std::isfinite(world.z) || !std::isfinite(world.w)
        || std::abs(world.w) < 1e-9f) {
        return false;
    }
    point = glm::vec3(world) / world.w;
    return std::isfinite(point.x) && std::isfinite(point.y) && std::isfinite(point.z);
}

}  // namespace

ImmediateDraw::ImmediateDraw(GfxDevice& device, RenderContext& context,
                             resource::ResourceManager& resource_manager)
    : device_(device)
    , context_(context)
    , resource_manager_(resource_manager)
    , pool_(device) {
}

ImmediateDraw::~ImmediateDraw() {
    if (initialized_) {
        shutdown();
    }
}

void ImmediateDraw::recreateGpuResources() {
    if (!initialized_) return;
    pool_.recreateGpuResources();
    white_texture_id_ = context_.getWhiteTextureId();
    // NOT re-created: the manager re-compiled it behind the same handle, so the
    // only stale thing here is the program id cached from it.
    batch_shader_ = ShaderHandle::Invalid;
    if (Shader* shader = resource_manager_.getShader(batch_shader_ref_)) {
        if (shader->isValid()) batch_shader_ = shader->handle();
    }
}

void ImmediateDraw::init() {
    if (initialized_) return;

    pool_.init();
    white_texture_id_ = context_.getWhiteTextureId();

    // Reuses the batch shader's default variant — one .esshader, both languages.
    const auto target = resource_manager_.preferredShaderTarget();
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::BATCH);
    resource::ShaderHandle handle = resource_manager_.createShaderWithBindings(
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", {}, target),
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", {}, target),
        {{0, "a_position"}, {1, "a_color"}, {2, "a_texCoord"}},
        resource_manager_.preferredShaderLanguage());
    batch_shader_ref_ = handle;
    Shader* shader = resource_manager_.getShader(handle);
    if (shader && shader->isValid()) {
        batch_shader_ = shader->handle();
        device_.useProgram(batch_shader_);
        // Immediate draw is single-texture (slot 0), but bind all 8 samplers for parity
        // with the world batch shader.
        for (i32 i = 0; i < 8; ++i) {
            i32 loc = device_.getUniformLocation(batch_shader_, ("u_textures[" + std::to_string(i) + "]").c_str());
            if (loc >= 0) device_.setUniform1i(loc, i);
        }
        device_.useProgram(ShaderHandle::Invalid);

        // The base pipeline: the batch shader, Batch layout, normal blend, depth
        // test off (write on, matching the world batch path), no stencil, no culling.
        // setBlendMode/setDepthTest swap in cached sibling pipelines per state.
        base_desc_ = PipelineDesc{};
        base_desc_.program = batch_shader_;
        base_desc_.vertexLayout = pool_.layoutHandle(LayoutId::Batch);
        base_desc_.blend = BlendMode::Normal;
        base_desc_.blendEnabled = true;
        base_desc_.depthTest = false;
        base_desc_.depthWrite = true;
        base_desc_.stencil = GfxStencilMode::Off;
        base_desc_.cullEnabled = false;
        current_desc_ = base_desc_;
        pipeline_ = device_.createPipeline(current_desc_);
    } else {
        ES_LOG_ERROR("ImmediateDraw: failed to create batch shader");
    }

    initialized_ = true;
}

void ImmediateDraw::shutdown() {
    if (!initialized_) return;
    pool_.shutdown();
    initialized_ = false;
    ES_LOG_INFO("ImmediateDraw shutdown");
}

void ImmediateDraw::begin(const glm::mat4& viewProjection, i32 viewportWidth, i32 viewportHeight) {
    if (!initialized_) return;

    viewProjection_ = viewProjection;
    viewportWidth_ = static_cast<f32>(std::max(viewportWidth, 1));
    viewportHeight_ = static_cast<f32>(std::max(viewportHeight, 1));

    // The batch shader reads u_projection from the shared FrameConstants UBO; update it
    // for this pass rather than uploading a loose uniform per flush. A camera's, so it
    // is converted for the device — Draw.line3D places geometry in the world.
    context_.updateCameraConstants(viewProjection);
    // A prior phase may have left another pipeline bound; force our pipeline to re-apply.
    device_.invalidatePipelineCache();

    // Near-centre to far-centre through the inverse: one direction that works for
    // both projections, where a perspective camera's own position does not.
    inverseViewProjection_ = glm::inverse(viewProjection);
    const glm::vec4 nearPoint = inverseViewProjection_ * glm::vec4(0.0f, 0.0f, -1.0f, 1.0f);
    const glm::vec4 farPoint = inverseViewProjection_ * glm::vec4(0.0f, 0.0f, 1.0f, 1.0f);
    const glm::vec3 forward = glm::vec3(farPoint) / farPoint.w - glm::vec3(nearPoint) / nearPoint.w;
    if (glm::length(forward) > 0.0001f) viewForward_ = glm::normalize(forward);

    pool_.beginFrame();
    currentTexture_ = white_texture_id_;
    pendingGeometry_ = false;
    primitiveCount_ = 0;
    drawCallCount_ = 0;
    inFrame_ = true;

    // Each session starts from the base state; a prior session's blend/depth
    // overrides do not leak across frames.
    if (!(current_desc_ == base_desc_)) {
        current_desc_ = base_desc_;
        pipeline_ = device_.createPipeline(current_desc_);
    }
}

void ImmediateDraw::setBlendMode(BlendMode mode) {
    if (current_desc_.blend == mode) return;
    if (pendingGeometry_) flush();
    current_desc_.blend = mode;
    pipeline_ = device_.createPipeline(current_desc_);
}

void ImmediateDraw::setDepthTest(bool enabled) {
    if (current_desc_.depthTest == enabled) return;
    if (pendingGeometry_) flush();
    current_desc_.depthTest = enabled;
    pipeline_ = device_.createPipeline(current_desc_);
}

void ImmediateDraw::flush() {
    if (!initialized_ || !inFrame_ || !pendingGeometry_) return;

    pool_.upload();

    device_.setPipeline(pipeline_);
    device_.bindTexture(0, TextureHandle{currentTexture_});

    pool_.bindLayout(LayoutId::Batch);
    device_.drawElements(pool_.indicesUsed(LayoutId::Batch), GfxDataType::UnsignedInt, 0);
    ++drawCallCount_;

    pool_.beginFrame();  // reset staging for the next batch
    pendingGeometry_ = false;
}

void ImmediateDraw::end() {
    if (!inFrame_) return;

    flush();
    // No state restore needed: the next render phase invalidates the pipeline cache and
    // binds its own pipeline, which sets blend/depth/stencil afresh.
    inFrame_ = false;
}

void ImmediateDraw::deferEnd() {
    if (!inFrame_) return;
    deferredGeometry_ = pendingGeometry_;
    inFrame_ = false;
}

void ImmediateDraw::flushDeferred() {
    if (!deferredGeometry_) return;
    inFrame_ = true;
    flush();
    inFrame_ = false;
    deferredGeometry_ = false;
}

void ImmediateDraw::useTexture(u32 textureId) {
    if (textureId != currentTexture_) {
        if (pendingGeometry_) flush();
        currentTexture_ = textureId;
    }
}

void ImmediateDraw::emitQuad(const glm::vec2& center, const glm::vec2& size, f32 rotation,
                             const glm::vec4& color, u32 textureId,
                             const glm::vec2& uvOffset, const glm::vec2& uvScale) {
    useTexture(textureId);

    const u32 packed = packColor(color);
    const f32 cosR = rotation != 0.0f ? std::cos(rotation) : 1.0f;
    const f32 sinR = rotation != 0.0f ? std::sin(rotation) : 0.0f;

    std::array<BatchVertex, 4> verts{};
    for (u32 i = 0; i < 4; ++i) {
        glm::vec2 scaled = QUAD_LOCAL[i] * size;
        glm::vec2 rotated = rotation != 0.0f
            ? glm::vec2(scaled.x * cosR - scaled.y * sinR, scaled.x * sinR + scaled.y * cosR)
            : scaled;
        // Immediate geometry bypasses the sort key and draws with the depth test
        // off, so it has no depth of its own to carry — it lands on the z=0 plane.
        verts[i].position = glm::vec3(center + rotated, 0.0f);
        verts[i].color = packed;
        verts[i].texCoord = QUAD_UV[i] * uvScale + uvOffset;
    }

    u32 base = pool_.appendVertices(LayoutId::Batch, verts.data(), sizeof(verts)) / sizeof(BatchVertex);
    u32 idx[6] = { base + 0, base + 1, base + 2, base + 2, base + 3, base + 0 };
    pool_.appendIndices(LayoutId::Batch, idx, 6);
    pendingGeometry_ = true;
}

void ImmediateDraw::emitTriangle(const glm::vec2& p0, const glm::vec2& p1, const glm::vec2& p2,
                                 const glm::vec4& color) {
    useTexture(white_texture_id_);

    const u32 packed = packColor(color);
    std::array<BatchVertex, 3> verts{
        BatchVertex{ {p0, 0.0f}, packed, {0.0f, 0.0f} },
        BatchVertex{ {p1, 0.0f}, packed, {1.0f, 0.0f} },
        BatchVertex{ {p2, 0.0f}, packed, {1.0f, 1.0f} },
    };

    u32 base = pool_.appendVertices(LayoutId::Batch, verts.data(), sizeof(verts)) / sizeof(BatchVertex);
    u32 idx[3] = { base + 0, base + 1, base + 2 };
    pool_.appendIndices(LayoutId::Batch, idx, 3);
    pendingGeometry_ = true;
}

void ImmediateDraw::line(const glm::vec2& from, const glm::vec2& to,
                         const glm::vec4& color, f32 thickness) {
    if (!inFrame_) return;

    glm::vec2 delta = to - from;
    f32 length = glm::length(delta);
    if (length < 0.0001f) return;

    glm::vec2 dir = delta / length;
    glm::vec2 center = (from + to) * 0.5f;
    f32 angle = std::atan2(dir.y, dir.x);

    emitQuad(center, glm::vec2(length, thickness), angle, color, white_texture_id_);
    ++primitiveCount_;
}

void ImmediateDraw::line3D(const glm::vec3& from, const glm::vec3& to,
                           const glm::vec4& color, f32 thickness) {
    if (!inFrame_) return;

    glm::vec3 clippedFrom = from;
    glm::vec3 clippedTo = to;
    if (!clipLineToNearPlane(clippedFrom, clippedTo, viewProjection_)) return;

    const glm::vec3 delta = clippedTo - clippedFrom;
    const f32 length = glm::length(delta);
    if (length < 0.0001f) return;
    const glm::vec3 dir = delta / length;

    glm::vec3 side = glm::cross(dir, viewForward_);
    f32 sideLength = glm::length(side);
    if (sideLength < 0.0001f) {
        // Looking straight down the line: any perpendicular reads the same.
        side = glm::cross(dir, std::abs(dir.y) < 0.9f ? glm::vec3(0.0f, 1.0f, 0.0f)
                                                      : glm::vec3(1.0f, 0.0f, 0.0f));
        sideLength = glm::length(side);
        if (sideLength < 0.0001f) return;
    }
    side *= (thickness * 0.5f) / sideLength;

    useTexture(white_texture_id_);
    const u32 packed = packColor(color);
    const std::array<BatchVertex, 4> verts{
        BatchVertex{ clippedFrom - side, packed, {0.0f, 0.0f} },
        BatchVertex{ clippedFrom + side, packed, {1.0f, 0.0f} },
        BatchVertex{ clippedTo + side, packed, {1.0f, 1.0f} },
        BatchVertex{ clippedTo - side, packed, {0.0f, 1.0f} },
    };
    const u32 base =
        pool_.appendVertices(LayoutId::Batch, verts.data(), sizeof(verts)) / sizeof(BatchVertex);
    const u32 idx[6] = { base + 0, base + 1, base + 2, base + 2, base + 3, base + 0 };
    pool_.appendIndices(LayoutId::Batch, idx, 6);
    pendingGeometry_ = true;
    ++primitiveCount_;
}

void ImmediateDraw::line3DScreen(const glm::vec3& from, const glm::vec3& to,
                                 const glm::vec4& color, f32 thickness) {
    if (!inFrame_ || !(thickness > 0.0f)) return;

    glm::vec3 clippedFrom = from;
    glm::vec3 clippedTo = to;
    if (!clipLineToNearPlane(clippedFrom, clippedTo, viewProjection_)) return;

    const glm::vec4 clipFrom = viewProjection_ * glm::vec4(clippedFrom, 1.0f);
    const glm::vec4 clipTo = viewProjection_ * glm::vec4(clippedTo, 1.0f);
    if (std::abs(clipFrom.w) < 1e-9f || std::abs(clipTo.w) < 1e-9f) return;
    const glm::vec2 ndcFrom = glm::vec2(clipFrom) / clipFrom.w;
    const glm::vec2 ndcTo = glm::vec2(clipTo) / clipTo.w;
    const glm::vec2 pixelDelta{
        (ndcTo.x - ndcFrom.x) * viewportWidth_,
        (ndcTo.y - ndcFrom.y) * viewportHeight_,
    };
    const f32 pixelLength = glm::length(pixelDelta);
    if (!(pixelLength > 1e-6f) || !std::isfinite(pixelLength)) return;
    const glm::vec2 normal{-pixelDelta.y / pixelLength, pixelDelta.x / pixelLength};
    const glm::vec2 ndcOffset{
        normal.x * thickness / viewportWidth_,
        normal.y * thickness / viewportHeight_,
    };

    const auto unproject = [this](const glm::vec4& clip, glm::vec3& point) {
        const glm::vec4 world = inverseViewProjection_ * clip;
        if (!std::isfinite(world.x) || !std::isfinite(world.y) ||
            !std::isfinite(world.z) || !std::isfinite(world.w) ||
            std::abs(world.w) < 1e-9f) {
            return false;
        }
        point = glm::vec3(world) / world.w;
        return std::isfinite(point.x) && std::isfinite(point.y) && std::isfinite(point.z);
    };
    const glm::vec4 fromOffset{ndcOffset * clipFrom.w, 0.0f, 0.0f};
    const glm::vec4 toOffset{ndcOffset * clipTo.w, 0.0f, 0.0f};
    std::array<glm::vec3, 4> points;
    if (!unproject(clipFrom - fromOffset, points[0]) ||
        !unproject(clipFrom + fromOffset, points[1]) ||
        !unproject(clipTo + toOffset, points[2]) ||
        !unproject(clipTo - toOffset, points[3])) {
        return;
    }
    const u32 packed = packColor(color);
    const std::array<BatchVertex, 4> verts{
        BatchVertex{ points[0], packed, {0.0f, 0.0f} },
        BatchVertex{ points[1], packed, {1.0f, 0.0f} },
        BatchVertex{ points[2], packed, {1.0f, 1.0f} },
        BatchVertex{ points[3], packed, {0.0f, 1.0f} },
    };

    useTexture(white_texture_id_);
    const u32 base =
        pool_.appendVertices(LayoutId::Batch, verts.data(), sizeof(verts)) / sizeof(BatchVertex);
    const u32 idx[6] = { base + 0, base + 1, base + 2, base + 2, base + 3, base + 0 };
    pool_.appendIndices(LayoutId::Batch, idx, 6);
    pendingGeometry_ = true;
    ++primitiveCount_;
}

void ImmediateDraw::line3DScreenOffset(const glm::vec3& anchor,
                                       const glm::vec2& fromOffset,
                                       const glm::vec2& toOffset,
                                       const glm::vec4& color, f32 thickness) {
    if (!inFrame_ || !(thickness > 0.0f)) return;

    const glm::vec4 clipAnchor = viewProjection_ * glm::vec4(anchor, 1.0f);
    if (!std::isfinite(clipAnchor.x) || !std::isfinite(clipAnchor.y)
        || !std::isfinite(clipAnchor.z) || !std::isfinite(clipAnchor.w)
        || std::abs(clipAnchor.w) < 1e-9f || clipAnchor.z + clipAnchor.w < 0.0f) {
        return;
    }

    glm::vec3 from;
    glm::vec3 to;
    if (!screenOffsetPoint(inverseViewProjection_, clipAnchor, fromOffset,
                           viewportWidth_, viewportHeight_, from)
        || !screenOffsetPoint(inverseViewProjection_, clipAnchor, toOffset,
                              viewportWidth_, viewportHeight_, to)) return;
    line3DScreen(from, to, color, thickness);
}

void ImmediateDraw::polyline(std::span<const glm::vec2> vertices,
                             const glm::vec4& color, f32 thickness, bool closed) {
    if (!inFrame_ || vertices.size() < 2) return;

    for (size_t i = 0; i < vertices.size() - 1; ++i) {
        line(vertices[i], vertices[i + 1], color, thickness);
    }
    if (closed && vertices.size() > 2) {
        line(vertices.back(), vertices.front(), color, thickness);
    }
}

void ImmediateDraw::rect(const glm::vec2& position, const glm::vec2& size,
                         const glm::vec4& color, bool filled) {
    if (!inFrame_) return;

    if (filled) {
        emitQuad(position, size, 0.0f, color, white_texture_id_);
        ++primitiveCount_;
    } else {
        rectOutline(position, size, color, 1.0f);
    }
}

void ImmediateDraw::rectOutline(const glm::vec2& position, const glm::vec2& size,
                                const glm::vec4& color, f32 thickness) {
    if (!inFrame_) return;

    f32 halfW = size.x * 0.5f;
    f32 halfH = size.y * 0.5f;

    glm::vec2 tl(position.x - halfW, position.y + halfH);
    glm::vec2 tr(position.x + halfW, position.y + halfH);
    glm::vec2 br(position.x + halfW, position.y - halfH);
    glm::vec2 bl(position.x - halfW, position.y - halfH);

    line(tl, tr, color, thickness);
    line(tr, br, color, thickness);
    line(br, bl, color, thickness);
    line(bl, tl, color, thickness);
}

void ImmediateDraw::circle(const glm::vec2& center, f32 radius,
                           const glm::vec4& color, bool filled, i32 segments) {
    if (!inFrame_ || segments < 3) return;

    if (filled) {
        for (i32 i = 0; i < segments; ++i) {
            f32 a1 = static_cast<f32>(i) / static_cast<f32>(segments) * glm::two_pi<f32>();
            f32 a2 = static_cast<f32>(i + 1) / static_cast<f32>(segments) * glm::two_pi<f32>();
            glm::vec2 p1 = center + glm::vec2(std::cos(a1), std::sin(a1)) * radius;
            glm::vec2 p2 = center + glm::vec2(std::cos(a2), std::sin(a2)) * radius;
            emitTriangle(center, p1, p2, color);
            ++primitiveCount_;
        }
    } else {
        circleOutline(center, radius, color, 1.0f, segments);
    }
}

void ImmediateDraw::circleOutline(const glm::vec2& center, f32 radius,
                                  const glm::vec4& color, f32 thickness, i32 segments) {
    if (!inFrame_ || segments < 3) return;

    for (i32 i = 0; i < segments; ++i) {
        f32 a1 = static_cast<f32>(i) / static_cast<f32>(segments) * glm::two_pi<f32>();
        f32 a2 = static_cast<f32>(i + 1) / static_cast<f32>(segments) * glm::two_pi<f32>();
        glm::vec2 p1 = center + glm::vec2(std::cos(a1), std::sin(a1)) * radius;
        glm::vec2 p2 = center + glm::vec2(std::cos(a2), std::sin(a2)) * radius;
        line(p1, p2, color, thickness);
    }
}

void ImmediateDraw::polygon(std::span<const glm::vec2> vertices, const glm::vec4& color) {
    if (!inFrame_ || vertices.size() < 3) return;

    for (size_t i = 1; i + 1 < vertices.size(); ++i) {
        emitTriangle(vertices[0], vertices[i], vertices[i + 1], color);
        ++primitiveCount_;
    }
}

void ImmediateDraw::texture(const glm::vec2& position, const glm::vec2& size,
                            u32 textureId, const glm::vec4& tint) {
    if (!inFrame_) return;
    emitQuad(position, size, 0.0f, tint, textureId);
    ++primitiveCount_;
}

void ImmediateDraw::textureRotated(const glm::vec2& position, const glm::vec2& size,
                                   f32 rotation, u32 textureId, const glm::vec4& tint) {
    if (!inFrame_) return;
    emitQuad(position, size, rotation, tint, textureId);
    ++primitiveCount_;
}

}  // namespace esengine

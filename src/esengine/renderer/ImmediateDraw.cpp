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

#include "ImmediateDraw.hpp"
#include "GfxDevice.hpp"
#include "RenderContext.hpp"
#include "Shader.hpp"
#include "ShaderEmbeds.generated.hpp"
#include "BatchVertex.hpp"
#include "../resource/ShaderParser.hpp"
#include "../resource/ResourceManager.hpp"
#include "../core/Log.hpp"

#include <glm/gtc/constants.hpp>
#include <glm/gtc/type_ptr.hpp>
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

void ImmediateDraw::init() {
    if (initialized_) return;

    pool_.init();
    white_texture_id_ = context_.getWhiteTextureId();

    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::BATCH);
    auto handle = resource_manager_.createShaderWithBindings(
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex),
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment),
        {{0, "a_position"}, {1, "a_color"}, {2, "a_texCoord"}}
    );
    Shader* shader = resource_manager_.getShader(handle);
    if (shader && shader->isValid()) {
        batch_shader_id_ = shader->getProgramId();
        device_.useProgram(batch_shader_id_);
        // Immediate draw is single-texture (slot 0), but bind all 8 samplers for parity
        // with the world batch shader.
        for (i32 i = 0; i < 8; ++i) {
            i32 loc = device_.getUniformLocation(batch_shader_id_, ("u_textures[" + std::to_string(i) + "]").c_str());
            if (loc >= 0) device_.setUniform1i(loc, i);
        }
        device_.useProgram(0);

        // One immutable pipeline: the batch shader, Batch layout, normal blend, depth
        // test off (write on, matching the world batch path), no stencil, no culling.
        PipelineDesc desc{};
        desc.program = batch_shader_id_;
        desc.vertexLayout = LayoutId::Batch;
        desc.blend = BlendMode::Normal;
        desc.blendEnabled = true;
        desc.depthTest = false;
        desc.depthWrite = true;
        desc.stencil = GfxStencilMode::Off;
        desc.cullEnabled = false;
        pipeline_ = device_.createPipeline(desc);
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

void ImmediateDraw::begin(const glm::mat4& viewProjection) {
    if (!initialized_) return;

    // The batch shader reads u_projection from the shared FrameConstants UBO; update it
    // for this pass rather than uploading a loose uniform per flush.
    context_.updateFrameConstants(viewProjection);
    // A prior phase may have left another pipeline bound; force our pipeline to re-apply.
    device_.invalidatePipelineCache();

    pool_.beginFrame();
    currentTexture_ = white_texture_id_;
    pendingGeometry_ = false;
    primitiveCount_ = 0;
    drawCallCount_ = 0;
    inFrame_ = true;
}

void ImmediateDraw::flush() {
    if (!initialized_ || !inFrame_ || !pendingGeometry_) return;

    pool_.upload();

    device_.setPipeline(pipeline_);
    device_.bindTexture(0, currentTexture_);

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
        verts[i].position = center + rotated;
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
        BatchVertex{ p0, packed, {0.0f, 0.0f} },
        BatchVertex{ p1, packed, {1.0f, 0.0f} },
        BatchVertex{ p2, packed, {1.0f, 1.0f} },
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

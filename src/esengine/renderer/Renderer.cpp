/**
 * @file    Renderer.cpp
 * @brief   2D renderer and batch renderer implementation
 * @details Implements immediate-mode and batched 2D rendering with quad primitives.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Renderer.hpp"
#include "RenderCommand.hpp"
#include "../core/Log.hpp"
#include "../resource/ResourceManager.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#include <array>
#include <vector>

namespace esengine {

// ========================================
// RenderCommand Implementation
// ========================================

void RenderCommand::init() {
    ES_LOG_INFO("RenderCommand initialized");

    // Enable depth testing by default
    glEnable(GL_DEPTH_TEST);

    // Enable blending
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
}

void RenderCommand::shutdown() {
    ES_LOG_INFO("RenderCommand shutdown");
}

void RenderCommand::setViewport(i32 x, i32 y, u32 width, u32 height) {
    glViewport(x, y, static_cast<GLsizei>(width), static_cast<GLsizei>(height));
}

void RenderCommand::setClearColor(const glm::vec4& color) {
    glClearColor(color.r, color.g, color.b, color.a);
}

void RenderCommand::clear() {
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
}

void RenderCommand::drawIndexed(const VertexArray& vao, u32 indexCount) {
    vao.bind();
    auto ib = vao.getIndexBuffer();
    u32 count = indexCount ? indexCount : (ib ? ib->getCount() : 0);
    if (count > 0 && ib) {
        GLenum type = ib->is16Bit() ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT;
        glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(count), type, nullptr);
    }
}

void RenderCommand::drawArrays(u32 vertexCount) {
    glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexCount));
}

void RenderCommand::setDepthTest(bool enabled) {
    if (enabled) {
        glEnable(GL_DEPTH_TEST);
    } else {
        glDisable(GL_DEPTH_TEST);
    }
}

void RenderCommand::setDepthWrite(bool enabled) {
    glDepthMask(enabled ? GL_TRUE : GL_FALSE);
}

void RenderCommand::setBlending(bool enabled) {
    if (enabled) {
        glEnable(GL_BLEND);
    } else {
        glDisable(GL_BLEND);
    }
}

void RenderCommand::setBlendFunc() {
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
}

void RenderCommand::setCulling(bool enabled) {
    if (enabled) {
        glEnable(GL_CULL_FACE);
    } else {
        glDisable(GL_CULL_FACE);
    }
}

void RenderCommand::setCullFace(bool front) {
    glCullFace(front ? GL_FRONT : GL_BACK);
}

void RenderCommand::setWireframe(bool enabled) {
#ifndef ES_PLATFORM_WEB
    glPolygonMode(GL_FRONT_AND_BACK, enabled ? GL_LINE : GL_FILL);
#else
    (void)enabled;
#endif
}

// ========================================
// Renderer Implementation
// ========================================

Renderer::Renderer(RenderContext& context)
    : context_(context) {
}

void Renderer::beginFrame() {
    context_.stats().reset();
}

void Renderer::endFrame() {
    // Nothing to do for now
}

void Renderer::setViewport(i32 x, i32 y, u32 width, u32 height) {
    RenderCommand::setViewport(x, y, width, height);
}

void Renderer::setClearColor(const glm::vec4& color) {
    RenderCommand::setClearColor(color);
}

void Renderer::clear() {
    RenderCommand::clear();
}

void Renderer::beginScene(const glm::mat4& viewProjection) {
    context_.viewProjection() = viewProjection;
}

void Renderer::endScene() {
    // Nothing to do for now
}

void Renderer::submit(const Shader& shader, const VertexArray& vao, const glm::mat4& transform) {
    shader.bind();
    shader.setUniform("u_projection", context_.viewProjection());
    shader.setUniform("u_model", transform);

    RenderCommand::drawIndexed(vao);

    context_.stats().drawCalls++;
}

void Renderer::drawQuad(const glm::vec2& position, const glm::vec2& size, const glm::vec4& color) {
    drawQuad(glm::vec3(position, 0.0f), size, color);
}

void Renderer::drawQuad(const glm::vec3& position, const glm::vec2& size, const glm::vec4& color) {
    auto* shader = context_.getColorShader();
    auto* vao = context_.getQuadVAO();
    if (!shader || !vao) return;

    glm::mat4 transform = glm::translate(glm::mat4(1.0f), position);
    transform = glm::scale(transform, glm::vec3(size, 1.0f));

    shader->bind();
    shader->setUniform("u_projection", context_.viewProjection());
    shader->setUniform("u_model", transform);
    shader->setUniform("u_color", color);

    RenderCommand::drawIndexed(*vao);

    context_.stats().drawCalls++;
    context_.stats().triangleCount += 2;
}

void Renderer::drawQuad(const glm::vec2& position, const glm::vec2& size,
                        const Texture& texture, const glm::vec4& tintColor) {
    drawQuad(glm::vec3(position, 0.0f), size, texture, tintColor);
}

void Renderer::drawQuad(const glm::vec3& position, const glm::vec2& size,
                        const Texture& texture, const glm::vec4& tintColor) {
    auto* shader = context_.getTextureShader();
    auto* vao = context_.getQuadVAO();
    if (!shader || !vao) return;

    glm::mat4 transform = glm::translate(glm::mat4(1.0f), position);
    transform = glm::scale(transform, glm::vec3(size, 1.0f));

    texture.bind(0);

    shader->bind();
    shader->setUniform("u_projection", context_.viewProjection());
    shader->setUniform("u_model", transform);
    shader->setUniform("u_color", tintColor);
    shader->setUniform("u_texture", 0);

    RenderCommand::drawIndexed(*vao);

    context_.stats().drawCalls++;
    context_.stats().triangleCount += 2;
}

void Renderer::drawQuad(const glm::vec2& position, const glm::vec2& size,
                        resource::TextureHandle texture, resource::ResourceManager& rm,
                        const glm::vec4& tintColor) {
    Texture* tex = rm.getTexture(texture);
    if (tex) {
        drawQuad(position, size, *tex, tintColor);
    }
}

RendererStats Renderer::getStats() const {
    return context_.stats();
}

void Renderer::resetStats() {
    context_.stats().reset();
}

// ========================================
// BatchRenderer2D Implementation
// ========================================

// Batch vertex structure
struct BatchVertex {
    glm::vec3 position;
    glm::vec4 color;
    glm::vec2 texCoord;
    f32 texIndex;
};

// Batch rendering constants
constexpr u32 MAX_QUADS = 10000;
constexpr u32 MAX_VERTICES = MAX_QUADS * 4;
constexpr u32 MAX_INDICES = MAX_QUADS * 6;
constexpr u32 MAX_TEXTURE_SLOTS = 8;

// Quad vertex positions (CCW from bottom-left)
constexpr glm::vec4 QUAD_POSITIONS[4] = {
    { -0.5f, -0.5f, 0.0f, 1.0f },
    {  0.5f, -0.5f, 0.0f, 1.0f },
    {  0.5f,  0.5f, 0.0f, 1.0f },
    { -0.5f,  0.5f, 0.0f, 1.0f }
};

constexpr glm::vec2 QUAD_TEX_COORDS[4] = {
    { 0.0f, 0.0f },
    { 1.0f, 0.0f },
    { 1.0f, 1.0f },
    { 0.0f, 1.0f }
};

// BatchRenderer2D internal data
struct BatchRenderer2D::BatchData {
    Unique<VertexArray> vao;
    Shared<VertexBuffer> vbo;
    resource::ShaderHandle shader_handle;

    std::vector<BatchVertex> vertices;
    u32 indexCount = 0;

    std::array<u32, MAX_TEXTURE_SLOTS> textureSlots;
    u32 textureSlotIndex = 1;

    glm::mat4 projection{1.0f};

    u32 drawCallCount = 0;
    u32 quadCount = 0;

    bool initialized = false;
};

BatchRenderer2D::BatchRenderer2D(RenderContext& context,
                                 resource::ResourceManager& resource_manager)
    : data_(makeUnique<BatchData>())
    , context_(context)
    , resource_manager_(resource_manager) {
}

BatchRenderer2D::~BatchRenderer2D() {
    if (data_ && data_->initialized) {
        shutdown();
    }
}

void BatchRenderer2D::init() {
    data_->vertices.reserve(MAX_VERTICES);

    data_->vao = VertexArray::create();

    data_->vbo = makeShared<VertexBuffer>();
    *data_->vbo = std::move(*VertexBuffer::create(MAX_VERTICES * sizeof(BatchVertex)));
    data_->vbo->setLayout({
        { ShaderDataType::Float3, "a_position" },
        { ShaderDataType::Float4, "a_color" },
        { ShaderDataType::Float2, "a_texCoord" },
        { ShaderDataType::Float,  "a_texIndex" }
    });

    data_->vao->addVertexBuffer(data_->vbo);

    std::vector<u32> indices(MAX_INDICES);
    u32 offset = 0;
    for (u32 i = 0; i < MAX_INDICES; i += 6) {
        indices[i + 0] = offset + 0;
        indices[i + 1] = offset + 1;
        indices[i + 2] = offset + 2;
        indices[i + 3] = offset + 2;
        indices[i + 4] = offset + 3;
        indices[i + 5] = offset + 0;
        offset += 4;
    }
    auto ibo = IndexBuffer::create(indices.data(), MAX_INDICES);
    data_->vao->setIndexBuffer(Shared<IndexBuffer>(std::move(ibo)));

    data_->shader_handle = resource_manager_.loadEngineShader("batch");
    if (!data_->shader_handle.isValid()) {
        ES_LOG_INFO("Using embedded batch shader for Web platform");
        data_->shader_handle = resource_manager_.createShader(
            ShaderSources::BATCH_VERTEX,
            ShaderSources::BATCH_FRAGMENT
        );
    }

    data_->textureSlots[0] = context_.getWhiteTextureId();
    for (u32 i = 1; i < MAX_TEXTURE_SLOTS; ++i) {
        data_->textureSlots[i] = 0;
    }

    data_->initialized = true;
    ES_LOG_INFO("BatchRenderer2D initialized (max {} quads per batch)", MAX_QUADS);
}

void BatchRenderer2D::shutdown() {
    if (!data_ || !data_->initialized) return;

    data_->vao.reset();
    data_->vbo.reset();
    data_->initialized = false;

    ES_LOG_INFO("BatchRenderer2D shutdown");
}

void BatchRenderer2D::beginBatch() {
    data_->vertices.clear();
    data_->indexCount = 0;
    data_->textureSlotIndex = 1;
    data_->drawCallCount = 0;
    data_->quadCount = 0;
}

void BatchRenderer2D::endBatch() {
    flush();
}

void BatchRenderer2D::flush() {
    if (data_->vertices.empty()) return;

    Shader* shader = resource_manager_.getShader(data_->shader_handle);
    if (!shader) return;

    data_->vbo->setDataRaw(
        data_->vertices.data(),
        static_cast<u32>(data_->vertices.size() * sizeof(BatchVertex))
    );

    for (u32 i = 0; i < data_->textureSlotIndex; ++i) {
        glActiveTexture(GL_TEXTURE0 + i);
        glBindTexture(GL_TEXTURE_2D, data_->textureSlots[i]);
    }

    shader->bind();
    shader->setUniform("u_projection", data_->projection);

    i32 samplers[MAX_TEXTURE_SLOTS] = { 0, 1, 2, 3, 4, 5, 6, 7 };
    glUniform1iv(glGetUniformLocation(shader->getProgramId(), "u_textures"),
                 MAX_TEXTURE_SLOTS, samplers);

    RenderCommand::drawIndexed(*data_->vao, data_->indexCount);

    data_->drawCallCount++;

    data_->vertices.clear();
    data_->indexCount = 0;
    data_->textureSlotIndex = 1;
}

void BatchRenderer2D::drawQuad(const glm::vec2& position, const glm::vec2& size,
                                u32 textureId, const glm::vec4& color) {
    drawQuad(glm::vec3(position, 0.0f), size, textureId, color);
}

void BatchRenderer2D::drawQuad(const glm::vec3& position, const glm::vec2& size,
                                u32 textureId, const glm::vec4& color) {
    // Check if batch is full
    if (data_->vertices.size() >= MAX_VERTICES) {
        flush();
    }

    // Find or add texture slot
    f32 texIndex = 0.0f;
    if (textureId != 0) {
        bool found = false;
        for (u32 i = 0; i < data_->textureSlotIndex; ++i) {
            if (data_->textureSlots[i] == textureId) {
                texIndex = static_cast<f32>(i);
                found = true;
                break;
            }
        }
        if (!found) {
            if (data_->textureSlotIndex >= MAX_TEXTURE_SLOTS) {
                flush();
            }
            data_->textureSlots[data_->textureSlotIndex] = textureId;
            texIndex = static_cast<f32>(data_->textureSlotIndex);
            data_->textureSlotIndex++;
        }
    }

    // Calculate transform
    glm::mat4 transform = glm::translate(glm::mat4(1.0f), position);
    transform = glm::scale(transform, glm::vec3(size, 1.0f));

    // Add 4 vertices for quad
    for (u32 i = 0; i < 4; ++i) {
        BatchVertex vertex;
        vertex.position = glm::vec3(transform * QUAD_POSITIONS[i]);
        vertex.color = color;
        vertex.texCoord = QUAD_TEX_COORDS[i];
        vertex.texIndex = texIndex;
        data_->vertices.push_back(vertex);
    }

    data_->indexCount += 6;
    data_->quadCount++;
}

void BatchRenderer2D::drawQuad(const glm::vec2& position, const glm::vec2& size,
                                const glm::vec4& color) {
    drawQuad(glm::vec3(position, 0.0f), size, 0, color);
}

void BatchRenderer2D::drawRotatedQuad(const glm::vec2& position, const glm::vec2& size,
                                       f32 rotation, const glm::vec4& color) {
    drawRotatedQuad(position, size, rotation, 0, color);
}

void BatchRenderer2D::drawRotatedQuad(const glm::vec2& position, const glm::vec2& size,
                                       f32 rotation, u32 textureId, const glm::vec4& tintColor) {
    // Check if batch is full
    if (data_->vertices.size() >= MAX_VERTICES) {
        flush();
    }

    // Find or add texture slot
    f32 texIndex = 0.0f;
    if (textureId != 0) {
        bool found = false;
        for (u32 i = 0; i < data_->textureSlotIndex; ++i) {
            if (data_->textureSlots[i] == textureId) {
                texIndex = static_cast<f32>(i);
                found = true;
                break;
            }
        }
        if (!found) {
            if (data_->textureSlotIndex >= MAX_TEXTURE_SLOTS) {
                flush();
            }
            data_->textureSlots[data_->textureSlotIndex] = textureId;
            texIndex = static_cast<f32>(data_->textureSlotIndex);
            data_->textureSlotIndex++;
        }
    }

    // Calculate transform with rotation
    glm::mat4 transform = glm::translate(glm::mat4(1.0f), glm::vec3(position, 0.0f));
    transform = glm::rotate(transform, rotation, glm::vec3(0.0f, 0.0f, 1.0f));
    transform = glm::scale(transform, glm::vec3(size, 1.0f));

    // Add 4 vertices for quad
    for (u32 i = 0; i < 4; ++i) {
        BatchVertex vertex;
        vertex.position = glm::vec3(transform * QUAD_POSITIONS[i]);
        vertex.color = tintColor;
        vertex.texCoord = QUAD_TEX_COORDS[i];
        vertex.texIndex = texIndex;
        data_->vertices.push_back(vertex);
    }

    data_->indexCount += 6;
    data_->quadCount++;
}

void BatchRenderer2D::setProjection(const glm::mat4& projection) {
    data_->projection = projection;
}

u32 BatchRenderer2D::getDrawCallCount() const {
    return data_ ? data_->drawCallCount : 0;
}

u32 BatchRenderer2D::getQuadCount() const {
    return data_ ? data_->quadCount : 0;
}

}  // namespace esengine

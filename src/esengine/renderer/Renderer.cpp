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
#include <array>
#include <vector>

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <GL/gl.h>
    #ifndef GL_TRIANGLES
        #define GL_TRIANGLES 0x0004
        #define GL_UNSIGNED_INT 0x1405
        #define GL_UNSIGNED_SHORT 0x1403
        #define GL_COLOR_BUFFER_BIT 0x00004000
        #define GL_DEPTH_BUFFER_BIT 0x00000100
        #define GL_DEPTH_TEST 0x0B71
        #define GL_BLEND 0x0BE2
        #define GL_SRC_ALPHA 0x0302
        #define GL_ONE_MINUS_SRC_ALPHA 0x0303
        #define GL_CULL_FACE 0x0B44
        #define GL_BACK 0x0405
        #define GL_FRONT 0x0404
    #endif
#endif

namespace esengine {

// ========================================
// RenderCommand Implementation
// ========================================

void RenderCommand::init() {
#ifdef ES_PLATFORM_WEB
    ES_LOG_INFO("RenderCommand initialized (WebGL)");

    // Enable depth testing by default
    glEnable(GL_DEPTH_TEST);

    // Enable blending
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
#endif
}

void RenderCommand::shutdown() {
    ES_LOG_INFO("RenderCommand shutdown");
}

void RenderCommand::setViewport(i32 x, i32 y, u32 width, u32 height) {
#ifdef ES_PLATFORM_WEB
    glViewport(x, y, width, height);
#else
    (void)x; (void)y; (void)width; (void)height;
#endif
}

void RenderCommand::setClearColor(const glm::vec4& color) {
#ifdef ES_PLATFORM_WEB
    glClearColor(color.r, color.g, color.b, color.a);
#else
    (void)color;
#endif
}

void RenderCommand::clear() {
#ifdef ES_PLATFORM_WEB
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
#endif
}

void RenderCommand::drawIndexed(const VertexArray& vao, u32 indexCount) {
#ifdef ES_PLATFORM_WEB
    vao.bind();
    auto ib = vao.getIndexBuffer();
    u32 count = indexCount ? indexCount : (ib ? ib->getCount() : 0);
    if (count > 0 && ib) {
        GLenum type = ib->is16Bit() ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT;
        glDrawElements(GL_TRIANGLES, count, type, nullptr);
    }
#else
    (void)vao; (void)indexCount;
#endif
}

void RenderCommand::drawArrays(u32 vertexCount) {
#ifdef ES_PLATFORM_WEB
    glDrawArrays(GL_TRIANGLES, 0, vertexCount);
#else
    (void)vertexCount;
#endif
}

void RenderCommand::setDepthTest(bool enabled) {
#ifdef ES_PLATFORM_WEB
    if (enabled) {
        glEnable(GL_DEPTH_TEST);
    } else {
        glDisable(GL_DEPTH_TEST);
    }
#else
    (void)enabled;
#endif
}

void RenderCommand::setDepthWrite(bool enabled) {
#ifdef ES_PLATFORM_WEB
    glDepthMask(enabled ? GL_TRUE : GL_FALSE);
#else
    (void)enabled;
#endif
}

void RenderCommand::setBlending(bool enabled) {
#ifdef ES_PLATFORM_WEB
    if (enabled) {
        glEnable(GL_BLEND);
    } else {
        glDisable(GL_BLEND);
    }
#else
    (void)enabled;
#endif
}

void RenderCommand::setBlendFunc() {
#ifdef ES_PLATFORM_WEB
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
#endif
}

void RenderCommand::setCulling(bool enabled) {
#ifdef ES_PLATFORM_WEB
    if (enabled) {
        glEnable(GL_CULL_FACE);
    } else {
        glDisable(GL_CULL_FACE);
    }
#else
    (void)enabled;
#endif
}

void RenderCommand::setCullFace(bool front) {
#ifdef ES_PLATFORM_WEB
    glCullFace(front ? GL_FRONT : GL_BACK);
#else
    (void)front;
#endif
}

void RenderCommand::setWireframe(bool enabled) {
    (void)enabled;
    // WebGL doesn't support wireframe mode directly
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

// Batch shader sources
const char* BATCH_VERTEX_SHADER = R"(
    attribute vec3 a_position;
    attribute vec4 a_color;
    attribute vec2 a_texCoord;
    attribute float a_texIndex;

    uniform mat4 u_projection;

    varying vec4 v_color;
    varying vec2 v_texCoord;
    varying float v_texIndex;

    void main() {
        gl_Position = u_projection * vec4(a_position, 1.0);
        v_color = a_color;
        v_texCoord = a_texCoord;
        v_texIndex = a_texIndex;
    }
)";

const char* BATCH_FRAGMENT_SHADER = R"(
    precision mediump float;

    varying vec4 v_color;
    varying vec2 v_texCoord;
    varying float v_texIndex;

    uniform sampler2D u_textures[8];

    void main() {
        int index = int(v_texIndex);
        vec4 texColor = vec4(1.0);

        // WebGL 1.0 doesn't support dynamic array indexing
        if (index == 0) texColor = texture2D(u_textures[0], v_texCoord);
        else if (index == 1) texColor = texture2D(u_textures[1], v_texCoord);
        else if (index == 2) texColor = texture2D(u_textures[2], v_texCoord);
        else if (index == 3) texColor = texture2D(u_textures[3], v_texCoord);
        else if (index == 4) texColor = texture2D(u_textures[4], v_texCoord);
        else if (index == 5) texColor = texture2D(u_textures[5], v_texCoord);
        else if (index == 6) texColor = texture2D(u_textures[6], v_texCoord);
        else if (index == 7) texColor = texture2D(u_textures[7], v_texCoord);

        gl_FragColor = texColor * v_color;
    }
)";

// BatchRenderer2D internal data
struct BatchRenderer2D::BatchData {
    Unique<VertexArray> vao;
    Shared<VertexBuffer> vbo;
    Unique<Shader> shader;

    std::vector<BatchVertex> vertices;
    u32 indexCount = 0;

    std::array<u32, MAX_TEXTURE_SLOTS> textureSlots;
    u32 textureSlotIndex = 1;  // 0 = white texture

    glm::mat4 projection{1.0f};

    // Statistics
    u32 drawCallCount = 0;
    u32 quadCount = 0;

    bool initialized = false;
};

BatchRenderer2D::BatchRenderer2D(RenderContext& context)
    : data_(makeUnique<BatchData>()), context_(context) {
}

BatchRenderer2D::~BatchRenderer2D() {
    if (data_ && data_->initialized) {
        shutdown();
    }
}

void BatchRenderer2D::init() {
    data_->vertices.reserve(MAX_VERTICES);

#ifdef ES_PLATFORM_WEB
    // Create VAO
    data_->vao = VertexArray::create();

    // Create dynamic vertex buffer
    data_->vbo = makeShared<VertexBuffer>();
    *data_->vbo = std::move(*VertexBuffer::create(MAX_VERTICES * sizeof(BatchVertex)));
    data_->vbo->setLayout({
        { ShaderDataType::Float3, "a_position" },
        { ShaderDataType::Float4, "a_color" },
        { ShaderDataType::Float2, "a_texCoord" },
        { ShaderDataType::Float,  "a_texIndex" }
    });

    data_->vao->addVertexBuffer(data_->vbo);

    // Create index buffer (pre-computed pattern for quads)
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

    // Create batch shader
    data_->shader = Shader::create(BATCH_VERTEX_SHADER, BATCH_FRAGMENT_SHADER);

    // Initialize texture slots (slot 0 = white texture from context)
    data_->textureSlots[0] = context_.getWhiteTextureId();
    for (u32 i = 1; i < MAX_TEXTURE_SLOTS; ++i) {
        data_->textureSlots[i] = 0;
    }
#endif

    data_->initialized = true;
    ES_LOG_INFO("BatchRenderer2D initialized (max {} quads per batch)", MAX_QUADS);
}

void BatchRenderer2D::shutdown() {
    if (!data_ || !data_->initialized) return;

    data_->vao.reset();
    data_->vbo.reset();
    data_->shader.reset();
    data_->initialized = false;

    ES_LOG_INFO("BatchRenderer2D shutdown");
}

void BatchRenderer2D::beginBatch() {
    data_->vertices.clear();
    data_->indexCount = 0;
    data_->textureSlotIndex = 1;
}

void BatchRenderer2D::endBatch() {
    flush();
}

void BatchRenderer2D::flush() {
    if (data_->vertices.empty()) return;

#ifdef ES_PLATFORM_WEB
    // Upload vertex data
    data_->vbo->setDataRaw(
        data_->vertices.data(),
        static_cast<u32>(data_->vertices.size() * sizeof(BatchVertex))
    );

    // Bind textures
    for (u32 i = 0; i < data_->textureSlotIndex; ++i) {
        glActiveTexture(GL_TEXTURE0 + i);
        glBindTexture(GL_TEXTURE_2D, data_->textureSlots[i]);
    }

    // Set uniforms and draw
    data_->shader->bind();
    data_->shader->setUniform("u_projection", data_->projection);

    // Set texture uniform array
    i32 samplers[MAX_TEXTURE_SLOTS] = { 0, 1, 2, 3, 4, 5, 6, 7 };
    glUniform1iv(glGetUniformLocation(data_->shader->getProgramId(), "u_textures"),
                 MAX_TEXTURE_SLOTS, samplers);

    RenderCommand::drawIndexed(*data_->vao, data_->indexCount);

    data_->drawCallCount++;
#endif

    // Reset batch
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

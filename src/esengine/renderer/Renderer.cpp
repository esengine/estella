#include "Renderer.hpp"
#include "RenderCommand.hpp"
#include "../core/Log.hpp"

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
    // Would need to render with GL_LINES instead
}

// ========================================
// Renderer Implementation
// ========================================

namespace {
    struct RendererData {
        glm::mat4 viewProjection{1.0f};
        RendererStats stats;

        // Quad rendering data
        Unique<VertexArray> quadVAO;
        Unique<Shader> colorShader;
        bool initialized = false;
    };

    RendererData* s_data = nullptr;
}  // namespace

void Renderer::init() {
    s_data = new RendererData();

    RenderCommand::init();
    initQuadData();

    s_data->initialized = true;
    ES_LOG_INFO("Renderer initialized");
}

void Renderer::shutdown() {
    if (s_data) {
        s_data->quadVAO.reset();
        s_data->colorShader.reset();
        delete s_data;
        s_data = nullptr;
    }

    RenderCommand::shutdown();
    ES_LOG_INFO("Renderer shutdown");
}

void Renderer::initQuadData() {
#ifdef ES_PLATFORM_WEB
    // Simple quad vertices (position only for now)
    float vertices[] = {
        // Position (x, y)
        -0.5f, -0.5f,
         0.5f, -0.5f,
         0.5f,  0.5f,
        -0.5f,  0.5f
    };

    u32 indices[] = { 0, 1, 2, 2, 3, 0 };

    s_data->quadVAO = VertexArray::create();

    auto vbo = VertexBuffer::create(vertices, sizeof(vertices));
    vbo->setLayout({
        { ShaderDataType::Float2, "a_position" }
    });

    auto ibo = IndexBuffer::create(indices, 6);

    s_data->quadVAO->addVertexBuffer(Shared<VertexBuffer>(std::move(vbo)));
    s_data->quadVAO->setIndexBuffer(Shared<IndexBuffer>(std::move(ibo)));

    // Create simple color shader
    s_data->colorShader = Shader::create(
        ShaderSources::COLOR_VERTEX,
        ShaderSources::COLOR_FRAGMENT
    );
#endif
}

void Renderer::beginFrame() {
    s_data->stats.reset();
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
    s_data->viewProjection = viewProjection;
}

void Renderer::endScene() {
    // Nothing to do for now
}

void Renderer::submit(const Shader& shader, const VertexArray& vao, const glm::mat4& transform) {
    shader.bind();
    const_cast<Shader&>(shader).setUniform("u_projection", s_data->viewProjection);
    const_cast<Shader&>(shader).setUniform("u_model", transform);

    RenderCommand::drawIndexed(vao);

    s_data->stats.drawCalls++;
}

void Renderer::drawQuad(const glm::vec2& position, const glm::vec2& size, const glm::vec4& color) {
    drawQuad(glm::vec3(position, 0.0f), size, color);
}

void Renderer::drawQuad(const glm::vec3& position, const glm::vec2& size, const glm::vec4& color) {
    if (!s_data->colorShader || !s_data->quadVAO) return;

    glm::mat4 transform = glm::translate(glm::mat4(1.0f), position);
    transform = glm::scale(transform, glm::vec3(size, 1.0f));

    s_data->colorShader->bind();
    s_data->colorShader->setUniform("u_projection", s_data->viewProjection);
    s_data->colorShader->setUniform("u_model", transform);
    s_data->colorShader->setUniform("u_color", color);

    RenderCommand::drawIndexed(*s_data->quadVAO);

    s_data->stats.drawCalls++;
    s_data->stats.triangleCount += 2;
}

void Renderer::drawQuad(const glm::vec2& position, const glm::vec2& size,
                        const Texture& texture, const glm::vec4& tintColor) {
    drawQuad(glm::vec3(position, 0.0f), size, texture, tintColor);
}

void Renderer::drawQuad(const glm::vec3& position, const glm::vec2& size,
                        const Texture& texture, const glm::vec4& tintColor) {
    // TODO: Implement textured quad rendering
    (void)texture;
    (void)tintColor;
    drawQuad(position, size, glm::vec4(1.0f, 0.0f, 1.0f, 1.0f));  // Placeholder: magenta
}

RendererStats Renderer::getStats() {
    return s_data->stats;
}

void Renderer::resetStats() {
    s_data->stats.reset();
}

// ========================================
// BatchRenderer2D Implementation (Stub)
// ========================================

void BatchRenderer2D::init() {
    ES_LOG_INFO("BatchRenderer2D initialized");
}

void BatchRenderer2D::shutdown() {
    ES_LOG_INFO("BatchRenderer2D shutdown");
}

void BatchRenderer2D::beginBatch() {
    // TODO: Implement batch rendering
}

void BatchRenderer2D::endBatch() {
    flush();
}

void BatchRenderer2D::flush() {
    // TODO: Implement batch flush
}

void BatchRenderer2D::drawQuad(const glm::vec2& position, const glm::vec2& size,
                                u32 textureId, const glm::vec4& color) {
    drawQuad(glm::vec3(position, 0.0f), size, textureId, color);
}

void BatchRenderer2D::drawQuad(const glm::vec3& position, const glm::vec2& size,
                                u32 textureId, const glm::vec4& color) {
    (void)position; (void)size; (void)textureId; (void)color;
    // TODO: Implement
}

void BatchRenderer2D::drawQuad(const glm::vec2& position, const glm::vec2& size,
                                const glm::vec4& color) {
    drawQuad(position, size, 0, color);
}

void BatchRenderer2D::drawRotatedQuad(const glm::vec2& position, const glm::vec2& size,
                                       f32 rotation, const glm::vec4& color) {
    (void)position; (void)size; (void)rotation; (void)color;
    // TODO: Implement
}

void BatchRenderer2D::drawRotatedQuad(const glm::vec2& position, const glm::vec2& size,
                                       f32 rotation, u32 textureId, const glm::vec4& tintColor) {
    (void)position; (void)size; (void)rotation; (void)textureId; (void)tintColor;
    // TODO: Implement
}

void BatchRenderer2D::setProjection(const glm::mat4& projection) {
    (void)projection;
    // TODO: Implement
}

u32 BatchRenderer2D::getDrawCallCount() {
    return 0;  // TODO: Implement
}

u32 BatchRenderer2D::getQuadCount() {
    return 0;  // TODO: Implement
}

}  // namespace esengine

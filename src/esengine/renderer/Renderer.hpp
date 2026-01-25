#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "Buffer.hpp"
#include "Shader.hpp"
#include "Texture.hpp"

namespace esengine {

// Renderer statistics
struct RendererStats {
    u32 drawCalls = 0;
    u32 triangleCount = 0;
    u32 vertexCount = 0;

    void reset() {
        drawCalls = 0;
        triangleCount = 0;
        vertexCount = 0;
    }
};

// Static renderer class
class Renderer {
public:
    static void init();
    static void shutdown();

    static void beginFrame();
    static void endFrame();

    // Set viewport and clear color
    static void setViewport(i32 x, i32 y, u32 width, u32 height);
    static void setClearColor(const glm::vec4& color);
    static void clear();

    // Camera / Projection
    static void beginScene(const glm::mat4& viewProjection);
    static void endScene();

    // Submit draw calls
    static void submit(const Shader& shader,
                       const VertexArray& vao,
                       const glm::mat4& transform = glm::mat4(1.0f));

    // 2D Rendering helpers
    static void drawQuad(const glm::vec2& position, const glm::vec2& size,
                         const glm::vec4& color);

    static void drawQuad(const glm::vec2& position, const glm::vec2& size,
                         const Texture& texture, const glm::vec4& tintColor = glm::vec4(1.0f));

    static void drawQuad(const glm::vec3& position, const glm::vec2& size,
                         const glm::vec4& color);

    static void drawQuad(const glm::vec3& position, const glm::vec2& size,
                         const Texture& texture, const glm::vec4& tintColor = glm::vec4(1.0f));

    // Statistics
    static RendererStats getStats();
    static void resetStats();

private:
    static void initQuadData();
    static void flushBatch();
};

// 2D Batch Renderer for efficient sprite rendering
class BatchRenderer2D {
public:
    static void init();
    static void shutdown();

    static void beginBatch();
    static void endBatch();
    static void flush();

    // Draw textured quad
    static void drawQuad(const glm::vec2& position, const glm::vec2& size,
                         u32 textureId, const glm::vec4& color = glm::vec4(1.0f));

    static void drawQuad(const glm::vec3& position, const glm::vec2& size,
                         u32 textureId, const glm::vec4& color = glm::vec4(1.0f));

    // Draw colored quad (no texture)
    static void drawQuad(const glm::vec2& position, const glm::vec2& size,
                         const glm::vec4& color);

    // Draw rotated quad
    static void drawRotatedQuad(const glm::vec2& position, const glm::vec2& size,
                                 f32 rotation, const glm::vec4& color);

    static void drawRotatedQuad(const glm::vec2& position, const glm::vec2& size,
                                 f32 rotation, u32 textureId,
                                 const glm::vec4& tintColor = glm::vec4(1.0f));

    // Set projection matrix
    static void setProjection(const glm::mat4& projection);

    // Statistics
    static u32 getDrawCallCount();
    static u32 getQuadCount();
};

}  // namespace esengine

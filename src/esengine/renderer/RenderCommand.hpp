#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"

namespace esengine {

class VertexArray;

// Static class for low-level rendering commands
class RenderCommand {
public:
    static void init();
    static void shutdown();

    static void setViewport(i32 x, i32 y, u32 width, u32 height);
    static void setClearColor(const glm::vec4& color);
    static void clear();

    static void drawIndexed(const VertexArray& vao, u32 indexCount = 0);
    static void drawArrays(u32 vertexCount);

    // Depth testing
    static void setDepthTest(bool enabled);
    static void setDepthWrite(bool enabled);

    // Blending
    static void setBlending(bool enabled);
    static void setBlendFunc();  // Default: SrcAlpha, OneMinusSrcAlpha

    // Face culling
    static void setCulling(bool enabled);
    static void setCullFace(bool front);  // true = cull front, false = cull back

    // Wireframe mode
    static void setWireframe(bool enabled);
};

}  // namespace esengine

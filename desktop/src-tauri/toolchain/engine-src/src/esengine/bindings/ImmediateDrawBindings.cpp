#ifdef ES_PLATFORM_WEB

#include "ImmediateDrawBindings.hpp"
#include "EngineContext.hpp"
#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/RenderCommand.hpp"
#include "../renderer/BlendMode.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
#ifdef ES_ENABLE_SPINE
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#endif

#include <glm/glm.hpp>
#include <glm/gtc/type_ptr.hpp>

namespace esengine {

static EngineContext& ctx() { return EngineContext::instance(); }

#define g_initialized (ctx().isInitialized())
#define g_immediateDraw (ctx().immediateDraw())
#define g_immediateDrawActive (ctx().immediateDrawActive())
#define g_viewportWidth (ctx().viewportWidth())
#define g_viewportHeight (ctx().viewportHeight())
#define g_currentViewProjection (ctx().currentViewProjection())

static void flushImmediateDrawIfActive() {
    if (g_immediateDrawActive && g_immediateDraw) {
        g_immediateDraw->flush();
    }
}

void draw_begin(uintptr_t matrixPtr) {
    if (!g_initialized || !g_immediateDraw) return;

    glViewport(0, 0, g_viewportWidth, g_viewportHeight);

    const f32* matrixData = reinterpret_cast<const f32*>(matrixPtr);
    ctx().setCurrentViewProjection(glm::make_mat4(matrixData));
    g_immediateDraw->begin(g_currentViewProjection);
    ctx().setImmediateDrawActive(true);
}

void draw_end() {
    if (!g_initialized || !g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->end();
    ctx().setImmediateDrawActive(false);
}

void draw_line(f32 fromX, f32 fromY, f32 toX, f32 toY,
               f32 r, f32 g, f32 b, f32 a, f32 thickness) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->line(
        glm::vec2(fromX, fromY),
        glm::vec2(toX, toY),
        glm::vec4(r, g, b, a),
        thickness
    );
}

void draw_rect(f32 x, f32 y, f32 width, f32 height,
               f32 r, f32 g, f32 b, f32 a, bool filled) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->rect(
        glm::vec2(x, y),
        glm::vec2(width, height),
        glm::vec4(r, g, b, a),
        filled
    );
}

void draw_rectOutline(f32 x, f32 y, f32 width, f32 height,
                      f32 r, f32 g, f32 b, f32 a, f32 thickness) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->rectOutline(
        glm::vec2(x, y),
        glm::vec2(width, height),
        glm::vec4(r, g, b, a),
        thickness
    );
}

void draw_circle(f32 centerX, f32 centerY, f32 radius,
                 f32 r, f32 g, f32 b, f32 a, bool filled, i32 segments) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->circle(
        glm::vec2(centerX, centerY),
        radius,
        glm::vec4(r, g, b, a),
        filled,
        segments
    );
}

void draw_circleOutline(f32 centerX, f32 centerY, f32 radius,
                        f32 r, f32 g, f32 b, f32 a, f32 thickness, i32 segments) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->circleOutline(
        glm::vec2(centerX, centerY),
        radius,
        glm::vec4(r, g, b, a),
        thickness,
        segments
    );
}

void draw_texture(f32 x, f32 y, f32 width, f32 height, u32 textureId,
                  f32 r, f32 g, f32 b, f32 a) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->texture(
        glm::vec2(x, y),
        glm::vec2(width, height),
        textureId,
        glm::vec4(r, g, b, a)
    );
}

void draw_textureRotated(f32 x, f32 y, f32 width, f32 height, f32 rotation,
                         u32 textureId, f32 r, f32 g, f32 b, f32 a) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->textureRotated(
        glm::vec2(x, y),
        glm::vec2(width, height),
        rotation,
        textureId,
        glm::vec4(r, g, b, a)
    );
}

void draw_setLayer(i32 layer) {
    if (!g_immediateDraw) return;
    g_immediateDraw->setLayer(layer);
}

void draw_setDepth(f32 depth) {
    if (!g_immediateDraw) return;
    g_immediateDraw->setDepth(depth);
}

u32 draw_getDrawCallCount() {
    if (!g_immediateDraw) return 0;
    return g_immediateDraw->getDrawCallCount();
}

u32 draw_getPrimitiveCount() {
    if (!g_immediateDraw) return 0;
    return g_immediateDraw->getPrimitiveCount();
}

void draw_setBlendMode(i32 mode) {
    flushImmediateDrawIfActive();
    RenderCommand::setBlendMode(static_cast<BlendMode>(mode));
}

void draw_setDepthTest(bool enabled) {
    flushImmediateDrawIfActive();
    RenderCommand::setDepthTest(enabled);
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB

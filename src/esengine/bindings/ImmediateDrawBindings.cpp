#ifdef ES_PLATFORM_WEB

#include "ImmediateDrawBindings.hpp"
#include "ActiveContext.hpp"
#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/GfxDevice.hpp"
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

static EstellaContext& ctx() { return activeCtx(); }

#define g_device (ctx().tryGet<GfxDevice>())
#define g_initialized (ctx().state().initialized)
#define g_immediateDraw (ctx().tryGet<ImmediateDraw>())
#define g_immediateDrawActive (ctx().state().immediate_draw_active)
#define g_viewportWidth (ctx().state().viewport_width)
#define g_viewportHeight (ctx().state().viewport_height)
#define g_currentViewProjection (ctx().state().current_view_projection)

static void flushImmediateDrawIfActive() {
    if (g_immediateDrawActive && g_immediateDraw) {
        g_immediateDraw->flush();
    }
}

void draw_begin(uintptr_t matrixPtr) {
    if (!g_initialized || !g_immediateDraw) return;

    g_device->setViewport(0, 0, g_viewportWidth, g_viewportHeight);

    const f32* matrixData = reinterpret_cast<const f32*>(matrixPtr);
    ctx().state().current_view_projection = glm::make_mat4(matrixData);
    g_immediateDraw->begin(g_currentViewProjection);
    ctx().state().immediate_draw_active = true;
}

void draw_end() {
    if (!g_initialized || !g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->end();
    ctx().state().immediate_draw_active = false;
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
    g_device->setBlendMode(static_cast<BlendMode>(mode));
}

void draw_setDepthTest(bool enabled) {
    flushImmediateDrawIfActive();
    g_device->setDepthTest(enabled);
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB

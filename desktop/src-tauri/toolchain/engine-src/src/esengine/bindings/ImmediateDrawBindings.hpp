#pragma once

#ifdef ES_PLATFORM_WEB

#include "../core/Types.hpp"

namespace esengine {

void draw_begin(uintptr_t matrixPtr);
void draw_end();
void draw_line(f32 fromX, f32 fromY, f32 toX, f32 toY,
               f32 r, f32 g, f32 b, f32 a, f32 thickness);
void draw_rect(f32 x, f32 y, f32 width, f32 height,
               f32 r, f32 g, f32 b, f32 a, bool filled);
void draw_rectOutline(f32 x, f32 y, f32 width, f32 height,
                      f32 r, f32 g, f32 b, f32 a, f32 thickness);
void draw_circle(f32 centerX, f32 centerY, f32 radius,
                 f32 r, f32 g, f32 b, f32 a, bool filled, i32 segments);
void draw_circleOutline(f32 centerX, f32 centerY, f32 radius,
                        f32 r, f32 g, f32 b, f32 a, f32 thickness, i32 segments);
void draw_texture(f32 x, f32 y, f32 width, f32 height, u32 textureId,
                  f32 r, f32 g, f32 b, f32 a);
void draw_textureRotated(f32 x, f32 y, f32 width, f32 height, f32 rotation,
                         u32 textureId, f32 r, f32 g, f32 b, f32 a);
void draw_setLayer(i32 layer);
void draw_setDepth(f32 depth);
u32 draw_getDrawCallCount();
u32 draw_getPrimitiveCount();
void draw_setBlendMode(i32 mode);
void draw_setDepthTest(bool enabled);

}  // namespace esengine

#endif  // ES_PLATFORM_WEB

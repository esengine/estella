#pragma once

#include "../core/Types.hpp"

namespace esengine {

struct ScissorRect {
    i32 x = 0, y = 0, w = 0, h = 0;
    bool operator==(const ScissorRect& o) const {
        return x == o.x && y == o.y && w == o.w && h == o.h;
    }
    bool operator!=(const ScissorRect& o) const { return !(*this == o); }
};

enum class RenderType : u8 {
    Sprite = 0,
#ifdef ES_ENABLE_SPINE
    Spine = 1,
#endif
    Mesh = 2,
    ExternalMesh = 3,
    Text = 4,
    Particle = 5,
    Shape = 6,
    UIElement = 7,
};

}  // namespace esengine

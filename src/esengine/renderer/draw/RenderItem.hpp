// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"

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
    /// Posed geometry from a skeletal runtime — Spine or DragonBones. Neither is
    /// linked here: both are side modules that hand over batch vertices.
    Skeletal = 1,
    Mesh = 2,
    ExternalMesh = 3,
    Text = 4,
#ifdef ES_ENABLE_PARTICLES
    Particle = 5,
#endif
    Shape = 6,
    UIElement = 7,
    Trail = 8,
};

}  // namespace esengine

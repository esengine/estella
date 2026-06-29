// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

#include <string>

namespace esengine::ecs {

ES_ENUM()
enum class TextAlign : u8 {
    Left,
    Center,
    Right
};

ES_COMPONENT()
struct BitmapText {
    ES_PROPERTY()
    std::string text;

    ES_PROPERTY(animatable)
    glm::vec4 color{1.0f};

    ES_PROPERTY(min=1)
    f32 fontSize{1.0f};

    ES_PROPERTY()
    TextAlign align{TextAlign::Left};

    ES_PROPERTY()
    f32 spacing{0.0f};

    ES_PROPERTY(step=1)
    i32 layer{0};

    ES_PROPERTY(asset = font)
    resource::BitmapFontHandle font;

    ES_PROPERTY()
    bool enabled{true};
};

}  // namespace esengine::ecs

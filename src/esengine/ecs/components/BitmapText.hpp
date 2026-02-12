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

    ES_PROPERTY()
    glm::vec4 color{1.0f};

    ES_PROPERTY()
    f32 fontSize{1.0f};

    ES_PROPERTY()
    TextAlign align{TextAlign::Left};

    ES_PROPERTY()
    f32 spacing{0.0f};

    ES_PROPERTY()
    i32 layer{0};

    ES_PROPERTY()
    resource::BitmapFontHandle font;
};

}  // namespace esengine::ecs

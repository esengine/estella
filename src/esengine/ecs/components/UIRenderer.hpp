#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class UIVisualType : u8 {
    None,
    SolidColor,
    Image,
    NineSlice
};

ES_COMPONENT()
struct UIRenderer {
    ES_PROPERTY()
    UIVisualType visualType{UIVisualType::None};

    ES_PROPERTY(asset = texture)
    resource::TextureHandle texture;

    ES_PROPERTY(animatable)
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    ES_PROPERTY()
    glm::vec2 uvOffset{0.0f, 0.0f};

    ES_PROPERTY()
    glm::vec2 uvScale{1.0f, 1.0f};

    ES_PROPERTY()
    glm::vec4 sliceBorder{0.0f};

    ES_PROPERTY(asset = material)
    u32 material{0};

    ES_PROPERTY()
    bool enabled{true};

    i32 uiOrder{0};

    UIRenderer() = default;
};

}  // namespace esengine::ecs

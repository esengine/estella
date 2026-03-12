#pragma once

#include "../../core/Types.hpp"
#include "../../core/UITypes.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class FlexDirection : u8 {
    Row,
    Column,
    RowReverse,
    ColumnReverse
};

ES_ENUM()
enum class FlexWrap : u8 {
    NoWrap,
    Wrap
};

ES_ENUM()
enum class JustifyContent : u8 {
    Start,
    Center,
    End,
    SpaceBetween,
    SpaceAround,
    SpaceEvenly
};

ES_ENUM()
enum class AlignItems : u8 {
    Start,
    Center,
    End,
    Stretch
};

ES_ENUM()
enum class AlignContent : u8 {
    Start,
    Center,
    End,
    Stretch,
    SpaceBetween,
    SpaceAround
};

ES_COMPONENT()
struct FlexContainer {
    ES_PROPERTY()
    FlexDirection direction{FlexDirection::Row};
    ES_PROPERTY()
    FlexWrap wrap{FlexWrap::NoWrap};
    ES_PROPERTY()
    JustifyContent justifyContent{JustifyContent::Start};
    ES_PROPERTY()
    AlignItems alignItems{AlignItems::Stretch};
    ES_PROPERTY()
    AlignContent alignContent{AlignContent::Start};
    ES_PROPERTY()
    glm::vec2 gap{0.0f, 0.0f};
    ES_PROPERTY()
    Padding padding{};
};

}  // namespace esengine::ecs

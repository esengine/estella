// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "../core/Reflection.hpp"

namespace esengine::animation {

ES_ENUM(stability=experimental)
enum class EasingType : u8 {
    Linear = 0,
    EaseInQuad,
    EaseOutQuad,
    EaseInOutQuad,
    EaseInCubic,
    EaseOutCubic,
    EaseInOutCubic,
    EaseInBack,
    EaseOutBack,
    EaseInOutBack,
    EaseInElastic,
    EaseOutElastic,
    EaseInOutElastic,
    EaseOutBounce,
    CubicBezier,
    Step
};

ES_ENUM(stability=experimental)
enum class TweenTarget : u8 {
    PositionX = 0,
    PositionY,
    PositionZ,
    ScaleX,
    ScaleY,
    RotationZ,
    ColorR,
    ColorG,
    ColorB,
    ColorA,
    SizeX,
    SizeY,
    CameraOrthoSize
};

ES_ENUM(stability=experimental)
enum class TweenState : u8 {
    Running = 0,
    Paused,
    Completed,
    Cancelled
};

ES_ENUM(stability=experimental)
enum class LoopMode : u8 {
    None = 0,
    Restart,
    PingPong
};

struct TweenData {
    Entity target_entity{INVALID_ENTITY};
    TweenTarget target_property{TweenTarget::PositionX};

    f32 from_value{0.0f};
    f32 to_value{0.0f};
    f32 duration{1.0f};
    f32 elapsed{0.0f};
    f32 delay{0.0f};

    EasingType easing{EasingType::Linear};

    f32 bezier_p1x{0.0f};
    f32 bezier_p1y{0.0f};
    f32 bezier_p2x{1.0f};
    f32 bezier_p2y{1.0f};

    TweenState state{TweenState::Running};

    LoopMode loop_mode{LoopMode::None};
    i32 loop_count{0};
    i32 loops_remaining{0};

    u32 group_id{0};
    Entity sequence_next{INVALID_ENTITY};
};

}  // namespace esengine::animation

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    RigidBody2D.hpp
 * @brief   A body the flat world simulates.
 * @details Named for its plane, unlike `Light` or `MeshRenderer`: there really
 *          are two physics worlds, and this is the one Box2D steps. `RigidBody3D`
 *          is the other, and neither is the default.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "./BodyType.hpp"

namespace esengine::ecs {

ES_COMPONENT()
struct RigidBody2D {
    ES_PROPERTY()
    BodyType bodyType{BodyType::Dynamic};

    ES_PROPERTY()
    f32 gravityScale{1.0f};

    ES_PROPERTY()
    f32 linearDamping{0.0f};

    ES_PROPERTY()
    f32 angularDamping{0.0f};

    ES_PROPERTY()
    bool fixedRotation{false};

    ES_PROPERTY()
    bool bullet{false};

    ES_PROPERTY()
    bool enabled{true};

    RigidBody2D() = default;
};

}  // namespace esengine::ecs

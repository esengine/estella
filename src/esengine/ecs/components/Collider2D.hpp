// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Collider2D.hpp
 * @brief   The shapes that give a flat body its extent.
 * @details Suffixed for the plane they are in, beside the `*Collider3D` set in
 *          RigidBody3D.hpp. An unsuffixed name here would read as the default,
 *          and in a world that is three-dimensional it is not the default.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

ES_COMPONENT()
struct BoxCollider2D {
    ES_PROPERTY()
    glm::vec2 halfExtents{0.5f, 0.5f};

    ES_PROPERTY()
    glm::vec2 offset{0.0f, 0.0f};

    ES_PROPERTY()
    f32 density{1.0f};

    ES_PROPERTY()
    f32 friction{0.3f};

    ES_PROPERTY()
    f32 restitution{0.0f};

    ES_PROPERTY()
    bool isSensor{false};

    ES_PROPERTY()
    bool enabled{true};

    ES_PROPERTY()
    u32 categoryBits{0x0001};

    ES_PROPERTY()
    u32 maskBits{0xFFFF};

    BoxCollider2D() = default;
};

ES_COMPONENT()
struct CircleCollider2D {
    ES_PROPERTY()
    f32 radius{0.5f};

    ES_PROPERTY()
    glm::vec2 offset{0.0f, 0.0f};

    ES_PROPERTY()
    f32 density{1.0f};

    ES_PROPERTY()
    f32 friction{0.3f};

    ES_PROPERTY()
    f32 restitution{0.0f};

    ES_PROPERTY()
    bool isSensor{false};

    ES_PROPERTY()
    bool enabled{true};

    ES_PROPERTY()
    u32 categoryBits{0x0001};

    ES_PROPERTY()
    u32 maskBits{0xFFFF};

    CircleCollider2D() = default;
};

ES_COMPONENT()
struct CapsuleCollider2D {
    ES_PROPERTY()
    f32 radius{0.25f};

    ES_PROPERTY()
    f32 halfHeight{0.5f};

    ES_PROPERTY()
    glm::vec2 offset{0.0f, 0.0f};

    ES_PROPERTY()
    f32 density{1.0f};

    ES_PROPERTY()
    f32 friction{0.3f};

    ES_PROPERTY()
    f32 restitution{0.0f};

    ES_PROPERTY()
    bool isSensor{false};

    ES_PROPERTY()
    bool enabled{true};

    ES_PROPERTY()
    u32 categoryBits{0x0001};

    ES_PROPERTY()
    u32 maskBits{0xFFFF};

    CapsuleCollider2D() = default;
};

ES_COMPONENT()
struct SegmentCollider2D {
    ES_PROPERTY()
    glm::vec2 point1{-0.5f, 0.0f};

    ES_PROPERTY()
    glm::vec2 point2{0.5f, 0.0f};

    ES_PROPERTY()
    f32 density{1.0f};

    ES_PROPERTY()
    f32 friction{0.3f};

    ES_PROPERTY()
    f32 restitution{0.0f};

    ES_PROPERTY()
    bool isSensor{false};

    ES_PROPERTY()
    bool enabled{true};

    ES_PROPERTY()
    u32 categoryBits{0x0001};

    ES_PROPERTY()
    u32 maskBits{0xFFFF};

    SegmentCollider2D() = default;
};


}  // namespace esengine::ecs

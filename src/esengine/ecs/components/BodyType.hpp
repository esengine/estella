// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BodyType.hpp
 * @brief   How a solver is allowed to move a body — the one answer both worlds give.
 * @details It lived in the flat body's header, which meant `RigidBody3D.hpp`
 *          included `RigidBody.hpp` to reach it. Neither plane owns this: a body
 *          is static, kinematic or dynamic in two dimensions and in three, and
 *          the enum crosses the boundary as one set of ordinals.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class BodyType : u8 {
    Static,
    Kinematic,
    Dynamic
};

}  // namespace esengine::ecs

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ParticleForceField.hpp
 * @brief   A scene-placed force zone that pushes every world-space particle near it.
 * @details Where the emitter's Noise module is a per-emitter turbulence, a force
 *          field is an *external* influence: drop one in the scene (wind gust, black
 *          hole, whirlpool, drag pocket) and it acts on the particles of every
 *          emitter within range. Pure CPU — the ParticleSystem gathers the active
 *          fields each frame and folds them into the same velocity integration as
 *          gravity, so there is no new subsystem and nothing platform-specific.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

// Directional: a constant push along `direction` (wind). Point: pull toward
// (strength > 0) or push from (strength < 0) the field. Vortex: swirl tangentially
// around the field. Drag: damp velocity inside the zone (still air / water pocket).
// NOTE: keep these descriptions here, not as inline `//` comments on the values —
// the EHT enum parser treats trailing words as extra enum members.
ES_ENUM()
enum class ForceFieldType : i32 {
    Directional = 0,
    Point = 1,
    Vortex = 2,
    Drag = 3,
};

ES_COMPONENT()
struct ParticleForceField {
    ES_PROPERTY(enum=ForceFieldType, category=Field)
    i32 type{static_cast<i32>(ForceFieldType::Directional)};

    // Directional/Point/Vortex: acceleration magnitude (px/s²). Drag: damping rate
    // per second. Negative flips a Point field from attractor to repeller.
    ES_PROPERTY(category=Field)
    f32 strength{200.0f};

    // 0 = unbounded (affects the whole scene). > 0 = only particles within this world
    // radius of the field's position are affected.
    ES_PROPERTY(min=0, category=Field)
    f32 radius{0.0f};

    // Push direction for a Directional field (normalized at use). Point/Vortex/Drag
    // derive their direction from the field→particle vector and ignore this.
    ES_PROPERTY(category=Field)
    glm::vec3 direction{1.0f, 0.0f, 0.0f};

    // Fade the force linearly to 0 at the radius edge (only meaningful when radius > 0).
    ES_PROPERTY(category=Field)
    bool falloff{true};

    ES_PROPERTY()
    bool enabled{true};

    ParticleForceField() = default;
};

}  // namespace esengine::ecs

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "GfxEnums.hpp"

#include <cstddef>

namespace esengine {

/// Particle instance stream shared by CPU uploads and the GPU compute kernel's WGSL Inst.
struct ParticleInstanceData {
    f32 px, py, pz;
    f32 sx, sy;
    f32 rotation;
    f32 align;  ///< particle::renderAlignment, read with rotation as one vec2.
    u32 color;
    f32 uvOffsetX, uvOffsetY;
    f32 uvScaleX, uvScaleY;
    f32 age, random, intensity, lifetime;
};

static_assert(sizeof(ParticleInstanceData) == PARTICLE_INSTANCE_STRIDE);
static_assert(offsetof(ParticleInstanceData, px) == 0);
static_assert(offsetof(ParticleInstanceData, sx) == 12);
static_assert(offsetof(ParticleInstanceData, rotation) == 20);
static_assert(offsetof(ParticleInstanceData, align) == 24);
static_assert(offsetof(ParticleInstanceData, color) == 28);
static_assert(offsetof(ParticleInstanceData, uvOffsetX) == 32);
static_assert(offsetof(ParticleInstanceData, age) == 48);

}  // namespace esengine

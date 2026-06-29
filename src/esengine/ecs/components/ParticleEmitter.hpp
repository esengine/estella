// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"
#include "../../particle/ParticleEasing.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class EmitterShape : i32 {
    Point = 0,
    Circle = 1,
    Rectangle = 2,
    Cone = 3,
};

ES_ENUM()
enum class SimulationSpace : i32 {
    World = 0,
    Local = 1,
};

ES_COMPONENT()
struct ParticleEmitter {
    // Emission
    ES_PROPERTY(min=0, category=Emission)
    f32 rate{10.0f};

    ES_PROPERTY(min=0, step=1, category=Emission)
    i32 burstCount{0};

    ES_PROPERTY(min=0, category=Emission)
    f32 burstInterval{1.0f};

    ES_PROPERTY(min=0, category=Emission)
    f32 duration{5.0f};

    ES_PROPERTY(category=Emission)
    bool looping{true};

    ES_PROPERTY(category=Emission)
    bool playOnStart{true};

    ES_PROPERTY(min=1, step=1, category=Emission)
    i32 maxParticles{1000};

    // Lifetime
    ES_PROPERTY(min=0, category=Lifetime)
    f32 lifetimeMin{5.0f};

    ES_PROPERTY(min=0, category=Lifetime)
    f32 lifetimeMax{5.0f};

    // Shape (shape kind enum stays a TS-side override — runtime enumOptions constant)
    ES_PROPERTY(category=Shape)
    i32 shape{static_cast<i32>(EmitterShape::Cone)};

    ES_PROPERTY(min=0, category=Shape)
    f32 shapeRadius{100.0f};

    ES_PROPERTY(category=Shape)
    glm::vec2 shapeSize{100.0f, 100.0f};

    ES_PROPERTY(unit="°", category=Shape)
    f32 shapeAngle{25.0f};

    // Velocity
    ES_PROPERTY(category=Velocity)
    f32 speedMin{500.0f};

    ES_PROPERTY(category=Velocity)
    f32 speedMax{500.0f};

    ES_PROPERTY(unit="°", category=Velocity)
    f32 angleSpreadMin{0.0f};

    ES_PROPERTY(unit="°", category=Velocity)
    f32 angleSpreadMax{360.0f};

    // Size
    ES_PROPERTY(min=0, category=Size)
    f32 startSizeMin{100.0f};

    ES_PROPERTY(min=0, category=Size)
    f32 startSizeMax{100.0f};

    ES_PROPERTY(min=0, category=Size)
    f32 endSizeMin{100.0f};

    ES_PROPERTY(min=0, category=Size)
    f32 endSizeMax{100.0f};

    ES_PROPERTY(category=Size)
    i32 sizeEasing{static_cast<i32>(particle::EasingType::Linear)};

    // Color
    ES_PROPERTY(category=Color)
    glm::vec4 startColor{1.0f, 1.0f, 1.0f, 1.0f};

    ES_PROPERTY(category=Color)
    glm::vec4 endColor{1.0f, 1.0f, 1.0f, 0.0f};

    ES_PROPERTY(category=Color)
    i32 colorEasing{static_cast<i32>(particle::EasingType::Linear)};

    // Rotation
    ES_PROPERTY(unit="°", category=Rotation)
    f32 rotationMin{0.0f};

    ES_PROPERTY(unit="°", category=Rotation)
    f32 rotationMax{0.0f};

    ES_PROPERTY(category=Rotation)
    f32 angularVelocityMin{0.0f};

    ES_PROPERTY(category=Rotation)
    f32 angularVelocityMax{0.0f};

    // Forces (grouped under the Velocity category in the inspector)
    ES_PROPERTY(category=Velocity)
    glm::vec2 gravity{0.0f, 0.0f};

    ES_PROPERTY(min=0, category=Velocity)
    f32 damping{0.0f};

    // Texture
    ES_PROPERTY(asset = texture, category=Texture)
    resource::TextureHandle texture;

    ES_PROPERTY(min=1, step=1, category=Texture)
    i32 spriteColumns{1};

    ES_PROPERTY(min=1, step=1, category=Texture)
    i32 spriteRows{1};

    ES_PROPERTY(min=0, category=Texture)
    f32 spriteFPS{10.0f};

    ES_PROPERTY(category=Texture)
    bool spriteLoop{true};

    // Rendering (blendMode/simulationSpace enums stay TS-side overrides)
    ES_PROPERTY(category=Rendering)
    i32 blendMode{1};

    ES_PROPERTY(step=1, enum_source=sortingLayers, category=Rendering)
    i32 layer{0};

    ES_PROPERTY(asset = material, category=Rendering)
    u32 material{0};

    // Space
    ES_PROPERTY(category=Rendering)
    i32 simulationSpace{static_cast<i32>(SimulationSpace::World)};

    // State
    ES_PROPERTY()
    bool enabled{true};

    ParticleEmitter() = default;
};

}  // namespace esengine::ecs

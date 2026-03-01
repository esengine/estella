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
    ES_PROPERTY()
    f32 rate{10.0f};

    ES_PROPERTY()
    i32 burstCount{0};

    ES_PROPERTY()
    f32 burstInterval{1.0f};

    ES_PROPERTY()
    f32 duration{5.0f};

    ES_PROPERTY()
    bool looping{true};

    ES_PROPERTY()
    bool playOnStart{true};

    ES_PROPERTY()
    i32 maxParticles{1000};

    // Lifetime
    ES_PROPERTY()
    f32 lifetimeMin{5.0f};

    ES_PROPERTY()
    f32 lifetimeMax{5.0f};

    // Shape
    ES_PROPERTY()
    i32 shape{static_cast<i32>(EmitterShape::Cone)};

    ES_PROPERTY()
    f32 shapeRadius{100.0f};

    ES_PROPERTY()
    glm::vec2 shapeSize{100.0f, 100.0f};

    ES_PROPERTY()
    f32 shapeAngle{25.0f};

    // Velocity
    ES_PROPERTY()
    f32 speedMin{500.0f};

    ES_PROPERTY()
    f32 speedMax{500.0f};

    ES_PROPERTY()
    f32 angleSpreadMin{0.0f};

    ES_PROPERTY()
    f32 angleSpreadMax{360.0f};

    // Size
    ES_PROPERTY()
    f32 startSizeMin{100.0f};

    ES_PROPERTY()
    f32 startSizeMax{100.0f};

    ES_PROPERTY()
    f32 endSizeMin{100.0f};

    ES_PROPERTY()
    f32 endSizeMax{100.0f};

    ES_PROPERTY()
    i32 sizeEasing{static_cast<i32>(particle::EasingType::Linear)};

    // Color
    ES_PROPERTY()
    glm::vec4 startColor{1.0f, 1.0f, 1.0f, 1.0f};

    ES_PROPERTY()
    glm::vec4 endColor{1.0f, 1.0f, 1.0f, 0.0f};

    ES_PROPERTY()
    i32 colorEasing{static_cast<i32>(particle::EasingType::Linear)};

    // Rotation
    ES_PROPERTY()
    f32 rotationMin{0.0f};

    ES_PROPERTY()
    f32 rotationMax{0.0f};

    ES_PROPERTY()
    f32 angularVelocityMin{0.0f};

    ES_PROPERTY()
    f32 angularVelocityMax{0.0f};

    // Forces
    ES_PROPERTY()
    glm::vec2 gravity{0.0f, 0.0f};

    ES_PROPERTY()
    f32 damping{0.0f};

    // Texture
    ES_PROPERTY()
    resource::TextureHandle texture;

    ES_PROPERTY()
    i32 spriteColumns{1};

    ES_PROPERTY()
    i32 spriteRows{1};

    ES_PROPERTY()
    f32 spriteFPS{10.0f};

    ES_PROPERTY()
    bool spriteLoop{true};

    // Rendering
    ES_PROPERTY()
    i32 blendMode{1};

    ES_PROPERTY()
    i32 layer{0};

    ES_PROPERTY()
    u32 material{0};

    // Space
    ES_PROPERTY()
    i32 simulationSpace{static_cast<i32>(SimulationSpace::World)};

    // State
    ES_PROPERTY()
    bool enabled{true};

    ParticleEmitter() = default;
};

}  // namespace esengine::ecs

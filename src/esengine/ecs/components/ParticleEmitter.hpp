// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class EmitterShape : i32 {
    Point = 0,
    Circle = 1,
    Rectangle = 2,
    Cone = 3,
};

// Single source of the easing choice serialized by sizeEasing/colorEasing; the
// particle sim consumes it as particle::EasingType (alias) and the editor
// dropdown + TS const are EHT-generated from here.
ES_ENUM()
enum class ParticleEasing : i32 {
    Linear = 0,
    EaseIn = 1,
    EaseOut = 2,
    EaseInOut = 3,
};

ES_ENUM()
enum class SimulationSpace : i32 {
    World = 0,
    Local = 1,
};

// When a sub-emitter fires the referenced child emitter's burst: as each parent
// particle is born, or as it dies. (Collision joins this list once particle
// collision lands.)
ES_ENUM()
enum class SubEmitterTrigger : i32 {
    Death = 0,
    Birth = 1,
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

    // Shape kind — i32 storage, dropdown generated from the EmitterShape enum.
    ES_PROPERTY(enum=EmitterShape, category=Shape)
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

    // Easing — i32 storage, dropdown generated from the ParticleEasing enum.
    ES_PROPERTY(enum=ParticleEasing, category=Size)
    i32 sizeEasing{static_cast<i32>(ParticleEasing::Linear)};

    // Color
    ES_PROPERTY(category=Color)
    glm::vec4 startColor{1.0f, 1.0f, 1.0f, 1.0f};

    ES_PROPERTY(category=Color)
    glm::vec4 endColor{1.0f, 1.0f, 1.0f, 0.0f};

    ES_PROPERTY(enum=ParticleEasing, category=Color)
    i32 colorEasing{static_cast<i32>(ParticleEasing::Linear)};

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

    // Noise / Turbulence — a divergence-free curl-noise flow field advects each
    // particle, layered on top of velocity/gravity. Strength 0 disables it (no
    // field is sampled), so the module is free when unused.
    ES_PROPERTY(min=0, category=Noise)
    f32 noiseStrength{0.0f};

    ES_PROPERTY(min=0, category=Noise)
    f32 noiseFrequency{0.01f};

    ES_PROPERTY(category=Noise)
    f32 noiseScrollSpeed{0.0f};

    ES_PROPERTY(min=1, max=8, step=1, category=Noise)
    i32 noiseOctaves{1};

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

    // Rendering — blendMode keeps a TS override (BlendMode is a renderer-side enum,
    // not a component ES_ENUM); simulationSpace's dropdown is generated (see below).
    ES_PROPERTY(category=Rendering)
    i32 blendMode{1};

    ES_PROPERTY(step=1, enum_source=sortingLayers, category=Rendering)
    i32 layer{0};

    ES_PROPERTY(asset = material, category=Rendering)
    u32 material{0};

    // Space — i32 storage, dropdown generated from the SimulationSpace enum.
    ES_PROPERTY(enum=SimulationSpace, category=Rendering)
    i32 simulationSpace{static_cast<i32>(SimulationSpace::World)};

    // State
    ES_PROPERTY()
    bool enabled{true};

    // Sub-emitter — on each parent particle's birth or death, fire the referenced
    // child emitter's burst at that particle's position. The child is an ordinary
    // ParticleEmitter entity used as a template (typically rate=0, playOnStart=false
    // so it only emits when triggered); its burstCount sets the sub-burst size.
    // `subEmitter` is the child entity's raw id (0 = none). It is stored as u32
    // rather than Entity so the pointer layout keeps a heap accessor (Entity is
    // truncated out of the layout); the entity_ref tag still drives the editor
    // picker and the scene/prefab editor→runtime id remapping.
    ES_PROPERTY(enum=SubEmitterTrigger, category=SubEmitter)
    i32 subEmitterTrigger{static_cast<i32>(SubEmitterTrigger::Death)};

    ES_PROPERTY(min=0, max=1, category=SubEmitter)
    f32 subEmitterChance{1.0f};

    ES_PROPERTY(min=0, max=1, category=SubEmitter)
    f32 subEmitterInheritVelocity{0.0f};

    ES_PROPERTY(entity_ref, category=SubEmitter)
    u32 subEmitter{0};

    // Per-particle trail — each particle drags a tapering ribbon along its recent
    // path (comet tails, sparks, magic streaks). The ribbon reuses the same
    // triangle-strip batch path as the standalone TrailRenderer; its head takes the
    // particle's current colour and `trailWidth`, fading to a transparent point at
    // the tail. Off by default (no history is recorded when disabled).
    ES_PROPERTY(category=Trail)
    bool trailEnabled{false};

    ES_PROPERTY(min=0, category=Trail)
    f32 trailWidth{8.0f};

    ES_PROPERTY(min=2, max=12, step=1, category=Trail)
    i32 trailPoints{6};

    ES_PROPERTY(min=0, category=Trail)
    f32 trailMinDistance{6.0f};

    ParticleEmitter() = default;
};

}  // namespace esengine::ecs

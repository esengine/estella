// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TrailRenderer.hpp
 * @brief   World-space motion trail renderable (sword swipes, projectile/dash
 *          streaks, ribbon effects).
 * @details The trail records the entity's world position over time into a point
 *          history owned by TrailSystem (per-frame gameplay sim, like the particle
 *          system) — this component is PURE CONFIG. TrailPlugin turns that history
 *          into a triangle-strip ribbon each frame and streams it through the unified
 *          Batch face (CPU-generated verts, exactly like MeshRenderer), so a trail sorts,
 *          clips, and multi-texture-merges like every other 2D renderable. No new GPU
 *          path, no line-strip topology — a ribbon is triangles.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

namespace esengine::ecs {

// =============================================================================
// TrailRenderer Component
// =============================================================================

ES_COMPONENT(renderable=enabled)
struct TrailRenderer {
    // Trail — how long the streak lives and how densely it samples the path.
    /** @brief Seconds each recorded point persists before fading out of the tail. */
    ES_PROPERTY(min=0, category=Trail, tooltip="Seconds each trail point lives before it fades out of the tail.")
    f32 time{0.5f};

    /** @brief Minimum world distance the entity must move before a new point is
     *         recorded (0 = record every frame; larger = coarser, cheaper trail). */
    ES_PROPERTY(min=0, category=Trail, tooltip="Min world distance moved before a new trail point is recorded.")
    f32 minVertexDistance{5.0f};

    /** @brief Record new points. Set false to freeze emission and let the existing
     *         streak fade in place (the ribbon detaches from the entity). */
    ES_PROPERTY(category=Trail, tooltip="Record new points. False = freeze and let the streak fade in place.")
    bool emitting{true};

    // Width — full ribbon width tapered from the head (newest) to the tail (oldest).
    /** @brief Full ribbon width at the head (the newest point, glued to the entity). */
    ES_PROPERTY(min=0, category=Width, tooltip="Full ribbon width at the head (newest point).")
    f32 startWidth{20.0f};

    /** @brief Full ribbon width at the tail (the oldest point). 0 = taper to a line. */
    ES_PROPERTY(min=0, category=Width, tooltip="Full ribbon width at the tail (oldest point).")
    f32 endWidth{0.0f};

    // Color — lerped from head to tail; the alpha is the usual fade-out control.
    /** @brief Color at the head (newest). */
    ES_PROPERTY(animatable, category=Color, tooltip="Color at the head (newest point).")
    glm::vec4 startColor{1.0f, 1.0f, 1.0f, 1.0f};

    /** @brief Color at the tail (oldest) — typically the head color with alpha 0. */
    ES_PROPERTY(animatable, category=Color, tooltip="Color at the tail (oldest point) — usually alpha 0 to fade out.")
    glm::vec4 endColor{1.0f, 1.0f, 1.0f, 0.0f};

    // Rendering.
    /** @brief Texture sampled along the ribbon (U runs head→tail, V across the width).
     *         Invalid = untextured (vertex colors only). */
    ES_PROPERTY(asset = texture, category=Rendering)
    resource::TextureHandle texture;

    /** @brief Blend mode (0 = Normal, 1 = Additive for glow, …). */
    ES_PROPERTY(category=Rendering, tooltip="Blend mode: 0 Normal, 1 Additive (glow), 2 Multiply, …")
    i32 blendMode{0};

    /** @brief Sorting layer (higher = rendered on top). */
    ES_PROPERTY(step=1, enum_source=sortingLayers, category=Rendering, tooltip="Sorting layer — controls draw order across renderables.")
    i32 layer{0};

    /** @brief Custom material ID (0 = default batch shader). */
    ES_PROPERTY(asset = material, advanced, category=Rendering)
    u32 material{0};

    // State.
    ES_PROPERTY()
    bool enabled{true};

    TrailRenderer() = default;
};

}  // namespace esengine::ecs

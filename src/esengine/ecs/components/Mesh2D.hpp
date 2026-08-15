// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Mesh2D.hpp
 * @brief   Arbitrary-geometry 2D mesh renderable (deformed sprites, polygons, water
 *          surfaces, procedural shapes).
 * @details Vertices live in component-local space and stream through the unified
 *          Batch face each frame (CPU-transformed like every 2D renderable), so a
 *          mesh participates in sorting, clipping, and multi-texture merging exactly
 *          like a sprite. Geometry is set via mesh2d_setGeometry (bulk upload with
 *          index validation), not per-field reflection.
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

#include <vector>

namespace esengine::ecs {

/** @brief One local-space mesh vertex: position, texture coordinate, RGBA8 color. */
struct MeshVertex2D {
    glm::vec2 position{0.0f, 0.0f};
    glm::vec2 uv{0.0f, 0.0f};
    u32 color = 0xFFFFFFFFu;
};

// =============================================================================
// Mesh2D Component
// =============================================================================

ES_COMPONENT(renderable=enabled)
struct Mesh2D {
    /** @brief Texture sampled by the mesh UVs (invalid = untextured, vertex colors only) */
    ES_PROPERTY(asset = texture)
    resource::TextureHandle texture;

    /** @brief Tangent-space normal map, applied on top of the geometry's own normals.
     *         Needs a mesh that HAS normals; its tangent frame is derived per pixel,
     *         so the geometry carries no tangent channel. */
    ES_PROPERTY(asset = texture, tooltip="Normal map (tangent space). Needs a mesh with normals.")
    resource::TextureHandle normalMap;

    /** @brief Color tint multiplied with per-vertex colors (white = unchanged) */
    ES_PROPERTY(animatable, tooltip="Tint multiplied into the vertex colors (white = unchanged).")
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    /** @brief Sorting layer (higher = rendered on top) */
    ES_PROPERTY(step=1, enum_source=sortingLayers, tooltip="Sorting layer — controls draw order across renderables.")
    i32 layer{0};

    /** @brief Lit by the scene's 2D lights (Light2D). A custom material overrides this. */
    ES_PROPERTY(tooltip="Receive 2D lights: Light2D entities light this mesh (flat normal). A custom material overrides this.")
    bool lit{false};

    /** @brief Parallax scroll factor per axis. 1 = moves with the world (default, no
     *         parallax); <1 = scrolls slower than the camera (appears farther, e.g. a
     *         background); 0 = locked to the camera (e.g. a sky). The renderer offsets
     *         the mesh by camera_center * (1 - factor). */
    ES_PROPERTY(advanced, tooltip="Parallax scroll factor (1 = with world, <1 = slower, 0 = locked to camera).")
    glm::vec2 parallax{1.0f, 1.0f};

    /** @brief Custom material ID (0 = use default batch shader) */
    ES_PROPERTY(asset = material, advanced)
    u32 material{0};

    ES_PROPERTY()
    bool enabled{true};

    /**
     * @brief Geometry from an .esmesh, drawn INSTEAD of the inline vertices.
     * @details The difference is where the vertices live: the inline payload is
     *          rewritten into every frame, which is a re-upload of anything that
     *          does not change every frame.
     */
    ES_PROPERTY(asset = mesh)
    resource::MeshHandle mesh;

    // -------------------------------------------------------------------------
    // Geometry payload — set via mesh2d_setGeometry, streamed by MeshPlugin.
    // Deliberately un-annotated: variable-size data has no fixed ABI offset, so it
    // stays out of the EHT reflection/pointer layout (all annotated fields above
    // keep their asserted offsets because these members come last).
    // -------------------------------------------------------------------------

    /** @brief Local-space vertices (triangle list, indexed). */
    std::vector<MeshVertex2D> vertices;

    /** @brief Triangle-list indices into @ref vertices (validated on upload). */
    std::vector<u32> indices;

    /** @brief Local-space AABB of @ref vertices, recomputed on upload — cull source. */
    glm::vec2 localMin{0.0f, 0.0f};
    glm::vec2 localMax{0.0f, 0.0f};

    Mesh2D() = default;
};

}  // namespace esengine::ecs

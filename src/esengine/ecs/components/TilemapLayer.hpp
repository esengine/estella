// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TilemapLayer.hpp
 * @brief   Tilemap layer ECS component (editor-facing metadata)
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

namespace esengine::ecs {

/**
 * Grid layout of a tilemap layer. Values match tilemap::GridType 1:1 so the
 * component field maps straight to the runtime grid type. "Staggered" is the
 * staggered-isometric grid; it and Hexagonal share the stagger axis/index.
 */
ES_ENUM()
enum class TilemapOrientation : u8 {
    Orthogonal = 0,
    Isometric = 1,
    Staggered = 2,
    Hexagonal = 3,
};

/** Which axis the stagger runs along (Tiled staggeraxis). Y = rows shift, X = columns shift. */
ES_ENUM()
enum class TilemapStaggerAxis : u8 {
    Y = 0,
    X = 1,
};

/** Which lines carry the half-cell shift (Tiled staggerindex). */
ES_ENUM()
enum class TilemapStaggerIndex : u8 {
    Odd = 0,
    Even = 1,
};

/**
 * Heavy tile data (chunks, animations, per-tile properties) lives in
 * TilemapSystem's LayerData keyed by this entity. Chunks flow through
 * tilemap_exportChunks / tilemap_importChunks during scene I/O.
 */
ES_COMPONENT(renderable=visible)
struct TilemapLayer {
    ES_PROPERTY()
    glm::vec2 cellSize{32.0f, 32.0f};

    ES_PROPERTY(enum=TilemapOrientation, tooltip="Grid layout: orthogonal, isometric, staggered, or hexagonal.")
    u8 orientation{0};

    ES_PROPERTY(min=0, step=1, shown_when=orientation:Hexagonal,
                tooltip="Hexagonal side length in px (0 = a regular pointy hex = tileHeight/2). Ignored unless orientation is Hexagonal.")
    f32 hexSideLength{0.0f};

    ES_PROPERTY(enum=TilemapStaggerAxis, shown_when=orientation:Staggered|Hexagonal,
                tooltip="Stagger axis (staggered/hex): Y shifts rows, X shifts columns.")
    u8 staggerAxis{0};

    ES_PROPERTY(enum=TilemapStaggerIndex, shown_when=orientation:Staggered|Hexagonal,
                tooltip="Which lines carry the half-cell shift (staggered/hex).")
    u8 staggerIndex{0};

    ES_PROPERTY()
    glm::vec2 originOffset{0.0f, 0.0f};

    ES_PROPERTY(asset = texture)
    resource::TextureHandle tileset;

    ES_PROPERTY(min=1, step=1)
    i32 tilesetColumns{1};

    ES_PROPERTY(step=1, enum_source=sortingLayers)
    i32 renderLayer{0};

    ES_PROPERTY(animatable)
    glm::vec4 tintColor{1.0f, 1.0f, 1.0f, 1.0f};

    ES_PROPERTY(animatable, min=0, max=1, slider, tooltip="Layer transparency (0 = invisible, 1 = opaque).")
    f32 opacity{1.0f};

    ES_PROPERTY()
    glm::vec2 parallaxFactor{1.0f, 1.0f};

    ES_PROPERTY()
    bool visible{true};

    // Runtime-only; not ES_PROPERTY so it isn't serialized.
    bool needsSync{true};

    TilemapLayer() = default;
};

}  // namespace esengine::ecs

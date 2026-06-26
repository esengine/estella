// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

namespace esengine::ecs {

/**
 * @brief How a UIVisual fills its UINode box. Replaces the old UIRenderer
 *        visualType + Image imageType pair: a single draw mode,
 *        so the renderer derives the sampled UV at draw time and no frame-late
 *        Image->UIRenderer copy system is needed.
 *
 * None = invisible; SolidColor = tinted white quad; Image = textured quad
 * (uvOffset/uvScale select a sprite sub-region); NineSlice = 9-slice via
 * sliceBorder; Tiled = texture repeated by box/tileSize; Filled = texture
 * cropped to fillAmount along fillMethod/fillOrigin.
 */
ES_ENUM()
enum class UIVisualType : u8 {
    None,
    SolidColor,
    Image,
    NineSlice,
    Tiled,
    Filled
};

ES_ENUM()
enum class UIFillMethod : u8 {
    Horizontal,
    Vertical
};

ES_ENUM()
enum class UIFillOrigin : u8 {
    Left,
    Right,
    Bottom,
    Top
};

/**
 * @brief UIVisual — the single UI visual component, merging the
 *        former low-level UIRenderer (what the renderer drew) and high-level
 *        Image (Simple/Sliced/Tiled/Filled intent that used to be copied into a
 *        UIRenderer each frame). One component authored directly; UIElementPlugin
 *        reads it and computes the effective UV inline — the deferred copy is gone.
 *
 * Geometry comes from the sibling UINode (computed_size_, pivot 0.5). `uvOffset`/
 * `uvScale` are the base sub-region (identity = whole texture); Tiled/Filled
 * derive their final UV from this base at draw time.
 */
ES_COMPONENT()
struct UIVisual {
    ES_PROPERTY()
    UIVisualType visualType{UIVisualType::None};

    ES_PROPERTY(asset = texture)
    resource::TextureHandle texture;

    ES_PROPERTY(animatable)
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    // Base sub-region (identity = whole texture); Tiled/Filled build on it.
    ES_PROPERTY()
    glm::vec2 uvOffset{0.0f, 0.0f};
    ES_PROPERTY()
    glm::vec2 uvScale{1.0f, 1.0f};

    // NineSlice border override (texture metadata wins when present).
    ES_PROPERTY()
    glm::vec4 sliceBorder{0.0f};

    // Tiled: texture repeats every tileSize px of the box.
    ES_PROPERTY()
    glm::vec2 tileSize{32.0f, 32.0f};

    // Filled: crop to fillAmount [0,1] along method/origin.
    ES_PROPERTY()
    UIFillMethod fillMethod{UIFillMethod::Horizontal};
    ES_PROPERTY()
    UIFillOrigin fillOrigin{UIFillOrigin::Left};
    ES_PROPERTY(animatable)
    f32 fillAmount{1.0f};

    ES_PROPERTY(asset = material)
    u32 material{0};

    ES_PROPERTY()
    bool enabled{true};

    // Render order assigned by UIRenderOrderSystem (not serialized).
    i32 uiOrder{0};

    UIVisual() = default;
};

}  // namespace esengine::ecs

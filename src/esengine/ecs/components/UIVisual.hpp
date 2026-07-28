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

/**
 * @brief Fill mode for a Filled UIVisual. Horizontal/Vertical are linear crops
 *        along the axis; the Radial modes are an angular clockwise sweep starting
 *        from the fillOrigin edge (12/3/6/9 o'clock), where fillAmount scales the
 *        wedge from 0 to the mode's arc (90/180/360 degrees) — cooldown rings,
 *        speedometer arcs, corner meters.
 */
ES_ENUM()
enum class UIFillMethod : u8 {
    Horizontal,
    Vertical,
    Radial360,
    Radial90,
    Radial180
};

ES_ENUM()
enum class UIFillOrigin : u8 {
    Left,
    Right,
    Bottom,
    Top
};

/**
 * @brief How the texture is fitted into the node's box — CSS `object-fit`.
 *        Fill stretches to the box (the default, and what a 9-slice or a tiled
 *        visual always wants). Contain scales the image down until it fits
 *        WHOLE inside the box, letterboxing the remainder — the "don't squash
 *        my artwork" mode. Cover scales up until the box is covered and crops
 *        the overflow, so the box is filled with no distortion.
 */
ES_ENUM()
enum class UIVisualFit : u8 {
    Fill,
    Contain,
    Cover
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

    // How the texture fills the box. Ignored by NineSlice and Tiled, whose
    // whole point is to adapt to the box rather than preserve a ratio.
    ES_PROPERTY(tooltip="How the image fits its box: Fill stretches, Contain letterboxes it whole, Cover fills and crops.")
    UIVisualFit fit{UIVisualFit::Fill};

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

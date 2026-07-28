// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/core/ui-visual.ts
 * @brief   UIVisual — the single UI visual component.
 *
 * Merges the former low-level `UIRenderer` (what the renderer drew) and the
 * high-level `Image` (Simple/Sliced/Tiled/Filled intent that used to be copied
 * into a UIRenderer every frame). One component authored directly; the C++
 * `UIElementPlugin` reads it and derives the sampled UV inline (Tiled by
 * box/tileSize, Filled by fillAmount) — the deferred Image→UIRenderer copy is
 * gone. Geometry comes from the sibling {@link UINode}. Mirrors the C++
 * `UIVisual` builtin.
 */
import { defineBuiltin } from '../../ecs/component';
import type { Color, Vec2, Vec4 } from '../../types';

// Draw mode (None = invisible but render-order/hit-participating; SolidColor;
// Image with a uvOffset/uvScale sub-region; NineSlice via sliceBorder; Tiled
// every tileSize px; Filled = cropped to fillAmount along fillMethod/fillOrigin),
// the Filled fill mode (linear X/Y crops; clockwise Radial360/90/180 sweeps) and
// its anchor edge. All single-sourced from the C++ ES_ENUMs via the generated
// module; FillMethod/FillOrigin keep their public names as aliases of the C++
// UIFillMethod/UIFillOrigin.
import {
    UIVisualType,
    UIVisualFit,
    UIFillMethod as FillMethod,
    UIFillOrigin as FillOrigin,
} from '../../wasm/wasm.generated';
export { UIVisualType, UIVisualFit, FillMethod, FillOrigin };

export interface UIVisualData {
    visualType: UIVisualType;
    texture: number;
    color: Color;
    /** CSS `object-fit`: Fill stretches to the box (default), Contain
     *  letterboxes the whole image inside it, Cover fills the box and crops.
     *  Ignored by NineSlice and Tiled, which exist to adapt to the box. */
    fit: UIVisualFit;
    /** Base UV sub-region offset (identity = whole texture). */
    uvOffset: Vec2;
    /** Base UV sub-region scale (identity = whole texture). */
    uvScale: Vec2;
    /** NineSlice border (texture metadata wins when present). */
    sliceBorder: Vec4;
    /** Tiled: texture repeats every tileSize px of the box. */
    tileSize: Vec2;
    /** Filled: axis to crop along. */
    fillMethod: FillMethod;
    /** Filled: edge the fill grows from. */
    fillOrigin: FillOrigin;
    /** Filled: visible fraction [0,1]. */
    fillAmount: number;
    material: number;
    enabled: boolean;
}

export const UIVisual = defineBuiltin<UIVisualData>('UIVisual', {
    visualType: UIVisualType.None,
    texture: 0,
    color: { r: 1, g: 1, b: 1, a: 1 },
    fit: UIVisualFit.Fill,
    uvOffset: { x: 0, y: 0 },
    uvScale: { x: 1, y: 1 },
    sliceBorder: { x: 0, y: 0, z: 0, w: 0 },
    tileSize: { x: 32, y: 32 },
    fillMethod: FillMethod.Horizontal,
    fillOrigin: FillOrigin.Left,
    fillAmount: 1,
    material: 0,
    enabled: true,
});

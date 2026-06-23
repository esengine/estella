// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
import { defineBuiltin } from '../../component';
import type { Color, Vec2, Vec4 } from '../../types';

/** Draw mode (mirrors the C++ UIVisualType enum). */
export const UIVisualType = {
    /** Invisible — present only for render-order/hit participation. */
    None: 0,
    /** Tinted white quad (no texture). */
    SolidColor: 1,
    /** Textured quad; uvOffset/uvScale select a sprite sub-region. */
    Image: 2,
    /** 9-slice via sliceBorder. */
    NineSlice: 3,
    /** Texture repeated every tileSize px of the box. */
    Tiled: 4,
    /** Texture cropped to fillAmount along fillMethod/fillOrigin. */
    Filled: 5,
} as const;
export type UIVisualType = (typeof UIVisualType)[keyof typeof UIVisualType];

/** Fill axis for Filled visuals (mirrors the C++ UIFillMethod enum). */
export const FillMethod = {
    Horizontal: 0,
    Vertical: 1,
} as const;
export type FillMethod = (typeof FillMethod)[keyof typeof FillMethod];

/** Fill anchor edge for Filled visuals (mirrors the C++ UIFillOrigin enum). */
export const FillOrigin = {
    Left: 0,
    Right: 1,
    Bottom: 2,
    Top: 3,
} as const;
export type FillOrigin = (typeof FillOrigin)[keyof typeof FillOrigin];

export interface UIVisualData {
    visualType: UIVisualType;
    texture: number;
    color: Color;
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

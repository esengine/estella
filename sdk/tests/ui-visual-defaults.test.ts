// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ui-visual-defaults.test.ts — a UIVisual built with a texture and no mode shows the texture.
 *
 * The default mode is SolidColor, which ignores a texture: `visual: { texture }` drew a white box, and the picture never
 * appeared. Naming a texture without a mode now means Image; naming a mode keeps it.
 */
import { describe, it, expect } from 'vitest';
import { buildUIVisual, UIVisualType } from '../src/ui';

describe('buildUIVisual', () => {
  it('draws a texture given without a mode as an Image', () => {
    expect(buildUIVisual({ texture: 7 }).visualType).toBe(UIVisualType.Image);
  });

  it('keeps a solid colour when no texture is given', () => {
    expect(buildUIVisual({}).visualType).toBe(UIVisualType.SolidColor);
  });

  it('keeps the mode it is told, texture or not', () => {
    expect(buildUIVisual({ texture: 7, visualType: UIVisualType.NineSlice }).visualType).toBe(UIVisualType.NineSlice);
    expect(buildUIVisual({ texture: 7, visualType: UIVisualType.SolidColor }).visualType).toBe(UIVisualType.SolidColor);
  });
});

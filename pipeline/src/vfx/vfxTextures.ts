// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    vfxTextures.ts
 * @brief   The particle pictures the effect tools draw for themselves, as image recipes: white, so a layer's colour over life is
 *          the colour, and soft to the edge, so no square ever shows.
 *
 * @details Each is an `.esimage` a project keeps beside its effects and image_edit can change. A smoke puff is lumpy rather than
 *          round, so a hundred of them overlapping read as smoke and not as a stack of discs; a flame is a tongue narrower at the
 *          top; a spark is a bright core with a short glow, drawn stretched along its motion by the emitter.
 */
import type { VfxTexture } from './vfxSource';

const SIZE = 128;
const C = SIZE / 2;

/** White to clear, from the middle out, `inner` of the radius at full strength. */
const radial = (radius: number, inner = 0, at: [number, number] = [C, C]) => ({
  type: 'radial', at, radius,
  stops: [[0, '#ffffffff'], [inner, '#ffffffff'], [0.55 + inner * 0.3, '#ffffff66'], [1, '#ffffff00']],
});

export function vfxTextureSource(name: VfxTexture): Record<string, unknown> {
  switch (name) {
    case 'glow':
      return { size: SIZE, layers: [{ id: 'glow', shape: 'circle', at: [C, C], radius: C, fill: radial(C, 0) }] };
    case 'soft':
      return { size: SIZE, layers: [{ id: 'soft', shape: 'circle', at: [C, C], radius: C, fill: radial(C, 0.35) }] };
    case 'spark':
      return {
        size: SIZE, layers: [
          { id: 'halo', shape: 'circle', at: [C, C], radius: C, fill: { type: 'radial', at: [C, C], radius: C, stops: [[0, '#ffffff99'], [0.3, '#ffffff33'], [1, '#ffffff00']] } },
          { id: 'core', shape: 'circle', at: [C, C], radius: 10, fill: '#ffffffff', blur: 4 },
        ],
      };
    case 'ring':
      return { size: SIZE, layers: [{ id: 'ring', shape: 'ring', at: [C, C], radius: 52, inner: 40, fill: '#ffffffff', blur: 6 }] };
    case 'flame':
      return {
        size: SIZE, layers: [
          { id: 'tongue', shape: 'path', d: `M ${C} 6 C ${C + 16} 38, ${C + 40} 70, ${C + 34} 96 C ${C + 28} 118, ${C - 28} 118, ${C - 34} 96 C ${C - 40} 70, ${C - 16} 38, ${C} 6 Z`, fill: { type: 'radial', at: [C, 92], radius: 70, stops: [[0, '#ffffffff'], [0.5, '#ffffffcc'], [1, '#ffffff00']] }, blur: 6 },
        ],
      };
    case 'smoke':
      return {
        size: SIZE, layers: [
          // Lumps of different sizes off the middle, so the outline is not a circle.
          ...([[64, 64, 40], [44, 56, 26], [86, 58, 24], [58, 84, 24], [80, 82, 22], [64, 40, 22]] as const).map(([x, y, r], i) => ({
            id: `puff${i}`, shape: 'circle', at: [x, y], radius: r, fill: radial(r, 0.1, [x, y]), blur: 3,
          })),
          // A little grain inside, which is what a puff of smoke has and a soft disc has not.
          { id: 'grain', shape: 'circle', at: [C, C], radius: 52, fill: { type: 'noise', scale: 18, octaves: 3, seed: 5, stops: [[0, '#00000000'], [1, '#00000055']] }, blend: 'multiply', blur: 8 },
        ],
      };
  }
}

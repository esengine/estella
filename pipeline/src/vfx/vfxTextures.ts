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
/** How far anything reaches from the middle: short of the edge, so the edge is fully clear (a faint veil there sums to a square). */
const R = C - 6;

/** White to clear, from the middle out, `inner` of the radius at full strength. */
const radial = (radius: number, inner = 0, at: [number, number] = [C, C]) => ({
  type: 'radial', at, radius,
  stops: [[0, '#ffffffff'], [inner, '#ffffffff'], [0.55 + inner * 0.3, '#ffffff66'], [1, '#ffffff00']],
});

/** A seeded random in [0, 1): the same sheet every time it is drawn. */
function seeded(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

/** Frames of a sheet, `columns` by `rows`, each drawn by `frame(k, t)` in its own cell of CELL pixels, t from 0 to 1 over the sheet. */
const CELL = 128, GRID = 4;
function sheet(frame: (k: number, t: number) => Record<string, unknown>[]): Record<string, unknown> {
  const n = GRID * GRID, layers: Record<string, unknown>[] = [];
  for (let k = 0; k < n; k++) {
    // Ids are the picture's, not the frame's: each frame's layers carry its number.
    const inner = frame(k, k / (n - 1)).map((l) => ({ ...l, id: `f${k}-${String(l.id)}` }));
    layers.push({ id: `f${k}`, shape: 'group', transform: { translate: [(k % GRID) * CELL, Math.floor(k / GRID) * CELL] }, layers: inner });
  }
  return { size: [CELL * GRID, CELL * GRID], layers };
}

const puff = (id: string, x: number, y: number, r: number, alpha: number, inner = 0.15) => ({
  id, shape: 'circle', at: [x, y], radius: r, blur: Math.max(1, r * 0.12),
  fill: { type: 'radial', at: [x, y], radius: r, stops: [[0, `#ffffff${hex2(alpha)}`], [inner, `#ffffff${hex2(alpha)}`], [0.65, `#ffffff${hex2(alpha * 0.7)}`], [1, '#ffffff00']] },
});
const hex2 = (a: number): string => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

/** A tongue of flame licking up: its tip sways and splits, a second lick beside it comes and goes. Loops: the last frame leads into the first. */
function flameSheet(): Record<string, unknown> {
  const C = CELL / 2;
  return sheet((k) => {
    const p = (k / (GRID * GRID)) * Math.PI * 2;
    const sway = Math.sin(p) * 9 + Math.sin(p * 3 + 1) * 4, lean = Math.sin(p * 2 + 0.5) * 6;
    const tipY = 10 + (1 + Math.sin(p * 2)) * 6, w = 30 + Math.sin(p * 3) * 4;
    // A blur's tail reaches about three times its size: the foot stays that far off the cell's bottom.
    const tongue = `M ${C + sway} ${tipY + 6} C ${C + sway * 0.6 + 14} ${38}, ${C + lean + w} ${64}, ${C + w - 4} ${86} C ${C + w - 8} ${102}, ${C - w + 8} ${102}, ${C - w + 4} ${86} C ${C + lean - w} ${64}, ${C + sway * 0.6 - 14} ${38}, ${C + sway} ${tipY + 6} Z`;
    const side = 0.5 + 0.5 * Math.sin(p * 2 + 2), sx = C - 18 + Math.sin(p) * 4;
    return [
      { id: 'tongue', shape: 'path', d: tongue, blur: 5, fill: { type: 'radial', at: [C, 88], radius: 74, stops: [[0, '#ffffffff'], [0.45, '#ffffffcc'], [1, '#ffffff00']] } },
      { id: 'lick', shape: 'path', d: `M ${sx - 4} ${44 - side * 10} C ${sx + 6} 60, ${sx + 12} 78, ${sx + 8} 92 C ${sx} 100, ${sx - 12} 96, ${sx - 10} 86 C ${sx - 10} 72, ${sx - 8} 58, ${sx - 4} ${44 - side * 10} Z`, blur: 4, opacity: 0.35 + side * 0.5, fill: '#ffffffcc' },
      { id: 'core', shape: 'ellipse', at: [C + lean * 0.3, 86], radii: [16, 12], blur: 6, fill: '#ffffffff' },
    ];
  });
}

/** A puff of smoke over its life: small and dense, then growing, thinning and coming apart into lumps. */
function smokeSheet(): Record<string, unknown> {
  const C = CELL / 2, rand = seeded(11);
  const lumps = Array.from({ length: 7 }, () => ({ a: rand() * Math.PI * 2, d: 0.25 + rand() * 0.5, r: 0.45 + rand() * 0.4, drift: 0.6 + rand() * 0.8 }));
  return sheet((_k, t) => {
    // The particle grows over its life already: the sheet only opens up a little, and fills the cell from the first frame.
    const grow = 0.75 + 0.25 * t, alpha = 1 - 0.45 * t;
    return lumps.map((l, i) => {
      const spread = (l.d + t * 0.3 * l.drift) * 22 * grow, angle = l.a + t * 0.6;
      return puff(`l${i}`, C + Math.cos(angle) * spread, C + Math.sin(angle) * spread * 0.8, 26 * l.r * grow, alpha * (0.8 + 0.2 * l.r), 0.15);
    });
  });
}

/** A fireball over its life: a hot dense core, billowing out, the core going and the lumps parting at the end. */
function fireballSheet(): Record<string, unknown> {
  const C = CELL / 2, rand = seeded(23);
  const lumps = Array.from({ length: 9 }, () => ({ a: rand() * Math.PI * 2, d: 0.2 + rand() * 0.6, r: 0.35 + rand() * 0.35 }));
  return sheet((_k, t) => {
    const grow = 0.7 + 0.3 * Math.sqrt(t), core = Math.max(0, 1 - t * 1.4);
    return [
      ...lumps.map((l, i) => {
        const spread = l.d * 24 * grow * (1 + t * 0.45);
        return puff(`b${i}`, C + Math.cos(l.a + t) * spread, C + Math.sin(l.a + t) * spread, 26 * l.r * grow, 1 - 0.35 * t, 0.25);
      }),
      ...(core > 0 ? [puff('core', C, C, 30 * grow, core, 0.4)] : []),
    ];
  });
}

/** How a sheet plays: its frames and whether it loops (a flame) or runs once over each particle's life (a puff). */
export const VFX_SHEETS: Partial<Record<VfxTexture, { columns: number; rows: number; loop: boolean; fps?: number }>> = {
  'flame-sheet': { columns: GRID, rows: GRID, loop: true, fps: 20 },
  'smoke-sheet': { columns: GRID, rows: GRID, loop: false },
  'fireball-sheet': { columns: GRID, rows: GRID, loop: false },
};

export function vfxTextureSource(name: VfxTexture): Record<string, unknown> {
  switch (name) {
    case 'flame-sheet': return flameSheet();
    case 'smoke-sheet': return smokeSheet();
    case 'fireball-sheet': return fireballSheet();
    case 'glow':
      return { size: SIZE, layers: [{ id: 'glow', shape: 'circle', at: [C, C], radius: R, fill: radial(R, 0) }] };
    case 'soft':
      return { size: SIZE, layers: [{ id: 'soft', shape: 'circle', at: [C, C], radius: R, fill: radial(R, 0.35) }] };
    case 'spark':
      return {
        size: SIZE, layers: [
          { id: 'halo', shape: 'circle', at: [C, C], radius: R, fill: { type: 'radial', at: [C, C], radius: R, stops: [[0, '#ffffff99'], [0.3, '#ffffff33'], [1, '#ffffff00']] } },
          { id: 'core', shape: 'circle', at: [C, C], radius: 10, fill: '#ffffffff', blur: 4 },
        ],
      };
    case 'ring':
      return { size: SIZE, layers: [{ id: 'ring', shape: 'ring', at: [C, C], radius: 46, inner: 36, fill: '#ffffffff', blur: 5 }] };
    case 'flame':
      return {
        size: SIZE, layers: [
          { id: 'tongue', shape: 'path', d: `M ${C} 14 C ${C + 14} 42, ${C + 36} 70, ${C + 30} 94 C ${C + 25} 112, ${C - 25} 112, ${C - 30} 94 C ${C - 36} 70, ${C - 14} 42, ${C} 14 Z`, fill: { type: 'radial', at: [C, 92], radius: 70, stops: [[0, '#ffffffff'], [0.5, '#ffffffcc'], [1, '#ffffff00']] }, blur: 6 },
        ],
      };
    case 'smoke':
      return {
        size: SIZE, layers: [
          // Lumps of different sizes off the middle, so the outline is not a circle.
          ...([[64, 64, 36], [46, 58, 22], [82, 60, 21], [58, 80, 21], [78, 78, 19], [64, 44, 19]] as const).map(([x, y, r], i) => ({
            id: `puff${i}`, shape: 'circle', at: [x, y], radius: r, fill: radial(r, 0.1, [x, y]), blur: 3,
          })),
          // A little grain inside, which is what a puff of smoke has and a soft disc has not.
          { id: 'grain', shape: 'circle', at: [C, C], radius: 44, fill: { type: 'noise', scale: 18, octaves: 3, seed: 5, stops: [[0, '#00000000'], [1, '#00000055']] }, blend: 'multiply', clip: 'puff0' },
        ],
      };
  }
}

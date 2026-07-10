// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tileStampGhost.ts
 * @brief Turns the active brush {@link TileStamp} into a set of translucent atlas-tile
 *        slices for the viewport's WYSIWYG hover ghost — you see the ACTUAL tiles (and
 *        their flip/rotate orientation) that will land, not a blank box. Pure geometry
 *        over the palette's {@link AtlasInfo} (the single source of atlas layout,
 *        published by the painter), so the viewport never re-loads the atlas image.
 *
 * Each cell is laid out at NATURAL tile pixels (left/top in tile units × tileW/H); the
 * viewport scales the whole container to the on-screen footprint each frame, so only one
 * transform updates per frame while the slices themselves are built once per stamp.
 */
import { tileIdOf, tileFlagsOf, type TileStamp } from 'esengine';
import type { CSSProperties } from 'react';
import type { AtlasInfo } from '@/store/tilemapPaintStore';

export interface GhostCell {
  /** Natural-pixel style (position + atlas slice + orientation) for one ghost tile. */
  style: CSSProperties;
}

// The 8 D4 orientations of the Tiled flip bits as a CSS 2×2 matrix (a,b,c,d), applied
// about the tile centre. Identity/H/V/HV are exact; the diagonal set follows Tiled's
// main-diagonal transpose convention (D swaps x/y, then H/V) — a preview, so a rare
// mismatch on a rotated tile is cosmetic, not a data error.
function orientationMatrix(flipH: boolean, flipV: boolean, flipD: boolean): string {
  const sH = flipH ? -1 : 1;
  const sV = flipV ? -1 : 1;
  if (!flipD) return `matrix(${sH}, 0, 0, ${sV}, 0, 0)`;
  // D transposes ([[0,1],[1,0]]) then H/V flip → (a,b,c,d) = (0, sH, sV, 0).
  return `matrix(0, ${sH}, ${sV}, 0, 0, 0)`;
}

/**
 * Build the ghost tile slices for `stamp` against the active tileset `atlas`, or null
 * when there's nothing to draw (no atlas, empty stamp, or every cell is out of the
 * active tileset's id range — e.g. a stamp lifted from another tileset).
 */
export function buildStampGhost(stamp: TileStamp, atlas: AtlasInfo | null): GhostCell[] | null {
  if (!atlas || atlas.cols <= 0) return null;
  const { url, cols, tileW, tileH, margin, spacing, firstId } = atlas;
  const cells: GhostCell[] = [];
  for (let dy = 0; dy < stamp.h; dy++) {
    for (let dx = 0; dx < stamp.w; dx++) {
      const raw = stamp.cells[dy * stamp.w + dx];
      const id = tileIdOf(raw);
      if (id === 0) continue; // sparse — empty cells paint nothing, so show nothing
      const local = id - firstId;
      if (local < 0) continue; // belongs to another tileset — no atlas slice here
      const col = local % cols;
      const row = Math.floor(local / cols);
      const f = tileFlagsOf(raw);
      cells.push({
        style: {
          position: 'absolute',
          left: dx * tileW,
          top: dy * tileH,
          width: tileW,
          height: tileH,
          backgroundImage: `url("${url}")`,
          backgroundPosition: `-${margin + col * (tileW + spacing)}px -${margin + row * (tileH + spacing)}px`,
          backgroundRepeat: 'no-repeat',
          transform: orientationMatrix(f.flipH, f.flipV, f.flipD),
          imageRendering: 'pixelated',
        },
      });
    }
  }
  return cells.length > 0 ? cells : null;
}

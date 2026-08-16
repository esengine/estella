// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tileMath.ts
 * @brief   Shared tileset-atlas grid math + terrain palette — used by both the
 *          Tilemap painter and the Tileset editor, which each carried a verbatim
 *          copy before.
 */
import { atlasCells } from 'esengine';

/** Columns an atlas grid fits. At least 1: a palette with no column has no cell
 *  to focus, and an atlas too small for one tile still shows the tile it has. */
export function colsFor(width: number, tileW: number, margin: number, spacing: number): number {
  return Math.max(1, atlasCells(width, margin, tileW, spacing));
}

/** Rows an atlas grid fits (0 when the image is shorter than a single tile). */
export function rowsFor(height: number, tileH: number, margin: number, spacing: number): number {
  return atlasCells(height, margin, tileH, spacing);
}

/** Swatch color per terrain/autotile set — set identity in the tileset editor's
 *  peering overlay and the painter's terrain chips. Category colors (like other
 *  data-viz palettes), not theme surfaces, so kept as literals. */
export const TERRAIN_COLORS = ['#4caf50', '#d6884c', '#4c8fd6', '#b14cd6', '#d6c64c', '#d64c6e'];

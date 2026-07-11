// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tileMath.ts
 * @brief   Shared tileset-atlas grid math + terrain palette — used by both the
 *          Tilemap painter and the Tileset editor, which each carried a verbatim
 *          copy before.
 */

/** Columns an atlas grid fits: floor over the tile stride, honoring the outer
 *  margin and inter-tile spacing. At least 1. */
export function colsFor(width: number, tileW: number, margin: number, spacing: number): number {
  const stride = tileW + spacing;
  return stride > 0 ? Math.max(1, Math.floor((width - margin + spacing) / stride)) : 1;
}

/** Rows an atlas grid fits (0 when the image is shorter than a single tile). */
export function rowsFor(height: number, tileH: number, margin: number, spacing: number): number {
  const stride = tileH + spacing;
  return stride > 0 ? Math.max(0, Math.floor((height - margin + spacing) / stride)) : 0;
}

/** Swatch color per terrain/autotile set — set identity in the tileset editor's
 *  peering overlay and the painter's terrain chips. Category colors (like other
 *  data-viz palettes), not theme surfaces, so kept as literals. */
export const TERRAIN_COLORS = ['#4caf50', '#d6884c', '#4c8fd6', '#b14cd6', '#d6c64c', '#d64c6e'];

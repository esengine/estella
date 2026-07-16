// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  slopePresets.ts
 * @brief Canned per-tile collision polygons — one click stamps a slope / half-tile
 *        instead of hand-placing vertices. Points are NORMALIZED [0,1] in the atlas's
 *        own space (origin top-left, y-down), so they scale to any tile size; the
 *        tileset editor multiplies by (tileWidth, tileHeight) before committing the
 *        tile-local-pixel polygon the .estileset stores (see TilesetCommands.setTilePolygon).
 */

import type { MsgKey } from '@/i18n';

export interface SlopePreset {
    id: string;
    /** i18n key for the button label / tooltip. */
    labelKey: MsgKey;
    /** Polygon vertices, normalized [0,1], y-down (matching the atlas). */
    points: [number, number][];
}

// The starter set: two 45° floor ramps + four half-tiles. Covers the overwhelming
// majority of platformer tile collision that a plain box can't express; freeform
// polygon (the modal editor) handles the rest.
export const SLOPE_PRESETS: SlopePreset[] = [
    // Floor ramps — solid BELOW the diagonal surface.
    { id: 'rampR', labelKey: 'tile.slope.rampR', points: [[0, 1], [1, 1], [1, 0]] }, // rises left→right
    { id: 'rampL', labelKey: 'tile.slope.rampL', points: [[0, 0], [0, 1], [1, 1]] }, // rises right→left
    // Half tiles.
    { id: 'halfBottom', labelKey: 'tile.slope.halfBottom', points: [[0, 0.5], [1, 0.5], [1, 1], [0, 1]] },
    { id: 'halfTop', labelKey: 'tile.slope.halfTop', points: [[0, 0], [1, 0], [1, 0.5], [0, 0.5]] },
    { id: 'halfLeft', labelKey: 'tile.slope.halfLeft', points: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] },
    { id: 'halfRight', labelKey: 'tile.slope.halfRight', points: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] },
];

/** A preset's vertices in tile-local pixels for the given tile size (what .estileset stores). */
export function presetPointsPx(preset: SlopePreset, tileW: number, tileH: number): [number, number][] {
    return preset.points.map(([x, y]) => [Math.round(x * tileW), Math.round(y * tileH)] as [number, number]);
}

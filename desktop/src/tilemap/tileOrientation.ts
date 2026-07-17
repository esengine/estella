// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tileOrientation.ts
 * @brief Shared editor vocabulary for tilemap orientation — the i18n'd option lists
 *        for the New-Tilemap dialog + inspector, over the numeric values that match
 *        the C++ TilemapOrientation / TilemapStaggerAxis / TilemapStaggerIndex enums.
 *        Geometry predicates (usesStagger / isHexOrientation) come from esengine so
 *        the editor and runtime agree on which layouts read the stagger/hex fields.
 */
import { TileOrientation } from 'esengine';
import type { SegmentedOption } from '@/components/Segmented';
import { t } from '@/i18n';

export { TileOrientation, usesStagger, isHexOrientation } from 'esengine';

/** staggerAxis field values (match C++ TilemapStaggerAxis). */
export const STAGGER_AXIS_Y = 0;
export const STAGGER_AXIS_X = 1;
/** staggerIndex field values (match C++ TilemapStaggerIndex). */
export const STAGGER_INDEX_ODD = 0;
export const STAGGER_INDEX_EVEN = 1;

/** Orientation segments, in the C++ enum order (value = the numeric field). */
export function orientationOptions(): SegmentedOption<string>[] {
  return [
    { value: String(TileOrientation.Orthogonal), label: t('tile.orient.orthogonal') },
    { value: String(TileOrientation.Isometric), label: t('tile.orient.isometric') },
    { value: String(TileOrientation.Staggered), label: t('tile.orient.staggered') },
    { value: String(TileOrientation.Hexagonal), label: t('tile.orient.hexagonal') },
  ];
}

export function staggerAxisOptions(): SegmentedOption<string>[] {
  return [
    { value: String(STAGGER_AXIS_Y), label: t('tile.orient.axisY') },
    { value: String(STAGGER_AXIS_X), label: t('tile.orient.axisX') },
  ];
}

export function staggerIndexOptions(): SegmentedOption<string>[] {
  return [
    { value: String(STAGGER_INDEX_ODD), label: t('tile.orient.odd') },
    { value: String(STAGGER_INDEX_EVEN), label: t('tile.orient.even') },
  ];
}

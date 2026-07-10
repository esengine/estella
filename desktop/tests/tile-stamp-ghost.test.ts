// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  buildStampGhost — the WYSIWYG brush ghost geometry. Maps a TileStamp's cells to
 *        atlas slices (background-position) against the active tileset's AtlasInfo, honours
 *        margin/spacing + the global firstId, drops out-of-tileset + empty cells, and emits
 *        the flip/rotate orientation matrix. Pure, so it's fully unit-testable.
 */
import { describe, it, expect } from 'vitest';
import { encodeTile, singleStamp, flipStampH, flipStampV } from 'esengine';
import { buildStampGhost } from '@/tools/tileStampGhost';
import type { AtlasInfo } from '@/store/tilemapPaintStore';

const atlas = (over: Partial<AtlasInfo> = {}): AtlasInfo => ({
  url: 'estella://atlas.png', cols: 4, tileW: 16, tileH: 16, margin: 0, spacing: 0, firstId: 1, ...over,
});

describe('buildStampGhost', () => {
  it('returns null with no atlas or an empty stamp', () => {
    expect(buildStampGhost(singleStamp(encodeTile(1)), null)).toBeNull();
    expect(buildStampGhost(singleStamp(encodeTile(0)), atlas())).toBeNull();
  });

  it('slices a single tile by its column/row (firstId-relative)', () => {
    const cells = buildStampGhost(singleStamp(encodeTile(6)), atlas())!; // local 5 → col 1, row 1
    expect(cells).toHaveLength(1);
    expect(cells[0].style).toMatchObject({ left: 0, top: 0, width: 16, height: 16 });
    expect(cells[0].style.backgroundPosition).toBe('-16px -16px');
    expect(cells[0].style.transform).toBe('matrix(1, 0, 0, 1, 0, 0)'); // no flip
  });

  it('accounts for margin + spacing in the slice offset', () => {
    const cells = buildStampGhost(singleStamp(encodeTile(2)), atlas({ margin: 1, spacing: 2 }))!; // col 1
    expect(cells[0].style.backgroundPosition).toBe('-19px -1px'); // 1 + 1*(16+2) = 19
  });

  it('lays multi-tile stamps at their grid offsets', () => {
    const cells = buildStampGhost({ w: 2, h: 1, cells: [encodeTile(1), encodeTile(2)] }, atlas())!;
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.style.left)).toEqual([0, 16]);
  });

  it('drops cells outside the active tileset id range', () => {
    // firstId 10 → tile id 1 is another tileset's tile, so no slice here.
    expect(buildStampGhost(singleStamp(encodeTile(1)), atlas({ firstId: 10 }))).toBeNull();
  });

  it('emits the flip orientation matrix', () => {
    const h = buildStampGhost(flipStampH(singleStamp(encodeTile(1))), atlas())!;
    expect(h[0].style.transform).toBe('matrix(-1, 0, 0, 1, 0, 0)');
    const v = buildStampGhost(flipStampV(singleStamp(encodeTile(1))), atlas())!;
    expect(v[0].style.transform).toBe('matrix(1, 0, 0, -1, 0, 0)');
  });
});

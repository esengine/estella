// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { createTilemapAPI } from '../src/tilemap/tilemapAPI';
import type { EngineApi } from '../src/ecs/bridge/engineApi';
import { tileCellCenter } from '../src/tilemap/tileGeometry';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('rotated tile grid coordinate conversion', () => {
  let core: ESEngineModule;
  beforeAll(async () => { core = await loadWasmModule(); });

  it.each([0, 1, 2, 3])('keeps layout %s cell positions at a distant unrotated origin', orientation => {
    core.setActiveContext(null);
    const tiles = createTilemapAPI(core as EngineApi);
    tiles.initInfiniteLayer(10, 16, 24);
    tiles.setGridType(10, orientation);
    tiles.setHexParams(10, 6, true, false);
    const originX = 2 ** 28 + 3.5, originY = -(2 ** 28) + 5.25;
    const grid = { orientation, tileWidth: 16, tileHeight: 24, hexSideLength: 6, staggerAxisX: true };
    try {
      for (const [x, y] of [[1, 0], [-2, 3], [64, -5]]) {
        const anchor = tiles.tileToWorld(10, x, y, 0, 0);
        expect(tiles.tileToWorld(10, x, y, originX, originY)).toEqual({ x: originX + anchor.x, y: originY + anchor.y });
        const center = tileCellCenter(grid, x, y);
        expect(tiles.worldToTile(10, originX + center.x, originY + center.y, originX, originY))
          .toEqual({ x, y });
      }
    } finally { core.tilemap_destroyLayer!(10); }
  });

  it('does not translate the missing-layer result', () => {
    core.setActiveContext(null);
    const tiles = createTilemapAPI(core as EngineApi);
    expect(tiles.tileToWorld(10, 1, 1, 500, 600)).toEqual({ x: 0, y: 0 });
    expect(tiles.tileToWorld(10, 1, 1, 500, 600, 1)).toEqual({ x: 0, y: 0 });
  });

  it.each([0, 1, 2, 3])('preserves layout %s anchors and inverse coordinates under world rotation', orientation => {
    core.setActiveContext(null);
    const tiles = createTilemapAPI(core as EngineApi);
    tiles.initInfiniteLayer(10, 16, 24); tiles.setGridType(10, orientation); tiles.setHexParams(10, 6, true, false);
    try {
      for (const rotation of [0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.37]) {
        for (const [x, y] of [[0, 0], [64, 2], [-33, -17]]) {
          const local = tileCellCenter({ orientation, tileWidth: 16, tileHeight: 24,
            hexSideLength: 6, staggerAxisX: true, staggerIndexEven: false }, x, y);
          const anchor = orientation === 1 ? local : { x: local.x - 8, y: local.y + 12 };
          const expected = { x: 20 + Math.cos(rotation) * anchor.x - Math.sin(rotation) * anchor.y,
            y: 30 + Math.sin(rotation) * anchor.x + Math.cos(rotation) * anchor.y };
          const point = tiles.tileToWorld(10, x, y, 20, 30, rotation);
          expect(point.x).toBeCloseTo(expected.x, 3); expect(point.y).toBeCloseTo(expected.y, 3);
          const center = { x: 20 + Math.cos(rotation) * local.x - Math.sin(rotation) * local.y,
            y: 30 + Math.sin(rotation) * local.x + Math.cos(rotation) * local.y };
          expect(tiles.worldToTile(10, center.x, center.y, 20, 30, rotation))
            .toEqual(tiles.worldToTile(10, 20 + local.x, 30 + local.y, 20, 30));
        }
      }
    } finally { core.tilemap_destroyLayer!(10); }
  });
});

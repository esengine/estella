// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { createTilemapAPI } from '../src/tilemap/tilemapAPI';

describe.skipIf(!HAS_WASM)('bounded tile chunk readback', () => {
  let core: ESEngineModule;
  beforeAll(async () => { core = await loadWasmModule(); });
  it('copies negative coordinates, revisions and exactly one chunk of cells', () => {
    core.setActiveContext(null); core.tilemap_initInfinite!(10, 16, 16);
    const ptr = core._malloc(1024);
    try {
      core.tilemap_setTile!(10, -1, -1, 0x6001); core.tilemap_setTile!(10, 16, 0, 2);
      expect(core.tilemap_readChunkIndex!(10, 0, 0)).toBe(2);
      core.HEAPU8.fill(0xa5, ptr, ptr + 1024);
      expect(core.tilemap_readChunkIndex!(10, ptr, 1)).toBe(2);
      expect(core.HEAPU8.slice(ptr, ptr + 24)).toEqual(new Uint8Array(24).fill(0xa5));
      expect(core.tilemap_readChunkIndex!(10, ptr, 2)).toBe(2);
      const rows = () => {
        const data = new DataView(core.HEAPU8.buffer, ptr, 24), result = new Map<string, number>();
        for (let i = 0; i < 2; i++) result.set(`${data.getInt32(i * 12, true)},${data.getInt32(i * 12 + 4, true)}`, data.getUint32(i * 12 + 8, true));
        return result;
      };
      const before = rows(); expect([...before.keys()].sort()).toEqual(['-1,-1', '1,0']);
      expect(core.HEAPU8[ptr + 24]).toBe(0xa5);
      expect(core.tilemap_readChunkTiles!(10, -1, -1, ptr + 32, 255)).toBe(false);
      expect(core.HEAPU8[ptr + 32]).toBe(0xa5);
      expect(core.tilemap_readChunkTiles!(10, -1, -1, ptr + 32, 256)).toBe(true);
      const cells = new Uint16Array(core.HEAPU8.buffer, ptr + 32, 256);
      expect(cells[255]).toBe(0x6001); expect(cells.slice(0, 255)).toEqual(new Uint16Array(255));
      expect(core.HEAPU8[ptr + 544]).toBe(0xa5);
      core.tilemap_setTile!(10, -1, -1, 3); core.tilemap_readChunkIndex!(10, ptr, 2);
      expect(rows().get('-1,-1')).toBeGreaterThan(before.get('-1,-1')!);
      expect(rows().get('1,0')).toBe(before.get('1,0'));
      expect(core.tilemap_readChunkTiles!(10, 99, 99, ptr, 256)).toBe(false);
      core.tilemap_destroyLayer!(10);
      expect(core.tilemap_readChunkIndex!(10, 0, 0)).toBe(0);
      expect(core.tilemap_readChunkTiles!(10, -1, -1, ptr, 256)).toBe(false);
    } finally { core._free(ptr); core.tilemap_destroyLayer!(10); }
  });

  it('rejects null and out-of-heap output buffers', () => {
    core.setActiveContext(null); core.tilemap_initInfinite!(10, 16, 16); core.tilemap_setTile!(10, 0, 0, 1);
    try {
      expect(core.tilemap_readChunkIndex!(10, 0, 1)).toBe(0);
      expect(core.tilemap_readChunkIndex!(10, core.HEAPU8.length - 4, 1)).toBe(0);
      expect(core.tilemap_readChunkTiles!(10, 0, 0, 0, 256)).toBe(false);
      expect(core.tilemap_readChunkTiles!(10, 0, 0, core.HEAPU8.length - 4, 256)).toBe(false);
      expect(core.tilemap_getTile!(10, 0, 0)).toBe(1);
    } finally { core.tilemap_destroyLayer!(10); }
  });

  it('keeps invalid SDK coordinates from aliasing valid cells at the integer boundaries', () => {
    core.setActiveContext(null);
    const tiles = createTilemapAPI(core);
    tiles.initInfiniteLayer(10, 16, 16);
    const min = -0x80000000, max = 0x7fffffff;
    try {
      tiles.setTile(10, min, 0, 1);
      tiles.setTile(10, max, 0, 2);
      tiles.setTile(10, max + 1, 0, 3);
      tiles.fillRect(10, min - 1, 0, 1, 1, 4);
      tiles.flipTile(10, max + 1, 0, true, false, false);
      tiles.rotateTile(10, min - 1, 0, 90);
      tiles.setTile(10, 0.5, 0, 5);
      expect(tiles.getTile(10, min, 0)).toBe(1);
      expect(tiles.getTile(10, max, 0)).toBe(2);
      expect(tiles.getTile(10, 0, 0)).toBe(0);
      expect(tiles.getTile(10, max + 1, 0)).toBe(0);
      expect(tiles.getTile(10, min - 1, 0)).toBe(0);
    } finally { tiles.destroyLayer(10); }
  });
});

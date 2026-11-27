// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { createTilemapAPI } from '../src/tilemap/tilemapAPI';
import { CHUNK_SIZE, decodeTilemapChunks } from '../src/tilemap/chunkCodec';

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

  it('rejects chunk coordinates that would be truncated by the bindings', () => {
    core.setActiveContext(null);
    const tiles = createTilemapAPI(core);
    tiles.initInfiniteLayer(10, 16, 16);
    try {
      tiles.setChunkTiles(10, 0, 0, Uint16Array.of(3), 1, 1);
      tiles.setChunkTiles(10, 0x100000000, 0, Uint16Array.of(7), 1, 1);
      tiles.removeChunk(10, 0, -0x100000000);
      expect(tiles.getTile(10, 0, 0)).toBe(3);
    } finally { tiles.destroyLayer(10); }
  });

  it('imports only cells within an existing finite layer', () => {
    core.setActiveContext(null);
    const tiles = createTilemapAPI(core);
    tiles.initInfiniteLayer(10, 16, 16);
    tiles.initLayer(11, 2, 2, 16, 16);
    try {
      tiles.setTile(10, 0, 0, 0x6004);
      tiles.setTile(10, 2, 0, 5);
      tiles.setTile(10, -1, 0, 6);
      tiles.setTile(11, 1, 1, 7);

      expect(tiles.importChunks(11, tiles.exportChunks(10))).toBe(true);
      const chunks = decodeTilemapChunks(tiles.exportChunks(11));
      expect(chunks).toHaveLength(1);
      expect(chunks[0].tiles.filter(word => word !== 0)).toEqual(Uint16Array.of(0x6004));
      expect(tiles.getTile(11, 0, 0)).toBe(0x6004);
    } finally {
      tiles.destroyLayer(10);
      tiles.destroyLayer(11);
    }
  });

  it('clears flat tile layers with an empty buffer and preserves the layer identity', () => {
    core.setActiveContext(null);
    const tiles = createTilemapAPI(core);
    tiles.initLayer(10, 19, 17, 16, 16);
    try {
      const generation = tiles.getGeneration(10);
      tiles.setTile(10, 0, 0, 3);
      tiles.setTile(10, 18, 16, 0x6004);
      const revision = tiles.getEditRevision(10)!;
      expect(core.tilemap_readChunkIndex!(10, 0, 0)).toBe(2);

      core.tilemap_setTiles!(10, 0, 0);
      expect(core.tilemap_readChunkIndex!(10, 0, 0)).toBe(0);
      expect(tiles.getGeneration(10)).toBe(generation);
      expect(tiles.getEditRevision(10)).toBe(revision + 1);

      tiles.setTiles(10, Uint16Array.of(0x6007));
      expect(tiles.getTile(10, 0, 0)).toBe(0x6007);
      expect(tiles.getTile(10, 18, 16)).toBe(0);
      tiles.setTiles(10, new Uint16Array(0));
      const cleared = tiles.getEditRevision(10);
      expect(tiles.getTile(10, 0, 0)).toBe(0);
      expect(core.tilemap_readChunkIndex!(10, 0, 0)).toBe(0);
      tiles.setTiles(10, new Uint16Array(0));
      expect(tiles.getEditRevision(10)).toBe(cleared);
      expect(tiles.getGeneration(10)).toBe(generation);
    } finally { tiles.destroyLayer(10); }
  });

  it('exports identical chunk data in row order regardless of edit history', () => {
    core.setActiveContext(null);
    const tiles = createTilemapAPI(core);
    const cells = [[32, -1, 2], [0, 17, 0x6003], [-1, -1, 4], [-1, 0, 5]] as const;
    tiles.initInfiniteLayer(10, 16, 16);
    tiles.initInfiniteLayer(11, 16, 16);
    try {
      for (const [x, y, word] of cells) tiles.setTile(10, x, y, word);
      for (const [x, y, word] of [...cells].reverse()) tiles.setTile(11, x, y, word);
      tiles.setTile(11, 128, 64, 7);
      tiles.setTile(11, 128, 64, 0);

      const blob = tiles.exportChunks(10);
      expect(tiles.exportChunks(11)).toBe(blob);
      expect(decodeTilemapChunks(blob).map(({ x, y }) => [x, y])).toEqual([[-1, -1], [2, -1], [-1, 0], [0, 1]]);
      expect(tiles.importChunks(11, blob)).toBe(true);
      expect(tiles.exportChunks(11)).toBe(blob);
      for (const [x, y, word] of cells) expect(tiles.getTile(11, x, y)).toBe(word);
    } finally {
      tiles.destroyLayer(10);
      tiles.destroyLayer(11);
    }
  });

  it('keeps canonical Base64url padding for empty, one-chunk, and two-chunk maps', () => {
    core.setActiveContext(null);
    const tiles = createTilemapAPI(core);
    tiles.initInfiniteLayer(10, 16, 16);
    try {
      for (const [count, padding] of [[0, 1], [1, 0], [2, 2]] as const) {
        if (count > 0) tiles.setTile(10, -CHUNK_SIZE * count, -1, 0x6003);
        const blob = tiles.exportChunks(10);
        const bytes = Buffer.from(blob, 'base64url');
        expect(blob).toBe(bytes.toString('base64').replaceAll('+', '-').replaceAll('/', '_'));
        expect(blob.match(/=+$/)?.[0].length ?? 0).toBe(padding);
        const decoded = decodeTilemapChunks(blob);
        expect(decoded).toHaveLength(count);
        for (const chunk of decoded) expect(chunk.tiles[(CHUNK_SIZE - 1) * CHUNK_SIZE]).toBe(0x6003);
      }
    } finally { tiles.destroyLayer(10); }
  });
});

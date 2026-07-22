// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tilesetRemoval.ts
 * @brief   Remap a TilemapLayer's painted cells when a tileset is removed from its
 *          multi-tileset list. Painted cells store ABSOLUTE global ids and a tileset's
 *          firstId is a running sum over list order, so dropping a non-last tileset
 *          shifts every later tileset's id range — silently corrupting already-painted
 *          tiles unless the stored ids are remapped in the same step. This is the pure
 *          math behind {@link SceneCommands.removeLayerTileset}: cells of the removed
 *          tileset clear, cells of later tilesets shift down to track the new layout,
 *          flip flags preserved.
 */
import { decodeTilemapChunks, CHUNK_SIZE, TILE_ID_MASK, TILE_FLAGS_MASK, type DecodedChunk } from 'esengine';
import type { TilePaint } from '@/engine/SceneCommands';

/**
 * Remap one raw cell (13-bit id + 3 flip bits) for removing a tileset that occupies the
 * global id range [base, base+span): cells below `base` are unchanged; cells IN the range
 * clear to 0 (their tiles no longer exist); cells above shift their id down by `span`
 * (flip flags kept). `span = Infinity` for the LAST tileset — its cells clear and nothing
 * shifts (there is no later range to pull down).
 */
export function remapCellForRemoval(raw: number, base: number, span: number): number {
  const id = raw & TILE_ID_MASK;
  if (id === 0 || id < base) return raw;
  if (id < base + span) return 0; // belongs to the removed tileset — gone
  return ((id - span) & TILE_ID_MASK) | (raw & TILE_FLAGS_MASK);
}

/**
 * The tile edits (world coords) removing the tileset requires, and how many painted cells
 * it erases (belonged to the removed tileset). Pure over the layer's decoded chunk blob.
 */
export function planTilesetRemoval(
  chunks: DecodedChunk[], base: number, span: number,
): { edits: TilePaint[]; cleared: number } {
  const edits: TilePaint[] = [];
  let cleared = 0;
  for (const ch of chunks) {
    for (let t = 0; t < ch.tiles.length; t++) {
      const raw = ch.tiles[t];
      if (raw === 0) continue;
      const next = remapCellForRemoval(raw, base, span);
      if (next === raw) continue;
      edits.push({ x: ch.x * CHUNK_SIZE + (t % CHUNK_SIZE), y: ch.y * CHUNK_SIZE + Math.floor(t / CHUNK_SIZE), tileId: next });
      if (next === 0) cleared++;
    }
  }
  return { edits, cleared };
}

/** Convenience: plan a removal straight from the `tilemap_exportChunks` blob. */
export function planTilesetRemovalFromBlob(blob: string, base: number, span: number): { edits: TilePaint[]; cleared: number } {
  return planTilesetRemoval(decodeTilemapChunks(blob), base, span);
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Tilemap palette ↔ Tileset editor bridge — the painter must see the LIVE
 *        TilesetDocument (unsaved collision/terrain edits included) when the
 *        Tileset editor has the same file open, and fall back to disk otherwise.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTileset, serializeTileset } from 'esengine';
import { loadTilesetForPalette } from '@/tileset/loadTileset';
import { TilesetDocument } from '@/tileset/TilesetDocument';
import { EditorHistory } from '@/engine/EditorHistory';

const read = vi.fn(async (path: string) => {
  if (path === 'assets/disk.estileset') {
    return JSON.stringify(serializeTileset(createTileset('@uuid:disk', 8, 8, 2)));
  }
  throw new Error(`unexpected read: ${path}`);
});

beforeEach(() => {
  read.mockClear();
  (globalThis as { window?: unknown }).window = { estella: { fs: { read } } };
});

afterEach(() => {
  TilesetDocument.close();
  EditorHistory.clear();
  delete (globalThis as { window?: unknown }).window;
});

describe('loadTilesetForPalette', () => {
  it('returns the live document asset (unsaved edits included) for the open file', async () => {
    TilesetDocument.open(createTileset('@uuid:live', 16, 16, 2), 'assets/live.estileset');
    TilesetDocument.edit('Mark solid', (d) => {
      d.tiles[3] = { collision: 'full' } as never;
    });

    const asset = await loadTilesetForPalette('assets/live.estileset');
    expect(asset).toBe(TilesetDocument.asset);
    expect(asset.tiles[3]).toBeDefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('falls back to disk for a file the editor does not have open', async () => {
    TilesetDocument.open(createTileset('@uuid:live', 16, 16, 2), 'assets/live.estileset');
    const asset = await loadTilesetForPalette('assets/disk.estileset');
    expect(asset.texture).toBe('@uuid:disk');
    expect(read).toHaveBeenCalledWith('assets/disk.estileset');
  });

  it('falls back to disk when no document is open', async () => {
    const asset = await loadTilesetForPalette('assets/disk.estileset');
    expect(asset.tileWidth).toBe(8);
  });
});

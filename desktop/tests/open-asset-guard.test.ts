// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Open-asset discard guard — opening a different file into a dirty
 *        AssetDocument editor must prompt (confirmDiscardDoc); re-opening the
 *        SAME file fronts the panel without a disk reload that would clobber
 *        unsaved edits. Exercised through openTileset (the twins share the shape).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTileset, serializeTileset } from 'esengine';
import { EditorHistory } from '@/engine/EditorHistory';

vi.mock('@/components/confirm', () => ({ confirm: vi.fn() }));
import { confirm } from '@/components/confirm';
import { openTileset } from '@/tileset/openTileset';
import { TilesetDocument } from '@/tileset/TilesetDocument';

const confirmMock = vi.mocked(confirm);

const read = vi.fn(async (path: string) => {
  if (path === 'assets/b.estileset') {
    return JSON.stringify(serializeTileset(createTileset('@uuid:tex-b', 32, 32, 4)));
  }
  throw new Error(`unexpected read: ${path}`);
});

beforeEach(() => {
  confirmMock.mockReset();
  read.mockClear();
  (globalThis as { window?: unknown }).window = { estella: { fs: { read } } };
  EditorHistory.clear();
  TilesetDocument.open(createTileset('@uuid:tex-a', 16, 16, 2), 'assets/a.estileset');
  TilesetDocument.edit('Resize tiles', (d) => {
    d.tileWidth = 24;
  });
});

afterEach(() => {
  TilesetDocument.close();
  EditorHistory.clear();
  delete (globalThis as { window?: unknown }).window;
});

describe('open-asset discard guard (openTileset)', () => {
  it('declining the prompt keeps the dirty document untouched', async () => {
    confirmMock.mockResolvedValue(false);
    await openTileset('assets/b.estileset');
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(TilesetDocument.filePath).toBe('assets/a.estileset');
    expect(TilesetDocument.dirty).toBe(true);
    expect(TilesetDocument.asset?.tileWidth).toBe(24);
  });

  it("confirming opens the new file and purges the old file's undo steps", async () => {
    confirmMock.mockResolvedValue(true);
    await openTileset('assets/b.estileset');
    expect(TilesetDocument.filePath).toBe('assets/b.estileset');
    expect(TilesetDocument.dirty).toBe(false);
    expect(TilesetDocument.asset?.tileWidth).toBe(32);

    EditorHistory.undo(); // must not replay A's stale snapshot into B
    expect(TilesetDocument.asset?.tileWidth).toBe(32);
    expect(TilesetDocument.filePath).toBe('assets/b.estileset');
  });

  it('re-opening the same dirty file fronts the panel without a reload or prompt', async () => {
    await openTileset('assets/a.estileset');
    expect(confirmMock).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(TilesetDocument.dirty).toBe(true);
    expect(TilesetDocument.asset?.tileWidth).toBe(24);
  });

  it('opening over a CLEAN document needs no prompt', async () => {
    TilesetDocument.open(createTileset('@uuid:tex-a', 16, 16, 2), 'assets/a.estileset'); // reset clean
    confirmMock.mockResolvedValue(false); // would block if asked
    await openTileset('assets/b.estileset');
    expect(confirmMock).not.toHaveBeenCalled();
    expect(TilesetDocument.filePath).toBe('assets/b.estileset');
  });
});

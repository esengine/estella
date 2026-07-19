// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Rename/move propagation to in-memory path holders: open AssetDocuments
 *        rebind their filePath (a later save must NOT resurrect the old file)
 *        and the tilemap painter's palette follows a renamed .estileset.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTileset } from 'esengine';
import { remapAssetPath } from '@/project/pathRemap';
import { syncAssetPaths } from '@/project/assetPathSync';
import { AssetDocument } from '@/document/AssetDocument';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { EditorHistory } from '@/engine/EditorHistory';

class TestDoc extends AssetDocument<{ n: number }> {
  open(filePath: string | null) {
    this.openAsset({ n: 1 }, filePath);
  }
  close() {
    this.closeAsset();
  }
}

describe('remapAssetPath', () => {
  it('remaps an exact file rename', () => {
    expect(remapAssetPath('a/b.estileset', 'a/b.estileset', 'a/c.estileset')).toBe('a/c.estileset');
  });
  it('remaps paths under a moved folder', () => {
    expect(remapAssetPath('art/tiles/t.estileset', 'art', 'assets/art')).toBe('assets/art/tiles/t.estileset');
  });
  it('leaves unrelated and prefix-similar paths alone', () => {
    expect(remapAssetPath('other/t.estileset', 'art', 'assets/art')).toBeNull();
    expect(remapAssetPath('artwork/t.png', 'art', 'assets/art')).toBeNull();
  });
});

describe('AssetDocument.rebindPath / syncAssetPaths', () => {
  beforeEach(() => EditorHistory.clear());

  it('an open document follows a rename; dirty state and content survive', () => {
    const doc = new TestDoc('t1');
    doc.open('assets/a.estileset');
    doc.edit('touch', (d) => {
      d.n = 2;
    });
    syncAssetPaths('assets/a.estileset', 'assets/b.estileset');
    expect(doc.filePath).toBe('assets/b.estileset');
    expect(doc.dirty).toBe(true);
    expect(doc.asset).toEqual({ n: 2 });
    expect(EditorHistory.canUndo()).toBe(true); // history untouched by the rebind
  });

  it('a folder move rebinds documents under it', () => {
    const doc = new TestDoc('t2');
    doc.open('art/deep/a.esanim');
    syncAssetPaths('art', 'assets/art');
    expect(doc.filePath).toBe('assets/art/deep/a.esanim');
  });

  it('unaffected and closed documents are left alone', () => {
    const open = new TestDoc('t3');
    open.open('other/x.esfsm');
    const closed = new TestDoc('t4');
    closed.open('assets/a.esfsm');
    closed.close();
    syncAssetPaths('assets/a.esfsm', 'assets/b.esfsm');
    expect(open.filePath).toBe('other/x.esfsm');
    expect(closed.filePath).toBeNull();
  });

  it('bumps the revision so subscribed panels re-read the new path', () => {
    const doc = new TestDoc('t5');
    doc.open('assets/a.estileset');
    const r0 = doc.getRevision();
    syncAssetPaths('assets/a.estileset', 'assets/b.estileset');
    expect(doc.getRevision()).toBeGreaterThan(r0);
  });

  it('remaps the tilemap palette (tilesets list + active path)', () => {
    const asset = createTileset('@uuid:x', 8, 8, 2);
    useTilemapPaint.setState({
      tilesets: [
        { path: 'tiles/ground.estileset', asset, firstId: 1 },
        { path: 'tiles/props.estileset', asset, firstId: 65 },
      ],
      tilesetPath: 'tiles/ground.estileset',
    });
    syncAssetPaths('tiles/ground.estileset', 'tiles/terrain.estileset');
    const s = useTilemapPaint.getState();
    expect(s.tilesets.map((t) => t.path)).toEqual(['tiles/terrain.estileset', 'tiles/props.estileset']);
    expect(s.tilesetPath).toBe('tiles/terrain.estileset');
    expect(s.tilesets[0].firstId).toBe(1); // gid mapping untouched
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { AssetDocument } from '@/document/AssetDocument';
import { EditorHistory } from '@/engine/EditorHistory';

interface Doc { n: number }

class TestDoc extends AssetDocument<Doc> {
  open(asset: Doc, filePath: string | null = 'a.json') {
    this.openAsset(asset, filePath);
  }
}

describe('AssetDocument (generic reactive + undoable base)', () => {
  let doc: TestDoc;
  beforeEach(() => {
    EditorHistory.clear();
    doc = new TestDoc();
  });

  it('opens clean and tracks dirty on edit', () => {
    doc.open({ n: 1 });
    expect(doc.isOpen).toBe(true);
    expect(doc.asset).toEqual({ n: 1 });
    expect(doc.dirty).toBe(false);

    doc.edit('inc', (d) => { d.n += 1; });
    expect(doc.asset).toEqual({ n: 2 });
    expect(doc.dirty).toBe(true);
  });

  it('edit is one undoable step (snapshot)', () => {
    doc.open({ n: 1 });
    doc.edit('inc', (d) => { d.n = 10; });
    expect(doc.asset).toEqual({ n: 10 });
    EditorHistory.undo();
    expect(doc.asset).toEqual({ n: 1 });
    EditorHistory.redo();
    expect(doc.asset).toEqual({ n: 10 });
  });

  it('bumps the revision so subscribers re-read', () => {
    let bumps = 0;
    doc.subscribe(() => { bumps += 1; });
    const r0 = doc.getRevision();
    doc.open({ n: 1 });
    doc.edit('inc', (d) => { d.n += 1; });
    expect(doc.getRevision()).toBeGreaterThan(r0);
    expect(bumps).toBeGreaterThanOrEqual(2); // open + edit
  });

  it('markSaved clears dirty', () => {
    doc.open({ n: 1 });
    doc.edit('inc', (d) => { d.n += 1; });
    expect(doc.dirty).toBe(true);
    doc.markSaved();
    expect(doc.dirty).toBe(false);
  });

  it('edit is a no-op when nothing is open', () => {
    doc.edit('inc', (d) => { d.n += 1; }); // no asset → ignored
    expect(doc.isOpen).toBe(false);
    expect(EditorHistory.canUndo()).toBe(false);
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Cross-document undo isolation — the corruption cluster: an AssetDocument
 *        shares the app EditorHistory with the scene, so opening file B over
 *        dirty file A (or closing the document) must purge A's stale snapshot
 *        steps instead of letting Ctrl+Z replay them into B. Pure TS.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { BtDefinition } from 'esengine';
import { EditorHistory } from '@/engine/EditorHistory';
import { BtDocument } from '@/bt/BtDocument';
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';

const btDef = (rootId: string): BtDefinition =>
  ({ root: { id: rootId, type: 'selector', children: [] } }) as unknown as BtDefinition;
const rootId = () => (BtDocument.asset as unknown as { root: { id: string } } | null)?.root.id;
const pushChild = (id: string) =>
  BtDocument.edit('Add node', (d) => {
    (d as unknown as { root: { children: unknown[] } }).root.children.push({ id, type: 'action' });
  });

beforeEach(() => {
  EditorHistory.clear();
});
afterEach(() => {
  BtDocument.close();
  FsmGraphDocument.close();
  EditorHistory.clear();
});

describe('cross-document undo isolation', () => {
  it('dirty A → open B → undo does NOT clobber B with A stale snapshot', () => {
    BtDocument.open(btDef('a'), 'assets/a.esbt');
    pushChild('a1');
    expect(BtDocument.dirty).toBe(true);

    BtDocument.openJson(btDef('b'), 'assets/b.esbt');
    EditorHistory.undo(); // must be a no-op for this document

    expect(BtDocument.filePath).toBe('assets/b.esbt');
    expect(rootId()).toBe('b');
    expect(BtDocument.dirty).toBe(false);
    expect(EditorHistory.canUndo()).toBe(false);
  });

  it('undo cannot resurrect a closed document', () => {
    BtDocument.open(btDef('a'), 'assets/a.esbt');
    pushChild('a1');
    BtDocument.close();
    EditorHistory.undo();
    expect(BtDocument.isOpen).toBe(false);
    expect(BtDocument.asset).toBeNull();
  });

  it("closing one document keeps another document's undo intact", () => {
    BtDocument.open(btDef('a'), 'assets/a.esbt');
    pushChild('a1');
    FsmGraphDocument.open({ initial: 'idle', states: {} } as never, 'assets/x.esfsm');
    FsmGraphDocument.edit('Rename', (d) => {
      (d as { initial: string }).initial = 'run';
    });

    BtDocument.close();
    EditorHistory.undo();
    expect((FsmGraphDocument.asset as { initial: string }).initial).toBe('idle');
    expect(EditorHistory.canUndo()).toBe(false);
  });

  it('scene switch (clearScene) keeps asset-doc undo steps and dirty state', () => {
    EditorHistory.record('Move entity', () => {}, () => {}); // a scene step
    BtDocument.open(btDef('a'), 'assets/a.esbt');
    pushChild('a1');

    EditorHistory.clearScene();
    expect(EditorHistory.isDirty()).toBe(false); // scene baseline reset
    expect(BtDocument.dirty).toBe(true); // asset edits survive, still guarded
    expect(EditorHistory.canUndo()).toBe(true);

    EditorHistory.undo();
    expect((BtDocument.asset as unknown as { root: { children: unknown[] } }).root.children).toHaveLength(0);
  });

  it('an asset edit alone does not mark the scene history dirty', () => {
    BtDocument.open(btDef('a'), 'assets/a.esbt');
    pushChild('a1');
    expect(EditorHistory.isDirty()).toBe(false);
    expect(BtDocument.dirty).toBe(true);
  });
});

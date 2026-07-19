// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  panelDirty discard — the dock tab X routes a confirmed discard here so
 *        the underlying AssetDocument actually closes (dropping its dirty state
 *        and purging its undo steps) instead of lingering invisibly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { BtDefinition } from 'esengine';
import { panelDirtySource } from '@/layout/panelDirty';
import { BtDocument } from '@/bt/BtDocument';
import { EditorHistory } from '@/engine/EditorHistory';

afterEach(() => {
  BtDocument.close();
  EditorHistory.clear();
});

describe('panelDirtySource discard', () => {
  it('discard closes the panel document and drops its undo steps', () => {
    BtDocument.open({ root: { id: 'r', type: 'selector', children: [] } } as unknown as BtDefinition, 'assets/a.esbt');
    BtDocument.edit('Add node', (d) => {
      (d as unknown as { root: { children: unknown[] } }).root.children.push({ id: 'n', type: 'action' });
    });
    const src = panelDirtySource('behaviortree');
    expect(src.isDirty()).toBe(true);

    src.discard?.();
    expect(BtDocument.isOpen).toBe(false);
    expect(src.isDirty()).toBe(false);
    EditorHistory.undo();
    expect(BtDocument.isOpen).toBe(false); // no resurrection
  });

  it('panels without a document expose no discard', () => {
    expect(panelDirtySource('viewport').discard).toBeUndefined();
  });
});

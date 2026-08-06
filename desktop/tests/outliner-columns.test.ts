// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Outliner column registry. The trailing columns are descriptors;
 *        `applies` gates per-item cells so
 *        entity-only columns (lock/vis) render an aligned spacer on folder rows.
 */
import { describe, it, expect } from 'vitest';
import type { SceneData } from 'esengine';
import { buildOutlinerItems } from '@/outliner/OutlinerModel';
import { OUTLINER_COLUMNS, TYPE_COLUMN, LOCK_COLUMN, VIS_COLUMN, type OutlinerColumnContext } from '@/outliner/columns';

const NO_CTX: OutlinerColumnContext = {};

// One entity (root) + one folder, via the real builder, to test `applies`.
function items() {
  const data = { version: '1.0', name: 'c', entities: [{ id: 1, name: 'A', parent: null, children: [], components: [] }] } as unknown as SceneData;
  return buildOutlinerItems(data, { expanded: new Set(), folders: ['F'], folderOf: () => '' });
}

describe('outliner column registry', () => {
  it('the registry is Type, Lock, Visibility in order', () => {
    expect(OUTLINER_COLUMNS.map((c) => c.id)).toEqual(['type', 'lock', 'vis']);
  });

  it('Type applies to every row; Lock/Vis only to entities', () => {
    const all = items();
    const entity = all.find((i) => i.kind === 'entity')!;
    const folder = all.find((i) => i.kind === 'folder')!;
    expect(TYPE_COLUMN.applies(entity, NO_CTX)).toBe(true);
    expect(TYPE_COLUMN.applies(folder, NO_CTX)).toBe(true);
    expect(LOCK_COLUMN.applies(entity, NO_CTX)).toBe(true);
    expect(LOCK_COLUMN.applies(folder, NO_CTX)).toBe(false); // → an aligned spacer on folder rows
    expect(VIS_COLUMN.applies(entity, NO_CTX)).toBe(true);
    expect(VIS_COLUMN.applies(folder, NO_CTX)).toBe(false);
  });

  // The running world has rows with nothing of their own to draw (a bare
  // transform). They get a spacer, not an eye that would quietly do nothing.
  it('Visibility yields to the context when the tree says an entity cannot be hidden', () => {
    const entity = items().find((i) => i.kind === 'entity')!;
    expect(VIS_COLUMN.applies(entity, { canToggleVisible: () => false })).toBe(false);
    expect(VIS_COLUMN.applies(entity, { canToggleVisible: () => true })).toBe(true);
  });
});

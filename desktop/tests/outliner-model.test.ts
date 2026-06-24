// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  buildOutlinerItems — the ONE outliner tree builder (REARCH_OUTLINER.md).
 *        Flattens a SceneData to render-ordered rows honoring expansion + filter;
 *        the same builder feeds the editor tree and the always-expanded PIE tree.
 *        Pure projection over the model hierarchy (derived from `parent`).
 */
import { describe, it, expect } from 'vitest';
import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';
import { buildOutlinerItems, collectExpandableIds } from '@/outliner/OutlinerModel';

const ent = (id: number, parent: number | null) => ({ id, name: `E${id}`, parent, children: [], components: [] as unknown[] });

// 1 ─┬ 2 ── 3      (root 1 with a nested branch and a flat child)
//    └ 5
function scene(): SceneData {
  return { version: '1.0', name: 'tree', entities: [ent(1, null), ent(2, 1), ent(3, 2), ent(5, 1)] } as unknown as SceneData;
}

const ids = (set: Iterable<EntityId>) => [...set];
const itemIds = (data: SceneData, expanded: number[], opts?: { expandAll?: boolean; query?: string }) =>
  buildOutlinerItems(data, { expanded: new Set(expanded), ...opts }).map((i) => i.id);

describe('buildOutlinerItems', () => {
  it('collapsed roots: only top-level nodes, marked hasChildren', () => {
    const items = buildOutlinerItems(scene(), { expanded: new Set() });
    expect(items.map((i) => i.id)).toEqual([1]);
    expect(items[0]).toMatchObject({ depth: 0, hasChildren: true, expanded: false, parentId: null, kind: 'entity' });
  });

  it('expanding a node reveals exactly its direct children (one level)', () => {
    expect(itemIds(scene(), [1])).toEqual([1, 2, 5]); // 2 is collapsed → 3 stays hidden
    expect(itemIds(scene(), [1, 2])).toEqual([1, 2, 3, 5]);
  });

  it('depth + parentId track the hierarchy', () => {
    const items = buildOutlinerItems(scene(), { expanded: new Set([1, 2]) });
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(2)).toMatchObject({ depth: 1, parentId: 1 });
    expect(byId.get(3)).toMatchObject({ depth: 2, parentId: 2 });
    expect(byId.get(5)).toMatchObject({ depth: 1, parentId: 1 });
  });

  it('expandAll renders the whole tree regardless of the expansion set (PIE)', () => {
    expect(itemIds(scene(), [], { expandAll: true })).toEqual([1, 2, 3, 5]);
  });

  it('a query keeps matches + their ancestors and force-expands', () => {
    expect(itemIds(scene(), [], { query: 'E3' })).toEqual([1, 2, 3]); // 5 doesn't match → dropped
    expect(itemIds(scene(), [], { query: 'nope' })).toEqual([]);
  });

  it('null data → empty list', () => {
    expect(buildOutlinerItems(null, { expanded: new Set() })).toEqual([]);
  });

  it('collectExpandableIds = every node that has children', () => {
    expect(ids(collectExpandableIds(scene())).sort()).toEqual([1, 2]);
  });
});

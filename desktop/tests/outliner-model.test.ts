// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  buildOutlinerItems — the ONE outliner tree builder (REARCH_OUTLINER.md).
 *        Flattens a SceneData to render-ordered rows (entity | folder) honoring a
 *        string-keyed expansion set + a name filter; folders group ROOT entities
 *        by path (orthogonal to the transform `parent`). Pure projection.
 */
import { describe, it, expect } from 'vitest';
import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';
import {
  buildOutlinerItems,
  collectExpandableKeys,
  entityKey,
  folderKey,
  type OutlinerItem,
} from '@/outliner/OutlinerModel';

const ent = (id: number, parent: number | null) => ({ id, name: `E${id}`, parent, children: [], components: [] as unknown[] });

// 1 ─┬ 2 ── 3      (root 1 with a nested branch and a flat child)
//    └ 5
function scene(): SceneData {
  return { version: '1.0', name: 'tree', entities: [ent(1, null), ent(2, 1), ent(3, 2), ent(5, 1)] } as unknown as SceneData;
}

const keys = (items: OutlinerItem[]) => items.map((i) => i.key);

describe('buildOutlinerItems — entities', () => {
  it('collapsed roots: only top-level nodes, marked hasChildren', () => {
    const items = buildOutlinerItems(scene(), { expanded: new Set() });
    expect(keys(items)).toEqual(['e1']);
    expect(items[0]).toMatchObject({ kind: 'entity', depth: 0, hasChildren: true, expanded: false, parentKey: null });
  });

  it('expanding a node reveals exactly its direct children (one level)', () => {
    expect(keys(buildOutlinerItems(scene(), { expanded: new Set([entityKey(1)]) }))).toEqual(['e1', 'e2', 'e5']);
    expect(keys(buildOutlinerItems(scene(), { expanded: new Set([entityKey(1), entityKey(2)]) }))).toEqual(['e1', 'e2', 'e3', 'e5']);
  });

  it('depth + parentKey track the hierarchy', () => {
    const items = buildOutlinerItems(scene(), { expanded: new Set([entityKey(1), entityKey(2)]) });
    const byKey = new Map(items.map((i) => [i.key, i]));
    expect(byKey.get('e2')).toMatchObject({ depth: 1, parentKey: 'e1' });
    expect(byKey.get('e3')).toMatchObject({ depth: 2, parentKey: 'e2' });
    expect(byKey.get('e5')).toMatchObject({ depth: 1, parentKey: 'e1' });
  });

  it('expandAll renders the whole tree regardless of expansion (PIE)', () => {
    expect(keys(buildOutlinerItems(scene(), { expanded: new Set(), expandAll: true }))).toEqual(['e1', 'e2', 'e3', 'e5']);
  });

  it('a query keeps matches + ancestors and force-expands', () => {
    expect(keys(buildOutlinerItems(scene(), { expanded: new Set(), query: 'E3' }))).toEqual(['e1', 'e2', 'e3']);
    expect(buildOutlinerItems(scene(), { expanded: new Set(), query: 'nope' })).toEqual([]);
  });

  it('null data → empty list', () => {
    expect(buildOutlinerItems(null, { expanded: new Set() })).toEqual([]);
  });
});

// Roots 1 / 10 / 11; 1→"Enemies", 10→"Enemies/Bosses", 11→root. 2 is a child of 1.
function folderScene(): { data: SceneData; folderOf: (id: EntityId) => string } {
  const data = {
    version: '1.0',
    name: 'folders',
    entities: [ent(1, null), ent(2, 1), ent(10, null), ent(11, null)],
  } as unknown as SceneData;
  const map: Record<number, string> = { 1: 'Enemies', 10: 'Enemies/Bosses', 11: '' };
  return { data, folderOf: (id) => map[id] ?? '' };
}

describe('buildOutlinerItems — folders', () => {
  it('groups root entities under nested folder rows (orthogonal to parent)', () => {
    const { data, folderOf } = folderScene();
    const items = buildOutlinerItems(data, { expanded: new Set(), folderOf, expandAll: true });
    expect(keys(items)).toEqual([
      folderKey('Enemies'),
      folderKey('Enemies/Bosses'),
      'e10', // root inside Enemies/Bosses
      'e1', // root inside Enemies
      'e2', // child of 1 (transform parent), one level deeper
      'e11', // scene-root entity (no folder)
    ]);
  });

  it('folder rows carry name, recursive count, depth, parentKey', () => {
    const { data, folderOf } = folderScene();
    const items = buildOutlinerItems(data, { expanded: new Set(), folderOf, expandAll: true });
    const byKey = new Map(items.map((i) => [i.key, i]));
    expect(byKey.get(folderKey('Enemies'))).toMatchObject({ kind: 'folder', name: 'Enemies', count: 2, depth: 0, parentKey: null });
    expect(byKey.get(folderKey('Enemies/Bosses'))).toMatchObject({ name: 'Bosses', count: 1, depth: 1, parentKey: folderKey('Enemies') });
    expect(byKey.get('e10')).toMatchObject({ depth: 2, parentKey: folderKey('Enemies/Bosses') });
    expect(byKey.get('e11')).toMatchObject({ depth: 0, parentKey: null });
  });

  it('a collapsed folder hides its contents', () => {
    const { data, folderOf } = folderScene();
    // Only "Enemies" open → Bosses shows collapsed (e10 hidden), e1 collapsed (e2 hidden).
    const items = buildOutlinerItems(data, { expanded: new Set([folderKey('Enemies')]), folderOf });
    expect(keys(items)).toEqual([folderKey('Enemies'), folderKey('Enemies/Bosses'), 'e1', 'e11']);
  });

  it('explicit empty folders still show (no query)', () => {
    const { data, folderOf } = folderScene();
    const items = buildOutlinerItems(data, { expanded: new Set(), folderOf, folders: ['Empty/Leaf'], expandAll: true });
    const folders = items.filter((i) => i.kind === 'folder').map((i) => i.key);
    expect(folders).toContain(folderKey('Empty'));
    expect(folders).toContain(folderKey('Empty/Leaf'));
    expect(items.find((i) => i.key === folderKey('Empty/Leaf'))).toMatchObject({ count: 0, hasChildren: false });
  });

  it('collectExpandableKeys = entity parents + every folder', () => {
    const { data, folderOf } = folderScene();
    const ks = new Set(collectExpandableKeys(data, { folderOf, folders: ['Empty'] }));
    expect(ks).toContain(entityKey(1)); // has child 2
    expect(ks).toContain(folderKey('Enemies'));
    expect(ks).toContain(folderKey('Enemies/Bosses'));
    expect(ks).toContain(folderKey('Empty'));
    expect(ks.has(entityKey(10))).toBe(false); // leaf, not expandable
  });
});

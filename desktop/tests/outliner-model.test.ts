// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  buildOutlinerItems — the ONE outliner tree builder.
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
  parseQuery,
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

  it('expandAll renders the whole tree regardless of expansion (the live game tree)', () => {
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

// Kinds come from components (modelKindOf): Sprite→sprite, Camera→camera.
function compScene(): SceneData {
  return {
    version: '1.0',
    name: 'c',
    entities: [
      { id: 1, name: 'Hero', parent: null, children: [], components: [{ type: 'Sprite', data: {} }] },
      { id: 2, name: 'MainCam', parent: null, children: [], components: [{ type: 'Camera', data: {} }] },
      { id: 3, name: 'Crate', parent: null, children: [], components: [{ type: 'Sprite', data: {} }, { type: 'RigidBody', data: {} }] },
    ],
  } as unknown as SceneData;
}
const queryIds = (data: SceneData, query: string) =>
  buildOutlinerItems(data, { expanded: new Set(), query })
    .filter((i): i is Extract<OutlinerItem, { kind: 'entity' }> => i.kind === 'entity')
    .map((i) => i.id);

describe('token search', () => {
  it('parseQuery splits bare text from type:/comp: tokens', () => {
    expect(parseQuery('type:sprite comp:RigidBody hero')).toEqual({ text: 'hero', types: ['sprite'], comps: ['rigidbody'] });
    expect(parseQuery('t:camera c:Camera')).toEqual({ text: '', types: ['camera'], comps: ['camera'] });
    expect(parseQuery('  big  boss ')).toEqual({ text: 'big boss', types: [], comps: [] });
    expect(parseQuery('')).toEqual({ text: '', types: [], comps: [] });
  });

  it('type: filters by kind', () => {
    expect(queryIds(compScene(), 'type:camera')).toEqual([2]);
  });
  it('comp: filters by component type (case-insensitive)', () => {
    expect(queryIds(compScene(), 'comp:rigidbody')).toEqual([3]);
  });
  it('bare text AND a token', () => {
    expect(queryIds(compScene(), 'type:sprite cra')).toEqual([3]); // sprite kind AND name~"cra"
    expect(queryIds(compScene(), 'type:sprite zzz')).toEqual([]); // name fails → none
  });
});

// kinds: 2=camera, 1/3/4=sprite. names chosen so name-sort ≠ type-sort.
function sortScene(): SceneData {
  return {
    version: '1.0',
    name: 's',
    entities: [
      { id: 1, name: 'Zed', parent: null, children: [], components: [{ type: 'Sprite', data: {} }] },
      { id: 2, name: 'Apple', parent: null, children: [], components: [{ type: 'Camera', data: {} }] },
      { id: 3, name: 'Mid', parent: null, children: [], components: [{ type: 'Sprite', data: {} }] },
      { id: 4, name: 'Aaa', parent: null, children: [], components: [{ type: 'Sprite', data: {} }] },
    ],
  } as unknown as SceneData;
}

describe('sort mode', () => {
  const sortedKeys = (sort: 'manual' | 'name' | 'type') => keys(buildOutlinerItems(sortScene(), { expanded: new Set(), sort }));
  it('manual keeps scene (data) order', () => {
    expect(sortedKeys('manual')).toEqual(['e1', 'e2', 'e3', 'e4']);
  });
  it('name sorts alphabetically', () => {
    expect(sortedKeys('name')).toEqual(['e4', 'e2', 'e3', 'e1']); // Aaa, Apple, Mid, Zed
  });
  it('type sorts by kind then name', () => {
    expect(sortedKeys('type')).toEqual(['e2', 'e4', 'e3', 'e1']); // camera(Apple), then sprites Aaa, Mid, Zed
  });

  it('manual sort orders sibling folders by the scene folder list, not alphabetically', () => {
    const data = { version: '1.0', name: 'f', entities: [] } as unknown as SceneData;
    const folders = ['Zebra', 'Apple']; // created Z then A
    expect(keys(buildOutlinerItems(data, { expanded: new Set(), folders }))).toEqual([folderKey('Zebra'), folderKey('Apple')]);
    expect(keys(buildOutlinerItems(data, { expanded: new Set(), folders, sort: 'name' }))).toEqual([folderKey('Apple'), folderKey('Zebra')]);
  });

  it('a drag-placed folder interleaves among root entities (manual sort key)', () => {
    const data = {
      version: '1.0',
      name: 'i',
      entities: [
        { id: 1, name: 'A', parent: null, children: [], components: [] },
        { id: 2, name: 'B', parent: null, children: [], components: [] },
        { id: 3, name: 'C', parent: null, children: [], components: [] },
      ],
    } as unknown as SceneData;
    // Folder F placed at 1.5 → between entity index 1 (e2) and index 2 (e3).
    const items = buildOutlinerItems(data, { expanded: new Set(), folders: ['F'], folderOrderOf: (p) => (p === 'F' ? 1.5 : undefined) });
    expect(keys(items)).toEqual(['e1', 'e2', folderKey('F'), 'e3']);
    // Its sortKey is the placed order, so a drag-after reads 1.5 + 0.5 = 2.
    expect(items.find((i) => i.key === folderKey('F'))!.sortKey).toBe(1.5);
  });
});

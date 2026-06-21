/**
 * @file  Prefab instance expand/collapse round-trip (REARCH_PREFABS.md PF2 core).
 *        The data-loss safety net: a prefab instance is saved as a DELTA
 *        (overrides + added + removed) and loaded by expanding the prefab asset.
 *        This pins `collapse(expand(delta)) === delta` over every bucket —
 *        property/name/visibility overrides AND structural add/remove — so the
 *        diff-based save path can't silently drop an edit. Pure data (no World).
 */
import { describe, it, expect } from 'vitest';
import { migratePrefabData } from 'esengine';
import type { PrefabData, SceneData } from 'esengine';
import {
  expandInstance,
  collapseInstance,
  expandEntry,
  collapseEntry,
  expandScenePrefabs,
  collapseScenePrefabs,
  type PrefabInstanceDelta,
  type PrefabInstanceEntry,
  type InstanceTag,
} from '@/engine/PrefabInstance';

function turretPrefab(): PrefabData {
  return migratePrefabData({
    version: '1.0',
    name: 'Turret',
    rootEntityId: 'root',
    entities: [
      {
        prefabEntityId: 'root',
        name: 'Turret',
        parent: null,
        children: ['barrel', 'scope'],
        components: [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }],
        visible: true,
      },
      {
        prefabEntityId: 'barrel',
        name: 'Barrel',
        parent: 'root',
        children: [],
        components: [{ type: 'Sprite', data: { color: { r: 1, g: 1, b: 1, a: 1 } } }],
        visible: true,
      },
      {
        prefabEntityId: 'scope',
        name: 'Scope',
        parent: 'root',
        children: [],
        components: [],
        visible: true,
      },
    ],
  }).data as PrefabData;
}

const REF = '@uuid:turret-0000';

describe('Prefab instance expand/collapse round-trip', () => {
  it('round-trips overrides + added + removed (collapse∘expand = identity)', () => {
    const prefab = turretPrefab();
    const delta: PrefabInstanceDelta = {
      prefab: REF,
      overrides: [
        { prefabEntityId: 'root', type: 'property', componentType: 'Transform', propertyName: 'position', value: { x: 5, y: 0, z: 0 } },
        { prefabEntityId: 'barrel', type: 'name', value: 'BigBarrel' },
        { prefabEntityId: 'barrel', type: 'visibility', value: false },
      ],
      added: [
        {
          prefabEntityId: 'addon1',
          name: 'Muzzle',
          components: [{ type: 'Sprite', data: { color: { r: 0, g: 1, b: 0, a: 1 } } }],
          visible: true,
          parentId: 'root',
        },
      ],
      removed: ['scope'],
    };

    let nid = 0;
    const { entities: expanded } = expandInstance(prefab, delta, () => nid++);
    const back = collapseInstance(prefab, REF, expanded);

    expect(back.prefab).toBe(REF);
    expect(back.removed.sort()).toEqual(['scope']);

    expect(back.added).toHaveLength(1);
    expect(back.added[0].prefabEntityId).toBe('addon1');
    expect(back.added[0].name).toBe('Muzzle');
    expect(back.added[0].parentId).toBe('root');

    const propOv = back.overrides.find(
      (o) => o.type === 'property' && o.prefabEntityId === 'root' && o.propertyName === 'position',
    );
    expect(propOv?.value).toEqual({ x: 5, y: 0, z: 0 });
    expect(back.overrides.find((o) => o.type === 'name' && o.prefabEntityId === 'barrel')?.value).toBe('BigBarrel');
    expect(back.overrides.find((o) => o.type === 'visibility' && o.prefabEntityId === 'barrel')?.value).toBe(false);
  });

  it('expands to the right entities: kept prefab entities (minus removed) + added', () => {
    const prefab = turretPrefab();
    const delta: PrefabInstanceDelta = { prefab: REF, overrides: [], added: [], removed: ['scope'] };
    let nid = 0;
    const { entities: expanded } = expandInstance(prefab, delta, () => nid++);
    // root + barrel kept; scope removed; nothing added.
    expect(expanded.map((e) => e.prefabEntityId).sort()).toEqual(['barrel', 'root']);
    const root = expanded.find((e) => e.prefabEntityId === 'root')!;
    // root's children no longer reference the removed scope.
    expect(root.children).toHaveLength(1);
  });

  it('a clean instance (no edits) collapses to an empty delta', () => {
    const prefab = turretPrefab();
    const delta: PrefabInstanceDelta = { prefab: REF, overrides: [], added: [], removed: [] };
    let nid = 0;
    const back = collapseInstance(prefab, REF, expandInstance(prefab, delta, () => nid++).entities);
    expect(back.overrides).toEqual([]);
    expect(back.added).toEqual([]);
    expect(back.removed).toEqual([]);
  });

  // ── Scene ⇄ model boundary (expandEntry / collapseEntry) ──
  it('expandEntry pins the root to the entry id + attaches under the scene parent', () => {
    const prefab = turretPrefab();
    const entry: PrefabInstanceEntry = {
      id: 100, // stable scene id of the instance root
      parent: 7, // attaches under scene entity 7
      prefab: REF,
      overrides: [],
      added: [],
      removed: [],
    };
    let nid = 200; // fresh model ids for the internals
    const { entities, rootId } = expandEntry(prefab, entry, () => nid++);
    expect(rootId).toBe(100);
    const root = entities.find((e) => e.id === 100)!;
    expect(root.prefabEntityId).toBe('root');
    expect(root.parent).toBe(7); // scene parent
    // The barrel's parent points at the pinned root id, not the allocated one.
    const barrel = entities.find((e) => e.prefabEntityId === 'barrel')!;
    expect(barrel.parent).toBe(100);
    expect(root.children).toContain(barrel.id);
  });

  it('a scene instance entry round-trips through expandEntry → collapseEntry', () => {
    const prefab = turretPrefab();
    const entry: PrefabInstanceEntry = {
      id: 100,
      parent: 7,
      prefab: REF,
      overrides: [
        { prefabEntityId: 'root', type: 'property', componentType: 'Transform', propertyName: 'position', value: { x: 9, y: 0, z: 0 } },
        { prefabEntityId: 'barrel', type: 'name', value: 'BigBarrel' },
      ],
      added: [
        { prefabEntityId: 'addon1', name: 'Muzzle', components: [{ type: 'Sprite', data: {} }], visible: true, parentId: 'root' },
      ],
      removed: ['scope'],
    };
    let nid = 200;
    const { entities, rootId } = expandEntry(prefab, entry, () => nid++);
    const back = collapseEntry(prefab, REF, entities, rootId, entry.parent);

    expect(back.id).toBe(100); // stable root id preserved
    expect(back.parent).toBe(7); // scene attach point preserved
    expect(back.removed.sort()).toEqual(['scope']);
    expect(back.added.map((a) => a.prefabEntityId)).toEqual(['addon1']);
    expect(back.added[0].parentId).toBe('root');
    expect(
      back.overrides.find((o) => o.type === 'property' && o.prefabEntityId === 'root')?.value,
    ).toEqual({ x: 9, y: 0, z: 0 });
    expect(back.overrides.find((o) => o.type === 'name' && o.prefabEntityId === 'barrel')?.value).toBe('BigBarrel');
  });

  // ── Whole-scene expand/collapse (the ProjectStore load/save core) ──
  it('a whole scene round-trips: a prefab-instance entry ⇄ expanded+tagged ⇄ entry', async () => {
    const prefab = turretPrefab();
    const loadPrefab = async (ref: string) => (ref === REF ? prefab : null);
    const scene = {
      version: '1.0',
      name: 's',
      entities: [
        { id: 1, name: 'Ground', parent: null, children: [], components: [], visible: true },
        { id: 2, prefab: REF, parent: 1, overrides: [{ prefabEntityId: 'barrel', type: 'name', value: 'BigBarrel' }], added: [], removed: ['scope'] },
      ],
    } as unknown as SceneData;

    let nid = 100;
    const { scene: expanded, tags } = await expandScenePrefabs(scene, loadPrefab, () => nid++);
    // Ground + (root + barrel) — scope removed.
    expect(expanded.entities).toHaveLength(3);
    expect(expanded.entities.find((e) => e.id === 2)?.name).toBe('Turret'); // root pinned to entry id
    expect(expanded.entities.find((e) => e.name === 'BigBarrel')).toBeDefined(); // override applied

    const tagMap = new Map(tags.map((t) => [t.id, t.tag]));
    const collapsed = await collapseScenePrefabs(expanded.entities, (id) => tagMap.get(id), loadPrefab);

    // Ground (untouched) + one instance entry.
    expect(collapsed).toHaveLength(2);
    expect(collapsed.find((e) => e.id === 1)?.name).toBe('Ground');
    const entry = collapsed.find((e) => (e as { prefab?: string }).prefab === REF) as unknown as PrefabInstanceEntry;
    expect(entry.id).toBe(2);
    expect(entry.parent).toBe(1);
    expect(entry.removed.sort()).toEqual(['scope']);
    expect(entry.overrides.find((o) => o.type === 'name' && o.prefabEntityId === 'barrel')?.value).toBe('BigBarrel');
  });

  it('a scene with no prefab instances passes through unchanged', async () => {
    const loadPrefab = async () => null;
    const scene = {
      version: '1.0',
      name: 's',
      entities: [{ id: 1, name: 'A', parent: null, children: [], components: [], visible: true }],
    } as unknown as SceneData;
    let nid = 100;
    const { scene: expanded, tags } = await expandScenePrefabs(scene, loadPrefab, () => nid++);
    expect(expanded.entities).toHaveLength(1);
    expect(tags).toHaveLength(0);
    const tagMap = new Map<number, InstanceTag>();
    const collapsed = await collapseScenePrefabs(expanded.entities, (id) => tagMap.get(id), loadPrefab);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].name).toBe('A');
  });
});

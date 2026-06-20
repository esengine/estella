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
import type { PrefabData } from 'esengine';
import { expandInstance, collapseInstance, type PrefabInstanceDelta } from '@/engine/PrefabInstance';

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
    const expanded = expandInstance(prefab, delta, () => nid++);
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
    const expanded = expandInstance(prefab, delta, () => nid++);
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
    const back = collapseInstance(prefab, REF, expandInstance(prefab, delta, () => nid++));
    expect(back.overrides).toEqual([]);
    expect(back.added).toEqual([]);
    expect(back.removed).toEqual([]);
  });
});

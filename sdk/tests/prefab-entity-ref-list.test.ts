// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Regression: an entity-ref field holding a LIST is translated like a
 *        scalar one. `MeshSkin.joints` is that field — a glTF import writes one
 *        per skinned mesh — and while only scalars were handled, the prefab-local
 *        strings survived into the World's numeric entity vector: the model drew
 *        in its bind pose, which looks like a model that simply does not animate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, clearUserComponents } from '../src/ecs/component';
import { remapComponentEntityRefs } from '../src/prefab/entityRef';
import { collapseEntry, expandEntry, expandInstance } from '../src/prefab/sceneInstance';
import type { DeferredRecord } from '../src/prefab/deferred';
import { diffAgainstSource } from '../src/prefab/diff';
import { PREFAB_FORMAT_VERSION } from '../src/prefab/migrate';
import { INVALID_ENTITY } from '../src/types';
import type { PrefabData } from '../src/prefab/types';

const LIST_META = { entityFields: ['joints'] };

/** A rig: the mesh names two joints by their prefab-local ids. */
function rig(): PrefabData {
  return {
    version: PREFAB_FORMAT_VERSION,
    name: 'Rig',
    rootEntityId: 'root',
    entities: [
      { prefabEntityId: 'root', name: 'Rig', parent: null, children: ['mesh', 'bone0', 'bone1'], components: [], visible: true },
      {
        prefabEntityId: 'mesh', name: 'Mesh', parent: 'root', children: [], visible: true,
        components: [{ type: 'SkinRef', data: { joints: ['bone0', 'bone1'] } }],
      },
      { prefabEntityId: 'bone0', name: 'Bone0', parent: 'root', children: [], components: [], visible: true },
      { prefabEntityId: 'bone1', name: 'Bone1', parent: 'root', children: [], components: [], visible: true },
    ],
  };
}

beforeEach(() => {
  clearUserComponents();
  defineComponent('SkinRef', { joints: [] }, LIST_META);
});

describe('a list-valued entity-ref field', () => {
  it('loads scalar and ordered references to each scene instance root without recording a phantom edit', () => {
    defineComponent('FocusRef', { target: 0, index: 0 }, { entityFields: ['target'] });
    const prefab = rig();
    const root = prefab.entities.shift()!;
    prefab.entities.push(root); // allocation order does not establish identity
    const mesh = prefab.entities[0];
    mesh.components[0].data.joints = ['root', 'bone0', 0, 83, 'root'];
    mesh.components.push({ type: 'FocusRef', data: { target: 'root', index: 101 } });
    const source = structuredClone(prefab);
    let next = 100;
    for (const id of [41, 42]) {
      const entry = { id, parent: 9, prefab: '@uuid:rig', overrides: [], added: [], removed: [] };
      const out = expandEntry(prefab, entry, () => next++);
      const bone = out.entities.find(e => e.name === 'Bone0')!;
      const member = out.entities.find(e => e.name === 'Mesh')!;
      expect(member.components[0].data.joints).toEqual([id, bone.id, 0, 83, id]);
      expect(member.components[1].data).toEqual({ target: id, index: 101 });
      expect(member.parent).toBe(id);
      expect(collapseEntry(prefab, entry.prefab, out.entities, id, entry.parent)).toEqual(entry);
    }
    expect(prefab).toEqual(source);
  });

  it('saves a legacy numeric reference to the root without writing a new override', () => {
    const prefab = rig();
    prefab.rootEntityId = prefab.entities[0].prefabEntityId = '17';
    for (const child of prefab.entities.slice(1)) child.parent = '17';
    prefab.entities[1].components[0].data.joints = [17, INVALID_ENTITY, 83];
    const entry = { id: 41, parent: null, prefab: 'legacy', overrides: [], added: [], removed: [] };
    let next = 100;
    const out = expandEntry(prefab, entry, () => next++);
    expect(out.entities[1].components[0].data.joints).toEqual([41, INVALID_ENTITY, 83]);
    expect(collapseEntry(prefab, entry.prefab, out.entities, 41, null)).toEqual(entry);
  });

  it('resolves a later mounting slot, its composed addresses and a deferred root under a variant', () => {
    const leaf = rig();
    const source: PrefabData = {
      version: PREFAB_FORMAT_VERSION, name: 'Mounted', rootEntityId: 'mount',
      entities: [
        { prefabEntityId: 'binding', name: 'Binding', parent: 'mount', children: [], visible: true,
          components: [{ type: 'SkinRef', data: { joints: ['mount', 'mount/root', 'mount/bone1'] } }] },
        { prefabEntityId: 'mount', name: 'Mount', parent: null, children: ['binding'], components: [], visible: true,
          nestedPrefab: { prefabPath: 'leaf', overrides: [] } },
      ],
    };
    const variant = { ...source, basePrefab: 'source', entities: [] };
    const resolve = (ref: string) => ref === 'source' ? source : leaf;
    const entry = { id: 21, parent: null, prefab: 'variant', overrides: [], added: [], removed: [] };
    let next = 400;
    const out = expandEntry(variant, entry, () => next++, resolve);
    const idOf = (pid: string) => out.entities.find(e => e.prefabEntityId === pid)!.id;
    expect(out.entities.find(e => e.name === 'Binding')!.components[0].data.joints)
      .toEqual([21, 21, idOf('mount/bone1')]);
    expect(collapseEntry(variant, entry.prefab, out.entities, 21, null, resolve)).toEqual(entry);

    source.entities[1].metadata = { deferred: true };
    const deferred: DeferredRecord[] = [];
    const lazy = expandEntry(variant, entry, () => next++, resolve, deferred);
    expect(deferred.map(record => record.id)).toEqual([21]);
    expect(lazy.entities.find(e => e.name === 'Binding')!.components[0].data.joints).toEqual([21, 21, INVALID_ENTITY]);
  });

  it('remaps every element to a runtime id', () => {
    const comps = [{ type: 'SkinRef', data: { joints: ['a', 'b'] } as Record<string, unknown> }];
    remapComponentEntityRefs(comps, new Map([['a', 11], ['b', 22]]));
    expect(comps[0].data.joints).toEqual([11, 22]);
  });

  it('clears a dangling element instead of leaking the string into the World', () => {
    const comps = [{ type: 'SkinRef', data: { joints: ['a', 'ghost'] } as Record<string, unknown> }];
    remapComponentEntityRefs(comps, new Map([['a', 11]]));
    expect(comps[0].data.joints).toEqual([11, INVALID_ENTITY]);
  });

  it('instantiating the prefab points the list at the joints it created', () => {
    let n = 100;
    const { entities } = expandInstance(rig(), { prefab: '@uuid:r', overrides: [], added: [], removed: [] }, () => n++);
    const idOf = (pid: string): number => entities.find((e) => e.prefabEntityId === pid)!.id;
    const mesh = entities.find((e) => e.prefabEntityId === 'mesh')!;
    expect(mesh.components[0].data.joints).toEqual([idOf('bone0'), idOf('bone1')]);
  });

  // The other half: an unchanged list must diff EQUAL. Comparing runtime numbers
  // against prefab-local strings makes every save write an override full of
  // session-specific ids, which dangle onto unrelated entities on reload.
  it('an untouched list produces no override', () => {
    let n = 200;
    const { entities } = expandInstance(rig(), { prefab: '@uuid:r', overrides: [], added: [], removed: [] }, () => n++);
    const { overrides } = diffAgainstSource(rig(), entities);
    expect(overrides.filter((o) => o.type === 'property' && o.propertyName === 'joints')).toEqual([]);
  });

  it('a reordered list still produces one', () => {
    let n = 300;
    const { entities } = expandInstance(rig(), { prefab: '@uuid:r', overrides: [], added: [], removed: [] }, () => n++);
    const mesh = entities.find((e) => e.prefabEntityId === 'mesh')!;
    mesh.components[0].data.joints = [...(mesh.components[0].data.joints as number[])].reverse();
    const { overrides } = diffAgainstSource(rig(), entities);
    expect(overrides.some((o) => o.type === 'property' && o.propertyName === 'joints')).toBe(true);
  });
});

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
import { expandInstance } from '../src/prefab/sceneInstance';
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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  An entity numbered 0 can be named. 0 is every reference field's "no entity", so a scene's entity 0 and a
 *        prefab root allocated 0 could not be: a field naming them loaded as naming nothing.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent, Transform } from '../src/ecs/component';
import { migrateSceneData, renumberEntityZero, loadSceneData, type SceneData } from '../src/scene/scene';
import { instantiatePrefab, type PrefabData } from '../src/prefab';
import { createMockModule } from './mocks/wasm';

const Aim = defineComponent('EntityZeroAim', { target: 0 }, { entityFields: ['target'] });

const world = (): World => {
  const w = new World();
  const mod = createMockModule();
  w.connectCpp(mod.getRegistry(), mod);
  return w;
};

/** A camera numbered 0 with a child, and a second entity whose reference field holds 0. */
const scene = (): SceneData => ({
  version: 4,
  name: 'Zero',
  entities: [
    { id: 0, name: 'Camera', parent: null, children: [5], components: [{ type: 'Transform', data: {} }] },
    { id: 5, name: 'Lens', parent: 0, children: [], components: [{ type: 'Transform', data: {} }] },
    { id: 3, name: 'Turret', parent: null, children: [], components: [{ type: 'Transform', data: {} }, { type: Aim._name, data: { target: 0 } }] },
  ],
});

const renumbered = (data: SceneData): SceneData => { const copy = structuredClone(data); renumberEntityZero(copy); return copy; };

describe('renumberEntityZero', () => {
  it('gives entity 0 the next id past the highest, and takes its parent and children with it', () => {
    const data = scene();
    expect(renumberEntityZero(data)).toBe(true);
    const camera = data.entities.find((e) => e.name === 'Camera')!;
    const lens = data.entities.find((e) => e.name === 'Lens')!;
    expect(camera.id).toBe(6);
    expect(camera.children).toEqual([5]);
    expect(lens.parent).toBe(6);
    expect(data.entities.some((e) => e.id === 0)).toBe(false);
  });

  it('leaves a reference field holding 0 as none, which is what it always loaded as', () => {
    const data = renumbered(scene());
    const turret = data.entities.find((e) => e.name === 'Turret')!;
    expect(turret.components.find((c) => c.type === Aim._name)!.data.target).toBe(0);
  });

  it('changes nothing in a scene with no entity 0, and gives the same answer the second time', () => {
    const plain = scene();
    plain.entities[0]!.id = 9;
    plain.entities[0]!.children = [5];
    plain.entities[1]!.parent = 9;
    expect(renumberEntityZero(plain)).toBe(false);
    expect(plain.entities.map((e) => e.id)).toEqual([9, 5, 3]);
    const first = renumbered(scene());
    expect(renumbered(first).entities).toEqual(first.entities);
  });

  it('is not done by a load: a caller keeps its own copy of the scene and finds every entity by the ids in it', () => {
    const data = scene();
    const map = loadSceneData(world(), data);
    expect(map.has(0)).toBe(true);
    expect(migrateSceneData(scene()).data.entities[0]!.id).toBe(0);
  });

  it('lets a reference name the renumbered entity once it is loaded', async () => {
    const data = renumbered(scene());
    const camera = data.entities.find((e) => e.name === 'Camera')!;
    const turret = data.entities.find((e) => e.name === 'Turret')!;
    turret.components.find((c) => c.type === Aim._name)!.data.target = camera.id;
    const w = world();
    const map = await loadSceneData(w, data);
    const aimer = map.get(turret.id)!;
    expect(w.get(aimer, Aim).target).toBe(map.get(camera.id));
    expect(w.get(aimer, Aim).target).not.toBe(0);
  });
});

describe('a prefab reference to its own root', () => {
  it('reaches the root once the prefab is placed: the root is no longer allocated 0', async () => {
    const prefab: PrefabData = {
      version: '2', name: 'turret', rootEntityId: 'base', entities: [
        { prefabEntityId: 'base', name: 'Base', parent: null, children: ['head'], visible: true, components: [{ type: 'Transform', data: {} }] },
        { prefabEntityId: 'head', name: 'Head', parent: 'base', children: [], visible: true,
          components: [{ type: 'Transform', data: {} }, { type: Aim._name, data: { target: 'base' } }] },
      ],
    };
    const w = world();
    const placed = await instantiatePrefab(w, prefab);
    const head = [...placed.entities.values()].find((e) => w.has(e, Aim))!;
    expect(w.get(head, Aim).target).toBe(placed.root);
    expect(w.has(placed.root, Transform)).toBe(true);
  });
});

describe('a reference in the numeric-id prefab format', () => {
  it('names the entity with that id, whatever order the ids come in', async () => {
    const legacy = {
      version: '1.0', name: 'legacy', rootEntityId: 5, entities: [
        { prefabEntityId: 5, name: 'Base', parent: null, children: [9], visible: true, components: [{ type: Aim._name, data: { target: 9 } }] },
        { prefabEntityId: 9, name: 'Head', parent: 5, children: [], visible: true, components: [{ type: 'Transform', data: {} }] },
      ],
    } as unknown as PrefabData;
    const w = world();
    const placed = await instantiatePrefab(w, legacy);
    const head = [...placed.entities.values()].find((e) => e !== placed.root)!;
    expect(w.get(placed.root, Aim).target).toBe(head);
  });
});

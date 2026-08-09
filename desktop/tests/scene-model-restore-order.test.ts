// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Undoing a delete puts the entity back WHERE it was.
 *
 *        `data.entities` order is painter order (SceneModel's own note on sibling
 *        order), so a restore that appends moves the entity in front of whatever
 *        it sat behind, and re-saves the file with a reordered list.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { SceneModel } from '@/engine/SceneModel';

/** Four roots plus a parent with three children — enough for "middle" to exist. */
function fixture(): SceneData {
  return {
    version: '1.0',
    name: 'order',
    entities: [
      { id: 1, name: 'A', parent: null, children: [], components: [] },
      { id: 2, name: 'B', parent: null, children: [], components: [] },
      { id: 3, name: 'Group', parent: null, children: [4, 5, 6], components: [] },
      { id: 4, name: 'C1', parent: 3, children: [], components: [] },
      { id: 5, name: 'C2', parent: 3, children: [], components: [] },
      { id: 6, name: 'C3', parent: 3, children: [], components: [] },
      { id: 7, name: 'D', parent: null, children: [], components: [] },
    ],
  } as unknown as SceneData;
}

const order = () => SceneModel.current!.entities.map((e) => e.id);
const childrenOf = (id: number) => SceneModel.entityBySource(id)!.children.slice();

describe('restoring a removed entity', () => {
  beforeEach(() => SceneModel.adopt(fixture(), new Map()));

  it('puts a root back at its own index, not at the end', () => {
    const before = order();
    const rec = SceneModel.removeEntityBySource(2)!;
    expect(order()).toEqual([1, 3, 4, 5, 6, 7]);
    SceneModel.restoreEntities([rec]);
    expect(order()).toEqual(before);
  });

  it('puts a child back at its own slot among its siblings', () => {
    const rec = SceneModel.removeEntityBySource(5)!;
    expect(childrenOf(3)).toEqual([4, 6]);
    SceneModel.restoreEntities([rec]);
    expect(childrenOf(3)).toEqual([4, 5, 6]);
    expect(order()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('restores a whole subtree, parent and children, exactly where it was', () => {
    const before = order();
    const beforeChildren = childrenOf(3);
    // The delete path removes parent-first, over the shrinking array.
    const records = [3, 4, 5, 6].map((id) => SceneModel.removeEntityBySource(id)!);
    expect(order()).toEqual([1, 2, 7]);
    SceneModel.restoreEntities(records);
    expect(order()).toEqual(before);
    expect(childrenOf(3)).toEqual(beforeChildren);
  });

  it('restores several separate removals to their original places', () => {
    const before = order();
    const records = [1, 5, 7].map((id) => SceneModel.removeEntityBySource(id)!);
    SceneModel.restoreEntities(records);
    expect(order()).toEqual(before);
    expect(childrenOf(3)).toEqual([4, 5, 6]);
  });

  it('announces a restored parent before its children', () => {
    const records = [3, 4].map((id) => SceneModel.removeEntityBySource(id)!);
    const added: number[] = [];
    const off = SceneModel.subscribe((e) => {
      if (e.kind === 'entityAdded') added.push(e.sourceId);
    });
    SceneModel.restoreEntities(records);
    off();
    expect(added).toEqual([3, 4]);
  });

  it('appends when the recorded slot no longer exists', () => {
    const rec = SceneModel.removeEntityBySource(7)!; // last root
    SceneModel.removeEntityBySource(1);
    SceneModel.removeEntityBySource(2);
    expect(() => SceneModel.restoreEntities([rec])).not.toThrow();
    expect(order()).toContain(7);
  });
});

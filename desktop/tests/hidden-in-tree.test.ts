// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Editor visibility resolved down the hierarchy — the rule five callers
 *        used to each answer for one entity, which is why hiding a parent left
 *        its children drawing, pickable, and shown as visible.
 */
import { describe, it, expect } from 'vitest';
import { hiddenInTree, hiddenInTreeResolver, type HiddenNode } from '../src/engine/hiddenInTree';
import { buildSceneTree } from '../src/engine/SceneQuery';
import type { SceneData } from 'esengine';

/** `1 → 2 → 3` with whichever of them carry the flag. */
const chain = (...hidden: number[]): Map<number, HiddenNode> => new Map([
  [1, { parent: null, hidden: hidden.includes(1) || undefined }],
  [2, { parent: 1, hidden: hidden.includes(2) || undefined }],
  [3, { parent: 2, hidden: hidden.includes(3) || undefined }],
]);

const ask = (m: Map<number, HiddenNode>) => (id: number) => hiddenInTree(id, (i) => m.get(i));

describe('hiddenInTree', () => {
  it('is false for a chain nobody hid', () => {
    const is = ask(chain());
    expect([is(1), is(2), is(3)]).toEqual([false, false, false]);
  });

  it('hides everything under the entity that carries the flag', () => {
    const is = ask(chain(1));
    expect([is(1), is(2), is(3)]).toEqual([true, true, true]);
  });

  it('leaves what is ABOVE the flag alone', () => {
    const is = ask(chain(2));
    expect([is(1), is(2), is(3)]).toEqual([false, true, true]);
  });

  it('an unknown entity is not hidden — an engine-owned helper has no row', () => {
    expect(hiddenInTree(99, () => undefined)).toBe(false);
  });

  it('a dangling parent stops the walk instead of throwing', () => {
    const m = new Map<number, HiddenNode>([[2, { parent: 404 }]]);
    expect(hiddenInTree(2, (i) => m.get(i))).toBe(false);
  });

  it('a parent cycle terminates — an .esscene is a file a person can edit', () => {
    const m = new Map<number, HiddenNode>([[1, { parent: 2 }], [2, { parent: 1 }]]);
    expect(hiddenInTree(1, (i) => m.get(i))).toBe(false);
  });

  it('a cycle whose member is hidden still answers true', () => {
    const m = new Map<number, HiddenNode>([[1, { parent: 2 }], [2, { parent: 1, hidden: true }]]);
    expect(hiddenInTree(1, (i) => m.get(i))).toBe(true);
  });
});

describe('hiddenInTreeResolver', () => {
  it('agrees with the single-entity walk, memoized', () => {
    const m = chain(2);
    const resolve = hiddenInTreeResolver((i) => m.get(i));
    expect([resolve(3), resolve(2), resolve(1)]).toEqual([true, true, false]);
  });

  it('visits each ancestor once across a whole pass', () => {
    const m = chain();
    let reads = 0;
    const resolve = hiddenInTreeResolver((i) => { reads++; return m.get(i); });
    resolve(3); resolve(2); resolve(1);
    // 3 walks the chain; 2 and 1 are already answered. Without the memo this is
    // 3 + 2 + 1 — the shape that makes a deep UI tree quadratic.
    expect(reads).toBe(3);
  });

  it('caches the answer for every node it passed, not just the one asked', () => {
    const m = chain(1);
    let reads = 0;
    const resolve = hiddenInTreeResolver((i) => { reads++; return m.get(i); });
    expect(resolve(3)).toBe(true);
    const after = reads;
    expect(resolve(2)).toBe(true);
    expect(reads).toBe(after);
  });
});

describe('the outliner tree', () => {
  const scene = (hidden: number[]): SceneData => ({
    version: '1.0',
    name: 'S',
    entities: [
      { id: 1, name: 'Group', parent: null, children: [2], components: [], ...(hidden.includes(1) ? { hidden: true } : {}) },
      { id: 2, name: 'Child', parent: 1, children: [], components: [], ...(hidden.includes(2) ? { hidden: true } : {}) },
    ],
  } as unknown as SceneData);

  it('marks a child of a hidden parent, without touching its own eye', () => {
    const [group] = buildSceneTree(scene([1]));
    const child = group.children![0];
    expect(group).toMatchObject({ visible: false });
    // Its OWN flag is untouched — so the eye still toggles something.
    expect(child.visible).toBe(true);
    expect(child.hiddenByAncestor).toBe(true);
  });

  it('says nothing about ancestry when there is none to report', () => {
    const [group] = buildSceneTree(scene([]));
    expect(group.hiddenByAncestor).toBeUndefined();
    expect(group.children![0].hiddenByAncestor).toBeUndefined();
  });

  it('a child hidden on its own is not blamed on its parent', () => {
    const [group] = buildSceneTree(scene([2]));
    const child = group.children![0];
    expect(child.visible).toBe(false);
    expect(child.hiddenByAncestor).toBeUndefined();
  });
});

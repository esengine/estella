// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SceneModel.selectionRoots — what a selection actually picked.
 *
 * A selection made by dragging or shift-clicking down the Outliner routinely
 * holds a parent AND some of its children, and almost every operation means the
 * subtree rather than each entry. Two acted on the entries: duplicating a parent
 * and its child copied the child twice (once inside the parent's copy), and
 * "Create Prefab" ignored the selection entirely and used whichever entity was
 * right-clicked — a prefab of one of them, silently.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { SceneModel } from '@/engine/SceneModel';

/**
 *   1 Root
 *     ├── 2 Body
 *     │     └── 3 Muzzle
 *     └── 4 Barrel
 *   5 Loose
 */
function scene(): SceneData {
  const e = (id: number, name: string, parent: number | null, children: number[]) =>
    ({ id, name, parent, children, components: [{ type: 'Transform', data: {} }], visible: true });
  return {
    version: '1.0',
    name: 'roots',
    entities: [
      e(1, 'Root', null, [2, 4]),
      e(2, 'Body', 1, [3]),
      e(3, 'Muzzle', 2, []),
      e(4, 'Barrel', 1, []),
      e(5, 'Loose', null, []),
    ],
  } as unknown as SceneData;
}

describe('SceneModel.selectionRoots', () => {
  beforeEach(() => {
    SceneModel.clear();
    SceneModel.adopt(scene(), new Map());
  });

  it('a lone entity is its own root', () => {
    expect(SceneModel.selectionRoots([2])).toEqual([2]);
  });

  it('drops entries an ancestor in the selection already covers', () => {
    // The Outliner selection that produced the bug: a parent and its child.
    expect(SceneModel.selectionRoots([1, 2])).toEqual([1]);
    expect(SceneModel.selectionRoots([1, 2, 3, 4])).toEqual([1]);
  });

  it('looks past an intermediate that is NOT selected', () => {
    // 3's parent (2) is unselected, but its grandparent is — still covered.
    expect(SceneModel.selectionRoots([1, 3])).toEqual([1]);
  });

  it('keeps siblings, which is what makes a selection unprefabbable', () => {
    expect(SceneModel.selectionRoots([2, 4]).sort()).toEqual([2, 4]);
    expect(SceneModel.selectionRoots([1, 5]).sort()).toEqual([1, 5]);
  });

  it('is stable under duplicates and empty input', () => {
    expect(SceneModel.selectionRoots([2, 2, 2])).toEqual([2]);
    expect(SceneModel.selectionRoots([])).toEqual([]);
  });

  it('an id the model does not have is its own root, not a crash', () => {
    // Selections outlive edits; a stale id must not take the walk down with it.
    expect(SceneModel.selectionRoots([999])).toEqual([999]);
  });
});

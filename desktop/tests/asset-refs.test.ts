// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Reverse asset-dependency lookup — which scenes/prefabs reference an asset,
 *        backing the delete-in-use warning. Pure over the index shape.
 */
import { describe, it, expect } from 'vitest';
import { referencingPaths, type AssetIndexLike } from '@/project/assetRefs';

const index: AssetIndexLike = {
  entries: [
    { uuid: 'tex1', path: 'assets/hero.png' },
    { uuid: 'tex2', path: 'assets/unused.png' },
    { uuid: 'scnA', path: 'scenes/main.esscene' },
    { uuid: 'scnB', path: 'scenes/level2.esscene' },
    { uuid: 'pfb1', path: 'prefabs/enemy.esprefab' },
  ],
  deps: {
    scnA: ['tex1', 'pfb1'],
    scnB: ['tex1'],
    pfb1: ['tex1'],
  },
};

describe('referencingPaths', () => {
  it('lists every scene/prefab that references an asset', () => {
    expect(referencingPaths(index, 'assets/hero.png').sort()).toEqual([
      'prefabs/enemy.esprefab',
      'scenes/level2.esscene',
      'scenes/main.esscene',
    ]);
  });

  it('is empty for an unreferenced asset', () => {
    expect(referencingPaths(index, 'assets/unused.png')).toEqual([]);
  });

  it('is empty for an untracked path (e.g. a folder)', () => {
    expect(referencingPaths(index, 'assets/folder')).toEqual([]);
  });

  it('lists a scene that references a prefab (prefabs are referenceable assets too)', () => {
    expect(referencingPaths(index, 'prefabs/enemy.esprefab')).toEqual(['scenes/main.esscene']);
  });

  it('never lists the asset itself (a self-referencing edge is excluded)', () => {
    const selfLoop: AssetIndexLike = {
      entries: [{ uuid: 'a', path: 'a.esscene' }],
      deps: { a: ['a'] },
    };
    expect(referencingPaths(selfLoop, 'a.esscene')).toEqual([]);
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Usage collection for delete-confirm / Find Usages: the on-disk dep
 *        graph merged with the UNSAVED in-memory scene — the graph is built from
 *        files, so a reference added since the last save is invisible to it.
 */
import { describe, it, expect } from 'vitest';
import {
  collectAssetUsages,
  valueReferencesAsset,
  type AssetIndexLike,
} from '@/project/assetRefs';

const HERO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCENE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const index: AssetIndexLike = {
  entries: [
    { uuid: HERO, path: 'assets/hero.png' },
    { uuid: SCENE, path: 'scenes/main.esscene' },
  ],
  deps: { [SCENE]: [HERO] },
};

describe('valueReferencesAsset', () => {
  const target = { uuid: HERO, path: 'assets/hero.png' };

  it('finds @uuid: refs nested anywhere in the tree (case-insensitive)', () => {
    const data = { entities: [{ components: [{ type: 'Sprite', data: { texture: `@uuid:${HERO.toUpperCase()}` } }] }] };
    expect(valueReferencesAsset(data, target)).toBe(true);
  });

  it('finds bare-uuid and exact-path refs', () => {
    expect(valueReferencesAsset({ frames: [HERO] }, target)).toBe(true);
    expect(valueReferencesAsset({ skeletonPath: 'assets/hero.png' }, target)).toBe(true);
  });

  it('rejects other uuids, other paths, and partial path matches', () => {
    expect(valueReferencesAsset({ texture: `@uuid:${SCENE}` }, target)).toBe(false);
    expect(valueReferencesAsset({ p: 'assets/hero.png.meta' }, target)).toBe(false);
    expect(valueReferencesAsset(null, target)).toBe(false);
  });

  it('matches by path even when the asset is untracked (uuid null)', () => {
    expect(valueReferencesAsset({ p: 'assets/loose.png' }, { uuid: null, path: 'assets/loose.png' })).toBe(true);
    expect(valueReferencesAsset({ p: HERO }, { uuid: null, path: 'assets/loose.png' })).toBe(false);
  });
});

describe('collectAssetUsages', () => {
  const refScene = (uuid: string) => ({
    entities: [{ components: [{ type: 'Sprite', data: { texture: `@uuid:${uuid}` } }] }],
  });

  it('reports disk-graph references without a live scene', () => {
    expect(collectAssetUsages(index, 'assets/hero.png')).toEqual([
      { path: 'scenes/main.esscene', unsaved: false },
    ]);
  });

  it('adds the unsaved in-memory scene when only IT references the asset', () => {
    const noDeps: AssetIndexLike = { ...index, deps: {} };
    const usages = collectAssetUsages(noDeps, 'assets/hero.png', {
      path: 'scenes/other.esscene',
      data: refScene(HERO),
    });
    expect(usages).toEqual([{ path: 'scenes/other.esscene', unsaved: true }]);
  });

  it('reports the untitled unsaved scene as path null', () => {
    const noDeps: AssetIndexLike = { ...index, deps: {} };
    const usages = collectAssetUsages(noDeps, 'assets/hero.png', { path: null, data: refScene(HERO) });
    expect(usages).toEqual([{ path: null, unsaved: true }]);
  });

  it('does not duplicate a scene already reported from disk', () => {
    const usages = collectAssetUsages(index, 'assets/hero.png', {
      path: 'scenes/main.esscene',
      data: refScene(HERO),
    });
    expect(usages).toEqual([{ path: 'scenes/main.esscene', unsaved: false }]);
  });

  it('keeps the disk entry when the live model no longer references (file still does)', () => {
    const usages = collectAssetUsages(index, 'assets/hero.png', {
      path: 'scenes/main.esscene',
      data: refScene(SCENE),
    });
    expect(usages).toEqual([{ path: 'scenes/main.esscene', unsaved: false }]);
  });
});

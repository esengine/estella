// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Content Browser pure search/filter/sort — query-token parsing, the type
 *        filter (tokens + chips, prefix match), and sort order.
 */
import { describe, it, expect } from 'vitest';
import { parseAssetQuery, filterAndSortAssets, type AssetSort, type AssetRowLike } from '@/project/assetFilter';

// Typed by PATH, as the panel does: the registry — not the bare name — is what
// can answer for a file whose name doesn't declare its kind.
const typeOf = (path: string): string => {
  if (path.endsWith('.png')) return 'texture';
  if (path.endsWith('.esmat')) return 'material';
  if (path.endsWith('.esscene')) return 'scene';
  if (path === 'assets/skeleton.json') return 'spine';
  return 'other';
};
const E = (name: string, isDir = false): AssetRowLike => ({ name, path: `assets/${name}`, isDir });
const entries: AssetRowLike[] = [
  E('zfolder', true),
  E('afolder', true),
  E('villain.png'),
  E('hero.png'),
  E('ground.esmat'),
  E('main.esscene'),
  E('skeleton.json'),
];
const run = (q: string, chips: string[] = [], sort: AssetSort = 'name') =>
  filterAndSortAssets(entries, parseAssetQuery(q), new Set(chips), sort, typeOf).map((e) => e.name);

describe('parseAssetQuery', () => {
  it('splits free text from type tokens', () => {
    expect(parseAssetQuery('hero type:texture')).toEqual({ text: 'hero', types: ['texture'] });
    expect(parseAssetQuery('t:mat foo bar')).toEqual({ text: 'foo bar', types: ['mat'] });
    expect(parseAssetQuery('   ')).toEqual({ text: '', types: [] });
  });
});

describe('filterAndSortAssets', () => {
  it('free text matches names (files and folders)', () => {
    expect(run('hero')).toEqual(['hero.png']);
    expect(run('folder')).toEqual(['afolder', 'zfolder']); // folders sorted, files excluded
  });

  it('a type token filters files by type and hides folders', () => {
    expect(run('type:texture')).toEqual(['hero.png', 'villain.png']);
    expect(run('t:tex')).toEqual(['hero.png', 'villain.png']); // prefix match
  });

  it('type chips filter the same way', () => {
    expect(run('', ['material'])).toEqual(['ground.esmat']);
  });

  it('combines text and type', () => {
    expect(run('villain type:texture')).toEqual(['villain.png']);
  });

  it('sort=name lists folders first, then files alphabetically', () => {
    expect(run('')).toEqual([
      'afolder', 'zfolder', 'ground.esmat', 'hero.png', 'main.esscene', 'skeleton.json', 'villain.png',
    ]);
  });

  it('sort=type groups files by type after the folders', () => {
    // material, scene, spine, texture, texture — folders first.
    expect(run('', [], 'type')).toEqual([
      'afolder', 'zfolder', 'ground.esmat', 'main.esscene', 'skeleton.json', 'hero.png', 'villain.png',
    ]);
  });

  it('types a row by its PATH, so a name that cannot declare its kind still filters', () => {
    // A Spine JSON skeleton is a plain `.json`; only the registry knows it is spine.
    expect(run('type:spine')).toEqual(['skeleton.json']);
  });

  it('is generic — preserves extra row fields (e.g. a full path for recursive search)', () => {
    const rows = [
      { path: 'a/hero.png', name: 'hero.png', isDir: false },
      { path: 'b/sub/villain.png', name: 'villain.png', isDir: false },
    ];
    const out = filterAndSortAssets(rows, parseAssetQuery('type:texture'), new Set(), 'name', typeOf);
    expect(out.map((r) => r.path)).toEqual(['a/hero.png', 'b/sub/villain.png']);
  });
});

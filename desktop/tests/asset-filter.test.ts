// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Content Browser pure search/filter/sort — query-token parsing, the type
 *        filter (tokens + chips, prefix match), and sort order.
 */
import { describe, it, expect } from 'vitest';
import { parseAssetQuery, filterAndSortAssets, type AssetSort } from '@/project/assetFilter';
import type { DirEntry } from '@/project/format';

const typeOf = (name: string): string => {
  if (name.endsWith('.png')) return 'texture';
  if (name.endsWith('.esmat')) return 'material';
  if (name.endsWith('.esscene')) return 'scene';
  return 'other';
};
const E = (name: string, isDir = false): DirEntry => ({ name, isDir });
const entries: DirEntry[] = [
  E('zfolder', true),
  E('afolder', true),
  E('villain.png'),
  E('hero.png'),
  E('ground.esmat'),
  E('main.esscene'),
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
    expect(run('')).toEqual(['afolder', 'zfolder', 'ground.esmat', 'hero.png', 'main.esscene', 'villain.png']);
  });

  it('sort=type groups files by type after the folders', () => {
    // material, scene, texture, texture — folders first.
    expect(run('', [], 'type')).toEqual(['afolder', 'zfolder', 'ground.esmat', 'main.esscene', 'hero.png', 'villain.png']);
  });
});

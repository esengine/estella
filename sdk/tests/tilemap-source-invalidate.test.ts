// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Tilemap source hot-reload contract: `Assets.invalidate` reaches the
 *        loader's `invalidate`, which must sever the GLOBAL source registration
 *        (tilesetCache) too — dropping only the Assets-level cache would leave
 *        the tilemap sync rendering the stale parse forever. The sync detects
 *        the vanished/replaced entry by object identity and re-derives.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  registerTilemapSource, getTilemapSource, unregisterTilemapSource,
  clearTilemapSourceCache, type LoadedTilemapSource,
} from '../src/tilemap/tilesetCache';
import { TilemapAssetLoader } from '../src/asset/loaders/TilemapAssetLoader';

const SRC: LoadedTilemapSource = {
  tileWidth: 16, tileHeight: 16, layers: [], tilesets: [],
};

afterEach(() => clearTilemapSourceCache());

describe('tilemap source invalidation', () => {
  it('unregisterTilemapSource drops the entry and reports whether it was held', () => {
    registerTilemapSource('assets/maps/level.tmj', SRC);
    expect(getTilemapSource('assets/maps/level.tmj')).toBe(SRC);
    expect(unregisterTilemapSource('assets/maps/level.tmj')).toBe(true);
    expect(getTilemapSource('assets/maps/level.tmj')).toBeUndefined();
    expect(unregisterTilemapSource('assets/maps/level.tmj')).toBe(false);
  });

  it('TilemapAssetLoader.invalidate severs the global registration', () => {
    const loader = new TilemapAssetLoader();
    registerTilemapSource('assets/maps/level.tmj', SRC);
    expect(loader.invalidate('assets/maps/level.tmj')).toBe(true);
    expect(getTilemapSource('assets/maps/level.tmj')).toBeUndefined();
    expect(loader.invalidate('assets/maps/level.tmj')).toBe(false);
  });

  it('a re-registered source is a NEW object — the identity the sync re-derives on', () => {
    registerTilemapSource('assets/maps/level.tmj', SRC);
    const before = getTilemapSource('assets/maps/level.tmj');
    const fresh: LoadedTilemapSource = { ...SRC };
    registerTilemapSource('assets/maps/level.tmj', fresh);
    expect(getTilemapSource('assets/maps/level.tmj')).toBe(fresh);
    expect(getTilemapSource('assets/maps/level.tmj')).not.toBe(before);
  });
});

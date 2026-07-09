// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  TilemapLiveSync forwarding contract — the editor→runtime channel for a
 *        layer's `.estileset` ref list. The plugin binds its ref-apply in build()
 *        and clears it in cleanup(); the editor pushes ref-list changes through
 *        setLayerTilesets. Guards that pushes reach the bound plugin, that an
 *        unbound channel is inert (no runtime), and that cleanup stops delivery.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TilemapLiveSync } from '../src/tilemap/tilemapLiveSync';

describe('TilemapLiveSync', () => {
  beforeEach(() => TilemapLiveSync._bind(null));
  afterEach(() => TilemapLiveSync._bind(null));

  it('forwards setLayerTilesets to the bound apply fn', () => {
    const calls: Array<{ entity: number; refs: string[] }> = [];
    TilemapLiveSync._bind((entity, refs) => calls.push({ entity, refs: [...refs] }));
    TilemapLiveSync.setLayerTilesets(7, ['@uuid:a', '@uuid:b']);
    expect(calls).toEqual([{ entity: 7, refs: ['@uuid:a', '@uuid:b'] }]);
  });

  it('is a no-op when unbound (no runtime plugin has built)', () => {
    expect(() => TilemapLiveSync.setLayerTilesets(1, ['@uuid:x'])).not.toThrow();
  });

  it('an empty list still forwards (clears a layer to zero tilesets)', () => {
    let seen: readonly string[] | null = null;
    TilemapLiveSync._bind((_e, refs) => { seen = refs; });
    TilemapLiveSync.setLayerTilesets(3, []);
    expect(seen).toEqual([]);
  });

  it('cleanup (unbind) stops delivery — a later push is inert', () => {
    let count = 0;
    TilemapLiveSync._bind(() => { count++; });
    TilemapLiveSync.setLayerTilesets(1, ['@uuid:a']);
    TilemapLiveSync._bind(null); // plugin.cleanup()
    TilemapLiveSync.setLayerTilesets(1, ['@uuid:a']);
    expect(count).toBe(1);
  });

  it('rebinding points delivery at the newest plugin (world rebuild)', () => {
    const a: number[] = [];
    const b: number[] = [];
    TilemapLiveSync._bind((e) => a.push(e));
    TilemapLiveSync._bind((e) => b.push(e)); // a second build() replaces the binding
    TilemapLiveSync.setLayerTilesets(5, ['@uuid:a']);
    expect(a).toEqual([]);
    expect(b).toEqual([5]);
  });
});

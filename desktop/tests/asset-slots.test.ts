// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { ASSET_SLOTS, metaTypeToSlot } from '../src/project/assetSlots';

describe('ASSET_SLOTS', () => {
  it('metaTypeToSlot only ever returns a slot that exists in the table', () => {
    // The whole point of the single table: a meta-type can never resolve to a slot
    // with no loader (the drift the two-switch design allowed).
    for (const [slot, def] of Object.entries(ASSET_SLOTS)) {
      for (const mt of def.metaTypes) {
        expect(metaTypeToSlot(mt)).toBe(slot);
        expect(ASSET_SLOTS[metaTypeToSlot(mt)!]).toBeDefined();
      }
    }
  });

  it('no two slots claim the same meta-type', () => {
    const seen = new Set<string>();
    for (const def of Object.values(ASSET_SLOTS)) {
      for (const mt of def.metaTypes) {
        expect(seen.has(mt), `duplicate meta-type "${mt}"`).toBe(false);
        seen.add(mt);
      }
    }
  });

  it('preserves the known meta-type → slot mapping', () => {
    expect(metaTypeToSlot('texture')).toBe('texture');
    expect(metaTypeToSlot('material')).toBe('material');
    expect(metaTypeToSlot('font')).toBe('font');
    expect(metaTypeToSlot('bitmapFont')).toBe('font');
    expect(metaTypeToSlot('audio')).toBe('audio');
    expect(metaTypeToSlot('video')).toBe('video');
    expect(metaTypeToSlot('animclip')).toBe('anim-clip');
    expect(metaTypeToSlot('animation')).toBe('timeline');
    expect(metaTypeToSlot('tilemap')).toBe('tilemap');
    expect(metaTypeToSlot('tileset')).toBe('tileset');
    expect(metaTypeToSlot('statemachine')).toBe('statemachine');
    expect(metaTypeToSlot('animatorcontroller')).toBe('animatorcontroller');
    expect(metaTypeToSlot('behaviortree')).toBe('behaviortree');
  });

  it('returns null for types with no component slot', () => {
    expect(metaTypeToSlot(undefined)).toBeNull();
    expect(metaTypeToSlot('scene')).toBeNull();
    expect(metaTypeToSlot('shader')).toBeNull();
    expect(metaTypeToSlot('prefab')).toBeNull();
    expect(metaTypeToSlot('unknown-type')).toBeNull();
  });

  it('only material/font capture a handle (the slots with no live cache getter)', () => {
    const recorded = Object.entries(ASSET_SLOTS).filter(([, d]) => d.record).map(([s]) => s).sort();
    expect(recorded).toEqual(['font', 'material']);
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { ASSET_SLOTS, metaTypeToSlot } from '../src/project/assetSlots';
import { getComponentRegistry, getComponentAssetFieldDescriptors } from 'esengine';

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
    expect(metaTypeToSlot('mesh')).toBe('mesh');
  });

  it('returns null for types with no component slot', () => {
    expect(metaTypeToSlot(undefined)).toBeNull();
    expect(metaTypeToSlot('scene')).toBeNull();
    expect(metaTypeToSlot('shader')).toBeNull();
    expect(metaTypeToSlot('prefab')).toBeNull();
    expect(metaTypeToSlot('unknown-type')).toBeNull();
  });

  it('the handle slots are the ones with no live cache getter', () => {
    const recorded = Object.entries(ASSET_SLOTS).filter(([, d]) => d.record).map(([s]) => s).sort();
    expect(recorded).toEqual(['font', 'material', 'mesh']);
  });

  it('every asset field a component declares has a slot to load it from', () => {
    // A field the Inspector offers but nothing can load resolves to handle 0 —
    // the asset silently missing, which is how mesh shipped before this entry.
    const declared = new Set<string>();
    for (const name of getComponentRegistry().keys()) {
      for (const f of getComponentAssetFieldDescriptors(name)) declared.add(f.type);
    }
    // Spine halves load through their own two-phase manager, not a slot.
    declared.delete('spine-skeleton');
    declared.delete('spine-atlas');
    for (const type of declared) {
      expect(ASSET_SLOTS[type], `no slot for asset field type "${type}"`).toBeDefined();
    }
  });
});

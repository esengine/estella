// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Field constraints C1 — range enforcement lowered to the single write door,
 *        and asset-type restriction on drag-drop. clampFieldValue is what makes EVERY
 *        writer (inspector, PlayInspect, material) range-bounded, not just the Details
 *        UI; assetTypeAllowed is the drag-drop type guard. Pure TS.
 */
import { describe, it, expect } from 'vitest';
import { clampFieldValue, isRequiredField, setUserSchemas, componentAuthorability } from '@/engine/schema';
import { AssetRegistry } from '@/project/AssetRegistry';

describe('field constraints (C1: write-gate clamp + asset-type guard)', () => {
  it('clampFieldValue bounds a scalar to its declared min/max; passes everything else through', () => {
    setUserSchemas([{ name: 'Ranged', fields: { hp: { min: 0, max: 100 } } }] as never);
    expect(clampFieldValue('Ranged', 'hp', 150)).toBe(100);
    expect(clampFieldValue('Ranged', 'hp', -5)).toBe(0);
    expect(clampFieldValue('Ranged', 'hp', 42)).toBe(42);
    expect(clampFieldValue('Ranged', 'hp', 'str')).toBe('str'); // non-number → passthrough
    expect(clampFieldValue('Ranged', 'unbounded', 9999)).toBe(9999); // no meta → unchanged
    setUserSchemas([]);
  });

  it('assetTypeAllowed enforces the slot type by extension (the drag-drop guard)', () => {
    expect(AssetRegistry.assetTypeAllowed('texture', 'assets/hero.png')).toBe(true);
    expect(AssetRegistry.assetTypeAllowed('texture', 'assets/thing.esprefab')).toBe(false);
    expect(AssetRegistry.assetTypeAllowed(undefined, 'assets/anything.xyz')).toBe(true); // unconstrained slot
  });

  // Whether a component may be authored at all was enforced only while building
  // the Add Component list, so the two doors that don't build that list — the
  // command, and the automation surface — would author one anyway.
  it('componentAuthorability refuses what has its own door, and runtime-only state', () => {
    // Structural / owns-its-own-panel: authored through setEventBindings, the
    // Controllers panel, setParent, renameEntity — not as a component.
    for (const name of ['EventBinding', 'UIController', 'UIGear', 'Parent', 'Children', 'Name']) {
      const v = componentAuthorability(name);
      expect(v.ok).toBe(false);
      expect(v.ok === false && v.reason).toBe('hidden');
    }
    // An ordinary component stays addable, and so does a project script component
    // the engine registry has never heard of.
    expect(componentAuthorability('Sprite').ok).toBe(true);
    expect(componentAuthorability('SomeProjectScript').ok).toBe(true);
  });

  it('isRequiredField flags builtin required asset fields + user-schema required (C2)', () => {
    expect(isRequiredField('Sprite', 'texture')).toBe(true);
    expect(isRequiredField('Sprite', 'material')).toBe(false); // optional override
    expect(isRequiredField('SpineAnimation', 'skeletonPath')).toBe(true);
    setUserSchemas([{ name: 'Foo', fields: { title: { required: true } } }] as never);
    expect(isRequiredField('Foo', 'title')).toBe(true);
    expect(isRequiredField('Foo', 'other')).toBe(false);
    setUserSchemas([]);
  });
});

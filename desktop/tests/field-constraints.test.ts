// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Field constraints C1 — range enforcement lowered to the single write door,
 *        and asset-type restriction on drag-drop. clampFieldValue is what makes EVERY
 *        writer (inspector, PlayInspect, material) range-bounded, not just the Details
 *        UI; assetTypeAllowed is the drag-drop type guard. Pure TS.
 */
import { describe, it, expect } from 'vitest';
import { clampFieldValue, setUserSchemas } from '@/engine/schema';
import { ProjectStore } from '@/project/ProjectStore';

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
    expect(ProjectStore.assetTypeAllowed('texture', 'assets/hero.png')).toBe(true);
    expect(ProjectStore.assetTypeAllowed('texture', 'assets/thing.esprefab')).toBe(false);
    expect(ProjectStore.assetTypeAllowed(undefined, 'assets/anything.xyz')).toBe(true); // unconstrained slot
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { NEW_ASSET_TYPES } from '../src/project/newAssetTypes';

describe('NEW_ASSET_TYPES', () => {
  it('every entry is either a direct creator or a template submenu, never both/neither', () => {
    for (const a of NEW_ASSET_TYPES) {
      const direct = typeof a.create === 'function';
      const submenu = typeof a.templates === 'function';
      expect(direct !== submenu, `${a.labelKey} must have exactly one of create/templates`).toBe(true);
    }
  });

  it('only blank-file (direct) creators carry an error toast key', () => {
    // Template submenus and editor-backed creators toast themselves.
    for (const a of NEW_ASSET_TYPES) {
      if (a.errorKey) expect(typeof a.create).toBe('function');
    }
  });

  it('label keys are unique (no accidental duplicate menu row)', () => {
    const keys = NEW_ASSET_TYPES.map((a) => a.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('template submenus resolve to at least one creator each', () => {
    for (const a of NEW_ASSET_TYPES) {
      if (a.templates) {
        const items = a.templates();
        expect(items.length).toBeGreaterThan(0);
        for (const it of items) expect(typeof it.create).toBe('function');
      }
    }
  });

  it('covers the expected creatable types', () => {
    expect(NEW_ASSET_TYPES.map((a) => a.labelKey)).toEqual([
      'cb.menuNewScene',
      'cb.menuNewAnimation',
      'cb.menuNewInputMap',
      'cb.menuNewLocaleTable',
      'cb.menuNewMaterial',
      'cb.menuNewMaterialGraph',
      'cb.menuNewShader',
      'cb.menuNewStateMachine',
      'cb.menuNewAnimatorController',
      'cb.menuNewBehaviorTree',
    ]);
  });
});

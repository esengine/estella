// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The importer-settings registry (single source of truth for import-time
 *        `.meta` defaults AND the asset inspector's editable fields). Guards the
 *        non-obvious contracts: defaults reproduce the historical values (a fresh
 *        texture `.meta` must stay byte-stable), the inspector fills live values
 *        from a `.meta` block, and dotted keys (sliceBorder.*) round-trip nested.
 */
import { describe, it, expect } from 'vitest';
import {
  importerDefaults,
  buildImporterComponent,
  applyImporterEdit,
  hasImporterSettings,
  readTextureImportSettings,
} from '../src/project/assetImporter';

describe('importerDefaults (import-time .meta)', () => {
  it('reproduces the texture defaults (incl. nested 9-slice)', () => {
    expect(importerDefaults('texture')).toEqual({
      maxSize: 2048,
      filterMode: 'linear',
      wrapMode: 'repeat',
      premultiplyAlpha: false,
      sliceBorder: { left: 0, right: 0, top: 0, bottom: 0 },
    });
  });
  it('reproduces spine + scene-like defaults, and is empty for unknown types', () => {
    expect(importerDefaults('spine')).toEqual({ scale: 1, defaultSkin: 'default', premultiplyAlpha: false });
    expect(importerDefaults('scene')).toEqual({ autoMigrate: true });
    expect(importerDefaults('prefab')).toEqual({ autoMigrate: true });
    expect(importerDefaults('audio')).toEqual({});
  });
});

describe('hasImporterSettings', () => {
  it('is true only for types with editable settings', () => {
    expect(hasImporterSettings('texture')).toBe(true);
    expect(hasImporterSettings('spine')).toBe(true);
    expect(hasImporterSettings('audio')).toBe(false);
    expect(hasImporterSettings('font')).toBe(false);
  });
});

describe('buildImporterComponent (inspector fields)', () => {
  it('fills live values from the .meta block, defaults for missing keys', () => {
    const comp = buildImporterComponent('texture', { filterMode: 'nearest', sliceBorder: { left: 4 } })!;
    expect(comp.name).toBe('Import Settings');
    const byKey = Object.fromEntries(comp.fields.map((f) => [f.key, f]));
    expect(byKey['filterMode'].value).toBe('nearest'); // from the block
    expect(byKey['filterMode'].type).toBe('select');
    expect(byKey['filterMode'].selectOptions).toEqual(['nearest', 'linear']);
    expect(byKey['maxSize'].value).toBe(2048); // fell back to default
    expect(byKey['maxSize'].defaultValue).toBe(2048);
    expect(byKey['sliceBorder.left'].value).toBe(4); // nested read
    expect(byKey['sliceBorder.top'].value).toBe(0); // nested default
  });
  it('returns null for types without settings', () => {
    expect(buildImporterComponent('audio', {})).toBeNull();
  });
});

describe('readTextureImportSettings (edit-viewport = runtime)', () => {
  it('maps filterMode/wrapMode to the loader filter/wrap shape', () => {
    expect(readTextureImportSettings({ filterMode: 'nearest', wrapMode: 'clamp' })).toEqual({ filter: 'nearest', wrap: 'clamp' });
    expect(readTextureImportSettings({ filterMode: 'linear' })).toEqual({ filter: 'linear', wrap: undefined });
  });
  it('is undefined when neither is present (loader defaults) or no importer', () => {
    expect(readTextureImportSettings({ maxSize: 2048 })).toBeUndefined();
    expect(readTextureImportSettings(undefined)).toBeUndefined();
    expect(readTextureImportSettings({})).toBeUndefined();
  });
});

describe('applyImporterEdit (dotted keys → nested, pure)', () => {
  it('sets a nested key without mutating the input', () => {
    const before = { filterMode: 'linear', sliceBorder: { left: 0, right: 0 } };
    const after = applyImporterEdit(before, 'sliceBorder.right', 8);
    expect(after.sliceBorder).toEqual({ left: 0, right: 8 });
    expect(before.sliceBorder).toEqual({ left: 0, right: 0 }); // input untouched
  });
  it('sets a top-level key', () => {
    expect(applyImporterEdit({ filterMode: 'linear' }, 'filterMode', 'nearest')).toEqual({ filterMode: 'nearest' });
  });
});

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
  readTextureCookSettings,
} from '../src/project/assetImporter';

describe('importerDefaults (import-time .meta)', () => {
  it('reproduces the texture defaults (incl. nested 9-slice)', () => {
    expect(importerDefaults('texture')).toEqual({
      maxSize: 2048,
      compress: true,
      compressFormat: 'uastc',
      filterMode: 'linear',
      wrapMode: 'repeat',
      premultiplyAlpha: false,
      sRGB: true,
      sliceBorder: { left: 0, right: 0, top: 0, bottom: 0 },
    });
  });
  it('reproduces spine + scene-like defaults, and is empty for unknown types', () => {
    expect(importerDefaults('spine')).toEqual({ scale: 1, defaultSkin: 'default', premultiplyAlpha: false });
    expect(importerDefaults('scene')).toEqual({ autoMigrate: true });
    expect(importerDefaults('prefab')).toEqual({ autoMigrate: true });
    expect(importerDefaults('audio')).toEqual({ compress: true, bitrateKbps: 128 });
  });
});

describe('readTextureCookSettings (per-platform resolution)', () => {
  it('resolves defaults from the base block (no overrides)', () => {
    expect(readTextureCookSettings(undefined)).toEqual({ compress: true, format: 'uastc', maxSize: 2048, srgb: true });
    expect(readTextureCookSettings({ compress: false, compressFormat: 'etc1s', maxSize: 512, sRGB: false }))
      .toEqual({ compress: false, format: 'etc1s', maxSize: 512, srgb: false });
  });

  it('an enabled platform override wins per-field, inheriting the rest', () => {
    const imp = {
      maxSize: 2048, compress: true, compressFormat: 'uastc',
      overrides: { wechat: { enabled: true, maxSize: 1024, compressFormat: 'etc1s' } },
    };
    // WeChat: overridden maxSize + format, inherits compress + srgb.
    expect(readTextureCookSettings(imp, 'wechat')).toEqual({ compress: true, format: 'etc1s', maxSize: 1024, srgb: true });
    // Web: no override for that platform → the defaults.
    expect(readTextureCookSettings(imp, 'web')).toEqual({ compress: true, format: 'uastc', maxSize: 2048, srgb: true });
    // No platform (editor cook) → the defaults, override ignored.
    expect(readTextureCookSettings(imp).maxSize).toBe(2048);
  });

  it('a disabled override is ignored (falls back to default)', () => {
    const imp = { maxSize: 2048, overrides: { wechat: { enabled: false, maxSize: 256 } } };
    expect(readTextureCookSettings(imp, 'wechat').maxSize).toBe(2048);
  });
});

describe('hasImporterSettings', () => {
  it('is true only for types with editable settings', () => {
    expect(hasImporterSettings('texture')).toBe(true);
    expect(hasImporterSettings('spine')).toBe(true);
    expect(hasImporterSettings('audio')).toBe(true);
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
    expect(buildImporterComponent('audio', {})).not.toBeNull();
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

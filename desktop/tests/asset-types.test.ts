// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { assetTypeOf, ASSET_TYPES } from '@/project/assetTypes';
import { TYPE_CODE } from '@/project/assetMeta';

describe('asset type registry', () => {
  it('maps file extensions to the editor asset type', () => {
    expect(assetTypeOf('a.esscene')).toBe('scene');
    expect(assetTypeOf('a.png')).toBe('texture');
    expect(assetTypeOf('a.webp')).toBe('texture');
    expect(assetTypeOf('a.jpg')).toBe('sprite');
    expect(assetTypeOf('a.gif')).toBe('sprite');
    expect(assetTypeOf('a.ogg')).toBe('audio');
    expect(assetTypeOf('a.ts')).toBe('script');
    expect(assetTypeOf('a.atlas')).toBe('spine');
    expect(assetTypeOf('a.skel')).toBe('spine');
    expect(assetTypeOf('a.esprefab')).toBe('prefab');
    expect(assetTypeOf('a.esmaterial')).toBe('material'); // real ext (SDK loader)
    expect(assetTypeOf('a.esmat')).toBe('material'); // legacy alias
    expect(assetTypeOf('a.esmat')).toBe('material');
    expect(assetTypeOf('a.esanim')).toBe('animation');
    expect(assetTypeOf('a.estimeline')).toBe('animation');
    expect(assetTypeOf('a.estileset')).toBe('tileset');
    expect(assetTypeOf('a.estilemap')).toBe('tilemap');
    expect(assetTypeOf('a.bogus')).toBe('file');
    expect(assetTypeOf('noextension')).toBe('file');
  });

  it('derives TYPE_CODE badges from the registry', () => {
    expect(TYPE_CODE.scene).toBe('SCN');
    expect(TYPE_CODE.tileset).toBe('TST');
    expect(TYPE_CODE.folder).toBe('');
    for (const [type, def] of Object.entries(ASSET_TYPES)) {
      expect(TYPE_CODE[type as keyof typeof TYPE_CODE]).toBe(def.badge);
    }
  });

  it('every type carries an icon and tint', () => {
    for (const def of Object.values(ASSET_TYPES)) {
      expect(def.icon).toBeTruthy();
      expect(def.tint).toBeTruthy();
    }
  });
});

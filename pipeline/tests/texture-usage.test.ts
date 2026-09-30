// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * What a texture's Auto compression resolves by: whether a mesh draws it, directly
 * or through its material — and what an older `.meta` means by its boolean.
 */
import { describe, it, expect } from 'vitest';
import { texturesDrawnIn3D, meshTextureRoles } from '../src/assets/textureUsage';
import { readTextureCookSettings, textureCompression } from '../src/project/importSettings';
import type { AssetEntry } from '../src/assets/assetDb';

const entry = (uuid: string, path: string, type: string): AssetEntry => ({ uuid, path, type });

describe('texturesDrawnIn3D', () => {
  it('finds a mesh\'s own textures and its material\'s, and not a sprite\'s', async () => {
    const entries = [
      entry('scene', 'assets/scenes/main.esscene', 'scene'),
      entry('prefab', 'assets/models/cafe/cafe.esprefab', 'prefab'),
      entry('mat', 'assets/models/cafe/wood.esmaterial', 'material'),
      entry('albedo', 'assets/models/cafe/wood_albedo.png', 'texture'),
      entry('normal', 'assets/models/cafe/wood_normal.png', 'texture'),
      entry('floor', 'assets/textures/floor.png', 'texture'),
      entry('lightmap', 'assets/scenes/main_lightmap.png', 'texture'),
      entry('hud', 'assets/ui/hud.png', 'texture'),
      entry('both', 'assets/textures/crate.png', 'texture'),
    ];
    const files: Record<string, unknown> = {
      'assets/scenes/main.esscene': { entities: [
        { components: [{ type: 'MeshRenderer', data: { texture: '@uuid:floor' } }, { type: 'MeshLightmap', data: { lightmap: 'assets/scenes/main_lightmap.png' } }] },
        { components: [{ type: 'Sprite', data: { texture: '@uuid:hud' } }] },
        { components: [{ type: 'Sprite', data: { texture: '@uuid:both' } }] },
        { components: [{ type: 'MeshRenderer', data: { texture: 'assets/textures/crate.png' } }] },
      ] },
      // A prefab from an import names its material beside it, relative to itself.
      'assets/models/cafe/cafe.esprefab': { entities: [
        { components: [{ type: 'MeshRenderer', data: { material: 'wood.esmaterial' } }] },
      ] },
      'assets/models/cafe/wood.esmaterial': { shader: 'builtin:model', properties: {
        u_albedoMap: 'wood_albedo.png', u_normalMap: '@uuid:normal', u_roughness: 0.5 } },
    };
    const drawn = await texturesDrawnIn3D('/p', entries, async (f) => JSON.stringify(files[f]));
    expect([...drawn].sort()).toEqual(['albedo', 'both', 'floor', 'lightmap', 'normal']);
    const roles = await meshTextureRoles('/p', entries, async (f) => JSON.stringify(files[f]));
    expect([...roles.get('lightmap')!]).toEqual(['lightmap']);
    expect([...roles.get('albedo')!]).toEqual(['surface']);
  });
});

describe('a Compression value from an older .meta', () => {
  it('reads true — the default every fresh .meta was given — as Auto, and false as the original image', () => {
    expect(textureCompression(true)).toBe('auto');
    expect(textureCompression(false)).toBe('off');
    expect(textureCompression(undefined)).toBe('auto');
    expect(textureCompression('on')).toBe('on');
    expect(readTextureCookSettings({ compress: true }).compress).toBe('auto');
    expect(readTextureCookSettings({ compress: 'on', overrides: { wechat: { enabled: true, compress: false } } }, 'wechat').compress).toBe('off');
  });
});

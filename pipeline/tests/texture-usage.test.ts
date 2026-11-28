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
  it.each(['MeshRenderer', 'Mesh2D'])('finds textures drawn directly and through materials on %s', async type => {
    const entries = [
      entry('scene', 'assets/scenes/main.esscene', 'scene'),
      entry('prefab', 'assets/models/cafe/cafe.esprefab', 'prefab'),
      entry('mat', 'assets/models/cafe/wood.esmaterial', 'material'),
      entry('albedo', 'assets/models/cafe/wood_albedo.png', 'texture'),
      entry('normal', 'assets/models/cafe/wood_normal.png', 'texture'),
      entry('floor', 'assets/textures/floor.png', 'imageSource'),
      entry('lightmap', 'assets/scenes/main_lightmap.png', 'texture'),
      entry('hud', 'assets/ui/hud.png', 'texture'),
      entry('both', 'assets/textures/crate.png', 'texture'),
    ];
    const files: Record<string, unknown> = {
      'assets/scenes/main.esscene': { entities: [
        { components: [{ type, data: { texture: '@uuid:floor' } }, { type: 'MeshLightmap', data: { lightmap: 'assets/scenes/main_lightmap.png' } }] },
        { components: [{ type: 'Sprite', data: { texture: '@uuid:hud' } }] },
        { components: [{ type: 'Sprite', data: { texture: '@uuid:both' } }] },
        { components: [{ type, data: { texture: 'assets/textures/crate.png' } }] },
      ] },
      // A prefab from an import names its material beside it, relative to itself.
      'assets/models/cafe/cafe.esprefab': { entities: [
        { components: [{ type, data: { material: 'wood.esmaterial' } }] },
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

  it('includes prefab variant, nested, instance and added-entity texture bindings', async () => {
    const names = ['variant', 'nested', 'instance', 'added', 'baked', 'ignored'];
    const entries = [entry('prefab', 'art/frame.esprefab', 'prefab'), entry('mat', 'art/panel.esmaterial', 'material'),
      ...names.map(name => entry(name, `art/${name}.png`, 'imageSource'))];
    const component = (type: string, field: string, value: string) => ({ type, data: { [field]: value } });
    const property = (type: string, field: string, value: string) => ({ type: 'property', componentType: type, propertyName: field, value });
    const doc = { overrides: [property('MeshRenderer', 'texture', 'variant.png')], entities: [{
      overrides: [{ type: 'component_added', componentData: component('MeshRenderer', 'material', 'panel.esmaterial') }],
      added: [{ components: [component('MeshRenderer', 'normalMap', 'added.png')] }],
      nestedPrefab: { overrides: [
        { type: 'component_replaced', componentData: component('MeshRenderer', 'texture', 'nested.png') },
        property('MeshLightmap', 'lightmap', 'baked.png'),
        property('Sprite', 'texture', 'ignored.png'),
      ] },
    }] };
    const roles = await meshTextureRoles('/p', entries, async file => JSON.stringify(
      file.endsWith('.esprefab') ? doc : { properties: { u_albedoMap: 'instance.png' } }));
    expect([...roles.keys()].sort()).toEqual(['added', 'baked', 'instance', 'nested', 'variant']);
    expect([...roles.get('baked')!]).toEqual(['lightmap']);
  });

  it('cooks the textures each mesh material instance actually samples, relative to the declaring material', async () => {
    const mid = 'a5663b92-8e67-4d20-b8b0-a133368d8382', leaf = '0702200a-75ee-4b5a-91db-0dac0496f708';
    const entries = [
      entry('scene', 'assets/main.esscene', 'scene'),
      entry('base', 'assets/art/base.esmaterial', 'material'),
      entry(mid, 'assets/variants/mid.esmaterial', 'material'),
      entry(leaf, 'assets/variants/leaf.esmaterial', 'material'),
      entry('sibling', 'assets/variants/sibling.esmaterial', 'material'),
      entry('normal', 'assets/art/normal.png', 'imageSource'),
      entry('original', 'assets/art/base.png', 'texture'),
      entry('override', 'assets/variants/red.png', 'texture'),
      entry('label', 'assets/art/editor.png', 'texture'),
    ];
    const files: Record<string, unknown> = {
      'assets/main.esscene': { entities: [{ components: [
        { type: 'MeshRenderer', data: { material: '@uuid:' + leaf.toUpperCase() } },
        { type: 'MeshRenderer', data: { material: '@uuid:sibling' } },
        { type: 'Sprite', data: { material: '@uuid:base' } },
      ] }] },
      'assets/art/base.esmaterial': { type: 'material', name: 'editor.png',
        properties: { albedo: 'base.png', normal: 'normal.png', tint: 'editor.png' } },
      'assets/variants/mid.esmaterial': { type: 'material', instanceOf: '../art/base.esmaterial',
        properties: { albedo: 'red.png', normal: 'missing.png', tint: { r: 1, g: 1, b: 1 } } },
      'assets/variants/leaf.esmaterial': { type: 'material', instanceOf: mid.toUpperCase(), properties: {} },
      'assets/variants/sibling.esmaterial': { type: 'material', instanceOf: 'mid.esmaterial', properties: { normal: 0 } },
    };
    const reads: string[] = [];
    const roles = await meshTextureRoles('/p', entries, async file => { reads.push(file); return JSON.stringify(files[file]); });
    expect([...roles.keys()].sort()).toEqual(['normal', 'override']);
    expect(reads.filter(file => file === 'assets/art/base.esmaterial')).toHaveLength(1);
    expect(reads.filter(file => file === 'assets/variants/mid.esmaterial')).toHaveLength(1);
  });

  it('finishes when a material parent cycle is shared by two mesh entries', async () => {
    const entries = [entry('s', 's.esscene', 'scene'), entry('a', 'a.esmaterial', 'material'), entry('b', 'b.esmaterial', 'material')];
    const files: Record<string, unknown> = {
      's.esscene': { entities: [{ components: ['a', 'b'].map(uuid => ({ type: 'MeshRenderer', data: { material: '@uuid:' + uuid } })) }] },
      'a.esmaterial': { instanceOf: '@uuid:b', properties: {} },
      'b.esmaterial': { instanceOf: '@uuid:a', properties: {} },
    };
    const reads: string[] = [];
    expect((await meshTextureRoles('/p', entries, async file => { reads.push(file); return JSON.stringify(files[file]); })).size).toBe(0);
    expect(reads.sort()).toEqual(['a.esmaterial', 'b.esmaterial', 's.esscene']);
  });

  it('classifies strand and card textures through groom overrides and inherited materials', async () => {
    const entries = [entry('scene', 'assets/main.esscene', 'scene'), entry('groom', 'assets/hair/actor.esgroom', 'groom'),
      entry('strands', 'assets/hair/strands', 'material'), entry('cards', 'assets/hair/cards', 'material'),
      entry('base', 'assets/surfaces/coat.esmaterial', 'material'), entry('unused', 'assets/hair/unused.esmaterial', 'material'),
      ...['normal', 'albedo', 'hud', 'swatch'].map(name => entry(name, `assets/surfaces/${name}.png`, 'texture'))];
    const files: Record<string, unknown> = {
      'assets/main.esscene': { entities: [{ components: [{ type: 'Sprite', data: { texture: '@uuid:hud' } }], overrides: [
        { type: 'property', componentType: 'Groom', propertyName: 'groom', value: 'hair/actor.esgroom' },
      ] }, { components: [{ type: 'Groom', data: { groom: '@uuid:groom' } }] }] },
      'assets/hair/actor.esgroom': { type: 'groom', curves: 'curves', groups: [{ material: 'strands' }],
        cards: { mesh: 'cardMesh', material: './cards' }, note: 'unused.esmaterial' },
      'assets/hair/strands': { instanceOf: '../surfaces/coat.esmaterial', properties: { normal: 0 } },
      'assets/hair/cards': { instanceOf: '@uuid:base', properties: { albedo: 0 } },
      'assets/surfaces/coat.esmaterial': { properties: { albedo: 'albedo.png', normal: 'normal.png' } },
      'assets/hair/unused.esmaterial': { properties: { preview: '@uuid:swatch' } },
    };
    const reads: string[] = [];
    const roles = await meshTextureRoles('/p', entries, async file => { reads.push(file); return JSON.stringify(files[file]); });
    expect([...roles.entries()].sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ['albedo', new Set(['surface'])], ['normal', new Set(['surface'])],
    ]);
    expect(reads.filter(file => file === 'assets/hair/actor.esgroom')).toHaveLength(1);
    expect(reads.filter(file => file === 'assets/surfaces/coat.esmaterial')).toHaveLength(1);
    expect(reads).not.toContain('assets/hair/unused.esmaterial');
  });

  it('bounds pending document and material reads while still visiting every mesh', async () => {
    const count = 96;
    const entries = Array.from({ length: count }, (_, i) => [
      entry(`doc${i}`, `prop${i}.esprefab`, 'prefab'),
      entry(`mat${i}`, `mat${i}.esmaterial`, 'material'),
      entry(`tex${i}`, `tex${i}.png`, 'texture'),
    ]).flat();
    const active = { documents: 0, materials: 0 };
    const peak = { ...active };
    const roles = await meshTextureRoles('/p', entries, async file => {
      const prefab = file.endsWith('.esprefab');
      const kind = prefab ? 'documents' : 'materials';
      peak[kind] = Math.max(peak[kind], ++active[kind]);
      await Promise.resolve();
      active[kind]--;
      const i = file.match(/\d+/)?.[0];
      return prefab
        ? JSON.stringify({ entities: [{ components: [{ type: 'MeshRenderer', data: { material: `mat${i}.esmaterial` } }] }] })
        : JSON.stringify({ properties: { albedo: `tex${i}.png` } });
    });
    expect(peak.documents).toBeLessThan(count);
    expect(peak.materials).toBeLessThan(count);
    expect(roles.size).toBe(count);
    expect(roles.get('tex95')).toEqual(new Set(['surface']));
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

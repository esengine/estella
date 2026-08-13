// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a new asset of each type starts as.
 *
 * One table, and every entry points at the definition that already existed — so
 * what an agent is handed is what the "New …" menu writes, not a second reading
 * of the same format. A type with no blank of its own says so, because a made-up
 * skeleton for one is worse than admitting there is none.
 */
import { describe, it, expect } from 'vitest';
import { newAssetDocument, blankScene, BLANK_CLIP } from '@/project/newAssetDocument';

const parsed = async (type: string, opts?: { name?: string; template?: string }) => {
  const text = await newAssetDocument(type, opts);
  expect(text).toBeTruthy();
  return JSON.parse(text!);
};

describe('the document a new asset starts as', () => {
  it('gives a scene its camera', async () => {
    const scene = await parsed('scene');
    expect(scene.entities).toHaveLength(1);
    expect(scene.entities[0].components.map((c: { type: string }) => c.type)).toContain('Camera');
    expect(blankScene()).toMatchObject({ version: '1.0' });
  });

  it('binds a material to the template it was asked for', async () => {
    expect(await parsed('material', { template: 'sprite-outline' }))
      .toMatchObject({ type: 'material', shader: 'builtin:sprite-outline' });
    expect(await parsed('material')).toMatchObject({ shader: 'builtin:sprite-unlit' });
  });

  // A shader IS its text; JSON.parse would be the wrong question to ask of it.
  it('gives a shader the template source, not a wrapper', async () => {
    const source = await newAssetDocument('shader', { template: 'sprite-dissolve' });
    expect(source).toContain('#pragma');
  });

  it('gives the graph types the empty document the SDK defines', async () => {
    for (const type of ['statemachine', 'behaviortree', 'animator', 'materialgraph']) {
      expect(await parsed(type)).toBeTypeOf('object');
    }
  });

  it('names what the format carries a name for', async () => {
    expect(await parsed('materialgraph', { name: 'Water' })).toMatchObject({ name: 'Water' });
  });

  it('gives the flat types their canonical blank', async () => {
    expect(await parsed('animation')).toEqual(BLANK_CLIP);
    expect(await parsed('locale')).toMatchObject({ locale: 'en', entries: {} });
    expect(await parsed('inputmap')).toMatchObject({ actions: {} });
  });

  it('says nothing rather than inventing one', async () => {
    expect(await newAssetDocument('tilemap')).toBeNull();
    expect(await newAssetDocument('nonsense')).toBeNull();
    expect(await newAssetDocument('material', { template: 'no-such-template' })).toBeNull();
  });
});

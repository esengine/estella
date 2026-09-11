// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a `.psd` becomes — the claims a screenshot cannot make.
 *
 * The fixture is WRITTEN with ag-psd rather than checked in as a binary, so what
 * each layer contains is stated here in the same file that asserts it: a blob
 * would make every expectation below a number nobody could check.
 *
 * Two things carry the whole import and neither is visible in a picture of the
 * result: that the stack order survives as `Sprite.order`, and that PSD's
 * top-left, Y-down document becomes the engine's centred, Y-up placement.
 */
import { describe, it, expect } from 'vitest';
import { writePsd, type Psd } from 'ag-psd';
import { PNG } from 'pngjs';
import { importPsd, isPsdSource } from '../src/assets/psdImport';
import type { PrefabEntityData } from 'esengine';

const rgba = (w: number, h: number, [r, g, b, a]: number[]): ImageData => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r!; data[i * 4 + 1] = g!; data[i * 4 + 2] = b!; data[i * 4 + 3] = a!;
  }
  return { data, width: w, height: h } as ImageData;
};

/** A 64x48 document: a full-bleed background, a half-opaque square, a group with
 *  one layer in it, and one layer the artist turned off. */
function fixture(): Uint8Array {
  const psd: Psd = {
    width: 64, height: 48,
    children: [
      { name: 'bg', left: 0, top: 0, right: 64, bottom: 48, imageData: rgba(64, 48, [255, 0, 0, 255]) },
      { name: 'head', left: 10, top: 4, right: 26, bottom: 20, imageData: rgba(16, 16, [0, 0, 255, 255]), opacity: 0.5 },
      { name: 'props', opened: true, children: [
        { name: 'inner', left: 40, top: 30, right: 48, bottom: 38, imageData: rgba(8, 8, [0, 255, 0, 255]) },
      ] },
      { name: 'scratch', left: 0, top: 0, right: 8, bottom: 8, imageData: rgba(8, 8, [1, 2, 3, 255]), hidden: true },
    ],
  };
  return new Uint8Array(writePsd(psd, { generateThumbnail: false }));
}

const byName = (entities: PrefabEntityData[], name: string): PrefabEntityData => {
  const found = entities.find((e) => e.name === name);
  if (!found) throw new Error(`no entity named ${name} in ${entities.map((e) => e.name).join(', ')}`);
  return found;
};

const sprite = (e: PrefabEntityData): Record<string, unknown> =>
  e.components.find((c) => c.type === 'Sprite')!.data as Record<string, unknown>;
const position = (e: PrefabEntityData): { x: number; y: number } =>
  (e.components.find((c) => c.type === 'Transform')!.data as { position: { x: number; y: number } }).position;

describe('isPsdSource', () => {
  it('claims .psd and .psb, whatever the case, and nothing else', () => {
    expect(isPsdSource('a/b/Art.PSD')).toBe(true);
    expect(isPsdSource('big.psb')).toBe(true);
    expect(isPsdSource('art.png')).toBe(false);
    expect(isPsdSource('psd')).toBe(false);
  });
});

describe('importPsd', () => {
  it('writes one image per layer with pixels, and none for a group', () => {
    const { images } = importPsd(fixture(), 'hero');
    expect(images.map((i) => i.file))
      .toEqual(['hero_bg.png', 'hero_head.png', 'hero_inner.png', 'hero_scratch.png']);
  });

  it('writes real PNGs at the layer’s own size, not the document’s', () => {
    const { images } = importPsd(fixture(), 'hero');
    const head = PNG.sync.read(Buffer.from(images.find((i) => i.file === 'hero_head.png')!.bytes));
    expect([head.width, head.height]).toEqual([16, 16]);
    // The layer's own colour, so the pixels came from the layer and not the composite.
    expect([...head.data.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
  });

  // The claim the whole import rests on. PSD stacking is the file's order, and
  // Sprite.order is the only field that expresses it inside one sorting layer —
  // without this the layers arrive coincident and the stack is submission order.
  it('turns the layer stack into Sprite.order, bottom-up from zero', () => {
    const { prefab } = importPsd(fixture(), 'hero');
    expect(sprite(byName(prefab.entities, 'bg')).order).toBe(0);
    expect(sprite(byName(prefab.entities, 'head')).order).toBe(1);
    expect(sprite(byName(prefab.entities, 'inner')).order).toBe(2);
    expect(sprite(byName(prefab.entities, 'scratch')).order).toBe(3);
  });

  // PSD measures from the top-left with Y down and the engine's Y is up, so a
  // sign error here reads as "the art is upside down" and nothing else says why.
  it('recentres the document and flips Y', () => {
    const { prefab } = importPsd(fixture(), 'hero');
    // Full-bleed background: its centre IS the document centre.
    expect(position(byName(prefab.entities, 'bg'))).toEqual({ x: 0, y: 0, z: 0 });
    // head spans x 10..26, y 4..20 in a 64x48 document: centre (18, 12) →
    // (18 - 32, 24 - 12).
    expect(position(byName(prefab.entities, 'head'))).toMatchObject({ x: -14, y: 12 });
    // inner is low and to the right, so its y must come out NEGATIVE.
    expect(position(byName(prefab.entities, 'inner'))).toMatchObject({ x: 12, y: -10 });
  });

  it('sizes each sprite to its own layer rectangle', () => {
    const { prefab } = importPsd(fixture(), 'hero');
    expect(sprite(byName(prefab.entities, 'head')).size).toEqual({ x: 16, y: 16 });
    expect(sprite(byName(prefab.entities, 'bg')).size).toEqual({ x: 64, y: 48 });
  });

  it('spends layer opacity in the tint’s alpha', () => {
    const { prefab } = importPsd(fixture(), 'hero');
    const { a } = sprite(byName(prefab.entities, 'head')).color as { a: number };
    expect(a).toBeCloseTo(0.5, 2);
    expect((sprite(byName(prefab.entities, 'bg')).color as { a: number }).a).toBe(1);
  });

  // Turned off, not thrown away: the artist's document arrives whole, and the
  // entity is one click from being back.
  it('keeps a hidden layer as an invisible entity rather than dropping it', () => {
    const { prefab } = importPsd(fixture(), 'hero');
    expect(byName(prefab.entities, 'scratch').visible).toBe(false);
    expect(byName(prefab.entities, 'bg').visible).toBe(true);
  });

  it('keeps a group as a parent entity, with its layer inside it', () => {
    const { prefab } = importPsd(fixture(), 'hero');
    const group = byName(prefab.entities, 'props');
    expect(group.components.map((c) => c.type)).toEqual(['Transform']);
    expect(byName(prefab.entities, 'inner').parent).toBe(group.prefabEntityId);
    expect(group.children).toEqual([byName(prefab.entities, 'inner').prefabEntityId]);
  });

  it('names textures so they resolve from the folder the products landed in', () => {
    const { prefab } = importPsd(fixture(), 'hero', 'assets/art/');
    expect(sprite(byName(prefab.entities, 'bg')).texture).toBe('assets/art/hero_bg.png');
  });

  it('roots the prefab on one entity everything hangs from', () => {
    const { prefab } = importPsd(fixture(), 'hero');
    expect(prefab.rootEntityId).toBe('root');
    const root = prefab.entities.find((e) => e.prefabEntityId === 'root')!;
    expect(root.parent).toBeNull();
    // Every top-level layer, including the group, hangs off it.
    expect(root.children).toHaveLength(4);
  });

  // Two layers may share a name in Photoshop; two files may not.
  it('gives same-named layers distinct file names', () => {
    const psd: Psd = {
      width: 8, height: 8,
      children: [
        { name: 'same', left: 0, top: 0, right: 4, bottom: 4, imageData: rgba(4, 4, [1, 1, 1, 255]) },
        { name: 'same', left: 4, top: 4, right: 8, bottom: 8, imageData: rgba(4, 4, [2, 2, 2, 255]) },
      ],
    };
    const { images } = importPsd(new Uint8Array(writePsd(psd, { generateThumbnail: false })), 'dup');
    expect(images.map((i) => i.file)).toEqual(['dup_same.png', 'dup_same-2.png']);
  });

  it('makes a layer name that is no filename into one', () => {
    const psd: Psd = {
      width: 8, height: 8,
      children: [{ name: ' 头/部 ', left: 0, top: 0, right: 4, bottom: 4, imageData: rgba(4, 4, [1, 1, 1, 255]) }],
    };
    const { images, prefab } = importPsd(new Uint8Array(writePsd(psd, { generateThumbnail: false })), 'x');
    expect(images[0]!.file).toMatch(/^x_[\w.-]+\.png$/);
    // The ENTITY keeps the artist's own name; only the file is sanitised.
    expect(prefab.entities.some((e) => e.name === ' 头/部 ')).toBe(true);
  });

  // Every one of these is a thing the products genuinely cannot carry. Saying so
  // is the difference between an import that lost something and one that lied.
  it('reports what a Sprite cannot carry instead of dropping it silently', () => {
    const psd: Psd = {
      width: 8, height: 8,
      children: [
        { name: 'lit', left: 0, top: 0, right: 4, bottom: 4, imageData: rgba(4, 4, [1, 1, 1, 255]), blendMode: 'screen' },
        { name: 'empty', left: 0, top: 0, right: 0, bottom: 0 },
      ],
    };
    const { warnings, images } = importPsd(new Uint8Array(writePsd(psd, { generateThumbnail: false })), 'x');
    expect(warnings.some((w) => w.includes('"lit"') && w.includes('screen'))).toBe(true);
    expect(warnings.some((w) => w.includes('"empty"') && w.includes('no pixels'))).toBe(true);
    // The blend mode is only a warning: the layer itself still comes across.
    expect(images.map((i) => i.file)).toEqual(['x_lit.png']);
  });
});

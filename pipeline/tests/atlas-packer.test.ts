// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Atlas packer — deterministic shelf packing + page composition.
 */
import { describe, it, expect } from 'vitest';
import { packAtlas, decodePngImage, encodePagePng, encodeRgbaPng, downscaleRgba, type AtlasInputImage } from '../src/assets/atlasPacker';

function solid(key: string, width: number, height: number, rgba: [number, number, number, number]): AtlasInputImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { key, width, height, rgba: data };
}

describe('packAtlas', () => {
  it('packs everything onto the smallest power-of-two page that fits', () => {
    const pages = packAtlas([
      solid('a', 16, 16, [255, 0, 0, 255]),
      solid('b', 16, 16, [0, 255, 0, 255]),
      solid('c', 16, 16, [0, 0, 255, 255]),
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].width).toBe(64);   // three 20px padded boxes need one 60px shelf
    expect(pages[0].height).toBe(64);
    expect(pages[0].placements).toHaveLength(3);
  });

  it('is deterministic regardless of input order', () => {
    const images = [
      solid('tall', 8, 32, [1, 2, 3, 255]),
      solid('wide', 32, 8, [4, 5, 6, 255]),
      solid('mid', 16, 16, [7, 8, 9, 255]),
    ];
    const a = packAtlas(images);
    const b = packAtlas([...images].reverse());
    expect(b).toEqual(a);
  });

  it('keeps placements padded and non-overlapping', () => {
    const pages = packAtlas([
      solid('a', 30, 10, [1, 0, 0, 255]),
      solid('b', 10, 30, [0, 1, 0, 255]),
      solid('c', 20, 20, [0, 0, 1, 255]),
    ], { padding: 2 });
    for (const page of pages) {
      for (const p of page.placements) {
        expect(p.x).toBeGreaterThanOrEqual(2);
        expect(p.y).toBeGreaterThanOrEqual(2);
        expect(p.x + p.width).toBeLessThanOrEqual(page.width - 2);
        expect(p.y + p.height).toBeLessThanOrEqual(page.height - 2);
      }
      for (const p of page.placements) {
        for (const q of page.placements) {
          if (p === q) continue;
          const overlap = p.x < q.x + q.width && q.x < p.x + p.width
            && p.y < q.y + q.height && q.y < p.y + p.height;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('spills onto extra pages when the cap cannot hold everything', () => {
    const images = Array.from({ length: 5 }, (_, i) => solid(`i${i}`, 40, 40, [i, i, i, 255]));
    const pages = packAtlas(images, { maxSize: 64 });
    expect(pages.length).toBe(5); // one padded 44px box per 64px page
    expect(pages.flatMap((p) => p.placements)).toHaveLength(5);
  });

  it('rejects an image larger than the page cap', () => {
    expect(() => packAtlas([solid('huge', 3000, 8, [0, 0, 0, 255])])).toThrow(/exceeds/);
  });

  it('composes page pixels at the placements', () => {
    const pages = packAtlas([
      solid('red', 2, 2, [255, 0, 0, 255]),
      solid('blue', 2, 2, [0, 0, 255, 255]),
    ], { padding: 1 });
    expect(pages).toHaveLength(1);
    const page = pages[0];
    for (const p of page.placements) {
      const px = (p.y * page.width + p.x) * 4;
      const want = p.key === 'red' ? [255, 0, 0, 255] : [0, 0, 255, 255];
      expect([...page.rgba.subarray(px, px + 4)]).toEqual(want);
    }
    // Padding gutters stay transparent.
    expect(page.rgba[3]).toBe(0);
  });

  it('round-trips through PNG encode/decode', () => {
    const pages = packAtlas([solid('x', 3, 5, [10, 20, 30, 255])]);
    const png = encodePagePng(pages[0]);
    const back = decodePngImage('page', png);
    expect(back.width).toBe(pages[0].width);
    expect(back.height).toBe(pages[0].height);
    expect([...back.rgba]).toEqual([...pages[0].rgba]);
  });
});

describe('downscaleRgba (Max Size cook cap)', () => {
  it('returns the input untouched when within the cap', () => {
    const img = solid('a', 64, 64, [1, 2, 3, 255]);
    expect(downscaleRgba(img, 2048)).toBe(img);       // same reference — no work
    expect(downscaleRgba(img, 64)).toBe(img);          // exactly at cap
  });

  it('shrinks so the longest side ≤ cap, keeping aspect + solid color', () => {
    const out = downscaleRgba(solid('a', 128, 32, [200, 100, 50, 255]), 32);
    expect(out.width).toBe(32);   // 128 → 32
    expect(out.height).toBe(8);   // 32 → 8 (aspect preserved)
    expect(out.rgba).toHaveLength(32 * 8 * 4);
    // A solid image downscales to the same solid color everywhere.
    for (let i = 0; i < out.width * out.height; i++) {
      expect([...out.rgba.subarray(i * 4, i * 4 + 4)]).toEqual([200, 100, 50, 255]);
    }
  });

  it('averages color in premultiplied space (transparent pixels do not bleed)', () => {
    // 2×1: opaque red + fully-transparent — the shrunk pixel keeps red's hue,
    // with alpha averaged to half. (Naive averaging would darken toward black.)
    const img: AtlasInputImage = { key: 'k', width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]) };
    const out = downscaleRgba(img, 1);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect([...out.rgba]).toEqual([255, 0, 0, 128]);
  });

  it('encodeRgbaPng round-trips raw pixels', () => {
    const rgba = new Uint8Array([9, 8, 7, 255, 6, 5, 4, 255]);
    const back = decodePngImage('p', encodeRgbaPng(2, 1, rgba));
    expect(back.width).toBe(2);
    expect([...back.rgba]).toEqual([...rgba]);
  });
});

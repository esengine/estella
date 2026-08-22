// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The score behind "the package shows what the editor showed".
 *
 *        It has to separate two runs of one game from two different games by a
 *        wide margin, or the tolerance is guesswork. Measured on real captures:
 *        the same game lands at 0.001–0.006 and two different games at
 *        0.37–0.48, which is the gap these cases pin down synthetically.
 */
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
// @ts-expect-error — plain-JS tool module, no d.ts
import { downsample, gridDistance, cellMaxDistance, frameDistance, frameCellMax, DEFAULT_INSET } from '../frameCompare.mjs';

interface Img { w: number; h: number; px(x: number, y: number): [number, number, number] }

/** An image from a function of position, duck-typed like the PNG reader's result. */
const img = (w: number, h: number, f: (x: number, y: number) => [number, number, number]): Img =>
  ({ w, h, px: (x, y) => f(x, y) });

const solid = (w: number, h: number, c: [number, number, number]) => img(w, h, () => c);
/** Left half one colour, right half another — a layout the score must notice moving. */
const split = (w: number, h: number, a: [number, number, number], b: [number, number, number]) =>
  img(w, h, (x) => (x < w / 2 ? a : b));

describe('downsample', () => {
  it('averages a region to its mean colour', () => {
    const g = downsample(solid(40, 20, [10, 20, 30]), 4, 2);
    expect([...g.slice(0, 3)]).toEqual([10, 20, 30]);
    expect(g).toHaveLength(4 * 2 * 3);
  });

  it('keeps left and right distinguishable at a coarse grid', () => {
    const g = downsample(split(40, 20, [0, 0, 0], [255, 255, 255]), 2, 1);
    expect(g[0]).toBeLessThan(10); // left cell
    expect(g[3]).toBeGreaterThan(245); // right cell
  });

  it('drops the inset border — the editor draws a play frame around its surface', () => {
    // A green ring one tenth deep around a black field: with the ring included the
    // mean is polluted; inset past it and the field reads as the field.
    const ring = img(100, 100, (x, y) =>
      (x < 10 || y < 10 || x >= 90 || y >= 90 ? [0, 255, 0] : [0, 0, 0]));
    const withRing = downsample(ring, 1, 1, 0);
    const inside = downsample(ring, 1, 1, 0.12);
    expect(withRing[1]).toBeGreaterThan(50);
    expect(inside[1]).toBe(0);
  });
});

describe('gridDistance', () => {
  it('is zero for a grid against itself', () => {
    const g = downsample(split(20, 10, [12, 34, 56], [200, 100, 50]), 4, 4);
    expect(gridDistance(g, g)).toBe(0);
  });

  it('is one for black against white', () => {
    const a = downsample(solid(8, 8, [0, 0, 0]), 2, 2);
    const b = downsample(solid(8, 8, [255, 255, 255]), 2, 2);
    expect(gridDistance(a, b)).toBeCloseTo(1, 6);
  });

  it('separates a shifted layout from an identical one by an order of magnitude', () => {
    const base = downsample(split(64, 32, [20, 40, 60], [220, 180, 140]), 16, 8);
    const jitter = downsample(
      img(64, 32, (x) => (x < 33 ? [20, 40, 60] : [220, 180, 140])), 16, 8,
    ); // the seam moved one pixel — drift, not a different game
    const other = downsample(split(64, 32, [220, 180, 140], [20, 40, 60]), 16, 8); // mirrored
    expect(gridDistance(base, jitter)).toBeLessThan(0.02);
    expect(gridDistance(base, other)).toBeGreaterThan(0.3);
  });

  it('refuses grids of different sizes rather than scoring nonsense', () => {
    expect(() => gridDistance(new Float64Array(3), new Float64Array(6))).toThrow(/mismatch/);
  });
});

/** A minimal 8-bit RGB PNG, so the size guard can be tested on real input rather
 *  than on a buffer that fails to decode for unrelated reasons. */
function png(w: number, h: number, c: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    return v >>> 0;
  });
  const crc = (b: Buffer) => {
    let v = 0xffffffff;
    for (const byte of b) v = crcTable[(v ^ byte) & 0xff] ^ (v >>> 8);
    return (v ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4);
    cr.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0; // no filter
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = c[0];
      raw[row + 2 + x * 3] = c[1];
      raw[row + 3 + x * 3] = c[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The second question: not "is this the same game" but "did anything answer".
 * Measured on real packages — driven 0.37, undriven drift 0.04, input silently
 * dropped 0.09 — which is why the tolerance sits at 0.15 and not below it.
 */
describe('cellMaxDistance', () => {
  const field = (w: number, h: number) => solid(w, h, [30, 30, 30]);
  /** The same field with one small bright block, as a sprite at a position. */
  const withSprite = (w: number, h: number, sx: number) =>
    img(w, h, (x, y) => (x >= sx && x < sx + 4 && y >= 8 && y < 12 ? [255, 255, 255] : [30, 30, 30]));

  it('is zero against itself', () => {
    const g = downsample(withSprite(64, 32, 10), 16, 8);
    expect(cellMaxDistance(g, g)).toBe(0);
  });

  it('sees a small sprite move where the mean does not', () => {
    const a = downsample(withSprite(64, 32, 8), 16, 8);
    const b = downsample(withSprite(64, 32, 40), 16, 8);
    expect(gridDistance(a, b)).toBeLessThan(0.05); // averaged away
    expect(cellMaxDistance(a, b)).toBeGreaterThan(0.3); // the moved cell shows
  });

  it('stays near zero when nothing moved but the field is busy', () => {
    const a = downsample(field(64, 32), 16, 8);
    const b = downsample(img(64, 32, (x, y) => (((x + y) % 17 === 0) ? [34, 34, 34] : [30, 30, 30])), 16, 8);
    expect(cellMaxDistance(a, b)).toBeLessThan(0.05);
  });

  it('refuses grids of different sizes', () => {
    expect(() => cellMaxDistance(new Float64Array(3), new Float64Array(6))).toThrow(/mismatch/);
  });
});

describe('frameDistance', () => {
  it('scores two identical captures at zero', () => {
    expect(frameDistance(png(32, 18, [40, 80, 120]), png(32, 18, [40, 80, 120]))).toBe(0);
  });

  it('scores black against white at one', () => {
    expect(frameDistance(png(32, 18, [0, 0, 0]), png(32, 18, [255, 255, 255]))).toBeCloseTo(1, 6);
  });

  it('refuses captures of different sizes — they letterbox differently', () => {
    expect(() => frameDistance(png(32, 18, [0, 0, 0]), png(64, 18, [0, 0, 0])))
      .toThrow(/differ in size/);
  });

  it('insets by default, so a play border never counts as a difference', () => {
    expect(DEFAULT_INSET).toBeGreaterThan(0);
  });

  it('frameCellMax refuses mismatched sizes too — both reducers share the guard', () => {
    expect(() => frameCellMax(png(32, 18, [0, 0, 0]), png(64, 18, [0, 0, 0]))).toThrow(/differ in size/);
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a `.hdr` panorama becomes: nine irradiance coefficients and a
 *        prefiltered octahedral atlas.
 *
 * These are the claims a pixel gate cannot make. A rendered sphere says the
 * lighting changed; only arithmetic says it changed to the RIGHT value — and the
 * one identity the whole design rests on (a constant environment reconstructs as
 * that constant, which is what keeps existing scenes pixel-identical) is checked
 * here rather than inferred from a screenshot.
 */
import { describe, it, expect } from 'vitest';
import {
  decodeRadianceHdr, projectIrradianceSH, evalIrradianceSH, samplePanorama,
  octEncode, octDecode, encodeRgbm, decodeRgbm, atlasLayout, prefilterOctahedral,
  importEnvironment, mipCountFor, ENV_MAX_RANGE,
  type Panorama,
} from '../../pipeline/src/assets/environmentImport';

/** A Radiance file in the flat (uncompressed) encoding, one RGBE per pixel. */
function flatHdr(width: number, height: number,
                 pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
  const body = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const peak = Math.max(r, g, b);
      let e = 0;
      let scale = 0;
      if (peak > 1e-9) {
        e = Math.ceil(Math.log2(peak)) + 128;
        scale = 256 / Math.pow(2, e - 128);
      }
      const at = (y * width + x) * 4;
      body[at] = Math.min(255, Math.floor(r * scale));
      body[at + 1] = Math.min(255, Math.floor(g * scale));
      body[at + 2] = Math.min(255, Math.floor(b * scale));
      body[at + 3] = e;
    }
  }
  return new Uint8Array(Buffer.concat([header, body]));
}

/** The same panorama without the file round trip, for the convolution tests. */
function panorama(width: number, height: number,
                  pixel: (x: number, y: number) => [number, number, number]): Panorama {
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const at = (y * width + x) * 3;
      rgb[at] = r; rgb[at + 1] = g; rgb[at + 2] = b;
    }
  }
  return { width, height, rgb };
}

describe('Radiance decode', () => {
  it('reads a flat scanline back as the values it was given', () => {
    const env = decodeRadianceHdr(flatHdr(4, 2, (x, y) => [x + 1, y + 1, 0.5]));
    expect(env.width).toBe(4);
    expect(env.height).toBe(2);
    // RGBE is a shared 8-bit mantissa, so the round trip is close, not exact.
    expect(env.rgb[0]).toBeCloseTo(1, 1);
    expect(env.rgb[1]).toBeCloseTo(1, 1);
    expect(env.rgb[(1 * 4 + 3) * 3]).toBeCloseTo(4, 1);
  });

  it('reads the adaptive-RLE encoding as the same picture', () => {
    // 8 wide is the narrowest width the RLE header is legal at.
    const width = 8;
    const values = Array.from({ length: width }, (_, x) => 32 + x * 4);
    const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X ${width}\n`);
    const rle: number[] = [2, 2, 0, width];
    for (let channel = 0; channel < 4; channel++) {
      rle.push(width);
      for (let x = 0; x < width; x++) rle.push(channel === 3 ? 128 : values[x]!);
    }
    const env = decodeRadianceHdr(new Uint8Array(Buffer.concat([header, Buffer.from(rle)])));
    expect(env.width).toBe(width);
    // e = 128 means a scale of 2^-8, so each stored byte reads back as byte/256.
    expect(env.rgb[0]).toBeCloseTo(32 / 256, 5);
    expect(env.rgb[(width - 1) * 3]).toBeCloseTo((32 + 7 * 4) / 256, 5);
  });

  it('refuses a file that is not Radiance', () => {
    expect(() => decodeRadianceHdr(new Uint8Array([1, 2, 3, 4]))).toThrow(/Radiance/);
  });
});

describe('irradiance coefficients', () => {
  // THE identity the design rests on: a constant environment must come back as
  // that same constant in every direction. If this drifts, every existing lit
  // scene changes brightness the day an environment is attached.
  it('reconstructs a constant environment as that constant', () => {
    const sh = projectIrradianceSH(panorama(64, 32, () => [0.25, 0.5, 0.75]));
    for (const [x, y, z] of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1],
                             [0.577, 0.577, 0.577]] as const) {
      const [r, g, b] = evalIrradianceSH(sh, x, y, z);
      expect(r).toBeCloseTo(0.25, 2);
      expect(g).toBeCloseTo(0.5, 2);
      expect(b).toBeCloseTo(0.75, 2);
    }
  });

  it('puts a lit upper hemisphere above a dark lower one', () => {
    const sh = projectIrradianceSH(panorama(64, 32, (_x, y) => (y < 16 ? [1, 1, 1] : [0, 0, 0])));
    const up = evalIrradianceSH(sh, 0, 1, 0)[0];
    const down = evalIrradianceSH(sh, 0, -1, 0)[0];
    const side = evalIrradianceSH(sh, 1, 0, 0)[0];
    // Analytic: a white upper hemisphere gives E(up)/π = 1, E(side)/π = 0.5,
    // E(down)/π = 0. Order-2 SH rings, so the ends land near rather than on them.
    expect(up).toBeGreaterThan(0.9);
    expect(side).toBeCloseTo(0.5, 1);
    expect(down).toBeLessThan(0.1);
    expect(up).toBeGreaterThan(side);
    expect(side).toBeGreaterThan(down);
  });

  it('answers with the colour that lies in that direction, not the average', () => {
    // Red on the +Z half of the sphere (the image's centre column), green behind.
    const sh = projectIrradianceSH(panorama(64, 32,
      (x) => (x > 16 && x < 48 ? [1, 0, 0] : [0, 1, 0])));
    const front = evalIrradianceSH(sh, 0, 0, 1);
    const back = evalIrradianceSH(sh, 0, 0, -1);
    expect(front[0]).toBeGreaterThan(front[1]);
    expect(back[1]).toBeGreaterThan(back[0]);
  });
});

describe('octahedral mapping', () => {
  it('round-trips every direction it is given', () => {
    const third = 1 / Math.sqrt(3);
    for (const d of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
                     [third, third, third], [-third, -third, third]]) {
      const [u, v] = octEncode(d[0], d[1], d[2]);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      const back = octDecode(u, v);
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(d[i]!, 5);
    }
  });

  it('stays continuous just outside the square, which is what the border is for', () => {
    // The texel one step past the edge must be the direction its neighbour across
    // the fold sees — otherwise a bilinear tap at the seam blends in nothing.
    const inside = octDecode(0.02, 0.5);
    const outside = octDecode(-0.02, 0.5);
    const dot = inside[0] * outside[0] + inside[1] * outside[1] + inside[2] * outside[2];
    expect(dot).toBeGreaterThan(0.99);
  });
});

describe('RGBM', () => {
  it('round-trips values across the range within a percent of full scale', () => {
    for (const v of [0, 0.01, 0.1, 0.5, 1, 3, 7.9]) {
      const out = new Uint8Array(4);
      encodeRgbm(v, v * 0.5, 0, ENV_MAX_RANGE, out, 0);
      const [r, g, b] = decodeRgbm(out[0]!, out[1]!, out[2]!, out[3]!, ENV_MAX_RANGE);
      expect(Math.abs(r - v)).toBeLessThan(0.08);
      expect(Math.abs(g - v * 0.5)).toBeLessThan(0.08);
      expect(b).toBeCloseTo(0, 3);
    }
  });

  it('clamps rather than wrapping above the range', () => {
    const out = new Uint8Array(4);
    encodeRgbm(100, 100, 100, ENV_MAX_RANGE, out, 0);
    const [r] = decodeRgbm(out[0]!, out[1]!, out[2]!, out[3]!, ENV_MAX_RANGE);
    expect(r).toBeCloseTo(ENV_MAX_RANGE, 1);
  });
});

describe('prefiltered atlas', () => {
  it('stops before a face gets too small to be an environment', () => {
    // A 4-texel octahedral face is not a blurrier sky, it is a different one.
    expect(mipCountFor(128)).toBe(5);
    expect(mipCountFor(32)).toBe(3);
    expect(mipCountFor(8)).toBe(1);
    expect(mipCountFor(128, 2)).toBe(2);
  });

  it('stacks the mips with a border between them', () => {
    const { width, height, offsets } = atlasLayout(128, 6);
    expect(width).toBe(130);
    expect(height).toBe(130 + 66 + 34 + 18 + 10 + 6);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(130);
    // The closed form the shader uses instead of a loop.
    for (let mip = 0; mip < 6; mip++) {
      expect(offsets[mip]).toBe(2 * 128 * (1 - Math.pow(2, -mip)) + 2 * mip);
    }
  });

  it('reproduces the source in mip 0 and averages it away by the last', () => {
    // Sky above, ground below: a mirror sees the half it faces; a fully rough
    // surface sees the whole sphere at once.
    const env = panorama(64, 32, (_x, y) => (y < 16 ? [0, 0, 4] : [1, 0, 0]));
    const { width, rgba } = prefilterOctahedral(env, 16, 4, ENV_MAX_RANGE);
    const { offsets } = atlasLayout(16, 4);
    const read = (mip: number, dx: number, dy: number, dz: number): [number, number, number] => {
      const size = 16 >> mip;
      const [u, v] = octEncode(dx, dy, dz);
      const px = Math.min(size - 1, Math.floor(u * size)) + 1;
      const py = offsets[mip]! + Math.min(size - 1, Math.floor(v * size)) + 1;
      const at = (py * width + px) * 4;
      return decodeRgbm(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!, rgba[at + 3]!, ENV_MAX_RANGE);
    };

    const mirrorUp = read(0, 0, 1, 0);
    expect(mirrorUp[2]).toBeGreaterThan(3);
    expect(mirrorUp[0]).toBeLessThan(0.2);
    const mirrorDown = read(0, 0, -1, 0);
    expect(mirrorDown[0]).toBeGreaterThan(0.8);
    expect(mirrorDown[2]).toBeLessThan(0.2);

    // The roughest mip has seen both halves from either side, so the two agree.
    const roughUp = read(3, 0, 1, 0);
    const roughDown = read(3, 0, -1, 0);
    expect(roughUp[2]).toBeGreaterThan(0.5);
    expect(roughDown[2]).toBeGreaterThan(0.5);
    expect(Math.abs(roughUp[2] - roughDown[2])).toBeLessThan(1.5);
  });

  it('fills the border with the neighbour across the fold', () => {
    const env = panorama(64, 32, (_x, y) => (y < 16 ? [0, 0, 4] : [1, 0, 0]));
    const { width, rgba } = prefilterOctahedral(env, 8, 1, ENV_MAX_RANGE);
    const texel = (x: number, y: number): [number, number, number] => {
      const at = (y * width + x) * 4;
      return decodeRgbm(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!, rgba[at + 3]!, ENV_MAX_RANGE);
    };
    // Column 0 is the border; column 1 is the face's first real texel. Both look
    // outward along -X near the horizon, so neither is the untouched black an
    // unfilled border would be.
    for (let y = 1; y <= 8; y++) {
      const border = texel(0, y);
      expect(border[0] + border[1] + border[2]).toBeGreaterThan(0.1);
    }
  });
});

describe('importEnvironment', () => {
  it('produces a document and an atlas that describe each other', () => {
    const hdr = flatHdr(32, 16, (_x, y) => (y < 8 ? [2, 2, 2] : [0, 0, 0]));
    const result = importEnvironment(hdr, 'studio', { faceSize: 32, mipCount: 3 });
    expect(result.atlasName).toBe('studio_env.png');
    expect(result.document.irradiance).toHaveLength(27);
    expect(result.document.faceSize).toBe(32);
    expect(result.document.mipCount).toBe(3);
    expect(result.document.maxRange).toBe(ENV_MAX_RANGE);
    // A PNG, and one whose size the layout predicts.
    expect(Array.from(result.atlasBytes.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    const up = evalIrradianceSH(result.document.irradiance, 0, 1, 0)[0];
    const down = evalIrradianceSH(result.document.irradiance, 0, -1, 0)[0];
    expect(up).toBeGreaterThan(down + 1);
  });
});

describe('panorama sampling', () => {
  it('reads the image centre as +Z and row 0 as +Y', () => {
    const env = panorama(8, 4, (x, y) => [x, y, 0]);
    const out = new Float32Array(3);
    samplePanorama(env, 0, 1, 0, out);
    expect(out[1]).toBeLessThan(0.5);
    samplePanorama(env, 0, -1, 0, out);
    expect(out[1]).toBeGreaterThan(2.5);
    samplePanorama(env, 0, 0, 1, out);
    expect(out[0]).toBeCloseTo(3.5, 1);
  });
});

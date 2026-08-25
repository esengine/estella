// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The playable's DEFLATE decoder, against the encoder that feeds it.
 *
 *        Every byte of a playable's engine goes through `inflateRaw`, so a bug
 *        in it is not a degraded playable, it is one that does not boot at all —
 *        on every device, since there is deliberately no second path. The stakes
 *        are why this holds it against `zlib` over shapes chosen to reach each
 *        branch of the format rather than a few happy cases:
 *
 *          - every compression level, 0 through 9 (0 is all stored blocks, and
 *            the fixed-Huffman block only appears for tiny inputs);
 *          - a run long enough to be coded as an overlapping match (distance 1),
 *            which a block copy would get wrong;
 *          - incompressible input, which deflate stores rather than shrinks;
 *          - lengths either side of the 258-byte maximum match and the 64KB
 *            stored-block boundary;
 *          - the real payloads — the engine module and each side module — since
 *            those are the bytes that actually ship.
 */
import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRaw } from '../src/runtime/inflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WASM_DIR = path.join(ROOT, 'build', 'wasm', 'web');

/**
 * Deflate with zlib, inflate with ours, and require the bytes back exactly.
 *
 * Compared by hand rather than with `toEqual` over the two arrays: these run to
 * hundreds of kilobytes, and building a structural diff of that takes long
 * enough to look like a hang — while saying far less than "byte 70123 differs".
 */
const roundTrip = (bytes: Uint8Array, level?: number): void => {
  const deflated = new Uint8Array(deflateRawSync(bytes, level != null ? { level } : {}));
  const got = inflateRaw(deflated, bytes.length);
  expect(got.length).toBe(bytes.length);
  let differsAt = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (got[i] !== bytes[i]) { differsAt = i; break; }
  }
  expect(differsAt < 0 ? 'identical'
    : `byte ${differsAt} of ${bytes.length}: expected ${bytes[differsAt]}, got ${got[differsAt]}`,
  ).toBe('identical');
};

/** Deterministic pseudo-random, so a failure reproduces rather than haunts. */
function pseudoRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = seed & 255;
  }
  return out;
}

const patterned = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + 3) & 255;
  return out;
};

describe('inflateRaw — against zlib', () => {
  it('round-trips the empty input and a single byte', () => {
    roundTrip(new Uint8Array(0));
    roundTrip(new Uint8Array([42]));
  });

  it('round-trips at every compression level', () => {
    const source = readFileSync(path.join(ROOT, 'pipeline', 'src', 'runtime', 'inflate.ts'));
    for (let level = 0; level <= 9; level++) roundTrip(new Uint8Array(source), level);
  });

  it('round-trips a run coded as an overlapping match', () => {
    // 70,000 identical bytes deflate to a match whose distance is 1 — it reads
    // bytes it is in the middle of writing, so copying block-wise gets it wrong.
    roundTrip(new Uint8Array(70_000).fill(0x61));
    roundTrip(new Uint8Array(100_000));                        // all zeroes
    const abc = new Uint8Array(90_000);
    for (let i = 0; i < abc.length; i++) abc[i] = 0x61 + (i % 3);
    roundTrip(abc);                                            // short-period repeat
  });

  it('round-trips incompressible input, which deflate stores', () => {
    for (const n of [100, 70_000, 200_000]) roundTrip(pseudoRandom(n));
  });

  it('round-trips either side of the format boundaries', () => {
    // 258 is the longest match a length code can name; 65535 the largest stored
    // block. Off-by-one at either shows up here and nowhere else.
    for (const n of [1, 2, 3, 255, 256, 257, 258, 259, 65_535, 65_536, 65_537]) {
      roundTrip(patterned(n));
    }
  });

  it('refuses a stream that does not produce what it promised', () => {
    const bytes = patterned(1000);
    const deflated = new Uint8Array(deflateRawSync(bytes));
    // A wrong length is how a mismatched export/host pair would show up, and it
    // has to fail here rather than hand back a half-filled buffer.
    expect(() => inflateRaw(deflated, 999)).toThrow(/longer than expected|expected 999/);
    expect(() => inflateRaw(deflated, 1001)).toThrow(/expected 1001/);
    expect(() => inflateRaw(deflated.subarray(0, deflated.length - 3), 1000)).toThrow();
  });

  it('refuses garbage rather than looping or returning it', () => {
    expect(() => inflateRaw(pseudoRandom(64), 4096)).toThrow();
  });
});

// The modules a playable actually inlines. Skipped rather than failed when the
// wasm tree is absent: this suite is about the decoder, and a checkout that has
// not built the engine should still run it.
const engine = path.join(WASM_DIR, 'esengine.wasm');
describe.skipIf(!existsSync(engine))('inflateRaw — the payloads that ship', () => {
  for (const file of ['esengine.wasm', 'physics.wasm', 'physics3d.wasm', 'basis.wasm', 'spine42.wasm']) {
    it(`round-trips ${file}`, () => {
      const p = path.join(WASM_DIR, file);
      if (!existsSync(p)) return;
      roundTrip(new Uint8Array(readFileSync(p)), 9);
    });
  }

  it('decodes the engine module fast enough to boot behind', () => {
    const bytes = new Uint8Array(readFileSync(engine));
    const deflated = new Uint8Array(deflateRawSync(bytes, { level: 9 }));
    const started = performance.now();
    inflateRaw(deflated, bytes.length);
    const ms = performance.now() - started;
    // ~16ms for 1.5MB here (~95 MB/s); the ceiling sits an order of magnitude
    // above so it catches a rewrite gone unusable, not the spread between
    // machines — which is all a tight bound would time.
    expect(ms).toBeLessThan(500);
  });
});

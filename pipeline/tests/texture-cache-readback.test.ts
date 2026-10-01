// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { solidPng } from './fixtures/solidPng.mjs';

vi.mock('../src/assets/atlasPacker', async original => {
  const module = await original<typeof import('../src/assets/atlasPacker')>();
  return { ...module, decodePngImage: vi.fn(module.decodePngImage) };
});
import { decodePngImage } from '../src/assets/atlasPacker';
import { cookTexture, type TextureEncoder } from '../src/assets/textureCook';

describe('texture cache readback', () => {
  let temporaryRoot: string | undefined;
  afterEach(() => {
    if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  it('checks a capped texture without decoding, and reuses the exact resized output on cache hits', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-cache-readback-'));
    temporaryRoot = root;
    const encode = vi.fn(async () => Uint8Array.from([1, 2, 3]));
    const encoder = { id: 'cache-readback', module: {
      encodeToKtx2: encode, ImageType: { PNG: 'png', RGBA: 'rgba' },
    } } as unknown as TextureEncoder;
    const ask = (cachedOnly: boolean) => cookTexture({
      root, path: 'wall.png', data: new Uint8Array(solidPng(64, 32, [100, 80, 60, 255])),
      ext: '.png', importer: { compress: 'uastc', maxSize: 16 }, encoder,
      compressTextures: true, atlasTextures: false, drawnIn3D: true, cachedOnly,
    });
    expect((await ask(true)).pending).toBe(true);
    expect(decodePngImage).not.toHaveBeenCalled();
    const made = await ask(false);
    expect(decodePngImage).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(expect.objectContaining({
      type: 'rgba', width: 16, height: 8, data: expect.any(Uint8Array),
    }), expect.objectContaining({ mode: 'uastc' }));
    expect(Array.from((await ask(true)).data)).toEqual(Array.from(made.data));
    expect(Array.from((await ask(false)).data)).toEqual(Array.from(made.data));
    expect(decodePngImage).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledTimes(1);
  });
});

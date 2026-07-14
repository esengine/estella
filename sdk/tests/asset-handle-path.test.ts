// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Assets.pathForHandle — the REVERSE of ref resolution. Every
 *        handle-yielding load records handle→path, so tooling that only holds
 *        a live World handle (the "Game" inspector) can name the asset.
 *        Invalidate drops the stale records (a reload mints new handles);
 *        releaseAll clears everything.
 */
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';

const mockModule = {
  _malloc: vi.fn(() => 0),
  _free: vi.fn(),
  HEAPU8: new Uint8Array(1024),
  GL: null,
  FS: null,
} as never;

vi.mock('../src/resourceManager', () => ({
  requireResourceManager: () => ({
    createTexture: vi.fn(() => 42),
    registerExternalTexture: vi.fn(() => 42),
    releaseTexture: vi.fn(),
    releaseBitmapFont: vi.fn(),
    getTextureGLId: vi.fn(() => 1),
    registerTextureWithPath: vi.fn(),
    getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
    setTextureMetadata: vi.fn(),
  }),
  getResourceManager: () => null,
  evictTextureDimensions: vi.fn(),
}));

function createMockBackend(): Backend {
  return {
    fetch: vi.fn(async () => new ArrayBuffer(8)),
    fetchText: vi.fn(async () => '{}'),
    resolvePath: vi.fn((p: string) => p),
    resolveUrl: vi.fn((p: string) => p),
  } as never;
}

function createAssets(): Assets {
  return Assets.create({
    backend: createMockBackend(),
    catalog: Catalog.empty(),
    module: mockModule,
  });
}

describe('Assets.pathForHandle', () => {
  it('records handle→path on a typed load and resolves it back', async () => {
    const assets = createAssets();
    assets.register({
      type: 'material',
      extensions: ['.esmaterial'],
      load: async () => ({ handle: 42, shaderHandle: 7 }),
      unload: () => {},
    } as never);
    await assets.loadMaterial('assets/materials/glow.esmaterial');
    expect(assets.pathForHandle('material', 42)).toBe('assets/materials/glow.esmaterial');
    // Kind is part of the key — a texture handle 42 is a different asset.
    expect(assets.pathForHandle('texture', 42)).toBeNull();
    expect(assets.pathForHandle('material', 43)).toBeNull();
  });

  it('invalidate drops the stale reverse records for that path', async () => {
    const assets = createAssets();
    assets.register({
      type: 'material',
      extensions: ['.esmaterial'],
      load: async () => ({ handle: 9, shaderHandle: 1 }),
      unload: () => {},
    } as never);
    await assets.loadMaterial('assets/m.esmaterial');
    expect(assets.pathForHandle('material', 9)).toBe('assets/m.esmaterial');
    assets.invalidate('assets/m.esmaterial');
    expect(assets.pathForHandle('material', 9)).toBeNull();
  });

  it('releaseAll clears every record', async () => {
    const assets = createAssets();
    assets.register({
      type: 'material',
      extensions: ['.esmaterial'],
      load: async () => ({ handle: 5, shaderHandle: 1 }),
      unload: () => {},
    } as never);
    await assets.loadMaterial('assets/m.esmaterial');
    assets.releaseAll();
    expect(assets.pathForHandle('material', 5)).toBeNull();
  });
});

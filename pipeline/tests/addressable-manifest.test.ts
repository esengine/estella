// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ship manifest is a packaged build's ONLY channel for the `.meta`.
 *
 * The cook records each asset's importer block, but assembling the addressable
 * manifest used to drop it — so a shipped game had no filter/wrap/sRGB and no
 * 9-slice border, and a frame that sliced correctly in the editor stretched in
 * the build. What ships is the PARSED runtime half: the renderer needs how the
 * texture is sampled, never the cook's own knobs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAddressableManifest } from '../src/assets/addressableManifest';
import type { AddressableManifest } from '../../sdk/src/asset/AddressableManifest';

const SLICED = {
  uuid: 'A0C281AF-F1E6-43F1-9561-834D9AFB25B5',
  path: 'assets/ui/Button_Red.png',
  type: 'texture',
  size: 100,
  importer: {
    maxSize: 2048, compress: true, compressFormat: 'uastc',
    filterMode: 'linear', wrapMode: 'clamp', sRGB: true,
    sliceBorder: { left: 23, right: 24, top: 25, bottom: 29 },
  },
};
const PLAIN = {
  uuid: 'B0000000-0000-4000-8000-000000000000',
  path: 'assets/ui/Background.png',
  type: 'texture',
  size: 100,
  // Cook-only knobs plus an all-zero border: nothing the renderer acts on.
  importer: {
    maxSize: 2048, compress: true, compressFormat: 'uastc',
    sliceBorder: { left: 0, right: 0, top: 0, bottom: 0 },
  },
};

describe('buildAddressableManifest — texture import settings', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'estella-manifest-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const build = async (entries: unknown[]): Promise<AddressableManifest> => {
    await writeFile(path.join(dir, 'assets.manifest.json'), JSON.stringify({ entries }));
    return JSON.parse(await buildAddressableManifest(dir)) as AddressableManifest;
  };

  it('ships the parsed settings, not the raw importer block', async () => {
    const manifest = await build([SLICED]);
    const asset = manifest.groups.main.assets[SLICED.uuid.toLowerCase()];

    expect(asset.textureImport).toEqual({
      filter: 'linear', wrap: 'clamp', srgb: true,
      sliceBorder: { left: 23, right: 24, top: 25, bottom: 29 },
    });
    // The cook's own settings stay behind — they mean nothing to a renderer.
    expect(JSON.stringify(asset)).not.toContain('maxSize');
    expect(JSON.stringify(asset)).not.toContain('compressFormat');
  });

  it('omits the field for an asset whose importer says nothing renderable', async () => {
    const manifest = await build([PLAIN]);
    const asset = manifest.groups.main.assets[PLAIN.uuid.toLowerCase()];

    expect(asset.textureImport).toBeUndefined();
  });

  it('is answerable by every ref spelling once the runtime indexes it', async () => {
    const manifest = await build([{ ...SLICED, sourcePath: 'assets/ui/Button_Red.png', path: 'ca/9f3a1b.png' }]);
    const { ManifestModel } = await import('../../sdk/src/asset/AddressableManifest');
    const lookup = ManifestModel.fromJson(manifest).textureImportLookup();

    // The uuid, the staged path a content-addressed cook renamed it to, and the
    // authored address a path-style ref still names it by.
    for (const ref of [
      SLICED.uuid.toLowerCase(), `@uuid:${SLICED.uuid.toLowerCase()}`,
      'ca/9f3a1b.png', 'assets/ui/Button_Red.png', '/assets/ui/Button_Red.png',
    ]) {
      expect(lookup(ref)?.sliceBorder, ref).toEqual({ left: 23, right: 24, top: 25, bottom: 29 });
    }
  });
});

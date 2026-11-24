// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportedAssetFiles, pruneExportedAssets } from '../src/export/assetCleanup';

describe('exported asset ownership', () => {
  it('keeps a former sprite file used as a mesh texture preview and retires previews with their last owner', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'export-stream-files-'));
    const out = path.join(root, 'dist');
    try {
      await mkdir(out);
      for (const file of ['shared.png', 'retired.png', 'custom.png', 'textures.pack']) {
        await writeFile(path.join(out, file), file);
      }
      const manifest = (assets: object) => writeFile(path.join(out, 'asset-manifest.json'), JSON.stringify({ groups: { main: { assets } } }));
      await manifest({ sprite: { path: 'shared.png' }, mesh: { path: 'mesh.ktx2', pack: { file: 'textures.pack' }, streamTail: { path: 'retired.png' } } });
      const previous = await exportedAssetFiles(out);
      await manifest({ mesh: { path: 'mesh.ktx2', pack: { file: 'textures.pack' }, streamTail: { path: 'shared.png' } } });
      await pruneExportedAssets(out, root, previous);
      for (const file of ['shared.png', 'textures.pack', 'custom.png']) {
        expect(await readFile(path.join(out, file), 'utf8')).toBe(file);
      }
      await expect(readFile(path.join(out, 'retired.png'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });

  it('does not follow an output directory link to delete project files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'export-link-'));
    const out = path.join(root, 'dist'), source = path.join(root, 'source');
    try {
      await mkdir(out); await mkdir(source);
      await writeFile(path.join(source, 'texture.bin'), 'SOURCE');
      await symlink(source, path.join(out, 'linked'), 'junction');
      await pruneExportedAssets(out, root, new Set([path.join(out, 'linked/texture.bin')]));
      expect(await readFile(path.join(source, 'texture.bin'), 'utf8')).toBe('SOURCE');
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });

  it('keeps shared current packs and ignores URLs and paths outside the output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'export-cleanup-'));
    const out = path.join(root, 'dist');
    try {
      await mkdir(out);
      await writeFile(path.join(root, 'source.txt'), 'SOURCE');
      await writeFile(path.join(out, 'shared.pack'), 'PACK');
      await writeFile(path.join(out, 'old.bin'), 'OLD');
      const manifest = (assets: object) => writeFile(path.join(out, 'asset-manifest.json'), JSON.stringify({ groups: { main: { assets } } }));
      await manifest({ a: { path: 'gone.bin', pack: { file: 'shared.pack' } }, b: { path: 'old.bin' },
        c: { path: '../source.txt' }, d: { path: 'https://cdn.example/a.bin' }, e: { path: '.' } });
      const previous = await exportedAssetFiles(out);
      expect(previous.size).toBe(2);
      await manifest({ remaining: { path: 'new.bin', pack: { file: 'shared.pack' } } });
      await pruneExportedAssets(out, root, previous);
      expect(await readFile(path.join(out, 'shared.pack'), 'utf8')).toBe('PACK');
      expect(await readFile(path.join(root, 'source.txt'), 'utf8')).toBe('SOURCE');
      await expect(readFile(path.join(out, 'old.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });

  it('refuses asset deletion when the output contains the project source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'export-overlap-'));
    try {
      const source = path.join(root, 'source.bin');
      await writeFile(source, 'SOURCE');
      await expect(pruneExportedAssets(root, root, new Set([source]))).rejects.toThrow(/separate from the project source/);
      expect(await readFile(source, 'utf8')).toBe('SOURCE');
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A project is not trusted input, and the cook reads by project-relative
 *        path. Together those mean a link inside a project is an instruction to
 *        read whatever it points at — and the cook writes what it reads into the
 *        game that gets shipped. A project cloned, unzipped or handed over could
 *        therefore carry files off the machine that exported it.
 *
 *        The IPC door (resolveInside) already refuses links out. The scanner and
 *        the cook are a separate path: they never went through that door, so a
 *        link named like content, with a sidecar beside it, was indexed and its
 *        target's bytes were staged with no warning.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase } from '../../pipeline/src/assets/assetDb';
import { cookAssets } from '../../pipeline/src/assets/cookAssets';

const SECRET = 'SECRET-BYTES-NOT-IN-THE-PROJECT';
const LEAK_UUID = '33333333-3333-4333-8333-333333333333';
const SCENE_UUID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Windows refuses plain symlinks without elevation but allows directory junctions. */
function linkDir(target: string, at: string): void {
  symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
}

interface Fixture { base: string; root: string; outsideFile: string }

function makeProject(): Fixture {
  const base = mkdtempSync(path.join(tmpdir(), 'estella-escape-'));
  const outside = path.join(base, 'outside');
  mkdirSync(outside, { recursive: true });
  const outsideFile = path.join(outside, 'secret.png');
  writeFileSync(outsideFile, SECRET);

  const root = path.join(base, 'project');
  mkdirSync(path.join(root, 'assets', 'textures'), { recursive: true });
  mkdirSync(path.join(root, 'assets', 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'textures', 'ok.png'), 'legit');
  return { base, root, outsideFile };
}

function writeMeta(abs: string, uuid: string, type: string): void {
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

function writeScene(root: string, texUuid: string): string {
  const rel = 'assets/scenes/main.esscene';
  const abs = path.join(root, rel);
  writeFileSync(abs, JSON.stringify({
    version: 1, name: 's',
    entities: [{
      id: 1, name: 'S', parent: null, children: [],
      components: [{ type: 'Sprite', data: { texture: `@uuid:${texUuid}` } }],
    }],
  }));
  writeMeta(abs, SCENE_UUID, 'scene');
  return rel;
}

describe('a link out of the project reaches neither the index nor the build', () => {
  it('a linked content file is not indexed, with or without a sidecar', async () => {
    const { base, root, outsideFile } = makeProject();
    try {
      symlinkSync(outsideFile, path.join(root, 'assets', 'textures', 'adopted.png'));
      symlinkSync(outsideFile, path.join(root, 'assets', 'textures', 'sidecar.png'));
      writeMeta(path.join(root, 'assets', 'textures', 'sidecar.png'), LEAK_UUID, 'texture');

      const { index } = await scanAssetDatabase(root, { write: false, adopt: true });
      const paths = index.entries.map((e) => e.path);
      expect(paths).toContain('assets/textures/ok.png');
      expect(paths).not.toContain('assets/textures/adopted.png');
      expect(paths).not.toContain('assets/textures/sidecar.png');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('a linked directory is not walked into', async () => {
    const { base, root } = makeProject();
    try {
      const outsideDir = path.join(base, 'outside', 'more');
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(path.join(outsideDir, 'deep.png'), SECRET);
      linkDir(outsideDir, path.join(root, 'assets', 'linked'));

      const { index } = await scanAssetDatabase(root, { write: false, adopt: true });
      expect(index.entries.map((e) => e.path).some((p) => p.includes('deep'))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('a scene referencing a linked texture ships without its bytes', async () => {
    const { base, root, outsideFile } = makeProject();
    try {
      const leak = path.join(root, 'assets', 'textures', 'leak.png');
      symlinkSync(outsideFile, leak);
      writeMeta(leak, LEAK_UUID, 'texture');
      const scene = writeScene(root, LEAK_UUID);

      const out = path.join(base, 'out');
      const cooked = await cookAssets(root, { entryScenes: [scene], outDir: out, contentAddressed: false });

      expect(cooked.includedPaths).not.toContain('assets/textures/leak.png');
      const staged = path.join(out, 'assets', 'textures', 'leak.png');
      expect(existsSync(staged)).toBe(false);
      // Nothing anywhere in the build may carry those bytes.
      const manifest = path.join(out, 'assets.manifest.json');
      if (existsSync(manifest)) expect(readFileSync(manifest, 'utf8')).not.toContain(SECRET);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('a link that stays inside the project still works', async () => {
    const { base, root } = makeProject();
    try {
      const real = path.join(root, 'assets', 'textures', 'real.png');
      writeFileSync(real, 'inside-bytes');
      writeMeta(real, LEAK_UUID, 'texture');
      symlinkSync(real, path.join(root, 'assets', 'textures', 'alias.png'));

      const { index } = await scanAssetDatabase(root, { write: false, adopt: true });
      const paths = index.entries.map((e) => e.path);
      expect(paths).toContain('assets/textures/real.png');
      expect(paths).toContain('assets/textures/alias.png');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

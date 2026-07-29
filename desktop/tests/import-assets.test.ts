// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The import door (importAssets/createAsset): external files copy in +
 *        mint a `.meta`; files ALREADY inside the project register in place —
 *        never a "name 2" duplicate with a fresh identity (the bulk-art dogfood
 *        friction). Unknown extensions skip.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importAssets, createAsset, IMPORT_EXTENSIONS } from '../electron/importAssets';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-import-'));
  outside = mkdtempSync(path.join(tmpdir(), 'estella-src-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const meta = (abs: string): { uuid: string; type: string } =>
  JSON.parse(readFileSync(`${abs}.meta`, 'utf8'));

describe('importAssets', () => {
  it('copies an external file into destDir and mints a .meta', async () => {
    const src = path.join(outside, 'hero.png');
    writeFileSync(src, 'PNG');
    const res = await importAssets(root, 'assets/art', [src]);
    expect(res.imported).toEqual(['assets/art/hero.png']);
    const abs = path.join(root, 'assets/art/hero.png');
    expect(existsSync(abs)).toBe(true);
    expect(meta(abs).type).toBe('texture');
  });

  it('registers an in-project file IN PLACE: no copy, no rename, meta minted beside it', async () => {
    const abs = path.join(root, 'assets/sky/night.png');
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, 'PNG');
    const res = await importAssets(root, 'assets/sky', [abs]);
    expect(res.imported).toEqual(['assets/sky/night.png']);
    // In place: exactly the file + its meta, no "night 2.png".
    expect(readdirSync(path.dirname(abs)).sort()).toEqual(['night.png', 'night.png.meta']);
    expect(meta(abs).type).toBe('texture');
  });

  it('an in-project file that ALREADY has a .meta keeps its uuid (idempotent re-import)', async () => {
    const abs = path.join(root, 'assets/tiles.png');
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, 'PNG');
    writeFileSync(`${abs}.meta`, JSON.stringify({ uuid: 'keep-me', version: '2.0', type: 'texture', importer: {} }));
    const res = await importAssets(root, 'assets', [abs]);
    expect(res.imported).toEqual(['assets/tiles.png']);
    expect(meta(abs).uuid).toBe('keep-me');
  });

  it('destDir is ignored for in-project sources (registration, not relocation)', async () => {
    const abs = path.join(root, 'assets/deep/rock.png');
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, 'PNG');
    const res = await importAssets(root, 'somewhere/else', [abs]);
    expect(res.imported).toEqual(['assets/deep/rock.png']);
    expect(existsSync(path.join(root, 'somewhere/else/rock.png'))).toBe(false);
  });

  it('still dedups the name for EXTERNAL collisions ("hero 2.png")', async () => {
    const src = path.join(outside, 'hero.png');
    writeFileSync(src, 'PNG2');
    mkdirSync(path.join(root, 'assets'), { recursive: true });
    writeFileSync(path.join(root, 'assets/hero.png'), 'PNG1');
    const res = await importAssets(root, 'assets', [src]);
    expect(res.imported).toEqual(['assets/hero 2.png']);
  });

  it('skips unknown extensions', async () => {
    const src = path.join(outside, 'notes.txt');
    writeFileSync(src, 'hi');
    const res = await importAssets(root, 'assets', [src]);
    expect(res.imported).toEqual([]);
    expect(res.skipped).toEqual(['notes.txt']);
  });

  // Spine 2.1 has no binary export: a project on that runtime ships `skeleton.json`,
  // and a name-only door left it unregistered — so the Skeleton Path slot had nothing
  // to offer and rejected the file the user dropped on it.
  it('imports a Spine JSON skeleton as spine (typed by its content, not its name)', async () => {
    const src = path.join(outside, 'skeleton.json');
    writeFileSync(src, '{"skeleton":{"hash":"h","spine":"2.1.27"},"bones":[{"name":"root"}]}');
    const res = await importAssets(root, 'assets/spine', [src]);
    expect(res.imported).toEqual(['assets/spine/skeleton.json']);
    expect(meta(path.join(root, 'assets/spine/skeleton.json')).type).toBe('spine');
  });

  it('still skips a plain data .json — being JSON does not make a file an asset', async () => {
    const src = path.join(outside, 'levels.json');
    writeFileSync(src, '{"levels":[1,2,3]}');
    const res = await importAssets(root, 'assets', [src]);
    expect(res.imported).toEqual([]);
    expect(res.skipped).toEqual(['levels.json']);
  });

  it('offers the content-typed extensions in the dialog filter', () => {
    expect(IMPORT_EXTENSIONS).toContain('json');
    expect(new Set(IMPORT_EXTENSIONS).size).toBe(IMPORT_EXTENSIONS.length);
  });
});

describe('createAsset', () => {
  it('writes content + meta with the explicit type', async () => {
    const rel = await createAsset(root, 'assets/ai', 'patrol.esfsm', '{"states":[]}', 'statemachine');
    expect(rel).toBe('assets/ai/patrol.esfsm');
    expect(meta(path.join(root, rel)).type).toBe('statemachine');
  });

  it('a bare stem gets the type\'s canonical extension (the MCP door passes no extension)', async () => {
    const rel = await createAsset(root, 'assets/animations', 'walk', '{"frames":[]}', 'animclip');
    expect(rel).toBe('assets/animations/walk.esanim');
    expect(meta(path.join(root, rel)).type).toBe('animclip');
  });

  it('a bare stem with an unknown type is a loud error, not an extensionless file', async () => {
    await expect(createAsset(root, 'assets', 'thing', '{}', 'nonsense')).rejects.toThrow(/unknown asset type/);
    expect(existsSync(path.join(root, 'assets/thing'))).toBe(false);
  });

  it('a type/extension mismatch is a loud error (incoherent on disk)', async () => {
    await expect(createAsset(root, 'assets', 'walk.esanim', '{}', 'scene')).rejects.toThrow(/does not match/);
  });
});

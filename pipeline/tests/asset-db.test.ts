// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  AssetDatabase scanner (REARCH_ASSETS.md A2). A pure-node step: walk a
 *        project's `.meta` sidecars into a uuid↔path registry + a dependency
 *        graph (which scene/prefab references which asset), written to
 *        `.esengine/cache/assets.json`. Skips code/build/vcs dirs; reads the
 *        `type` each `.meta` already declares (no extension table).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase, type AssetIndex } from '../src/assets/assetDb';

let root: string;

const TEX_UUID = '11111111-1111-4111-8111-111111111111';
const FONT_UUID = '22222222-2222-4222-8222-222222222222';
const SCENE_UUID = '33333333-3333-4333-8333-333333333333';

function writeAsset(rel: string, type: string, uuid: string, body = ''): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-assetdb-'));
  // Two leaf assets + a scene that references them by @uuid:.
  writeAsset('assets/textures/player.png', 'texture', TEX_UUID, 'PNGDATA');
  writeAsset('assets/fonts/ui.fnt', 'font', FONT_UUID, 'FNTDATA');
  writeAsset(
    'assets/scenes/main.esscene',
    'scene',
    SCENE_UUID,
    JSON.stringify({
      version: '1.0',
      name: 'main',
      entities: [
        {
          id: 1,
          name: 'Hero',
          parent: null,
          children: [],
          components: [
            { type: 'Sprite', data: { texture: `@uuid:${TEX_UUID}` } },
            { type: 'BitmapText', data: { font: `@uuid:${FONT_UUID}` } },
          ],
        },
      ],
    }),
  );
  // A code dir that must be SKIPPED even though it contains a stray .meta.
  const nm = path.join(root, 'node_modules', 'pkg');
  mkdirSync(nm, { recursive: true });
  writeFileSync(path.join(nm, 'thing.png.meta'), JSON.stringify({ uuid: 'deadbeef', type: 'texture' }));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('scanAssetDatabase (A2)', () => {
  it('indexes every .meta into uuid↔path entries and writes assets.json', async () => {
    const res = await scanAssetDatabase(root);
    expect(res.ok).toBe(true);
    expect(res.outputPath).toBe(path.join(root, '.esengine/cache/assets.json'));
    expect(existsSync(res.outputPath!)).toBe(true);

    const byUuid = Object.fromEntries(res.index.entries.map((e) => [e.uuid, e]));
    expect(byUuid[TEX_UUID].path).toBe('assets/textures/player.png');
    expect(byUuid[TEX_UUID].type).toBe('texture');
    expect(byUuid[FONT_UUID].path).toBe('assets/fonts/ui.fnt');
    expect(byUuid[SCENE_UUID].type).toBe('scene');

    // The written artifact matches the returned index.
    const onDisk = JSON.parse(readFileSync(res.outputPath!, 'utf8')) as AssetIndex;
    expect(onDisk.entries.length).toBe(res.index.entries.length);
  });

  it('builds a dependency graph: the scene depends on the assets it references', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.deps[SCENE_UUID]).toEqual([FONT_UUID, TEX_UUID].sort());
    // Leaf assets have no deps.
    expect(index.deps[TEX_UUID]).toBeUndefined();
  });

  it('skips node_modules / build / vcs dirs', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.entries.some((e) => e.path.includes('node_modules'))).toBe(false);
    expect(index.entries.length).toBe(3); // texture + font + scene, nothing from node_modules
  });

  it('write-if-changed: an unchanged index does not rewrite assets.json', async () => {
    const first = await scanAssetDatabase(root);
    const mtime = statSync(first.outputPath!).mtimeMs;
    const second = await scanAssetDatabase(root);
    expect(statSync(second.outputPath!).mtimeMs).toBe(mtime); // untouched → no watcher echo
  });
});

describe('scanAssetDatabase — orphan adoption', () => {
  it('adopts a content file with no .meta: mints one and indexes it this scan', async () => {
    const abs = path.join(root, 'assets/textures/orphan.png');
    writeFileSync(abs, 'PNGDATA');
    const res = await scanAssetDatabase(root, { write: false });
    expect(res.adopted).toEqual(['assets/textures/orphan.png']);
    expect(existsSync(`${abs}.meta`)).toBe(true);
    const meta = JSON.parse(readFileSync(`${abs}.meta`, 'utf8'));
    expect(meta.type).toBe('texture');
    const entry = res.index.entries.find((e) => e.path === 'assets/textures/orphan.png');
    expect(entry?.uuid).toBe(meta.uuid.toLowerCase());
    // Second scan: nothing left to adopt, identity stable.
    const again = await scanAssetDatabase(root, { write: false });
    expect(again.adopted).toEqual([]);
    expect(again.index.entries.find((e) => e.path === 'assets/textures/orphan.png')?.uuid)
      .toBe(entry?.uuid);
    rmSync(abs); rmSync(`${abs}.meta`);
  });

  it('leaves unknown extensions alone (docs and source files are not assets)', async () => {
    const abs = path.join(root, 'assets/README.txt');
    writeFileSync(abs, 'hello');
    const res = await scanAssetDatabase(root, { write: false });
    expect(res.adopted).toEqual([]);
    expect(existsSync(`${abs}.meta`)).toBe(false);
    rmSync(abs);
  });

  it('the project-root thumbnail.png (editor-managed launcher cover) is never adopted', async () => {
    const abs = path.join(root, 'thumbnail.png');
    writeFileSync(abs, 'PNGDATA');
    const res = await scanAssetDatabase(root, { write: false });
    expect(res.adopted).toEqual([]);
    expect(existsSync(`${abs}.meta`)).toBe(false);
    rmSync(abs);
  });

  it('adopt: false is a pure read (cook path) — orphans stay untouched', async () => {
    const abs = path.join(root, 'assets/pure.png');
    writeFileSync(abs, 'PNGDATA');
    const res = await scanAssetDatabase(root, { write: false, adopt: false });
    expect(res.adopted).toEqual([]);
    expect(existsSync(`${abs}.meta`)).toBe(false);
    rmSync(abs);
  });

  // "I dropped my spine folder into the project" — with a JSON skeleton, which is
  // all Spine 2.1 can export. Nothing in the NAME says the `.json` is a skeleton,
  // so a name-only adoption left it out of the registry entirely and its component
  // slot had nothing to offer.
  it('adopts a JSON Spine skeleton as spine and a plain one as data', async () => {
    const skel = path.join(root, 'assets/skeleton.json');
    const data = path.join(root, 'assets/levels.json');
    writeFileSync(skel, '{"skeleton":{"hash":"h","spine":"2.1.27"},"bones":[{"name":"root"}]}');
    writeFileSync(data, '{"levels":[1,2,3]}');
    const res = await scanAssetDatabase(root, { write: false });
    expect(res.adopted.sort()).toEqual(['assets/levels.json', 'assets/skeleton.json']);
    // The marker inside the file wins; a `.json` nobody else claims is data.
    expect(JSON.parse(readFileSync(`${skel}.meta`, 'utf8')).type).toBe('spine');
    expect(JSON.parse(readFileSync(`${data}.meta`, 'utf8')).type).toBe('json');
    expect(res.index.entries.find((e) => e.path === 'assets/skeleton.json')?.type).toBe('spine');
    expect(res.index.entries.find((e) => e.path === 'assets/levels.json')?.type).toBe('json');
    rmSync(skel); rmSync(`${skel}.meta`); rmSync(data); rmSync(`${data}.meta`);
  });

  it("leaves the project's own config files alone", async () => {
    // Every project has these, and a `.meta` beside them is pure noise.
    const ts = path.join(root, 'tsconfig.json');
    const pkg = path.join(root, 'package.json');
    writeFileSync(ts, '{"compilerOptions":{}}');
    writeFileSync(pkg, '{"name":"game"}');
    const res = await scanAssetDatabase(root, { write: false });
    expect(res.adopted).toEqual([]);
    expect(existsSync(`${ts}.meta`)).toBe(false);
    expect(existsSync(`${pkg}.meta`)).toBe(false);
    rmSync(ts); rmSync(pkg);
  });
});

describe('two files that claim the same uuid', () => {
  // A uuid IS the asset's identity: the registry is a uuid→path map, so a shared one
  // keeps a single winner. The other file is then in no registry at all, and every
  // reference to that uuid resolves to whichever the scan saw last — which reaches a
  // user as "the sprite I dropped shows a different picture than the preview".
  it('gives each file its own identity back, on disk, and says so', async () => {
    const shared = '44444444-4444-4444-8444-444444444444';
    writeAsset('assets/bulk/a.png', 'texture', shared, 'A');
    writeAsset('assets/bulk/b.png', 'texture', shared, 'B');
    writeAsset('assets/bulk/c.png', 'texture', shared, 'C');

    const res = await scanAssetDatabase(root, { write: false });
    const bulk = res.index.entries.filter((e) => e.path.startsWith('assets/bulk/'));
    expect(bulk.map((e) => e.path)).toEqual(['assets/bulk/a.png', 'assets/bulk/b.png', 'assets/bulk/c.png']);
    expect(new Set(bulk.map((e) => e.uuid)).size).toBe(3);

    // The FIRST in path order keeps it, so a re-scan does not shuffle identities and
    // whatever already referenced it still resolves.
    expect(bulk[0].uuid).toBe(shared);
    expect(res.reminted.sort()).toEqual(['assets/bulk/b.png', 'assets/bulk/c.png']);
    expect(res.warnings.some((w) => /shared its uuid/.test(w))).toBe(true);

    // Written through, not just fixed in memory — the next scan must agree.
    const uuidOf = (p: string) => JSON.parse(readFileSync(path.join(root, `${p}.meta`), 'utf8')).uuid;
    expect(uuidOf('assets/bulk/b.png')).not.toBe(shared);
    expect(uuidOf('assets/bulk/c.png')).not.toBe(uuidOf('assets/bulk/b.png'));

    const again = await scanAssetDatabase(root, { write: false });
    expect(again.reminted).toEqual([]);
    expect(new Set(again.index.entries.filter((e) => e.path.startsWith('assets/bulk/')).map((e) => e.uuid)).size).toBe(3);

    for (const f of ['a.png', 'b.png', 'c.png']) {
      rmSync(path.join(root, `assets/bulk/${f}`));
      rmSync(path.join(root, `assets/bulk/${f}.meta`));
    }
  });
});

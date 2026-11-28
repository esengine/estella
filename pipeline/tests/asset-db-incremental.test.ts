// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Incremental asset-index update (Task 1). The watcher delivers precise
 *        changed paths, so a disk touch folds into the cached index per-path
 *        instead of re-walking the whole tree. The correctness bar: the
 *        incremental result must be IDENTICAL to a full rescan of the same on-disk
 *        state — same `entries`, same dependency graph — so Find Usages, delete
 *        warnings and the cook can't disagree with what actually changed. Plus the
 *        explicit fallback cases (overflow / bulk / directory move → full rescan).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase, updateAssetIndex, INCREMENTAL_PATH_LIMIT } from '../src/assets/assetDb';

let root: string;

const TEX = '11111111-1111-4111-8111-111111111111';
const TEX2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FONT = '22222222-2222-4222-8222-222222222222';
const MAT = '44444444-4444-4444-8444-444444444444';
const SCENE = '33333333-3333-4333-8333-333333333333';
const BITMAP = '55555555-5555-4555-8555-555555555555';

function writeAsset(rel: string, type: string, uuid: string, body = ''): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

function sceneBody(refs: { texture?: string; font?: string }): string {
  return JSON.stringify({
    version: '1.0',
    name: 'main',
    entities: [
      {
        id: 1, name: 'Hero', parent: null, children: [],
        components: [
          ...(refs.texture ? [{ type: 'Sprite', data: { texture: `@uuid:${refs.texture}` } }] : []),
          ...(refs.font ? [{ type: 'BitmapText', data: { font: `@uuid:${refs.font}` } }] : []),
        ],
      },
    ],
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-inc-'));
  writeAsset('assets/textures/player.png', 'texture', TEX, 'PNGDATA');
  writeAsset('assets/fonts/ui.fnt', 'font', FONT, 'FNTDATA');
  writeAsset('assets/scenes/main.esscene', 'scene', SCENE, sceneBody({ texture: TEX, font: FONT }));
});

it('tracks rich Text image sources by path and UUID on a cold and an incremental scan', async () => {
  writeAsset('assets/textures/badge.png', 'imageSource', TEX2, 'PNG');
  const scene = 'assets/scenes/main.esscene';
  const textScene = (richText: boolean) => JSON.stringify({ entities: [{ components: [
    { type: 'Text', data: { richText, content: `A<img src="assets/textures/player.png"/>B<img src='@uuid:${TEX2}'/>` } },
    { type: 'Text', data: { richText: false, content: `<img src="@uuid:${FONT}"/>` } },
  ] }] });
  writeFileSync(path.join(root, scene), textScene(true));
  const first = await scanAssetDatabase(root, { write: false });
  expect(first.index.deps[SCENE]).toEqual([TEX, TEX2].sort());
  const cacheFile = path.join(root, '.esengine/cache/ref-candidates.json');
  const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  cache.files[scene].c = [];
  writeFileSync(cacheFile, JSON.stringify({ ...cache, version: 1 }));
  expect((await scanAssetDatabase(root, { write: false })).index.deps[SCENE]).toEqual(first.index.deps[SCENE]);
  writeFileSync(path.join(root, scene), textScene(false));
  const changed = await updateAssetIndex(root, first.index, [scene]);
  expect(changed.index.deps[SCENE] ?? []).toEqual([]);
  expect((await scanAssetDatabase(root, { write: false })).index.deps).toEqual(changed.index.deps);
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** Assert an incremental update equals a full rescan of the same on-disk state. */
async function expectIncrementalEqualsFull(prev: Awaited<ReturnType<typeof scanAssetDatabase>>['index'], changed: string[]): Promise<void> {
  const inc = await updateAssetIndex(root, prev, changed, { write: false });
  const full = await scanAssetDatabase(root, { write: false, adopt: false });
  expect(inc.fullRescan).toBe(false);
  expect(inc.index.entries).toEqual(full.index.entries);
  expect(inc.index.deps).toEqual(full.index.deps);
}

describe('updateAssetIndex — incremental == full rescan', () => {
  it('detects a bitmap font page change when the file size and mtime are preserved', async () => {
    const metrics = 'assets/fonts/status.fnt';
    const abs = path.join(root, metrics);
    const stamp = new Date('2025-01-02T03:04:05Z');
    const fnt = (file: string) => `common lineHeight=8 scaleW=8 scaleH=8 pages=1\npage id=0 file="${file}"\n`;
    writeAsset('assets/fonts/base.png', 'texture', TEX2);
    writeAsset('assets/fonts/next.png', 'texture', MAT);
    writeAsset(metrics, 'bitmapfont', BITMAP, fnt('base.png'));
    utimesSync(abs, stamp, stamp);
    const { index: previous } = await scanAssetDatabase(root, { write: false });
    expect(previous.deps[BITMAP]).toEqual([TEX2]);
    const { size, mtimeMs } = statSync(abs);
    writeFileSync(abs, fnt('next.png'));
    utimesSync(abs, stamp, stamp);
    expect(statSync(abs)).toMatchObject({ size, mtimeMs });
    const full = await scanAssetDatabase(root, { write: false });
    expect(full.index.deps[BITMAP]).toEqual([MAT]);
    await expectIncrementalEqualsFull(previous, [metrics]);
  });

  it('a content edit that DROPS a scene ref removes just that dependency edge', async () => {
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    expect(prev.deps[SCENE]).toEqual([FONT, TEX].sort());

    writeFileSync(path.join(root, 'assets/scenes/main.esscene'), sceneBody({ texture: TEX })); // font ref gone
    await expectIncrementalEqualsFull(prev, ['assets/scenes/main.esscene']);

    // And concretely: the edge to the font is gone, the texture edge stays.
    const inc = await updateAssetIndex(root, prev, ['assets/scenes/main.esscene'], { write: false });
    expect(inc.index.deps[SCENE]).toEqual([TEX]);
  });

  it('a .meta-only touch (paired to its content path) refreshes the entry', async () => {
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    writeFileSync(
      path.join(root, 'assets/textures/player.png.meta'),
      JSON.stringify({ uuid: TEX, version: '2.0', type: 'texture', importer: { filter: 'nearest' } }),
    );
    await expectIncrementalEqualsFull(prev, ['assets/textures/player.png.meta']);
    const inc = await updateAssetIndex(root, prev, ['assets/textures/player.png.meta'], { write: false });
    expect(inc.index.entries.find((e) => e.uuid === TEX)?.importer).toEqual({ filter: 'nearest' });
  });

  it('ADDING an asset + a ref to it updates entries AND the dep graph', async () => {
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    writeAsset('assets/textures/enemy.png', 'texture', TEX2, 'PNG2');
    writeFileSync(path.join(root, 'assets/scenes/main.esscene'), sceneBody({ texture: TEX2, font: FONT }));
    await expectIncrementalEqualsFull(prev, ['assets/textures/enemy.png', 'assets/scenes/main.esscene']);
  });

  it('a PATH-ref that only resolves once its target is added (reverse-dep) matches full', async () => {
    // A material references a sibling texture by relative path; the texture is
    // added AFTER the material — the edge must appear once both exist, exactly as a
    // full rescan resolves it.
    writeAsset('assets/materials/m.esmaterial', 'material', MAT, JSON.stringify({
      type: 'material', shader: 'builtin:sprite-unlit', properties: { mainTex: 'wall.png' },
    }));
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    expect(prev.deps[MAT]).toBeUndefined(); // wall.png doesn't exist yet → no edge

    writeAsset('assets/materials/wall.png', 'texture', TEX2, 'WALL');
    await expectIncrementalEqualsFull(prev, ['assets/materials/wall.png']);
    const inc = await updateAssetIndex(root, prev, ['assets/materials/wall.png'], { write: false });
    expect(inc.index.deps[MAT]).toEqual([TEX2]); // the referrer's edge now resolves
  });

  it('leaves the dependency graph unchanged when only the pixels of an indexed texture change', async () => {
    const texture = 'assets/textures/player.png';
    writeAsset('assets/materials/m.esmaterial', 'material', MAT, JSON.stringify({ properties: { mainTex: texture } }));
    const { index: before } = await scanAssetDatabase(root, { write: false });
    expect(before.deps[MAT]).toEqual([TEX]);

    writeFileSync(path.join(root, texture), 'UPDATED PNG DATA');
    await expectIncrementalEqualsFull(before, [texture]);
  });

  it('DELETING an asset drops its entry (dep edges from @uuid: referrers persist, as in full)', async () => {
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    rmSync(path.join(root, 'assets/fonts/ui.fnt'));
    rmSync(path.join(root, 'assets/fonts/ui.fnt.meta'));
    await expectIncrementalEqualsFull(prev, ['assets/fonts/ui.fnt', 'assets/fonts/ui.fnt.meta']);
    const inc = await updateAssetIndex(root, prev, ['assets/fonts/ui.fnt.meta'], { write: false });
    expect(inc.index.entries.some((e) => e.uuid === FONT)).toBe(false);
  });

  // A removal doesn't recompute the whole graph any more — only the documents that
  // referenced what left. A PATH-ref is the case that proves the set is right: it
  // stops resolving when its target goes, so its referrer MUST be re-read (unlike
  // an `@uuid:` one, which a full scan keeps dangling).
  it('DELETING a path-ref target re-resolves its referrer, matching full', async () => {
    writeAsset('assets/materials/wall.png', 'texture', TEX2, 'WALL');
    writeAsset('assets/materials/m.esmaterial', 'material', MAT, JSON.stringify({
      type: 'material', shader: 'builtin:sprite-unlit', properties: { mainTex: 'wall.png' },
    }));
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    expect(prev.deps[MAT]).toEqual([TEX2]);

    rmSync(path.join(root, 'assets/materials/wall.png'));
    rmSync(path.join(root, 'assets/materials/wall.png.meta'));
    await expectIncrementalEqualsFull(prev, ['assets/materials/wall.png', 'assets/materials/wall.png.meta']);

    const inc = await updateAssetIndex(root, prev, ['assets/materials/wall.png'], { write: false });
    expect(inc.index.deps[MAT]).toBeUndefined(); // the edge is gone, not left dangling
  });

  it('DELETING a .meta while the content file stays re-adopts it, like a full scan', async () => {
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    rmSync(path.join(root, 'assets/textures/player.png.meta')); // orphan the png
    const inc = await updateAssetIndex(root, prev, ['assets/textures/player.png.meta'], { write: false });
    // Re-adopted → still an entry (a fresh uuid, so not identity-comparable to full).
    expect(inc.adopted).toEqual(['assets/textures/player.png']);
    expect(inc.index.entries.some((e) => e.path === 'assets/textures/player.png')).toBe(true);
  });

  it.each(['{"uuid":', JSON.stringify({ uuid: TEX2 }), 'null'])(
    're-resolves references while an atlas sidecar is invalid (%s), and recovers on repair', async invalidMeta => {
      const atlas = 'assets/tiles/ground.png', backup = 'ground.png';
      const fallback = '55555555-5555-4555-8555-555555555555';
      writeAsset(atlas, 'texture', TEX2, 'ATLAS');
      writeAsset(backup, 'texture', fallback, 'FALLBACK');
      writeAsset('assets/tiles/material.esmaterial', 'material', MAT, JSON.stringify({ properties: { mainTex: 'ground.png' } }));
      const { index: good } = await scanAssetDatabase(root, { write: false });
      expect(good.deps[MAT]).toEqual([TEX2]);

      const sidecar = `${atlas}.meta`;
      const validMeta = readFileSync(path.join(root, sidecar), 'utf8');
      writeFileSync(path.join(root, sidecar), invalidMeta);
      const invalid = await updateAssetIndex(root, good, [sidecar], { write: false });
      const full = await scanAssetDatabase(root, { write: false });
      expect(invalid.fullRescan).toBe(false);
      expect(invalid.index).toEqual(full.index);
      expect(invalid.index.deps[MAT]).toEqual([fallback]);
      expect(invalid.warnings.find(warning => warning.startsWith(sidecar))).toBe(full.warnings.find(warning => warning.startsWith(sidecar)));
      expect(invalid.warnings.some(warning => warning.startsWith(sidecar))).toBe(true);

      writeFileSync(path.join(root, sidecar), validMeta);
      const repaired = await updateAssetIndex(root, invalid.index, [sidecar], { write: false });
      expect(repaired.index).toEqual(good);
    },
  );
});

describe('updateAssetIndex — fallbacks (never silent)', () => {
  it('an empty change set (watcher overflow) falls back to a full rescan', async () => {
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    const inc = await updateAssetIndex(root, prev, [], { write: false });
    expect(inc.fullRescan).toBe(true);
    expect(inc.reason).toContain('overflow');
  });

  it('a bulk change above the limit falls back to a full rescan', async () => {
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    const many = Array.from({ length: INCREMENTAL_PATH_LIMIT + 1 }, (_, i) => `assets/x${i}.png`);
    const inc = await updateAssetIndex(root, prev, many, { write: false });
    expect(inc.fullRescan).toBe(true);
    expect(inc.reason).toContain('bulk');
  });

  it('a directory change (create / rename / move) falls back to a full rescan', async () => {
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    mkdirSync(path.join(root, 'assets/newdir'));
    const inc = await updateAssetIndex(root, prev, ['assets/newdir'], { write: false });
    expect(inc.fullRescan).toBe(true);
    expect(inc.reason).toContain('directory');
  });

  it('a removed directory that held assets falls back (its child moves are invisible)', async () => {
    const { index: prev } = await scanAssetDatabase(root, { write: false });
    // Simulate the dir vanishing (the watcher may report only the dir path).
    rmSync(path.join(root, 'assets/fonts'), { recursive: true, maxRetries: 10, retryDelay: 50 });
    const inc = await updateAssetIndex(root, prev, ['assets/fonts'], { write: false });
    expect(inc.fullRescan).toBe(true);
    expect(inc.reason).toContain('directory');
  });
});

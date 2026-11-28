// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { importAsepriteFile } from '../src/assets/importSpriteFile';
import { writeAseprite } from './asepriteWriter';
import { scanAssetDatabase } from '../src/assets/assetDb';
import { cookAssets } from '../src/assets/cookAssets';
import { encodeRgbaPng } from '../src/assets/png';

type Tag = [name: string, cell: number];
async function fixture() {
  const base = await realpath(tmpdir()), root = await mkdtemp(path.join(base, 'estella-ase-reimport-'));
  onTestFinished(async () => {
    if (path.dirname(root) === base) await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  });
  const destDir = 'generated', absSource = path.join(root, 'Fox.aseprite'), dir = path.join(root, destDir);
  await mkdir(dir);
  const file = (name: string) => path.join(dir, name);
  const json = async (name: string) => JSON.parse(await readFile(file(name), 'utf8'));
  const source = (tags: Tag[], reds = [10, 20, 30]) => writeFile(absSource, writeAseprite({
    width: 1, height: 1, layers: [{ name: 'Art' }],
    frames: reds.map(red => ({ duration: red, cels: [{ layer: 0, x: 0, y: 0, w: 1, h: 1, pixels: [red, 0, 0, 255] }] })),
    tags: tags.map(([name, cell]) => ({ name, from: cell, to: cell, direction: 0 })),
  }));
  return { root, dir, file, json, source, location: { root, absSource, destDir } };
}

it('migrates older tag clips by their old cells, and freezes all references to the previous page before retrying', async () => {
  const f = await fixture(), run = () => importAsepriteFile(f.location);
  await f.source([['A B', 0], ['A-B', 1], ['Stop', 2], ['Idle', 0]]);
  const first = await run(), page = await f.json('Fox.png.meta');
  const originalPng = await readFile(f.file('Fox.png'));
  page.importer.filterMode = 'linear';
  await writeFile(f.file('Fox.png.meta'), JSON.stringify(page));
  // The previous importer wrote these same products with only their source UUID in the sidecar.
  for (const rel of first.products.filter(p => p.endsWith('.esanim'))) {
    const name = path.basename(rel) + '.meta', meta = await f.json(name);
    delete meta.asepriteTag;
    await writeFile(f.file(name), JSON.stringify(meta));
  }
  const previous = await f.json('Fox_Stop.esanim'), uuid = (await f.json('Fox_Stop.esanim.meta')).uuid;
  previous.sheet.texture = '@uuid:' + page.uuid;
  previous.events = [{ frame: 0, name: 'footfall' }];
  previous.frames.push({ texture: page.uuid, duration: 2 }, { texture: 'other.png' });
  await writeFile(f.file('Fox_Stop.esanim'), JSON.stringify(previous));
  await f.source([['A-B', 1], ['A B', 0]], [70, 80]);
  await expect(importAsepriteFile({ ...f.location, beforeWrite(rel) {
    if (rel === 'generated/Fox.png') throw new Error('test interruption');
  } })).rejects.toThrow('test interruption');
  expect(await readFile(f.file('Fox.png'))).toEqual(originalPng);
  await run();
  expect((await f.json('Fox_A-B.esanim')).frames[0]).toEqual({ cell: 0, duration: 0.07 });
  expect((await f.json('Fox_A-B-2.esanim')).frames[0]).toEqual({ cell: 1, duration: 0.08 });
  const stop = await f.json('Fox_Stop.esanim'), frozen = path.basename(stop.sheet.texture);
  expect(await readFile(f.file(frozen))).toEqual(originalPng);
  expect(stop.events).toEqual(previous.events);
  expect(stop.frames.slice(1)).toEqual([{ texture: stop.sheet.texture, duration: 2 }, { texture: 'other.png' }]);
  expect((await f.json('Fox_Idle.esanim')).sheet.texture).toBe(stop.sheet.texture);
  expect((await f.json(frozen + '.meta')).importer).toEqual(page.importer);
  expect(await f.json('Fox_Stop.esanim.meta')).toMatchObject({ uuid });
  expect((await f.json('Fox_Stop.esanim.meta')).source).toBeUndefined();
  await f.source([['Stop', 0]], [90]);
  await run();
  expect((await f.json('Fox_Stop-2.esanim.meta')).uuid).not.toBe(uuid);
  expect(await f.json('Fox_Stop.esanim')).toEqual(stop);
});

it('reserves artist filenames, keeps standalone imports separate and gives new Unicode tags readable names', async () => {
  const f = await fixture();
  const standalone = { ...f.location, root: f.dir, destDir: '' };
  const run = () => importAsepriteFile(standalone);
  await writeFile(f.file('Fox.png'), 'artist page');
  await writeFile(f.file('Fox_待机.esanim'), 'artist animation');
  await f.source([['待机', 0], ['奔跑', 2]]);
  const first = await run();
  expect(first.products).toEqual(['Fox-2.png', 'Fox_待机-2.esanim', 'Fox_奔跑.esanim']);
  expect((await f.json('Fox_待机-2.esanim')).sheet.texture).toBe('Fox-2.png');
  const ids = await Promise.all(first.products.map(p => f.json(p + '.meta').then(meta => meta.uuid)));
  await f.source([['奔跑', 1], ['待机', 2]]);
  await run();
  expect(await Promise.all(first.products.map(p => f.json(p + '.meta').then(meta => meta.uuid)))).toEqual(ids);
  expect((await f.json('Fox_待机-2.esanim')).frames[0].cell).toBe(2);
  await f.source([]);
  const whole = await run();
  expect(whole.products).toEqual(['Fox-2.png', 'Fox.esanim']);
  expect((await f.json('Fox_待机-2.esanim.meta')).asepriteOrigin).toBeUndefined();
  expect((await readdir(f.dir)).filter(n => n.includes('-retained-') && n.endsWith('.png'))).toHaveLength(1);
  await f.source([['奔跑', 0]]);
  await run();
  expect((await f.json('Fox_奔跑-2.esanim.meta')).uuid).not.toBe(ids[2]);
  expect(await readFile(f.file('Fox.png'), 'utf8')).toBe('artist page');
  expect(await readFile(f.file('Fox_待机.esanim'), 'utf8')).toBe('artist animation');
});

it.each(['indexed', 'unindexed'])('keeps a retired clip’s project-first reference to an %s texture', async registry => {
  const f = await fixture(), run = () => importAsepriteFile(f.location);
  await f.source([['Rest', 0], ['Run', 1]]);
  await run();
  const oldPage = await readFile(f.file('Fox.png'));
  await writeFile(path.join(f.root, 'Fox.png'), encodeRgbaPng(1, 1, new Uint8Array([200, 10, 20, 255])));
  if (registry === 'indexed') await scanAssetDatabase(f.root, { write: false });
  const generated = await f.json('Fox.png.meta');
  const clipFile = 'Fox_Rest.esanim';
  const edited = await f.json(clipFile);
  edited.sheet.texture = 'Fox.png';
  edited.frames = [
    { texture: 'Fox.png?revision=2', duration: 1 },
    { texture: './Fox.png', duration: 2 },
    { texture: '@uuid:' + generated.uuid, duration: 3 },
  ];
  await writeFile(f.file(clipFile), JSON.stringify(edited));
  await f.source([['Run', 0]], [90, 100]);
  await run();

  const retired = await f.json(clipFile);
  expect(retired.sheet.texture).toBe(edited.sheet.texture);
  expect(retired.frames[0]).toEqual(edited.frames[0]);
  expect(retired.frames[1].texture).toMatch(/^generated\/Fox-retained-.*\.png$/);
  expect(retired.frames[2].texture).toBe(retired.frames[1].texture);
  expect(await readFile(path.join(f.root, retired.frames[1].texture))).toEqual(oldPage);
  const retiredId = (await f.json(clipFile + '.meta')).uuid;
  const snapshotId = (await f.json(path.basename(retired.frames[1].texture) + '.meta')).uuid;
  const scene = 'main.esscene';
  await writeFile(path.join(f.root, scene), JSON.stringify({
    version: 4, entities: [{
      id: 1, name: 'Fox', parent: null, children: [],
      components: [{ type: 'SpriteAnimator', data: { clip: '@uuid:' + retiredId } }],
    }],
  }));
  const rescanned = await scanAssetDatabase(f.root, { write: false });
  const other = rescanned.index.entries.find(entry => entry.path === 'Fox.png')!;
  expect(rescanned.index.deps[retiredId]).toEqual(expect.arrayContaining([other.uuid, snapshotId]));
  expect(rescanned.index.deps[retiredId]).not.toContain(generated.uuid);
  const cooked = await cookAssets(f.root, { entryScenes: [scene], outDir: 'build', contentAddressed: true });
  expect(cooked.ok, [...cooked.failed, ...cooked.warnings].join('\n')).toBe(true);
  expect(cooked.included).toEqual(expect.arrayContaining([retiredId, other.uuid, snapshotId]));
  expect(cooked.included).not.toContain(generated.uuid);
});

it('keeps duplicate named tags by range and treats a new punctuated name as a separate animation', async () => {
  const f = await fixture(), run = () => importAsepriteFile(f.location);
  await f.source([['Run', 0], ['Run', 1], ['Fast Run', 2]]);
  await run();
  const first = await f.json('Fox_Run.esanim.meta'), second = await f.json('Fox_Run-2.esanim.meta');
  await f.source([['Run', 1], ['Fast-Run', 2], ['Run', 2]]);
  await run();
  expect((await f.json('Fox_Run.esanim')).frames[0].cell).toBe(2);
  expect((await f.json('Fox_Run-2.esanim')).frames[0].cell).toBe(1);
  expect((await f.json('Fox_Run.esanim.meta')).uuid).toBe(first.uuid);
  expect((await f.json('Fox_Run-2.esanim.meta')).uuid).toBe(second.uuid);
  expect((await f.json('Fox_Fast-Run.esanim.meta')).source).toBeUndefined();
  expect((await f.json('Fox_Fast-Run-2.esanim.meta')).source).toBe(first.source);
  const before = (await readdir(f.dir)).sort();
  await run();
  expect((await readdir(f.dir)).sort()).toEqual(before);
});

it('keeps indistinguishable old tags intact when only one of them changes', async () => {
  const f = await fixture(), run = () => importAsepriteFile(f.location);
  await f.source([['Blink', 0], ['Blink', 0]]);
  const initial = await run();
  expect((await run()).products).toEqual(initial.products);
  await f.source([['Blink', 0], ['Blink', 1]]);
  expect((await run()).products).toEqual(['generated/Fox.png', 'generated/Fox_Blink-3.esanim', 'generated/Fox_Blink-4.esanim']);
  const old = await f.json('Fox_Blink.esanim'), sibling = await f.json('Fox_Blink-2.esanim');
  expect(old).toEqual(sibling);
  expect(old.sheet.texture).not.toBe('generated/Fox.png');
  expect((await f.json('Fox_Blink.esanim.meta')).source).toBeUndefined();
});

it('leaves an asset reassigned mid-import intact and chooses a free name on retry', async () => {
  const f = await fixture(), run = () => importAsepriteFile(f.location);
  await f.source([['Hop', 0]]);
  await run();
  const name = 'Fox_Hop.esanim', original = await readFile(f.file(name), 'utf8');
  await f.source([['Hop', 2]]);
  await expect(importAsepriteFile({ ...f.location, async beforeWrite(rel) {
    if (rel === 'generated/' + name) {
      const sidecar = await f.json(name + '.meta');
      await writeFile(f.file(name + '.meta'), JSON.stringify({ ...sidecar, source: 'other-owner' }));
    }
  } })).rejects.toThrow('Asset identity changed');
  expect(await readFile(f.file(name), 'utf8')).toBe(original);
  expect((await run()).products).toEqual(['generated/Fox.png', 'generated/Fox_Hop-2.esanim']);
  expect((await f.json(name + '.meta')).source).toBe('other-owner');
});

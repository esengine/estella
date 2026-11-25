// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { writePsd } from 'ag-psd';
import jpeg from 'jpeg-js';
import { expect, it, onTestFinished } from 'vitest';
import { plainTriangle } from './fixtures/gltfFixtures.mjs';
import { fill, writeAseprite } from './asepriteWriter';

const cli = fileURLToPath(new URL('../bin/estella.mjs', import.meta.url));
const execute = promisify(execFile);
const run = (...args: string[]) => execute(process.execPath, [cli, ...args], { windowsHide: true });
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

async function project() {
  const base = await realpath(tmpdir());
  const root = await mkdtemp(path.join(base, 'estella-import-cli-'));
  onTestFinished(async () => { if (path.dirname(root) === base) await rm(root, { recursive: true, force: true }); });
  await writeFile(path.join(root, 'project.esproject'), JSON.stringify({ formatVersion: '1', name: 'CLI fixtures' }));
  const assets = path.join(root, 'assets');
  await mkdir(assets);
  return { root, assets };
}

it('runs both model aliases with saved settings, one-off flags and the same product identities', async () => {
  const { assets } = await project();
  const source = path.join(assets, 'Shape.gltf'), prefab = path.join(assets, 'Shape.esprefab');
  await writeFile(source, plainTriangle());
  const uuid = '12345678-1234-4321-8123-123456789abc';
  await writeFile(source + '.meta', JSON.stringify({ version: '2.0', uuid, type: 'model', importer: { scale: 37 } }));
  expect((await run('import-model', source)).stdout).toMatch(/3 vertices, 1 triangles/);
  expect((await json(prefab)).entities[0].components[0].data.scale.x).toBe(37);
  const identity = await json(prefab + '.meta');
  expect(identity.source).toBe(uuid);
  await run('import-gltf', source, '--scale', '5');
  expect((await json(prefab)).entities[0].components[0].data.scale.x).toBe(5);
  expect((await json(source + '.meta')).importer.scale).toBe(37);
  expect(await json(prefab + '.meta')).toEqual(identity);
}, 30_000);

it('imports and reimports Aseprite and layered PSD in a separate project-relative output folder', async () => {
  const { root, assets } = await project();
  const out = path.join(root, 'generated'), source = path.join(assets, 'Walk.ase');
  const sprite = (size: number, duration: number) => writeAseprite({
    width: size, height: size, layers: [{ name: 'art' }],
    frames: [{ duration, cels: [{ layer: 0, x: 0, y: 0, w: size, h: size, pixels: fill(size, size, [10, 20, 30, 255]) }] }],
  });
  await writeFile(source, sprite(8, 100));
  await run('import-source', source, out);
  const sheet = path.join(out, 'Walk.png.meta'), first = await json(sheet);
  await writeFile(sheet, JSON.stringify({ ...first, importer: { ...first.importer, filterMode: 'linear' } }));
  await writeFile(source, sprite(16, 250));
  await run('import-source', source, out);
  expect(await json(sheet)).toMatchObject({ uuid: first.uuid, source: (await json(source + '.meta')).uuid,
    importer: { filterMode: 'linear', sheet: { cellWidth: 16, cellHeight: 16 } } });
  const clip = await json(path.join(out, 'Walk.esanim'));
  expect(clip.sheet.texture).toBe('generated/Walk.png');
  expect(clip.frames[0].duration).toBe(0.25);

  const imageData = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) } as ImageData;
  const psd = path.join(assets, 'Poster.psd');
  await writeFile(psd, new Uint8Array(writePsd({ width: 2, height: 2, children: [{ name: 'Ink', imageData }] }, { generateThumbnail: false })));
  await run('import-source', psd, out);
  const poster = (await json(psd + '.meta')).uuid;
  expect((await json(path.join(out, 'Poster.esprefab.meta'))).source).toBe(poster);
  expect((await json(path.join(out, 'Poster_Ink.png.meta'))).source).toBe(poster);
}, 30_000);

it('uses saved EXR settings, a zero-width sky override, and actual JPEG pixels in a cube source', async () => {
  const { assets } = await project();
  const exr = path.join(assets, 'Sky.EXR'), env = path.join(assets, 'Sky.esenv');
  await copyFile(fileURLToPath(new URL('./fixtures/exr/ref_zip_32.exr', import.meta.url)), exr);
  await writeFile(exr + '.meta', JSON.stringify({ uuid: 'sky', type: 'panorama', importer: { faceSize: 16, skyWidth: 64 } }));
  await run('import-hdr', exr);
  expect(await json(env)).toMatchObject({ faceSize: 16, sky: 'Sky_sky.png' });
  await run('import-source', exr, '--face-size', '8', '--sky-width', '0');
  const smaller = await json(env);
  expect(smaller.faceSize).toBe(8);
  expect(smaller.sky).toBeUndefined();

  const cube = path.join(assets, 'Day.escube');
  await writeFile(path.join(assets, 'day.jpg'), jpeg.encode({ width: 16, height: 8, data: Buffer.alloc(16 * 8 * 4, 255) }).data);
  await writeFile(cube, JSON.stringify({ version: 1, faces: {}, panorama: { file: 'assets/day.jpg' } }));
  await run('import-source', cube, '--face-size', '8', '--sky-width', '0');
  expect((await json(path.join(assets, 'Day.esenv'))).irradiance[0]).toBeGreaterThan(0);
  expect((await json(path.join(assets, 'Day_env.png.meta'))).source).toBe((await json(cube + '.meta')).uuid);
  const elsewhere = await project();
  const standalone = path.join(elsewhere.root, 'standalone');
  await run('import-source', cube, standalone, '--project', path.dirname(assets), '--face-size', '8', '--sky-width', '0');
  expect((await json(path.join(standalone, 'Day.esenv'))).irradiance).toEqual((await json(path.join(assets, 'Day.esenv'))).irradiance);
}, 30_000);

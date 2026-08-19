// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  panorama-import — a `.hdr` through the editor's import door.
 *
 * The pixel gate lights a scene with an environment the CLI baked; this is the
 * other door, where the products are written by the bundled main process. Two
 * things can only be checked here: that the `.esenv` points at an atlas really
 * beside it, and that the atlas' `.meta` says authored-linear and uncompressed —
 * an RGBM encoding cooked as a picture comes back as the wrong radiance, and
 * nothing about the file says so.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, readPNG } from '../lib/editorDriver.mjs';

export const name = 'panorama-import';
export const describes = 'an imported panorama writes its environment and the atlas it names';

/** A Radiance file, sky above and ground below, in the flat encoding. */
function panoramaHdr(width = 32, height = 16) {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
  const body = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = y < height / 2 ? [0, 0, 2] : [2, 0, 0];
      const peak = Math.max(r, g, b);
      const e = peak > 0 ? Math.ceil(Math.log2(peak)) + 128 : 0;
      const scale = peak > 0 ? 256 / Math.pow(2, e - 128) : 0;
      const at = (y * width + x) * 4;
      body[at] = Math.min(255, Math.floor(r * scale));
      body[at + 1] = Math.min(255, Math.floor(g * scale));
      body[at + 2] = Math.min(255, Math.floor(b * scale));
      body[at + 3] = e;
    }
  }
  return Buffer.concat([header, body]);
}

export async function run(ed) {
  const root = await makeProject({
    'project.esproject': JSON.stringify({ name: 'Panorama', version: '1.0' }, null, 2),
    'assets/lit.esmaterial': JSON.stringify({
      version: '1.0', type: 'material', shader: 'builtin:sprite-lit', blendMode: 0,
      depthTest: false, properties: {},
    }, null, 2),
    'assets/scenes/main.esscene': JSON.stringify({
      version: '1.0', name: 'Main',
      entities: [
        {
          id: 0, name: 'Camera', parent: null, children: [], visible: true,
          components: [
            { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
            { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
          ],
        },
        {
          id: 1, name: 'Sky', parent: null, children: [], visible: true,
          components: [
            { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
            {
              type: 'Light2D',
              data: {
                type: 2, intensity: 1,
                color: { r: 1, g: 1, b: 1, a: 1 },
              },
            },
          ],
        },
        {
          id: 2, name: 'Wall', parent: null, children: [], visible: true,
          components: [
            { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
            {
              type: 'Sprite',
              data: {
                size: { x: 400, y: 400 },
                color: { r: 1, g: 1, b: 1, a: 1 },
                material: 'assets/lit.esmaterial',
              },
            },
          ],
        },
      ],
    }, null, 1),
  });
  await mkdir(path.join(root, 'assets'), { recursive: true });
  const source = path.join(root, 'assets', 'sky.hdr');
  await writeFile(source, panoramaHdr());

  const check = checker();
  // The project first, the scene AFTER the import: a scene opened before its
  // assets exist resolves their refs to nothing, and no later write revisits that.
  await ed.open(root);
  const result = await ed.json('import_assets', { destDir: 'assets', sources: [source] }, 120000);
  const imported = result?.imported ?? [];
  if (!check(imported.includes('assets/sky.esenv') && imported.includes('assets/sky_env.png'),
             `import reported ${JSON.stringify(imported)}`)) {
    return check.failures;
  }

  const read = async (rel) => {
    try {
      return JSON.parse(await readFile(path.join(root, rel), 'utf8'));
    } catch {
      return null;
    }
  };
  const env = await read('assets/sky.esenv');
  if (!check(env != null, 'the environment is named in the import but is not on disk')) {
    return check.failures;
  }
  check(env.specular === 'sky_env.png',
        `the environment points at ${JSON.stringify(env.specular)}`);
  check(Array.isArray(env.irradiance) && env.irradiance.length === 27,
        `the irradiance is ${env.irradiance?.length} numbers, not 27`);
  // Up is blue and down is red, which is the whole point of nine coefficients
  // rather than one colour. Coefficient 1 is the y band: blue above zero, red below.
  check(env.irradiance?.[5] > 0.5, `the y band's blue reads ${env.irradiance?.[5]}`);
  check(env.irradiance?.[3] < -0.5, `the y band's red reads ${env.irradiance?.[3]}`);

  const meta = await read('assets/sky_env.png.meta');
  check(meta?.importer?.sRGB === false, 'the atlas is marked sRGB, but it stores an encoding');
  check(meta?.importer?.compress === false, 'the atlas would be block-compressed with its own multiplier');

  await ed.call('open_scene', { path: 'assets/scenes/main.esscene' }, 120000);
  await ed.sleep(2500);

  // The editor's OWN door: assigning the `.esenv` to a light has to resolve it to
  // a handle and reach the viewport. A flat ambient draws the wall white; the sky
  // draws it in its own colour, which has no green in it at all.
  const viewport = async () => {
    const block = await ed.call('capture_viewport', {}, 60000);
    return readPNG(Buffer.from(block.data ?? '', 'base64'));
  };
  const at = (shot) => shot.px(Math.round(shot.w * 0.5), Math.round(shot.h * 0.5));
  // How long a sky takes to load and reach a frame is the machine's business, not
  // this check's. Waiting a fixed 1.5s measured a frame that had not happened yet
  // on a runner four times slower than the machine the number came from.
  const SETTLE_MS = 30000;
  const settle = async (want, ms = SETTLE_MS) => {
    const deadline = Date.now() + ms;
    for (let shot = await viewport(); ; shot = await viewport()) {
      if (want(at(shot)) || Date.now() > deadline) return shot;
      await ed.sleep(250);
    }
  };
  const isFlat = (p) => p[0] > 200 && p[1] > 200 && p[2] > 200;
  const isSky = (p) => p[1] + 20 < p[0] && p[1] + 20 < p[2];

  const flat = await settle(isFlat);
  await ed.call('set_field', { entity: 1, component: 'Light2D', key: 'environment',
                               type: 'asset', value: 'assets/sky.esenv' }, 30000);
  const lit = await settle(isSky);
  const before = at(flat);
  const after = at(lit);
  check(before[0] > 200 && before[1] > 200 && before[2] > 200,
        `a flat white ambient drew the wall ${JSON.stringify(before)}`);
  check(after[1] + 20 < after[0] && after[1] + 20 < after[2],
        `with the environment the wall is still ${JSON.stringify(after)} after ${SETTLE_MS / 1000}s`
        + ' — a sky with no green in it');
  return check.failures;
}

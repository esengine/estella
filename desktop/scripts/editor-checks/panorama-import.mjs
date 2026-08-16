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
import { makeProject, checker } from '../lib/editorDriver.mjs';

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
    'assets/scenes/main.esscene': JSON.stringify({
      version: '1.0', name: 'Main',
      entities: [{
        id: 0, name: 'Camera', parent: null, children: [], visible: true,
        components: [
          { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
          { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
        ],
      }],
    }, null, 1),
  });
  await mkdir(path.join(root, 'assets'), { recursive: true });
  const source = path.join(root, 'assets', 'sky.hdr');
  await writeFile(source, panoramaHdr());

  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');
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
  check(env.specular === 'assets/sky_env.png',
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
  return check.failures;
}

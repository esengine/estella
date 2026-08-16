// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  model-animation — an animated model through the editor's import door.
 *
 * The pixel gate plays a clip the CLI imported; this is the other door, where
 * the products are written by the bundled main process and the prefab has to
 * come out pointing at a file that is really beside it. A clip written under a
 * name nothing references is exactly as invisible as no clip at all.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker } from '../lib/editorDriver.mjs';
import { animatedTriangle } from '../lib/gltfFixtures.mjs';

export const name = 'model-animation';
export const describes = 'an imported model writes its clip and its prefab points at it';

export async function run(ed) {
  const root = await makeProject({
    'project.esproject': JSON.stringify({ name: 'Animated', version: '1.0' }, null, 2),
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
  const source = path.join(root, 'assets', 'turner.gltf');
  await writeFile(source, animatedTriangle());

  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');
  const result = await ed.json('import_assets', { destDir: 'assets', sources: [source] }, 120000);
  const imported = result?.imported ?? [];
  if (!check(imported.includes('assets/turner_Turn.estimeline'),
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
  const clip = await read('assets/turner_Turn.estimeline');
  if (!check(clip != null, 'the clip is named in the import but is not on disk')) return check.failures;
  check(clip.duration === 1, `the clip is ${clip.duration}s, not the 1s the source says`);
  const track = clip.tracks?.[0];
  check(track?.component === 'Transform' && track?.childPath === '',
        `the track addresses ${JSON.stringify({ c: track?.component, p: track?.childPath })}`);
  check(track?.channels?.map((c) => c.property).join() === 'rotation.x,rotation.y,rotation.z,rotation.w',
        `the channels are ${JSON.stringify(track?.channels?.map((c) => c.property))}`);
  // The lone node's own turn: a quarter circle about Y is (0, √½, 0, √½).
  const y = track?.channels?.[1]?.keyframes?.[1]?.value ?? 0;
  check(Math.abs(y - Math.SQRT1_2) < 1e-5, `the final rotation reads y=${y}`);

  const prefab = await read('assets/turner.esprefab');
  const player = prefab?.entities?.[0]?.components?.find((c) => c.type === 'TimelinePlayer');
  check(player?.data?.timeline === 'assets/turner_Turn.estimeline',
        `the prefab points at ${JSON.stringify(player?.data?.timeline)}`);
  check(player?.data?.playing === false, 'the imported prefab plays on its own');
  return check.failures;
}

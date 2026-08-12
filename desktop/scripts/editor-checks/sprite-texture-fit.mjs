// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sprite-texture-fit — a sprite handed a texture is the size of that texture.
 *
 * `Sprite.size` starts at the 100×100 placeholder that makes a textureless sprite
 * visible. A sprite handed an image must leave that behind, or it draws its art
 * stretched to a size nobody chose with nothing on screen saying why.
 *
 * The fit is a rule about a size nobody chose, so the cases that matter are the two
 * sides of "nobody chose it": it must follow the texture while the size is still
 * this rule's, and it must never touch a size the creator typed.
 */
import path from 'node:path';
import { cp, mkdir } from 'node:fs/promises';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

// Real project images, so the expected numbers are the files' own headers rather
// than a fixture's promise: star is 31×30, arrow 32×32. Deliberately different, and
// deliberately not square — a swapped axis has nowhere to hide.
const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');
const STAR = [31, 30];
const ARROW = [32, 32];

const PROJECT = JSON.stringify({
  formatVersion: '1', name: 'Sprite Fit Check', version: '0.1.0',
  defaultScene: 'assets/scenes/main.esscene',
  designResolution: { width: 800, height: 600 },
}, null, 2);

const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [{
    id: 0, name: 'Camera', parent: null, children: [], visible: true,
    components: [
      { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
      { type: 'Camera', data: { projectionType: 1, orthoSize: 540, isActive: true, priority: 0 } },
    ],
  }],
}, null, 1);

export const name = 'sprite-texture-fit';
export const describes = 'assigning a texture sizes the sprite to it, and never overwrites a size the creator set';

export async function run(ed) {
  const root = await makeProject({ 'project.esproject': PROJECT, 'assets/scenes/main.esscene': SCENE });
  await mkdir(path.join(root, 'assets/textures'), { recursive: true });
  for (const f of ['star.png', 'star.png.meta', 'arrow.png', 'arrow.png.meta']) {
    await cp(path.join(EXAMPLE, 'assets/textures', f), path.join(root, 'assets/textures', f));
  }
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.sleep(800);

  const created = await ed.json('create_entity', { template: 'anchor:Sprite', name: 'S1' }, 30000);
  const id = typeof created === 'number' ? created : created?.id;
  if (!check(id != null, `create_entity did not return an id (${JSON.stringify(created)})`)) return check.failures;

  const size = () => ed.json('get_field_value', { entity: id, component: 'Sprite', key: 'size' }, 20000);
  const setTexture = (file) =>
    ed.call('set_field', { entity: id, component: 'Sprite', key: 'texture', type: 'asset', value: `assets/textures/${file}` }, 30000);
  // The fit is deferred past the write it reacts to, and decodes the image the first
  // time it sees one — so settle before reading rather than racing it.
  const settle = () => ed.sleep(1200);

  check(
    JSON.stringify(await size()) === '[100,100]',
    'a fresh Sprite does not start at the 100×100 placeholder — this check no longer measures what it thinks',
  );

  await setTexture('star.png');
  await settle();
  const fitted = await size();
  check(
    JSON.stringify(fitted) === JSON.stringify(STAR),
    `assigning a ${STAR[0]}×${STAR[1]} texture left the sprite at ${JSON.stringify(fitted)} — the art draws `
    + 'stretched to a size nobody chose, which is only invisible because the placeholder is square-ish',
  );

  // A size that came from the previous texture is still nobody's choice, so a swap
  // re-fits; otherwise the first texture a sprite ever gets would pin its size forever.
  await setTexture('arrow.png');
  await settle();
  const swapped = await size();
  check(
    JSON.stringify(swapped) === JSON.stringify(ARROW),
    `swapping to a ${ARROW[0]}×${ARROW[1]} texture left the sprite at ${JSON.stringify(swapped)} — an auto-fitted `
    + 'size did not follow the texture it was fitted to',
  );

  // The other half of the rule, and the one that would be a data-loss bug: an
  // authored size is the creator's, and a texture change must not touch it.
  await ed.call('set_field', { entity: id, component: 'Sprite', key: 'size', type: 'vec2', value: [7, 9] }, 20000);
  await setTexture('star.png');
  await settle();
  const kept = await size();
  check(
    JSON.stringify(kept) === '[7,9]',
    `a hand-set size of [7,9] became ${JSON.stringify(kept)} when the texture changed — the auto-fit is `
    + 'overwriting authored values, which loses work silently',
  );
  return check.failures;
}

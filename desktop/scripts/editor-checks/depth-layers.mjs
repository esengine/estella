// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  depth-layers — the 2.5D AUTHORING surface, driven for real.
 *
 * The engine half of 2.5D is covered by verify:render:depth (a paired pixel
 * check painter's order cannot pass). What no unit test can cover is whether the
 * editor shows a person what the game will show: every seam between the project
 * setting and the viewport can be wired wrong while every test stays green,
 * which is exactly what happened — depth layers reached the play realm and
 * neither the edit viewport nor any exported build.
 *
 * Two opaque squares occupy the SAME place: near red at z = +150 in sorting
 * layer 1, far blue at z = -150 in the HIGHER layer 2. Paint order draws blue
 * over red; only the depth buffer puts red in front. So the centre pixel of the
 * viewport names the answer with no coordinate mapping to get wrong, and the
 * same scene asks two more questions of the editor.
 */
import { makeProject, checker, near, isBlack } from '../lib/editorDriver.mjs';

const MATERIAL = JSON.stringify({
  version: '1.0', type: 'material', shader: 'opaque.esshader',
  blendMode: 9, depthTest: false, properties: {},
}, null, 2);

// Fragment-only on purpose: the vertex stage is the one ShaderParser injects,
// which is the stage that has to carry z for any of this to mean anything.
const SHADER = `#pragma shader "Opaque Unlit"
#pragma version 300 es
#pragma domain Unlit2D

#pragma fragment
precision mediump float;
in vec4 v_color;
in vec2 v_texCoord;
uniform sampler2D u_textures[8];
out vec4 fragColor;
void main() {
    fragColor = texture(u_textures[0], v_texCoord) * v_color;
}
#pragma end
`;

const sprite = (name, z, layer, color) => ({
  id: layer, name, parent: null, children: [], visible: true,
  components: [
    { type: 'Transform', data: { position: { x: 0, y: 0, z } } },
    {
      type: 'Sprite',
      data: {
        size: { x: 260, y: 260 }, color, layer,
        material: 'assets/materials/opaque.esmaterial',
      },
    },
  ],
});

const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 0, name: 'Camera', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
        { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
      ],
    },
    sprite('NearRed', 150, 1, { r: 1, g: 0, b: 0, a: 1 }),
    sprite('FarBlue', -150, 2, { r: 0, g: 0, b: 1, a: 1 }),
  ],
}, null, 1);

const PROJECT = JSON.stringify({
  formatVersion: '1', name: 'Depth 2.5D Check', version: '0.1.0',
  defaultScene: 'assets/scenes/main.esscene',
  designResolution: { width: 800, height: 600 },
  features: { rendering: { sortingLayers: ['Default', 'Near', 'Far'], depthLayers: [1, 2] } },
}, null, 2);

export const name = 'depth-layers';
export const describes = 'depth resolves in the edit viewport, picking follows it, the grid covers the perspective frame';

export async function run(ed) {
  const root = await makeProject({
    'project.esproject': PROJECT,
    'assets/scenes/main.esscene': SCENE,
    'assets/materials/opaque.esmaterial': MATERIAL,
    'assets/materials/opaque.esshader': SHADER,
  });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');

  // 1. Depth reaches the edit viewport. The two squares coincide, so the centre
  //    pixel IS the answer — no canvas geometry to get wrong.
  const ortho = await ed.capture('depth-edit-ortho');
  const centre = ortho.px(Math.floor(ortho.w / 2), Math.floor(ortho.h / 2));
  check(
    near(centre, [255, 0, 0]),
    `depth: the edit viewport centre is rgb(${centre}), expected the NEAR sprite's red — `
    + "the project's depth layers are not reaching the edit World (blue = paint order).",
  );

  // 2. Picking ranks by what was drawn. Both squares cover the same pixels, so
  //    every hit must be the near one; the far one being pickable at all means
  //    the ranking is on list order rather than on depth.
  const tree = await ed.json('get_scene_tree', {}, 30000);
  const nearId = tree.find((e) => e.name === 'NearRed')?.id;
  const farId = tree.find((e) => e.name === 'FarBlue')?.id;
  const picked = new Set();
  for (let x = 200; x <= 1500; x += 20) {
    for (const y of [300, 400]) {
      const id = await ed.json('pick', { clientX: x, clientY: y }, 30000);
      if (id != null) picked.add(id);
    }
  }
  check(picked.has(nearId), `pick: no click anywhere on the pair selected the near sprite (${[...picked]})`);
  check(!picked.has(farId), 'pick: a click selected the FAR sprite, which is behind the near one everywhere');

  // 3. The grid covers the frame under the perspective eye, not a bounded island.
  await ed.call('run_editor_command', { id: 'view.toggleViewPerspective' }, 30000);
  await ed.sleep(800);
  const persp = await ed.capture('depth-edit-perspective');
  const band = Math.max(2, Math.floor(persp.h * 0.04));
  let lit = 0;
  for (let x = 0; x < persp.w; x += 2) {
    for (const y of [band, persp.h - 1 - band]) if (!isBlack(persp.px(x, y))) lit++;
  }
  check(lit > 0, 'grid: the top/bottom border of the perspective viewport is empty — '
    + 'the grid quad is not covering what this projection sees');

  const centreP = persp.px(Math.floor(persp.w / 2), Math.floor(persp.h / 2));
  check(near(centreP, [255, 0, 0]), `depth: the perspective viewport centre is rgb(${centreP}), expected red`);

  return check.failures;
}

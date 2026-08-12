// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sprite-pivot-pixels — a pivot is a fraction, and the editor knows what of.
 *
 * `Sprite.pivot` is stored 0..1 so it survives a resize, but nobody authors in
 * fractions — they author "32 pixels in from the left". The bridge is the
 * `normalized_of=size` declaration on the C++ property: it tells the inspector
 * which sibling is the denominator, and the row multiplies through it to offer a
 * pixel view. That chain runs C++ → EHT → the generated TS meta → the inspector
 * field, and every link is a place it can go quietly missing — a pixel view over
 * a stale or absent denominator would show plausible numbers that write the wrong
 * fraction.
 *
 * So: require the denominator to be reported, to TRACK the size rather than be
 * baked once, and to stand down when it would divide by zero. Then check the
 * geometry the preset grid encodes — which way a pivot actually moves a sprite —
 * because a picker that writes a correct-looking number to the wrong axis is the
 * failure no amount of metadata plumbing catches.
 */
import { makeProject, checker } from '../lib/editorDriver.mjs';

const GREEN = [0, 255, 0];

const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 0, name: 'Camera', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
        { type: 'Camera', data: { projectionType: 1, orthoSize: 540, isActive: true, priority: 0 } },
      ],
    },
    {
      // Deliberately non-square: an axis swapped anywhere in the chain shows up as
      // a denominator of 100 where 200 belongs, instead of hiding behind symmetry.
      id: 1, name: 'Box', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
        { type: 'Sprite', data: { size: { x: 200, y: 100 }, color: { r: 0, g: 1, b: 0, a: 1 }, pivot: { x: 0.5, y: 0.5 } } },
      ],
    },
  ],
}, null, 1);

const PROJECT = JSON.stringify({
  formatVersion: '1', name: 'Sprite Pivot Check', version: '0.1.0',
  defaultScene: 'assets/scenes/main.esscene',
  designResolution: { width: 800, height: 600 },
}, null, 2);

export const name = 'sprite-pivot-pixels';
export const describes = 'Sprite.pivot reports the size as its pixel denominator, and its presets move the sprite the way they read';

/** Centroid of the pixels matching `want`, in PNG coordinates, or null if none do. */
function centroid(png, want, tol = 60) {
  let n = 0; let sx = 0; let sy = 0;
  for (let y = 0; y < png.h; y++) {
    for (let x = 0; x < png.w; x++) {
      const p = png.px(x, y);
      if (Math.abs(p[0] - want[0]) <= tol && Math.abs(p[1] - want[1]) <= tol && Math.abs(p[2] - want[2]) <= tol) {
        n++; sx += x; sy += y;
      }
    }
  }
  return n > 0 ? { x: sx / n, y: sy / n, n } : null;
}

/** The Sprite's pivot field as the Details panel builds it. */
async function pivotField(ed, entity) {
  const comps = await ed.json('get_inspector', { entity }, 30000);
  return comps.find((c) => c.name === 'Sprite')?.fields?.find((f) => f.key === 'pivot') ?? null;
}

const setSize = (ed, id, x, y) =>
  ed.call('set_field', { entity: id, component: 'Sprite', key: 'size', type: 'vec2', value: [x, y] }, 30000);
const setPivot = (ed, id, x, y) =>
  ed.call('set_field', { entity: id, component: 'Sprite', key: 'pivot', type: 'vec2', value: [x, y] }, 30000);

export async function run(ed) {
  const root = await makeProject({ 'project.esproject': PROJECT, 'assets/scenes/main.esscene': SCENE });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.sleep(800);

  const tree = await ed.json('get_scene_tree', {}, 30000);
  const box = tree.find((e) => e.name === 'Box')?.id;
  if (!check(box != null, 'the scene tree does not report the Box sprite')) return check.failures;

  // — The declaration reaches the field —
  const field = await pivotField(ed, box);
  if (!check(field != null, 'the Sprite inspector has no pivot field at all')) return check.failures;
  check(
    field.advanced !== true,
    'pivot is still behind the Advanced fold — changing where a sprite turns is everyday authoring, '
    + 'and a preset picker nobody can find is no picker',
  );
  check(
    field.normalizedOf?.key === 'size',
    `pivot reports no size denominator (${JSON.stringify(field.normalizedOf)}) — the normalized_of=size `
    + 'declaration is not reaching the inspector, so the row can only offer raw fractions',
  );
  check(
    JSON.stringify(field.normalizedOf?.denom) === JSON.stringify([200, 100]),
    `pivot's denominator is ${JSON.stringify(field.normalizedOf?.denom)}, not the sprite's [200, 100] size`,
  );

  // — It tracks the sibling rather than being baked at build time —
  await setSize(ed, box, 64, 32);
  const resized = await pivotField(ed, box);
  check(
    JSON.stringify(resized?.normalizedOf?.denom) === JSON.stringify([64, 32]),
    `after resizing to 64×32 the pivot denominator is still ${JSON.stringify(resized?.normalizedOf?.denom)} — `
    + 'the pixel view is reading a stale size, so every pixel it shows is a lie',
  );

  // — And stands down where the arithmetic has no answer —
  await setSize(ed, box, 0, 32);
  const zeroed = await pivotField(ed, box);
  check(
    zeroed?.normalizedOf == null,
    'a zero-width sprite still offers a pixel view — every pixel entered would divide by zero',
  );

  // The renderer draws at `position - size * pivot`, so pivot (0,0) is the sprite's
  // bottom-left corner and puts its body up and right of the origin — a SMALLER png y,
  // world +Y being up. Backwards here and the grid's Top row moves a sprite down.
  await setSize(ed, box, 200, 100);
  await setPivot(ed, box, 0, 0);
  const bottomLeft = centroid(await ed.capture('sprite-pivot-bottom-left'), GREEN);
  await setPivot(ed, box, 1, 1);
  const topRight = centroid(await ed.capture('sprite-pivot-top-right'), GREEN);
  if (!check(bottomLeft && topRight, 'the sprite is not on screen in one of the two pivot states')) {
    return check.failures;
  }

  const shiftX = bottomLeft.x - topRight.x;
  const shiftY = topRight.y - bottomLeft.y;
  check(
    shiftX > 20,
    `a bottom-left pivot puts the sprite at x=${bottomLeft.x.toFixed(0)} and a top-right one at `
    + `x=${topRight.x.toFixed(0)} — moving it right by a full width is what pivot.x means, so the `
    + 'X axis is inverted or ignored',
  );
  check(
    shiftY > 10,
    `a bottom-left pivot puts the sprite at y=${bottomLeft.y.toFixed(0)} and a top-right one at `
    + `y=${topRight.y.toFixed(0)} — a bottom-left pivot must hold the sprite ABOVE the entity (a smaller `
    + 'png y), so the grid rows would move a sprite the wrong way',
  );
  // The shifts are a full width and a full height, so their RATIO is the sprite's 2:1
  // aspect at any viewport zoom. An absolute pixel threshold only pins this machine's
  // zoom, and would go green for a crossed axis on another.
  if (shiftX > 0 && shiftY > 0) {
    const aspect = shiftX / shiftY;
    check(
      aspect > 1.5 && aspect < 2.5,
      `the pivot moved the sprite ${shiftX.toFixed(0)}px across and ${shiftY.toFixed(0)}px down — a ratio `
      + `of ${aspect.toFixed(2)} where the sprite's own 200×100 makes it 2, so an axis is crossed`,
    );
  }
  return check.failures;
}

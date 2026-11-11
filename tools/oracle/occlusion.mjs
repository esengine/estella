// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  occlusion.mjs — oracle scenes for SSAO and GTAO.
 *
 * Both estimate how closed-in a point is from the depth buffer, with a few rotated samples per pixel, so a pixel's exact value is the
 * estimator's noise and not a formula. What they promise is not noise, and that is what is checked:
 *
 *   - An open flat surface is not occluded by itself: the floor stays exactly its own colour, at a steep angle and at a grazing one.
 *   - The radius is a WORLD length and a hard edge to what counts as an occluder: a floor farther from a tall box than the radius is
 *     exactly its own colour, and a floor well inside the radius is darker. Counted over the whole frame by the pixels' distance to the
 *     box, which is geometry.
 *
 * The box is brighter than the floor (code 255 against 231), so the pixels that are neither are the floor's darkened ones.
 */
import { scene, camera, mesh, volume, SIZE, HALF } from './scene.mjs';
import { encodeLinear8, axisAngle, norm, rotate, dot } from './formulas.mjs';

const FLOOR = 0.8;
const fx = (type, uniforms) => ({ type, enabled: true, uniforms });
const PX_PER_UNIT = SIZE / (2 * HALF);

/**
 * Radius test. A 40 x 40 box, a third of the radius tall, in the middle of a floor seen from straight above. Its height is what
 * matters: a sample counts as an occluder only inside the radius in THREE dimensions, so a box taller than the radius occludes nothing
 * from above, and one a third of it casts its shade out to about the radius.
 */
function radiusTest({ id, effect, radius }) {
  const BOX_HALF = 20, BOX_HEIGHT = radius * 0.3;
  const doc = scene(id, () => [
    camera(), mesh('Floor', 'cube', [0, 0, 0], [4, 0.1, 4], [FLOOR, FLOOR, FLOOR], { lit: false }),
    mesh('Box', 'cube', [0, 5 + BOX_HEIGHT / 2, 0], [0.4, BOX_HEIGHT / 100, 0.4], [1, 1, 1], { lit: false }),
    volume([fx(effect, effect === 'ssao' ? { u_radius: radius, u_intensity: 1, u_bias: 0.12, u_power: 1.6 } : { u_radius: radius, u_intensity: 1, u_power: 1.4, u_thickness: 0.5 })]),
  ]);
  // The distance, in world units, from each pixel's centre to the box's square on the floor.
  let far = 0, near = 0, inside = 0, mid = 0;
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const x = ((i + 0.5) / SIZE - 0.5) * 2 * HALF, z = ((j + 0.5) / SIZE - 0.5) * 2 * HALF;
      const dx = Math.max(Math.abs(x) - BOX_HALF, 0), dz = Math.max(Math.abs(z) - BOX_HALF, 0), d = Math.hypot(dx, dz);
      if (d === 0) continue; // the box's own top
      const texel = 1 / PX_PER_UNIT;
      if (d > radius * 1.15 + 3 * texel) far++;     // beyond the radius, with a few texels for the blur and the upsample
      if (d > radius * 0.35) mid++;                 // anything nearer than this must have been darkened
      if (d < radius * 0.12) near++;                // at the foot of the box
      if (d < radius * 1.15 + 3 * texel) inside++;  // nothing outside the radius is darkened
    }
  }
  const floor = encodeLinear8([FLOOR, FLOOR, FLOOR])[0];
  const count = [
    // The floor's own colour: all of what lies beyond the radius, and none of what lies well inside it.
    { rgb: [floor, floor, floor], tol: 0, atLeast: far, atMost: mid },
    // Darker than the floor by more than the tolerance (the box top, 255, is above the window): at least the foot of the box, and no more
    // than what is within reach. A box a third of the radius high shades its foot by 3 to 9 percent, so the window is a couple of codes wide.
    { rgb: [115, 115, 115], tol: 114, atLeast: near, atMost: inside },
  ];
  return { id, doc, colorSpace: 'linear', count, about: `${effect.toUpperCase()} radius ${radius}: untouched beyond it (${far} px at least), darkened well inside it (${near} px at least)` };
}

/** Flatness test: a camera 32 degrees down over a big floor; no pixel of it may be darkened. */
function flatFloor({ id, effect }) {
  const FOV = 50, PITCH = -32, EYE = [0, 250, 300], FLOOR_TOP = 5;
  const doc = scene(id, () => [
    camera({ projectionType: 0, fov: FOV, nearPlane: 1, farPlane: 4000 }), mesh('Floor', 'cube', [0, 0, 0], [8, 0.1, 8], [FLOOR, FLOOR, FLOOR], { lit: false }),
    volume([fx(effect, effect === 'ssao' ? { u_radius: 40, u_intensity: 1, u_bias: 0.12, u_power: 1.6 } : { u_radius: 40, u_intensity: 1, u_power: 1.4, u_thickness: 0.5 })]),
  ]);
  const cam = doc.entities.find((e) => e.name === 'Camera');
  cam.components[0].data.position = { x: EYE[0], y: EYE[1], z: EYE[2] };
  const q = axisAngle([1, 0, 0], PITCH);
  cam.components[0].data.rotation = q;
  const t = Math.tan((FOV * Math.PI) / 360);
  const rgb = encodeLinear8([FLOOR, FLOOR, FLOOR]);
  const expect = [];
  for (let j = 140; j <= 250; j += 14) {
    for (let i = 20; i <= 236; i += 36) {
      const nx = (2 * (i + 0.5)) / SIZE - 1, ny = 1 - (2 * (j + 0.5)) / SIZE;
      const dir = norm(rotate(q, norm([nx * t, ny * t, -1])));
      if (dir[1] >= -0.05) continue;
      const s = (FLOOR_TOP - EYE[1]) / dir[1], hx = EYE[0] + dir[0] * s, hz = EYE[2] + dir[2] * s;
      if (Math.abs(hx) < 380 && Math.abs(hz) < 380) expect.push({ x: i / (SIZE - 1), y: j / (SIZE - 1), rgb, tol: 2 });
    }
  }
  return { id, doc, colorSpace: 'linear', expect, about: `${effect.toUpperCase()}: an open floor seen 32 degrees down is not darkened` };
}

export const OCCLUSION_SCENES = [
  flatFloor({ id: 'oracle-ssao-flat', effect: 'ssao' }),
  flatFloor({ id: 'oracle-gtao-flat', effect: 'gtao' }),
  radiusTest({ id: 'oracle-ssao-radius', effect: 'ssao', radius: 30 }),
  radiusTest({ id: 'oracle-ssao-radius-small', effect: 'ssao', radius: 12 }),
  radiusTest({ id: 'oracle-gtao-radius', effect: 'gtao', radius: 30 }),
  radiusTest({ id: 'oracle-gtao-radius-small', effect: 'gtao', radius: 12 }),
];

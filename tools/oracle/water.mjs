// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  water.mjs — what the water module does to the picture, through the module itself: a WaterBody and a WaterZone in the scene, the
 *        camera put under the water by them, the underwater look worked out from the water material and the body as a game's would be.
 *
 * The post-process oracle (post.mjs) authors the underwater effect's numbers itself, so it never sees what the water module hands it; a
 * stock water material handed it a density a hundred times too thick and nothing failed. These scenes take the module's numbers.
 *
 * Nothing lights the patches (unlit, no sun, no ambient), so what is left is Beer-Lambert transmission along the view ray from the near
 * plane: colour * exp(-absorption * density * length), per channel. The camera is a perspective one 400 units up looking straight down,
 * near plane 1 (an orthographic one draws what is behind it, the water's surface above it); the ocean stands at 450.
 */
import { scene, camera, mesh, entity, transform, probeFrom } from './scene.mjs';
import { encodeLinear8 } from './formulas.mjs';

/** The Water shader's own default density per world unit (sdk/src/water/waterShader.ts WATER_DENSITY): 0.12 a metre at 100 units a metre. */
const WATER_DENSITY = 0.0012;
const ABSORPTION = [0.45, 0.09, 0.05];
const SLOTS = [[-75, -50], [-25, -50], [25, -50], [75, -50], [-75, 50], [-25, 50], [25, 50], [75, 50]];
const TOPS = [5, 45, 85, 125, 165, 205, 245, 285];
const COLOURS = [0.9, 0.7, 0.5, 0.35, 0.25, 0.6, 0.8, 1].map((v) => [v, v * 0.95, v * 0.9]);
const LEVEL = 450;
const FOV = 40;

/** The length of water the eye looks through to a patch: from the near plane (1 unit down the straight-down axis) to the patch's top. */
function rayLength([x, z], top) {
  const drop = 400 - top;
  const full = Math.hypot(x, drop, z);
  return full * (1 - 1 / drop);
}

function underwaterScene(id, body, density, about) {
  const doc = scene(id, () => [
    camera({ projectionType: 0, fov: FOV }),
    ...COLOURS.map((c, i) => mesh(`Patch${i}`, 'cube', [SLOTS[i][0], TOPS[i] / 2, SLOTS[i][1]], [0.4, TOPS[i] / 100, 0.4], c, { lit: false })),
    entity('Zone', [transform([0, 0, 0]), { type: 'WaterZone', data: { sizeX: 4000, sizeZ: 4000, resolution: 64, surf: 0, ripples: 0, farDistance: false } }]),
    entity('Sea', [transform([0, LEVEL, 0]), { type: 'WaterBody', data: { form: 0, waveHeight: 0, shoreWidth: 0, ...body } }]),
  ]);
  const expect = COLOURS.map((c, i) => {
    const p = probeFrom(...SLOTS[i], 400 - TOPS[i], FOV);
    const len = rayLength(SLOTS[i], TOPS[i]);
    return { x: p.x, y: p.y, rgb: encodeLinear8(c.map((v, k) => v * Math.exp(-ABSORPTION[k] * density * len))), tol: 4 };
  });
  return { id, doc, colorSpace: 'linear', expect, about };
}

export const WATER_SCENES = [
  underwaterScene('oracle-water-underwater', {}, WATER_DENSITY,
    'Under an ocean with the stock water material: the underwater look takes the Water shader\'s own density, 0.12 a metre'),
  underwaterScene('oracle-water-underwater-own', { underwaterLook: 1, underwaterDensity: 0.4, underwaterAbsorption: { r: 0.45, g: 0.09, b: 0.05, a: 1 } }, 0.4 / 100,
    'Under a body with its own underwater look: its density is per metre, 0.4 of it 0.004 a world unit at 100 units a metre'),
];

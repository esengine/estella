// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  lens.mjs — oracle scenes for rain and depth of field, the two effects that measure how far a surface is from the camera.
 *
 * Both are looked at by an orthographic camera and a perspective one, because "how far from the camera" has a different meaning for
 * each and the two have to agree about a surface that is plainly 100 (or 400, or 2000) units below the eye.
 */
import { scene, camera, mesh, volume, probe, probeFrom, SIZE } from './scene.mjs';
import { encodeLinear8, clamp01 } from './formulas.mjs';

const FLOOR_TOP = 5;
const FLOOR = 0.8;
const fx = (type, uniforms) => ({ type, enabled: true, uniforms });
const eye = (ortho, drop, extra = {}) => camera({ ...(ortho ? {} : { projectionType: 0, fov: 40, nearPlane: 1 }), farPlane: 8000, ...extra });
/** The camera that stands `drop` units over the floor top. */
function placeCamera(doc, drop) {
  const cam = doc.entities.find((e) => e.name === 'Camera');
  cam.components[0].data.position = { x: 0, y: FLOOR_TOP + drop, z: 0 };
}

// ---- rain ------------------------------------------------------------------------------------------------------------------------

/**
 * Wet ground. With no drops falling (intensity 0) and no puddles, rain darkens what faces up by 32% of its wetness:
 * colour x (1 - 0.32 x wetness). The floor looks straight up at the sky, so that is all that happens to it.
 */
function rainWet({ id, ortho }) {
  const drop = 400, wetness = 0.6;
  const doc = scene(id, () => [
    eye(ortho), mesh('Floor', 'cube', [0, 0, 0], [1.8, 0.1, 1.8], [FLOOR, FLOOR, FLOOR], { lit: false }),
    volume([fx('rain', { u_intensity: 0, u_wetness: wetness, u_puddles: 0 })]),
  ]);
  placeCamera(doc, drop);
  const level = FLOOR * (1 - 0.32 * wetness);
  const expect = [];
  for (const x of [-60, -20, 20, 60]) {
    for (const z of [-60, -20, 20, 60]) {
      const p = ortho ? probe(x, z) : probeFrom(x, z, drop, 40);
      expect.push({ x: p.x, y: p.y, rgb: encodeLinear8([level, level, level]), tol: 3 });
    }
  }
  return { id, doc, colorSpace: 'linear', expect, about: `Rain wets what faces up: colour x (1 - 0.32 x wetness), ${ortho ? 'orthographic' : 'perspective'}` };
}

/**
 * The streak layers stand 120, 450 and 1400 units in front of the camera, and a layer is drawn only over a surface farther than it.
 * A floor 100 units below the eye has all three behind it, so with the heaviest rain there is not one streak anywhere and the whole
 * frame is the floor's colour. A floor 2000 units down has all three in front of it, so streaks are drawn across it.
 */
function rainLayers({ id, ortho, drop, streaks }) {
  const size = ortho ? 3.2 : Math.max(3.2, ((drop * Math.tan((40 * Math.PI) / 360)) / 100) * 3);
  const doc = scene(id, () => [
    eye(ortho), mesh('Floor', 'cube', [0, 0, 0], [size, 0.1, size], [FLOOR, FLOOR, FLOOR], { lit: false }),
    volume([fx('rain', { u_intensity: 2, u_wetness: 0 })]),
  ]);
  placeCamera(doc, drop);
  const total = SIZE * SIZE, rgb = encodeLinear8([FLOOR, FLOOR, FLOOR]);
  // Streaks add light, so a streaked pixel is brighter than the floor: count the pixels that are exactly the floor.
  const count = streaks ? [{ rgb, tol: 2, atMost: Math.floor(total * 0.98) }] : [{ rgb, tol: 2, atLeast: total }];
  return { id, doc, colorSpace: 'linear', count, uniform: !streaks,
    about: `Rain layers ${streaks ? 'in front of' : 'behind'} a floor ${drop} units down, ${ortho ? 'orthographic' : 'perspective'}` };
}

// ---- depth of field --------------------------------------------------------------------------------------------------------------

/**
 * Two planes seen at once, the near one 400 units below the eye and the far one 1000, each cut in two by a black / white edge. The
 * lens focuses on 400 with a slab of 50 around it, so the near edge is sharp and the far one is blurred by
 * min(aperture x (|distance - focus| - range) / distance, maxBlur) pixels. A step edge seen through a disc of that radius r gives, at a
 * pixel s pixels onto the white side, the white share  0.5 + (asin(s / r) + (s / r) x sqrt(1 - (s / r)^2)) / pi.
 */
function depthOfField({ id, ortho }) {
  const DROP_NEAR = 400, DROP_FAR = 1000, FOCUS = 400, RANGE = 50, APERTURE = 24, MAX_BLUR = 8;
  const half = (drop) => (ortho ? 100 : drop * Math.tan((40 * Math.PI) / 360));
  // The world x of the frame's pixel boundary `px` on a plane `drop` below the camera.
  const worldX = (px, drop) => (px / SIZE - 0.5) * 2 * half(drop);
  const NEAR_EDGE = worldX(64, DROP_NEAR), FAR_EDGE = worldX(192, DROP_FAR);
  const cubeSpan = (name, top, bottom, x0, x1, c) =>
    mesh(name, 'cube', [(x0 + x1) / 2, (top + bottom) / 2, 0], [(x1 - x0) / 100, (top - bottom) / 100, 14], [c, c, c], { lit: false });
  const nearTop = FLOOR_TOP, farTop = FLOOR_TOP + DROP_NEAR - DROP_FAR; // the camera stands DROP_NEAR over the near plane
  const doc = scene(id, () => [
    eye(ortho),
    cubeSpan('NearBlack', nearTop, nearTop - 5, -2000, NEAR_EDGE, 0.0), cubeSpan('NearWhite', nearTop, nearTop - 5, NEAR_EDGE, 0, FLOOR),
    cubeSpan('FarBlack', farTop, farTop - 5, 0, FAR_EDGE, 0.0), cubeSpan('FarWhite', farTop, farTop - 5, FAR_EDGE, 2000, FLOOR),
    volume([fx('depthOfField', { u_focusDistance: FOCUS, u_autoFocus: 0, u_focusRange: RANGE, u_aperture: APERTURE, u_maxBlur: MAX_BLUR, u_highlight: 0 })]),
  ]);
  placeCamera(doc, DROP_NEAR);
  const row = Math.floor(SIZE / 2);
  const dist = (drop) => drop; // along the optical axis, which is where the edge rows are
  const coc = (drop) => Math.min((APERTURE * Math.max(Math.abs(dist(drop) - FOCUS) - RANGE, 0)) / dist(drop), MAX_BLUR);
  const share = (s, r) => (r < 0.01 ? (s > 0 ? 1 : 0) : s <= -r ? 0 : s >= r ? 1 : 0.5 + (Math.asin(s / r) + (s / r) * Math.sqrt(1 - (s / r) ** 2)) / Math.PI);
  const expect = [];
  const probeEdge = (edgePx, drop, offsets) => {
    for (const i of offsets) {
      const s = i + 0.5 - edgePx, w = share(s, coc(drop));
      expect.push({ x: i / (SIZE - 1), y: row / (SIZE - 1), rgb: encodeLinear8([FLOOR * w, FLOOR * w, FLOOR * w]), tol: drop === DROP_NEAR ? 6 : 24 });
    }
  };
  probeEdge(64, DROP_NEAR, [60, 63, 64, 67]);            // sharp: black, black, white, white
  probeEdge(192, DROP_FAR, [184, 188, 191, 192, 196, 200]); // blurred over 8 pixels
  return { id, doc, colorSpace: 'linear', expect, about: `Depth of field, ${ortho ? 'orthographic' : 'perspective'}: the in-focus edge is sharp, the far one is blurred by the circle of confusion` };
}

export const LENS_SCENES = [
  rainWet({ id: 'oracle-rain-wet-ortho', ortho: true }),
  rainWet({ id: 'oracle-rain-wet-perspective', ortho: false }),
  rainLayers({ id: 'oracle-rain-layers-near-ortho', ortho: true, drop: 100, streaks: false }),
  rainLayers({ id: 'oracle-rain-layers-near-perspective', ortho: false, drop: 100, streaks: false }),
  rainLayers({ id: 'oracle-rain-layers-far-ortho', ortho: true, drop: 2000, streaks: true }),
  rainLayers({ id: 'oracle-rain-layers-far-perspective', ortho: false, drop: 2000, streaks: true }),
  depthOfField({ id: 'oracle-dof-ortho', ortho: true }),
  depthOfField({ id: 'oracle-dof-perspective', ortho: false }),
];

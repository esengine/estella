// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  softlight.mjs — oracle scenes for soft shadows from point and spot lights (`shadowSoftness`, the size of the light).
 *
 * A lamp of radius s lit over a floor, a box floating between them. A floor point sees a share of the lamp's disc (the disc across the
 * way to the point, radius s) that the box does not cover, and that share is how much of the light reaches it: the penumbra is
 * s x (how far the point is beyond the box) / (how far the box is from the lamp) wide on each side of the edge. The share is
 * integrated here with a few hundred sample points over the disc and a ray / box test each, so it is geometry and not a measurement.
 * The engine's filter is a percentage-closer search with a bounded kernel over a shadow map, so it is an approximation of that
 * integral, and the tolerance is the width of that approximation.
 */
import { scene, camera, mesh, lamp, ambient, probe } from './scene.mjs';
import { dot, norm, sub, encodeLinear8, linearFalloff, smoothstep, axisAngle, cross } from './formulas.mjs';

const FLOOR_TOP = 5, ALBEDO = 0.8, AMBIENT = 0.15;
const BOX = { min: [-20, 85, -20], max: [20, 105, 20] };
const LAMP = [-60, 225, 40];
const SPOT_INNER = 100, SPOT_OUTER = 120; // full cone angles: wide enough to hold the whole floor in view, narrow enough to be a spot

const slab = (origin, dir, maxT) => {
  let t0 = 0, t1 = maxT;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dir[a]) < 1e-9) { if (origin[a] < BOX.min[a] || origin[a] > BOX.max[a]) return false; continue; }
    let ta = (BOX.min[a] - origin[a]) / dir[a], tb = (BOX.max[a] - origin[a]) / dir[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
};

/** The share of a lamp of radius `size` a floor point sees, over a disc across the way to the point. */
function visibleShare(p, size) {
  const toLamp = sub(LAMP, p), dist = Math.hypot(...toLamp), axis = toLamp.map((v) => v / dist);
  if (size <= 0) return slab(p, axis, dist) ? 0 : 1;
  const helper = Math.abs(axis[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(axis, helper)), v = cross(axis, u);
  const N = 600;
  let seen = 0;
  for (let i = 0; i < N; i++) {
    const r = size * Math.sqrt((i + 0.5) / N), a = i * 2.399963229728653;
    const target = LAMP.map((c, k) => c + r * (Math.cos(a) * u[k] + Math.sin(a) * v[k]));
    const d = sub(target, p), len = Math.hypot(...d);
    if (!slab(p, d.map((x) => x / len), len)) seen++;
  }
  return seen / N;
}

/** The rotation that turns the -Z of an entity to look along `dir`. */
function lookAlong(dir) {
  const from = [0, 0, -1], c = cross(from, dir), s = Math.hypot(...c);
  if (s < 1e-6) return dot(from, dir) > 0 ? { x: 0, y: 0, z: 0, w: 1 } : axisAngle([0, 1, 0], 180);
  return axisAngle(c.map((x) => x / s), (Math.atan2(s, dot(from, dir)) * 180) / Math.PI);
}

/**
 * Measured against the disc integral (Blender-free, above): the engine's filter is within about 14 codes of it at the 95th percentile of
 * the penumbra's points, 25 at worst for a lamp of radius 18, and 34 at worst for 34, whose penumbra is wide enough to reach the bound the
 * filter puts on its kernel. `tol` is that worst case plus a few: loose enough to be an approximation, tight enough that a shadow with
 * no penumbra (which differs from the integral by up to 70 in the middle of it) fails.
 */
function softLamp({ id, size, spot, intensity = 1.4, reach = 700, tol = 30 }) {
  const light = { radius: reach, falloff: 1, meshShadows: true, shadowSoftness: size, ...(spot ? { type: 3, innerAngle: SPOT_INNER, outerAngle: SPOT_OUTER } : {}) };
  const doc = scene(id, () => [
    camera(),
    mesh('Floor', 'cube', [0, 0, 0], [4, 0.1, 4], [ALBEDO, ALBEDO, ALBEDO], { lit: false }),
    mesh('Box', 'cube', [0, 95, 0], [0.4, 0.2, 0.4], [0.5, 0.5, 0.5], { lit: false }),
    lamp(LAMP, intensity, [1, 1, 1], light),
    ambient(AMBIENT),
  ]);
  // Lit, not unlit: the floor is the receiver. Its colour is the albedo and the lamp and ambient light it.
  doc.entities.find((e) => e.name === 'Floor').components[1].data.lit = true;
  if (spot) doc.entities.find((e) => e.name === 'Lamp').components[0].data.rotation = lookAlong(norm(sub([0, 95, 0], LAMP)));
  const axis = norm(sub([0, 95, 0], LAMP));
  const cosInner = Math.cos((SPOT_INNER * 0.5 * Math.PI) / 180), cosOuter = Math.cos((SPOT_OUTER * 0.5 * Math.PI) / 180);
  const rows = [];
  for (let x = -90; x <= 90; x += 6) {
    for (let z = -90; z <= 90; z += 6) {
      if (Math.abs(x) < 28 && Math.abs(z) < 28) continue; // under the box: the camera sees the box
      const p = [x, FLOOR_TOP, z], toLamp = sub(LAMP, p), dist = Math.hypot(...toLamp), dir = toLamp.map((c) => c / dist);
      const share = visibleShare(p, size);
      const cone = spot ? smoothstep(cosOuter, cosInner, dot(dir.map((c) => -c), axis)) : 1;
      const e = ALBEDO * (AMBIENT + intensity * linearFalloff(dist, reach, 0, 1) * cone * dir[1] * share);
      rows.push({ x, z, share, e });
    }
  }
  // The edge of a shadow is where the filter matters: every point of the penumbra, and a spread of the lit and the dark.
  const pen = rows.filter((r) => r.share > 0.04 && r.share < 0.96), lit = rows.filter((r) => r.share >= 0.96), dark = rows.filter((r) => r.share <= 0.04);
  const every = (list, n) => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
  const chosen = [...pen, ...every(lit, 10), ...every(dark, 10)];
  const expect = chosen.map((r) => { const p = probe(r.x, r.z); return { x: p.x, y: p.y, rgb: encodeLinear8([r.e, r.e, r.e]), tol }; });
  return { id, doc, colorSpace: 'linear', expect, penumbra: pen.length, about: `Soft shadow of a ${spot ? 'spot' : 'point'} lamp of radius ${size}: the share of its disc the box leaves open` };
}

export const SOFT_LIGHT_SCENES = [
  softLamp({ id: 'oracle-soft-point', size: 18 }),
  softLamp({ id: 'oracle-soft-point-large', size: 34, tol: 38 }),
  softLamp({ id: 'oracle-soft-spot', size: 18, spot: true }),
];

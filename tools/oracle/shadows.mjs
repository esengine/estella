// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  shadows.mjs — oracle scenes for shadows: where a shadow falls is geometry.
 *
 * A floor point is in shadow when the ray from it to the light meets a caster, and the share of a sun's disc that ray still
 * reaches is how dark a soft shadow is there. Both are ray/box and ray/sphere tests, written below from nothing but the scene's
 * own numbers. Probes are kept clear of a shadow's edge for a hard shadow (an edge is a pixel the shadow map may take either way)
 * and put across it for a soft one, where the share is the whole point.
 */
import { scene, camera, mesh, sun, ambient, lamp, probe } from './scene.mjs';
import { sunAim, dot, norm, sub, encodeLinear8, linearFalloff } from './formulas.mjs';

const FLOOR_TOP = 5; // the 10-unit slab's upper face
const ALBEDO = 0.8;
const AMBIENT = 0.15;

/** The casters: a box and a ball standing on the floor. `min`/`max` and `centre`/`radius` are world units. */
const BOX = { min: [10, FLOOR_TOP, -40], max: [50, FLOOR_TOP + 60, 0] };
const BALL = { centre: [-45, FLOOR_TOP + 18, 25], radius: 18 };
const casters = () => [
  mesh('Box', 'cube', [30, FLOOR_TOP + 30, -20], [0.4, 0.6, 0.4], [0.6, 0.6, 0.6]),
  mesh('Ball', 'sphere', BALL.centre, [0.36, 0.36, 0.36], [0.6, 0.6, 0.6]),
];

/** Does the ray from `origin` along unit `dir` (up to `maxT`) meet the box? Slab test. */
function hitsBox(origin, dir, maxT = Infinity) {
  let t0 = 0, t1 = maxT;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dir[a]) < 1e-9) { if (origin[a] < BOX.min[a] || origin[a] > BOX.max[a]) return false; continue; }
    let ta = (BOX.min[a] - origin[a]) / dir[a], tb = (BOX.max[a] - origin[a]) / dir[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}
/** Does the ray meet the ball? */
function hitsBall(origin, dir, maxT = Infinity) {
  const oc = sub(origin, BALL.centre), b = dot(oc, dir), c = dot(oc, oc) - BALL.radius * BALL.radius;
  const disc = b * b - c;
  if (disc < 0) return false;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < maxT;
}
const blocked = (origin, dir, maxT) => hitsBox(origin, dir, maxT) || hitsBall(origin, dir, maxT);

/** A floor point's world position (the camera sees the floor's top face). */
const floorPoint = (x, z) => [x, FLOOR_TOP + 0.01, z];

/** Under a caster's footprint the camera sees the caster, not the floor: no probe there. */
function underCaster(x, z, margin = 6) {
  const inBox = x > BOX.min[0] - margin && x < BOX.max[0] + margin && z > BOX.min[2] - margin && z < BOX.max[2] + margin;
  const inBall = Math.hypot(x - BALL.centre[0], z - BALL.centre[2]) < BALL.radius + margin;
  return inBox || inBall;
}

const GRID = (() => { const g = []; for (let x = -90; x <= 90; x += 10) for (let z = -90; z <= 90; z += 10) g.push([x, z]); return g; })();

/** The share of a sun's disc (angular radius `rho`, radians) a floor point can see: 1 = fully lit. */
function sunVisibility(p, toLight, rho) {
  if (rho < 1e-6) return blocked(p, toLight) ? 0 : 1;
  // Two axes spanning the disc, then a spiral of sample directions across it.
  const up = Math.abs(toLight[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const u = norm([up[1] * toLight[2] - up[2] * toLight[1], up[2] * toLight[0] - up[0] * toLight[2], up[0] * toLight[1] - up[1] * toLight[0]]);
  const v = [toLight[1] * u[2] - toLight[2] * u[1], toLight[2] * u[0] - toLight[0] * u[2], toLight[0] * u[1] - toLight[1] * u[0]];
  const N = 1500;
  let seen = 0;
  for (let i = 0; i < N; i++) {
    const r = Math.tan(rho) * Math.sqrt((i + 0.5) / N), a = i * 2.399963229728653;
    const d = norm([toLight[0] + r * (Math.cos(a) * u[0] + Math.sin(a) * v[0]), toLight[1] + r * (Math.cos(a) * u[1] + Math.sin(a) * v[1]), toLight[2] + r * (Math.cos(a) * u[2] + Math.sin(a) * v[2])]);
    if (!blocked(p, d)) seen++;
  }
  return seen / N;
}

function sunShadow({ id, pitch, yaw, intensity, sourceAngle, soft }) {
  const aim = sunAim(pitch, yaw);
  const doc = scene(id, () => [
    camera(),
    mesh('Floor', 'cube', [0, 0, 0], [4, 0.1, 4], [ALBEDO, ALBEDO, ALBEDO]),
    ...casters(),
    sun(aim, intensity, [1, 1, 1], { meshShadows: true, sourceAngle, shadowSoftness: soft ?? 0 }),
    ambient(AMBIENT),
  ]);
  const rho = (sourceAngle * Math.PI) / 360;
  const cos = aim.toLight[1];
  const level = (vis) => ALBEDO * (AMBIENT + intensity * cos * vis);
  const visAt = (x, z) => sunVisibility(floorPoint(x, z), aim.toLight, rho);
  const hard = sourceAngle < 0.1;
  const expect = [];
  for (const [gx, gz] of GRID) {
    if (underCaster(gx, gz)) continue;
    const p = probe(gx, gz), [x, z] = p.at;
    const vis = visAt(x, z);
    if (hard) {
      // Keep only points whose neighbourhood agrees: an edge pixel is the shadow map's to take either way.
      const same = [[5, 0], [-5, 0], [0, 5], [0, -5], [4, 4], [-4, -4]].every(([dx, dz]) => visAt(x + dx, z + dz) === vis);
      if (!same) continue;
    }
    expect.push({ x: p.x, y: p.y, rgb: encodeLinear8([level(vis), level(vis), level(vis)]), tol: hard ? 4 : 20, vis });
  }
  return { id, doc, colorSpace: 'linear', expect: expect.map(({ vis, ...e }) => e), shadowed: expect.filter((e) => e.vis < 0.05).length, lit: expect.filter((e) => e.vis > 0.95).length,
    about: hard ? 'Hard sun shadow: a point is dark when the ray to the sun meets the box or the ball' : `Soft sun shadow: the share of a ${sourceAngle} degree sun disc the point sees` };
}

function pointShadow({ id, position, intensity, reach }) {
  const doc = scene(id, () => [
    camera(),
    mesh('Floor', 'cube', [0, 0, 0], [4, 0.1, 4], [ALBEDO, ALBEDO, ALBEDO]),
    ...casters(),
    lamp(position, intensity, [1, 1, 1], { radius: reach, falloff: 1, meshShadows: true }),
    ambient(AMBIENT),
  ]);
  const expect = [];
  const eval1 = (x, z) => {
    const p = floorPoint(x, z), to = sub(position, p), dist = Math.hypot(...to), dir = to.map((v) => v / dist);
    const vis = blocked(p, dir, dist) ? 0 : 1;
    return { vis, level: ALBEDO * (AMBIENT + intensity * linearFalloff(dist, reach, 0, 1) * dir[1] * vis) };
  };
  for (const [gx, gz] of GRID) {
    if (underCaster(gx, gz)) continue;
    const p = probe(gx, gz), [x, z] = p.at, here = eval1(x, z);
    if (![[5, 0], [-5, 0], [0, 5], [0, -5]].every(([dx, dz]) => eval1(x + dx, z + dz).vis === here.vis)) continue;
    expect.push({ x: p.x, y: p.y, rgb: encodeLinear8([here.level, here.level, here.level]), tol: 4, vis: here.vis });
  }
  return { id, doc, colorSpace: 'linear', expect: expect.map(({ vis, ...e }) => e), shadowed: expect.filter((e) => e.vis === 0).length, lit: expect.filter((e) => e.vis === 1).length,
    about: 'Point-lamp shadow: the ray from a floor point to the lamp meets the box or the ball' };
}

export const SHADOW_SCENES = [
  sunShadow({ id: 'oracle-sun-shadow', pitch: 40, yaw: 20, intensity: 1.0, sourceAngle: 0 }),
  sunShadow({ id: 'oracle-sun-shadow-low', pitch: 22, yaw: -115, intensity: 1.0, sourceAngle: 0 }),
  sunShadow({ id: 'oracle-sun-shadow-soft', pitch: 40, yaw: 20, intensity: 1.0, sourceAngle: 8, soft: 1 }),
  pointShadow({ id: 'oracle-point-shadow', position: [-10, FLOOR_TOP + 140, 60], intensity: 1.4, reach: 500 }),
];

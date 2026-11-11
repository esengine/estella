// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  lights.mjs — oracle scenes for lights: a sphere's brightness is a formula.
 */
import { scene, camera, mesh, sun, ambient, lamp, probe } from './scene.mjs';
import { sunAim, axisAngle, smoothstep, dot, norm, encodeLinear8, encodeGamma8, inverseSquare, linearFalloff, srgbDecode } from './formulas.mjs';

/** A light's colour is authored as sRGB: a linear-light frame decodes it, a gamma frame uses it as it is. (MeshRenderer.color is linear already.) */
const lightColour = (colorSpace, c) => (colorSpace === 'linear' ? c.map(srgbDecode) : c);

const R = 50; // the builtin sphere is 100 units across

/** The normal of a ball of radius R, centred over the origin, at the point the camera sees at world (x, z). */
function ballNormal(x, z) {
  const r2 = x * x + z * z;
  if (r2 >= R * R) return null;
  return [x / R, Math.sqrt(R * R - r2) / R, z / R];
}

const BALL_PROBES = [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16], [30, 12], [-30, -12], [12, -34], [40, 0], [-40, 0]];

/**
 * A lit ball under a sun and one ambient light. Expected = albedo * (ambient + sun * max(N.L, 0)), sampled across the whole
 * disc: a wrong cosine, a flipped light direction or a lost channel each shows on a different probe.
 */
function ballUnderSun({ id, colorSpace, pitch, yaw, albedo, sunI, sunColor, ambientI, ambientColor }) {
  const aim = sunAim(pitch, yaw);
  const doc = scene(id, () => [
    camera(),
    mesh('Ball', 'sphere', [0, R, 0], [1, 1, 1], albedo),
    sun(aim, sunI, sunColor),
    ambient(ambientI, ambientColor),
  ]);
  const encode = colorSpace === 'linear' ? encodeLinear8 : encodeGamma8;
  const expect = BALL_PROBES.map(([x, z]) => {
    const p = probe(x, z), n = ballNormal(...p.at);
    const ac = lightColour(colorSpace, ambientColor), sc = lightColour(colorSpace, sunColor);
    const e = ac.map((c, k) => c * ambientI + sc[k] * sunI * Math.max(0, dot(n, aim.toLight)));
    return { x: p.x, y: p.y, rgb: encode(albedo.map((a, k) => a * e[k])), tol: 4 };
  });
  return { id, doc, colorSpace, expect, about: 'Lambert across a ball: albedo x (ambient + sun x N.L)' };
}

/** A flat floor with one point lamp over its middle: the falloff curve, sampled out along a radius. */
function floorUnderLamp({ id, colorSpace, height, intensity, light, fall }) {
  const floorTop = 5; // the 10-unit-thick slab's top face
  const doc = scene(id, () => [
    camera(),
    mesh('Floor', 'cube', [0, 0, 0], [4, 0.1, 4], [1, 1, 1]),
    lamp([0, floorTop + height, 0], intensity, [1, 1, 1], light),
  ]);
  const encode = colorSpace === 'linear' ? encodeLinear8 : encodeGamma8;
  const expect = [[0, 0], [40, 0], [-40, 0], [0, 70], [80, 0], [60, 60]].map(([x, z]) => {
    const p = probe(x, z), [wx, wz] = p.at;
    const toLamp = [-wx, height, -wz], dist = Math.hypot(...toLamp);
    const e = intensity * fall(dist) * Math.max(0, dot(norm(toLamp), [0, 1, 0]));
    return { x: p.x, y: p.y, rgb: encode([e, e, e]), tol: 4 };
  });
  return { id, doc, colorSpace, expect, about: 'Point lamp falloff over a floor' };
}

/** A ball under an ambient light with a hemisphere: sky colour from above, ground colour from below, blended by the facing. */
function ballUnderHemisphere({ id, colorSpace, albedo, intensity, sky, ground }) {
  const doc = scene(id, () => [
    camera(),
    mesh('Ball', 'sphere', [0, R, 0], [1, 1, 1], albedo),
    ambient(intensity, sky, { hemisphere: true, groundColor: { r: ground[0], g: ground[1], b: ground[2], a: 1 } }),
  ]);
  const encode = colorSpace === 'linear' ? encodeLinear8 : encodeGamma8;
  const skyC = lightColour(colorSpace, sky), groundC = lightColour(colorSpace, ground);
  const expect = BALL_PROBES.map(([x, z]) => {
    const p = probe(x, z), n = ballNormal(...p.at), up = 0.5 + 0.5 * n[1];
    const e = skyC.map((c, k) => intensity * (c * up + groundC[k] * (1 - up)));
    return { x: p.x, y: p.y, rgb: encode(albedo.map((a, k) => a * e[k])), tol: 4 };
  });
  return { id, doc, colorSpace, expect, about: 'Hemisphere ambient: sky x (0.5 + 0.5 N.y) + ground x (0.5 - 0.5 N.y)' };
}

/**
 * A spot lamp straight over a floor. `innerAngle` and `outerAngle` are the cone's FULL angles: the light is full strength inside
 * the inner half-angle, gone outside the outer one, and smoothstep between them in the cosine of the angle off the axis.
 */
function floorUnderSpot({ id, height, intensity, inner, outer, reach }) {
  const floorTop = 5;
  const doc = scene(id, () => [
    camera(),
    mesh('Floor', 'cube', [0, 0, 0], [4, 0.1, 4], [1, 1, 1]),
    lamp([0, floorTop + height, 0], intensity, [1, 1, 1], { type: 3, radius: reach, falloff: 1, innerAngle: inner, outerAngle: outer }),
  ]);
  // The lamp's rotation belongs to its Transform: aim it down its own -Z.
  const lampEntity = doc.entities.find((e) => e.name === 'Lamp');
  lampEntity.components[0].data.rotation = axisAngle([1, 0, 0], -90);
  const cosInner = Math.cos((inner * 0.5 * Math.PI) / 180), cosOuter = Math.cos((outer * 0.5 * Math.PI) / 180);
  const expect = [0, 10, 20, 30, 40, 50, 65].map((x) => {
    const p = probe(x, 0), [wx, wz] = p.at;
    const toLamp = [-wx, height, -wz], dist = Math.hypot(...toLamp);
    const cone = smoothstep(cosOuter, cosInner, height / dist);
    const e = intensity * linearFalloff(dist, reach, 0, 1) * cone * (height / dist);
    return { x: p.x, y: p.y, rgb: encodeLinear8([e, e, e]), tol: 4 };
  });
  return { id, doc, colorSpace: 'linear', expect, about: 'Spot cone: smoothstep(cos outer/2, cos inner/2, cos off-axis)' };
}

export const LIGHT_SCENES = [
  ballUnderSun({ id: 'oracle-lambert-sun', colorSpace: 'linear', pitch: 50, yaw: 30, albedo: [0.9, 0.5, 0.2], sunI: 1.5, sunColor: [1, 1, 1], ambientI: 0.1, ambientColor: [1, 1, 1] }),
  ballUnderSun({ id: 'oracle-lambert-sun-gamma', colorSpace: 'gamma', pitch: 50, yaw: 30, albedo: [0.9, 0.5, 0.2], sunI: 1.0, sunColor: [1, 1, 1], ambientI: 0.1, ambientColor: [1, 1, 1] }),
  ballUnderSun({ id: 'oracle-sun-colour', colorSpace: 'linear', pitch: 35, yaw: -60, albedo: [0.8, 0.8, 0.8], sunI: 2, sunColor: [1, 0.5, 0.25], ambientI: 0.2, ambientColor: [0.4, 0.6, 1] }),
  floorUnderLamp({ id: 'oracle-point-linear', colorSpace: 'linear', height: 100, intensity: 1.2, light: { radius: 400, falloff: 1 }, fall: (d) => linearFalloff(d, 400, 0, 1) }),
  floorUnderLamp({ id: 'oracle-point-linear-curve', colorSpace: 'linear', height: 100, intensity: 1.2, light: { radius: 400, falloff: 2.5 }, fall: (d) => linearFalloff(d, 400, 0, 2.5) }),
  floorUnderLamp({ id: 'oracle-point-isq', colorSpace: 'linear', height: 100, intensity: 0.8, light: { radius: 800, inverseSquare: true }, fall: (d) => inverseSquare(d, 800, 100) }),
  ballUnderHemisphere({ id: 'oracle-hemisphere', colorSpace: 'linear', albedo: [0.8, 0.8, 0.8], intensity: 1.2, sky: [0.3, 0.5, 1], ground: [0.6, 0.4, 0.2] }),
  ballUnderHemisphere({ id: 'oracle-hemisphere-gamma', colorSpace: 'gamma', albedo: [0.8, 0.8, 0.8], intensity: 1.0, sky: [0.3, 0.5, 1], ground: [0.6, 0.4, 0.2] }),
  floorUnderSpot({ id: 'oracle-spot-cone', height: 100, intensity: 0.6, inner: 20, outer: 50, reach: 600 }),
];

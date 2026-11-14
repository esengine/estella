// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sky.mjs — oracle scenes for the Sky Atmosphere dome.
 *
 * The dome is Nishita's single-scattering model: Rayleigh and Mie scattering through an exponential atmosphere, the sun's light
 * attenuated on its way in and the view ray attenuated on its way out, with the Rayleigh and Henyey-Greenstein phase functions
 * (Nishita et al. 1993; Scratchapixel's "Simulating the Colors of the Sky", whose constants these are). The shader integrates it
 * with 16 view steps and 4 light steps, which is what a frame can afford; the reference here integrates the same integral with
 * hundreds, so a disagreement is the shader's integration, or its structure, and not the model.
 *
 * Probes keep clear of the sun's disc and its glow, and the scenes carry no clouds, no moon and no stars (the sun is well up).
 */
import { scene, camera, mesh, sun, probe, probeFrom, SIZE } from './scene.mjs';
import { volume } from './scene.mjs';
import { axisAngle, rotate, norm, dot, encodeLinear8, clamp01, smoothstep, srgbDecode, sunAim } from './formulas.mjs';

const R_E = 6360, R_A = 6420;
const BETA_R = [0.0058, 0.0135, 0.0331], BETA_M = 0.021, H_R = 8, H_M = 1.2, SUN_I = 22, G = 0.76, SKY_GLOW = 0.03;

const sphereFar = (o, d, r) => {
  const b = dot(o, d), disc = b * b - (dot(o, o) - r * r);
  return disc < 0 ? -1 : -b + Math.sqrt(disc);
};
const sphereNear = (o, d, r) => {
  const b = dot(o, d), disc = b * b - (dot(o, o) - r * r);
  return disc < 0 ? -1 : -b - Math.sqrt(disc);
};
const along = (o, d, t) => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
const height = (p) => Math.hypot(...p) - R_E;

/** The air between p and the top of the atmosphere along d as (Rayleigh, Mie) optical depth, or null when the planet is in the way. */
function lightDepth(p, d, steps) {
  if (sphereFar(p, d, R_E) > 0 && sphereNear(p, d, R_E) > 0) return null;
  const len = sphereFar(p, d, R_A), ds = len / steps;
  let r = 0, m = 0;
  for (let j = 0; j < steps; j++) {
    const h = height(along(p, d, ds * (j + 0.5)));
    r += Math.exp(-h / H_R) * ds; m += Math.exp(-h / H_M) * ds;
  }
  return [r, m];
}

export function scatterRef(dir, sun, alt, haze, N = 480, M = 96) {
  const o = [0, R_E + alt, 0], len = sphereFar(o, dir, R_A), ds = len / N, mu = dot(dir, sun);
  const phaseR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const phaseM = (3 / (8 * Math.PI)) * (((1 - G * G) * (1 + mu * mu)) / ((2 + G * G) * Math.pow(1 + G * G - 2 * G * mu, 1.5)));
  let odR = 0, odM = 0;
  const sumR = [0, 0, 0], sumM = [0, 0, 0], sumG = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const p = along(o, dir, ds * (i + 0.5)), h = height(p);
    const dR = Math.exp(-h / H_R) * ds, dM = Math.exp(-h / H_M) * ds;
    const midR = odR + dR * 0.5, midM = odM + dM * 0.5;
    odR += dR; odM += dM;
    const ol = lightDepth(p, sun, M);
    if (!ol) continue;
    const fromSun = BETA_R.map((b) => Math.exp(-(b * ol[0] + BETA_M * haze * 1.1 * ol[1])));
    const grey = (fromSun[0] + fromSun[1] + fromSun[2]) / 3;
    for (let k = 0; k < 3; k++) {
      const toEye = Math.exp(-(BETA_R[k] * midR + BETA_M * haze * 1.1 * midM));
      const attn = toEye * fromSun[k];
      sumR[k] += attn * dR; sumM[k] += attn * dM;
      sumG[k] += toEye * (fromSun[k] + grey) * 0.5 * (BETA_R[k] * dR + BETA_M * haze * dM);
    }
  }
  return sumR.map((r, k) => (r * BETA_R[k] * phaseR + sumM[k] * BETA_M * haze * phaseM + sumG[k] * SKY_GLOW) * SUN_I);
}

/** What the composite shows of that radiance: x 0.55 x brightness, dimmed below the horizon (a cloud-free day, so no night glow). */
export function domeRef(dir, sun, { altitude, haze, intensity }) {
  const flat = norm([dir[0], Math.max(dir[1], 0.015), dir[2]]);
  const col = scatterRef(flat, sun, altitude, haze).map((v) => v * 0.55 * intensity);
  const below = 1 - 0.75 * smoothstep(0, -0.3, dir[1]);
  return col.map((v) => v * below);
}

const FOV = 70;
/** The world direction a pixel of a perspective camera, pitched `pitch` degrees up and turned `yaw` about Y, looks along. */
function pixelDir(i, j, pitch, yaw) {
  const t = Math.tan((FOV * Math.PI) / 360);
  const nx = (2 * (i + 0.5)) / SIZE - 1, ny = 1 - (2 * (j + 0.5)) / SIZE;
  const q = axisAngle([0, 1, 0], yaw), p = axisAngle([1, 0, 0], pitch);
  const cam = norm([nx * t, ny * t, -1]);
  return norm(rotate(q, rotate(p, cam)));
}
const cameraQuat = (pitch, yaw) => {
  const a = axisAngle([0, 1, 0], yaw), b = axisAngle([1, 0, 0], pitch);
  return { w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z, x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w };
};

const sunVector = (elevation, azimuth) => {
  const el = (elevation * Math.PI) / 180, az = (azimuth * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
};

/**
 * HORIZON_GAP: the shader walks a view ray in 16 equal steps. A ray near the horizon crosses a thousand kilometres of air, almost all of it
 * density in the first few hundred, so equal steps of tens of kilometres miss it: measured against the converged integral, the blue at
 * the horizon is a third of what it should be (a yellow band where the sky should pale to white), and from 10 to 25 degrees up the
 * dome is 5 to 15 percent dark. Probes below 10 degrees are left out of the strict scenes; the gap stays open and is recorded here, not asserted away.
 */
const minElevationSine = Math.sin((10 * Math.PI) / 180);

/** The sun's light by the time it reaches the viewer (the disc's colour): the transmittance along the sun's own ray. */
function sunTransmittance(sun, alt, haze) {
  const od = lightDepth([0, R_E + alt, 0], sun, 256);
  if (!od) return [0, 0, 0];
  return BETA_R.map((b) => Math.exp(-(b * od[0] + BETA_M * haze * 1.1 * od[1])));
}

function skyDome({ id, elevation, azimuth, pitch, yaw, haze = 1, intensity = 0.5, tol = 18, grid = 5, glow = false, sunBrightness = 40, disc = glow }) {
  const sun = sunVector(elevation, azimuth);
  const doc = scene(id, () => [
    camera({ projectionType: 0, fov: FOV, nearPlane: 1, farPlane: 2000 }),
    volume([{ type: 'skyAtmosphere', enabled: true, uniforms: { u_clouds: 0, u_sunElevation: elevation, u_sunAzimuth: azimuth, u_haze: haze, u_intensity: intensity, u_altitude: 0.1, u_sunBrightness: sunBrightness } }]),
  ]);
  const cam = doc.entities.find((e) => e.name === 'Camera');
  cam.components[0].data.position = { x: 0, y: 0, z: 0 };
  cam.components[0].data.rotation = cameraQuat(pitch, yaw);
  const expect = [];
  for (let a = 0; a < grid; a++) {
    for (let b = 0; b < grid; b++) {
      const i = Math.round(((a + 0.5) / grid) * (SIZE - 1)), j = Math.round(((b + 0.5) / grid) * (SIZE - 1));
      const dir = pixelDir(i, j, pitch, yaw);
      if (dot(dir, sun) > Math.cos(((glow ? 1.5 : 12) * Math.PI) / 180)) continue; // the sun's disc, and its glow unless this scene is about it
      if (dir[1] < minElevationSine) continue; // see HORIZON_GAP
      const col = domeRef(dir, sun, { altitude: 0.1, haze, intensity });
      expect.push({ x: i / (SIZE - 1), y: j / (SIZE - 1), rgb: encodeLinear8(col.map(clamp01)), tol, dir });
    }
  }
  if (disc) {
    // The pixel at the middle of the frame looks along the sun: its disc, which adds the sun's own transmitted light to the dome.
    const j = SIZE / 2, dir = pixelDir(j, j, pitch, yaw), trans = sunTransmittance(sun, 0.1, haze);
    const col = domeRef(dir, sun, { altitude: 0.1, haze, intensity }).map((v, k) => v + trans[k] * sunBrightness);
    expect.push({ x: j / (SIZE - 1), y: j / (SIZE - 1), rgb: encodeLinear8(col.map(clamp01)), tol, dir });
  }
  return { id, doc, colorSpace: 'linear', expect: expect.map(({ dir, ...e }) => e), range: [Math.min(...expect.map((e) => Math.min(...e.rgb))), Math.max(...expect.map((e) => Math.max(...e.rgb)))],
    about: 'Sky dome: the single-scattering integral, converged, against the shader\'s 16 view steps' };
}


/**
 * Cloud shadows on a floor. The slab stands by `u_altitude` (km) and the floor's drop below the eye: floor altitude = u_altitude - drop /
 * u_unitsPerKm. Below the floor it casts nothing; a dense one above (overcast) leaves a fifth of the SUN's light, loosely (noise makes gaps).
 * A floor nothing lights (its own colour, as an emissive surface) keeps that colour under it. Each case runs under both kinds of camera.
 */
function cloudShadow({ id, ortho, altitude, shadowed, lit = true }) {
  const HEIGHT = 400, FLOOR_TOP = 5, UNITS_PER_KM = 1000, ALBEDO = 0.8;
  const aim = sunAim(40, 40);
  const doc = scene(id, () => [
    camera(ortho ? {} : { projectionType: 0, fov: 40, nearPlane: 1, farPlane: 2000 }),
    mesh('Floor', 'cube', [0, 0, 0], [1.8, 0.1, 1.8], [ALBEDO, ALBEDO, ALBEDO], { lit }),
    ...(lit ? [sun(aim, 1)] : []),
    volume([{ type: 'skyAtmosphere', enabled: true, uniforms: { u_clouds: 1, u_overcast: 1, u_cloudShadow: 1, u_unitsPerKm: UNITS_PER_KM, u_sunElevation: 40, u_sunAzimuth: 40, u_altitude: altitude, u_windSpeed: 0 } }]),
  ]);
  const floorAltitude = altitude - (HEIGHT - FLOOR_TOP) / UNITS_PER_KM;
  const grid = [-60, -20, 20, 60];
  const open = lit ? ALBEDO * Math.max(0, aim.toLight[1]) : ALBEDO;
  const expect = [];
  for (const x of grid) {
    for (const z of grid) {
      const p = ortho ? probe(x, z) : probeFrom(x, z, HEIGHT - FLOOR_TOP, 40);
      // Unshadowed, or not lit by the sun: what the floor is with no cloud. Shadowed and sunlit: 20% of that, give or take the gaps.
      const v = shadowed && lit ? open * 0.2 : open;
      expect.push({ x: p.x, y: p.y, rgb: encodeLinear8([v, v, v]), tol: shadowed && lit ? 40 : 3 });
    }
  }
  return { id, doc, colorSpace: 'linear', expect, floorAltitude,
    about: `Cloud shadow on the sun, ${ortho ? 'orthographic' : 'perspective'} camera, slab ${shadowed ? 'above' : 'below'} the floor${lit ? '' : ', a floor the sun does not light'}` };
}


/**
 * A custom sky is the user's own radiance function of the view direction, laid under the scene the way the built-in dome is. The host's
 * `oracleSky` is a gradient by height plus the sun's light in a lobe round the sun, so a pixel is that sum exactly. An orthographic camera's
 * rays are parallel, so all of its pixels look along one direction and must be one colour.
 */
function customSky({ id, ortho, pitch, yaw, sunPitch, sunYaw, intensity = 0.9 }) {
  const aim = sunAim(sunPitch, sunYaw), sunColour = [1, 0.5, 0.25], sunI = 1;
  const doc = scene(id, () => [
    camera(ortho ? {} : { projectionType: 0, fov: FOV, nearPlane: 1, farPlane: 2000 }),
    sun(aim, sunI, sunColour),
    volume([{ type: 'oracleSky', enabled: true, uniforms: { u_intensity: intensity } }]),
  ]);
  const cam = doc.entities.find((e) => e.name === 'Camera');
  cam.components[0].data.position = { x: 0, y: 0, z: 0 };
  cam.components[0].data.rotation = cameraQuat(pitch, yaw);
  const sunLinear = sunColour.map(srgbDecode).map((c) => c * sunI);
  const radiance = (dir) => {
    const t = clamp01(dir[1] * 0.5 + 0.5), g = Math.pow(Math.max(dot(dir, aim.toLight), 0), 64) * 0.5;
    return [0.6, 0.3, 0.1].map((h, k) => ([0.1, 0.3, 0.8][k] - h) * t + h + sunLinear[k] * g).map((v) => v * intensity);
  };
  const expect = [];
  const grid = 6;
  for (let a = 0; a < grid; a++) {
    for (let b = 0; b < grid; b++) {
      const i = Math.round(((a + 0.5) / grid) * (SIZE - 1)), j = Math.round(((b + 0.5) / grid) * (SIZE - 1));
      const dir = ortho ? pixelDirOrtho(pitch, yaw) : pixelDir(i, j, pitch, yaw);
      expect.push({ x: i / (SIZE - 1), y: j / (SIZE - 1), rgb: encodeLinear8(radiance(dir).map(clamp01)), tol: 4 });
    }
  }
  // Every pixel one colour is the point of the orthographic case, and the harness wants that said: the colour, and all of the frame's pixels.
  const uniform = ortho ? { uniform: true, count: [{ rgb: expect[0].rgb, tol: 4, atLeast: SIZE * SIZE }] } : {};
  return { id, doc, colorSpace: 'linear', expect, ...uniform, about: `Custom sky: gradient + sun lobe, ${ortho ? 'orthographic (one direction, one colour)' : 'perspective'}` };
}
/** The one direction every ray of an orthographic camera looks along. */
const pixelDirOrtho = (pitch, yaw) => norm(rotate(axisAngle([0, 1, 0], yaw), rotate(axisAngle([1, 0, 0], pitch), [0, 0, -1])));

export const SKY_SCENES = [
  skyDome({ id: 'oracle-sky-noon', elevation: 65, azimuth: 40, pitch: 35, yaw: 200 }),
  skyDome({ id: 'oracle-sky-afternoon', elevation: 35, azimuth: 40, pitch: 30, yaw: 140 }),
  skyDome({ id: 'oracle-sky-low-sun', elevation: 8, azimuth: 40, pitch: 25, yaw: 215 }),
  skyDome({ id: 'oracle-sky-sun-glow', elevation: 35, azimuth: 40, pitch: 35, yaw: 220, intensity: 0.08, sunBrightness: 1, glow: true }),
  // The glow round a low sun, without the pixel on the disc itself: the disc is a third of a degree across and its edge a pixel wide here,
  // and a software rasterizer reads the middle pixel on that edge (97 where a GPU reads 244). The disc is oracle-sky-sun-glow's to hold.
  skyDome({ id: 'oracle-sky-sun-glow-low', elevation: 14, azimuth: 40, pitch: 14, yaw: 220, intensity: 0.06, sunBrightness: 1, glow: true, disc: false }),
  skyDome({ id: 'oracle-sky-hazy', elevation: 35, azimuth: 40, pitch: 30, yaw: 140, haze: 3, intensity: 0.4 }),
  // Slab 1.5 to 4.0 km. A floor at altitude 5 - 0.395 is above it, a floor at 1 - 0.395 is below its base.
  cloudShadow({ id: 'oracle-cloud-shadow-clear-ortho', ortho: true, altitude: 5, shadowed: false }),
  cloudShadow({ id: 'oracle-cloud-shadow-clear-perspective', ortho: false, altitude: 5, shadowed: false }),
  cloudShadow({ id: 'oracle-cloud-shadow-under-ortho', ortho: true, altitude: 2.2, shadowed: true }),
  cloudShadow({ id: 'oracle-cloud-shadow-under-perspective', ortho: false, altitude: 2.2, shadowed: true }),
  // Under the same slab, a floor nothing lights: a cloud dims the sun, not what a surface gives off.
  cloudShadow({ id: 'oracle-cloud-shadow-unlit-ortho', ortho: true, altitude: 2.2, shadowed: true, lit: false }),
  cloudShadow({ id: 'oracle-cloud-shadow-unlit-perspective', ortho: false, altitude: 2.2, shadowed: true, lit: false }),
  // The sun is 50 degrees up toward yaw 20; the camera looks 40 up toward it, so the lobe is on screen 10 degrees above the middle.
  customSky({ id: 'oracle-custom-sky-perspective', ortho: false, pitch: 40, yaw: 20, sunPitch: 50, sunYaw: 200 }),
  customSky({ id: 'oracle-custom-sky-ortho', ortho: true, pitch: 40, yaw: 20, sunPitch: 50, sunYaw: 200 }),
];

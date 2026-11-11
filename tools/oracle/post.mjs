// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  post.mjs — oracle scenes for the output stage: encoding, tone mapping, exposure, grade and fog.
 *
 * Eight flat unlit patches, each a known linear colour, so what reaches the screen is the chain under test and nothing else:
 * `unlit colour -> effects -> output transform -> sRGB encode`. Each expectation applies the published curve (or, for the
 * engine's own effects, the formula their shader source states) to the patch colour; no frame was read to write it.
 */
import { scene, camera, mesh, volume, probe, probeFrom } from './scene.mjs';
import { encodeLinear8, clamp01, acesNarkowicz, pbrNeutral, srgbDecode, scale } from './formulas.mjs';

const SLOTS = [[-75, -50], [-25, -50], [25, -50], [75, -50], [-75, 50], [-25, 50], [25, 50], [75, 50]];

/** Greys across the range a tone mapper has to handle, the top three above 1 (HDR). */
const GREYS = [0.01, 0.05, 0.18, 0.5, 1, 2, 4, 8].map((v) => [v, v, v]);
/** Saturated and mixed colours, where a per-channel curve and a luma-based grade differ. */
const COLOURS = [[0.8, 0.1, 0.05], [0.05, 0.6, 0.1], [0.05, 0.1, 0.9], [0.9, 0.7, 0.1], [0.5, 0.5, 0.5], [0.2, 0.3, 0.4], [0.02, 0.4, 0.35], [1.5, 0.6, 0.2]];

/**
 * @param tops  patch heights above the floor line; the camera looks down at each patch's top face
 * @param out   (linear rgb, slot index) -> linear rgb the frame should end as, before the sRGB encode
 */
function patches({ id, colours, tops, effects, outputTransform, out, tol = 3, about, perspective = false }) {
  const doc = scene(id, () => [
    camera(perspective ? { projectionType: 0, fov: 40 } : {}),
    ...colours.map((c, i) => {
      const top = tops?.[i] ?? 10;
      return mesh(`Patch${i}`, 'cube', [SLOTS[i][0], top / 2, SLOTS[i][1]], [0.4, top / 100, 0.4], c, { lit: false });
    }),
    ...(effects ? [volume(effects)] : []),
  ]);
  const expect = colours.map((c, i) => {
    const p = perspective ? probeFrom(...SLOTS[i], 400 - (tops?.[i] ?? 10), 40) : probe(...SLOTS[i]);
    return { x: p.x, y: p.y, rgb: encodeLinear8(out(c, i, SLOTS[i])), tol };
  });
  return { id, doc, colorSpace: 'linear', outputTransform, expect, about };
}

const fx = (type, uniforms, colors) => ({ type, enabled: true, uniforms, ...(colors ? { colors } : {}) });
const perChannel = (f) => (c) => c.map(f);
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The shader's colour grade, step by step, for a linear-light frame (see PP Color Grade in postprocess/sources/basic.ts). */
function grade(c, { exposure = 0, contrast = 1, saturation = 1, temperature = 0, tint = 0 }) {
  let v = scale(c, 2 ** exposure);
  v = [v[0] * (1 + temperature * 0.2), v[1] * (1 + tint * 0.2), v[2] * (1 - temperature * 0.2)];
  v = v.map((x) => 0.18 * Math.pow(Math.max(x, 1e-6) / 0.18, contrast));
  const l = lum(v);
  v = v.map((x) => l + (x - l) * saturation);
  return v.map(clamp01);
}

// Distance fog: the distance from the eye. An orthographic camera's eye is the plane it stands in (y = 400), so the distance to a patch is
// the vertical drop to its top face. (Before the fog measured from the projection's far-behind plane it had every patch fully fogged.)
const FOG_TOPS = [5, 45, 85, 125, 165, 205, 245, 285];
const FOG = { near: 100, far: 400, intensity: 0.9, colour: [0.6, 0.7, 0.8] };
const fogMix = (c, top) => {
  const t = clamp01((400 - top - FOG.near) / (FOG.far - FOG.near)) * FOG.intensity;
  const fog = FOG.colour.map(srgbDecode);
  return c.map((x, k) => x + (fog[k] - x) * t);
};


// Height fog: an exponential-density slab, rho(y) = density * exp(-falloff * (y - base)), integrated along the view ray. The camera looks
// straight down, so the ray runs from the eye plane (y = 400) to the patch top and the optical depth is closed form:
// tau = density / falloff * (exp(-falloff * (top - base)) - exp(-falloff * (400 - base))), and the fog covers 1 - exp(-tau).
// The fall-off is slow on purpose: the part of the ray between the camera plane and a start far behind it is thin air only when the
// density has died away by then, and this one has not, so a ray that begins too far back shows as too much fog.
const HEIGHT_FOG = { density: 0.004, falloff: 0.002, base: 0, colour: [0.55, 0.65, 0.8] };
const heightFogMix = (c, top) => {
  const tau = (HEIGHT_FOG.density / HEIGHT_FOG.falloff) * (Math.exp(-HEIGHT_FOG.falloff * (top - HEIGHT_FOG.base)) - Math.exp(-HEIGHT_FOG.falloff * (400 - HEIGHT_FOG.base)));
  const amount = 1 - Math.exp(-tau);
  const fog = HEIGHT_FOG.colour.map(srgbDecode);
  return c.map((x, k) => x + (fog[k] - x) * amount);
};


/**
 * The same fog under a perspective camera 400 units up with its near plane at 1: the ray starts on the near plane (y = 399) and
 * climbs by dirY over len, and tau = density(start) * len * (1 - exp(-falloff * dirY * len)) / (falloff * dirY * len).
 */
function heightFogPerspective(c, top, [x, z]) {
  const eye = [0, 400, 0], p = [x, top, z], toP = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const full = Math.hypot(...toP), s = 1 / (400 - top), len = (1 - s) * full, dirY = toP[1] / full, startY = 400 - s * (400 - top);
  const dens = HEIGHT_FOG.density * Math.exp(-HEIGHT_FOG.falloff * (startY - HEIGHT_FOG.base));
  const kd = HEIGHT_FOG.falloff * dirY * len;
  const tau = dens * len * (Math.abs(kd) < 1e-4 ? 1 : (1 - Math.exp(-kd)) / kd);
  const amount = 1 - Math.exp(-tau), fog = HEIGHT_FOG.colour.map(srgbDecode);
  return c.map((v, k) => v + (fog[k] - v) * amount);
}


// Underwater: the camera (y = 400) is under a water plane at y = 450. With no sun there are no caustics or shafts, so a surface seen
// through `len` of water is colour * T + scatter * (1 - mean(T)), T = exp(-absorption * density * len), len the drop to the surface.
const WATER = { absorption: [0.45, 0.09, 0.05], scatter: [0.03, 0.2, 0.28], density: 0.003, planeD: 450 };
const waterMix = (c, top) => {
  const len = 400 - top;
  const T = WATER.absorption.map((a) => Math.exp(-a * WATER.density * len));
  const mean = (T[0] + T[1] + T[2]) / 3, scatter = WATER.scatter.map(srgbDecode);
  return c.map((v, k) => v * T[k] + scatter[k] * (1 - mean));
};

export const POST_SCENES = [
  patches({ id: 'oracle-encode-linear', colours: GREYS, out: perChannel(clamp01), about: 'No tone map: the linear value is sRGB-encoded as it is, clamped at 1' }),
  patches({ id: 'oracle-output-aces', colours: GREYS, outputTransform: 'aces', out: perChannel(acesNarkowicz), about: 'Output transform ACES: Narkowicz fit, then the sRGB encode' }),
  patches({ id: 'oracle-output-aces-colour', colours: COLOURS, outputTransform: 'aces', out: perChannel(acesNarkowicz), about: 'ACES acts per channel: saturated colours shift hue' }),
  patches({ id: 'oracle-output-neutral', colours: GREYS, outputTransform: 'neutral', out: (c) => pbrNeutral(c).map(clamp01), about: 'Output transform Khronos PBR Neutral' }),
  patches({ id: 'oracle-output-neutral-colour', colours: COLOURS, outputTransform: 'neutral', out: (c) => pbrNeutral(c).map(clamp01), about: 'Khronos Neutral keeps hue and saturation below the knee' }),
  patches({ id: 'oracle-tonemap-ev-up', colours: GREYS, effects: [fx('tonemap', { u_exposure: 1 })], out: perChannel((v) => acesNarkowicz(v * 2)), about: 'Tonemap effect, +1 EV: ACES of 2 x colour' }),
  patches({ id: 'oracle-tonemap-ev-down', colours: GREYS, effects: [fx('tonemap', { u_exposure: -1.5 })], out: perChannel((v) => acesNarkowicz(v * 2 ** -1.5)), about: 'Tonemap effect, -1.5 EV' }),
  patches({ id: 'oracle-grade-exposure', colours: GREYS, effects: [fx('colorGrade', { u_exposure: -2 })], out: (c) => grade(c, { exposure: -2 }), about: 'Colour grade exposure: colour x 2^EV (0.25 at -2 EV)' }),
  patches({ id: 'oracle-grade-contrast', colours: COLOURS, effects: [fx('colorGrade', { u_contrast: 1.4 })], out: (c) => grade(c, { contrast: 1.4 }), about: 'Linear-light contrast: a power curve about 0.18' }),
  patches({ id: 'oracle-grade-saturation', colours: COLOURS, effects: [fx('colorGrade', { u_saturation: 0.4 })], out: (c) => grade(c, { saturation: 0.4 }), about: 'Saturation about Rec.709 luma' }),
  patches({ id: 'oracle-grade-balance', colours: COLOURS, effects: [fx('colorGrade', { u_temperature: 0.6, u_tint: -0.5 })], out: (c) => grade(c, { temperature: 0.6, tint: -0.5 }), about: 'White balance: R and B by temperature, G by tint' }),
  patches({
    id: 'oracle-distance-fog', colours: GREYS.map((g) => g.map((v) => Math.min(v, 1) * 0.8 + 0.1)), tops: FOG_TOPS, tol: 4,
    effects: [fx('distanceFog', { u_fogNear: FOG.near, u_fogFar: FOG.far, u_intensity: FOG.intensity }, { u_fogColor: { r: FOG.colour[0], g: FOG.colour[1], b: FOG.colour[2], a: 1 } })],
    out: (c, i) => fogMix(c, FOG_TOPS[i]).map(clamp01),
    about: 'Distance fog: mix(colour, fog, clamp((distance - near) / (far - near)) x intensity)',
  }),
  patches({
    id: 'oracle-height-fog', colours: GREYS.map((g) => g.map((v) => Math.min(v, 1) * 0.8 + 0.1)), tops: FOG_TOPS, tol: 4,
    effects: [fx('heightFog', { u_density: HEIGHT_FOG.density, u_heightFalloff: HEIGHT_FOG.falloff, u_baseHeight: HEIGHT_FOG.base, u_inscatter: 0, u_skyFog: 0.8 }, { u_fogColor: { r: HEIGHT_FOG.colour[0], g: HEIGHT_FOG.colour[1], b: HEIGHT_FOG.colour[2], a: 1 } })],
    out: (c, i) => heightFogMix(c, FOG_TOPS[i]).map(clamp01),
    about: 'Height fog: coverage 1 - exp(-tau), tau the exponential density integrated from the eye plane to the surface',
  }),
  patches({
    id: 'oracle-height-fog-perspective', perspective: true, colours: GREYS.map((g) => g.map((v) => Math.min(v, 1) * 0.8 + 0.1)), tops: FOG_TOPS, tol: 4,
    effects: [fx('heightFog', { u_density: HEIGHT_FOG.density, u_heightFalloff: HEIGHT_FOG.falloff, u_baseHeight: HEIGHT_FOG.base, u_inscatter: 0, u_skyFog: 0.8 }, { u_fogColor: { r: HEIGHT_FOG.colour[0], g: HEIGHT_FOG.colour[1], b: HEIGHT_FOG.colour[2], a: 1 } })],
    out: (c, i, slot) => heightFogPerspective(c, FOG_TOPS[i], slot).map(clamp01),
    about: 'Height fog under a perspective camera: the ray starts on the near plane',
  }),
  patches({
    id: 'oracle-underwater', colours: GREYS.map((g) => g.map((v) => Math.min(v, 1) * 0.8 + 0.1)), tops: FOG_TOPS, tol: 4,
    effects: [fx('underwater', { u_density: WATER.density, u_planeNx: 0, u_planeNy: 1, u_planeNz: 0, u_planeD: WATER.planeD, u_cameraDepth: 0, u_range: 4000 },
      { u_absorption: { r: WATER.absorption[0], g: WATER.absorption[1], b: WATER.absorption[2], a: 1 }, u_scatterColor: { r: WATER.scatter[0], g: WATER.scatter[1], b: WATER.scatter[2], a: 1 } })],
    out: (c, i) => waterMix(c, FOG_TOPS[i]).map(clamp01),
    about: 'Underwater fog: Beer-Lambert absorption over the drop to the surface, plus the colour of the water itself',
  }),
];

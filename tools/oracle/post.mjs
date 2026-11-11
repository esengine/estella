// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  post.mjs — oracle scenes for the output stage: encoding, tone mapping, exposure, grade and fog.
 *
 * Eight flat unlit patches, each a known linear colour, so what reaches the screen is the chain under test and nothing else:
 * `unlit colour -> effects -> output transform -> sRGB encode`. Each expectation applies the published curve (or, for the
 * engine's own effects, the formula their shader source states) to the patch colour; no frame was read to write it.
 */
import { scene, camera, mesh, volume, probe } from './scene.mjs';
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
function patches({ id, colours, tops, effects, outputTransform, out, tol = 3, about }) {
  const doc = scene(id, () => [
    camera(),
    ...colours.map((c, i) => {
      const top = tops?.[i] ?? 10;
      return mesh(`Patch${i}`, 'cube', [SLOTS[i][0], top / 2, SLOTS[i][1]], [0.4, top / 100, 0.4], c, { lit: false });
    }),
    ...(effects ? [volume(effects)] : []),
  ]);
  const expect = colours.map((c, i) => {
    const p = probe(...SLOTS[i]);
    return { x: p.x, y: p.y, rgb: encodeLinear8(out(c, i)), tol };
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
];

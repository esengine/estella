// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  exposure.mjs — oracle scenes for Auto Exposure, Bloom and Vignette.
 *
 * Each is looked at through a frame whose light is known: a flat unlit floor filling it (one colour everywhere), or that with a dark
 * patch in the middle. What the effect does to such a frame is closed form:
 *
 *   Vignette      colour x mix(1, 1 - smoothstep(1 - softness, 1, r), intensity), r the distance from the middle in [-1, 1] units.
 *   Bloom         a pyramid that keeps the mean (its weights sum to one), so a uniform frame comes back unchanged through it:
 *                 colour x (1 + intensity x contrib), contrib the soft-knee threshold over the colour's peak channel.
 *   Auto Exposure the exposure that takes the picture's mean log luminance to 18% grey, plus the compensation, held between the
 *                 minimum and maximum, applied as colour x 2^EV.
 */
import { scene, camera, mesh, volume, SIZE } from './scene.mjs';
import { encodeLinear8, clamp01, smoothstep } from './formulas.mjs';

const fx = (type, uniforms) => ({ type, enabled: true, uniforms });
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const floor = (c) => mesh('Floor', 'cube', [0, 0, 0], [4, 0.1, 4], c, { lit: false });
const frac = (i) => i / (SIZE - 1);

/** A frame that is one colour everywhere: the harness wants that said, and every pixel counted. */
function uniformFrame({ id, colour, effects, expected, about, tol = 4 }) {
  const doc = scene(id, () => [camera(), floor(colour), volume(effects)]);
  const rgb = encodeLinear8(expected.map(clamp01));
  return { id, doc, colorSpace: 'linear', expect: [{ x: 0.5, y: 0.5, rgb, tol }], uniform: true, count: [{ rgb, tol, atLeast: SIZE * SIZE }], about };
}

// ---- vignette --------------------------------------------------------------------------------------------------------------------

function vignette({ id, colour, intensity, softness }) {
  const doc = scene(id, () => [camera(), floor(colour), volume([fx('vignette', { u_intensity: intensity, u_softness: softness })])]);
  const probes = [[128, 128], [160, 128], [200, 128], [230, 128], [253, 128], [128, 40], [190, 190], [240, 240], [30, 210]];
  const expect = probes.map(([i, j]) => {
    const u = (i + 0.5) / SIZE, v = (j + 0.5) / SIZE, r = Math.hypot(u * 2 - 1, v * 2 - 1);
    const vig = 1 - smoothstep(1 - softness, 1, r), k = 1 + (vig - 1) * intensity;
    return { x: frac(i), y: frac(j), rgb: encodeLinear8(colour.map((c) => c * k)), tol: 3 };
  });
  return { id, doc, colorSpace: 'linear', expect, about: `Vignette: colour x mix(1, 1 - smoothstep(1 - ${softness}, 1, r), ${intensity})` };
}

// ---- bloom -----------------------------------------------------------------------------------------------------------------------

/**
 * The soft-knee threshold of the pyramid's prefilter: how much of a colour's light is over the threshold, as a share of it. The
 * brightness it thresholds is the colour's PEAK channel (as Unity's bloom does), not its luminance: a saturated colour blooms by its
 * strongest channel. (The effect's older one-pass extract shader thresholds luminance; the pyramid does not use it.)
 */
function bloomContrib(colour, threshold) {
  const b = Math.max(...colour), knee = Math.max(threshold * 0.5, 1e-4);
  let soft = Math.min(Math.max(b - threshold + knee, 0), 2 * knee);
  soft = (soft * soft) / (4 * knee + 0.00001);
  return Math.max(soft, b - threshold) / Math.max(b, 0.00001);
}
function bloomUniform({ id, colour, threshold, intensity, radius }) {
  const k = 1 + intensity * bloomContrib(colour, threshold);
  return uniformFrame({
    id, colour, effects: [fx('bloom', { u_threshold: threshold, u_intensity: intensity, u_radius: radius })], expected: colour.map((c) => c * k),
    about: `Bloom over a uniform frame: colour x (1 + ${intensity} x contrib), contrib = ${bloomContrib(colour, threshold).toFixed(3)}`,
  });
}

// ---- auto exposure ---------------------------------------------------------------------------------------------------------------

/** The EV the picture settles on for a uniform frame of luminance `l`. */
const settledEv = (l, { bias = 0, minEV = -4, maxEV = 4 }) => Math.min(Math.max(Math.log2(0.18) - Math.log2(l) + bias, minEV), maxEV);
function exposureUniform({ id, colour, params = {} }) {
  const ev = settledEv(lum(colour), params);
  return uniformFrame({
    id, colour, effects: [fx('autoExposure', { u_bias: params.bias ?? 0, u_minEV: params.minEV ?? -4, u_maxEV: params.maxEV ?? 4 })], expected: colour.map((c) => c * 2 ** ev), tol: 5,
    about: `Auto exposure on a uniform frame: EV = clamp(log2(0.18 / ${lum(colour).toFixed(3)}) + bias) = ${ev.toFixed(2)}, colour x 2^EV`,
  });
}

/**
 * A bright frame with a dark square in the middle, metered three ways. What the meter sees is worked out the way the passes do: 16x16
 * blocks of the frame each averaged in log luminance over 16 taps, then 8x8 taps over those blocks, weighted by the metering mode.
 */
function exposureMetered({ id, metering, meterSize = 0.35, bright = 0.8, dark = 0.05 }) {
  const HALF_PATCH = 60; // pixels: the dark square covers pixels 68..187 either way
  const lumAt = (px, py) => (Math.abs(px + 0.5 - 128) <= HALF_PATCH && Math.abs(py + 0.5 - 128) <= HALF_PATCH ? dark : bright);
  const tap = (px, py) => (lumAt(px, py) + lumAt(px + 1, py) + lumAt(px, py + 1) + lumAt(px + 1, py + 1)) / 4; // a bilinear tap between four pixels
  const blocks = [];
  for (let ty = 0; ty < 16; ty++) {
    blocks.push([]);
    for (let tx = 0; tx < 16; tx++) {
      let sum = 0, counted = 0;
      for (const oy of [1, 5, 9, 13]) for (const ox of [1, 5, 9, 13]) {
        const l = tap(tx * 16 + ox, ty * 16 + oy);
        if (l > 0.0039) { sum += Math.log2(l); counted++; }
      }
      blocks[ty].push({ code: counted ? clamp01((sum / counted + 12) / 20) : 0, share: counted / 16 });
    }
  }
  const bilinear = (u, v, key) => { // a texture read at (u, v) of the 16x16 blocks
    const x = u * 16 - 0.5, y = v * 16 - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx_ = x - x0, fy = y - y0;
    const at = (xx, yy) => blocks[Math.min(15, Math.max(0, yy))][Math.min(15, Math.max(0, xx))][key];
    return (at(x0, y0) * (1 - fx_) + at(x0 + 1, y0) * fx_) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx_) + at(x0 + 1, y0 + 1) * fx_) * fy;
  };
  const extent = metering < 0.5 ? 1 : Math.min(Math.max(meterSize * 2.4, 0.1), 1);
  const weight = (u, v) => {
    if (metering < 0.5) return 1;
    const r = Math.hypot(u - 0.5, v - 0.5) / Math.max(meterSize, 0.02);
    return metering < 1.5 ? Math.exp(-2 * r * r) + 0.04 : r < 1 ? 1 : 0;
  };
  let sum = 0, total = 0;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const u = 0.5 + (((i + 0.5) / 8) - 0.5) * extent, v = 0.5 + (((j + 0.5) / 8) - 0.5) * extent, w = weight(u, v);
    sum += bilinear(u, v, 'code') * bilinear(u, v, 'share') * w; total += bilinear(u, v, 'share') * w;
  }
  const meanLog = total > 1e-3 ? (sum / total) * 20 - 12 : Math.log2(0.18);
  const ev = Math.min(Math.max(Math.log2(0.18) - meanLog, -4), 4);
  const doc = scene(id, () => [
    camera(), floor([bright, bright, bright]),
    mesh('Patch', 'cube', [0, 0, 0], [(HALF_PATCH * 2) / 1.28 / 100, 0.15, (HALF_PATCH * 2) / 1.28 / 100], [dark, dark, dark], { lit: false }),
    volume([fx('autoExposure', { u_metering: metering, u_meterSize: meterSize })]),
  ]);
  const expect = [[20, 20], [235, 40], [128, 128], [110, 150]].map(([i, j]) => {
    const l = lumAt(i, j);
    return { x: frac(i), y: frac(j), rgb: encodeLinear8([l * 2 ** ev, l * 2 ** ev, l * 2 ** ev].map(clamp01)), tol: 6 };
  });
  return { id, doc, colorSpace: 'linear', expect, ev, about: `Auto exposure, metering ${metering}: EV ${ev.toFixed(2)} from the meter's mean log luminance` };
}


/**
 * A bright square in the middle of a dark frame. The glow round it has no short closed form (it is five levels of a pyramid), but it has
 * to be the same whichever way it is read: mirrored left to right, top to bottom, and across the diagonal (the square is symmetric under
 * all three), so a half-texel that a level carries one way and not the other shows as a pair that differs. And it has to reach: bloom that
 * did nothing would pass every symmetry, so a share of the dark frame must not be pure black.
 */
function bloomSpot({ id }) {
  const doc = scene(id, () => [camera(), mesh('Spot', 'cube', [0, 0, 0], [0.3125, 0.1, 0.3125], [3, 3, 3], { lit: false }), volume([fx('bloom', { u_threshold: 0.8, u_intensity: 1, u_radius: 1 })])]);
  const pairs = [];
  for (const d of [8, 16, 32, 60]) {
    const i = 128 - 20 - d; // d pixels outside the square's edge, to the left; its mirror is on the right
    pairs.push([frac(i), 0.5, frac(SIZE - 1 - i), 0.5]);   // left / right
    pairs.push([0.5, frac(i), 0.5, frac(SIZE - 1 - i)]);   // top / bottom
    pairs.push([frac(i), 0.5, 0.5, frac(i)]);              // across the diagonal
  }
  const black = [{ rgb: [0, 0, 0], tol: 0, atMost: Math.floor(SIZE * SIZE * 0.88) }];
  return { id, doc, colorSpace: 'linear', twins: { pairs, tol: 2 }, count: black, about: 'Bloom of a bright square: symmetric every way, and it spreads' };
}

export const EXPOSURE_SCENES = [
  vignette({ id: 'oracle-vignette', colour: [0.5, 0.5, 0.5], intensity: 0.8, softness: 0.6 }),
  vignette({ id: 'oracle-vignette-hard', colour: [0.7, 0.4, 0.2], intensity: 1, softness: 0.2 }),
  bloomUniform({ id: 'oracle-bloom-knee', colour: [0.5, 0.5, 0.5], threshold: 0.4, intensity: 1.0, radius: 1 }),
  bloomUniform({ id: 'oracle-bloom-colour', colour: [0.6, 0.4, 0.2], threshold: 0.3, intensity: 1.2, radius: 1 }),
  bloomUniform({ id: 'oracle-bloom-radius', colour: [0.5, 0.5, 0.5], threshold: 0.4, intensity: 1.0, radius: 4 }),
  bloomUniform({ id: 'oracle-bloom-over', colour: [0.7, 0.7, 0.7], threshold: 0.2, intensity: 0.5, radius: 1 }),
  bloomUniform({ id: 'oracle-bloom-below', colour: [0.2, 0.2, 0.2], threshold: 0.6, intensity: 2, radius: 1 }),
  exposureUniform({ id: 'oracle-exposure-mid', colour: [0.5, 0.5, 0.5] }),
  exposureUniform({ id: 'oracle-exposure-bias', colour: [0.5, 0.5, 0.5], params: { bias: 1 } }),
  exposureUniform({ id: 'oracle-exposure-dark-clamp', colour: [0.01, 0.01, 0.01], params: { maxEV: 2 } }),
  exposureUniform({ id: 'oracle-exposure-bright-clamp', colour: [4, 4, 4] }),
  exposureMetered({ id: 'oracle-exposure-average', metering: 0 }),
  exposureMetered({ id: 'oracle-exposure-centre', metering: 1, meterSize: 0.3 }),
  exposureMetered({ id: 'oracle-exposure-spot', metering: 2, meterSize: 0.2 }),
  bloomSpot({ id: 'oracle-bloom-spot' }),
];

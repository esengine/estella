// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  formulas.mjs — the closed-form answers the oracle scenes are checked against.
 *
 * Every function here is written from the published definition (Lambert's cosine law, the IEC 61966-2-1 sRGB curve, Narkowicz's
 * ACES fit, Khronos PBR Neutral, UE4's windowed inverse-square), never read back from a frame. A number that came from the engine
 * would make the check agree with the engine by construction; these come from the maths, so a disagreement is a finding.
 */

export const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** The sRGB transfer function: linear light in, the display code (0..1) out. */
export const srgbEncode = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export const srgbDecode = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** A linear 0..1 triple as the 8-bit code a linear-light frame ends as. */
export const encodeLinear8 = (rgb) => rgb.map((c) => Math.round(255 * srgbEncode(clamp01(c))));
/** A gamma-space frame is displayed as it is computed. */
export const encodeGamma8 = (rgb) => rgb.map((c) => Math.round(255 * clamp01(c)));

/** Narkowicz's ACES filmic fit (https://knarkowicz.wordpress.com/2016/01/06/), per channel. */
export const acesNarkowicz = (x) => clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));

/** Khronos PBR Neutral (KhronosGroup/ToneMapping), over an RGB triple. */
export function pbrNeutral(rgb) {
  const startCompression = 0.8 - 0.04, desaturation = 0.15;
  const x = Math.min(...rgb);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let c = rgb.map((v) => v - offset);
  const peak = Math.max(...c);
  if (peak < startCompression) return c;
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  c = c.map((v) => v * (newPeak / peak));
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return c.map((v) => v * (1 - g) + newPeak * g);
}

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => a.map((v) => v * s);

/** Rotate a vector by a unit quaternion {x,y,z,w}. */
export function rotate(q, v) {
  const { x, y, z, w } = q;
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
}
/** The quaternion for `deg` about a unit axis. */
export function axisAngle(axis, deg) {
  const h = (deg * Math.PI) / 360, s = Math.sin(h);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(h) };
}
export function mulQ(a, b) {
  return { w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z, x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w };
}

/**
 * A directional light aimed `pitch` degrees below the horizon and turned `yaw` degrees about +Y. The light shines along its
 * entity's -Z, the way a camera looks; `toLight` is the unit vector a surface takes to the light.
 */
export function sunAim(pitch, yaw) {
  const rotation = mulQ(axisAngle([0, 1, 0], yaw), axisAngle([1, 0, 0], -pitch));
  const shines = rotate(rotation, [0, 0, -1]);
  return { rotation, shines, toLight: scale(shines, -1) };
}

/** Lambert: radiance reflected by a white-lit diffuse surface of albedo `a` under irradiance `e` and cosine `ndotl`. */
export const lambert = (albedo, e, ndotl) => albedo.map((a, k) => a * e[k] * Math.max(0, ndotl));

/** The engine's linear point/spot falloff: a ramp from the light's `reach` in to its `inner` radius, raised to `falloff`. */
export function linearFalloff(dist, reach, inner = 0, falloff = 1) {
  const ramp = clamp01((reach - dist) / Math.max(reach - inner, 1e-4));
  return Math.pow(ramp, Math.max(falloff, 1e-3));
}
/**
 * An inverse-square lamp: 1/d² with d in metres (`unitsPerMetre` world units), windowed to zero at `reach` by
 * (1 - (d/reach)^4)² — the smooth window of Karis, "Real Shading in Unreal Engine 4".
 */
export function inverseSquare(dist, reach, unitsPerMetre = 100) {
  const metres = dist / unitsPerMetre, q = dist / reach;
  const w = clamp01(1 - q ** 4);
  return (w * w) / Math.max(metres * metres, 0.01);
}

/** GLSL smoothstep: 0 below edge0, 1 above edge1, 3t^2 - 2t^3 between (edge0 > edge1 reverses it, as the spot cone uses it). */
export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

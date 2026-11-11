// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  scene.mjs — the little vocabulary the oracle scenes are written in, and how a world point becomes a frame point.
 *
 * Every oracle scene is seen by one orthographic camera looking straight down -Y, half-height `HALF` world units, over a square
 * frame of `SIZE` pixels: image right is +X and image DOWN is +Z. A probe is named by the world point it samples, and
 * {@link probe} turns that into the frame fraction the runner reads, so an expectation is written as "what is at (x, z)" and
 * never as a pixel number.
 */

export const SIZE = 256;
export const HALF = 100;
const CAMERA_Y = 400;

/** The world XZ of a frame pixel's centre. */
const centre = (i) => ((i + 0.5) / SIZE - 0.5) * 2 * HALF;
/** The pixel whose centre is nearest `world`, and the world point that centre actually is. */
export function snap(world) {
  const i = Math.min(SIZE - 1, Math.max(0, Math.floor((world / (2 * HALF) + 0.5) * SIZE)));
  return { i, world: centre(i) };
}
/** A frame probe at the world point (x, z); `at` is where the shading is to be evaluated. */
export function probe(x, z) {
  const px = snap(x), pz = snap(z);
  return { x: px.i / (SIZE - 1), y: pz.i / (SIZE - 1), at: [px.world, pz.world] };
}

/**
 * A frame probe for the point (x, z) on a horizontal surface `drop` units below a perspective camera that looks straight down with
 * vertical field of view `fov` degrees: the surface's half-width in view is drop * tan(fov / 2), so x and z scale by it.
 */
export function probeFrom(x, z, drop, fov) {
  const half = drop * Math.tan((fov * Math.PI) / 360);
  const at = (w) => Math.min(SIZE - 1, Math.max(0, Math.floor((w / (2 * half) + 0.5) * SIZE)));
  return { x: at(x) / (SIZE - 1), y: at(z) / (SIZE - 1) };
}

let nextId;
const entity = (name, components) => ({ id: nextId++, name, parent: null, children: [], visible: true, components });
const transform = (position, rotation, scale) => ({
  type: 'Transform',
  data: { position: { x: position[0], y: position[1], z: position[2] }, ...(rotation ? { rotation } : {}), ...(scale ? { scale: { x: scale[0], y: scale[1], z: scale[2] } } : {}) },
});
const rgba = (c) => ({ r: c[0], g: c[1], b: c[2], a: 1 });

export const camera = (extra = {}) => entity('Camera', [
  transform([0, CAMERA_Y, 0], { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }),
  { type: 'Camera', data: { projectionType: 1, orthoSize: HALF, nearPlane: 1, farPlane: 2000, isActive: true, priority: 0, ...extra } },
]);
/** A lit, opaque mesh. `scale` multiplies the 100-unit builtin. */
export const mesh = (name, builtin, position, scale, color, extra = {}) => entity(name, [
  transform(position, null, scale),
  { type: 'MeshRenderer', data: { mesh: `builtin:${builtin}`, color: rgba(color), lit: true, opaque: true, cullBackfaces: true, enabled: true, ...extra } },
]);
export const sun = (aim, intensity, color = [1, 1, 1], extra = {}) => entity('Sun', [
  transform([0, 0, 0], aim.rotation),
  { type: 'Light', data: { type: 1, color: rgba(color), intensity, ...extra } },
]);
export const ambient = (intensity, color = [1, 1, 1], extra = {}) => entity('Ambient', [
  transform([0, 0, 0]), { type: 'Light', data: { type: 2, color: rgba(color), intensity, ...extra } },
]);
export const lamp = (position, intensity, color, light) => entity('Lamp', [
  transform(position), { type: 'Light', data: { type: 0, color: rgba(color ?? [1, 1, 1]), intensity, ...light } },
]);
export const volume = (effects) => entity('Look', [
  transform([0, 0, 0]), { type: 'PostProcessVolume', data: { isGlobal: true, priority: 0, weight: 1, effects } },
]);

/** Build a scene document; ids restart per scene so a regenerated file is byte-identical. */
export function scene(name, build) {
  nextId = 0;
  const entities = build();
  return { version: 4, name, entities };
}

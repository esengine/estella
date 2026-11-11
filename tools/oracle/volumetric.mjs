// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  volumetric.mjs — oracle scenes for the sun's light through height fog (Height Fog with Volumetric above 0).
 *
 * The camera looks along -Z at six flat patches standing at different distances, through a fog of constant density. For a ray of
 * length L the fog covers 1 - exp(-density x L) of the patch, and with the sun's light scattered toward the eye by the air that it
 * reaches, the frame adds  tint x lit x phase x inscatter x volumetric x strength , where
 *   lit      = the integral over the ray of  visible(p) x density x exp(-density x s) ds   (visible: 1 where the sun reaches the air),
 *   phase    = Henyey-Greenstein, g = 0.55, of the angle between the ray and the sun,
 *   strength = the light's intensity / 2.
 * With no shadow in the scene `visible` is 1 and lit = 1 - exp(-tau): the whole of what the fog scatters. With a ceiling that casts a
 * shadow over part of the ray, `visible` is a ray from the air toward the sun that meets a box or does not.
 */
import { scene, camera, mesh, sun, volume, SIZE, HALF } from './scene.mjs';
import { sunAim, dot, norm, sub, encodeLinear8, clamp01, srgbDecode } from './formulas.mjs';

const DENSITY = 0.0033, INSCATTER = 1.0, VOLUMETRIC = 0.8, SUN_EXPONENT = 8, FOV = 40, NEAR = 1;
const FOG = [0.5, 0.6, 0.8];
const LIGHT_COLOUR = [1, 0.9, 0.8], LIGHT_INTENSITY = 2;
const PATCH = 0.5;
const DISTANCES = [100, 200, 300, 400, 500, 600];

const slab = (origin, dir, box) => {
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dir[a]) < 1e-9) { if (origin[a] < box.min[a] || origin[a] > box.max[a]) return false; continue; }
    let ta = (box.min[a] - origin[a]) / dir[a], tb = (box.max[a] - origin[a]) / dir[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
};
const phaseHG = (c) => { const g = 0.55; return ((1 - g * g) / Math.pow(Math.max(1 + g * g - 2 * g * c, 1e-3), 1.5)) * 0.25; };

function volumetricFog({ id, ortho, shadows }) {
  const aim = sunAim(45, 180); // the sun is ahead of the camera and 45 degrees up: toLight = (0, 0.707, -0.707)
  const tanHalf = Math.tan((FOV * Math.PI) / 360);
  // Where each patch stands: a column of the frame, at its own distance. A perspective camera sees a patch of width w at distance d as
  // w / (2 d tan(fov/2)) of the frame, so the columns and widths scale with d to keep the same shares.
  const columns = [0.14, 0.26, 0.38, 0.5, 0.62, 0.74];
  const patches = DISTANCES.map((d, i) => {
    const half = ortho ? HALF : d * tanHalf;
    const cx = (columns[i] - 0.5) * 2 * half, w = 0.09 * 2 * half;
    return { d, x: cx, box: { min: [cx - w / 2, -20, -d - 2], max: [cx + w / 2, 20, -d] } };
  });
  const ceiling = { min: [-200, 50, -300], max: [200, 55, -150] };
  const boxes = [...patches.map((p) => p.box), ...(shadows ? [ceiling] : [])];
  const doc = scene(id, () => [
    camera(ortho ? {} : { projectionType: 0, fov: FOV, nearPlane: NEAR, farPlane: 2000 }),
    ...patches.map((p, i) => mesh(`Patch${i}`, 'cube', [p.x, 0, -p.d - 1], [(p.box.max[0] - p.box.min[0]) / 100, 0.4, 0.02], [PATCH, PATCH, PATCH], { lit: false })),
    ...(shadows ? [mesh('Ceiling', 'cube', [0, 52.5, -225], [4, 0.05, 1.5], [0.3, 0.3, 0.3], { lit: false })] : []),
    sun(aim, LIGHT_INTENSITY, LIGHT_COLOUR, { meshShadows: shadows, shadowExtent: shadows ? 700 : 0 }),
    volume([{ type: 'heightFog', enabled: true, uniforms: { u_density: DENSITY, u_heightFalloff: 0, u_baseHeight: 0, u_inscatter: INSCATTER, u_volumetric: VOLUMETRIC, u_sunExponent: SUN_EXPONENT, u_followSun: 1, u_volumeRange: 3000 },
      colors: { u_fogColor: { r: FOG[0], g: FOG[1], b: FOG[2], a: 1 } } }]),
  ]);
  const cam = doc.entities.find((e) => e.name === 'Camera');
  cam.components[0].data.position = { x: 0, y: 0, z: 0 };
  cam.components[0].data.rotation = { x: 0, y: 0, z: 0, w: 1 };

  const lightLinear = LIGHT_COLOUR.map(srgbDecode), top = Math.max(...lightLinear);
  const tint = lightLinear.map((c) => c / top), fog = FOG.map(srgbDecode);
  const strength = Math.min(Math.max(LIGHT_INTENSITY, 0), 8) * 0.5;
  const visible = (p) => (shadows ? !boxes.some((b) => slab(p, aim.toLight, b)) : true);

  const expect = patches.map((patch, i) => {
    const target = [patch.x, 0, -patch.d], eye = [0, 0, 0];
    let dir, entry, len;
    if (ortho) { dir = [0, 0, -1]; entry = [patch.x, 0, 0]; len = patch.d; }
    else {
      const toP = sub(target, eye), full = Math.hypot(...toP), s = NEAR / patch.d;
      dir = toP.map((v) => v / full); entry = toP.map((v) => v * s); len = (1 - s) * full;
    }
    const tau = DENSITY * len, amount = 1 - Math.exp(-tau);
    const glow = Math.pow(Math.max(dot(dir, aim.toLight), 0), SUN_EXPONENT), shaped = glow * (1 - VOLUMETRIC);
    const k = clamp01(shaped * INSCATTER);
    const colour = fog.map((f, c) => f + (tint[c] - f) * k);
    const base = colour.map((c) => PATCH + (c - PATCH) * clamp01(amount));
    // The scattered sun: the air's density x the light that reaches it, summed along the ray with the fog already in front of it.
    const N = 1500, ds = len / N;
    let lit = 0;
    for (let n = 0; n < N; n++) {
      const sdist = (n + 0.5) * ds, p = [entry[0] + dir[0] * sdist, entry[1] + dir[1] * sdist, entry[2] + dir[2] * sdist];
      if (visible(p)) lit += DENSITY * Math.exp(-DENSITY * sdist) * ds;
    }
    const add = tint.map((t) => t * lit * phaseHG(dot(dir, aim.toLight)) * INSCATTER * VOLUMETRIC * strength);
    const rgb = base.map((b, c) => b + add[c]);
    // The patch's column, at its middle row; a perspective patch is seen at its own scale.
    const half = ortho ? HALF : patch.d * tanHalf;
    const fx = Math.min(SIZE - 1, Math.floor((patch.x / (2 * half) + 0.5) * SIZE));
    return { x: fx / (SIZE - 1), y: 0.5, rgb: encodeLinear8(rgb.map(clamp01)), tol: shadows ? 8 : 5 };
  });
  return { id, doc, colorSpace: 'linear', expect,
    about: `Volumetric height fog, ${ortho ? 'orthographic' : 'perspective'}${shadows ? ', a ceiling shadowing part of the ray' : ''}: the sun scattered by the air, closed form` };
}

export const VOLUMETRIC_SCENES = [
  volumetricFog({ id: 'oracle-volumetric-ortho', ortho: true, shadows: false }),
  volumetricFog({ id: 'oracle-volumetric-perspective', ortho: false, shadows: false }),
  volumetricFog({ id: 'oracle-volumetric-shadow-ortho', ortho: true, shadows: true }),
  volumetricFog({ id: 'oracle-volumetric-shadow-perspective', ortho: false, shadows: true }),
];
